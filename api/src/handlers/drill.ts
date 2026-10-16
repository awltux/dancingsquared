// The two Drill endpoints, over the ports. No HTTP, no AWS, no clock of its own.
//
// WHAT A HANDLER IS RESPONSIBLE FOR HERE, since the rules are next door in `drill-regime.ts`:
//   * reading the two rows the request needs (the level's regime, this player's progress),
//   * VALIDATING what it cannot control — a malformed row, an unknown level, a schedule that is not published,
//   * the compare-and-set loop that turns a pure decision into a stored one,
//   * mapping a decision to a status code and a body.
//
// THE STORE KEY SHAPES ARE THE ITEM TABLE'S (DESIGN.md 11): `progress#<playerId>` / `level#<level>` and
// `schedule#<level>` / `current`, both built in `keys.ts` so the handlers, the seeding and the probe cannot
// disagree about where a row lives. THE LADDER ROW (§15 Q17(vi)) IS READ THROUGH `ladder.ts`, which also owns
// the promotion rule, because it is the one rule here that needs more than one row.
import { MAIN_POOL, type ScheduleEntry } from 'dancing-squared-game';
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps, type ItemKey, type StoredItem } from '../ports.ts';
import { progressKey, scheduleKey } from '../keys.ts';
import { asProgress, asProgressItem } from '../progress-row.ts';
import { servableLevel } from '../ladder.ts';
import { failure, optionalIdentity, requireIdentity, STATUS } from '../status.ts';
import { levelParam } from '../query.ts';
import { levelAt, optionLabels, puzzleFor } from '../levels.ts';
import {
  currentDrill,
  emptyProgress,
  finishDrill,
  parseDrillId,
  type CurrentOutcome,
  type DrillProgress,
  type Regime,
} from '../drill-regime.ts';


/**
 * A stored row as a regime, or null.
 *
 * STRICT, AND LOUD WHEN IT FAILS. A row this API cannot read is either a schema change or corruption, and the
 * alternative — treating it as an empty schedule — would serve every player at that level nothing while
 * looking like a legitimate empty regime. An instrument's silence is itself a bug (AGENTS.md 4.1).
 */
function asRegime(stored: StoredItem): Regime | null {
  const value = stored.value as { scheduleVersion?: unknown; entries?: unknown };
  if (typeof value.scheduleVersion !== 'string' || !Array.isArray(value.entries)) return null;
  const entries: ScheduleEntry[] = [];
  for (const raw of value.entries) {
    const entry = raw as { seed?: unknown; levelIndex?: unknown; poolVersion?: unknown };
    if (typeof entry.seed !== 'number' || typeof entry.levelIndex !== 'number' || typeof entry.poolVersion !== 'string') return null;
    entries.push({ seed: entry.seed, levelIndex: entry.levelIndex, poolVersion: entry.poolVersion });
  }
  return { scheduleVersion: value.scheduleVersion, entries };
}


/**
 * The regime as stored, or a refusal.
 *
 * A MISSING SCHEDULE IS AN OPERATOR FINDING, NOT A CLIENT ERROR, and it is reported as one: the publishing
 * pipeline (§7.2) is the only writer, so "level 2 has no schedule" means level 2 was never published — which
 * is the normal state of a fresh deployment until `tools/publish-schedule.mjs` has run.
 */
async function readRegime(deps: Deps, levelIndex: number): Promise<{ regime: Regime } | { refusal: ApiResult }> {
  const stored = await deps.store.get(scheduleKey(levelIndex));
  if (!stored) return { refusal: failure(STATUS.notFound, 'no_schedule', `level ${levelIndex} has no published schedule`) };
  const regime = asRegime(stored);
  if (!regime) {
    return { refusal: failure(STATUS.unavailable, 'unreadable_schedule', `the schedule for level ${levelIndex} is not a regime this build can read`) };
  }
  return { regime };
}

/**
 * Read, decide, conditionally write — and try again when another writer got there first.
 *
 * THE RETRY IS THE POINT OF THE WHOLE PORT. Two requests can read the same progress row, so the write is
 * conditioned on the revision that was read; a loser re-reads and usually finds that the winner's answer
 * already satisfies it — the locked-drill case in `currentDrill` returns `changed: false`, so the second
 * request finds nothing left to do. After `MAX_WRITE_ATTEMPTS` the request says so: one player's row is not a
 * contended row, so failing loudly beats an unbounded loop.
 *
 * `decide` RETURNS NO PROGRESS FOR "NOTHING TO WRITE", which is what keeps a resumed drill a pure read, and
 * is why the decision is a union rather than a nullable progress record.
 */
async function withProgress(
  deps: Deps,
  key: ItemKey,
  levelIndex: number,
  decide: (progress: DrillProgress) => { progress: DrillProgress; result: ApiResult } | { result: ApiResult },
): Promise<ApiResult> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    const progress = asProgress(stored, levelIndex);
    if (!progress) {
      return failure(STATUS.unavailable, 'unreadable_progress', `the progress row for ${key.pk} is not a record this build can read`);
    }
    const decision = decide(progress);
    if (!('progress' in decision)) return decision.result;
    if (await deps.store.put(key, asProgressItem(decision.progress), stored?.rev ?? null)) return decision.result;
  }
  return failure(STATUS.conflict, 'contended', "another request is writing this player's progress; try again");
}

/** Where the player is in the regime, as every successful answer reports it. */
function regimeCounts(regime: Regime, progress: DrillProgress): { finished: number; length: number } {
  return { finished: progress.finished.length, length: regime.entries.length };
}

/**
 * The served form of one outcome, or a refusal.
 *
 * IT IS A SEPARATE FUNCTION BECAUSE TWO CALLERS NOW SERVE THE SAME DRILL: the identified one, which may have just
 * WRITTEN the issue into a Progress row, and the demo one, which never writes at all (§11.2's "a signed-out caller
 * gets a demo, not a wall"). Two copies of this body is how the two come to answer differently for one regime —
 * which is precisely the drift the level field was once missing from.
 */
function served(
  outcome: CurrentOutcome,
  level: ReturnType<typeof levelAt>,
  levelIndex: number,
  resumed: boolean,
): { body: Record<string, unknown> } | { refusal: ApiResult } {
  if (outcome.kind === 'complete') return { body: { drill: null } };
  const generated = puzzleFor(outcome.drill.seed, level);
  if (!generated.ok) {
    return {
      refusal: failure(
        STATUS.unavailable,
        'unplayable_drill',
        `the published drill at level ${levelIndex} entry ${outcome.drill.index} does not generate: ${generated.reason}`,
      ),
    };
  }
  // THE LEVEL IS IN THE ANSWER, and it was MISSING until a browser found it: §11's row for this endpoint says the
  // response is "the seed, the level, the option labels and the issue date", and a client that asked for level 1
  // still has to be told which level the drill it was handed belongs to — the schedule can move under a player,
  // and the client adopts the answer's level rather than its own. MEASURED: the game's client refused the
  // response (`bad_response`) because the level was absent.
  return { body: { drill: { ...outcome.drill, levelIndex, optionLabels: optionLabels(generated.puzzle), resumed } } };
}

/**
 * `GET /drill/current` — the drill this player is on.
 *
 * THE LEVEL IS THE PLAYER'S, NOT THE CALLER'S (DESIGN.md §15 Q17(vi)): for a request the server can name, the
 * level comes from the LADDER row and a `?level=` in the query is not consulted at all. That is not a narrowing
 * of the answer — a client that asked for level 1 is told which level it was handed, and the app adopts the
 * answer's level rather than its own, which is what makes the schedule moving under a player harmless. A CALLER
 * THE SERVER CANNOT NAME HAS NO LADDER, so a demo is served the level it asked for: "their level" presupposes a
 * player, and a signed-out visitor is deliberately not one (§11.2). The query's level is therefore still
 * VALIDATED on that path, which is where `bad_level` comes from.
 *
 * THE OPTION LABELS ARE GENERATED HERE, from the seed the Progress row holds, because the serving layer's
 * answer IS "the seed, the level and the option labels" (§8, §11) — the server re-runs the same generator the
 * client will, so the labels are a cross-check the client can compare against its own board before drawing
 * anything. MEASURED, that generation costs 167-230 ms at level 1 and 728-1240 ms at levels 2 and 3 on a warm
 * applier (a throwaway script under `api/tools/`, deleted before the commit), and returning only the seed is a
 * one-line change; DESIGN.md §13 records the measurement so that is a decision with a number rather than a
 * silent one.
 *
 * A SIGNED-OUT CALLER IS SERVED THE SAME DRILL AND NOTHING IS WRITTEN (§11.1's A20, §11.2's demo). The drill is
 * derived from the published regime and the ORDER alone, so it needs no Progress row to exist and none is read;
 * the answer says `demo: true` so the client knows the run it is about to play cannot be ranked, rather than
 * discovering it at the 401. WHICH DRILL a demo gets is the first one this level has not been told is finished —
 * and a signed-out caller has never finished one, so it is the season's first entry, every time.
 */
export async function drillCurrent(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const identity = optionalIdentity(request, deps);

  if (!identity) {
    const demoLevel = levelParam(request.query['level']);
    if (demoLevel === null) return failure(STATUS.badRequest, 'bad_level', 'level must be a positive integer');
    const level = levelAt(demoLevel);
    const read = await readRegime(deps, demoLevel);
    if ('refusal' in read) return read.refusal;
    const outcome = currentDrill(read.regime, demoLevel, emptyProgress(demoLevel), MAIN_POOL.version, deps.clock.nowMs());
    const answered = served(outcome, level, demoLevel, false);
    if ('refusal' in answered) return answered.refusal;
    return {
      status: STATUS.ok,
      body: { ...answered.body, demo: true, regime: regimeCounts(read.regime, outcome.progress) },
    };
  }

  // THE LADDER IS READ FIRST, because everything below it is a function of the level it names — including which
  // Progress row to read, and whether a full block has already earned the next level.
  const on = await servableLevel(deps, identity.playerId);
  if ('refusal' in on) return on.refusal;
  const levelIndex = on.levelIndex;

  // A LEVEL IS TOTAL (see `levelAt`): the only thing that can be missing is its published regime.
  const level = levelAt(levelIndex);

  const read = await readRegime(deps, levelIndex);
  if ('refusal' in read) return read.refusal;

  return withProgress(deps, progressKey(identity.playerId, levelIndex), levelIndex, (progress) => {
    const outcome = currentDrill(read.regime, levelIndex, progress, MAIN_POOL.version, deps.clock.nowMs());
    const answered = served(outcome, level, levelIndex, outcome.kind === 'drill' && !outcome.changed);
    if ('refusal' in answered) return { result: answered.refusal };
    const body = { ...answered.body, regime: regimeCounts(read.regime, outcome.progress) };
    if (outcome.kind === 'complete' || !outcome.changed) return { result: { status: STATUS.ok, body } };
    return { progress: outcome.progress, result: { status: STATUS.ok, body } };
  });
}

/**
 * `POST /drill/advance` — mark the issued drill finished.
 *
 * IT CARRIES NO SCORE, and that is the design rather than an omission: a run's score and its hint credit come
 * from `POST /runs`, where the server re-derives the answer (DESIGN.md 11). Advancing is about the ORDER, and
 * a player who advances without submitting has skipped a drill they cannot score — the board takes their best,
 * so there is nothing to gain and nothing to forge.
 *
 * IT IS A WRITE AND SO IT NEEDS AN IDENTITY (§11.1 A20). A demo player is served a drill with no Progress row to
 * advance, so there is nothing for this endpoint to do for them — and a 401 says that, rather than an
 * `isolation`-style refusal for a drill the server never issued.
 */
export async function drillAdvance(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { drillId?: unknown } | null;
  const id = body?.drillId;
  if (typeof id !== 'string') return failure(STATUS.badRequest, 'bad_drill_id', 'drillId must be a string');
  const parsed = parseDrillId(id);
  if (!parsed) return failure(STATUS.badRequest, 'bad_drill_id', `${JSON.stringify(id)} is not a drill id`);

  const read = await readRegime(deps, parsed.levelIndex);
  if ('refusal' in read) return read.refusal;

  return withProgress(deps, progressKey(playerId, parsed.levelIndex), parsed.levelIndex, (progress) => {
    const outcome = finishDrill(progress, id);
    if (outcome.kind === 'refused') return { result: failure(STATUS.conflict, 'stale_drill', outcome.reason) };
    return {
      progress: outcome.progress,
      result: { status: STATUS.ok, body: { regime: regimeCounts(read.regime, outcome.progress) } },
    };
  });
}
