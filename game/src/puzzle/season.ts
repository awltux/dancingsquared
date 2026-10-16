// The Drill's SEASON: the calendar month, UTC — the period half of a Drill board's key (DESIGN.md §6, §15 Q4).
//
// IT LIVES IN THE SHARED PURE CORE BECAUSE BOTH SIDES NEED IT AND NEITHER MAY OWN IT ALONE. The server stamps a run
// with the season it belongs to (`api/src/handlers/runs.ts`), and the client has to ASK for that season when it reads
// the board — the leaderboard takes its period from the caller, because the Daily's period is a day and a client that
// guessed would show a board nobody was on. Two implementations of "which month is it" is the second implementation
// AGENTS.md §5 forbids, and it would fail exactly at a month boundary.
//
// THE BOUNDARY IS THE POINT, AND IT IS UTC: a board resets by construction (its key changes) rather than by a job
// that deletes rows. `2026-10-31T23:59Z` is `2026-10` and `2026-11-01T00:00Z` is `2026-11` — MEASURED in
// `api/test/runs-probe.mjs`, which pins both sides of that instant.
//
// IT TAKES A TIMESTAMP RATHER THAN READING ONE, so a caller passes the clock it acted at and a probe can pin the
// arithmetic (AGENTS.md §4.3: no ambient time in a computation).
export function seasonOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
