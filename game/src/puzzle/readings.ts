// THE PICKER'S SECTIONS: a board's moves grouped by the reading that performs them.
//
// WHY THIS IS ITS OWN MODULE. It is a pure rule over `MoveReading[]` — no DOM, no `three`, no sequencer — and the
// screen is the one place in this package that bare Node cannot load (`ui/daily-screen.ts` holds a class with
// parameter properties, which the TypeScript strip-only loader refuses). A rule that only existed inside that file
// could only be measured by a browser, and this is a rule with a wrong version that looks fine: one section per
// call, or the whole board sorted last, both render and both teach the wrong thing.
import type { MoveReading } from './types.ts';

export interface ReadingSection {
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
    const label = reading.selection === null ? 'All 8' : reading.selection;
    const list = sections.get(label);
    if (list) list.push(reading);
    else sections.set(label, [reading]);
  }
  const out = [...sections.entries()].map(([label, list]) => ({ label, readings: list }));
  // THE WHOLE-BOARD SECTION FIRST, because it is the reading the Drill teaches and the one a player's eye lands on.
  // `sort` is stable in ES2019, so the groups keep the engine's order behind it.
  return out.sort((a, b) => (a.label === 'All 8' ? -1 : b.label === 'All 8' ? 1 : 0));
}
