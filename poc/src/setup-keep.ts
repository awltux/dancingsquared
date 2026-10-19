// WHICH SETUP A CALL SHOULD OPEN ON when the call changes - the same one, when the new call has it.
//
// REPORTED as: "Call Editor: When selecting a new call, if the existing Setup also exists in the new call, pre-select
// it. Often I'm working on the same Setup across the same call family." The panel refilled the setup list and left
// the browser's default on the FIRST authoring, so switching from `Circle Left 3/4` to `Circle Left 1/2` while
// working on the `Normal Lines Compact` authoring threw the caller back to `Static Square` and they had to walk the
// list again for a call they were already in the middle of.
//
// A SETUP'S IDENTITY HERE IS ITS LABEL, and that is the corpus's own answer rather than this module's invention: a
// setup is a `<tam>` and its label is the formation it starts from (`Static Square`, `Normal Lines Compact`,
// `Circle`), which is what the dropdown shows and what the caller is choosing between. Two authorings of one call
// can share a label - `ms/circle.xml` carries several `Normal Lines Compact` tams - and the first is kept, because
// that is the one the list offers first and the one the caller would otherwise have had to find again.
//
// THE MATCH IS EXACT after trimming. Labels are the same formation NAME either side, read from the same corpus, so
// case-folding would only buy a match between two labels that disagree about a name - and a name that disagrees is a
// different setup rather than the same one written differently.
//
// PURE, and separate from the panel, because the rule has to be measurable: `poc/tools/setup-keep-probe.mjs` drives
// every case here and measures the corpus those cases come from, and a rule left inside a DOM method could only be
// read (AGENTS.md §8 trap 27).

/**
 * The index in `labels` a setup dropdown should select after a call change: the entry matching `previous` when the
 * new call has one, else 0 (the list's first entry), or -1 when the new call has no setups at all.
 *
 * `previous` is the label the dropdown was showing BEFORE it was refilled - '' or null when it was empty, and then
 * there is nothing to keep.
 */
export function keptSetupIndex(labels: readonly string[], previous: string | null | undefined): number {
  if (labels.length === 0) return -1;
  const wanted = (previous ?? '').trim();
  if (wanted === '') return 0;
  const at = labels.findIndex((label) => label.trim() === wanted);
  return at >= 0 ? at : 0;
}
