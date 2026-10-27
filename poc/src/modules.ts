// The app's named SEQUENCES ("modules"): the ceder-translated corpus plus the ones the caller has
// saved from the sequencer. Shared, so the browse view answers "what uses this call?" from the SAME
// list the sequencer registers - a second source would drift.
//
// The saved ones live in localStorage under `MODULES_STORAGE_KEY`, which is defined ONCE here: the
// sequencer writes it and this module reads it, and two copies of the string would silently
// diverge (the sequencer's own list is what the user sees, so a mismatch would show as "the call
// picker has a module the browse view cannot find").

import type { CallStep, ModuleStep } from 'dancing-squared-engine/sequencer';
import { canonicalName, splitSelection, isGroupStep, stepLabel } from 'dancing-squared-engine/sequencer';
import { validCederModules } from './ceder-modules';
import { parseStoredModules } from './stored-modules';

/** localStorage key for the caller's saved modules. */
export const MODULES_STORAGE_KEY = 'dsModules';

export interface NamedSequence {
  name: string;
  /**
   * The steps of the sequence. A saved module can hold a "while" step (`GroupStep`) because the sequencer
   * saves the raw history, so the type is the engine's whole step union rather than the two forms the ceder
   * corpus happens to use.
   */
  steps: ModuleStep[];
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

/**
 * The caller's saved modules, read through the one parser that validates them.
 *
 * THE STORED START IS CARRIED THROUGH, so a saved module opened from the browse view's "used by" list starts where it
 * was saved, exactly as it does from the library drawer. The label rather than the `sid`, because that is the form every
 * other `NamedSequence` carries and `openSequence` resolves; a saved module with no stored start (one saved before the
 * field existed) has no label and opens from home, which is what it always did.
 */
export function savedModules(): NamedSequence[] {
  return parseStoredModules(localStorage.getItem(MODULES_STORAGE_KEY)).map((m) => ({
    name: m.name,
    steps: m.calls,
    source: 'saved' as const,
    ...(m.start?.name ? { startFormation: m.start.name } : {}),
  }));
}

/** Every named sequence the app knows, ceder corpus first then the caller's own. */
function allModules(): NamedSequence[] {
  const ceder = validCederModules().map((m) => ({
    name: m.name,
    steps: m.steps,
    source: 'ceder' as const,
    startFormation: m.startFormation,
    endFormation: m.endFormation,
  }));
  return [...ceder, ...savedModules()];
}

// THE START-FORMATION LABELS MOVED TO `start-formation.ts`: the rule is importable there under node, which a probe needs,
// and this module cannot be (the ceder corpus arrives through Vite's `import.meta.glob`). Re-exported so every existing
// consumer of `./modules` is unchanged.
export { LETTER_TEMPLATE, resolveStartFormation, START_FORMATION } from './start-formation';
export type { StartSpec } from './start-formation';

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
export const callKey = (s: ModuleStep): string => {
  // A GROUPED ("while") step names several calls at once, so it has no single selection+call to key
  // on. Its whole label is the key, which also means it can never be mistaken for a bare call when
  // the browse view asks "what uses this call?" - a "while" is not that call.
  if (typeof s !== 'string' && isGroupStep(s)) return stepLabel(s).trim().toLowerCase();
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
