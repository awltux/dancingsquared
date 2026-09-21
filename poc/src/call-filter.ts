// The Browse tab's call filter: which catalogue entries the Call dropdown offers for a query.
//
// IT NARROWS, IT DOES NOT DECIDE. Typing in the filter is a VIEW of the catalogue, not a load: the panel's
// dropdown and the board must never disagree about which call is on screen, so the SELECTED call is always
// present in the list whether or not it matches. Drop it and the browser's own select would silently move to
// whatever option happened to be first, leaving the board showing one call and the control naming another -
// the failure the editor's `fillCallSelect` already guards against ("re-inserts the currently selected call
// when either control excludes it").
//
// The rule is pure and exported so a probe can call it with the real catalogue instead of reading the panel's
// source: the DOM part is three lines that build options from what this returns.

/** The part of a catalogue entry the filter looks at. */
export interface FilterableCall {
  id: string;
  title: string;
  level: string;
}

/**
 * The calls to offer for `query`, keeping `selectedId` whatever the query says.
 *
 * MATCHING IS A CASE-INSENSITIVE SUBSTRING OF THE TITLE, which is what the dropdown shows - and also what the
 * caller can see to type. Order is the catalogue's, so the list reads the same way whether a filter is applied
 * or not, and the selected call keeps its own place in it rather than being pushed to the end.
 */
export function filterCalls<T extends FilterableCall>(calls: T[], query: string, selectedId: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return calls.slice();
  return calls.filter((c) => c.title.toLowerCase().includes(q) || c.id === selectedId);
}

/** How many of `calls` the query actually matches, which is what a "matched nothing" note would say. */
export function matchCount<T extends FilterableCall>(calls: T[], query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return calls.length;
  return calls.filter((c) => c.title.toLowerCase().includes(q)).length;
}
