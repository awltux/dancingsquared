// CallLibrary: owns the registered call variants, user-defined modules, and the
// parsed formation registry used for recognition/snapping. This is the data
// layer of the sequencer — it holds no board state and performs no geometry
// transforms itself, so callers depend on a narrow read-only surface.

import { DEG } from '../core.js';
import { buildCall, parseCallXml, parseFormations, parseMoves } from '../convert.js';
import { matchFormations, type Matchable } from './match.js';
import { assignHomeIdentity } from './identity.js';
import { normAngle } from '../moves.js';
import { canonicalName } from './constants.js';
import type { Module, ModuleStep } from './types.js';
import { groupCalls, isGroupStep } from './types.js';
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
  // FOUR DOUBLES TO EIGHT, AND TWO DOES NOT - and the boundary is deliberate rather than an oversight. The rule
  // is that a formation is half the set it represents, so TWO DOUBLES TO FOUR as well ("2 dancers in xml is
  // displayed as 4 dancers, 4 dancers in xml is displayed as 8 dancers"). Doing that here alone turns
  // `listFormations()` from 134 names into 164, THIRTY OF THEM FOUR-DANCER BOARDS - and the sequencer's own
  // formation picker adds every name it is given with no size filter, into a board that is always eight. So the
  // two-dancer case belongs with that picker's guard, in its own change, not bolted on here.
  if (dancers.length !== 4) return dancers;
  const mirror = dancers.map((d) => ({ x: -d.x, y: -d.y, heading: normAngle(d.heading + Math.PI), gender: d.gender }));
  const merged = dancers.concat(mirror);
  if (merged.some((a) => merged.some((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 0.01))) return dancers;
  return merged;
}

/**
 * The IDENTITY of one authored setup: `(from, formation)` PLUS the whole built bundle.
 *
 * THE IDENTITY PART ANSWERS THE REPORTED QUESTION. That pair is the format's own identity for a
 * setup, and keying by it is what stops two authorings of one call from being confused - the title
 * alone cannot tell `Facing Dancers Far` from `Facing Dancers`.
 *
 * THE WHOLE BUNDLE IS WHAT MAKES THE MERGE SAFE. Deduping on identity alone was MEASURED WRONG on
 * the shipped corpus: `test/tools/_merge-equivalence.mjs` registers every title two ways (one call
 * carrying all its tams, and one call per tam) and compares the results. Keyed on identity, **209
 * titles lost a variant** - `Centers Cross Kick Off` went from 12 to 6, `Drop Right` from 4 to 2 -
 * because those titles author the SAME setup TWICE with DIFFERENT MOVEMENT, and the two are not
 * duplicates at all: a call can legitimately have two ways of dancing the same start, and picking
 * between them is the matcher's job, not this function's. So the path is part of the identity too,
 * and only a bundle that is identical in EVERY respect collapses.
 *
 * ONE CONSEQUENCE, DELIBERATE. Re-registering the identical tam is a no-op (pinned by
 * `test/scircle-register.mjs`), but the same SETUP authored twice with different movement is kept
 * twice - which is the same thing the one-call path already did, so the merge matches it exactly.
 */
function variantIdentity(v: CallBundle): string {
  const setup = v.dancers
    .map((d) => {
      // THE SAME MIRROR-AWARE POSITION THE MATCHER USES, not the stored one: a mirrored
      // (duplicate-half) dancer keeps the base `x`/`y` and has the 180-degree rotation applied at
      // pose time, so two setups that differ only in where their duplicate half sits would look
      // identical if this read `d.x`/`d.y` directly. See `variantMatchable`, this rule's other reader.
      const p = d.mirror
        ? { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI) }
        : { x: d.x, y: d.y, heading: normAngle(d.angleDeg * DEG) };
      return `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.heading.toFixed(4)}${d.gender ? ',' + d.gender : ''}`;
    })
    .join('|');
  return `${v.from ?? ''}\u0001${v.formation ?? ''}\u0001${setup}\u0001${canonicalJson(v)}`;
}

/**
 * A canonical JSON rendering of a built bundle, with object keys sorted at every depth.
 *
 * The point is not readability - it is that two bundles built from the identical `<tam>` serialize
 * identically whatever order their fields were constructed in, so the dedupe compares CONTENT rather
 * than object identity. `dancer.path` holds the move objects, which is where the movement lives.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class CallLibrary {
  private readonly variants: Map<string, CallBundle[]> = new Map();
  private readonly modules: Map<string, Module> = new Map(); // module name -> steps AND the boards it was written between
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
    this.registerScoped(name, xml, null);
  }

  /**
   * Register a call FROM A DOCUMENT, taking ONLY the tams that carry `name` as their title.
   *
   * WHY THIS EXISTS. A title is the call's identity and a document is a FAMILY of calls, so `register`
   * registering every tam in the document under the caller's name made one call's variant set the whole file's.
   * MEASURED: registering `circle.xml` under a single name gave that name all 124 of its tams, so `Boys Trade`
   * matched `Partner Trade`'s and `Couples Trade`'s authorings from `trade.xml`. The census that says the split
   * is a gain with nothing lost: over the 138 named formations and Mainstream only, file-keyed registration
   * (62 names) is legal 1791 times and title-keyed (322 names) 4960 times, with **0 formations losing one**.
   *
   * IT IS A SECOND ENTRY POINT RATHER THAN A CHANGED DEFAULT, deliberately: `register`'s whole-document
   * behaviour is what the POC, the probes and two harnesses whose SUBJECT is that keying rely on, and a
   * breaking default would have to re-pin them in the same commit. The grouping rule now lives here, in the
   * module that owns the variant model, and a caller adopts it by name.
   */
  registerByTitle(name: string, xml: string): void {
    this.registerScoped(name, xml, canonicalName(name));
  }

  private registerScoped(name: string, xml: string, onlyTitle: string | null): void {
    const variants = this.loadVariants(xml, onlyTitle);
    // A call with NO buildable variant is left unregistered, so the applicator still reports
    // `Unknown call: X` rather than `No setup in this call matches` - the same symptom the old
    // all-or-nothing throw produced. The difference is that it is now visible in
    // `registrationFailures()`. A PARTIALLY buildable call IS registered, which is the fix: it
    // becomes usable from the setups that do resolve.
    if (variants.length === 0) return;
    // MERGE, NEVER REPLACE. This was `variants.set(canonicalName(name), variants)`, which stores the
    // keyed TITLE alone and therefore silently discards every setup the previous registration for
    // that title contributed. A second `register` for a title is not a correction of the first, it is
    // another AUTHORING of the same call, and the format's identity for a setup is
    // `(title, formation xor from)` - exactly the part a title-only key throws away.
    //
    // IT IS NOT HYPOTHETICAL FOR THE CALLER EITHER. One `register` call can carry several setups,
    // because that is what `loadVariants` returns and what `poc/src/data.ts` `sequencerCallsUpTo`
    // pools a title's tams into - but that makes keeping them all the CALLER's responsibility, and
    // `Sequencer.register` is a public method reachable more than once for one title (`sequencer-ui.ts`
    // calls it from two places, and never clears the library in between). MEASURED, and pinned by
    // `test/scircle-register.mjs`: with `Single Circle Left Full` authored twice,
    // `register(far); register(plain)` left ONE variant ("Facing Dancers") where two authorings exist.
    //
    // The key stays the title, because that is what every reader (`matchableVariants`,
    // `sequencerVariants`, `hasCall`) looks up by. What changes is that the VALUE is appended to
    // rather than overwritten, with a per-setting dedupe so re-registering the same tam is a no-op
    // and cannot inflate the variant list.
    const key = canonicalName(name);
    const kept = this.variants.get(key);
    if (!kept) {
      // A COPY, not the caller's array: `loadVariants` builds a fresh one today, but holding a
      // reference the caller could still mutate is the kind of coupling this library has been bitten
      // by before (see `toWholeSet`).
      this.variants.set(key, variants.slice());
      return;
    }
    const seen = new Set(kept.map((v) => variantIdentity(v)));
    const added: CallBundle[] = [];
    for (const v of variants) {
      const id = variantIdentity(v);
      if (seen.has(id)) continue;
      seen.add(id);
      added.push(v);
    }
    if (added.length) this.variants.set(key, kept.concat(added));
  }

  /**
   * Register a module: its steps, and optionally the two boards it was written between.
   *
   * THE BOARDS ARE OPTIONAL AND A MODULE WITHOUT A START KEEPS THE OLD BEHAVIOUR. `start` is the module's answer to
   * "where does this begin", and `legality.ts` refuses to offer the module from any other board - which is what a call
   * gets from its `<tam>` start, and what 168 of the 294 corpus modules were missing. `end` is carried as data (the
   * replay stays authoritative) so a consumer can ask what may follow the module.
   *
   * A `start` is stored AS GIVEN, in the tolerant-matching form: it is geometry, not a name, so nothing has to resolve a
   * formation label, and the comparison is `matchFormations` - the same one a call's setup match uses.
   */
  registerModule(name: string, calls: ModuleStep[], boards: { start?: readonly Matchable[]; end?: readonly Matchable[] } = {}): void {
    const key = canonicalName(name);
    // A MODULE MAY NOT TAKE A CALL'S NAME. `flatten` resolves a name to a MODULE BEFORE a call, so
    // registering one under a call's title makes the title mean the module's contents everywhere a
    // sequence is flattened - `flatten(['Single File Promenade to Home'])` returned the module's steps
    // rather than the call. MEASURED, on a module of that name whose content is `Pass Thru`:
    // `flatten` returned `["Pass Thru"]`, and the call's own name no longer reached its variants at all.
    // And when the module CONTAINED its own name the cycle guard dropped it, so `flatten` returned `[]`
    // and the call became UNAPPLIABLE rather than merely shadowed. `legalWithResults` then dropped the
    // name from both of its loops - it is in `callNames()` and in `moduleNames()` - so the title
    // disappeared from the picker's call list AND from its module list at once, and `restoreModules`
    // brought the damage back on every reload.
    //
    // REFUSED RATHER THAN RESOLVED IN FAVOUR OF THE CALL, which is the other defensible rule. Preferring
    // the call would make the module unreachable - nothing could ever invoke it - so the caller's saved
    // sequence would be silently unusable, which is the same class of silent loss from the other side.
    // Throwing is the only outcome that discards nothing and tells the caller which name is the problem.
    if (this.variants.has(key)) {
      throw new Error(
        `"${name}" is already a call, so it cannot also be a module. A module takes its name over, so every use of that name would mean the module instead of the call - give the module a name of its own.`,
      );
    }
    const norm = (c: ModuleStep): ModuleStep => {
      if (typeof c === 'string') return canonicalName(c);
      if (isGroupStep(c)) return { groups: c.groups.map((g) => ({ selection: g.selection, calls: groupCalls(g).map(canonicalName) })) };
      return { ...(c.selection ? { selection: c.selection } : {}), call: canonicalName(c.call) };
    };
    // THE BOARDS ARE COPIED, like the calls: a caller that keeps editing the array it passed must not be able to change
    // what a registered module starts from without re-registering it.
    const module: Module = { name: key, calls: calls.map(norm) };
    if (boards.start && boards.start.length) module.start = boards.start.map((d) => ({ ...d }));
    if (boards.end && boards.end.length) module.end = boards.end.map((d) => ({ ...d }));
    this.modules.set(key, module);
  }

  /**
   * TAKE A USER-DEFINED MODULE OUT AGAIN - the exact inverse of `registerModule`, on the same map.
   *
   * WHY AN EXPLICIT REMOVAL RATHER THAN A REBUILD. Dropping a registration by rebuilding the library is
   * what the panel already does on a level change (`sequencer-ui.ts` `rebuildSeq`), and that path is
   * unusable for deleting ONE saved module: it also clears the caller's history and resets the board, so
   * tidying up a saved sequence would throw away the sequence being worked on. This is a `delete` and
   * nothing else, and it is keyed CANONICALLY, so the name that removes a module is the name it was
   * registered under however either side spelled it.
   *
   * IT ONLY EVER TOUCHES USER MODULES. `isModule` answers true for the CURATED set as well, and those
   * ship with the engine: a curated name unregisters nothing, which is the right answer rather than a
   * silent hole in the shipped catalogue.
   */
  unregisterModule(name: string): void {
    this.modules.delete(canonicalName(name));
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
    return [...this.modules.values()];
  }

  /**
   * The board a module declared as its START, or null when it declared none.
   *
   * NULL IS NOT HOME. A module with no declaration keeps the pre-existing rule - its own first step decides, through the
   * applicator - where a declared start is a GEOMETRIC GATE. The two answers differ, so `legality.ts` reads this null
   * and skips the gate rather than comparing the board to the home square.
   */
  moduleStart(name: string): Matchable[] | null {
    return this.modules.get(canonicalName(name))?.start ?? null;
  }

  /** The board a module declared as its END, or null when it declared none. The replay stays authoritative: this is
   *  what a consumer asks "what may follow it" from, and a disagreement is reported rather than obeyed. */
  moduleEnd(name: string): Matchable[] | null {
    return this.modules.get(canonicalName(name))?.end ?? null;
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
   * eligible in `ms/trade.xml`, all `gender-specific`, and 12 `sequencer="no"` in
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

  /**
   * The variant a stored `vid` names, with its call title - or null when this library does not hold it.
   *
   * THE INVERSE OF `callVariantId`, AND IT IS A SEARCH RATHER THAN A DECODE. The id is a digest of (level, title,
   * start definition's `fid`), and a digest cannot be read back; but the corpus wrote the tag onto every tam, the
   * bundle carries it (`CallBundle.vid`), so the answer is "the registered variant whose own tag is this one". The
   * LEVEL is the half the bundle does not know (the library pools a title's tams across levels) - which is exactly
   * why the tag is carried rather than minted here.
   *
   * NULL IS THE HONEST ANSWER, and the caller decides: a sequence document that names a `vid` this library cannot
   * resolve falls back to the call's name, and a document that names only the id is refused by number. A scan over
   * every registered variant is ~30k comparisons once per import, not per step, because callers cache the answer.
   */
  variantByVid(vid: string): { title: string; variant: CallBundle } | null {
    const want = vid.trim().toLowerCase();
    if (want === '') return null;
    for (const [name, variants] of this.variants) {
      for (const variant of variants) {
        if (variant.vid !== null && variant.vid.toLowerCase() === want) return { title: name, variant };
      }
    }
    return null;
  }

  moduleNames(): IterableIterator<string> {
    return this.modules.keys();
  }

  hasModule(name: string): boolean {
    return this.modules.has(canonicalName(name));
  }

  getModule(name: string): ModuleStep[] | undefined {
    return this.modules.get(canonicalName(name))?.calls;
  }

  getNamedFormations(): { name: string; dancers: Matchable[] }[] {
    return this.namedFormations;
  }

  getUniqueFormations(): { name: string; dancers: Matchable[] }[] {
    return this.uniqueFormations;
  }

  /**
   * The named formations the REGISTERED CALLS actually start from, deduped by geometry the same way
   * `uniqueFormations` is. This is the LEVEL-SCOPED counterpart of `getUniqueFormations()`.
   *
   * WHY THE TWO DIFFER, and why both are needed. `getUniqueFormations()` is the whole of
   * `formations.xml`, so it answers "what is this board called" - a question about the corpus, and the
   * right vocabulary for `knownFormation` and `recognize`, which should name any board they can.
   * This answers "which formations may a call of THIS programme be used from" - a question about the
   * call set, and the right vocabulary for the FSM's STATE SET, because a state is a formation the
   * caller can be standing in and a programme only lets a caller stand where its own calls begin.
   *
   * MEASURED (Stage 0b). `formations.xml` declares 273 names and 219 of them are referenced by some
   * tam's `formation=`; only **99** are referenced by a tam at or below Mainstream, and only 67 of
   * those survive as whole sets. So the flat list hands the Mainstream FSM **131 named geometries**
   * where its own calls declare **42** - the other 89 are formations no Mainstream call introduces,
   * which is the level leak stated as a number. Deriving the state set from the calls registered is
   * what closes it, and it needs no level concept in the engine: the level IS the call set.
   *
   * THE DEDUPE REPRESENTATIVE IS THE FIRST IN-SCOPE NAME IN `formations.xml` ORDER, matching the
   * constructor's rule, so a state keeps a human-readable name rather than an alias chosen by
   * whatever the reference order happened to be.
   *
   * THE SCOPE IS THE CALL SET **PLUS THE USER'S OWN LABELS** - see `referencedFormationNames` for why
   * the second half is not optional.
   */
  referencedFormations(): { name: string; dancers: Matchable[] }[] {
    const used = this.referencedFormationNames();
    const out: { name: string; dancers: Matchable[] }[] = [];
    for (const fm of this.namedFormations) {
      if (!used.has(fm.name)) continue;
      if (out.some((u) => matchFormations(u.dancers, fm.dancers, 0.5) !== null)) continue;
      out.push(fm);
    }
    return out;
  }

  /**
   * The names `referencedFormations()` is derived from, before the geometry dedupe. The scope, as a
   * set a caller can report or compare without re-deriving it.
   *
   * TWO SOURCES, and the second is not an afterthought. A formation is in scope because a registered
   * call declares it (`formation="Name"`), OR because a PERSON labelled it via `registerFormation`.
   * The second half is load-bearing and was MISSING in the first cut of this method: that method's
   * whole documented purpose is that "the engine will not say what formation the dancers are in, so
   * the FSM has no state for it" is a dead end, and labelling one "is how that dead end gets closed".
   * A scope that took only the calls would have closed the dead end for `knownFormation` and left it
   * open for the FSM - silently, because no gate covered that half. `test/sequencer.mjs` now does.
   *
   * Both sides are compared as written: a corpus `<tam>` writes the name exactly as `formations.xml`
   * declares it, and `registerFormation` canonicalises the name it stores in BOTH lists.
   */
  referencedFormationNames(): Set<string> {
    const used = new Set<string>(this.userFormations);
    for (const variants of this.variants.values()) {
      for (const v of variants) if (v.formation) used.add(v.formation);
    }
    return used;
  }

  /** Flatten a sequence, expanding user-defined modules (cycle-guarded). Returns
   * the flattened module steps, preserving any dancer selection.
   *
   * A GROUPED step is passed through WHOLE, because it is atomic and simultaneous: expanding it into
   * a flat list would silently turn "Centers X while Outsides Y" into "X then Y". Its group calls are
   * canonicalised but NOT module-expanded, for the same reason a group may not name a module at all
   * (`GroupStep`) - and a lane is likewise kept as one group's list rather than flattened into the
   * step list, because the calls in the MIDDLE of a lane start at a board that does not exist
   * sequentially: a lane is simultaneous with the other groups, not with itself. */
  flatten(sequence: ModuleStep[]): ModuleStep[] {
    const out: ModuleStep[] = [];
    const expand = (names: ModuleStep[], stack: string[]): void => {
      for (const raw of names) {
        if (isGroupStep(raw)) {
          out.push({ groups: raw.groups.map((g) => ({ selection: g.selection, calls: groupCalls(g).map(canonicalName) })) });
          continue;
        }
        const hasSelection = typeof raw !== 'string' && !!raw.selection;
        const name = typeof raw === 'string' ? raw : raw.call;
        const canonical = canonicalName(name);
        if (this.modules.has(canonical)) {
          if (stack.includes(canonical)) continue; // cycle guard
          expand(this.modules.get(canonical)!.calls, [...stack, canonical]);
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
  private loadVariants(callXml: string, onlyTitle: string | null = null): CallBundle[] {
    // Parsed ONCE, not once per call. These used to be re-parsed inside this method, which meant
    // parsing all of `moves.xml` and `formations.xml` 2211 times to build the shipped catalogue -
    // measured at 32s of a 55s fast verify tier. The parse is pure, so caching it is free.
    const moves = (this.parsedMoves ??= parseMoves(this.movesXml));
    const formations = this.callFormationMap();
    const tams = parseCallXml(callXml);
    const out: CallBundle[] = [];
    for (const tam of tams) {
      if (onlyTitle !== null && canonicalName(tam.title) !== onlyTitle) continue;
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
    return this.allVariantSetupsWithSource().map((s) => s.dancers);
  }

  /**
   * The same setups, each with the CALL it was authored by: the `<tam>`'s `title` and `from`.
   *
   * WHY THE IDENTITY TRAVELS WITH THE GEOMETRY. An embedded formation is not declared anywhere - it is
   * the start setup of some `<tam>` - so a state built from one has no name to be found by, and the
   * FSM's `@embed#N` key is a COUNT (`stateGeo.size`, the number of states already registered), not an
   * index into this list. So the number is not traceable back to anything, and a caller reading
   * "embedded #44" has no way to learn which call it came from. Carrying the source here is what makes
   * that traceable, and `title`/`from` are the fields the format already uses for a call's identity
   * (the same pair `register` keys on - see `variantIdentity`).
   */
  allVariantSetupsWithSource(): { dancers: Matchable[]; title: string; from: string }[] {
    const out: { dancers: Matchable[]; title: string; from: string }[] = [];
    for (const variants of this.variants.values()) {
      for (const v of variants) {
        out.push({
          dancers: v.dancers.map((d) => this.variantMatchable(d)),
          title: v.title,
          from: v.from,
        });
      }
    }
    return out;
  }
}
