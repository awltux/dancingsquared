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
import type { CallBundle, Gender } from '../types.js';

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

/**
 * A formation's dancers AS THE WHOLE SET - because a formation entry is only ever HALF of one.
 *
 * The corpus authors a named formation as the four dancers of a half-group (only `Squared Set` and the
 * eight-dancer handful carry eight), and a board is eight. So a four-dancer entry REPRESENTS eight dancers and
 * is stored as those eight: the authored half, plus the same dancers rotated 180 degrees about the origin, which
 * keeps their genders.
 *
 * ONE PLACE, because it is the same rule for the corpus and for a caller's own formation - and having it in two
 * places is what let `registerFormation` keep a four-dancer shape that no eight-dancer board could ever match
 * (and that the dedupe then discarded anyway, by matching it as a SUBSET of an eight-dancer one).
 *
 * A shape that already CONTAINS its own antipodes is a whole set however few dancers it lists, and is left alone.
 */
function toWholeSet(dancers: Matchable[]): Matchable[] {
  if (dancers.length !== 4) return dancers;
  const mirror = dancers.map((d) => ({ x: -d.x, y: -d.y, heading: normAngle(d.heading + Math.PI), gender: d.gender }));
  const merged = dancers.concat(mirror);
  if (merged.some((a) => merged.some((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 0.01))) return dancers;
  return merged;
}
export class CallLibrary {
  private readonly variants: Map<string, CallBundle[]> = new Map();
  private readonly modules: Map<string, (string | CallStep)[]> = new Map(); // module name -> call steps
  private readonly namedFormations: { name: string; dancers: Matchable[] }[] = [];
  private readonly uniqueFormations: { name: string; dancers: Matchable[] }[] = [];
  /** Names added by `registerFormation` rather than read from `formations.xml`. See its note. */
  private readonly userFormations = new Set<string>();
  /** The AUTHORED shapes of those names, for resolving a `formation="Name"` reference. Held in the
   *  format's own degrees and unmapped, exactly as `formations.xml` would carry them. */
  private readonly referenceShapes: { name: string; dancers: { gender: Gender; x: number; y: number; angleDeg: number }[] }[] = [];
  /** The formation map the call parser reads: the corpus plus `referenceShapes`. Lazy, and dropped
   *  whenever `registerFormation` adds one. */
  private callFormations?: Map<string, { gender: Gender; x: number; y: number; angleDeg: number }[]>;
  /** Variants that could not be built, and why. See `loadVariants` for why this is COLLECTED
   * instead of thrown. */
  private readonly failures: { call: string; reason: string }[] = [];
  /** Lazy caches for the two XML documents every call build needs. See `loadVariants`. */
  private parsedMoves?: ReturnType<typeof parseMoves>;

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
    // HALF A SET IS A WHOLE ONE HERE. A named formation is authored as the four dancers of a half-group, so it
    // represents eight and is stored as eight, which is the size a board is. See `toWholeSet`.
    for (const fm of base) {
      const whole = toWholeSet(fm.dancers);
      if (whole.length === fm.dancers.length && fm.dancers.length !== 8) continue;
      this.namedFormations.push({ name: fm.name, dancers: whole });
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
    const variants = this.loadVariants(xml);
    // A call with NO buildable variant is left unregistered, so the applicator still reports
    // `Unknown call: X` rather than `No setup in this call matches` - the same symptom the old
    // all-or-nothing throw produced. The difference is that it is now visible in
    // `registrationFailures()`. A PARTIALLY buildable call IS registered, which is the fix: it
    // becomes usable from the setups that do resolve.
    if (variants.length) this.variants.set(canonicalName(name), variants);
  }

  registerModule(name: string, calls: (string | CallStep)[]): void {
    const norm = (c: string | CallStep): string | CallStep => {
      if (typeof c === 'string') return canonicalName(c);
      return { ...(c.selection ? { selection: c.selection } : {}), call: canonicalName(c.call) };
    };
    this.modules.set(canonicalName(name), calls.map(norm));
  }

  /**
   * Add a USER-DEFINED named formation to the recognition registry.
   *
   * A board the library cannot name is a real dead end for a caller - the engine will not say
   * what formation the dancers are in, so the FSM has no state for it and no call can be checked
   * against it. Labelling one is how that dead end gets closed, and it has to reach BOTH lists:
   * `uniqueFormations` is what `knownFormation` and the snap scan over, and `namedFormations` is
   * what `matchesNamed`/`recognize` read.
   *
   * IT IS TAGGED. `userFormations` keeps the names, so a name that came from a person rather than
   * from `formations.xml` is reportable and removable - and so the two can never be confused in a
   * list. Nothing else about recognition changes: a registered formation is matched by the same
   * geometry as any other, and a board that already matched something closer keeps that answer.
   *
   * The same geometry-dedupe the constructor applies is applied here, so registering a shape the
   * corpus already carries adds the NAME (which is useful - it is the label the caller wants) but
   * not a second copy of the geometry.
   */
  registerFormation(name: string, dancers: Matchable[]): void {
    const canonical = canonicalName(name);
    // A CALLER'S HALF-GROUP IS A WHOLE SET TOO, by the same rule the corpus is read with. Keeping it at four
    // would file it in a size nothing is ever matched at - and the dedupe below would then discard it anyway,
    // because an eight-dancer shape SUBSET-matches a four-dancer one whenever four of its dancers sit that way.
    // MEASURED, against the real library: a four-dancer shape matched `Circle`, nothing of that size was added,
    // and `knownFormation` answered null for the board it came from.
    const fm = { name: canonical, dancers: toWholeSet(dancers.map((d) => ({ ...d }))) };
    if (!this.namedFormations.some((x) => x.name === canonical)) this.namedFormations.push(fm);
    // SAME SIZE, OR IT IS NOT THE SAME SHAPE. matchFormations does SUBSET matching when the source is longer
    // than the target, so an eight-dancer library shape matches a four-dancer one whenever four of its dancers
    // happen to sit in that pattern - and the dedupe then drops the geometry that was being registered. MEASURED
    // against the real library, which holds 210 formations and EVERY ONE OF THEM OF SIZE 8 (the corpus's
    // four-dancer shapes are mirrored to eight at construction): registering a four-dancer shape matched
    // Circle, so nothing of that size was added, and a four-dancer board could never be named again - which is
    // what knownFormation returning null for it meant. Registering is how a caller closes the 	he engine
    // cannot say what formation this is dead end, so losing it silently is the worst version of this bug.
    if (!this.uniqueFormations.some((u) => matchFormations(u.dancers, fm.dancers, 0.5) !== null)) {
      this.uniqueFormations.push(fm);
    }
    this.userFormations.add(canonical);
    // AND IT BECOMES REFERENCEABLE BY A CALL. A `<tam>` names its start formation with
    // `formation="Name"` and carries no geometry, and until now only the CORPUS could be named that
    // way - `loadVariants` parsed `formations.xml` and nothing else - so a call starting from a
    // formation a CALLER labelled could not be authored as a reference at all. The authored shape is
    // kept here (in the format's own degrees, unmapped and unmirrored, exactly as `formations.xml`
    // would carry it) and merged into the map the call parser reads.
    if (!this.referenceShapes.some((x) => x.name === canonical)) {
      this.referenceShapes.push({
        name: canonical,
        dancers: dancers.map((d) => ({ x: d.x, y: d.y, angleDeg: d.heading / DEG, gender: d.gender ?? 'phantom' })),
      });
    }
    // The parse caches were built without it, so the next registration of a call resolves it.
    this.callFormations = undefined;
  }

  /** The formations a `formation="Name"` reference can resolve to: the corpus, plus what
   *  `registerFormation` has added. See `registerFormation` for why the authored shape is kept. */
  private callFormationMap(): Map<string, { gender: Gender; x: number; y: number; angleDeg: number }[]> {
    if (!this.callFormations) {
      const m = parseFormations(this.formationsXml);
      // THE CORPUS WINS A NAME COLLISION: registering a shape under a corpus name is a relabel, and a
      // reference to that name must mean what the corpus means by it.
      for (const f of this.referenceShapes) if (!m.has(f.name)) m.set(f.name, f.dancers);
      this.callFormations = m;
    }
    return this.callFormations;
  }

  /** The user-defined formation names, in registration order. */
  listUserFormations(): string[] {
    return [...this.userFormations];
  }

  /** Whether a name came from a user rather than from `formations.xml`. */
  isUserFormation(name: string): boolean {
    return this.userFormations.has(canonicalName(name));
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

  /**
   * Build every `<tam>` of one call, INDEPENDENTLY.
   *
   * WHY PER-TAM AND NOT ALL-OR-NOTHING. This used to be a plain `.map()`, so the first tam whose
   * data would not build threw out of `register`, and `Sequencer`'s constructor swallowed it - the
   * whole call then simply did not exist. Measured on the shipped catalogue, that lost exactly two
   * real Mainstream calls, `Ferris Wheel` (nine tams) and `Couples Circulate`, because ONE
   * `from="T-Bone Couples"` among their tams names a formation that is not in `formations.xml`
   * (upstream has no such formation either - it is an inherited data inconsistency). A single bad
   * attribute erased eight good tams.
   *
   * So a bad tam now costs only that tam. The call stays usable from the setups that do resolve,
   * and every skip is RECORDED in `failures` rather than thrown into a bare `catch`, because a
   * silent loss surfaces much later as `Unknown call: ...` - the most misleading possible symptom.
   */
  private loadVariants(callXml: string): CallBundle[] {
    // Parsed ONCE, not once per call. These used to be re-parsed inside this method, which meant
    // parsing all of `moves.xml` and `formations.xml` 2211 times to build the shipped catalogue -
    // measured at 32s of a 55s fast verify tier. The parse is pure, so caching it is free.
    const moves = (this.parsedMoves ??= parseMoves(this.movesXml));
    const formations = this.callFormationMap();
    const tams = parseCallXml(callXml);
    const out: CallBundle[] = [];
    for (const tam of tams) {
      try {
        const call = buildCall(tam, formations, moves, true);
        // Stamp each 8-dancer setup with its home identity so matching can preserve
        // home couples (keeping "Heads X"/"Sides X" on the original heads/sides).
        out.push({ ...call, dancers: assignHomeIdentity(call.dancers) });
      } catch (e) {
        this.failures.push({ call: tam.title, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  /** Every variant that failed to build, as `{ call, reason }`, in registration order.
   *
   * This is a DIAGNOSTIC surface, and it is deliberately not empty: the shipped catalogue has
   * tams naming formations it does not ship. A harness asserts the set equals the known list, so
   * a NEW silent loss fails the build instead of quietly shrinking the engine. */
  registrationFailures(): { call: string; reason: string }[] {
    return [...this.failures];
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
