// CallLibrary: owns the registered call variants, user-defined modules, and the
// parsed formation registry used for recognition/snapping. This is the data
// layer of the sequencer — it holds no board state and performs no geometry
// transforms itself, so callers depend on a narrow read-only surface.

import { DEG } from '../core.js';
import { buildCall, parseCallXml, parseFormations, parseMoves } from '../convert.js';
import { matchFormations, type Matchable } from './match.js';
import { assignHomeIdentity, normAngle } from './identity.js';
import { canonicalName } from './constants.js';
import type { Module } from './types.js';
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
  private readonly modules: Map<string, string[]> = new Map(); // module name -> call names
  private readonly namedFormations: { name: string; dancers: Matchable[] }[] = [];
  private readonly uniqueFormations: { name: string; dancers: Matchable[] }[] = [];

  constructor(private readonly movesXml: string, private readonly formationsXml: string) {
    const f = parseFormations(formationsXml);
    const base = [...f.entries()].map(([name, ds]) => ({
      name,
      dancers: ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG })),
    }));
    // Mirror 4-dancer (half-group) named formations to 8 so an 8-dancer board
    // can be recognized against them (e.g. Squared Set, Normal Lines).
    for (const fm of base) {
      if (fm.dancers.length === 8) {
        this.namedFormations.push(fm);
      } else if (fm.dancers.length === 4) {
        const mirror = fm.dancers.map((d) => ({ x: -d.x, y: -d.y, heading: normAngle(d.heading + Math.PI) }));
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

  registerModule(name: string, calls: string[]): void {
    this.modules.set(canonicalName(name), calls.map((c) => canonicalName(c)));
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

  getVariants(name: string): CallBundle[] | undefined {
    return this.variants.get(canonicalName(name));
  }

  moduleNames(): IterableIterator<string> {
    return this.modules.keys();
  }

  hasModule(name: string): boolean {
    return this.modules.has(canonicalName(name));
  }

  getModule(name: string): string[] | undefined {
    return this.modules.get(canonicalName(name));
  }

  getNamedFormations(): { name: string; dancers: Matchable[] }[] {
    return this.namedFormations;
  }

  getUniqueFormations(): { name: string; dancers: Matchable[] }[] {
    return this.uniqueFormations;
  }

  /** Flatten a sequence, expanding user-defined modules (cycle-guarded). */
  flatten(sequence: string[]): string[] {
    const out: string[] = [];
    const expand = (names: string[], stack: string[]): void => {
      for (const n of names) {
        const canonical = canonicalName(n);
        if (this.modules.has(canonical)) {
          if (stack.includes(canonical)) continue; // cycle guard
          expand(this.modules.get(canonical)!, [...stack, canonical]);
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
}
