// The engine-backed `GameApplier` — the seam between the pure core and the engine's mutable sequencer, and
// the only place in `src/` where a SEQUENCER or a legislative call is reached. It is deliberately not
// reachable from the puzzle barrel (`src/puzzle/index.ts`), so a probe can drive the whole core with a stub.
//
// THE "ONLY FILE THAT IMPORTS AN ENGINE VALUE" CLAIM THAT USED TO BE HERE WAS FALSE and is corrected rather
// than repeated: `puzzle/session.ts`, `puzzle/generator.ts`, `game/drill.ts` and `data/assets.ts` all import
// engine values, because those are the engine's own PURE RULES (`boardSig`, `sameBoardById`,
// `makeSquaredSet`, `callMeta`) and importing them is what keeps the game from owning a second
// implementation of a rule the engine already has (AGENTS.md 5). What this file alone holds is the
// sequencer: the SINGLE MUTABLE object, which every method below receives its board explicitly rather than
// reading from `this.board`.
//
// IT HOLDS A MUTABLE SEQUENCER AND NEVER USES ITS BOARD. `Sequencer.setBoard` exists and several of its
// methods read `this.board`, which is a hazard this file avoids by construction: every call below passes
// the board explicitly (`offered(board)`, `applyToBoard(board, call)`, `evaluateSequence(flat, beat,
// board)`), so two appliers can interleave and neither can see the other's state. That is not caution for
// its own sake — the generator explores a tree, so it asks about many boards per step, and a version that
// ping-ponged `setBoard` would be one missing call away from a silently wrong answer (AGENTS.md trap 13 is
// that exact failure in the solver).
//
// DETERMINISM: `setSnapMaxError(0)` is load-bearing. The interactive apply path snaps an arrival onto a
// formation's canonical slots within `snapMaxError` (1.0 by default), which would make the goal board
// depend on the snapping rather than on the call — so two runs could agree on the FORMATION and differ
// in the pose, and `sameBoardById` would then disagree with the engine's own recogniser about whether
// the player arrived. Turning it off makes the goal exactly what the calls produce.
import { Sequencer, parseStep, sameBoardById, type Board } from 'dancing-squared-engine';
import type { GameApplier, Move, MoveReading, Refusal, SequenceMotion } from '../puzzle/types.ts';

interface ApplierOptions {
  movesXml: string;
  formationsXml: string;
  /** The calls this level registers, by TITLE. */
  calls: { name: string; xml: string }[];
}

/**
 * How many boards' reading lists one applier keeps.
 *
 * THE CACHE IS WHY THE DAILY'S PICKER IS A CLICK. `readings` is `legalCalls × subsetGroups` applicator runs —
 * MEASURED, 1754 ms on a squared set at 322 titles and 22 ms one call in — and the Daily asks for it again after
 * every move AND every undo.
 *
 * THE KEY IS THE FULL POSE AND IDENTITY, NOT `boardSig`, and that is a correction rather than caution: `boardSig` is
 * positions-only (AGENTS.md §8 trap 11), and MEASURED while this cached on it, a call that changes FACING alone
 * returned the previous board's list — same signature, different question. Legality reads headings (the matcher
 * matches them) and the group list reads couple identity, so the key carries both. It is deliberately
 * OVER-sensitive: two boards that are genuinely the same pose in different arrays would be two cache entries, which
 * costs one recomputation, while an UNDER-sensitive key serves a wrong list, which costs a wrong puzzle.
 *
 * THE BOUND IS BLUNT, for the reason `api/src/levels.ts` gives about its own caches: the working set is the boards a
 * player walks in one run, and a clear costs one recomputation rather than leaving an unbounded map in a tab.
 */
const READINGS_CACHE_BOARDS = 32;

/** The key: every dancer's identity, couple, gender, position and heading, exactly as floats. */
function poseKey(board: Board): string {
  let key = '';
  for (const d of board.dancers) key += `${d.id},${d.couple},${d.gender},${d.x},${d.y},${d.heading};`;
  return key;
}

export function createEngineApplier(opts: ApplierOptions): GameApplier {
  // A CALL IS ITS TITLE, AND ITS VARIANTS ARE THE TAMS THAT CARRY IT. The constructor registers each pair as a
  // WHOLE DOCUMENT, which would give every title every tam of its file -- `trade.xml` under one name means
  // `Boys Trade` also matches `Partner Trade`'s authorings. `registerByTitle` takes only the tams carrying the
  // name, which is the engine's variant model applied at its own grain.
  const seq = new Sequencer(opts.movesXml, opts.formationsXml);
  for (const call of opts.calls) seq.registerByTitle(call.name, call.xml);
  seq.setSnapMaxError(0);
  const names = opts.calls.map((c) => c.name);
  const readingCache = new Map<string, MoveReading[]>();

  /**
   * Apply one LINE ELEMENT, which is either a call name or a PARALLEL STEP written the way `stepLabel` writes one
   * (`Sides Trade || Heads Dosado`).
   *
   * WHY THE SPLIT IS HERE AND NOT AT EVERY CALLER. The game's line is a list of strings — that is what the wire records
   * and what the server replays — so a parallel step has to survive as text, and exactly one place should know that a
   * string can describe two groups. `parseStep` is the engine's inverse of `stepLabel`; a string it cannot read is a
   * REFUSAL with its own sentence rather than an "unknown call", because the two are different mistakes.
   */
  const apply = (board: Board, call: string) => {
    if (!call.includes(' || ')) return seq.applyToBoard(board, call);
    const step = parseStep(call);
    if (!step) return { legal: false, board, reason: `${JSON.stringify(call)} names a parallel step this app cannot read` };
    return seq.applyToBoard(board, step);
  };

  return {
    offered(board: Board): Move[] {
      const out: Move[] = [];
      for (const name of names) {
        const r = seq.applyToBoard(board, name);
        if (r.legal) out.push({ call: name, board: r.board });
      }
      return out;
    },

    candidateCalls(): string[] {
      return [...names];
    },

    /**
     * Every reading of every legal call from `board`, whole board and per group, from the engine's own enumeration
     * (`Sequencer.applicableMoves`) and cached by board signature.
     *
     * THE ENGINE OWNS THE GROUP RULE, which is why this is a delegation rather than a loop over `subsetGroups` and
     * `groupCanPerform` here: the deciding is exactly "can THIS group perform the call from THIS board", which is
     * `groupCanPerform`'s question, and a copy of that walk in the game would be the second implementation AGENTS.md
     * §5 forbids.
     */
    readings(board: Board): MoveReading[] {
      const key = poseKey(board);
      const cached = readingCache.get(key);
      if (cached) return cached;
      const out = seq.applicableMoves(board);
      if (readingCache.size >= READINGS_CACHE_BOARDS) readingCache.clear();
      readingCache.set(key, out);
      return out;
    },

    seedReadings(board: Board, readings: readonly MoveReading[]): void {
      // COPIED, because the caller's array came off a response that is also still holding the puzzle: a later reader
      // that mutated the seed would otherwise edit the wire's own list.
      const key = poseKey(board);
      if (readingCache.size >= READINGS_CACHE_BOARDS) readingCache.clear();
      readingCache.set(key, [...readings]);
    },

    refusalOf(board: Board, call: string): Refusal | null {
      const r = apply(board, call);
      if (r.legal) return null;
      return { call, reason: r.reason ?? `the engine refused ${call} without a reason` };
    },

    apply(board: Board, call: string): Board {
      const r = apply(board, call);
      // THE APPLY PATH IS ONLY REACHED WHEN `refusalOf` SAID YES, so a refusal here means the two
      // answers disagree — which would be a caller using `apply` as a legality test. Rather than
      // returning the unchanged board (a silent "nothing happened", which reads as a no-op call), this
      // throws: the failure mode of a four-valued API is worth a loud one.
      if (!r.legal) throw new Error(`apply(${call}) was refused after refusalOf said it applies: ${r.reason ?? 'no reason'}`);
      return r.board;
    },

    /** The engine's own goal test, passed through — no local tolerance, no second opinion. */
    boardsMatch: sameBoardById,

    nameOf(board: Board): string | null {
      return seq.recognize(board).name;
    },

    /**
     * The engine's own walk of `calls` from `board`: how long it takes, where it stops, and the board at any
     * beat in between.
     *
     * WHY `sequenceBeats` AND `sequenceStop` ARE ASKED ONCE, AT CONSTRUCTION, rather than per frame: they
     * replay the whole list, and a frame loop that asked them 60 times a second would be walking the dance
     * 60 times to ask a question whose answer cannot change — the list and the start board are fixed for the
     * life of this object. `evaluateSequence` is the per-frame call, and the engine memoises its walk by
     * content for exactly that reason.
     *
     * `at()` CLAMPS AND THE ZERO-BEAT CASE IS THE START BOARD. A list whose first call cannot be walked is
     * charged zero beats, so there is nothing to interpolate and the picture must be the board the player is
     * standing on — which is the state DESIGN.md 4.3 asks for: the point it stopped at, plus the engine's
     * own reason from `stop`.
     */
    motion(calls: readonly string[], from: Board): SequenceMotion {
      // A WHOLE-BOARD CALL STEP, which is what a level's titles are: `applyToBoard(board, name)` above reads
      // the same whole-board way, so the drawn motion and the applied board are the same reading of the same
      // call. A SCOPED call ("Heads Lead Right") is not a title in a level's pool, so it cannot arrive here.
      const flat = calls.map((call) => ({ call }));
      const beats = seq.sequenceBeats(flat, from);
      const stop = seq.sequenceStop(flat, from);
      return {
        beats,
        stop,
        at(beat: number): Board {
          if (beats <= 0) return from;
          const clamped = Math.min(Math.max(beat, 0), beats);
          return seq.evaluateSequence(flat, clamped, from).board;
        },
      };
    },
  };
}
