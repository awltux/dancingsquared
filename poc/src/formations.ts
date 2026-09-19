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

const KEY = 'dsUserFormations';

export interface UserFormation {
  name: string;
  /** The board's dancers: geometry plus the gender it declared there. */
  dancers: (Matchable & { gender: Gender })[];
  /** When it was created, for the list. */
  created: string;
  /** What it was created from, for the list: "Call (from Setup)". */
  origin: string;
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

export function saveUserFormations(list: UserFormation[]): void {
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

/** Remove a labelled formation by name. Returns the new list. */
export function removeUserFormation(name: string): UserFormation[] {
  const list = loadUserFormations().filter((x) => x.name !== name);
  saveUserFormations(list);
  return list;
}
