// `POST /me/runs:bulk` — import a device's local ledger as UNRANKED HISTORY (DESIGN.md 11.1, A26).
//
// WHAT IT WRITES, AND WHAT IT DELIBERATELY DOES NOT. It writes one `history#<playerId>` / `run#<runId>` row per
// imported run, marked `unverified`, and NOTHING ELSE: no board entry, no hint credit, no Progress row. That is the
// whole of A26 — "the anonymous ledger is kept, and it buys no standing" — and it is enforced by the absence of
// those writes rather than by a flag somebody has to check, which is why the probe asserts the rows are still
// missing afterwards.
//
// A RUN ALREADY IMPORTED IS SKIPPED, NOT REWRITTEN. The row is create-only, so a retry costs nothing and a second
// import claiming a better score for the same `runId` changes no number. Without that, the import would be a way to
// overwrite history with a nicer story.
//
// IT IS NOT A SCORING ENDPOINT AND NEVER WILL BE. A run the server never issued has no window to measure, no
// presses to count and no line it walked, so scoring it would mean trusting exactly the three things A21-A23 moved
// to the server. `POST /runs` is the only path that scores, and this one is deliberately not a back door into it.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { historyKey } from '../keys.ts';
import { asHistoryItem, parseLedger, type HistoryRun } from '../history.ts';

export async function postBulkRuns(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const parsed = parseLedger(request.body);
  if (!parsed.ok) return failure(STATUS.badRequest, parsed.refusal.code, parsed.refusal.message);

  let imported = 0;
  let skipped = 0;
  for (const run of parsed.runs) {
    const key = historyKey(playerId, run.runId);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await deps.store.get(key);
      if (stored) {
        // ALREADY THERE, AND THE FIRST IMPORT WINS. The row is not compared with what is being sent: a device that
        // sends a different score for the same id is either retrying badly or rewriting, and neither is a reason to
        // change what was recorded.
        skipped++;
        break;
      }
      const item: HistoryRun = { ...run, importedAtMs: deps.clock.nowMs() };
      if (await deps.store.put(key, asHistoryItem(item), null)) {
        imported++;
        break;
      }
      // The create-only write lost a race: loop, re-read, and let the `stored` branch above count it as a skip.
    }
  }
  return {
    status: STATUS.ok,
    // THE COUNTS ARE THE ANSWER, because the client's question is "what do you now hold of mine" — and a client
    // that cannot tell an import from a no-op cannot tell a first sign-in from a retry.
    body: { imported, skipped, total: parsed.runs.length, unverified: true },
  };
}
