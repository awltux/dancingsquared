// SequenceAnalyzer: reads/animates a flat call sequence. Computes total beats,
// evaluates the board at an arbitrary beat, and validates the 64-beat singing-call
// segment / tip / zero structure. Advances via the CallApplicator.
//
// The REPLAY evaluators (sequenceBeats / evaluateSequence / sequenceInfo) replay
// a flat sequence from a START BOARD. That start board defaults to the home
// squared set, but a caller may pass the board the sequence actually began from -
// e.g. a board jumped to with setFormation - so playback and export agree with
// what is on screen. The tip-structure helpers (isZero / buildTip /
// validateSegment) are intrinsically home-anchored and never take one.
//
// IT HOLDS ONE MUTABLE FIELD, `replayMemo`, and it is a CACHE rather than state: it records the
// walk one (flat, start board) pair produced, keyed on the CONTENT of both, so it can never serve
// a result for different input. The UI drives these evaluators every animation frame - playback
// calls `evaluateSequence` for the board and `sequenceInfo` for the trace label - and without the
// memo that is a full replay of the sequence twice per frame. Keying on CONTENT rather than on
// object identity is deliberate: an identity key would go stale if any caller mutated a board in
// place, and this repo has already had to reason about exactly that hazard.

import { dancerBeats, poseFor } from '../core.js';
import { FormationMatcher, rebasedPose, localMotion } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from './constants.js';
import { normAngle } from './identity.js';
import { makeSquaredSet, cloneBoard } from './board.js';
import { findCodedMove, codedMoveApplies, isDeferredCall, type CodedMove } from './coded-moves.js';
import { splitSelection } from './selection.js';
import { promenadeTrip, promenadeLap } from './promenade.js';
import { fasrKey, homeFasrKey } from './fasr.js';
import type { Board, CallStep, GroupStep, ModuleStep, SeqDancer, VariantMatch } from './types.js';
import { groupCalls, isGroupStep, stepCall, stepLabel } from './types.js';
import type { CallBundle } from '../types.js';

const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

/** Tolerance (radians) for "this dancer is facing the way it started". Headings
 * are authored on 45-degree steps and snapped to formation slots, so this only
 * absorbs floating-point drift (~0.06 degrees). */
const FACING_EPS = 1e-3;

/** One flat step of a recorded replay. */
interface ReplayStep {
  /** The raw step, kept so the applicator can be handed the same step form. */
  raw: ModuleStep;
  /** The call/selection label. */
  name: string;
  /** The coded move this step is, or null when it is a catalogue call or a grouped step. */
  coded: CodedMove | null;
  /** The matched variant info for a catalogue step, or null when none matches. */
  info: { beats: number; variant: CallBundle | null } | null;
  /** The board the step runs on. */
  before: Board;
  /** The board after the step - identical to `before` when nothing applied. */
  after: Board;
  /** Beats charged. 0 when no variant matches, and 0 for a coded stop. */
  beats: number;
  /** Whether the step can be WALKED AT ALL. False for a coded move whose precondition fails, or a
   * catalogue call with no matching variant - and the two evaluator families treat that
   * differently, which is why `coded` is recorded alongside it. */
  walkable: boolean;
  /** WHY it cannot be walked, when it cannot. Recorded rather than discarded because an unwalkable
   * step is what makes `evaluateSequence` return the step's own START board - so the caller sees the
   * sequence end on the board BEFORE a call with nothing saying so, which reads as "the last frame
   * jumps back". See `sequenceStop`. */
  reason?: string;
  /**
   * A "while" step's LANES, as the apply left them: who each group is, the calls it dances back to
   * back, the beats of each, and the boards between them. Null for every other kind of step.
   *
   * IT IS THE APPLICATOR'S OWN RUN, stored by the walk rather than re-derived, which is the invariant
   * this file keeps everywhere ("the walk must agree with the applicator"): a lane's second call starts
   * on a board that is neither the step's `before` nor its `after`, so an animator that tried to find
   * it again would be a second implementation of the apply - and this one runs once per WALK, not once
   * per frame.
   */
  lanes?: ReplayLane[] | null;
}

/**
 * ONE GROUP'S RUN through a "while" step, as the animation needs it.
 *
 * `beats[i]` is what call `i` is charged (`stepBeats` against the board it starts from). The variant info the
 * walk matched each call with is NOT kept: `evaluateCallAt` finds it again for a selected call, and passing the
 * walk's own copy makes it tile the whole board with a subset variant and animate nothing (see
 * `evaluateGroupAt`). `deferred` is the deferred lane's alone: it is the one shape whose two legs are drawn
 * rather than interpolated.
 */
interface ReplayLane {
  selection: string;
  ids: number[];
  calls: string[];
  beats: number[];
  boards: Board[];
  deferred: CodedMove | null;
}

/** Where a flat sequence stops being playable. */
export interface SequenceStop {
  /** Index into the flat sequence of the first step that cannot be walked. */
  index: number;
  /** The call/selection label of that step. */
  call: string;
  /** Why it cannot be walked, as the applicator reported it. */
  reason: string;
  /** The board it was asked to run on - the board the animation ends on. */
  board: Board;
}

/** The memo key: the CONTENT of the flat sequence and of the board the replay starts from. */
function replayKey(flat: ModuleStep[], start: Board): string {
  const f = flat.map((s) => stepLabel(s)).join('\u0000');
  // 3 decimals, the same scheme the matcher's own memo uses for a board's pose.
  const p = start.dancers
    .map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)},${d.gender ?? ''},${d.couple ?? ''},${d.isGhost ? 'g' : ''}`)
    .join(';');
  return `${f}\u0001${p}`;
}

export class SequenceAnalyzer {
  /** The last recorded replay walk, keyed on content. See the header for why it is content-keyed
   * and why one entry is enough (the callers repeat the same pair). */
  private replayMemo: { key: string; steps: ReplayStep[] } | null = null;

  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly applicator: CallApplicator,
    private readonly config: SequencerConfig,
  ) {}

  /**
   * How a dancer-selection string resolves on a board, injected by `Sequencer` exactly as
   * `CallApplicator.setSelectionResolver` is - and for the same reason: the analyzer needs to know
   * WHICH DANCERS a scoped step acts on, and the `Grouping` that answers it is built from the
   * applicator, so holding one here would close a cycle.
   */
  private resolveSelection: (board: Board, selection: string) => number[] | null = () => null;

  /** Set the selection resolver. Called by `Sequencer` after construction. */
  setSelectionResolver(fn: (board: Board, selection: string) => number[] | null): void {
    this.resolveSelection = fn;
  }

  /** Beats of the variant of `name` that matches `board` (0 if none). A coded
   * body-relative move always takes CODED_MOVE_BEATS. */
  stepBeats(board: Board, name: ModuleStep): number {
    if (isGroupStep(name)) {
      // SIMULTANEOUS, so the step costs the LONGEST group, not the sum. A "while" is over when its
      // slowest part is over; charging the sum would report a caller's tip as twice as long as it
      // dances.
      //
      // A LANE SUMS ITS OWN CALLS, because inside a group the calls are SEQUENTIAL - that is the whole of
      // the lane rule. The calls after the first start on boards this function does not have, so the lane
      // is walked the way the applicator walks it (each call applied to what the one before it left) and
      // the boards are shared with the caller when they are needed for real (see `replayWalk`, which reads
      // the APPLY's own `lanes` and never comes through here for a group step). This path is the cold one:
      // a caller asking what a "while" step costs without applying it.
      //
      // A DEFERRED GROUP COSTS NOTHING, and that is the request rather than an optimisation: `Step Forward`
      // "takes on the duration of the other call", so charging it its own two beats would let the filler
      // lengthen the step it was written to fill. Read from the same `isDeferredCall` the applicator uses, so
      // the timing and the board cannot disagree about which groups are dependent.
      let most = 0;
      for (const g of name.groups) {
        const calls = groupCalls(g);
        if (calls.length === 1 && isDeferredCall(calls[0])) continue;
        // THE BOARDS THE CALLS START ON, applied the way the applicator applies them. A lane that the
        // applicator will refuse anyway (`boards.length` short) contributes nothing here; the refusal is
        // the apply's to report, not the timing's.
        const boards: Board[] = [board];
        let running = board;
        for (const call of calls) {
          const a = this.applicator.applySelected(running, g.selection, call, false);
          if (!a.legal) break;
          running = a.board;
          boards.push(running);
        }
        if (boards.length !== calls.length + 1) continue;
        most = Math.max(most, this.laneCalls(boards, g.selection, calls).beats.reduce((a, b) => a + b, 0));
      }
      return most;
    }
    const n = typeof name === 'string' ? name : name.call;
    const spec = splitSelection(n);
    // THE SELECTION GOES TO BOTH LOOKUPS, because both are keyed on the BASE call: a step stored as
    // the composed string `"Head Boys Dosado"` missed the coded `Do Sa Do` AND the catalogue variant,
    // and was charged ZERO BEATS. MEASURED: `stepBeats(board, "Head Boys Dosado") = 0` while
    // `stepBeats(board, {selection:"Head Boys", call:"Dosado"}) = 4` - the same step, two shapes, two
    // answers, and the zero is the one the sequencer stored.
    const coded = findCodedMove(spec.call);
    if (coded && !spec.selection) return coded.beats;
    const v = this.matchingVariantInfo(board, spec.call, spec.selection);
    if (v) return v.beats;
    if (coded) return coded.beats;
    return 0;
  }

  /**
   * WHAT EACH CALL OF ONE LANE COSTS, AND WHETHER IT CAN BE WALKED AT ALL - given the board each call
   * starts on.
   *
   * ONE IMPLEMENTATION FOR TWO CALLERS, which is why the boards are a parameter: `replayWalk` has the
   * boards from the APPLY (the lane's own intermediate boards, reported by `ApplyResult.lanes`) and
   * `stepBeats` has to derive them. Both then ask the same two questions per call - is there a variant
   * for this subset on this board, and how many beats does it take - so the timing, the scrub and the
   * apply cannot drift apart about a lane.
   *
   * A CALL THAT CANNOT BE WALKED stops the lane with a reason naming WHICH call it was, because a lane
   * has several places to look and the caller chose all of them: this is the `Step Forward` shape (a
   * coded call whose subset the catalogue has no variant for, walkable through the `scopedCoded` path)
   * and the `display="none"` scoped authorings, either of which applies but would animate as a straight
   * blend if it were let through.
   */
  private laneCalls(
    boards: Board[],
    selection: string,
    calls: string[],
  ): { beats: number[]; walkable: boolean; reason?: string } {
    const beats: number[] = [];
    for (let i = 0; i < calls.length; i++) {
      const info = this.matchingVariantInfo(boards[i], calls[i], selection);
      const coded = findCodedMove(calls[i]);
      if (!info && !coded) {
        const which = calls.length === 1 ? calls[i] : `call ${i + 1} of ${calls.length} (${calls[i]})`;
        return { beats, walkable: false, reason: `"${selection} ${calls.join(' then ')}" in a "while" step: ${which} cannot be walked from the board it starts on` };
      }
      beats.push(info ? info.beats : this.stepBeats(boards[i], { selection, call: calls[i] }));
    }
    return { beats, walkable: true };
  }

  /**
   * The board part-way through a coded move.
   *
   * A MOVE WITH PARTS is animated PART BY PART, because its NET position permutation is an artefact
   * of composing them and can be unroutable while every part is easy. `Swing Thru` is the case that
   * forced this: MEASURED, its net from `Ocean Waves` is two 4-CYCLES, so the exchange routing below
   * never fired and two dancers walked the same four-unit segment in opposite directions - closest
   * pair 0.000 at the halfway beat. Each PART is a pair trade, which routes cleanly. The parts come
   * from the move itself through `CodedMove.legs`, and the beats are split evenly between them.
   *
   * A single-segment move is handled by `interpolateSegment`. See there for the three shapes.
   */
  private evaluateCodedAt(board: Board, move: CodedMove, localBeat: number): Board {
    const legs = move.legs ? move.legs(board) : null;
    if (legs && legs.length > 0) {
      const legBeats = move.beats / legs.length;
      const idx = legBeats > 0
        ? Math.max(0, Math.min(legs.length - 1, Math.floor(localBeat / legBeats)))
        : legs.length - 1;
      const from = idx === 0 ? board : legs[idx - 1];
      const tf = legBeats > 0 ? Math.max(0, Math.min(1, (localBeat - idx * legBeats) / legBeats)) : 1;
      return this.interpolateSegment(from, legs[idx], tf, null);
    }
    const t = Math.max(0, Math.min(1, move.beats > 0 ? localBeat / move.beats : 1));
    return this.interpolateSegment(board, move.apply(board), t, move.ringMove ? { home: !!move.ringHome } : null);
  }

  /**
   * One segment of a coded move: the board at `t` in [0, 1] between `board` and `end`. Three shapes.
   *
   * A PIVOT (`Face Left`, `U-Turn Back`) moves nobody, so the straight line is degenerate and the
   * only real work is rotating each heading.
   *
   * AN EXCHANGE (`Touch a Quarter`, `Box the Gnat`, `Scoot Back`, and each PART of `Swing Thru`) sends
   * a dancer where another dancer stands. A straight line puts BOTH of them through the midpoint of
   * their chord, so they pass through each other. The pair is therefore rotated RIGIDLY by half a turn
   * about its own midpoint, which keeps the two diametrically opposite for the whole segment - their
   * separation never changes - and lands them exactly swapped at t=1. The sweep direction is chosen so
   * both dancers walk FORWARD, i.e. the tangent agrees with the facing.
   *
   * A RING MOVE (`Promenade` and its fractions) wheels the whole set around the ring, so it is
   * interpolated in POLAR coordinates about the set centre: the radius eases and the angle sweeps.
   * The SWEEP comes from the CALL and not from the end board - see `promenadeSweep`, and the ring
   * branch below for the defect that distinction fixes. `ring` is null for every non-ring segment.
   */
  private interpolateSegment(board: Board, end: Board, t: number, ring: { home: boolean } | null): Board {
    const endById = new Map(end.dancers.map((d) => [d.id, d]));
    const phys = board.dancers.filter((d) => !d.isGhost);
    const cx = phys.length ? phys.reduce((s, d) => s + d.x, 0) / phys.length : 0;
    const cy = phys.length ? phys.reduce((s, d) => s + d.y, 0) / phys.length : 0;
    const shortest = (from: number, to: number) => normAngle(to - from);

    // EXCHANGE PAIRS: i ends where j started and j ends where i started. The tolerance is loose
    // because the ends are snapped board positions, and a pair whose dancers were further apart than
    // this is not an exchange of neighbours.
    //
    // A RING MOVE IS NEVER AN EXCHANGE, and this is not a shortcut: the exchange routing keeps the
    // two dancers diametrically opposite about the pair's OWN midpoint while BOTH orbit it, which is
    // the right shape for two neighbours trading places and the wrong one for a wheel. A half
    // promenade from a squared set sends every dancer to the point diametrically opposite its own -
    // so the detection pairs it with the dancer standing THERE, six units away - and the two then
    // sweep opposite ways about a shared midpoint and MEET IN THE MIDDLE: measured closest pair
    // 0.000 from `O In` and 0.448 from a Static Square, against 2.000 for the wheel the call is. So
    // the ring branch below must own every dancer of a ring move, and `partner` stays empty here.
    const EXCH = 0.35;
    const partner = new Map<number, number>();
    if (!ring) {
      for (const a of phys) {
        if (partner.has(a.id)) continue;
        const ea = endById.get(a.id);
        if (!ea) continue;
        for (const b of phys) {
          if (b.id === a.id || partner.has(b.id)) continue;
          const eb = endById.get(b.id);
          if (!eb) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < EXCH) continue;
          if (Math.hypot(a.x - eb.x, a.y - eb.y) < EXCH && Math.hypot(b.x - ea.x, b.y - ea.y) < EXCH) {
            partner.set(a.id, b.id);
            partner.set(b.id, a.id);
            break;
          }
        }
      }
    }

    const straight = (d: Board['dancers'][number], e: Board['dancers'][number], heading: number) => ({
      ...d, x: d.x + (e.x - d.x) * t, y: d.y + (e.y - d.y) * t, heading,
    });

    // THE LAP IS DECIDED ONCE FOR THE WHOLE SET, before any dancer is placed. It is the CALLERLAB
    // rule "add a full Promenade" for a trip of a quarter turn or less (see `promenadeLap`), and
    // because it is the SAME number for all eight dancers it cancels out of every pairwise angle -
    // so the set's relative geometry over the call is exactly the trips', and this can never collide
    // two dancers that the trip alone would not. Deciding it per dancer is what turns a fix into a
    // new defect on a board whose couples are not on a true ring; the measurement is in
    // `promenadeLap`. The ring's rotation is the SMALLEST trip any dancer must make - the couple
    // nearest its home side tells you how far round the set already is.
    let lap = 0;
    if (ring?.home) {
      let smallest = Infinity;
      for (const d of phys) {
        const e = endById.get(d.id);
        if (!e) continue;
        if (Math.hypot(d.x - cx, d.y - cy) < 1e-6 || Math.hypot(e.x - cx, e.y - cy) < 1e-6) continue;
        smallest = Math.min(smallest, promenadeTrip(Math.atan2(d.y - cy, d.x - cx), Math.atan2(e.y - cy, e.x - cx)));
      }
      if (Number.isFinite(smallest)) lap = promenadeLap(smallest);
    }

    return {
      dancers: board.dancers.map((d) => {
        const e = endById.get(d.id);
        if (!e) return d;
        const heading = normAngle(d.heading + shortest(d.heading, e.heading) * t);

        const pid = partner.get(d.id);
        if (pid !== undefined) {
          const p = phys.find((x) => x.id === pid)!;
          const mx = (d.x + p.x) / 2;
          const my = (d.y + p.y) / 2;
          const r = Math.hypot(d.x - mx, d.y - my);
          if (r < 1e-6) return straight(d, e, heading);
          const as = Math.atan2(d.y - my, d.x - mx);
          // Which way round: the sense that has BOTH dancers walking forward. The tangent at the
          // start is `dir * (-sin as, cos as)`, so its agreement with a facing `h` is
          // `dir * sin(h - as)`; the pair picks the sign that maximises the worse of the two.
          const fwd = (dir: number) =>
            Math.min(dir * Math.sin(d.heading - as), dir * Math.sin(p.heading - Math.atan2(p.y - my, p.x - mx)));
          const dir = fwd(1) >= fwd(-1) ? 1 : -1;
          const a = as + dir * Math.PI * t;
          return { ...d, x: mx + r * Math.cos(a), y: my + r * Math.sin(a), heading };
        }

        if (!ring) return straight(d, e, heading);

        const rs = Math.hypot(d.x - cx, d.y - cy);
        const re = Math.hypot(e.x - cx, e.y - cy);
        // A dancer standing ON the centre has no angle to sweep; fall back to the straight line.
        if (rs < 1e-6 || re < 1e-6) return straight(d, e, heading);
        const as = Math.atan2(d.y - cy, d.x - cx);
        const ae = Math.atan2(e.y - cy, e.x - cx);
        const r = rs + (re - rs) * t;
        // THE SWEEP IS THE CALL'S, NOT THE END BOARD'S, and this is the whole of a real defect. A
        // `Promenade` is "promenade until you are home", so from a squared set its end board IS the
        // board it started on: start and end angles coincide, and a sweep derived from their
        // difference is zero for all eight dancers while the timeline counts eight beats. Reported
        // as "the dancers don't move, but the sequencer counts 8 beats". `promenadeTrip` is the
        // counter-clockwise angle to the home side and `lap` is added on top, so from a squared set
        // the call is one full circuit. The end board is still reached exactly: trip and lap
        // together are congruent to the start->end difference modulo a whole turn.
        //
        // COUNTER-CLOCKWISE IS NOT A PREFERENCE, it is the promenade direction ("Promenade
        // Direction: Counter-clockwise") and it has to be DETERMINISTIC, which the old
        // `shortest(as, ae)` was not: a turn of half a turn has no shorter side, so `normAngle`
        // returned the sign per dancer and split the set. MEASURED on a half promenade - the case
        // whose trip IS half a turn - taking each dancer's own shortest route collapsed seven of
        // the nineteen boards to closest pair 0.000, against 0.127 for the counter-clockwise route.
        //
        // A COMMON ANGLE WAS TRIED BEFORE AND MEASURED WORSE (0.098 against 0.303) on the board that
        // prompted the ring branch. That is not this: it forced one ANGLE, i.e. one trip, on a board
        // whose partners need different trips and stand 5.8 apart, dragging half the set across the
        // other half. Each dancer still takes its own trip here, and only the lap is shared.
        //
        // THE COUNTER-CLOCKWISE ROUTE IS MEASURED AGAINST THE OLD ONE on the 15 All8 get-out boards
        // the call applies from, and it is a redistribution rather than a loss: across the nineteen
        // boards the count with a pair inside 1.0 is unchanged at 13 and the worst gap unchanged at
        // 0.055, with `[P4p]` 0.076 -> 0.764 and `[B4c]` 0.055 -> 0.093 better and `[P3p]` 0.764 ->
        // 0.076 and `[B1p]` 0.881 -> 0.138 deeper. The two that deepen are bodies where a "couple"
        // is split across the set, so the counter-clockwise route sends one partner the long way
        // - the ring these calls should be read from, which the stored couple labels do not give.
        const a = as + (promenadeTrip(as, ae) + lap) * t;
        return { ...d, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), heading };
      }),
    };
  }

  /** Find the call variant that applies to `board` (WHOLE-BOARD first, else the
   * PARALLEL-subset path) and return its beat count and, when available, the
   * variant itself. */
  private matchingVariantInfo(
    board: Board,
    name: string,
    selection?: string,
  ): { beats: number; variant: CallBundle | null } | null {
    // A SCOPED STEP IS LOOKED UP AGAINST ITS OWN SUBSET, and without this a scoped call has no
    // variant at all: the walk charged it ZERO BEATS and skipped it, so `evaluateSequence` returned
    // the start board on every frame. MEASURED on `Head Boys Dosado` from a squared set -
    // `sequenceBeats` was 0 while `stepBeats` said 4, and nothing animated.
    //
    // WHY THE SUBSET AND NOT A CODED RULE. `Do Sa Do` is derived with the IDENTITY transform (step
    // around your partner and back to your own spot), so applying it moves nobody and there is no
    // path to animate - while the AUTHORED tams carry real motion (`Opposite Boy`: 2 dancers, 8
    // beats, 8 per path). Reading the variant the way `applySelected` does - select, centre on the
    // subset's own origin, match - is what reaches that motion.
    if (selection) {
      const ids = this.resolveSelection(board, selection);
      if (ids && ids.length > 0) {
        const byId = new Map(board.dancers.map((d) => [d.id, d]));
        const selected = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
        let cx = 0, cy = 0;
        for (const d of selected) { cx += d.x; cy += d.y; }
        cx /= selected.length;
        cy /= selected.length;
        const subBoard: Board = { dancers: selected.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
        // `findMatchingVariant` is the applicator's own whole-board predicate, run on the sub-board -
        // which is exactly the first reading `applySelected` tries.
        const sub = this.matcher.findMatchingVariant(subBoard, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
        if (sub) return { beats: Math.max(...sub.variant.dancers.map((d) => dancerBeats(d))), variant: sub.variant };
      }
    }
    const m = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
    if (m) return { beats: Math.max(...m.variant.dancers.map((d) => dancerBeats(d))), variant: m.variant };
    // THE SAME PREDICATE `parallelApply` USES, because the two disagreeing is what makes a call
    // "apply but not exist". `parallelApply` takes `partition(...) ?? partitionPartial(...)` at the
    // tolerance `applyToBoardInner` hands it - DEFAULT when re-basing, which is what `replayWalk`
    // does. This used to ask `partitionExists` (FULL tilings only) at SEARCH, and there are boards
    // where NO variant tiles FULLY while one tiles PARTIALLY.
    //
    // MEASURED on ceder-7046: `Swing Thru` from the `Double Pass Thru` the module reaches is applied
    // by variant #10 through `partitionPartial(DEFAULT)`; no variant tiles fully at SEARCH, so the
    // walk charged the call 0 beats and `evaluateSequence` then aborted - returning the board BEFORE
    // the call, which is the reported "last frame jumps the board back". See
    // `engine/test/tools/7046-swing-thru-probe.mjs`.
    const tol = DEFAULT_MATCH_MAX + this.config.matchMargin;
    const variants = this.library.matchableVariants(name);
    {
      const phys = board.dancers.filter((d) => !d.isGhost);
      const n = phys.length;
      for (const v of variants) {
        const setup = v.dancers.map((d) => this.library.variantMatchable(d));
        const k = setup.length;
        if (k <= 1 || k >= n || n % k !== 0) continue;
        const part = this.applicator.partition(setup, phys, tol)
          ?? this.applicator.partitionPartial(setup, phys, tol);
        if (part) return { beats: Math.max(...v.dancers.map((d) => dancerBeats(d))), variant: v };
      }
    }
    return null;
  }

  /** The board a REPLAY starts from: the caller's explicit start board when
   * given, otherwise the home squared set. Always a copy, so replay cannot mutate
   * the caller's board. */
  private replayStart(startBoard?: Board): Board {
    return startBoard ? cloneBoard(startBoard) : makeSquaredSet();
  }

  /**
   * The REPLAY WALK for one (flat, start board) pair, recorded once and memoised on the CONTENT of
   * both.
   *
   * WHY ONE WALK CAN SERVE ALL THREE EVALUATORS. `evaluateSequence` and `sequenceInfo` walk
   * identically; `sequenceBeats` differs in exactly ONE place - a catalogue step with no matching
   * variant stops the first two but is charged 0 beats and SKIPPED by the third. So the record
   * keeps `walkable` per step and the consumers apply their own rule to it, rather than the walk
   * pretending the two are the same. Anything else would silently change one of them.
   *
   * It records to the END of `flat` unless a coded move's precondition fails WITHOUT a catalogue
   * fallback, which stops BOTH consumers and therefore stops the recording. A refusal that the move
   * overrides with `catalogueFallback` is recorded as an ordinary catalogue step instead, because
   * that is how the applicator reads it.
   */
  private replayWalk(flat: ModuleStep[], startBoard?: Board): ReplayStep[] {
    const start = this.replayStart(startBoard);
    const key = replayKey(flat, start);
    if (this.replayMemo && this.replayMemo.key === key) return this.replayMemo.steps;

    const steps: ReplayStep[] = [];
    let board = start;
    for (const raw of flat) {
      // A GROUPED ("while") step is one atomic simultaneous step, not a call: it has no single variant
      // and no coded move, so it takes its `after` from the applicator and its cost from the LONGEST
      // group. It is walkable exactly when the applicator says it is, so the animation and the apply
      // cannot disagree about whether the "while" happened - which is the invariant this whole walk
      // exists to keep.
      if (isGroupStep(raw)) {
        const r = this.applicator.applyStep(board, raw);
        // THE LANES COME FROM THE APPLY, and each call in one is walked exactly as a lone scoped step is:
        // `matchingVariantInfo` against the board that call starts from, with the `scopedCoded` fallback for a
        // coded call whose subset the catalogue has no variant for. A call that can be APPLIED but not WALKED
        // (`Step Forward`'s shape, and the catalogue's `display="none"` scoped authorings) makes the whole step
        // unwalkable rather than being drawn as a blend - the same rule the single-call branch below applies,
        // and the reason this walk exists: a step the animation cannot follow is a scrub that lies.
        const lanes: ReplayLane[] = [];
        let walkable = r.legal;
        let reason = r.legal ? undefined : r.reason ?? 'the "while" step does not apply here';
        let beats = 0;
        // A LEGAL APPLY WITH NO GROUPS REPORTED cannot be animated, so it is not walkable either: saying it is
        // would charge the step 0 beats and draw no motion, which is exactly the silent scrub this walk exists
        // to prevent. `applyGroupStep` reports its lanes for every apply that succeeds, so this is a guard on
        // that promise rather than a case anything reaches today.
        if (r.legal && !r.lanes) {
          walkable = false;
          reason = 'the "while" step applied without reporting its groups, so there is nothing to animate';
        }
        if (r.legal && r.lanes) {
          for (const lane of r.lanes) {
            const deferred = lane.calls.length === 1 && isDeferredCall(lane.calls[0]) ? findCodedMove(lane.calls[0]) ?? null : null;
            const w = this.laneCalls(lane.boards, lane.selection, lane.calls);
            if (!w.walkable) {
              walkable = false;
              reason = w.reason;
              break;
            }
            lanes.push({ selection: lane.selection, ids: lane.ids, calls: lane.calls, beats: w.beats, boards: lane.boards, deferred });
            // THE STEP COSTS THE LONGEST LANE, and a deferred lane costs nothing (its duration is the partner's).
            const laneBeats = deferred ? 0 : w.beats.reduce((a, b) => a + b, 0);
            beats = Math.max(beats, laneBeats);
          }
        }
        steps.push({
          raw, name: stepLabel(raw), coded: null, info: null, before: board,
          after: r.legal ? r.board : board,
          beats: walkable ? beats : 0,
          walkable,
          reason,
          lanes: r.legal ? lanes : null,
        });
        if (r.legal) board = r.board;
        continue;
      }
      const name = typeof raw === 'string' ? raw : raw.call;
      // THE BASE CALL, so a SCOPED step reaches the coded rule and the catalogue variant alike.
      // `findCodedMove("Head Boys Dosado")` is null - the table is keyed on `Do Sa Do` - so a scoped
      // step used to fall straight through to `matchingVariantInfo`, which also could not see a
      // two-dancer subset, and the step was recorded unwalkable with 0 beats.
      const spec = splitSelection(name);
      // AND THE SELECTION MAY BE A FIELD RATHER THAN PART OF THE NAME. A `CallStep` carries
      // `{ selection, call }`, and this walk read only `raw.call` - so `Heads Step Forward` written that way
      // had no selection here, took the WHOLE-BOARD coded branch below, was refused by the rule (which says a
      // group must be named) and was recorded UNWALKABLE: the apply moved the dancers and the scrub froze.
      // Both forms are the same step, so the selection is read from whichever one carries it. (Measured: the
      // two forms now produce the same walk, and `step-forward.mjs` section 7 checks both.)
      const selection = spec.selection ?? (typeof raw === 'string' ? null : raw.selection ?? null);
      const coded = findCodedMove(spec.call);
      // A SELECTION IS HANDLED BY THE CATALOGUE, not by the coded rule: the coded rule is a
      // board-wide transform and would move the whole set, whereas `applySelected` moves only the
      // named dancers. So a scoped step skips the coded branch entirely and goes to the variant
      // lookup below, which resolves it against its own subset.
      if (coded && !selection) {
        const ok = codedMoveApplies(coded, board);
        if (ok) {
          const after = coded.apply(board);
          steps.push({ raw, name, coded, info: null, before: board, after, beats: coded.beats, walkable: true });
          board = after;
          continue;
        }
        if (!coded.catalogueFallback) {
          const refused = this.applicator.applyToBoard(board, raw);
          steps.push({ raw, name, coded, info: null, before: board, after: board, beats: 0, walkable: false, reason: refused.reason ?? `${name} cannot be danced from this board` });
          break;
        }
        // Refused by the derived rule, but the move declares a catalogue fallback - which means the
        // APPLICATOR applies it from the catalogue anyway (`sequencer.tryCodedMove` returns null and
        // `applyWholeBoard` reads the authored variant). The walk has to agree with the applicator or
        // the call is legal, moves the dancers, and animates nothing: measured on 84 (move, board)
        // pairs by `engine/test/tools/coded-refusal-probe.mjs`, including `Swing Thru` from
        // `Normal Lines`, which real choreography calls. So fall through to the catalogue step below,
        // with `coded: null`, and let it read the same variant the applicator did.
      }
      const info = this.matchingVariantInfo(board, spec.call, selection ?? undefined);
      const r = this.applicator.applyToBoard(board, raw);
      const after = r.legal ? r.board : board;
      // A SCOPED STEP WHOSE CALL IS CODED AND WHOSE CATALOGUE HAS NO VARIANT FOR IT. The applicator resolves
      // it through the coded rule for the named group (`applySelected` -> `applyCodedToSelection`), which is
      // the only reading it has - `Step Forward` has no tams at all, and a bare `Heads Step Forward` therefore
      // has no variant to match. The walk used to record that as UNWALKABLE with 0 beats, which applied the
      // call, charged nothing and FROZE the scrub on the step's own start board (`evaluateSequence` returns
      // `s.before` for an unwalkable step). Reported from use: "When adding this Step forward call as a
      // separate call, It isnt animated using the scrub."
      //
      // THE WALK MUST AGREE WITH THE APPLICATOR, which is the rule this whole method is built around: the
      // applicator said legal and produced `after`, so the step IS walkable and its cost is whatever
      // `stepBeats` charges - which for a coded call is the call's own beats (2 for `Step Forward`). The
      // catalogue-with-no-variant case is untouched: `coded` is null there, so `scopedCoded` is false and that
      // step keeps its 0 beats and its refusal.
      const scopedCoded = info === null && r.legal && !!coded && !!selection;
      steps.push({
        raw, name, coded: null, info, before: board, after,
        beats: info ? info.beats : scopedCoded ? this.stepBeats(board, raw) : 0,
        walkable: info !== null || scopedCoded,
        reason: info === null && !scopedCoded ? r.reason ?? `no setup in "${name}" matches the board it is asked to run on` : undefined,
      });
      board = after;
    }
    this.replayMemo = { key, steps };
    return steps;
  }

  /**
   * WHERE A FLAT SEQUENCE STOPS BEING PLAYABLE, or null when it plays all the way.
   *
   * This is the missing half of `evaluateSequence`'s contract. A step the walk cannot walk is
   * returned as its own START board (`return { board: s.before }`), and `sequenceBeats` charges a
   * catalogue step 0 beats and moves on - so a sequence whose LAST call cannot be played reports a
   * total that excludes that call and an end board that is the board BEFORE it, with nothing saying
   * why. Measured on the POC: `ceder-7046` replayed from home has `Right and Left Grand` refused on
   * the `T-Bone` its chain reaches (33.5 beats, ending on that T-Bone) while replayed from the
   * module's own `Zero Line` start the same call applies (35 beats, ending on the ring it produces).
   * The UI reported the first as "the last frame jumps the board back".
   *
   * `board` is deliberately the step's own start board: it is what an evaluator returns and therefore
   * what the user is looking at when this happens.
   */
  sequenceStop(flat: ModuleStep[], startBoard?: Board): SequenceStop | null {
    const steps = this.replayWalk(flat, startBoard);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      // A coded move with no catalogue fallback stops BOTH consumers, so it is a stop. A catalogue
      // step with no variant stops the two evaluators but not the beat total; it is still the point
      // the sequence stops being playable, which is what this reports.
      if (!s.walkable) {
        return { index: i, call: s.name, reason: s.reason ?? `${s.name} cannot be danced from this board`, board: s.before };
      }
    }
    return null;
  }

  /** Total beats to play a flat sequence, starting from `startBoard` (default:
   * the home squared set). */
  sequenceBeats(flat: ModuleStep[], startBoard?: Board): number {
    let total = 0;
    for (const s of this.replayWalk(flat, startBoard)) {
      // A coded move that does not apply is not part of the sequence at all, so its cost must not
      // be added to a total that stops there. A CATALOGUE step with no variant is different: it
      // charges 0 and the walk continues, which is what this loop's `walkable` check preserves.
      if (s.coded && !s.walkable) break;
      total += s.beats;
    }
    return total;
  }

  /** Evaluate the board at a global beat of a flat sequence, starting from
   * `startBoard` (default: the home squared set). */
  evaluateSequence(flat: ModuleStep[], beat: number, startBoard?: Board): { board: Board; beats: number } {
    let acc = 0;
    let board = this.replayStart(startBoard);
    for (const s of this.replayWalk(flat, startBoard)) {
      // Both stop kinds end the walk here, leaving the step's own start board.
      if (!s.walkable) return { board: s.before, beats: acc };
      if (beat < acc + s.beats) {
        // THE SELECTION IS CARRIED, not just the raw string. A scoped step stored as
        // `"Head Boys Dosado"` reaches `evaluateCallAt` as one string, where `selection` is null - so
        // the scoped path below never ran and a closing call animated nothing. Splitting it here is
        // what hands the evaluator the step the walk already understood.
        const stepForEval: string | CallStep = (() => {
          if (isGroupStep(s.raw) || s.coded) return s.raw as string;
          const spec = splitSelection(typeof s.raw === 'string' ? s.raw : s.raw.call);
          return spec.selection ? { selection: spec.selection, call: spec.call } : s.raw;
        })();
        const evBoard = isGroupStep(s.raw)
          ? this.evaluateGroupAt(s, beat - acc)
          : s.coded
            ? this.evaluateCodedAt(s.before, s.coded, beat - acc)
            : this.evaluateCallAt(s.before, stepForEval, s.info, s.after, s.beats, beat - acc);
        return { board: evBoard, beats: 0 };
      }
      board = s.after;
      acc += s.beats;
    }
    return { board, beats: acc };
  }

  /**
   * A DEFERRED CALL'S ROUND TRIP: OUT over its own beats, STILL, and BACK over its own beats.
   *
   * The ONE place this shape is drawn, because both ways the call can be danced need it and a two-point
   * interpolation cannot express either: a "while" group's start and end boards are the same board when its
   * dancers came back (`evaluateGroupAt`), and so are a lone call's (`evaluateCallAt`). See `evaluateGroupAt`
   * for the report that forced it.
   *
   * `ownBeats` is the CALL's own length and `available` is the time the step has - the same thing when the call
   * is danced alone, and the whole "while" step when it is not. The legs are `ownBeats / 2` each (the call IS
   * two legs), capped at half of `available` so the round trip always fits: a two-beat step inside a two-beat
   * partner has half a beat each way rather than losing the return and disagreeing with the applied board. A
   * dancer that STAYED has `end === forward`, so its back leg is a no-op and one formula serves both outcomes.
   */
  private deferredRoundTrip(
    board: Board,
    forward: Board,
    end: Board,
    ids: number[],
    ownBeats: number,
    available: number,
    localBeat: number,
  ): Board {
    const leg = Math.min(ownBeats / 2, available / 2);
    const endById = new Map(end.dancers.map((d) => [d.id, d]));
    const moved = new Map<number, SeqDancer>();
    for (const id of ids) {
      const p0 = board.dancers.find((d) => d.id === id);
      const p1 = forward.dancers.find((d) => d.id === id);
      const p2 = endById.get(id) ?? p1;
      if (!p0 || !p1 || !p2) continue;
      if (leg <= 0) { moved.set(id, p2); continue; }
      const back = localBeat > available - leg;
      const f = Math.max(0, Math.min(1, back ? (localBeat - (available - leg)) / leg : localBeat / leg));
      const from = back ? p1 : p0;
      const to = back ? p2 : p1;
      moved.set(id, { ...to, x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, heading: from.heading });
    }
    return { dancers: board.dancers.map((d) => moved.get(d.id) ?? d) };
  }

  /**
   * The board part-way through a GROUPED ("while") step.
   *
   * EACH GROUP WALKS ITS OWN PATH AT ITS OWN PACE, and the two halves of that are the whole of this function.
   *
   * EACH GROUP'S OWN PATH, because a "while" is a composition of two ordinary calls and each of them has an
   * animation of its own. The first version of this function blended every dancer STRAIGHT from `before` to
   * `after`, which is fine for a step and wrong for anything with a curve in it: reported from use, "When I
   * apply Sides Promenade 3/4 to Home in parallel with Step Forward ... the sides seem to take a direct
   * shortcut between the start and end formation". MEASURED on that witness, the promenade's dancers ran a
   * straight chord from (3,-1) to (-1,-3) - 4.47 units through the middle of the set - where the call alone
   * wheels them round the ring. So each group is animated by `evaluateCallAt`, the SAME function a lone scoped
   * step uses, which is the invariant worth stating: A GROUP IN A "WHILE" STEP ANIMATES EXACTLY AS IT WOULD
   * ALONE. Each group is posed with the others FROZEN where they stand, so the exchange detection inside
   * `interpolateSegment` cannot pair a dancer with somebody the group does not own.
   *
   * ITS OWN PACE, because the groups do not take the same time and the step costs the LONGEST of them. Asked
   * for in as many words: "A Step forward should take 2 beats to move the two steps. The rest of it should be
   * stand still." So a group is evaluated at `min(localBeat, its own beats)` and therefore HOLDS at its end
   * pose once its own call is over - a two-beat step inside a twelve-beat promenade is done at beat 2 and
   * stands for the other ten, instead of the pair being drawn at the shorter call's pace or the longer one
   * being stretched to fill.
   *
   * STILL CORRECT AT BOTH ENDS, which is what the previous version was built to guarantee and this one keeps:
   * at local beat 0 every dancer is on `before`, and at the step's own cost (>= every group's beats) each
   * group is at its own applied result, so the last frame is the board the applicator produced. What it does
   * not do, still, is route a group around a collision - that treatment lives in each call's own animation.
   *
   * A LANE IS THE SAME RULE, TWICE: the group's clock runs through its calls in order, and the call the beat
   * falls in is posed by `evaluateCallAt` from THE BOARD THAT CALL STARTS ON - the lane's own intermediate
   * board, reported by the apply - with everyone else frozen. A lane that has finished its own total HOLDS at
   * its end pose (`min(localBeat, total)`), which is the existing rule with the lane's sum in place of one
   * call's beats. There is no second implementation of the apply here: the boards are the applier's.
   */
  private evaluateGroupAt(step: ReplayStep, localBeat: number): Board {
    const before = step.before;
    const after = step.after;
    const beats = step.beats;
    const lanes = step.lanes;
    const afterById = new Map(after.dancers.map((d) => [d.id, d]));
    const merged = new Map<number, SeqDancer>();
    // NO LANES MEANS NOTHING TO WALK: the walk records them for every apply that succeeded, and an unwalkable
    // step never reaches here (`evaluateSequence` returns the step's own start board). Leaving the board alone
    // is the honest reading of a step with no recorded motion.
    if (!lanes) return { dancers: before.dancers.map((d) => ({ ...d })) };
    for (const lane of lanes) {
      const picked = new Set(lane.ids);
      if (picked.size === 0) continue;
      // The lane's own end board: its dancers at the applied pose, everyone else where they stand. Passing the
      // whole composed board here would let one group's motion be read as another's (an exchange pair spanning
      // two groups), which is exactly the coupling a per-group animation must not have.
      const laneEnd: Board = {
        dancers: before.dancers.map((d) => (picked.has(d.id) ? afterById.get(d.id) ?? d : d)),
      };
      // A DEFERRED LANE HAS TWO MOVES IN IT, AND THE SECOND ONE IS AT THE END OF THE CALL.
      //
      // Its dancers step forward, and then decide whether to step BACK to the spot they left - and when they
      // do, the lane's start and end boards are the SAME BOARD, so a two-point interpolation draws nothing at
      // all. Reported from use: "if I apply Sides Promenade 1/2 to Home in parallel with Step Forward, the
      // sequencer suggests they have been applied, but the step forward dancers dont move. I suspect it is
      // because they start an end that the same place." The guess is right, and the cure is that the call has
      // TWO moves: the request puts the step at the start and the step BACK "at the end of the call", and the
      // pacing asked for later ("2 beats to move the two steps, the rest stand still") is what happens in
      // between. So the lane walks forward over its own half, HOLDS, and walks back over the last of it - and
      // the two boards are the apply's own (forward on `boards[1]`, resolved on the last).
      if (lane.deferred) {
        const forward = lane.boards[1] ?? before;
        const settled = lane.boards[lane.boards.length - 1] ?? laneEnd;
        const posed = this.deferredRoundTrip(before, forward, settled, lane.ids, lane.beats[0] ?? 0, beats, localBeat);
        for (const d of posed.dancers) if (picked.has(d.id)) merged.set(d.id, d);
        continue;
      }
      const total = lane.beats.reduce((a, b) => a + b, 0);
      // WHICH CALL THE BEAT IS IN. Clamped to the lane's own total, so a lane that finishes early holds at its
      // end pose while the longest lane is still moving; a zero-beat call takes no time and is stepped over
      // rather than divided by.
      const local = total > 0 ? Math.min(localBeat, total) : 0;
      let i = 0;
      let acc = 0;
      while (i < lane.calls.length - 1 && acc + lane.beats[i] <= local) {
        acc += lane.beats[i];
        i++;
      }
      const posed = this.evaluateCallAt(
        lane.boards[i],
        { selection: lane.selection, call: lane.calls[i] },
        // NULL, NOT THE WALK'S OWN `info`, and that is a measured trap rather than a style choice: `evaluateCallAt`
        // finds the variant for a SELECTED call itself (it builds the centred subset and matches there), and
        // handing it a variant that was matched against the whole board makes it try to TILE the board with a
        // subset variant - no group matches, nothing is posed, and the dancers HOLD at the sub-call's start
        // until the step's last frame. MEASURED on `Sides Trade then Pass Thru`: with `info` the sides sat at
        // the Trade's end from beat 4 to 15.9 and jumped at 16; with `null` they walk the Pass Thru. Every
        // group call before lanes existed passed `null` here for the same reason.
        null,
        lane.boards[i + 1] ?? laneEnd,
        lane.beats[i] ?? 0,
        local - acc,
      );
      for (const d of posed.dancers) if (picked.has(d.id)) merged.set(d.id, d);
    }
    return { dancers: before.dancers.map((d) => merged.get(d.id) ?? d) };
  }

  /** Place the board at a local beat of a call.
   *
   * A WHOLE-BOARD call follows its authored path, which converges on the board the
   * call produces. A call that only applies via the subset/parallel path does not: the parallel
   * path partitions the board at its own tolerance and runs each group with pure-relative motion.
   *
   * THE STEP, NOT JUST ITS NAME, and that distinction is the whole of a real defect. `replayWalk`
   * stores `step.after` from `applyToBoard(board, RAW)` - selection included - while this was handed
   * `step.name`, which is `raw.call`, i.e. the bare call with any SELECTION DROPPED. For a step like
   * `{ selection: 'Heads', call: 'Right and Left Thru' }` the applicator moved only the Heads while
   * the animation played the whole-set reading, so every unselected dancer stood still in the stored
   * board and was dragged across the floor in the animation. MEASURED - see
   * `engine/test/tools/last-frame-owner-probe.mjs`: of 86 modules whose last frame moved a dancer
   * more than 0.05 units, **84 had a selection** on the step that owned the jump, and on 83 of them
   * the raw-step and bare-NAME applies differed by EXACTLY the jump. The error field gave it away: some
   * dancers at delta 0.00 (the unselected, who never moved) and others on lattice-valued vectors.
   *
   * A STEP WITH A SELECTION never takes the whole-board branch, even when the bare call matches the
   * whole board: the apply did not touch the whole board, so animating a whole-board path would move
   * dancers the call never moved. It goes to `evaluateParallelAt`, whose per-group motion already has
   * the right shape - the groups it cannot match fall back to a blend against the APPLIED board, which
   * for an unselected dancer is the pose they are already in, so they do not move at all. */
  private evaluateCallAt(
    board: Board,
    step: string | CallStep,
    info: { beats: number; variant: CallBundle | null } | null,
    after: Board,
    beats: number,
    localBeat: number,
  ): Board {
    const name = typeof step === 'string' ? step : step.call;
    const selection = typeof step === 'string' ? null : step.selection ?? null;
    if (selection && !this.selectedSubBoard(board, selection)) return this.evaluateParallelAt(board, step, info ?? { beats, variant: null }, localBeat);
    const whole = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
    if (whole) return this.evaluateVariantAt(board, whole, localBeat);
    // A SCOPED STEP WHOSE CALL THE CATALOGUE AUTHORED FOR THE SUBSET, animated along that path.
    //
    // `evaluateParallelAt` below animates each group along the variant it tiled with, but it only gets
    // there through `res.parallel`, and a step the APPLICATOR handled as a SELECTION reports no parallel
    // grouping - so the group loop is skipped and the pose falls through to a straight blend against the
    // APPLIED board. For a call whose authored motion CLOSES that blend is a no-op: `Head Boys Dosado`
    // (variant `Opposite Boy`) traces a circular path of radius ~0.7 and total travel 2.36, and ends
    // where it started, so the board was applied, charged its 8 beats, and NOTHING MOVED.
    //
    // The subset is built exactly as `applySelected` builds it - select, centre on the subset's own
    // origin - so the variant that matches here is the one the applicator matched.
    if (typeof step !== 'string' && step.selection) {
      const sub = this.selectedSubBoard(board, step.selection);
      if (sub) {
        const m = this.matcher.findMatchingVariant(sub.board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
        if (m) {
          const posed = this.evaluateVariantAt(sub.board, m, localBeat);
          // Put the subset back where it stands: the centring is an artefact of the lookup, not part of
          // the animation, and the dancers NOT in the selection keep their own pose.
          const byId = new Map(posed.dancers.map((d) => [d.id, d]));
          return {
            dancers: board.dancers.map((d) => {
              const p = byId.get(d.id);
              return p ? { ...p, x: p.x + sub.cx, y: p.y + sub.cy } : d;
            }),
          };
        }
        // A CODED CALL FOR THE NAMED GROUP, WHICH THE CATALOGUE HAS NO VARIANT FOR - the step calls are the
        // case, and they have no tams at all, so there is no authored path to follow. The designated dancers
        // walk STRAIGHT to the end board the WALK produced (`after` is handed in rather than re-derived, so
        // the animation cannot describe a different destination from the one the apply and the walk agreed
        // on). `interpolateSegment` is the interpolator every other coded move uses, and it is exactly right
        // for this shape: a dancer the rule does not move has `after === before` and therefore stands still,
        // and only the designated ones travel.
        //
        // A STRAIGHT LINE BETWEEN TWO IDENTICAL BOARDS DRAWS NOTHING, and that is the whole of a second real
        // defect rather than a preference. It is invisible in the boards - a call that comes back ends where
        // it started - so the step charged its full beats with every dancer still: the reported "it looks
        // applied but the dancers don't move when I scrub".
        //
        // MEASURED - `engine/test/tools/scoped-coded-animation-probe.mjs`, every coded move x the 6 whole-set
        // selections from a `Static Square`, 138 rows of which 51 apply: **28 legal steps animated as a
        // standstill**. 24 of those are the heading-only `Face *` family (0 travel by construction - they
        // pivot in place, and their boards DO differ, so they keep this branch) and `Join Hands` (0 beats),
        // leaving the four `Do Sa Do` rows - 8 beats, 0.000 travel - as the real ones. That probe IS the gate
        // for the sentence this branch is about: run against the pre-fix source it reports exactly those four,
        // and with this branch in place it is green (51 apply, 0 standstills, worst last-frame drift 0.00e+0).
        // So the fall-through below is taken exactly when this branch cannot draw the call, and the subset
        // machinery it reaches animates each matched group along its OWN authored path: for `Heads Do Sa Do`,
        // two 2-dancer variants, 3.5 units of travel where there was previously none. It still converges on
        // the applied board, because its last term is `(end - variantEnd) * t`.
        //
        // THE FALL-THROUGH MUST STAY NARROW. Making it unconditional was tried and MEASURED to break the
        // text of this very comment's first paragraph: `Trade` IS coded, its two boards differ, and its
        // straight line is what draws it. Inside a lane (`Sides Trade then Touch a Quarter then Trade`) the
        // subset machinery draws NOTHING for it - the bare call does not apply to the 4-dancer side subset -
        // so the third sub-call stood still for its 4 beats and snapped to the applied pose at the end.
        const coded = findCodedMove(name);
        if (coded) {
          const ids = this.resolveSelection(board, step.selection);
          // A DEFERRED CALL DANCED ALONE IS STILL A ROUND TRIP, and its two ends are the SAME board whenever
          // the way back was clear - so the straight interpolation above would draw nothing at all, which is
          // exactly the "the step forward dancers dont move" report. See `deferredRoundTrip`.
          if (coded.deferred && coded.deferredHalf && ids) {
            return this.deferredRoundTrip(board, coded.deferredHalf(board, ids), after, ids, beats, beats, localBeat);
          }
          // A CODED CALL WITH PARTS IS WALKED THROUGH THEM, so the animation is given each part as its own
          // segment instead of one straight line from the start board to the end. `Swing Thru` is the case:
          // its net on a wave is two 4-CYCLES, so the exchange routing never fires and two dancers walk the
          // same segment in opposite directions (measured closest pair 0.000; see `CodedMove.legs`). The legs
          // are the rule's own boards, built on the CENTRED SUBSET, and the subset is put back where it stands
          // exactly as the coded branch above does.
          if (coded.legs) {
            const sub = this.selectedSubBoard(board, step.selection);
            const legs = sub ? coded.legs(sub.board) : null;
            if (sub && legs && legs.length > 0) {
              const legBeats = beats / legs.length;
              const idx = legBeats > 0
                ? Math.max(0, Math.min(legs.length - 1, Math.floor(localBeat / legBeats)))
                : legs.length - 1;
              const from = idx === 0 ? sub.board : legs[idx - 1];
              const tf = legBeats > 0 ? Math.max(0, Math.min(1, (localBeat - idx * legBeats) / legBeats)) : 1;
              const posed = this.interpolateSegment(from, legs[idx], tf, null);
              const byId = new Map(posed.dancers.map((d) => [d.id, d]));
              return {
                dancers: board.dancers.map((d) => {
                  const p = byId.get(d.id);
                  return p ? { ...p, x: p.x + sub.cx, y: p.y + sub.cy } : d;
                }),
              };
            }
          }
          const movesSomeone = board.dancers.some((d) => {
            const e = after.dancers.find((x) => x.id === d.id);
            return !!e && Math.hypot(e.x - d.x, e.y - d.y) > 1e-9;
          });
          if (movesSomeone) {
            const t = beats > 0 ? Math.max(0, Math.min(1, localBeat / beats)) : 1;
            return this.interpolateSegment(board, after, t, null);
          }
        }
      }
    }
    // NO CATALOGUE INFO IS NOT MISSING INFORMATION HERE: a coded call for a named group has no variant and no
    // authored path to time, so the step's own cost is what the blend below runs over. (`Step Forward` never
    // reaches that blend anyway - the coded branch above returns first - but a future rule with no variant
    // should not silently animate at zero beats.)
    return this.evaluateParallelAt(board, step, info ?? { beats, variant: null }, localBeat);
  }

  /**
   * The dancers a selection names, centred on their own origin - the sub-board `applySelected` builds,
   * so a variant matched against it is the one the applicator matched. Null when the selection does not
   * resolve.
   */
  private selectedSubBoard(board: Board, selection: string): { board: Board; cx: number; cy: number } | null {
    const ids = this.resolveSelection(board, selection);
    if (!ids || ids.length === 0) return null;
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const selected = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    if (selected.length === 0) return null;
    let cx = 0, cy = 0;
    for (const d of selected) { cx += d.x; cy += d.y; }
    cx /= selected.length;
    cy /= selected.length;
    return { board: { dancers: selected.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) }, cx, cy };
  }

  /**
   * The grouping to animate with when the APPLY did not go through `parallelApply`, so it could not
   * report one. `matchingVariantInfo`'s variant tiled with the same predicate the animator uses here,
   * so this reproduces the older behaviour exactly for that case.
   */
  private animatorGrouping(
    info: { beats: number; variant: CallBundle | null },
    board: Board,
    name: string,
  ): { groups: SeqDancer[][] } | null {
    if (!info.variant) return null;
    const setup = info.variant.dancers.map((d) => this.library.variantMatchable(d));
    const phys = board.dancers.filter((d) => !d.isGhost);
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    const part = this.applicator.partition(setup, phys, tol) ?? this.applicator.partitionPartial(setup, phys, tol);
    return part ? { groups: part.groups } : null;
  }

  /**
   * Interpolate a subset/parallel call PER GROUP, following each group's own authored path.
   *
   * WHY NOT A STRAIGHT-LINE BLEND. This used to interpolate every dancer linearly from its start
   * position to its end position. That always converges, which is why it was written, but on a call
   * that SWAPS two groups across the centre it is catastrophic: `Right and Left Thru` from a Static
   * Square ends with the facing couples having exchanged sides, so every dancer's start and end are
   * diametrically opposite and the linear midpoint puts ALL EIGHT on the origin. MEASURED - closest
   * pair 0.000 at the half-beat, against 0.830 for the same call on a placement that takes the
   * whole-board path.
   *
   * So each group is animated along the authored path of the variant that tiled it, pure-relative,
   * exactly as `parallelApply` applies it. The authored end rarely equals the APPLIED end - that is
   * the non-convergence the old comment recorded - so the difference is added back proportionally:
   *
   *     pose(t) = authored(t) + (appliedEnd - authoredEnd) * t
   *
   * which is the authored path at t=0, the APPLIED board at t=1, and the authored dance in
   * between. The correction is a residual, so it cannot dominate the path the way a full blend did.
   */
  private evaluateParallelAt(board: Board, step: string | CallStep, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const name = typeof step === 'string' ? step : step.call;
    // A SCOPED STEP IS ANIMATED ON ITS SUBSET, NEVER BOARD-WIDE.
    //
    // This fell through to the whole-board path below, which poses EVERY dancer in `board` - so a
    // selection whose call the catalogue does not author for that subset moved the dancers the call
    // never touched. MEASURED: `Heads Dosado` from a `Static Square` moved all eight by 3.50, while
    // `Head Boys Dosado` (whose call IS authored for two dancers, `Opposite Boy`) correctly moved only
    // #1 and #5. The difference is not the selection machinery, it is that the 4-dancer subset finds no
    // variant, so `evaluateCallAt` reaches here.
    //
    // The subset is built and animated EXACTLY as `applySelected` applies it - same `resolveSelection`,
    // same centring on the subset's own origin, and `applyToBoardInner` on the sub-board, which is the
    // very call the applicator made - so the pose converges on the board the call actually produced.
    // Dancers outside the selection are pinned to the pose they already hold.
    if (typeof step !== 'string' && step.selection) {
      const sub = this.selectedSubBoard(board, step.selection);
      if (sub) {
        const subStep = { selection: undefined, call: name } as unknown as CallStep;
        const posed = this.animateParallelBoard(sub.board, subStep, { beats: info.beats, variant: null }, localBeat);
        const byId = new Map(posed.dancers.map((d) => [d.id, d]));
        return {
          dancers: board.dancers.map((d) => {
            const p = byId.get(d.id);
            // Put the subset back where it stands: the centring is an artefact of the lookup, not
            // part of the animation.
            return p ? { ...p, x: p.x + sub.cx, y: p.y + sub.cy } : d;
          }),
        };
      }
    }
    return this.animateParallelBoard(board, step, info, localBeat);
  }

  /**
   * Follow each tiled group's own authored path for a whole-board apply of `step`.
   *
   * Split out of `evaluateParallelAt` so a SCOPED step can reuse it on its centred subset - the same
   * motion, on a different board. It reads the grouping from the apply rather than re-deriving one.
   */
  private animateParallelBoard(board: Board, step: string | CallStep, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const name = typeof step === 'string' ? step : step.call;
    // THE STEP, not the name: a selection must be applied here exactly as `replayWalk` applied it, or
    // the animation targets a board the sequence never reached. See `evaluateCallAt`.
    const res = this.applicator.applyToBoard(board, step);
    if (!res.legal) return board;
    const beats = info.beats;
    const t = beats > 0 ? Math.max(0, Math.min(1, localBeat / beats)) : 1;
    const endById = new Map(res.board.dancers.map((d) => [d.id, d]));

    const posed = new Map<number, { x: number; y: number; heading: number }>();
    // THE GROUPING THAT WAS ACTUALLY APPLIED, taken from the apply itself rather than re-derived.
    // `matchingVariantInfo` answers the same question with a weaker predicate - it wants a FULL
    // tiling, while `parallelApply` also accepts `partitionPartial` - so the two disagree on 2 of the
    // 13 pairs `engine/test/tools/parallel-group-probe.mjs` checks, both `Right and Left Thru`. There,
    // the animator animated two groups of four where the applicator had applied ONE and left the other
    // four dancers standing; those four were then spun and dragged out and back by the residual.
    // `ApplyResult.parallel` removes the second implementation instead of keeping two in step.
    // The fallback below is for the rare apply that succeeds WITHOUT the parallel path (the implicit
    // adjustment in `applyToBoardInner`), where `info.variant` is still the best available grouping.
    const applied = res.parallel
      ? { variant: res.parallel.variant, groups: res.parallel.groups }
      : this.animatorGrouping(info, board, name);
    if (applied) {
      for (const group of applied.groups) {
        const gb: Board = { dancers: group.map((d) => ({ ...d })) };
        // SEARCH tolerance, because that is what `parallelApply`'s own sub-apply uses:
        // `applyToBoardInner(subBoard, callName, [], false, false)` matches at SEARCH_MATCH_MAX when
        // rebase is false. Matching the group at the tighter DEFAULT here left groups unmatched that
        // the parallel path HAD applied, and an unmatched group falls back to the linear blend -
        // which is the very thing this method exists to avoid.
        const m = this.matcher.findMatchingVariant(gb, name, SEARCH_MATCH_MAX + this.config.matchMargin);
        if (!m) continue;
        // Pure relative, the way the parallel path applies each subset.
        const at = this.evaluateVariantAt(gb, m, localBeat, false);
        const end = this.evaluateVariantAt(gb, m, beats, false);
        for (const d of group) {
          const a = at.dancers.find((x) => x.id === d.id);
          const ae = end.dancers.find((x) => x.id === d.id);
          const e = endById.get(d.id);
          if (!a || !ae || !e) continue;
          posed.set(d.id, {
            x: a.x + (e.x - ae.x) * t,
            y: a.y + (e.y - ae.y) * t,
            heading: normAngle(a.heading + normAngle(e.heading - ae.heading) * t),
          });
        }
      }
    }

    // A DANCER THE CALL DID NOT TOUCH DOES NOT MOVE, AND `groups` IS WHAT SAYS WHICH THOSE ARE.
    //
    // `partitionPartial` only puts a box in `groups` when it MATCHED - an anchor that cannot form a
    // matching group is left unmatched and is in no group at all - so a dancer in no group is a dancer
    // the call never reached. The pin is exact (the applied pose IS the current pose) and it is what
    // makes a SELECTION step animate ONLY the dancers the selection moved, since `applySelected` leaves
    // everyone else exactly where they stood.
    //
    // IT MUST COME AFTER THE GROUPS, because a dancer outside every group is animated by nothing else -
    // and writing it FIRST was tried and MEASURED useless, the group loop simply overwrote it
    // (unselected dancers still moved 3.16 units on `Heads Right and Left Thru`, see
    // `engine/test/tools/selection-witness-probe.mjs`). What it must not do, and used to, is overwrite a
    // group's OWN pose.
    //
    // THE TEST THAT USED TO STAND HERE WAS "THE APPLIED POSE EQUALS THE POSE IT STARTED FROM", and it
    // cannot tell a dancer the call never touched from a dancer the call RETURNS HOME. Every dancer in a
    // full-turn call is the second: a `Circle Four Left Full` from `Normal Lines` applies legally as two
    // groups of four and ends exactly where it began - which is what a full circle does - so it was
    // pinned, and the step animated as a STANDSTILL while the timeline kept its 8 beats. Reported as
    // "it looks like it's applied, but the dancers don't move when I scrub across the 8 beats it's
    // reserved". This file already had that reading written down, one function up, for the promenade:
    // "the dancers don't move, but the sequencer counts 8 beats".
    //
    // AND THE FALLBACK KEEPS THE OLD TEST, because it is the honest answer when the apply did NOT go
    // through the parallel path and so could not report a grouping: there is nothing to compare against
    // beyond the two boards.
    const touched = new Set<number>();
    if (applied) for (const g of applied.groups) for (const gd of g) touched.add(gd.id);
    for (const d of board.dancers) {
      if (touched.has(d.id)) continue;
      const e = endById.get(d.id);
      if (e && Math.hypot(e.x - d.x, e.y - d.y) < 1e-6 && Math.abs(normAngle(e.heading - d.heading)) < 1e-6) {
        posed.set(d.id, { x: d.x, y: d.y, heading: d.heading });
      }
    }

    // EVERYONE ELSE MOVES ALONG A SEGMENT, NOT A STRAIGHT LINE. A dancer covered by no group is a
    // dancer the tiling could not account for - which is the normal case for a SELECTION step whose
    // bare call does not tile the board at all (`Heads Right and Left Thru` from a squared set). The
    // straight-line blend that used to be here walks two dancers who TRADE PLACES - partners passing
    // each other, which is what `Right and Left Thru` does - through the same midpoint, i.e. through
    // each other.
    //
    // `interpolateSegment` is the coded path's answer to the same problem and is reused rather than
    // re-implemented: an EXCHANGE pair is rotated rigidly by a half turn about its own midpoint, so the
    // two stay diametrically opposite for the whole segment and land exactly swapped at t = 1. A dancer
    // that is not half of an exchange still gets the straight line, so nothing that worked changes.
    //
    // MEASURED, and worth recording for its SIZE: across the 1607-module corpus this changes exactly ONE
    // module (`modules/static_set/resolve/2728.json`, minimum closest pair 0.00 -> 1.00 - a real
    // collapse, fixed) and leaves the other 1061 that come inside 1.0 unit untouched. So it is a strict
    // improvement, and it is NOT the explanation for the coincident band moving 73 -> 103 when the
    // selection fix landed: that hypothesis is disproved by this measurement, not merely unproven.
    const free = board.dancers.filter((d) => !posed.has(d.id) && endById.has(d.id));
    if (free.length) {
      const from: Board = { dancers: free.map((d) => ({ ...d })) };
      const to: Board = { dancers: free.map((d) => ({ ...endById.get(d.id)! })) };
      for (const d of this.interpolateSegment(from, to, t, null).dancers) {
        posed.set(d.id, { x: d.x, y: d.y, heading: d.heading });
      }
    }

    return {
      dancers: board.dancers.map((d) => {
        const p = posed.get(d.id);
        if (p) return { ...d, ...p };
        return d;
      }),
    };
  }

  /** Which call in `flat` is playing at global `beat`, with its matched variant
   * and the board->variant mapping. Returns null past the end of the sequence.
   * Replays from `startBoard` (default: the home squared set). */
  sequenceInfo(flat: ModuleStep[], beat: number, startBoard?: Board): { name: string; variant: CallBundle; mapping: number[] } | null {
    let acc = 0;
    for (const s of this.replayWalk(flat, startBoard)) {
      if (!s.walkable) return null;
      if (beat < acc + s.beats) {
        // A coded move has no authored path, so there is no trail to trace while it plays.
        if (s.coded) return null;
        const whole = this.matcher.findMatchingVariant(s.before, s.name, DEFAULT_MATCH_MAX + this.config.matchMargin);
        if (whole) return { name: s.name, variant: whole.variant, mapping: whole.mapping };
        return null;
      }
      acc += s.beats;
    }
    return null;
  }

  /** The board part-way through a call. `rebase` must match how the COMPLETED
   * call is applied (applicator.applyWholeBoard): the whole-board path re-bases,
   * the parallel-subset path is pure relative. Getting this wrong makes the
   * animated frames fail to converge to the board the call actually produces, so
   * the dancers jump on the final beat. */
  private evaluateVariantAt(board: Board, m: VariantMatch, localBeat: number, rebase = true): Board {
    const { variant, mapping } = m;
    const f = rebase ? this.config.rebaseFactor : 0;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const cur = poseFor(t, Math.min(localBeat, dancerBeats(t)));
      const localDisp = localMotion(start, cur, m.reflect);
      const delta = normAngle(cur.heading - start.heading);
      const base = rebasedPose(start, m);
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta) };
    });
    return { dancers: newDancers };
  }

  // ------------------------------------------------------------- 64-beat / phrases

  /** Number of 16-beat phrases a beat count fills (ceil). */
  phrasesForBeats(beats: number): number {
    return Math.ceil(beats / 16);
  }

  /** Validate that a flat call sequence sums to a 64-beat singing-call segment. */
  validateSegment(flat: ModuleStep[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
    const totalBeats = this.sequenceBeats(flat);
    const phrases = this.phrasesForBeats(totalBeats);
    const remainder = totalBeats % 64;
    return { totalBeats, phrases, complete64: remainder === 0, remainder };
  }

  /** Whether a flat call sequence is a "zero": it returns the set to the home
   * squared set — positions, relationships AND facings all restored.
   *
   * The facing check matters: fasrKey is derived from POSITIONS only (sequence
   * parity plus partner/corner relationships), so on its own it reports a pure
   * in-place pivot as a zero even though the set no longer faces the way it
   * started. Every dancer must be back on its own facing, compared by identity.
   */
  isZero(flat: ModuleStep[]): boolean {
    const home = makeSquaredSet();
    let board = cloneBoard(home);
    for (const name of flat) {
      // A grouped ("while") step has no single call to look up, so it can never be a coded move and
      // goes straight to the applicator - which is also what applies it in the walk.
      const coded = isGroupStep(name) ? null : findCodedMove(stepCall(name)!);
      if (coded) {
        // A resolve that does not apply here is not a zero - reporting one would be
        // a false positive, so the replay fails loudly instead.
        if (!codedMoveApplies(coded, board)) return false;
        board = coded.apply(board);
        continue;
      }
      const r = isGroupStep(name) ? this.applicator.applyStep(board, name) : this.applicator.applyToBoard(board, name);
      if (!r.legal) return false;
      board = r.board;
    }
    if (fasrKey(board) !== homeFasrKey()) return false;
    return this.sameFacing(home, board);
  }

  /** Whether every physical dancer on `board` faces the way it did on
   * `reference`, compared by id and modulo a full turn. */
  private sameFacing(reference: Board, board: Board): boolean {
    const ref = new Map(reference.dancers.filter((d) => !d.isGhost).map((d) => [d.id, d]));
    for (const d of board.dancers) {
      if (d.isGhost) continue;
      const r = ref.get(d.id);
      if (!r) return false;
      if (Math.abs(normAngle(d.heading - r.heading)) > FACING_EPS) return false;
    }
    return true;
  }

  /** Build a tip: a sequence of figures that is itself a zero and fits the 64-beat
   * segment structure. */
  buildTip(figures: string[][]): { calls: string[]; legal: boolean; totalBeats: number; phrases: number; complete64: boolean; reason?: string } {
    const flat = this.library.flatten(figures.flat());
    const labels = flat.map((c) => stepLabel(c));
    if (!this.isZero(flat)) {
      return { calls: labels, legal: false, totalBeats: 0, phrases: 0, complete64: false, reason: 'tip is not a zero (does not return home in-sequence)' };
    }
    const seg = this.validateSegment(flat);
    return { calls: labels, legal: true, totalBeats: seg.totalBeats, phrases: seg.phrases, complete64: seg.complete64 };
  }
}
