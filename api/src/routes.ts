// The endpoint table: one row per route, shared by every adapter.
//
// ONE LAMBDA, NOT SIX. The route is in the event, so a single function can serve all of them, and the reason
// it should is measured rather than stylistic: a cold start that builds one level's applier costs ~2.0 s for
// the first and ~0.8 s for each further level (`api/tools/_measure-applier.mjs`), so six functions would each
// pay it while one pays it once and keeps it. The split would buy per-endpoint IAM granularity that these
// endpoints do not need — they all read and write the same table with the same permissions.
import { drillAdvance, drillCurrent } from './handlers/drill.ts';
import { getPuzzle } from './handlers/puzzle.ts';
import { postRun } from './handlers/runs.ts';
import { postDrillAnswer } from './handlers/answer.ts';
import type { Handler } from './ports.ts';

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly handler: Handler;
  /** One line, for `/health` and for a reader: what this endpoint is FOR, not what it returns. */
  readonly purpose: string;
}

/**
 * THE ENDPOINTS OF DESIGN.md 11, of which four exist. The table is the list in that section, in its order, so the
 * gap is visible here rather than in a document that drifts: every row below is one row of that table, and
 * `/health` reports how many of them are served.
 *
 * `POST /drill/answer` IS ONE OF THE RECORDING ENDPOINTS §11.1 ADDED (A22), and it is listed in §11's table
 * because it is part of the surface a client talks to — the alternative, counting only the original six, made
 * `/health`'s "how many are left" number stop meaning anything the moment the first of them landed.
 */
export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/drill/current', handler: drillCurrent, purpose: 'the drill this player is on' },
  { method: 'GET', path: '/puzzle', handler: getPuzzle, purpose: "the published challenge for a level and day" },
  { method: 'POST', path: '/drill/advance', handler: drillAdvance, purpose: 'mark the issued drill finished' },
  { method: 'POST', path: '/drill/answer', handler: postDrillAnswer, purpose: 'record one press against the issued drill' },
  { method: 'POST', path: '/runs', handler: postRun, purpose: 'record a completed run, verified by regeneration' },
];

/** How many endpoints DESIGN.md 11 lists, so `/health` can report the gap without a second list. */
export const PLANNED_ENDPOINTS = 10;

/** The handler for a request, or null when nothing serves that path. */
export function routeFor(method: string, path: string): Route | null {
  const wanted = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return ROUTES.find((route) => route.method === method.toUpperCase() && route.path === wanted) ?? null;
}
