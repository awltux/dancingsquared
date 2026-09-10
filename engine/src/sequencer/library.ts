// CallLibrary: owns the registered call variants, user-defined modules, and the
// parsed formation registry used for recognition/snapping. This is the data
// layer of the sequencer — it holds no board state and performs no geometry
// transforms itself, so callers depend on a narrow read-only surface.

import { DEG } from '../core.js';
import { buildCall, parseCallXml, parseFormations, parseMoves } from '../convert.js';
import { matchFormations, type Matchable } from './match.js';
import { assignHomeIdentity, normAngle } from './identity.js';
import { canonicalName } from './constants.js';
import type { CallStep, Module } from './types.js';
import type { CallBundle } from '../types.js';

// Calls that are conceptually sequences of multiple smaller calls (e.g. Running
// Bear) but are authored in the data as a single call. The picker shows these as
// "modules" so their composite nature is visible. Extend this list as more are
// identified; user-defined modules (registerModule) are handled separately.
const CURATED_MODULE_CALLS: string[] = ['Running Bear'];

// Calls that are NON-COMPOSITIONAL: their behaviour is not the sum of their parts
// (they may depend on the direction the dancer last turned, carried in metadata).
// Such calls cannot be collapsed into a single matrix, and any MODULE containing
// one also cannot be collapsed. Extend this list as such calls are identified.
const NON_COMPOSITIONAL_CALLS: string[] = [];

export class CallLibrary {
  private readonly variants: Map<string, CallBundle[]> = new Map();
  private readonly modules: Map<string, (string | CallStep)[]> = new Map(); // module name -> call steps
  private readonly namedFormations: { name: string; dancers: Matchable[] }[] = [];
  private readonly uniqueFormations: { name: string; dancers: Matchable[] }[] = [];

  constructor(private readonly movesXml: string, private readonly formationsXml: string) {
    const f = parseFormations(formationsXml);
    // Carry the formation's DECLARED gender through. It is real data from the
    // catalog (not derived from a position or an index), and it is what lets a
    // synthesised board -- one jumped to with setFormation rather than danced to --
    // gate gender-specific calls correctly. Without it a board had to invent a
    // gender, first a hard-coded 'boy' (which wrongly rejected e.g. Circle Left from
    // a Circle board) and then 'phantom' (which gates nothing at all).
    const base = [...f.entries()].map(([name, ds]) => ({
      name,
      dancers: ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })),
    }));
    // Mirror 4-dancer (half-group) named formations to 8 so an 8-dancer board
    // can be recognized against them (e.g. Squared Set, Normal Lines). The mirror is
    // the same authored dancers rotated 180 degrees, so it keeps their genders.
    for (const fm of base) {
      if (fm.dancers.length === 8) {
        this.namedFormations.push(fm);
      } else if (fm.dancers.length === 4) {
        const mirror = fm.dancers.map((d) => ({ x: -d.x, y: -d.y, heading: normAngle(d.heading + Math.PI), gender: d.gender }));
        const merged = fm.dancers.concat(mirror);
        if (!merged.some((a) => merged.some((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 0.01))) {
          this.namedFormations.push({ name: fm.name, dancers: merged });
        }
      }
    }
    // Collapse the many differently-named formations that share an identical
    // dancer geometry (positions AND headings, up to rotation/reflection) into
    // one representative per unique shape. Snapping and known-formation checks
    // only need the geometry, not the display label.
    for (const fm of this.namedFormations) {
      const dup = this.uniqueFormations.find((u) => matchFormations(u.dancers, fm.dancers, 0.5) !== null);
      if (dup) continue;
      this.uniqueFormations.push(fm);
    }
  }

  // ---- registration ----

  register(name: string, xml: string): void {
    this.variants.set(canonicalName(name), this.loadVariants(xml));
  }

  registerModule(name: string, calls: (string | CallStep)[]): void {
    const norm = (c: string | CallStep): string | CallStep => {
      if (typeof c === 'string') return canonicalName(c);
      return { ...(c.selection ? { selection: c.selection } : {}), call: canonicalName(c.call) };
    };
    this.modules.set(canonicalName(name), calls.map(norm));
  }

  listModules(): string[] {
    return [...this.modules.keys()];
  }

  isModule(name: string): boolean {
    const canonical = canonicalName(name);
    return this.modules.has(canonical) || CURATED_MODULE_CALLS.includes(canonical);
  }

  /** Whether a call is non-compositional (not the sum of its parts; may depend on
   * remembered turn direction). Such calls cannot be collapsed into a matrix. */
  isNonCompositional(name: string): boolean {
    return NON_COMPOSITIONAL_CALLS.includes(canonicalName(name));
  }

  getModules(): Module[] {
    return [...this.modules.entries()].map(([name, calls]) => ({ name, calls }));
  }

  // ---- read accessors ----

  hasCall(name: string): boolean {
    return this.variants.has(canonicalName(name));
  }

  callNames(): IterableIterator<string> {
    return this.variants.keys();
  }

  /** Every authored variant of a call — the DEMONSTRATIONS included. This is the
   * listing surface (the call picker, `variantStarts`, the editor's setup list), so it
   * must not drop `sequencer="no"` variants or they would vanish from the UI. */
  getVariants(name: string): CallBundle[] | undefined {
    return this.variants.get(canonicalName(name));
  }

  /** The variants the sequencer may MATCH from a board.
   *
   * NOTE — this deliberately returns EVERY authored variant, `sequencer="no"` ones
   * included. Filtering them out was tried and MEASURED as a change for the worse, so the
   * question is left open rather than settled by preference. See `sequencerVariants` and
   * `hasSequencerSetup` below for the reporting queries, and the measurement in
   * `square-dancing.md` §9.1 step 4d.
   *
   * Why it looked like the right filter: Taminations defines four values of the `sequencer`
   * attribute (`perimeter`, `exact`, `gender-specific`, `no` — `animated_call.dart:157-168`)
   * and its own sequencer skips the `no` case outright when it looks for a setup
   * (`lib/sequencer/calls/xml_call.dart:57-59`). The engine read only `gender-specific`, so
   * `no` variants registered as ordinary setups. On the published assets that is 271 `no`
   * variants across 61 titles, 32 of them with no eligible variant at all, concentrated in
   * the families the get-out corpus is stuck on. `Boys Trade` carries 24 variants — 12
   * eligible in `b2/trade.xml`, all `gender-specific`, and 12 `sequencer="no"` in
   * `ms/trade.xml` — with IDENTICAL `from` strings, and least-error matching picked a demo
   * at `error=0.000` on the Ocean Waves template and on the corpus's `[W1p]` board.
   *
   * Why it is NOT the fix, measured both ways:
   *
   *   - STRICT (skip every `sequencer="no"` variant): the published promenade get-outs that
   *     resolve fall 12 -> 8 (`promenade.mjs` §5 fails), and corpus success falls 53 -> 52.
   *     The losses are the `B-Run` bodies, because Taminations marks `Run` not-for-sequencer
   *     precisely BECAUSE it implements Run in code (`calls/ms/run.dart`) — so removing the
   *     tams without writing the derived call removes the capability, it does not correct
   *     the motion.
   *   - NARROW (prefer eligible, fall back where a call has none): still 12 -> 11 resolves.
   *     And the two copies are NOT distinguishable by geometry or timing — for all 12 of
   *     `Boys Trade`'s `from` strings the eligible and the demo copy have identical start
   *     geometry AND identical beat counts — so the tie is real and least-error cannot
   *     break it on the setup alone.
   *
   * So neither variant of the filter is a strict improvement, and `promenade.mjs` §5 is the
   * gate that says so. The next move is the one the reference took: implement the calls
   * Taminations implements in code (Run, Fold, Cast Off 3/4, Turn Back, Cross Run), which is
   * what makes the demonstration tams unnecessary in the first place — see `PLAN.md`
   * Phase 4. */
  matchableVariants(name: string): CallBundle[] {
    return this.variants.get(canonicalName(name)) ?? [];
  }

  /** Strictly the `sequencer`-eligible variants — empty for a call whose only authored
   * setups are demonstration animations, which is a real catalogue gap rather than a
   * matching failure: Taminations calls such a call from CODE instead of from a `<tam>`
   * (`calls/ms/run.dart`, `fold.dart`, `cast_off_three_quarters.dart`, `turn_back.dart`,
   * `trade.dart`, `cross_run.dart`), which is exactly why their tams are marked
   * not-for-sequencer. This query exists so that gap can be REPORTED (and counted in a
   * gate) without changing what matching does until the derived calls land. */
  sequencerVariants(name: string): CallBundle[] {
    return (this.variants.get(canonicalName(name)) ?? []).filter((v) => v.forSequencer);
  }

  /** Whether a call has any sequencer-eligible setup. */
  hasSequencerSetup(name: string): boolean {
    return this.sequencerVariants(name).length > 0;
  }

  moduleNames(): IterableIterator<string> {
    return this.modules.keys();
  }

  hasModule(name: string): boolean {
    return this.modules.has(canonicalName(name));
  }

  getModule(name: string): (string | CallStep)[] | undefined {
    return this.modules.get(canonicalName(name));
  }

  getNamedFormations(): { name: string; dancers: Matchable[] }[] {
    return this.namedFormations;
  }

  getUniqueFormations(): { name: string; dancers: Matchable[] }[] {
    return this.uniqueFormations;
  }

  /** Flatten a sequence, expanding user-defined modules (cycle-guarded). Returns
   * the flattened call steps, preserving any dancer selection. */
  flatten(sequence: (string | CallStep)[]): (string | CallStep)[] {
    const out: (string | CallStep)[] = [];
    const expand = (names: (string | CallStep)[], stack: string[]): void => {
      for (const raw of names) {
        const hasSelection = typeof raw !== 'string' && !!raw.selection;
        const name = typeof raw === 'string' ? raw : raw.call;
        const canonical = canonicalName(name);
        if (this.modules.has(canonical)) {
          if (stack.includes(canonical)) continue; // cycle guard
          expand(this.modules.get(canonical)!, [...stack, canonical]);
        } else if (hasSelection) {
          // Only wrap a step in a CallStep object when it carries a dancer
          // selection; a plain call stays a plain string so downstream
          // consumers (poc history, module serialization) see call names.
          out.push({ selection: raw.selection, call: canonical });
        } else {
          out.push(canonical);
        }
      }
    };
    expand(sequence, []);
    return out;
  }

  // ---- variant building ----

  private loadVariants(callXml: string): CallBundle[] {
    const moves = parseMoves(this.movesXml);
    const formations = parseFormations(this.formationsXml);
    const tams = parseCallXml(callXml);
    // Stamp each 8-dancer setup with its home identity so matching can preserve
    // home couples (keeping "Heads X"/"Sides X" on the original heads/sides).
    return tams.map((tam) => {
      const call = buildCall(tam, formations, moves, true);
      return { ...call, dancers: assignHomeIdentity(call.dancers) };
    });
  }

  /** A variant dancer's matchable position. Mirrored (duplicate-half) dancers
   * store the base x/y but the mirror is applied at pose time, so apply the
   * 180-degree rotation here for matching. */
  variantMatchable(d: CallBundle['dancers'][number]): Matchable {
    if (d.mirror) {
      return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI), gender: d.gender, couple: d.couple };
    }
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender, couple: d.couple };
  }

  /** Every call variant's start setup as mirror-aware matchables. This includes
   * the many EMBEDDED (inline) formations authored inside <tam> blocks that are
   * not in the named-formation catalog. Used to build the full FSM state set. */
  allVariantSetups(): Matchable[][] {
    const out: Matchable[][] = [];
    for (const variants of this.variants.values()) {
      for (const v of variants) {
        out.push(v.dancers.map((d) => this.variantMatchable(d)));
      }
    }
    return out;
  }
}
