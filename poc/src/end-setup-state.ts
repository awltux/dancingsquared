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
// line to disagree with the control. `Unknown Setup` is a statement about the BOARD - the corpus has no setup those
// dancers finish on - and it does not mean the picker is broken.
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
//
// AND THE ID, WHEN THE BOARD HAS ONE BUT THE CORPUS HAS NO NAME FOR IT. Reported as: "The End Setup dropdown shows
// 'Unknown formation' if the start setup doesn't have a name. With the advent of the sid on all catalog formations, if
// the end formation is identified but not named, use the sid instead. At least this way the formation can be found."
// The sid is the SETUP id - the arrangement AND the authored order the dancers are listed in (`setup-id.ts`) - and it
// is the key the Board drawer's Setup picker is keyed by, so the id is the handle a caller can carry elsewhere: it is
// the id that picker lists the setup under wherever the corpus authors one. MEASURED (`poc/tools/end-setup-name-probe.mjs`
// over all 5424 call variants): 2480 ends are unnamed, every one of them carries an id, and 61 of those ids (59 of them
// eight-dancer) are setups the Board picker already offers - so the id leads somewhere for a small population and is a
// stable identity rather than nothing for the rest. It is NOT offered as a choice in this picker: that list is the
// corpus's NAMES (`corpusFormationsOfSize`), so an id could not be resolved by `doEndFormation`, and an option nothing
// can select is a trap. The row therefore STATES the id and leaves the way out where it was - the export, for a shape on
// a board the corpus could hold.
//
// AND WHEN THE END IS UNNAMED THERE ARE TWO WAYS OUT, not one: author the shape (the export above), or FIND the shape the
// dance is merely outside of. Reported as: "When the end setup displays Unknown formation, offer a filter icon button to
// the right of the select element. This button filters the listed setups to those that are close matches. I find I need
// this because some call moves leave the dancers in positions that are just outside a matching formation ... If this list
// is empty, then that also tells me that this is a completely new formation." The MARGIN and the SEARCH are the ENGINE's
// (`nearEndFormations` / `NEAR_END_BOARD_TOL`), because "which named shape does this board almost stand on" is a geometry
// question with a measured answer; this module owns only the two claims about the ROW - whether the filter is offered
// (`showsNearFilter`) and what it says when pressed (`nearFilterNote`) - and both are pure, so a probe drives them.

/** The picker's leading option: "nothing chosen", which is also "the end is not a named formation". */
export const KEEP_END_PLACEHOLDER = '— keep the current end —';

/**
 * What that option says instead when the corpus cannot name the setup the call finishes on.
 *
 * IT SAYS "SETUP", NOT "FORMATION", and the shorter word is the true one for this row: a FORMATION is the shape, while
 * the SETUP is the shape, the arrangement AND the order the dancers are listed in - which is what the `sid` beside this
 * sentence is the id of (`setup-id.ts`) and what `doEndFormation` re-bases onto. Asked for as: 'Instead of "Unknown
 * Formation" it should say "Unknown Setup"'.
 */
export const UNKNOWN_SETUP = 'Unknown Setup';

interface EndSetupState {
  /** The text of the picker's leading (empty-valued) option. */
  readonly placeholder: string;
  /** Whether the row offers `Export <formation>` for this board. */
  readonly canExport: boolean;
}

/**
 * What the End setup row says and offers for a call that finishes on `name`'s formation - or on none, when `name`
 * is empty. `dancers` is the board's size, which decides whether an export has anywhere to go; `setupId` is the END
 * board's computed setup id, shown where it exists and the corpus has no name.
 */
export function endSetupState(
  name: string | null | undefined,
  dancers: number,
  setupId?: string | null,
): EndSetupState {
  const known = (name ?? '').trim() !== '';
  const id = (setupId ?? '').trim();
  return {
    // THE STATEMENT COMES FIRST AND THE ID BESIDE IT, because they answer different questions: "the corpus does not
    // name this end" is still true, and `S1-…` is which setup it is. A bare id would read as a name this picker offers,
    // and a caller would try to select it - the probe pins that wrong rule as its negative control.
    placeholder: known ? KEEP_END_PLACEHOLDER : id === '' ? UNKNOWN_SETUP : `${UNKNOWN_SETUP} (${id})`,
    // An export is for a shape the corpus does not name, on a board the corpus could hold: eight dancers. An id does
    // not name the shape, so it does not remove the export.
    canExport: !known && dancers === 8,
  };
}

/**
 * WHETHER THE END SETUP ROW OFFERS ITS NEAR-MATCH FILTER: only when the corpus does not name the shape the call
 * finishes on.
 *
 * A NAMED END ALREADY HAS THE ANSWER. The picker opens on that formation and the row says so, so a filter over the same
 * list could only hide the entry the row is pointing at - and the question the filter asks ("what is the corpus's
 * nearest shape?") is not a question a caller has while the name is on screen.
 *
 * Asked for as: "When the end setup displays Unknown formation, offer a filter icon button to the right of the select
 * element ... I find I need this because some call moves leave the dancers in positions that are just outside a matching
 * formation." That state is `endSetupState`'s placeholder, and this reads the same NAME rather than the placeholder text,
 * so the two cannot disagree about what "unknown" means.
 */
export function showsNearFilter(name: string | null | undefined): boolean {
  return (name ?? '').trim() === '';
}

/**
 * WHAT THE FILTER SAYS WHEN IT IS PRESSED: how many named formations are within the relaxed margin of this end, who is
 * nearest - or the verdict that nothing is, which is the sentence the caller reads as "this is a completely new
 * formation".
 *
 * THE COUNT AND THE TOLERANCE ARE BOTH IN THE SENTENCE, because "no matches" without the margin is indistinguishable
 * from a broken list: a caller has to be able to see that the filter looked 0.20 units out and found nothing, rather
 * than inferring it from an empty picker. The empty case also names the way out, because there is one - the export.
 *
 * `tol` IS STRUCTURAL rather than a named type of this module: it is the ENGINE's `NEAR_END_BOARD_TOL` (`EndBoardTolerance`)
 * that the panel passes, so this module neither owns nor re-spells the margin - it only prints it.
 *
 * PURE AND SEPARATE FROM THE PANEL for the reason this module exists at all (AGENTS.md §8 trap 27): the wording and the
 * arithmetic are driven by `poc/tools/end-near-filter-probe.mjs`, not read out of a 6,000-line DOM method.
 */
export function nearFilterNote(
  found: number,
  total: number,
  tol: { position: number; heading: number },
  closest?: string | null,
): string {
  const margin = `${tol.position.toFixed(2)} units / ${tol.heading.toFixed(2)} rad`;
  if (found === 0) {
    return `no named formation is within ${margin} of this end — it is a shape the corpus does not carry, so Export it`;
  }
  const near = (closest ?? '').trim();
  const who = near === '' ? '' : ` — closest ${near}`;
  return `${found} of ${total} named formations ${found === 1 ? 'is' : 'are'} within ${margin}${who}`;
}

/** The end board's identity tags and what the corpus holds under them. */
export interface EndIdentity {
  /** The board's FORMATION id (`fid`), or null where the engine computes none (no physical dancers). */
  fid: string | null;
  /** The board's ARRANGEMENT id (`aid`), the same condition. */
  aid: string | null;
  /** THE NAMES OF THE FORMATIONS THAT CARRY THAT `fid` - the same spots and facings, whatever the rotation. Empty when
   *  nothing does. `formationsCarrying` answers it over the call's own size, not the eight-dancer setup catalogue. */
  shapes: string[];
  /** The names of the formations that carry that `aid` - the same board, dancer for dancer. Empty when nothing does. */
  arrangements: string[];
}

/** One caption the picker lists above its names: the id, and what the corpus holds under it. */
export interface EndIdentityOption {
  id: string;
  label: string;
}

/** How many names a caption lists before it summarises the rest. */
const IDENTITY_NAMES_SHOWN = 3;

/**
 * THE IDS OF AN UNNAMED END, AS TWO CAPTION LINES FOR THE TOP OF THE SETUP LIST - `aid` first, then `fid`.
 *
 * Asked for as: "If the unknown 'end setup' matches a formation or arrangement, list the fid and aid at the top of the
 * list of setups." The ids are what the corpus's own tags say the board IS (`sid ⇒ aid ⇒ fid`, `setup-id.ts`), and the
 * sid is already in the placeholder (`07f4d596`); these two lines answer the other half of the question - WHICH
 * ARRANGEMENT and WHICH SHAPE the dance has arrived in. That is the distinction a caller needs at this row: an unnamed
 * board whose `fid` the corpus holds is a KNOWN shape in a new arrangement, where one whose `fid` nothing holds is a
 * shape the corpus has never carried at all.
 *
 * THE ARRANGEMENT COMES FIRST, and it is the same order as the id scheme and as the specificity of the claim: asked for as
 * "Switch the formation and arrangement hints so that arrangement comes first." The `aid` is the stronger statement - the
 * board dancer for dancer, which is what "is this a setup the corpus has?" is really asking - while the `fid` is the
 * weaker "the same spots and facings, whatever the rotation", so the more precise line leads and the fallback follows.
 *
 * EACH LINE SAYS WHAT IT MATCHES, and says NOTHING when it has no id: a board with no physical dancers has no ids to
 * print, and a line with a dash in it would be noise on every four-dancer call. Each name is a FORMATION of the call's own
 * size (`formationsCarrying`), which is what makes "matches a formation or arrangement" checkable by eye - and selectable,
 * since those are the names the picker beside it offers.
 *
 * THE LINES ARE CAPTIONS, NOT CHOICES (the panel renders them `disabled`): this picker's values are the corpus's formation
 * NAMES, and an id cannot be resolved by `doEndFormation` - an option nothing can select is a trap, which is the same
 * rule the sid statement follows (`end-setup-state.ts`'s header).
 */
export function endIdentityOptions(identity: EndIdentity | null): EndIdentityOption[] {
  if (!identity) return [];
  const out: EndIdentityOption[] = [];
  const list = (names: readonly string[]): string =>
    names.length === 0
      ? ''
      : names.length <= IDENTITY_NAMES_SHOWN
        ? names.join(' / ')
        : `${names.slice(0, IDENTITY_NAMES_SHOWN).join(' / ')} (+${names.length - IDENTITY_NAMES_SHOWN} more)`;
  const aid = (identity.aid ?? '').trim();
  if (aid !== '') {
    const arrangements = list(identity.arrangements);
    out.push({
      id: aid,
      label:
        arrangements === ''
          ? `${aid} — no corpus setup carries this arrangement`
          : `${aid} — arrangement: ${arrangements}`,
    });
  }
  const fid = (identity.fid ?? '').trim();
  if (fid !== '') {
    const shapes = list(identity.shapes);
    out.push({
      id: fid,
      label: shapes === '' ? `${fid} — no corpus formation carries this shape` : `${fid} — formation: ${shapes}`,
    });
  }
  return out;
}


