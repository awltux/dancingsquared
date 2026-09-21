// What the FSM tab's Load / Edit icons act on.
//
// THE FSM NAMES CALLS, NOT CATALOGUE ENTRIES. An edge carries a call TITLE and the FORMATION its state
// leaves from, while the rest of the app addresses a call by `(callId, setupIdx)` - an id built from the
// FILE and TITLE, and an index into that call's authored setups. So the pair has to be resolved, and the
// resolution is the whole content of "Load" and "Edit" in that panel.
//
// THE SETUP IS TAKEN ONLY WHEN THE FORMATION NAMES ONE EXACTLY. An FSM state and a `<tam>`'s `from` are
// two vocabularies for the same geometry - the state is the name the RECOGNISER gave a board, the setup
// is the name the AUTHOR wrote - so they agree on "Wave RH" and disagree on "Static Square" vs "Facing
// Couples". MEASURED on the shipped asset (poc/tools/fsm-open-probe.mjs): of its 1961 edges, 242 name one
// of the call's setups exactly. Matching the state's GEOMETRY against each setup's built start board
// instead reaches 447 of the 1408 edges that have a catalogue entry at all (32%), even at a 0.5-unit
// tolerance, and for the rest the
// closest setup is 7 to 21 units away on a six-unit square - because the FSM enumerates calls through
// the applicator's tolerance and its coded moves, not through the catalogue's setups. A "nearest setup"
// guess would therefore be wrong far more often than right, and silently so; an exact name match is a
// CERTAINTY. Everything else falls back to the call's FIRST setup, which is what picking the call by
// hand shows, and the panel says which setup it landed on.
//
// AND A CODED MOVE HAS NO ENTRY AT ALL. 136 of those 1961 edges name a call the catalogue does not hold -
// 133 of them `Face Half`, 3 `Promenade` - because those are applied by rule rather than from a `<tam>`.
// They resolve to nothing and the panel says so, instead of loading an unrelated call of a similar name.

/** The part of a catalogue entry this needs: the setups are what a formation names. */
export interface FsmCatalogEntry {
  id: string;
  level: string;
  title: string;
  setups: { label: string; from: string }[];
}

/**
 * The setup index a formation names in a call's setup list, or 0 when it names none.
 *
 * BOTH FIELDS ARE CHECKED, because `label` is the formation and `from` is the older name it replaced
 * (`setupLabel` prefers the former), and an FSM built before that change - or a tam that carries only
 * `from` - names the setup by the other one.
 */
export function setupForFormation(setups: { label: string; from: string }[], formation: string | null): number {
  if (!formation) return 0;
  const i = setups.findIndex((s) => s.label === formation || s.from === formation);
  return i >= 0 ? i : 0;
}

/**
 * The catalogue entry an FSM row names, preferring the level whose tree is on screen.
 *
 * A TITLE IS AUTHORED AT SEVERAL LEVELS - it is the same call danced from the same setups, written again
 * for a later list - so the level of the FSM the row was clicked in is what decides which authoring is
 * meant. Only when that level has no such title does the first one found stand in, which is a real case:
 * the FSM is built from the catalogue of its own level, so the fallback is for a name that has been
 * renamed or dropped since the asset was built, and showing it beats showing nothing.
 */
export function fsmCatalogEntry<T extends FsmCatalogEntry>(entries: T[], title: string, level: string): T | null {
  const named = entries.filter((c) => c.title === title);
  if (named.length === 0) return null;
  return named.find((c) => c.level === level) ?? named[0];
}

/** The `(entry, setup)` an FSM row names, or null for a call the catalogue does not have. */
export function fsmTarget<T extends FsmCatalogEntry>(
  entries: T[],
  title: string,
  formation: string | null,
  level: string,
): { entry: T; setupIdx: number } | null {
  const entry = fsmCatalogEntry(entries, title, level);
  return entry ? { entry, setupIdx: setupForFormation(entry.setups, formation) } : null;
}
