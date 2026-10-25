// The app's named SEQUENCES ("modules"): the ceder-translated corpus plus the ones the caller has
// saved from the sequencer. Shared, so the browse view answers "what uses this call?" from the SAME
// list the sequencer registers - a second source would drift.
//
// The saved ones live in localStorage under `MODULES_STORAGE_KEY`, which is defined ONCE here: the
// sequencer writes it and this module reads it, and two copies of the string would silently
// diverge (the sequencer's own list is what the user sees, so a mismatch would show as "the call
// picker has a module the browse view cannot find").

import type { CallStep, ModuleStep } from 'dancing-squared-engine';
import { canonicalName, splitSelection, isGroupStep, stepLabel } from 'dancing-squared-engine';
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

/** The caller's saved modules, read through the one parser that validates them. */
export function savedModules(): NamedSequence[] {
  return parseStoredModules(localStorage.getItem(MODULES_STORAGE_KEY)).map((m) => ({
    name: m.name,
    steps: m.calls,
    source: 'saved' as const,
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

/**
 * The corpus's start-formation LABELS, resolved to an engine board.
 *
 * A label names a FORMATION **and an ARRANGEMENT**, and the arrangement is the half the app was
 * dropping. `Zero Line` is All8's `L0`: letter `L`, arrangement 0. But `boardForFormation('Normal
 * Lines')` is NOT it — that board classifies as `[L0]` by its gender pattern and still carries NO
 * identity (couple UNKNOWN for all eight, `sequence` unknown), and its couples are authored in
 * **1,4,3,2** order. A zero line is couples **1,2,3,4 in sequence**, partner and corner intact.
 *
 * So the entry is a FASR CODE, built with `boardForFasrCode`, not a formation name. `L1o` is the code
 * that measures right: identity 8/8, sequence `in`, and the facing couple-pairs are **`1-4` and
 * `2-3`** — which is exactly what the zero line's FASR says (`1B><4G`, `1G><4B`, `2B><3G`, `2G><3B`).
 * `L1p` is the near-miss trap: same sequence, same everything visible, but its facing pairs are
 * `1-2 3-4`, the wrong couples. `engine/test/tools/zero-line-probe.mjs` measures all thirteen
 * candidates side by side.
 *
 * `Zero Box` IS NOW ANSWERED, and the answer moved from this file to the engine. It was absent because
 * the `[B]` question had not been settled and a wrong start is worse than none: the module dances
 * different calls and reads as broken. That question was the SELECTION — a FASR code admits four boards
 * differing only in which couple stands where, and the engine used to take the first one the enumeration
 * produced, which is All8's board for `L1o` only by luck — and the engine now selects All8's own board
 * through `CANONICAL_INDEX`, a table measured against the 26 diagrams All8 publishes. `L1o` is unchanged
 * by that fix, being the one code whose selection happened not to matter.
 *
 * MEASURED before switching it on (`engine/test/tools/zero-box-probe.mjs`), from the board the app would
 * load and from home for contrast, over the corpus's own `Zero Box` modules:
 *
 *     from the [B1c] board:  54/324 replay all the way   stops: Left Allemande, Trade, Pass Thru ...
 *     from home:              0/324 replay all the way   stops: Swing Thru (97), Veer Left, ...
 *
 * The second line is the "wrong start" signature the comment above warns about — `Swing Thru` from a
 * square is what a zero-box module hits first when it is danced from home, and it proves the label
 * matters. The 270 that still stop from `[B1c]` are the engine's ordinary coverage gaps, the same class
 * the get-out corpus reports, not a mis-set board.
 */
interface StartSpec {
  /** An engine formation name, for a board the formation library gets right (home). */
  formation?: string;
  /** An All8 `[arrangement]LETTER[sequence][relationship]` code, for everything else. */
  code?: string;
}

export const START_FORMATION: Record<string, StartSpec> = {
  'static square': { formation: 'Static Square' },
  'squared set': { formation: 'Static Square' },
  'zero line': { code: 'L1o' },
  // `Zero Box` is All8's `[B1c]` — verbatim from its own get-out diagram: "[B1c] ... Facing Corners /
  // ZERO BOX / AL BOX / Box 1-4 / 'AL'". It is a code rather than a formation name for the same reason
  // `Zero Line` is: a name fixes the geometry and leaves the arrangement free.
  'zero box': { code: 'B1c' },
};

/**
 * The engine geometry each All8 formation letter is built from. `boardForFasrCode` needs a TEMPLATE
 * per letter — the geometry and the per-slot gender — and stamps the arrangement's identity onto it.
 *
 * `S` maps to `Static Square` because a `[S]`-coded label is otherwise unbuildable; without it a caller
 * importing an `[S]` figure is told there is no engine template for a formation the engine has.
 */
export const LETTER_TEMPLATE: Record<string, string> = {
  B: 'Eight Chain Thru',
  L: 'Normal Lines',
  W: 'Ocean Waves',
  P: 'Double Pass Thru',
  F: 'Two-Faced Lines',
  'L.F': 'Two-Faced Lines LH',
  S: 'Static Square',
};

/**
 * The engine board a corpus start-formation label resolves to, or null when it cannot be resolved.
 *
 * NULL IS THE POINT. A label the engine cannot stand up in the right ARRANGEMENT must not be silently
 * replaced by one it can: replaying from the wrong board dances different calls, which reads as "the
 * sequence is broken" rather than "the sequence starts elsewhere". The caller fails loudly instead.
 */
export function resolveStartFormation(label: string | undefined): StartSpec | null {
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
