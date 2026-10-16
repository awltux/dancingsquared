# HANDOVER — the cheat-resistance work, as of `5fb6177`

<!--
READ THIS FIRST, AND READ NOTHING ELSE HERE AS CURRENT.

This file describes ONE COMMIT and it is stale the moment master moves. The authorities are, in order:
`git log --oneline origin/master -1` (what is actually landed), `game/DESIGN.md` §11.1 (each rule's enforcement
status — the table there is corrected in the same commit as the code, which is why it is the real scoreboard), and
`AGENTS.md` (how to work here).

AGENTS.md §8 records that TWO earlier `HANDOVER.md` files were DELETED, "because an orientation document that is
only regenerated when a session ends was routinely read as current state by the session after it". This one is
written to be the opposite of that: it names the commit it describes, it points at the table rather than restating
it, and every claim in it is checkable with one command. If it starts being quoted as truth after master has
moved, delete it — that is the measured failure mode, not a hypothetical.
-->

## Where this stopped

* **Last landed commit:** `5fb6177` — "api: the ledger import measured over the WIRE, and the standing it must not
  buy". Confirm with `git log --oneline origin/master -1`; if that is not `5fb6177`, this file is behind and the
  commit list below is incomplete.
* **Branch:** `api/p5-cheat-resistance`, fast-forwarded to `origin/master` (one commit per stage, never a merge).
* **The task branch may be deleted** — nothing depends on it once master carries the commits.
* **Gates, run just before this file was written:** `npx tsc -p api --noEmit` clean, `npx tsc -p game --noEmit`
  clean, `node api/tools/verify-probes.mjs` = **11 probes, 0 failed**, `node game/tools/verify-probes.mjs` =
  **17 probes, 0 failed**, `node book/tools/check-links.mjs` passes. (`npm run check:book` additionally reports a
  pre-existing `animations-index.json` DRIFT that is not from this task.)
* **Untracked, and not mine:** `poc/tools/guard-exclusions-broken.md`. Never stage it.

## What this task landed, one line each

| Commit | What it enforces | Where it is measured |
|---|---|---|
| `807a35a` | the design: §11.1 A20–A27, §11.2's three identity modes | `game/DESIGN.md` |
| `3a85546` | **A20**: a verified token or an absent one; demo reads, 401 writes; the local emulator | `api/test/auth-probe.mjs` (76 checks) |
| `9ff1a03` | the client's session: mode discovery, one stored item, refresh on the clock, local-first sign-out | `game/test/auth-client-probe.mjs` (46) |
| `bc5c983` | **A21**: the clock is the server's (attempt row; a claim below the window buys nothing) | `api/test/runs-probe.mjs` (71) |
| `7285c88` | **A22**: the Drill's presses are recorded, so `attempts` is counted | `api/test/press-log-probe.mjs` (22) |
| `af2407a` | **A23**: the hint spend is an event, charged from the record | `api/test/hint-event-probe.mjs` (21) |
| `2a636d0` | the four stages driven together over HTTP for a signed-in player | `api/test/end-to-end-probe.mjs` (36) |
| `e7c6df4` | giving up on a Daily is recorded, once | `end-to-end-probe.mjs` §8 |
| `d13b560`, `10514ff` | **A25's first counter**: refusals are tallied, at the ROUTE TABLE so every endpoint is covered | `api/test/abuse-probe.mjs` (26) |
| `886f74a` | **A26**: a device's ledger imports as unranked history and nothing else | `api/test/history-probe.mjs` (21) |
| `5fb6177` | that import measured over the wire | `end-to-end-probe.mjs` §9 |

## What is left, in the order to do it

The authoritative list is `game/DESIGN.md` §11.1's "Not yet enforced" table. As of `5fb6177` it reads:

1. **A20's client half — the sign-in SURFACE and the unranked marking.** `game/src/net/auth.ts` and `session.ts`
   exist and are probed, and nothing in `main.ts` calls them: there is no sign-in UI, `demo: true` from
   `GET /drill/current` is read by nobody, and `POST /me/runs:bulk` is not called by the app. This is the one
   remaining **user-visible** gap, and it is where three already-built pieces get wired. It wants a browser check
   (`npm run dev:game` on 8089 + `DSQ_AUTH=emulate npm run dev:api` on 8090): the pattern that works here is a
   background job for both servers and a real browser against the page. **No browser has been opened since
   `9ff1a03`,** so nothing client-side in this task has been observed running.
2. **`POST /daily/move` — A22's Daily half.** The recorded Daily line. It is also what lets the server name a
   hint's call (`handlers/hints.ts` records the spend but leaves `HintEvent.call` empty on purpose), and what makes
   the Daily's `attempts`/line server facts. `lineReachesGoal` already walks a submitted line, so the pieces are
   there; what is missing is the per-move endpoint and the client calling it.
3. **The deployment adapter (stage 7) — BLOCKED ON THE OWNER.** Lambda + Cognito + an infra template, plus the
   real structured logs and the refusal-rate alarm. It needs decisions nobody has made: AWS account, region,
   domain, the Cognito pool's issuer/audience, and the gateway's per-player throttling. Nothing in the repo
   hard-codes any of them (`api/src/config.ts` is the one place they are read).
4. **A25's remainder**: the operator's alarm over `abuse#<playerId>` (nothing reads the tally yet) and the
   gateway's throttling. The counters themselves exist and cover every endpoint.

## Traps this task hit, beyond AGENTS.md §8's list

* **PowerShell's backtick escape silently rewrites source** — trap 24 now records it (`0x07`, not a missing
  character). It bit again while editing `dev-server.ts`: a `.Replace` whose pattern contained a template literal
  did not match and the script wrote the file back unchanged. SINGLE-QUOTE any pattern containing a backtick, or
  use the editor tools, which take literal text.
* **A probe that calls the handler is not measuring the endpoint.** When the refusal counter moved to the route
  table, four checks in `abuse-probe.mjs` went red because they were driving `postRun` directly. `routeFor(method,
  path).handler` is how a probe should reach a route now.
* **A fixture that writes with `expectedRev: null` silently does nothing the second time.** `hint-event-probe.mjs`'s
  `grant()` had that bug and made a check report `no_hints` for the wrong reason; it now reads the revision first
  and throws if the write does not land.
* **One item, one owner.** The Daily's stamp, the Drill's presses and the hints are three fields of ONE row
  (`api/src/attempt-row.ts`). A writer that rebuilt the row from its own field alone dropped the others — measured
  in the first draft of the hint stage, and now pinned by a pure check.
* **`puzzleFor` is memoised** (`levels.ts`): a press regenerates the puzzle, and MEASURED, 50 distinct seeds cost
  158.6 ms each against 0.0 ms for a repeat. The returned puzzle is SHARED — read it, never mutate it.

## Decisions the owner still owes

* The AWS account/region/domain and the throttling limits (stage 7).
* Whether to keep this file at all (AGENTS.md §8 records why the previous two were deleted).
* Whether the app should keep a signed-out player's daily run unranked-visible at all, or hide the board entirely
  until sign-in — §11.1 A20 leaves that to the surface stage.
