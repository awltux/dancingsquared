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
import { findCodedMove, codedMoveApplies, type CodedMove } from './coded-moves.js';
import { fasrKey, homeFasrKey } from './fasr.js';
import type { Board, CallStep, SeqDancer, VariantMatch } from './types.js';
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
  /** The raw step, kept so the applicator can be handed the CallStep form. */
  raw: string | CallStep;
  /** The call/selection label. */
  name: string;
  /** The coded move this step is, or null when it is a catalogue call. */
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
}

/** The memo key: the CONTENT of the flat sequence and of the board the replay starts from. */
function replayKey(flat: (string | CallStep)[], start: Board): string {
  const f = flat.map((s) => (typeof s === 'string' ? s : `${s.call}@${s.selection ?? ''}`)).join('\u0000');
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

  /** Beats of the variant of `name` that matches `board` (0 if none). A coded
   * body-relative move always takes CODED_MOVE_BEATS. */
  stepBeats(board: Board, name: string | CallStep): number {
    const n = typeof name === 'string' ? name : name.call;
    const coded = findCodedMove(n);
    if (coded) return coded.beats;
    const v = this.matchingVariantInfo(board, n);
    return v ? v.beats : 0;
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
      return this.interpolateSegment(from, legs[idx], tf, false);
    }
    const t = Math.max(0, Math.min(1, move.beats > 0 ? localBeat / move.beats : 1));
    return this.interpolateSegment(board, move.apply(board), t, !!move.ringMove);
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
   */
  private interpolateSegment(board: Board, end: Board, t: number, ring: boolean): Board {
    const endById = new Map(end.dancers.map((d) => [d.id, d]));
    const phys = board.dancers.filter((d) => !d.isGhost);
    const cx = phys.length ? phys.reduce((s, d) => s + d.x, 0) / phys.length : 0;
    const cy = phys.length ? phys.reduce((s, d) => s + d.y, 0) / phys.length : 0;
    const shortest = (from: number, to: number) => normAngle(to - from);

    // EXCHANGE PAIRS: i ends where j started and j ends where i started. The tolerance is loose
    // because the ends are snapped board positions, and a pair whose dancers were further apart than
    // this is not an exchange of neighbours.
    const EXCH = 0.35;
    const partner = new Map<number, number>();
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

    const straight = (d: Board['dancers'][number], e: Board['dancers'][number], heading: number) => ({
      ...d, x: d.x + (e.x - d.x) * t, y: d.y + (e.y - d.y) * t, heading,
    });

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
        // Each dancer takes its OWN shortest sweep. A common sweep was tried and MEASURED WORSE on
        // the case that prompted this (0.098 against 0.303), because that board is not a rigid
        // rotation of the square - see the probe, which shows partners needing opposite sweeps and
        // standing 5.8 apart. Forcing one angle then drags half the set across the other half.
        const a = as + shortest(as, ae) * t;
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
  ): { beats: number; variant: CallBundle | null } | null {
    const m = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
    if (m) return { beats: Math.max(...m.variant.dancers.map((d) => dancerBeats(d))), variant: m.variant };
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    const variants = this.library.matchableVariants(name);
    {
      const phys = board.dancers.filter((d) => !d.isGhost);
      const n = phys.length;
      for (const v of variants) {
        const setup = v.dancers.map((d) => this.library.variantMatchable(d));
        const k = setup.length;
        if (k <= 1 || k >= n || n % k !== 0) continue;
        if (this.applicator.partitionExists(setup, phys, tol)) {
          return { beats: Math.max(...v.dancers.map((d) => dancerBeats(d))), variant: v };
        }
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
   * It records to the END of `flat` unless a coded move's precondition fails, which stops BOTH
   * consumers and therefore stops the recording.
   */
  private replayWalk(flat: (string | CallStep)[], startBoard?: Board): ReplayStep[] {
    const start = this.replayStart(startBoard);
    const key = replayKey(flat, start);
    if (this.replayMemo && this.replayMemo.key === key) return this.replayMemo.steps;

    const steps: ReplayStep[] = [];
    let board = start;
    for (const raw of flat) {
      const name = typeof raw === 'string' ? raw : raw.call;
      const coded = findCodedMove(name);
      if (coded) {
        const ok = codedMoveApplies(coded, board);
        const after = ok ? coded.apply(board) : board;
        steps.push({ raw, name, coded, info: null, before: board, after, beats: ok ? coded.beats : 0, walkable: ok });
        if (!ok) break;
        board = after;
        continue;
      }
      const info = this.matchingVariantInfo(board, name);
      const r = this.applicator.applyToBoard(board, raw);
      const after = r.legal ? r.board : board;
      steps.push({ raw, name, coded: null, info, before: board, after, beats: info ? info.beats : 0, walkable: info !== null });
      board = after;
    }
    this.replayMemo = { key, steps };
    return steps;
  }

  /** Total beats to play a flat sequence, starting from `startBoard` (default:
   * the home squared set). */
  sequenceBeats(flat: (string | CallStep)[], startBoard?: Board): number {
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
  evaluateSequence(flat: (string | CallStep)[], beat: number, startBoard?: Board): { board: Board; beats: number } {
    let acc = 0;
    let board = this.replayStart(startBoard);
    for (const s of this.replayWalk(flat, startBoard)) {
      // Both stop kinds end the walk here, leaving the step's own start board.
      if (!s.walkable) return { board: s.before, beats: acc };
      if (beat < acc + s.beats) {
        const evBoard = s.coded
          ? this.evaluateCodedAt(s.before, s.coded, beat - acc)
          : this.evaluateCallAt(s.before, s.name, s.info!, beat - acc);
        return { board: evBoard, beats: 0 };
      }
      board = s.after;
      acc += s.beats;
    }
    return { board, beats: acc };
  }

  /** Place the board at a local beat of a call.
   *
   * A WHOLE-BOARD call follows its authored path, which converges on the board the
   * call produces. A call that only applies via the subset/parallel path does not: the parallel
   * path partitions the board at its own tolerance and runs each group with pure-relative motion. */
  private evaluateCallAt(board: Board, name: string, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const whole = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
    if (whole) return this.evaluateVariantAt(board, whole, localBeat);
    return this.evaluateParallelAt(board, name, info, localBeat);
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
  private evaluateParallelAt(board: Board, name: string, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const res = this.applicator.applyToBoard(board, name);
    if (!res.legal) return board;
    const beats = info.beats;
    const t = beats > 0 ? Math.max(0, Math.min(1, localBeat / beats)) : 1;
    const endById = new Map(res.board.dancers.map((d) => [d.id, d]));

    const posed = new Map<number, { x: number; y: number; heading: number }>();
    // The variant `matchingVariantInfo` chose is the one `parallelApply` would too - same catalogue
    // order, same tiling predicate - so partitioning with it reproduces the grouping that was
    // APPLIED. The residual below converges on the applied board regardless, so a mismatch here
    // would cost path fidelity, not correctness.
    if (info.variant) {
      const setup = info.variant.dancers.map((d) => this.library.variantMatchable(d));
      const phys = board.dancers.filter((d) => !d.isGhost);
      const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
      const part = this.applicator.partition(setup, phys, tol) ?? this.applicator.partitionPartial(setup, phys, tol);
      for (const group of part?.groups ?? []) {
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

    return {
      dancers: board.dancers.map((d) => {
        const p = posed.get(d.id);
        if (p) return { ...d, ...p };
        // Not covered by any group (a tiling that did not happen, or a ghost): keep the old blend
        // so the frame still lands on the applied board.
        const e = endById.get(d.id);
        if (!e) return d;
        return {
          ...d,
          x: d.x + (e.x - d.x) * t,
          y: d.y + (e.y - d.y) * t,
          heading: normAngle(d.heading + normAngle(e.heading - d.heading) * t),
        };
      }),
    };
  }

  /** Which call in `flat` is playing at global `beat`, with its matched variant
   * and the board->variant mapping. Returns null past the end of the sequence.
   * Replays from `startBoard` (default: the home squared set). */
  sequenceInfo(flat: (string | CallStep)[], beat: number, startBoard?: Board): { name: string; variant: CallBundle; mapping: number[] } | null {
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
  validateSegment(flat: (string | CallStep)[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
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
  isZero(flat: (string | CallStep)[]): boolean {
    const home = makeSquaredSet();
    let board = cloneBoard(home);
    for (const name of flat) {
      const label = typeof name === 'string' ? name : name.call;
      const coded = findCodedMove(label);
      if (coded) {
        // A resolve that does not apply here is not a zero - reporting one would be
        // a false positive, so the replay fails loudly instead.
        if (!codedMoveApplies(coded, board)) return false;
        board = coded.apply(board);
        continue;
      }
      const r = this.applicator.applyToBoard(board, name);
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
    if (!this.isZero(flat)) {
      return { calls: flat.map((c) => (typeof c === 'string' ? c : c.call)), legal: false, totalBeats: 0, phrases: 0, complete64: false, reason: 'tip is not a zero (does not return home in-sequence)' };
    }
    const seg = this.validateSegment(flat);
    return { calls: flat.map((c) => (typeof c === 'string' ? c : c.call)), legal: true, totalBeats: seg.totalBeats, phrases: seg.phrases, complete64: seg.complete64 };
  }
}
