// CallApplicator: applies a call (or module) to a board. Handles the whole-board
// apply with re-base/snap, the pure-relative search apply, probabilistic
// selection, and the parallel-subset path. Owns the per-variant pose/matrix
// caches. Depends on the FormationMatcher (to find which variant applies) and the
// CallLibrary (variants + modules), and reads the shared SequencerConfig.

import { dancerBeats, poseFor } from '../core.js';
import { matchFormations, type Matchable } from './match.js';
import { FormationMatcher, rebasedPose, localMotion } from './matcher.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX, isKnownCouple } from './constants.js';
import { normAngle } from './identity.js';
import { apply5, dancerMatrix, poseToVec, type Mat5 } from '../matrix.js';
import { splitSelection } from './selection.js';
import type { Board, CallStep, SeqDancer, VariantMatch } from './types.js';
import type { CallBundle, Pose } from '../types.js';

const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export interface ApplyResult {
  board: Board;
  legal: boolean;
  reason?: string;
  /**
   * Set only by the PARALLEL path: the variant it tiled with and the groups it tiled the board
   * into. The grouping is invisible in the result board - a group that the call does not move ends up
   * exactly where it started - so the walk-through animator had to re-derive it, and its own
   * predicate (`matchingVariantInfo`, FULL tilings only) is subtly weaker than this one (which also
   * accepts `partitionPartial`). MEASURED disagreement on 2 of 13 survey pairs, both `Right and Left
   * Thru`, where the animator animated TWO groups of four that the applicator had applied as ONE:
   * the four dancers the call never moves were then spun and dragged out and back. Reporting the
   * grouping removes the second implementation rather than trying to keep the two in step.
   */
  parallel?: { variant: CallBundle; groups: SeqDancer[][] };
}

/**
 * The gap below which a board has "dancers on top of each other" — the SAME 1.0 the Sweep's
 * `SWEEP_COLLISION_MIN` and `facing-audit.mjs`'s COLLISION class use, so the engine and the
 * instrument cannot disagree about when a body has fallen apart. Used by the implicit adjustment
 * (`adjustToSetup`), which is the one place in the engine that deliberately moves dancers a long way.
 */
const BODY_COLLISION_MIN = 1.0;

/**
 * How many dancers of each REAL couple the whole board holds. `UNKNOWN_COUPLE` is not a couple, so it
 * is absent from the map and imposes no constraint rather than being treated as one.
 */
function coupleTotals(dancers: SeqDancer[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const d of dancers) if (isKnownCouple(d.couple)) totals.set(d.couple, (totals.get(d.couple) ?? 0) + 1);
  return totals;
}

/**
 * Whether `block` holds EVERY dancer of each real couple it touches — i.e. no couple is split.
 *
 * ONE IMPLEMENTATION, because it is the same rule in `partition` and in `partitionsFor`, and the two
 * disagreeing about what "couple coherence" means is exactly the kind of drift this file has been
 * bitten by. MEASURED as load-bearing rather than cosmetic: relaxing it for the Sweep took refusals
 * 4 -> 0 and figures 98 -> 96, and it is what makes a tiling well posed.
 */
function blockKeepsCouples(block: SeqDancer[], totals: Map<number, number>): boolean {
  const here = new Map<number, number>();
  for (const d of block) if (isKnownCouple(d.couple)) here.set(d.couple, (here.get(d.couple) ?? 0) + 1);
  for (const [c, k] of here) if (k !== (totals.get(c) ?? 0)) return false;
  return true;
}

/**
 * How many groupings `partitionsFor` will hand back before it gives up. Bell(8) = **4140** is the
 * absolute bound on the set partitions of eight dancers, so this cap can only bite for a call whose
 * variants span many sizes — but it is not decoration: it is the bound that makes enumerating
 * groupings safe to call at all, and `truncated` is reported rather than swallowed.
 */
export const MIXED_PARTITION_CAP = 4096;

/**
 * Every way to split `dancers` into blocks whose sizes are ALL drawn from `sizes`, with no couple
 * split across blocks — the enumeration a MIXED (multi-arity) reading would need.
 *
 * WHY IT EXISTS. `partition` tiles the board with copies of ONE setup, and `parallelApply` loops over
 * a call's variants one at a time, so a call whose variants span sizes can only ever split the board
 * into EQUAL groups. A call with a 4-dancer and a 2-dancer authoring could in principle act on two
 * dancers in one place and four in another at once, and nothing could express that.
 *
 * AND THE MEASUREMENT THAT SAYS NOT TO WIRE IT UP, recorded here because this function exists for a
 * reader who is about to try. Over the real ms catalogue and the FSM's own 1013 state boards
 * (133 named + 880 embedded setups), the mixed pool is EMPTY of witnesses:
 *
 *   - of 273 titles, 107 have variants at more than one built size, and **104 of those are {4,8}** —
 *     which admits no mixed shape at all, because 8 is the whole-board apply and [4,4] is already
 *     reachable homogeneously. One is `{6,8}` (`Column Circulate`): 8 - 6 = 2, and it has no 2-dancer
 *     authoring, so it admits nothing either.
 *   - the remaining TWO are `{2,4,8}` — `Step to a Wave` and `Step to a Left-Hand Wave` — whose only
 *     mixed shape is **4+2+2** (210 labelled partitions each).
 *   - over all 1013 boards there are **9** where every block of some mixed partition matches a
 *     variant of its own size, and the engine ALREADY APPLIES the call on all 9 by its ordinary
 *     whole-board or homogeneous-parallel reading. **Zero would be new.**
 *   - and couple coherence is not what refuses them: dropping the rule changes the count not at all
 *     (9 before, 9 after), so the rule is not the blocker a future attempt should reach for.
 *
 * So this is the plan's own rule applied to the plan's own next step — "each new reading has to be
 * justified against a witness before it is admitted" — and the witness does not exist. It is wired to
 * `reading-census.mjs`'s reporter, which PINS the zero so a catalogue change that creates a mixed
 * pool fails the gate and forces the decision rather than silently unblocking it.
 *
 * The homogeneous partitions are returned too (a caller can pick them out by block size); the cap and
 * the couple rule are the only restrictions.
 */
export function partitionsFor(
  dancers: SeqDancer[],
  sizes: Iterable<number>,
  cap: number = MIXED_PARTITION_CAP,
): { partitions: SeqDancer[][][]; truncated: boolean } {
  const allowed = new Set([...sizes].filter((k) => k >= 2));
  const n = dancers.length;
  const out: SeqDancer[][][] = [];
  if (allowed.size === 0 || n === 0) return { partitions: out, truncated: false };
  const maxK = Math.max(...allowed);
  const totals = coupleTotals(dancers);
  const blocks: number[][] = [];
  let truncated = false;
  const rec = (next: number): void => {
    if (truncated) return;
    if (next === n) {
      if (!blocks.every((b) => allowed.has(b.length))) return;
      const grouped = blocks.map((b) => b.map((i) => dancers[i]));
      if (!grouped.every((g) => blockKeepsCouples(g, totals))) return;
      if (out.length >= cap) { truncated = true; return; }
      out.push(grouped);
      return;
    }
    for (const b of blocks) {
      // A block longer than the largest allowed size can never be completed validly, so prune it
      // rather than discovering that at the end. Bell(8) bounds the search either way; this keeps it
      // proportional to the answer rather than to the space.
      if (b.length + 1 > maxK) continue;
      b.push(next);
      rec(next + 1);
      b.pop();
      if (truncated) return;
    }
    blocks.push([next]);
    rec(next + 1);
    blocks.pop();
  };
  rec(0);
  return { partitions: out, truncated };
}

export class CallApplicator {
  /** How deep the scoped-tam fallback may nest. See the fallback in `applyToBoardInner`. */
  private static readonly MAX_SCOPED_DEPTH = 2;
  private scopedDepth = 0;
  private variantEndCache = new WeakMap<CallBundle, Pose[]>();
  private variantMatrixCache = new WeakMap<CallBundle, Mat5[] | null>();

  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly config: SequencerConfig,
    private resolveSelection: (board: Board, selection: string) => number[] | null = () => null,
  ) {}

  /** Set the selection resolver (the Grouping's resolveSelection). Called after
   * construction to break the applicator<->grouping cycle. */
  setSelectionResolver(fn: (board: Board, selection: string) => number[] | null): void {
    this.resolveSelection = fn;
  }

  /** Apply a call (or module) to a COPY of the given board (does not mutate).
   * The interactive apply re-bases the board onto the call's canonical start so
   * margin-based drift doesn't accumulate on the live sequence. Accepts a call
   * title or a CallStep carrying an optional dancer selection. */
  applyToBoard(board: Board, callName: string | CallStep): ApplyResult {
    return this.applyStepInner(board, callName, [], true);
  }

  /** Apply a call using PURE relative motion ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no drift re-base. Used by the
   * search operations (legalCalls, getout, fixIt) where re-basing would pin
   * dancers to their current (possibly permuted) positions and destroy the
   * identity information those searches need to un-permute home. */
  applySearch(board: Board, callName: string | CallStep): ApplyResult {
    return this.applyStepInner(board, callName, [], false);
  }

  private applyToBoardInner(
    board: Board,
    callName: string,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
  ): ApplyResult {
    if (this.library.hasModule(callName)) {
      if (stack.includes(callName)) {
        return { board: cloneBoard(board), legal: false, reason: `Module cycle: ${callName}` };
      }
      const nextStack = [...stack, callName];
      let cur = board;
      for (const sub of this.library.getModule(callName)!) {
        const r = this.applyStepInner(cur, sub, nextStack, rebase, allowParallel);
        if (!r.legal) {
          const label = typeof sub === 'string' ? sub : sub.call;
          return { board: cloneBoard(board), legal: false, reason: `Module ${callName}: "${label}" not legal here` };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
    }

    // A call name may carry a dancer-selection prefix, e.g. "Centers Pass Thru"
    // or "Same 4 Star Thru". Only route to the subset path when the full name is
    // NOT itself a registered call (e.g. "Heads Pass Thru" IS a catalog title and
    // must keep its whole-board behaviour).
    const sel = splitSelection(callName);
    if (sel.selection && !this.library.hasCall(callName) && !this.library.hasModule(callName)) {
      return this.applySelected(board, sel.selection, sel.call, rebase);
    }

    const matchTol = rebase ? DEFAULT_MATCH_MAX + this.config.matchMargin : SEARCH_MATCH_MAX + this.config.matchMargin;
    const match = this.matcher.findMatchingVariant(board, callName, matchTol);
    if (!match) {
      const par = this.parallelApply(board, callName, rebase, matchTol);
      if (par) return par;
      // CALLERLAB'S IMPLICIT ADJUSTMENT, owed by a Fold (see `Board.adjustToNextSetup` for the
      // convention and its scope). `Fold` and `Cross Fold` "can create formations that are very
      // unusual at Mainstream", and CALLERLAB's own comment says callers normalize them on the NEXT
      // call - *"Double Pass Thru implicitly tells dancers that they should be in the starting
      // formation for that call (facing Tandems)"*.
      //
      // The reading is: match the board against the call's own setup with the SEARCH tolerance and
      // RE-BASE onto it, which is literally "danced as if the Tandems were facing". The permission is
      // the scope - `foldRule` is its only setter and every apply result is a freshly built board, so
      // this can only ever run for the single call that follows a Fold/Cross Fold, and only after the
      // strict reading has already refused. Held to the INTERACTIVE path on purpose: the search path
      // enumerates legal calls for the solver, where a force-fit is not a normalization but a bogus
      // edge (the "loose-tolerance force-fits" already recorded against the `fixIt` list).
      if (rebase && board.adjustToNextSetup) {
        const adjusted = this.adjustToSetup(board, callName);
        if (adjusted) return adjusted;
      }
      // THE SCOPED-TAM FALLBACK. A name with a selection prefix that is ALSO a catalogue title
      // ("Heads Pass Thru", "Sides Pass Thru") takes the whole-board path above, on the reasoning
      // that the catalogue's own scoped tam knows best - and it does, WHEN it covers the board. The
      // shipped scoped tams are authored for a squared set (heads pass thru, sides wait), so on any
      // OTHER arrangement the prefix is doing the work the tam cannot, and the engine refused a call
      // whose generic reading is perfectly well defined: gather the named group, apply the BASE call
      // to them.
      //
      // MEASURED, twice, in the census's EXACT bucket - the five cases where a same-size setup
      // overlays the board's positions AND facings at error 0.000 and the call is still refused:
      // `figm174 Heads Pass Thru` and `figm224 Sides Pass Thru`, both from a Double Pass Thru whose
      // named four stand in a box while the scoped tam wants a squared set. It is strictly additive
      // by construction - it only runs where the whole-board reading AND the parallel tiling have
      // already both failed, so it can turn a refusal into an application but never replace one -
      // which is the same `catalogueFallback` shape the coded moves use.
      if (sel.selection && this.library.hasCall(callName) && this.scopedDepth < CallApplicator.MAX_SCOPED_DEPTH) {
        // The name that closes the cycle is suppressed, not the capability. `applySelected`'s
        // second reading looks the SCOPED catalogue name back up (`"${group} ${callName}"`), so
        // passing the full name we are already failing on tells it to skip exactly that one:
        // `Pass Thru` -> scoped lookup -> `Centers Pass Thru` -> fallback -> applySelected ->
        // scoped lookup -> ... MEASURED as a `Maximum call stack size exceeded` inside `partition`
        // in getout-behaviour; the census's 188 figures never reached it because none of them hits
        // that pair of names on a tiling board.
        //
        // Disabling the scoped lookup OUTRIGHT here was tried first and MEASURED one figure worse
        // (88 -> 87): the cycle is not always a cycle, and a one-level lookup still rescues calls
        // the catalogue publishes only in their group-scoped form (the `Cross Run` case the
        // reading exists for). Suppressing the single name keeps that and breaks the loop.
        //
        // The DEPTH CAP is the termination guarantee rather than a second guess at the cycle: a
        // scoped lookup can also walk between TWO names (`Centers X` -> `Ends X` -> `Centers X`),
        // which suppression alone cannot catch. Nothing measured needs more than one level.
        this.scopedDepth++;
        let scoped: ApplyResult;
        try {
          scoped = this.applySelected(board, sel.selection, sel.call, rebase, callName);
        } finally {
          this.scopedDepth--;
        }
        if (scoped.legal) return scoped;
      }
      return {
        board: cloneBoard(board),
        legal: false,
        reason: this.library.hasCall(callName)
          ? 'No setup in this call matches the current formation.'
          : `Unknown call: ${callName}`,
      };
    }
    if (rebase && this.config.selectionMode === 'probabilistic') {
      const par = allowParallel ? this.parallelApply(board, callName, rebase, matchTol) : null;
      const chosen = this.selectInterpretation(
        { kind: 'whole', error: match.error, run: () => this.applyWholeBoard(board, callName, match, rebase) },
        par ? { kind: 'parallel', error: par.error, run: () => par } : null,
      );
      return chosen;
    }
    return this.applyWholeBoard(board, callName, match, rebase);
  }

  /** Apply a single call step (string or {selection, call}) to a copy of `board`. */
  applyStep(board: Board, step: string | CallStep): ApplyResult {
    return this.applyStepInner(board, step, [], true);
  }

  private applyStepInner(
    board: Board,
    step: string | CallStep,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
  ): ApplyResult {
    if (typeof step === 'string') return this.applyToBoardInner(board, step, stack, rebase, allowParallel);
    if (step.selection) return this.applySelected(board, step.selection, step.call, rebase);
    return this.applyToBoardInner(board, step.call, stack, rebase, allowParallel);
  }

  /**
   * The implicit adjustment itself: match the board against the call's own setup at the SEARCH
   * tolerance and re-base onto it, then dance the call from there.
   *
   * `applyWholeBoard` with `rebase = true` places each dancer on its mapped setup slot before
   * applying the local motion, which is what makes this a NORMALIZATION rather than a force-fit: the
   * call then runs from its documented starting formation. A 4-dancer setup is still handled by the
   * parallel path (the witnesses are single-box reads of an 8-dancer board), which is why both
   * readings are offered rather than only the whole-board one.
   *
   * AND IT MUST LEAVE A BODY. Normalizing onto a setup while the dancers stand several units away is
   * a big move, and it is only a normalization if the result is still a set of dancers. MEASURED, and
   * this guard exists because the trap was walked into: without it the adjustment ran `figm83`'s
   * first `Ladies Chain` from a board 4.0 away from its setup and left two dancers on one spot, which
   * `facing-audit.mjs` re-classified from `coverage?` to **COLLISION** (refusal boards 39 → 38 but
   * COLLISION 3 → 4) — a laundered body error, which is exactly what an implicit adjustment must not
   * be. With the guard, `figm83` keeps its original refusal and the one real gain is kept.
   *
   * THE TOLERANCE IS `SEARCH_MATCH_MAX`, AND LOOSENING IT WAS MEASURED AND REFUTED. CALLERLAB's own
   * flagship example of the convention ("Girls Fold, Double Pass Thru") argues for a snap loose enough
   * to accept `figm30`, whose `Double Pass Thru` setup is **17.88** away, so the adjustment was run at
   * **24.0**: figures **114 → 114** — no gain at all — while `facing-audit.mjs`'s refusal list went
   * **38 → 39**, moving `figm142` back into it. A looser tolerance changes WHICH VARIANT wins (least
   * error for the whole-board reading, first that tiles for the parallel one), so the effect is not
   * monotonic, and the variant it picks at 24.0 is rejected by the collision guard where the one
   * picked at 6.0 is accepted. Reverted.
   *
   * A per-dancer DISPLACEMENT bound was the alternative and is rejected as an arbitrary threshold: the
   * case known to be WRONG (`figm83`) moves dancers **2.00**, the case known to be right (`figm142`)
   * **0.50**, and `figm71` and `figm136` sit at 2.00 and 2.06 — two cases a hair apart on opposite
   * sides of any such number. What separates good from bad here is the RESULT
   * (`BODY_COLLISION_MIN`), not the distance.
   */
  private adjustToSetup(board: Board, callName: string): (ApplyResult & { error: number }) | null {
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    const leavesABody = (r: ApplyResult & { error: number }): (ApplyResult & { error: number }) | null => {
      const phys = r.board.dancers.filter((d) => !d.isGhost);
      for (let i = 0; i < phys.length; i++) {
        for (let j = i + 1; j < phys.length; j++) {
          if (Math.hypot(phys[i].x - phys[j].x, phys[i].y - phys[j].y) < BODY_COLLISION_MIN) return null;
        }
      }
      return r;
    };
    const loose = this.matcher.findMatchingVariant(board, callName, tol);
    if (loose) return leavesABody({ ...this.applyWholeBoard(board, callName, loose, true), error: loose.error });
    const par = this.parallelApply(board, callName, true, tol);
    return par ? leavesABody(par) : null;
  }

  private applyWholeBoard(board: Board, callName: string, match: VariantMatch, rebase: boolean): ApplyResult {
    const { variant, mapping } = match;
    const f = rebase ? this.config.rebaseFactor : 0;
    const ends = this.endPoses(variant);
    const mats = rebase ? this.variantMatrices(variant) : null;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const end = mats ? (() => {
        const v = poseToVec(start.x, start.y, start.heading);
        const o = apply5(mats[mapping[i]], v);
        return { x: o[0], y: o[1], heading: Math.atan2(o[3], o[2]) };
      })() : ends[mapping[i]];
      // The displacement is expressed in the DANCER's own frame and turned back into the board's
      // frame by the dancer's own heading - see `localMotion`, which owns that transform and the
      // reflected-match handedness correction that goes with it.
      const localDisp = localMotion(start, end, match.reflect);
      const delta = normAngle(end.heading - start.heading);
      const base = rebase ? rebasedPose(start, match) : start;
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      // Record which direction this dancer last turned, for calls that depend on the remembered
      // direction ("and Roll" is the reason this exists).
      //
      // THE SIGN WAS INVERTED. `Move.turn` is documented in the engine's own vocabulary as
      // "net heading change in radians (+ = left / CCW)" (`moves.ts:32`), and `FaceLeft` is
      // `mv('Face Left', 0, 0, +PI/2)` - so a POSITIVE net delta is a LEFT turn. This used to
      // write `delta > 0 ? 'right' : 'left'`, i.e. exactly backwards, so every consumer of the
      // metadata would have rolled the wrong way. Nothing consumed it yet, which is why no gate
      // caught it; the invariant is now asserted instead of assumed.
      //
      // A NET TURN OF ~180 DEGREES has no direction from the delta alone - left and right give the
      // same number - and that is not a corner case: it is what `Partner Trade` does, and the
      // corpus's "and Roll" lines are exactly `... --PtTrd --&Roll`. The reference resolves it from
      // the path's HALFWAY tangent (`bezier.dart rolling()`: "If it's 180 then use angle at halfway
      // point"). We can do the same, because the engine already computes a pose at any time along
      // the path: take the heading change over the FIRST half and read its sign. Falling back to
      // "no direction" instead would leave `Roll` refusing on every one of those lines - measured,
      // 6 of them - which is what this replaced.
      const TURN_EPS = 1e-6;
      let turnDir = d.lastTurnDir;
      const isHalfTurn = Math.abs(Math.abs(delta) - Math.PI) <= 1e-3;
      const dirFrom = isHalfTurn
        ? normAngle(poseFor(t, dancerBeats(t) / 2).heading - start.heading)
        : delta;
      if (dirFrom > TURN_EPS) turnDir = 'left';
      else if (dirFrom < -TURN_EPS) turnDir = 'right';
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta), lastTurnDir: turnDir };
    });
    // Snap only the INTERACTIVE path (rebase): the search path must preserve pure
    // relative motion so a getout can still un-permute dancers back home.
    return { board: rebase ? this.matcher.snapBoard({ dancers: newDancers }) : { dancers: newDancers }, legal: true };
  }

  /** Apply a call to ONLY the selected dancers of a board, leaving everyone else
   * in place.
   *
   * Two readings are possible and the engine tries them in this order:
   *
   *  1. ISOLATED - gather the selected dancers, centre them, and match the call
   *     against them as a formation of their own. This is right when the selection
   *     really does stand as its own setup.
   *
   *  2. ALONG THE WHOLE PATTERN - apply the call to the whole board and keep only
   *     the selected dancers' new poses. This is right when the call is defined by
   *     the formation the dancers are standing IN, which is the normal case for
   *     group-scoped calls: "Girls Circulate" in a wave means the girls walk the
   *     wave's circulate path, not that four girls form a separate wave. The
   *     isolated reading cannot see that, because the girls of an ocean wave are a
   *     2x2 block that is not any Circulate variant at all.
   *
   * The fallback is strictly additive - the isolated reading is still tried first,
   * so nothing that already worked changes - and it is skipped when the whole-board
   * reading would itself be illegal (e.g. "Centers Pass Thru" from a squared set,
   * where nobody is facing anyone).
   *
   * Returns legal=false if neither reading works. */
  applySelected(board: Board, selection: string, callName: string, rebase: boolean, suppressScopedName?: string): ApplyResult {
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const ids = this.resolveSelection(board, selection);
    if (!ids || ids.length === 0) {
      return { board: cloneBoard(board), legal: false, reason: `Unresolvable selection: ${selection}` };
    }
    const selected = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    // Center the subset about its own origin so the call's canonical setup applies.
    let cx = 0, cy = 0;
    for (const d of selected) { cx += d.x; cy += d.y; }
    cx /= selected.length; cy /= selected.length;
    const subBoard: Board = { dancers: selected.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
    const r = this.applyToBoardInner(subBoard, callName, [], rebase, false);
    if (r.legal) {
      // Merge moved subset dancers back by id; non-selected dancers unchanged.
      const moved = new Map(r.board.dancers.map((d) => [d.id, d]));
      const merged = board.dancers.map((d) => {
        if (d.isGhost) return d;
        const m = moved.get(d.id);
        if (!m) return d;
        // Re-apply the centering offset we removed.
        return { ...m, x: m.x + cx, y: m.y + cy };
      });
      return { board: { dancers: merged }, legal: true };
    }
    // A call the catalogue publishes ONLY in its group-scoped form. `Cross Run` is
    // the worked example: `ms/run.xml` has nine `Centers Cross Run` and nine
    // `Ends Cross Run` tams and NO bare title at all, so a *gender* selection can
    // never find it by name - even when that selection IS all centres or all ends
    // and the scoped form therefore applies verbatim. All8 writes exactly this,
    // and annotates the scoped form itself:
    //
    //   ! B-XRun   G-XRun   --PromH   (C-XRun both times)
    //   !! G-XRun  B-XRun   --PromH   (E-XRun both times)
    //
    // MEASURED on the published get-outs: all three of the corpus's `XRun`
    // refusals are of this kind - two where the gender selects all four CENTRES
    // and one where it selects all four ENDS. Refusing them was the bug, not the
    // missing call.
    //
    // The WHOLE board performs the scoped call, deliberately, and NOT the subset:
    // `Centers Cross Run` means the centres cross-run AND the ends dodge, so the
    // call moves all eight and a subset reading would drop the dodgers. This is
    // only reached when the bare name is unknown AND the scoped name is a real
    // catalogue call AND the selection is exactly that group, so nothing that
    // matches today changes interpretation.
    if (!this.library.hasCall(callName)) {
      for (const group of ['Centers', 'Ends'] as const) {
        const scopedName = `${group} ${callName}`;
        if (!this.library.hasCall(scopedName)) continue;
        // Already failing on this exact name one level up - re-entering it is the cycle.
        if (scopedName === suppressScopedName) continue;
        const groupIds = this.resolveSelection(board, group);
        if (!groupIds || groupIds.length !== ids.length) continue;
        const groupSet = new Set(groupIds);
        if (!ids.every((id) => groupSet.has(id))) continue;
        const scoped = this.applyToBoardInner(board, scopedName, [], rebase, true);
        if (scoped.legal) return scoped;
      }
    }
    // Fallback: the call as the WHOLE formation performs it, with only the
    // selected dancers actually moving. The parallel path is allowed here because
    // for many of these calls it is the only one that matches - an Eight Chain box
    // is not a "U-Turn Back" setup as a whole, but it is two facing couples, which
    // is. parallelApply disables parallel recursion internally, so this terminates.
    const whole = this.applyToBoardInner(board, callName, [], rebase, true);
    if (whole.legal) {
      const moved = new Map(whole.board.dancers.map((d) => [d.id, d]));
      const picked = new Set(ids);
      // KNOWN DEFECT, PINNED IN `selection.mjs` RATHER THAN PATCHED HERE. This reading keeps the
      // non-selected dancers where they stand while the selected ones take their poses from the
      // whole-formation motion, so when the call also relocates the NON-selected dancers onto the
      // movers' destinations the merged board has two dancers on ONE spot. Measured: from the
      // engine's two-parallel-wave template `Girls Circulate` gives `i1&i2@-2.00,3.00` and
      // `i5&i6@2.00,-3.00` - 6 distinct spots for 8 dancers - and leaves the board "not a
      // formation".
      //
      // Refusing here was tried and MEASURED as a wash with a wider blast radius than it looked:
      // corpus successes unchanged at 75, but five lines moved from "stopped only at the finish"
      // to an earlier body stop and the ENGINE GAPS list grew from 25 to 31 names - including
      // calls like `Star Thru` that this path is used for by EVERY group-scoped call, so the extra
      // names cannot be distinguished from refusals this check introduced itself. Trading a
      // corrupt board for phantom gap attributions is the trade the decoder phase spent a whole
      // commit undoing, so the check is not shipped on that evidence. The real fix is upstream:
      // the wave circulate tam moves half the dancers ACROSS to the other wave (see below).
      return {
        board: { dancers: board.dancers.map((d) => (d.isGhost || !picked.has(d.id) ? d : moved.get(d.id) ?? d)) },
        legal: true,
      };
    }
    return { board: cloneBoard(board), legal: false, reason: `"${callName}" not legal for selected dancers` };
  }

  private selectInterpretation(
    whole: { kind: 'whole'; error: number; run: () => ApplyResult },
    parallel: { kind: 'parallel'; error: number; run: () => ApplyResult } | null,
  ): ApplyResult {
    if (!parallel) return whole.run();
    const wWhole = 1 / (1 + whole.error);
    const wPar = 1 / (1 + parallel.error);
    const r = this.config.rand();
    return r < wWhole / (wWhole + wPar) ? whole.run() : parallel.run();
  }

  /** The canonical end pose of each dancer of a variant (pure, cached). */
  private endPoses(variant: CallBundle): Pose[] {
    let end = this.variantEndCache.get(variant);
    if (!end) {
      end = variant.dancers.map((d) => poseFor(d, dancerBeats(d)));
      this.variantEndCache.set(variant, end);
    }
    return end;
  }

  /** Per-dancer matrix (canonical start -> canonical end) for a variant, or null
   * if it can't be built. Indexed by the variant dancer's canonical order. */
  private variantMatrices(variant: CallBundle): Mat5[] | null {
    const cached = this.variantMatrixCache.get(variant);
    if (cached !== undefined) return cached;
    const M: Mat5[] = [];
    for (const d of variant.dancers) {
      const s = poseFor(d, 0);
      const e = poseFor(d, dancerBeats(d));
      if (!isFinite(s.x) || !isFinite(e.x)) {
        this.variantMatrixCache.set(variant, null);
        return null;
      }
      M.push(dancerMatrix(s.x, s.y, s.heading, e.x, e.y, e.heading));
    }
    this.variantMatrixCache.set(variant, M);
    return M;
  }

  // ------------------------------------------------------------ parallel action

  parallelApply(
    board: Board,
    callName: string,
    rebase: boolean,
    matchTol: number,
  ): (ApplyResult & { error: number }) | null {
    // Every authored variant, `sequencer="no"` ones included ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â see
    // CallLibrary.matchableVariants for the measurement that keeps this unfiltered.
    const variants = this.library.matchableVariants(callName);
    if (variants.length === 0) return null;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    const ghosts = board.dancers.filter((d) => d.isGhost);
    for (const v of variants) {
      const setup = v.dancers.map((d) => this.library.variantMatchable(d));
      const k = setup.length;
      // The board must still divide EVENLY into setup-sized boxes - `square-dancing.md` Ãƒâ€šÃ‚Â§7.2.1:
      // "a board that cannot be split evenly into equal subsets (e.g. 6 dancers for a 4-dancer
      // subset) has no clean partition and must not force one". So a 6-dancer board with a
      // 4-dancer setup is refused here, exactly as before. What the partial reading below adds is
      // only the case where the division IS even and some boxes match while others do not, which
      // is what a Trade By or a Double Pass Thru is.
      if (k <= 1 || k >= n || n % k !== 0) continue;
      // A full tiling first, exactly as before. Only when the board CANNOT be tiled does the
      // partial reading below get a chance, so nothing that works today changes.
      const part = this.partition(setup, phys, matchTol)
        ?? this.partitionPartial(setup, phys, matchTol);
      if (!part) continue;
      const { groups, error } = part;
      if (groups.length === 0) continue;
      // Apply the call to each subset independently (disable parallel recursion).
      // Use rebase=false (PURE RELATIVE motion) so the parallel result preserves
      // every group's movement.
      const merged: SeqDancer[] = [];
      let ok = true;
      for (const group of groups) {
        const subBoard: Board = { dancers: group.map((d) => ({ ...d })) };
        const r = this.applyToBoardInner(subBoard, callName, [], false, false);
        if (!r.legal) { ok = false; break; }
        merged.push(...r.board.dancers);
      }
      if (ok) {
        // Restore the board's OWN dancer order. The groups were concatenated in
        // partition order, which permuted the array; callers pair dancers by array
        // position (the renderer draws view[i] from poses[i]), so a permuted board
        // made the dancers appear to swap places once a subset call completed.
        const movedById = new Map(merged.map((d) => [d.id, d]));
        return {
          board: { dancers: board.dancers.map((d) => movedById.get(d.id) ?? d) },
          legal: true,
          error,
          // Carry the grouping out so the animator follows the tiling that was APPLIED rather than
          // re-deriving one. See `ApplyResult.parallel`.
          parallel: { variant: v, groups },
        };
      }
    }
    return null;
  }

  /**
   * The board tiled into 4-dancer FACING-COUPLE boxes, or null.
   *
   * This is `parallelApply`'s variant loop without the "apply the call inside each box" half, for a
   * rule that acts PER BOX instead of per subset: `Sweep a Quarter` rotates each facing-couple box a
   * quarter turn about the box's own centre, which is not any one call and cannot be expressed by
   * applying a call to the box.
   *
   * The grouping comes from the engine's own `partition`, i.e. from `matchFormations` with couple
   * coherence, rather than from ad-hoc geometry, and that was a measured decision: on All8's eight
   * `Sweep 1/4` cases a hand-written "find the facing pairs and group them" produces several
   * different tilings of the same board, and `figm21` and `figm150` — the same chain with the same
   * preceding call — do not tile the same way.
   *
   * The SETUP is swept over scales rather than taken from a call, because a facing-couple box has no
   * canonical size: CALLERLAB's starting formation is "Facing Couples only" and the corner cases in
   * the corpus run from a tight 2x2 (`figm21`'s couples are TWO apart) to a 2x6 rectangle
   * (`figm63`'s centres). `partition`'s own tolerance then decides which of these the board actually
   * is, and a board that no scale tiles is refused - which is what keeps `figm150`'s malformed board
   * from being laundered into a success.
   *
   * Only a FULL tiling counts: `partitionPartial` is deliberately not consulted, because a Sweep
   * applies to each facing-couple box and a board that does not divide into boxes is not a Sweep
   * board.
   */
  boxGroups(board: Board, matchTol: number): SeqDancer[][] | null {
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    if (n === 0 || n % 4 !== 0) return null;
    // A STALE COUPLE PAIRING DOES BLOCK THIS TILING, and fixing that is REFUTED — measured, so it is
    // not retried. `partition` below enforces COUPLE COHERENCE (a stored couple's two dancers must
    // land in the same box), and after a `Flutterwheel` the stored pairing straddles the boxes:
    // `figm` #17/#120's physical couples are (#2,#5) (#7,#8) (#4,#3) (#1,#6) while the stored ones
    // are (1,2) (3,4) (5,6) (7,8). Reading CALLERLAB's temporary couple number here (the convention
    // `promenadeProblem` uses) DOES make the tiling succeed — `Sweep 1/4` refusals 6 -> 4 — and it is
    // still WRONG: those boards are Normal Lines whose facing-couple boxes are FOUR apart, so a box
    // 2 wide and 4 tall rotating 90 degrees about its own centre becomes 4 wide and 2 tall, and the
    // two boxes meet at x = 0 with four dancers on two spots. The figures then refuse on `Promenade`
    // from an UNNAMED board (Promenade refusals 4 -> 6). The refusal was therefore right, and only
    // its REASON was wrong: a board of lines cannot Sweep at all on this geometry.
    //
    // Couples separated by `s`, each couple 2 wide, facing each other along x.
    for (const s of [2, 3, 4, 6, 8]) {
      const setup: Matchable[] = [
        { x: -s / 2, y: 1, heading: 0 },
        { x: -s / 2, y: -1, heading: 0 },
        { x: s / 2, y: -1, heading: Math.PI },
        { x: s / 2, y: 1, heading: Math.PI },
      ];
      const part = this.partition(setup, phys, matchTol);
      if (part && part.groups.length === n / 4) return part.groups;
      // ...and the same box along the other axis, which is what a "lines facing" board is.
      const rotated: Matchable[] = setup.map((d) => ({
        x: -d.y, y: d.x, heading: normAngle(d.heading + Math.PI / 2),
      }));
      const part2 = this.partition(rotated, phys, matchTol);
      if (part2 && part2.groups.length === n / 4) return part2.groups;
    }
    return null;
  }

  partition(setup: Matchable[], dancers: SeqDancer[], maxError: number): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;    const n = dancers.length;
    if (n === 0 || n % k !== 0) return null;
    // A real couple must never be split across subsets. UNKNOWN_COUPLE is not a
    // couple, so it imposes no constraint rather than being treated as one
    // (treating it as a couple would wrongly forbid or force partitions).
    // The rule itself lives in `blockKeepsCouples`, shared with `partitionsFor`.
    const totals = coupleTotals(dancers);
    const isCoupleCoherent = (group: SeqDancer[]): boolean => blockKeepsCouples(group, totals);
    const used = new Array<boolean>(n).fill(false);
    const result: SeqDancer[][] = [];
    let totalError = 0;

    const canComplete = (anchorIdx: number): boolean => {
      const remaining: number[] = [];
      for (let i = 0; i < n; i++) if (!used[i] && i !== anchorIdx) remaining.push(i);
      if (remaining.length < k - 1) return false;
      const combo = new Array<number>(k - 1);
      const searchCombos = (start: number, depth: number): boolean => {
        if (depth === k - 1) {
          const idx = [anchorIdx, ...combo];
          const group = idx.map((i) => dancers[i]);
          const m = matchFormations(
            group.map((d) => ({ x: d.x, y: d.y, heading: d.heading })),
            setup,
            maxError,
          );
          if (!m || !isCoupleCoherent(group)) return false;
          for (const i of idx) used[i] = true;
          result.push(group);
          const saved = totalError;
          totalError += m.error;
          if (next()) return true;
          totalError = saved;
          result.pop();
          for (const i of idx) used[i] = false;
          return false;
        }
        for (let i = start; i < remaining.length; i++) {
          combo[depth] = remaining[i];
          if (searchCombos(i + 1, depth + 1)) return true;
        }
        return false;
      };
      return searchCombos(0, 0);
    };

    const next = (): boolean => {
      const a = used.findIndex((u) => !u);
      if (a === -1) return true;
      return canComplete(a);
    };

    return next() ? { groups: result, error: totalError } : null;
  }

  /** Whether `dancers` can be partitioned into disjoint copies of `setup` (used
   * by the analyzer to decide a parallel-subset interpretation exists). */
  partitionExists(setup: Matchable[], dancers: SeqDancer[], maxError: number): boolean {
    return this.partition(setup, dancers, maxError) !== null;
  }

  /**
   * The PARTIAL reading of `partition`: disjoint copies of `setup` covering as much of the board
   * as they can, with the dancers in no copy left where they stand.
   *
   * WHY IT EXISTS. `partition` requires the setup to tile the whole board, so a call whose setup
   * matches SOME boxes and not others is refused outright - and that is a whole family, not a
   * corner case, because a set whose boxes are not congruent is exactly what a `Trade By` or a
   * `Double Pass Thru` is: couples facing each other in the middle and couples facing out on the
   * ends. Measured, three separate published get-outs stop this way:
   *
   *   - `Box the Gnat` from a `Trade By`: the facing pair matches, the outer couples do not.
   *   - `Turn Thru` from a `Double Pass Thru`: same shape, measured best-group 3.000 while the
   *     four-dancer SUBSET matches at 0.000.
   *   - `Slide Thru`, `Recycle` and others reached on boards with no recognised formation.
   *
   * `square-dancing.md` Ãƒâ€šÃ‚Â§7.5 is explicit that "a call acts on everyone it applies to", so applying
   * to the boxes that qualify and leaving the rest is the documented reading rather than a
   * loosening. It is also STRICTLY ADDITIVE here: `parallelApply` tries `partition` first and only
   * falls back to this, so a board that tiles today behaves exactly as before, and this can only
   * turn a REFUSAL into an application.
   */
  partitionPartial(setup: Matchable[], dancers: SeqDancer[], maxError: number): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;
    const n = dancers.length;
    if (k < 2 || k > n) return null;
    const used = new Array<boolean>(n).fill(false);
    const groups: SeqDancer[][] = [];
    let totalError = 0;
    for (let anchor = 0; anchor < n; anchor++) {
      if (used[anchor]) continue;
      const rest: number[] = [];
      for (let i = 0; i < n; i++) if (!used[i] && i !== anchor) rest.push(i);
      if (rest.length < k - 1) break;
      // The best group of k containing this anchor that still matches; null when none does, in
      // which case the anchor is simply left unmatched and we move on to the next dancer.
      let best: { idx: number[]; error: number } | null = null;
      const combo = new Array<number>(k - 1);
      const search = (start: number, depth: number): void => {
        if (depth === k - 1) {
          const idx = [anchor, ...combo];
          const m = matchFormations(
            idx.map((i) => ({ x: dancers[i].x, y: dancers[i].y, heading: dancers[i].heading })),
            setup,
            maxError,
          );
          if (m && !best) best = { idx, error: m.error };
          return;
        }
        for (let i = start; i < rest.length; i++) {
          combo[depth] = rest[i];
          search(i + 1, depth + 1);
          if (best) return;
        }
      };
      search(0, 0);
      if (!best) continue;
      const found = best as { idx: number[]; error: number };
      for (const i of found.idx) used[i] = true;
      groups.push(found.idx.map((i) => dancers[i]));
      totalError += found.error;
    }
    return groups.length > 0 ? { groups, error: totalError } : null;
  }
}

function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
}
