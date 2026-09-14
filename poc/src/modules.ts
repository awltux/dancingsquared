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
  const ceder = validCederModules().map((m) => ({ name: m.name, steps: m.steps, source: 'ceder' as const }));
  return [...ceder, ...savedModules()];
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
