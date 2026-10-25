// User-defined formations: boards the engine's library could not name, labelled by a caller.
//
// WHY THIS IS LOCAL AND NOT WRITTEN INTO THE CORPUS. The corpus is `src/assets/formations.xml`, a
// file on disk - a browser cannot write it. So a labelled shape is kept in `localStorage` and
// REGISTERED with the running library, which is what makes it recognisable at once, and the panel
// offers the `<formation>` block for pasting into that file. This is the same shape as the call
// editor's edits (local first, exportable for the corpus) and for the same reason.
//
// THE GEOMETRY IS THE AUTHORITATIVE PART. A formation is its dancers' positions, facings and the
// gender declared at each spot; the NAME is the label a caller wants to see. Storing the board that
// produced it - rather than a reference to a call - is what lets it be registered later, in a fresh
// session, without that call being loaded.

import type { Gender, Matchable } from 'dancing-squared-engine';
import { canonicalName } from 'dancing-squared-engine';

const KEY = 'dsUserFormations';

export interface UserFormation {
  name: string;
  /** The board's dancers: geometry plus the gender it declared there. */
  dancers: (Matchable & { gender: Gender })[];
  /** When it was created, for the list. */
  created: string;
  /** What it was created from, for the list: "Call (from Setup)". */
  origin: string;
  /**
   * The CALL and SETUP it was created from - the ids, which `origin` only says in prose.
   *
   * Optional because every formation stored before this existed has none: `origin` is display text built from
   * the two dropdowns' labels, so it cannot be resolved back to a catalogue entry. The browse list's Edit
   * button needs the ids, and falls back to whatever is selected now when they are absent.
   */
  callId?: string;
  setupIdx?: number;
  /**
   * WHETHER THIS SHAPE HAS BEEN ADDED TO THE CORPUS - `assets/formations.xml`.
   *
   * A browser cannot write that file, so this is the CALLER'S ASSERTION that the `<formation>` block
   * has gone into it (the panel hands them the block and says so). It is the flag that lets a created
   * call be written as a `formation="Name"` REFERENCE instead of an embedded block: a reference to a
   * formation only this browser's store has is a call that does not load anywhere else, so the app
   * refuses to write one until the caller says the shape is in the corpus.
   */
  inCorpus?: boolean;
}

export function loadUserFormations(): UserFormation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as UserFormation[];
    if (!Array.isArray(list)) return [];
    // A stored entry with no dancers is not a formation; drop it rather than register a shape
    // that would match every empty board.
    return list.filter((f) => f && typeof f.name === 'string' && Array.isArray(f.dancers) && f.dancers.length > 0);
  } catch {
    return [];
  }
}

function saveUserFormations(list: UserFormation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore storage failures, as the edit store does */
  }
}

/** Add (or replace, by name) a labelled formation. Returns the new list. */
export function addUserFormation(f: UserFormation): UserFormation[] {
  const list = loadUserFormations().filter((x) => x.name !== f.name);
  list.push(f);
  saveUserFormations(list);
  return list;
}

/**
 * Record that a formation has (or has not) been added to the corpus. See `UserFormation.inCorpus`.
 *
 * Returns the new list, and does nothing if the name is not stored - a flag on a formation nobody has
 * is not a state worth inventing.
 */
export function setFormationInCorpus(name: string, inCorpus: boolean): UserFormation[] {
  const key = canonicalName(name);
  const list = loadUserFormations().map((f) => (canonicalName(f.name) === key ? { ...f, inCorpus } : f));
  saveUserFormations(list);
  return list;
}

/** The stored formation of that name, if any. Names are compared canonically, because the library
 *  canonicalises on the way in and the store keeps whatever was typed. */
export function findUserFormation(name: string): UserFormation | null {
  const key = canonicalName(name);
  return loadUserFormations().find((f) => canonicalName(f.name) === key) ?? null;
}

/** Remove a labelled formation by name. Returns the new list. */export function removeUserFormation(name: string): UserFormation[] {
  const list = loadUserFormations().filter((x) => x.name !== name);
  saveUserFormations(list);
  // DROP ITS DETACHMENTS TOO. A detachment says "this formation does not describe that call's
  // end"; with the formation gone the record is dangling, and leaving it would silently suppress a
  // FUTURE formation that happened to be given the same name.
  saveDetachments(loadDetachments().filter((d) => d.formation !== name));
  return list;
}

// ---------------------------------------------------------------- detaching a label

const DETACH_KEY = 'dsFormationDetachments';

/**
 * "This user-defined formation does NOT describe THIS call's end."
 *
 * WHY THIS IS SEPARATE FROM DELETING THE FORMATION, and why it is keyed by the CALL INSTANCE rather
 * than by anything geometric: recognition is a geometry question, and geometrically the shape IS the
 * shape - there is nothing to correct. What can be wrong is the APPLICATION of a label to one call:
 * a caller labels a shape from one call's end, and on a second call that happens to end in the same
 * geometry the label reads badly. Detaching is how that is said without throwing away a label that
 * is right everywhere else.
 *
 * It is deliberately NOT a change to the library: the shape keeps matching, so nothing else in the
 * app inherits a hole. The panel simply declines to apply that name to that instance.
 */
interface DetachedLabel {
  formation: string;
  /** The catalogue call id and setup index - the same identity the editor's edits use. */
  callId: string;
  setupIdx: number;
  detachedAt: string;
}

function loadDetachments(): DetachedLabel[] {
  try {
    const raw = localStorage.getItem(DETACH_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as DetachedLabel[];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.formation === 'string' && typeof d.callId === 'string') : [];
  } catch {
    return [];
  }
}

function saveDetachments(list: DetachedLabel[]): void {
  try {
    localStorage.setItem(DETACH_KEY, JSON.stringify(list));
  } catch {
    /* ignore storage failures, as the edit store does */
  }
}

function isDetached(formation: string, callId: string, setupIdx: number): boolean {
  return loadDetachments().some((d) => d.formation === formation && d.callId === callId && d.setupIdx === setupIdx);
}

/** Detach a label from one call instance. Returns the new list. */
export function detachLabel(formation: string, callId: string, setupIdx: number): DetachedLabel[] {
  const list = loadDetachments().filter((d) => !(d.formation === formation && d.callId === callId && d.setupIdx === setupIdx));
  list.push({ formation, callId, setupIdx, detachedAt: new Date().toISOString() });
  saveDetachments(list);
  return list;
}

/** Undo a detach. Returns the new list. */
export function reattachLabel(formation: string, callId: string, setupIdx: number): DetachedLabel[] {
  const list = loadDetachments().filter((d) => !(d.formation === formation && d.callId === callId && d.setupIdx === setupIdx));
  saveDetachments(list);
  return list;
}

/**
 * The name the panel should SHOW for a board, given what it detected.
 *
 * Two reasons a detected user-defined name is not applied, and they are different in kind:
 *
 *  - the formation is NO LONGER STORED. Removing one cannot un-register it from the live library
 *    (there is no unregister, and cached reads name it), so without this the destructive button
 *    would appear to do nothing until the page was reloaded.
 *  - it was DETACHED from this instance, which is the caller saying the label is wrong HERE.
 *
 * BOTH REASONS ARE REPORTED, NEVER SWALLOWED. The first version returned a bare null and the field
 * simply read "not named" - which is the same thing it says when the library does not know the shape
 * at all. That is an INSTRUMENT THAT CANNOT REPORT ITS OWN STATE, and it cost a round trip: a label
 * the library HAD recognised was being declined for a reason the panel did not say. So the reason
 * comes out with the answer and the panel puts it on screen, with the button that fixes it.
 *
 * Names are compared CANONICALLY (`canonicalName`), because the library canonicalises on the way in
 * and the store keeps what was typed: naming a shape "Squared Set" registers as "Static Square", and
 * comparing the two spellings directly would decline a label that is there.
 *
 * A name from the shipped corpus is never filtered: this is about user-defined labels only.
 */
interface AppliedLabel {
  name: string | null;
  /** The detected name, when it was NOT applied - so the panel can name the label it declined. */
  suppressed: string | null;
  reason: 'detached' | 'not-stored' | null;
}

export function applyLabel(detected: string | null, userDefined: boolean, callId: string, setupIdx: number): AppliedLabel {
  if (!detected || !userDefined) return { name: detected, suppressed: null, reason: null };
  const key = canonicalName(detected);
  const stored = loadUserFormations().some((f) => canonicalName(f.name) === key);
  if (!stored) return { name: null, suppressed: detected, reason: 'not-stored' };
  if (isDetached(detected, callId, setupIdx)) return { name: null, suppressed: detected, reason: 'detached' };
  return { name: detected, suppressed: null, reason: null };
}
