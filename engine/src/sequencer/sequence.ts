// SequenceAnalyzer: reads/animates a flat call sequence. Computes total beats,
// evaluates the board at an arbitrary beat, and validates the 64-beat singing-call
// segment / tip / zero structure. Pure over a board: it starts from the home set
// and advances via the CallApplicator, so it holds no mutable state.

import { dancerBeats, poseFor } from '../core.js';
import { FormationMatcher, rebasedPose } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from './constants.js';
import { normAngle } from './identity.js';
import { makeSquaredSet } from './board.js';
import { fasrKey, homeFasrKey } from './fasr.js';
import type { Board, SeqDancer, VariantMatch } from './types.js';
import type { CallBundle } from '../types.js';

const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export class SequenceAnalyzer {
  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly applicator: CallApplicator,
    private readonly config: SequencerConfig,
  ) {}

  /** Beats of the variant of `name` that matches `board` (0 if none). */
  stepBeats(board: Board, name: string): number {
    const v = this.matchingVariantInfo(board, name);
    return v ? v.beats : 0;
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

  /** Total beats to play a flat sequence starting from home. */
  sequenceBeats(flat: string[]): number {
    let board = makeSquaredSet();
    let total = 0;
    for (const name of flat) {
      total += this.stepBeats(board, name);
      const r = this.applicator.applyToBoard(board, name);
      if (r.legal) board = r.board;
    }
    return total;
  }

  /** Evaluate the board at a global beat of a flat sequence, starting from home. */
  evaluateSequence(flat: string[], beat: number): { board: Board; beats: number } {
    let board = makeSquaredSet();
    let acc = 0;
    for (const name of flat) {
      const info = this.matchingVariantInfo(board, name);
      if (!info) break;
      const beats = info.beats;
      if (beat < acc + beats) {
        const evBoard = this.evaluateCallAt(board, name, info, beat - acc);
        return { board: evBoard, beats: 0 };
      }
      const r = this.applicator.applyToBoard(board, name);
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
   * and the board->variant mapping. Returns null past the end of the sequence. */
  sequenceInfo(flat: string[], beat: number): { name: string; variant: CallBundle; mapping: number[] } | null {
    let board = makeSquaredSet();
    let acc = 0;
    for (const name of flat) {
      const info = this.matchingVariantInfo(board, name);
      if (!info) return null;
      const beats = info.beats;
      if (beat < acc + beats) {
        const whole = this.matcher.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.config.matchMargin);
        if (whole) return { name, variant: whole.variant, mapping: whole.mapping };
        return null;
      }
      const r = this.applicator.applyToBoard(board, name);
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
  validateSegment(flat: string[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
    const totalBeats = this.sequenceBeats(flat);
    const phrases = this.phrasesForBeats(totalBeats);
    const remainder = totalBeats % 64;
    return { totalBeats, phrases, complete64: remainder === 0, remainder };
  }

  /** Whether a flat call sequence is a "zero": it starts and ends at home
   * (in-sequence squared set). */
  isZero(flat: string[]): boolean {
    let board = makeSquaredSet();
    for (const name of flat) {
      const r = this.applicator.applyToBoard(board, name);
      if (!r.legal) return false;
      board = r.board;
    }
    return fasrKey(board) === homeFasrKey();
  }

  /** Build a tip: a sequence of figures that is itself a zero and fits the 64-beat
   * segment structure. */
  buildTip(figures: string[][]): { calls: string[]; legal: boolean; totalBeats: number; phrases: number; complete64: boolean; reason?: string } {
    const flat = this.library.flatten(figures.flat());
    if (!this.isZero(flat)) {
      return { calls: flat, legal: false, totalBeats: 0, phrases: 0, complete64: false, reason: 'tip is not a zero (does not return home in-sequence)' };
    }
    const seg = this.validateSegment(flat);
    return { calls: flat, legal: true, totalBeats: seg.totalBeats, phrases: seg.phrases, complete64: seg.complete64 };
  }
}
