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
import { Sequencer, sameBoardById, type Board } from 'dancing-squared-engine';
import type { GameApplier, Move, Refusal, SequenceMotion } from '../puzzle/types.ts';

export interface ApplierOptions {
  movesXml: string;
  formationsXml: string;
  /** The calls this level registers, by TITLE. */
  calls: { name: string; xml: string }[];
}

export function createEngineApplier(opts: ApplierOptions): GameApplier {
  const seq = new Sequencer(opts.movesXml, opts.formationsXml, opts.calls);
  seq.setSnapMaxError(0);
  const names = opts.calls.map((c) => c.name);

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

    refusalOf(board: Board, call: string): Refusal | null {
      const r = seq.applyToBoard(board, call);
      if (r.legal) return null;
      return { call, reason: r.reason ?? `the engine refused ${call} without a reason` };
    },

    apply(board: Board, call: string): Board {
      const r = seq.applyToBoard(board, call);
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
