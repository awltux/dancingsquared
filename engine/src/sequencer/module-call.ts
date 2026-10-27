// A MODULE READ AS ONE CALL — the composition, and the refusals that keep it honest.
//
// WHY IT EXISTS. A module is a SEQUENCE: a named list of calls, saved by a caller or translated from the ceder corpus.
// Until this module the engine could only ever hand back the END BOARD of one (`applyToBoard`), so every surface that
// wants a module as a THING — one geometry, one title, one duration, one provenance — had to flatten it into its steps
// and lose the fact that the caller chose a module. The symptom is in the panel: adding a module from the picker used
// to push one history row per inner call, so a seven-call module could only be undone, deleted or moved one call at a
// time. That is the difference between a module and a call, and this closes it.
//
// THE SHAPE IS THE VIRTUAL CALL'S, ONE LEVEL UP. `virtual-call.ts` turns ONE authored variant into a whole-board bundle
// by copying local paths; this turns a CHAIN of them into one bundle the same way. The two share the format's central
// fact and not just the code path: a path is authored in DANCER-LOCAL coordinates (`types.ts`: the origin is the
// dancer's spot when the move begins, +X the facing), so a placement that is a pure ROTATION plus translation leaves
// every local path unchanged — consecutive segments compose by concatenation. Only a REFLECTED placement needs the
// track mirrored, and the format cannot carry that (AGENTS §8 trap 18, MEASURED at 444 of 444 diagonal facings
// unrepresentable), so a reflected step is refused BY NAME rather than approximated. That refusal lives in the
// resolver (`SequenceAnalyzer.moduleTracks`), which is where the match is in hand; this module composes what it is
// given.
//
// WHERE THE DECLARED START COMES FROM, AND WHY IT IS THE REPLAY'S FRAME. At the default `rebaseFactor = 1` the
// applicator snaps each dancer onto the variant's canonical setup slot before applying the local displacement
// (`applicator.ts` `applyWholeBoard`), and the animation does the same (`sequence.ts` `evaluateVariantAt`). A composed
// module is a CHAIN of those snaps, so the pose the chain actually dances from is the first step's REBASED start, not
// the incoming board's pose — `ModuleTracks.start` is therefore supplied by the resolver, already rebased, and the
// composition inherits it verbatim. THE OTHER CONVENTION IN THIS TREE IS `placeVirtual`'s, and it is not a disagreement:
// a placed virtual call declares the board it was placed ON (the authoring is what moved, to the board), where a
// composed module declares where its own first step will put the dancers. The harness pins the consequence that makes
// this the right choice — `poseFor(composed, beats)` lands on the replay's end board, up to the snap residue below.
//
// WHAT IS NOT COMPOSED, refused by name in the resolver rather than here: a "while" figure (several authorings dance at
// once, so there is no single track), a coded move (a derived rule with no authored path), a step that does not apply,
// and a reflected placement.
//
// A COMPOSITION IS THEN JUDGED BY THE REPLAY, which is the independent observable (AGENTS §11.2.3): `Sequencer.moduleCall`
// walks the module's own steps and refuses a bundle whose end it cannot reach. That judge belongs there rather than here,
// because the one discrepancy a verbatim track CANNOT avoid is the applicator's per-call SNAP (`applyWholeBoard` ends in
// `matcher.snapBoard`) — a single continuous path cannot snap itself between its segments, so the composed end is the
// authored chain end and the replay's is the same chain after the snaps. MEASURED over the corpus: 1.64e-3 worst, bounded
// by the same 0.02 the animation gate allows between its last drawn frame and the board (see `MODULE_CONVERGE_TOL`).
// Verbatim local segments therefore cost the reflection limit and that residue, and nothing else.
//
// THE RELAXATION THAT WAS REJECTED: resampling the replay's boards into a track. It reproduces the poses and loses the
// authored curves — every animation in this tree would become straight lines between sampled points, and
// `sampleTrail`-based drawing would be the only thing that noticed.

import { poseFor } from '../core.js';
import { cloneSegs, padSegment } from '../editor.js';
import type { Board } from './types.js';
import type { FormationNamer } from './virtual-call.js';
import type { CallBundle, DancerSpec, Seg } from '../types.js';

/** The local pose a hold is written from: a zero-length segment, which is a hold wherever the dancer stands. */
const AT_REST = { x: 0, y: 0, heading: 0 };

/**
 * ONE STEP OF A MODULE, already resolved onto the board the step starts from.
 *
 * `paths[i]` is what BOARD dancer `i` dances in this step, in their own local frame, or null when the step leaves them
 * standing (a scoped step, or a dancer outside a subset authoring's actives). The resolver supplies it; `null` becomes a
 * hold of the step's own length, so every dancer has one path of the call's length.
 */
export interface ModuleStepTrack {
  /** What a refusal names in the report: the step's own label, selection included. */
  label: string;
  /** The engine's charge for the step (`stepBeats`), so the composition costs what the replay costs. */
  beats: number;
  paths: readonly (readonly Seg[] | null)[];
}

/** A whole module resolved into per-dancer local tracks: the resolver's answer, and this module's only input. */
export interface ModuleTracks {
  /** The world pose each board dancer starts the module from — step 1's REBASED start (see the header), board order. */
  start: readonly { x: number; y: number; heading: number }[];
  steps: readonly ModuleStepTrack[];
}

/**
 * THE COMPOSITION, as this module can see it: the bundle, its own end board, and the reason when it is not one.
 *
 * THE END HERE IS THE BUNDLE'S OWN READING (`poseFor` at its length), which is what the namer is asked about. The public
 * answer is `ModuleCallOutcome`, which carries the REPLAY's board instead — see there.
 */
export type ComposedModule =
  | { legal: true; bundle: CallBundle; end: Board }
  | { legal: false; reason: string; tried: string };

/**
 * THE ANSWER `Sequencer.moduleCall` GIVES: the composition, VERIFIED against the module's own replay, or the refusal.
 *
 * `end` IS THE REPLAY'S BOARD, not the bundle's last pose, because that is the authority the rest of the engine already
 * uses: the applicator snaps every call onto the formation it lands in, and a single continuous path cannot reproduce a
 * per-call snap. The difference is reported as `residue` (the worst dancer, world units) rather than hidden, and it is
 * bounded by `MODULE_CONVERGE_TOL` — the same 0.02 the animation gate allows between its last drawn frame and the board
 * it is drawn against. MEASURED over the corpus: 2.2e-4 worst, so the bound is two orders of magnitude of headroom
 * rather than a fit. `end` is what a caller asks "which calls may follow this module" from.
 */
export type ModuleCallOutcome =
  | { legal: true; bundle: CallBundle; end: Board; residue: number }
  | { legal: false; reason: string; tried: string };

/**
 * Compose a module's resolved tracks into ONE whole-set call.
 *
 * `namer` is the engine's own answer to "is this a formation", injected exactly as `resolveVirtual` injects it: the same
 * test decides whether the module has a start to declare and an end worth reporting, and nothing here invents a name.
 */
export function composeModuleCall(
  board: Board,
  name: string,
  tracks: ModuleTracks,
  namer: FormationNamer,
): ComposedModule {
  const steps = tracks.steps;
  if (steps.length === 0) {
    return { legal: false, reason: `${JSON.stringify(name)} has no steps to compose`, tried: 'its step list' };
  }
  const n = board.dancers.length;
  // A TRACK THAT DOES NOT FIT ITS BOARD IS A PROGRAMMING ERROR, not a board this module cannot dance: the resolver built
  // it from this very board. `placeVirtual` throws on a broken placement for the same reason — a silent pad here would
  // hide an off-by-one and move one dancer's whole track to another dancer.
  if (tracks.start.length !== n) {
    throw new Error(`composeModuleCall: ${tracks.start.length} start poses for a board of ${n}`);
  }
  for (const s of steps) {
    if (s.paths.length !== n) throw new Error(`composeModuleCall: step ${JSON.stringify(s.label)} has ${s.paths.length} tracks for a board of ${n}`);
  }
  const startFormation = namer(board);
  if (startFormation === null) {
    return {
      legal: false,
      reason: `the board is not a formation the engine names, so a module call for ${JSON.stringify(name)} has no start to declare`,
      tried: 'the start board',
    };
  }
  const beats = steps.reduce((sum, s) => sum + s.beats, 0);
  // THE HOLDS ARE BUILT ONCE PER STEP, because a hold is the same zero-length segment for every dancer standing in it —
  // and then CLONED per dancer, because a bundle the caller may edit must not share segment objects with another.
  const holds = steps.map((s) => padSegment(AT_REST, AT_REST, s.beats));
  const dancers: DancerSpec[] = board.dancers.map((d, i) => {
    const path: Seg[] = [];
    for (const [k, s] of steps.entries()) {
      const own = s.paths[i];
      for (const seg of own ? cloneSegs([...own]) : [holds[k]]) path.push(seg);
    }
    const at = tracks.start[i];
    const spec: DancerSpec = { gender: d.gender, x: at.x, y: at.y, angleDeg: (at.heading * 180) / Math.PI, path };
    if (d.id != null) spec.id = d.id;
    if (d.couple != null) spec.couple = d.couple;
    return spec;
  });
  // THE END IS READ WITH THE ENGINE'S OWN POSE READER, not recomputed from the placements: one reader means the report,
  // the namer and the harness all see the same board.
  const end: Board = {
    dancers: board.dancers.map((d, i) => {
      const p = poseFor(dancers[i], beats);
      return { ...d, x: p.x, y: p.y, heading: p.heading };
    }),
  };
  const endFormation = namer(end);
  if (endFormation === null) {
    return {
      legal: false,
      reason: `every step of ${JSON.stringify(name)} applies, but the module ends on a board the engine does not name`,
      tried: 'the end board',
    };
  }
  const labels = steps.map((s) => s.label);
  return {
    legal: true,
    end,
    bundle: {
      title: name,
      // The module starts where the caller stands: the board's own formation is the name this call now starts from, and
      // `formation` says so as a NAME so a consumer can print it rather than describe it.
      from: startFormation,
      formation: startFormation,
      // A COMPOSED bundle is not a corpus definition, so it carries no stored tags and no authored variant id: what
      // identifies it is `module` below. Same rule, same fields, as `placeVirtual` writes for a virtual call.
      formationTag: { fid: null, aid: null, sid: null },
      vid: null,
      parts: labels.join(', '),
      taminator: '',
      dancers,
      beats,
      // THE CLOCK DOES NOT MOVE. Replacing the module's N rows with this one row must cost the sequence exactly what it
      // cost before, so the lead-in/out are not taken from the first and last inner authorings — the steps' own charges
      // are the whole of the module's time (`sequenceBeats` over the flattened steps, which the harness pins).
      leadin: 0,
      leadout: 0,
      totalBeats: beats,
      sequencerMode: null,
      forSequencer: true,
      // WRITTEN OUT IN FULL, so nothing completes it again: a composed module is an eight-dancer authoring.
      symmetry: 1,
      // NOT BODY-SPECIFIC: a module is a chain of calls, and `going` is one authoring's body (`going.ts` derives it from
      // a TITLE). A rule that refuses one body of one call has no meaning for the whole chain, so this is null rather
      // than borrowed from the first step.
      going: null,
      module: { name, steps: labels, startFormation, endFormation },
    },
  };
}
