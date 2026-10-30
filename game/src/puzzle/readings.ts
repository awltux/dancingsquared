// THE PICKER'S SECTIONS: a board's moves grouped by the reading that performs them.
//
// WHY THIS IS ITS OWN MODULE. It is a pure rule over `MoveReading[]` — no DOM, no `three`, no sequencer — and the
// screen is the one place in this package that bare Node cannot load (`ui/daily-screen.ts` holds a class with
// parameter properties, which the TypeScript strip-only loader refuses). A rule that only existed inside that file
// could only be measured by a browser, and this is a rule with a wrong version that looks fine: one section per
// call, or the whole board sorted last, both render and both teach the wrong thing.
//
// AND THE PICKER'S FILTER IS HERE FOR THE SAME REASON. REPORTED: "When running Todays Daily, there are a large
// number of calls available to the player. Implement a search feature and make the calls easier to navigate."
// MEASURED at level 1 (pool 57): 277 readings over 14 subsets from the squared set (the largest subset 24) and 306 over 16 from one
// generated Daily start, so the list is a page of scrolling to reach the one
// call the player has in mind. The filter is TWO independent narrowings — a subset (the engine's own selection
// label: "Heads", "All 8", …) and a free-text query — and both are arithmetic over the readings, which is what lets
// a probe pin them instead of a browser.
import type { MoveReading } from './types.ts';

/** The engine's own name for the whole-board selection (`Sequencer.mayOffer` normalises `null` to it). */
export const WHOLE_BOARD = 'All 8';

interface ReadingSection {
  /** The heading: the engine's own vocabulary — "All 8" for the whole board, otherwise the group's name. */
  label: string;
  readings: MoveReading[];
}

/**
 * The readings as sections, whole board first, the engine's order kept within each.
 *
 * ONE SECTION PER READING, and a call legal both for the set and for a group appears in both — which is the point
 * rather than a duplicate: they are two moves, by different dancers. Deduplicating by call would quietly drop the
 * group reading, which is the one the mode exists to teach.
 *
 * THE WHOLE BOARD IS LABELLED "All 8" rather than left blank, because that is the engine's own name for it
 * (`Sequencer.mayOffer` normalises `null` to it) and the picker must not be a second vocabulary for one thing.
 */
export function groupReadings(readings: readonly MoveReading[]): ReadingSection[] {
  const sections = new Map<string, MoveReading[]>();
  for (const reading of readings) {
    const label = selectionLabel(reading);
    const list = sections.get(label);
    if (list) list.push(reading);
    else sections.set(label, [reading]);
  }
  const out = [...sections.entries()].map(([label, list]) => ({ label, readings: list }));
  // THE WHOLE-BOARD SECTION FIRST, because it is the reading the Drill teaches and the one a player's eye lands on.
  // `sort` is stable in ES2019, so the groups keep the engine's order behind it.
  return out.sort((a, b) => (a.label === WHOLE_BOARD ? -1 : b.label === WHOLE_BOARD ? 1 : 0));
}

/** Which subset a reading belongs to: the group's name, or `WHOLE_BOARD` for a reading of the whole set. */
export function selectionLabel(reading: MoveReading): string {
  return reading.selection ?? WHOLE_BOARD;
}

/**
 * How one reading is played: the group's own spelling, or the bare call for the whole board.
 *
 * IT IS ONE FUNCTION because the click handler, the saved line and the server's replay all read this string — a second
 * place spelling it would be a second spelling.
 */
export function readingSpelling(reading: MoveReading): string {
  return reading.selection === null ? reading.call : `${reading.selection} ${reading.call}`;
}

/**
 * What the player has narrowed the picker to, and THE FILTER IS ALWAYS ONE SUBSET.
 *
 * REPORTED: "The call lists in the HUD should always use a single call filter, defaulting to 'All 8'. Selecting another
 * filter deselects the currently selected filter." So there is no off value: `selection` is one of `groupReadings`' labels,
 * and it is `WHOLE_BOARD` until the player presses something else. The value that narrowed nothing (`selection: null`,
 * which drew EVERY subset at once as a stack of sections) is gone with the multi-section list it produced — the list is one
 * subset now, so "all of them" is not a state it can be in.
 */
export interface ReadingFilter {
  /** The subset to show. One of `groupReadings`' labels, never "none": `WHOLE_BOARD` is a subset, not the off state. */
  readonly selection: string;
  /** The free-text query, matched against each reading's own spelling. */
  readonly query: string;
}

/**
 * The filter a challenge opens with: the whole board, nothing typed.
 *
 * IT IS THE WHOLE BOARD because that is the reading the Drill teaches and the one a player's eye lands on, and because a
 * Daily's first move is usually a call for all eight.
 */
export const DEFAULT_FILTER: ReadingFilter = { selection: WHOLE_BOARD, query: '' };

/**
 * The filter after a subset press: the label REPLACES the selection and the query is kept.
 *
 * THIS WAS A TOGGLE AND IT IS NOT ONE ANY MORE. The old rule — pressing the pressed pill again shows everything — existed
 * because "everything" was a list a player might want; with one subset always selected there is no such list, so pressing
 * the selected pill is a no-op and the only way to change the list is to press a different one. REPORTED: "Selecting
 * another filter deselects the currently selected filter."
 */
export function selectSubset(filter: ReadingFilter, label: string): ReadingFilter {
  return { ...filter, selection: label };
}

/**
 * The subset to select once the board's own labels are known: the player's choice where it is still on offer.
 *
 * A SUBSET CAN DISAPPEAR — legality changes with every move, so a group with no legal call on this board has no pill — and
 * a selection left standing over an absent label would show an empty list under a pill that is not there. The fallback is
 * the whole board (always offered, and `groupReadings` sorts it first), then whatever is left.
 */
export function subsetOrDefault(labels: readonly string[], wanted: string): string {
  if (labels.includes(wanted)) return wanted;
  if (labels.includes(WHOLE_BOARD)) return WHOLE_BOARD;
  return labels[0] ?? WHOLE_BOARD;
}

/**
 * The readings a filter leaves visible, in the engine's order.
 *
 * THE SUBSET ALWAYS APPLIES, so this is a view of `readings` rather than the whole of it: nothing is deduplicated and
 * nothing is reordered, and a call legal for the set and for a group still appears in both (they are two moves, by
 * different dancers) — but only one of those two rows is in view at a time.
 *
 * THE QUERY IS MATCHED AGAINST THE READING'S SPELLING (`readingSpelling`: "Heads Dosado", or "Dosado" alone on the whole
 * board), because that is the phrase the player is looking for a way to say — and it is what makes "heads dos" find the
 * group reading while "dos" finds it under every selection. EVERY whitespace-separated term must occur,
 * case-insensitively and IN ANY ORDER: "dos heads" and "heads dos" are the same search, and a rule that required the
 * terms in order would fail on the one thing a player is most likely to type.
 */
export function filterReadings(readings: readonly MoveReading[], filter: ReadingFilter): MoveReading[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return readings.filter((reading) => {
    if (selectionLabel(reading) !== filter.selection) return false;
    if (terms.length === 0) return true;
    const spelling = readingSpelling(reading).toLowerCase();
    return terms.every((term) => spelling.includes(term));
  });
}

/**
 * The label for TWO groups dancing at once, or null when they are not two groups.
 *
 * THE FORM IS THE ENGINE'S (`stepLabel` writes `A || B`), and `parseStep` reads it back, so the composition needs no new
 * wire shape: it is one element of the line, which is why the server's replay needed no change either.
 *
 * NULL WHEN THE SELECTIONS ARE NOT DIFFERENT, and that is a rule rather than a convenience: two readings of the same
 * group are a SEQUENCE, and MEASURED, applying the two in either order gives different boards for half the pairs — so a
 * "parallel" step over one group would be a lie about what the dancers did.
 */
export function parallelLabel(a: MoveReading, b: MoveReading): string | null {
  if (a.selection === b.selection) return null;
  return `${readingSpelling(a)} || ${readingSpelling(b)}`;
}
