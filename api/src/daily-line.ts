// The Daily's recorded moves: the log that makes the LINE the server's fact (DESIGN.md §11.1, A22's Daily half).
//
// WHY A LOG AND NOT A LINE. A client that reported its line would be reporting the number the Daily is PRICED on:
// §6's `wasteFactor` measures the calls the player actually used against the shortest, so a modified client could
// play a wasteful line and submit the short one. Recording add/undo/redo instead means the client never states the
// line at all — the server derives it from what it watched the player do, and the derivation replays through the
// SAME `PlaySession` the client drives (`levels.ts`'s `replayDailyMoves`, DESIGN.md §4.4: "the client sequencer is
// the same sequencer the server used"). There is no second implementation of undo/redo here to drift.
//
// WHY UNDO AND REDO ARE RECORDED RATHER THAN RESOLVED. Resolving them here — storing the line and its length —
// would be a second copy of state that can disagree with the log; and the log is what an operator can read to see
// what actually happened. The row holds the moves, and the line is a pure function of them.
//
// IT IS BOUNDED, like the Drill's press log, and for the same reason: a client writes this. The bound is on the
// LOG rather than on the line because undo and redo are free (§9) and a player may click them many times — the
// line is bounded by the puzzle's own allowance, which `PlaySession` enforces as it replays.
import { MAX_CALL_LENGTH } from './press-log.ts';

/**
 * A move as the WIRE carries it — the kind and the call, before the server stamps it.
 *
 * IT IS A DISCRIMINATED UNION RATHER THAN `{ kind: Kind; call: string | null }`, and that is deliberate: the replay
 * types the `add` branch as having a call and the other two as having none, so a log this build cannot replay
 * cannot be constructed in the first place. A `string | null` field would make `session.play(null)` typecheck.
 */
export type MoveIn = { readonly kind: 'add'; readonly call: string } | { readonly kind: 'undo' | 'redo'; readonly call: null };

/** A recorded move: what the player did, not what it amounted to. The stamp is the SERVER's arrival time. */
export type DailyMove = MoveIn & { readonly atMs: number };

/**
 * How many moves one challenge may record.
 *
 * THE ADD COUNT IS ALREADY BOUNDED BY THE ALLOWANCE and this bound is for the other two: undo and redo cost
 * nothing (DESIGN.md §9), so a player may press them as often as they like, and a row is not a place to put an
 * unbounded list. 300 is the Drill's 200 with room for the redo branch a Daily can build — MEASURED against the
 * largest allowance the ladder produces, which is a handful of calls, so a player reaches this only by undoing and
 * redoing deliberately.
 */
export const MAX_DAILY_MOVES = 300;

/** A move as the request carries it, or the refusal to answer. `atMs` is the SERVER's, so it is not here. */
export type ParsedMove =
  | { readonly ok: true; readonly move: MoveIn }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * The move a request body asks to record.
 *
 * A CALL IS REQUIRED FOR AN `add` AND IGNORED FOR THE OTHER TWO. Ignoring it rather than refusing it is deliberate:
 * a client that sends `{ move: 'undo', call: 'Boys Run' }` is describing an undo, not lying about one, and the call
 * it names is not stored (the log's undo names nothing). A call on an `add` IS checked, because an unbounded string
 * in the row is the one thing this endpoint could be used to store.
 */
export function parseDailyMove(body: unknown): ParsedMove {
  const raw = (body as { move?: unknown; call?: unknown } | null)?.move;
  if (raw !== 'add' && raw !== 'undo' && raw !== 'redo') {
    return { ok: false, code: 'bad_move', message: 'move must be one of add, undo or redo' };
  }
  if (raw !== 'add') return { ok: true, move: { kind: raw, call: null } };
  const call = (body as { call?: unknown }).call;
  if (typeof call !== 'string' || call === '' || call.length > MAX_CALL_LENGTH) {
    return { ok: false, code: 'bad_call', message: `an add must name a call of at most ${MAX_CALL_LENGTH} characters` };
  }
  return { ok: true, move: { kind: 'add', call } };
}

/**
 * The moves a stored row holds, or null when it is not a log this build can read.
 *
 * NULL MEANS UNREADABLE, NOT EMPTY: an absent field is a challenge with no moves recorded yet (a row created by the
 * read of the challenge), and a malformed one is an operator finding — the same split `attempt-row.ts` makes for the
 * presses. An `add` with no call is malformed rather than dropped, because a log this build cannot replay is a line
 * it cannot score, and scoring a shorter line than the player played is the one error that would favour a cheat.
 */
export function asDailyMoves(raw: unknown): DailyMove[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const moves: DailyMove[] = [];
  for (const item of raw) {
    const move = item as { kind?: unknown; call?: unknown; atMs?: unknown };
    if (typeof move.atMs !== 'number' || !Number.isFinite(move.atMs)) return null;
    if (move.kind === 'undo' || move.kind === 'redo') {
      moves.push({ kind: move.kind, call: null, atMs: move.atMs });
      continue;
    }
    if (move.kind !== 'add') return null;
    if (typeof move.call !== 'string' || move.call === '') return null;
    moves.push({ kind: 'add', call: move.call, atMs: move.atMs });
  }
  return moves;
}

/** The stored form, field by field, so an extra property cannot ride along into the table. */
export function asDailyMoveItems(moves: readonly DailyMove[]): Record<string, unknown>[] {
  return moves.map((move) => (move.kind === 'add' ? { kind: move.kind, call: move.call, atMs: move.atMs } : { kind: move.kind, atMs: move.atMs }));
}
