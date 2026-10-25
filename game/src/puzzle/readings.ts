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
 * What the player has narrowed the picker to, and BOTH HALVES ARE THE PLAYER'S: `selection` is a subset of the board
 * (one of `groupReadings`' labels) and `query` is whatever they typed. Neither is a fact about the puzzle, which is
 * why this is state the screen owns rather than something a view carries.
 */
export interface ReadingFilter {
  /** The subset to show, or null for every subset — `WHOLE_BOARD` is a subset, not the off state. */
  readonly selection: string | null;
  /** The free-text query, matched against each reading's own spelling. */
  readonly query: string;
}

/** The filter that narrows nothing: every reading, in the engine's order. */
export const ALL_READINGS: ReadingFilter = { selection: null, query: '' };

/**
 * The readings a filter leaves visible, in the engine's order.
 *
 * THE QUERY IS MATCHED AGAINST THE READING'S SPELLING (`readingSpelling`: "Heads Dosado", or "Dosado" alone on the
 * whole board), because that is the phrase the player is looking for a way to say — and it is what makes "heads dos"
 * find the group reading while "dos" finds it under every selection. EVERY whitespace-separated term must occur,
 * case-insensitively and IN ANY ORDER: "dos heads" and "heads dos" are the same search, and a rule that required the
 * terms in order would fail on the one thing a player is most likely to type.
 *
 * NOTHING IS DEDUPLICATED AND NOTHING IS REORDERED, because the filter is a VIEW over the engine's list rather than a
 * second list: `ALL_READINGS` returns exactly what it was given, which is what lets the probe check that the two
 * agree (`groupReadings`' rule — a call legal for the set and for a group is two moves — still holds under a filter).
 */
export function filterReadings(readings: readonly MoveReading[], filter: ReadingFilter): MoveReading[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return readings.filter((reading) => {
    if (filter.selection !== null && selectionLabel(reading) !== filter.selection) return false;
    if (terms.length === 0) return true;
    const spelling = readingSpelling(reading).toLowerCase();
    return terms.every((term) => spelling.includes(term));
  });
}

/**
 * The subset a press selects: pressing the one already on turns the filter OFF.
 *
 * THE TOGGLE IS A RULE, not two lines in a click handler. "Press it again to show everything" is the only way back to
 * the whole list without a separate reset control, and a version that kept the selection would leave a player who
 * pressed "Heads" unable to see "Sides" without knowing to press something else.
 */
export function toggleSelection(current: string | null, pressed: string): string | null {
  return current === pressed ? null : pressed;
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
