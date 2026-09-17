// The app's named SEQUENCES ("modules"): the ceder-translated corpus plus the ones the caller has
// saved from the sequencer. Shared, so the browse view answers "what uses this call?" from the SAME
// list the sequencer registers - a second source would drift.
//
// The saved ones live in localStorage under `MODULES_STORAGE_KEY`, which is defined ONCE here: the
// sequencer writes it and this module reads it, and two copies of the string would silently
// diverge (the sequencer's own list is what the user sees, so a mismatch would show as "the call
// picker has a module the browse view cannot find").

import type { CallStep } from 'dancing-squared-engine';
import { canonicalName, splitSelection } from 'dancing-squared-engine';
import { validCederModules } from './ceder-modules';

/** localStorage key for the caller's saved modules. */
export const MODULES_STORAGE_KEY = 'dsModules';

export interface NamedSequence {
  name: string;
  steps: (string | CallStep)[];
  source: 'ceder' | 'saved';
  /**
   * The formation the CORPUS says this module was written for, when it is not home.
   *
   * This matters and was being dropped. The corpus splits 137 Static Square / 108 Zero Line /
   * 71 Zero Box, so **168 of the 294 modules the app offers** were written for a start that is not
   * home; a module written for a Zero Line replayed from a Static Square does not dance the same
   * calls - `ceder-7046` gets as far as its fourth step and then `Right and Left Grand` refuses,
   * because `Swing Thru` from the `Double Pass Thru` a square reaches is not the call the module
   * means. The engine has no formation by either of those names today
   * (`engine/test/tools/start-formation-probe.mjs`, which also measures what they map to), so the
   * app cannot simply start there - but it can stop pretending the module begins at home.
   */
  startFormation?: string;
  endFormation?: string;
}

/** The shape the sequencer persists: `Module` from the engine, narrowed to what is read here. */
interface StoredModule {
  name?: unknown;
  calls?: unknown;
}

export function savedModules(): NamedSequence[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(MODULES_STORAGE_KEY) || '[]');
  } catch {
    return []; // a corrupt entry must not take the whole browse view down
  }
  if (!Array.isArray(parsed)) return [];
  const out: NamedSequence[] = [];
  for (const m of parsed as StoredModule[]) {
    if (!m || typeof m.name !== 'string' || !Array.isArray(m.calls)) continue;
    out.push({ name: m.name, steps: m.calls as (string | CallStep)[], source: 'saved' });
  }
  return out;
}

/** Every named sequence the app knows, ceder corpus first then the caller's own. */
export function allModules(): NamedSequence[] {
  const ceder = validCederModules().map((m) => ({
    name: m.name,
    steps: m.steps,
    source: 'ceder' as const,
    startFormation: m.startFormation,
    endFormation: m.endFormation,
  }));
  return [...ceder, ...savedModules()];
}

/**
 * The corpus's start-formation LABELS mapped onto engine formations.
 *
 * The corpus names where a module was written to begin, but those names are ceder's, not the
 * engine's, and matching on the label is why 168 of the 294 modules were replayed from the wrong
 * board.
 *
 * `Zero Line` is All8's **`L0`** — formation letter `L`, arrangement 0 — and the engine's
 * `Normal Lines` IS `L0`. Two independent agreements: `arrangementFor(boardForFormation('Normal
 * Lines'), 'L')` returns 0, and the engine's transcribed table for `[L]` at arrangement 0 is
 * `gBgB` / `BgBg`, which is exactly the row All8 prints for `[L]` column 0. So the engine had a zero
 * line all along; the app never asked for it by the right name.
 *
 * `Zero Box` is `[B]`, and `alignment.ts`'s own comment on that table is *"Box / 8-Chain Thru"* — so
 * the engine formation for it is `Eight Chain Thru`. `start-formation-probe.mjs` agrees
 * independently: against the corpus's Zero Box modules `Eight Chain Thru` finishes 11 of 25 where the
 * runner-up manages 3.
 */
export const START_FORMATION: Record<string, string> = {
  'static square': 'Static Square',
  'squared set': 'Static Square',
  'zero line': 'Normal Lines',
  'zero box': 'Eight Chain Thru',
};

/**
 * The engine formation a corpus start-formation label resolves to, or null when the engine has no
 * equivalent.
 *
 * NULL IS THE POINT. A label the engine cannot stand the dancers up in must not be silently replaced
 * by home: the module then dances different calls, which reads as "the sequence is broken" rather
 * than "the sequence starts elsewhere". The caller fails loudly instead.
 */
export function resolveStartFormation(label: string | undefined): string | null {
  if (!label) return null;
  return START_FORMATION[label.trim().toLowerCase()] ?? null;
}

/** Whether this sequence is written to begin somewhere other than the home square. */
export function startsAwayFromHome(seq: NamedSequence): boolean {
  const f = seq.startFormation?.trim().toLowerCase();
  return !!f && f !== 'static square' && f !== 'squared set';
}

/**
 * The name two steps are compared on: the FULL label - selection INCLUDED - canonicalised and
 * case-folded, because the ceder corpus and the catalogue do not agree on capitalisation.
 *
 * THE SELECTION IS KEPT, and that was measured rather than assumed (see
 * `engine/test/tools/modules-using-probe.mjs`). Stripping it made `Heads Pass Thru` and `Pass Thru`
 * the same key, so browsing the scoped call listed **144** modules that dance the bare one and have
 * nothing to do with it. Keeping it gives the 2 that genuinely use the scoped call. They are
 * different calls and the list should say so.
 */
export const callKey = (s: string | CallStep): string => {
  const sel = typeof s === 'string' ? splitSelection(s).selection : s.selection;
  const base = typeof s === 'string' ? splitSelection(s).call : s.call;
  return `${sel ?? ''} ${canonicalName(base)}`.trim().toLowerCase();
};

/**
 * Every named sequence that USES `callTitle`, with the FIRST step index at which it does.
 *
 * The index is the point of the whole thing: the browse view's "open" loads the sequence WHOLE
 * (so the call keeps its context before and after it) and parks the playhead there.
 */
export function modulesUsing(callTitle: string): { seq: NamedSequence; index: number }[] {
  const want = callKey(callTitle);
  const out: { seq: NamedSequence; index: number }[] = [];
  for (const seq of allModules()) {
    const index = seq.steps.findIndex((s) => callKey(s) === want);
    if (index >= 0) out.push({ seq, index });
  }
  // Earliest occurrence first, then by name, so the list is stable across loads.
  return out.sort((a, b) => a.index - b.index || a.seq.name.localeCompare(b.seq.name));
}
