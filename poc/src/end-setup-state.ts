// WHAT THE END SETUP ROW SAYS ABOUT THE SHAPE THE CALL ACTUALLY FINISHES ON, and whether it can be exported.
//
// REPORTED as: "Call Editor: Add a check to the call-changed event that calculates the end setup and looks it up in
// known formations. Set the End Setup to the found formation, or show "Unknown formation". If the end formation is
// unknown and it's an 8-dancer board, provide an "export <formation>" button on the "End Setup" row." The panel
// already SET the picker to the corpus's name for the end (`namedSetup`), but when nothing in the corpus names that
// shape the assignment left the picker on its neutral placeholder - so the one state the caller most needs to see,
// "this end is not a formation the corpus has", was the one the panel said nothing about.
//
// THE PLACEHOLDER IS THE STATEMENT, rather than a note beside it: the picker's leading option is already the
// "nothing chosen" entry, and writing the truth into it puts the answer where the caller is looking, with no second
// line to disagree with the control. `Unknown formation` is a statement about the BOARD - the corpus has no formation
// those dancers finish on - and it does not mean the picker is broken.
//
// AND THE WAY OUT OF THAT STATE IS TO AUTHOR THE SHAPE, so the row offers the same `Export <formation>` the START
// setup has - but only for an EIGHT-DANCER board. That is not an arbitrary size: every formation the corpus ships is
// an eight-dancer set (`engine/test/shape-census.mjs` pins "namedFormations is 217 entries and every one is 8
// dancers"), and `formations.xml` is written as half a set that the reader turns 180 degrees to complete. A shorter
// end could be exported - `formationXml` writes any size - but it would be a formation no call in this corpus could
// name, which is a file edit pretending to be a fix. So the button appears only where the paste has somewhere to go.
//
// PURE AND SEPARATE FROM THE PANEL, because a rule that only exists inside a DOM method can be read but not measured
// (AGENTS.md §8 trap 27): `poc/tools/end-setup-name-probe.mjs` drives every case here and checks the panel uses it.

/** The picker's leading option: "nothing chosen", which is also "the end is not a named formation". */
export const KEEP_END_PLACEHOLDER = '— keep the current end —';

/** What that option says instead when the corpus cannot name the shape the call finishes on. */
export const UNKNOWN_FORMATION = 'Unknown formation';

export interface EndSetupState {
  /** The text of the picker's leading (empty-valued) option. */
  readonly placeholder: string;
  /** Whether the row offers `Export <formation>` for this board. */
  readonly canExport: boolean;
}

/**
 * What the End setup row says and offers for a call that finishes on `name`'s formation - or on none, when `name`
 * is empty. `dancers` is the board's size, which decides whether an export has anywhere to go.
 */
export function endSetupState(name: string | null | undefined, dancers: number): EndSetupState {
  const known = (name ?? '').trim() !== '';
  return {
    placeholder: known ? KEEP_END_PLACEHOLDER : UNKNOWN_FORMATION,
    // An export is for a shape the corpus does not name, on a board the corpus could hold: eight dancers.
    canExport: !known && dancers === 8,
  };
}
