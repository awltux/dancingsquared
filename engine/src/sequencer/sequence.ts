// SequenceAnalyzer: reads/animates a flat call sequence. Computes total beats,
// evaluates the board at an arbitrary beat, and validates the 64-beat singing-call
// segment / tip / zero structure. Pure over a board: it advances via the
// CallApplicator and holds no mutable state.
//
// The REPLAY evaluators (sequenceBeats / evaluateSequence / sequenceInfo) replay
// a flat sequence from a START BOARD. That start board defaults to the home
// squared set, but a caller may pass the board the sequence actually began from -
// e.g. a board jumped to with setFormation - so playback and export agree with
// what is on screen. The tip-structure helpers (isZero / buildTip /
// validateSegment) are intrinsically home-anchored and never take one.

import { dancerBeats, poseFor } from '../core.js';
import { FormationMatcher, rebasedPose } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from './constants.js';
import { normAngle } from './identity.js';
import { makeSquaredSet, cloneBoard } from './board.js';
import { findCodedMove, type CodedMove } from './coded-moves.js';
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

export class SequenceAnalyzer {
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

  /** The board part-way through a coded move: positions are unchanged (these are
   * pivots/re-facings) and each dancer's heading rotates smoothly from its current
   * facing to the move's end facing, so the pivot animates rather than snapping. */
  private evaluateCodedAt(board: Board, move: CodedMove, localBeat: number): Board {
    const t = Math.max(0, Math.min(1, move.beats > 0 ? localBeat / move.beats : 1));
    const end = move.apply(board);
    const endById = new Map(end.dancers.map((d) => [d.id, d]));
    return {
      dancers: board.dancers.map((d) => {
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
    const variants = this.library.getVariants(name);
    if (variants) {
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

  /** Total beats to play a flat sequence, starting from `startBoard` (default:
   * the home squared set). */
  sequenceBeats(flat: (string | CallStep)[], startBoard?: Board): number {
    let board = this.replayStart(startBoard);
    let total = 0;
    for (const name of flat) {
      const label = typeof name === 'string' ? name : name.call;
      total += this.stepBeats(board, label);
      const coded = findCodedMove(label);
      if (coded) {
        board = coded.apply(board);
        continue;
      }
      const r = this.applicator.applyToBoard(board, name);
      if (r.legal) board = r.board;
    }
    return total;
  }

  /** Evaluate the board at a global beat of a flat sequence, starting from
   * `startBoard` (default: the home squared set). */
  evaluateSequence(flat: (string | CallStep)[], beat: number, startBoard?: Board): { board: Board; beats: number } {
    let board = this.replayStart(startBoard);
    let acc = 0;
    for (const raw of flat) {
      const callName = typeof raw === 'string' ? raw : raw.call;
      // Coded body-relative moves animate as a smooth pivot from the live board.
      const coded = findCodedMove(callName);
      if (coded) {
        if (beat < acc + coded.beats) return { board: this.evaluateCodedAt(board, coded, beat - acc), beats: 0 };
        board = coded.apply(board);
        acc += coded.beats;
        continue;
      }
      const info = this.matchingVariantInfo(board, callName);
      if (!info) break;
      const beats = info.beats;
      if (beat < acc + beats) {
        const evBoard = this.evaluateCallAt(board, callName, info, beat - acc);
        return { board: evBoard, beats: 0 };
      }
      const r = this.applicator.applyToBoard(board, raw);
      if (r.legal) board = r.board;
      acc += beats;
    }
    return { board, beats: acc };
  }

  /** Place the board at a local beat of a call, handling BOTH whole-board and
   * parallel-subset calls. */
  private evaluateCallAt(board: Board, name: string, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const whole = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
    if (whole) return this.evaluateVariantAt(board, whole, localBeat);
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const ghosts = board.dancers.filter((d) => d.isGhost);
    const n = phys.length;
    for (const v of this.library.getVariants(name) ?? []) {
      const setup = v.dancers.map((d) => this.library.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= n || n % k !== 0) continue;
      const part = this.applicator.partition(setup, phys, tol);
      if (!part) continue;
      const merged: SeqDancer[] = [];
      for (const group of part.groups) {
        const subBoard: Board = { dancers: group.map((d) => ({ ...d })) };
        const subWhole = this.matcher.findMatchingVariant(subBoard, name, tol);
        if (!subWhole) { merged.push(...group); continue; }
        merged.push(...this.evaluateVariantAt(subBoard, subWhole, localBeat).dancers);
      }
      return { dancers: [...merged, ...ghosts] };
    }
    return board;
  }

  /** Which call in `flat` is playing at global `beat`, with its matched variant
   * and the board->variant mapping. Returns null past the end of the sequence.
   * Replays from `startBoard` (default: the home squared set). */
  sequenceInfo(flat: (string | CallStep)[], beat: number, startBoard?: Board): { name: string; variant: CallBundle; mapping: number[] } | null {
    let board = this.replayStart(startBoard);
    let acc = 0;
    for (const raw of flat) {
      const callName = typeof raw === 'string' ? raw : raw.call;
      const coded = findCodedMove(callName);
      if (coded) {
        // A coded pivot has no authored path, so there is no trail to trace while
        // it plays; the replay still continues past it.
        if (beat < acc + coded.beats) return null;
        board = coded.apply(board);
        acc += coded.beats;
        continue;
      }
      const info = this.matchingVariantInfo(board, callName);
      if (!info) return null;
      const beats = info.beats;
      if (beat < acc + beats) {
        const whole = this.matcher.findMatchingVariant(board, callName, DEFAULT_MATCH_MAX + this.config.matchMargin);
        if (whole) return { name: callName, variant: whole.variant, mapping: whole.mapping };
        return null;
      }
      const r = this.applicator.applyToBoard(board, raw);
      if (r.legal) board = r.board;
      acc += beats;
    }
    return null;
  }

  private evaluateVariantAt(board: Board, m: VariantMatch, localBeat: number): Board {
    const { variant, mapping } = m;
    const f = this.config.rebaseFactor;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const cur = poseFor(t, Math.min(localBeat, dancerBeats(t)));
      const localDisp = rot(-start.heading, { x: cur.x - start.x, y: cur.y - start.y });
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
