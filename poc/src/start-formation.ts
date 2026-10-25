// THE CORPUS'S START-FORMATION LABELS, RESOLVED TO AN ENGINE BOARD.
//
// WHY THIS IS ITS OWN MODULE. It is a rule - "the label 'Zero Box' means the board [B1c]" - and a rule that only lives
// in a module a probe cannot import is not a rule (AGENTS.md §11.4.5). `modules.ts` needs it and cannot be loaded under
// node (it imports the ceder corpus through Vite's `import.meta.glob`), so the rule lives here with no imports but the
// engine's, and `modules.ts` re-exports it so its own consumers are unchanged.
//
// A LABEL NAMES A FORMATION **AND AN ARRANGEMENT**, and the arrangement is the half the app used to drop. `Zero Line` is
// All8's `L0`: letter `L`, arrangement 0. But `boardForFormation('Normal Lines')` is NOT it - that board classifies as
// `[L0]` by its gender pattern and still carries NO identity (couple UNKNOWN for all eight, `sequence` unknown), and its
// couples are authored in **1,4,3,2** order. A zero line is couples **1,2,3,4 in sequence**, partner and corner intact.
//
// So the entry is a FASR CODE, built with `boardForFasrCode`, not a formation name. `L1o` is the code that measures
// right: identity 8/8, sequence `in`, and the facing couple-pairs are **`1-4` and `2-3`** - which is exactly what the
// zero line's FASR says (`1B><4G`, `1G><4B`, `2B><3G`, `2G><3B`). `L1p` is the near-miss trap: same sequence, same
// everything visible, but its facing pairs are `1-2 3-4`, the wrong couples.
// `engine/test/tools/zero-line-probe.mjs` measures all thirteen candidates side by side.
//
// `Zero Box` IS NOW ANSWERED, and the answer moved from the app to the engine. It was absent because the `[B]` question
// had not been settled and a wrong start is worse than none: the module dances different calls and reads as broken. That
// question was the SELECTION - a FASR code admits four boards differing only in which couple stands where, and the
// engine used to take the first one the enumeration produced, which is All8's board for `L1o` only by luck - and the
// engine now selects All8's own board through `CANONICAL_INDEX`, a table measured against the 26 diagrams All8
// publishes. `L1o` is unchanged by that fix, being the one code whose selection happened not to matter.
//
// MEASURED before switching it on (`engine/test/tools/zero-box-probe.mjs`), from the board the app would load and from
// home for contrast, over the corpus's own `Zero Box` modules:
//
//     from the [B1c] board:  54/324 replay all the way   stops: Left Allemande, Trade, Pass Thru ...
//     from home:              0/324 replay all the way   stops: Swing Thru (97), Veer Left, ...
//
// The second line is the "wrong start" signature the comments above warn about - `Swing Thru` from a square is what a
// zero-box module hits first when it is danced from home, and it proves the label matters. The 270 that still stop from
// `[B1c]` are the engine's ordinary coverage gaps, the same class the get-out corpus reports, not a mis-set board.

export interface StartSpec {
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
 * per letter - the geometry and the per-slot gender - and stamps the arrangement's identity onto it.
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
