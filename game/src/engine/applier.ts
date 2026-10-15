// The engine-backed `GameApplier` — the one file in `src/` that imports an engine VALUE rather than a
// type, and therefore the one file that must NOT be reachable from the puzzle barrel
// (`src/puzzle/index.ts`). The split is the point: `src/puzzle/` is the pure core and takes the engine
// as an argument, so a probe can drive a whole puzzle with a stub and the generator's determinism is a
// property of the core rather than of how it was wired.
//
// IT HOLDS A MUTABLE SEQUENCER AND NEVER USES ITS BOARD. `Sequencer.setBoard` exists and several of its
// methods read `this.board`, which is a hazard this file avoids by construction: every call below passes
// the board explicitly (`offered(board)`, `applyToBoard(board, call)`), so two appliers can interleave
// and neither can see the other's state. That is not caution for its own sake — the generator explores
// a tree, so it asks about many boards per step, and a version that ping-ponged `setBoard` would be one
// missing call away from a silently wrong answer (AGENTS.md trap 13 is that exact failure in the
// solver).
//
// DETERMINISM: `setSnapMaxError(0)` is load-bearing. The interactive apply path snaps an arrival onto a
// formation's canonical slots within `snapMaxError` (1.0 by default), which would make the goal board
// depend on the snapping rather than on the call — so two runs could agree on the FORMATION and differ
// in the pose, and `sameBoardById` would then disagree with the engine's own recogniser about whether
// the player arrived. Turning it off makes the goal exactly what the calls produce.
import { Sequencer, sameBoardById, type Board } from 'dancing-squared-engine';
import type { GameApplier, Move, Refusal } from '../puzzle/types.ts';

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
  };
}
