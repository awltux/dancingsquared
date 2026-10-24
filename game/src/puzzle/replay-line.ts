// A LINE'S CALL BOUNDARIES, and which call a playhead's beat falls inside.
//
// WHY THIS IS A MODULE and not a few lines in the shell: the panel HIGHLIGHTS the call being played, so every frame asks
// "which call is the playhead in" — a RULE. A rule written inside `main.ts` cannot be probed (AGENTS.md §8 trap 27), so
// the arithmetic lives here and `game/test/replay-line-probe.mjs` pins it against a real generated line.
//
// THE BEAT IS THE UNIT, because the engine's walk is sampled in beats (`SequenceMotion.at(beat)`) and a call is charged
// a whole number of them. THE BOUNDARY BELONGS TO THE NEXT CALL: at exactly the beat a call finishes, the set is on the
// board that call left it on, which is the state the NEXT call starts from — so `callAt(ends[k]) === k + 1`. The
// plausible wrong rule is one comparison the other way (`<=` rather than `<`), which
// is right everywhere except on a boundary and therefore looks correct in a screenshot.
//
// WHY PER-CALL MOTIONS AND NOT ONE: the applier exposes `motion(calls, from)` with a TOTAL beat count and no interior
// stops, so the boundaries are built by walking the line one call at a time from the board the previous call left. That
// is only meaningful if the per-call beats ADD UP to the whole line's, which is a fact about the engine's beat
// accounting rather than about this module — MEASURED over 8 generated level-1 Dailies, the sum equals the whole line's
// beats in **8 of 8** (e.g. `26.5 = 4.5 + 7 + 8 + 7`), and the probe re-measures it rather than trusting this sentence.
//
// A ZERO-BEAT CALL keeps its end equal to the previous call's, so its boundary is invisible: `callAt` never reports a
// call that occupies no beats, and `startsAt` of the one after it is the same beat. A line a player actually played has
// no such call (a call that applies is charged at least a fraction of a beat), so this is stated rather than defended.

/** A line as the replay needs it: the calls in order, and the beat each one FINISHES on. */
export interface ReplayLine {
  /** The calls, in order — what the panel lists. */
  readonly calls: readonly string[];
  /** `ends[k]` is the beat at which call k finishes. Non-decreasing, and the last one is the line's total. */
  readonly ends: readonly number[];
}

/**
 * A line from its calls and each call's own beat count.
 *
 * IT THROWS ON A LENGTH MISMATCH, which is the one thing a caller can get wrong: every other argument shape is
 * meaningful, and a silently-truncated line would draw a replay that stops early and call it finished. `daily.ts`'s
 * `dailyEntry` throws on a malformed day for the same reason — reaching it is a bug in the caller, and loud is better.
 */
export function replayLine(calls: readonly string[], callBeats: readonly number[]): ReplayLine {
  if (callBeats.length !== calls.length) {
    throw new Error(`a replay line needs one beat count per call: ${calls.length} call(s) and ${callBeats.length} count(s)`);
  }
  const ends: number[] = [];
  let at = 0;
  for (const beats of callBeats) {
    at += beats;
    ends.push(at);
  }
  return { calls, ends };
}

/**
 * Which call the playhead's `beat` is inside — `calls.length` once every call has finished.
 *
 * `calls.length` RATHER THAN `calls.length - 1` at the end is the important half: "the line is over" and "the last call
 * is playing" are different states, and a highlight that reported the last call for both would light up the final call
 * before it was ever played.
 */
export function callAt(line: ReplayLine, beat: number): number {
  const at = Math.max(0, beat);
  for (let k = 0; k < line.ends.length; k++) if (at < line.ends[k]) return k;
  return line.calls.length;
}
