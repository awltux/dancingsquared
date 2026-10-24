// A CALL VARIANT'S IDENTITY: THE LEVEL, THE CALL, AND THE FORMATION DEFINITION IT STARTS FROM.
//
// THE DEFINITION, which is the corpus's and not the book's: a call variant is a call title together with the
// formation it is used with, so one call title has as many variants as it has starting formations. Everything
// else about an authoring - its beats, its hands, its paths, its gender layout - is a property of that variant
// or of a BOARD, not of its name:
//
//   beats and hands belong to the LEVEL. MEASURED, the same call is authored with different beats at different
//   levels, which is why the level is an input here and those attributes are not: a Mainstream Swing and a Plus
//   Swing are two variants because the levels differ, and the figure would not change if the beats did.
//
//   gender belongs to the ARRANGEMENT (`arrangement-id.ts`). The manual does not list "Swing, boys on the left"
//   as a separate call, so a variant is gender-free and an arrangement qualifies the BINDING to an authoring.
//
// THE THIRD INPUT IS A DEFINITION'S STORED `fid`, NOT A COMPUTED FORMATION ID, and that is the whole of this
// module's design. A formation id is a CONTENT ADDRESS: correct a formation's geometry and it mints a new one, so
// every reference hanging off it would move. A `fid` is written on the definition in the corpus
// (`assets/formations.xml` or a `<tam>`'s inline `<formation>`) and is therefore authoritative by construction -
// an edit to the geometry leaves it alone and nothing has to be reconciled afterwards.
//
// WHAT THIS REPLACED, and why the replacement is smaller rather than merely different. The tree used to keep a
// generated ledger of every shape's FIRST id (`assets/formation-roots.json`) plus a hand-written alias file for
// the case where a shape was corrected, and this module resolved an id to its root before minting. MEASURED at the
// handover: the ledger held 198 lines and EVERY ONE was an identity - the alias half had never been used - so the
// machinery existed to reconstruct a stability that a stored tag has for free. `fid` is now that tag and this
// module takes it as given.
//
// WHY THE TITLE IS IN IT, WHEN A RETITLE IS THE THING THAT BREAKS. A retitle IS a rename, and the repo's rule is
// that a rename is a migration (§11.2.6); the variant id is minted from the title the corpus carries, and a caller
// that named an old id keeps its own copy of it. Excluding the title would make two different calls share an id,
// which is worse than a migration.
//
// IT IS STORED ON THE TAM AS `vid`. The corpus writes the id this function mints onto every authored `<tam>`, so a
// consumer can name the variant without resolving a level, a title and a definition first, and so the pair (call,
// its start definition) is visible in the file. That makes this id the one stored tag whose value is FULLY
// DETERMINED by the tree - unlike `fid`, it is never inherited from a shape the corpus already has - which is why
// `test/variant-tags.mjs` asserts stored EQUALS minted rather than merely consistent: a retitle or a level move
// re-mints it and the gate forces the migration into the open.
//
// WHY `V1-` AND EIGHT CHARACTERS. Eight characters is the tree's one payload width since the identity schemes were
// made consistent (`id-code.ts` owns it), and this scheme is the one that needed it: 1,730 variants today, over
// ms+plus alone, and the population grows with every level registered. The version marker means a change to the
// normalisation or the encoding cannot be mistaken for an old id.

import { encodeId, fnv1a64, isIdOf, ID_SCHEMES } from './id-code.js';

/** The scheme marker every call-variant id starts with. `id-code.ts` owns the table; a change to the
 *  normalisation or the encoding bumps it there. */
export const CALL_VARIANT_ID_VERSION = ID_SCHEMES.variant;

/**
 * The canonical serialisation the variant digest is taken over: level, title, formation `fid`.
 *
 * THE TITLE IS FOLDED, AND ONLY FOR CASE AND WHITESPACE. `Swing` and `swing ` are one call written twice, so a
 * re-spelling must not mint a second id; but the fold goes no further than that, because the repo has already
 * paid for an over-eager normaliser - stripping fractions collides `Tag the Line` with `3/4 Tag the Line`
 * (`map-calls.mjs` carries the measurement).
 */
export function callVariantCanonical(level: string, title: string, fid: string): string {
  const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${fold(level)}|${fold(title)}|${fid}`;
}

/**
 * The variant's id: the scheme's prefix and the tree's one eight-character payload.
 *
 * `fid` is a DEFINITION'S STORED TAG, not `formationId(board)`. The two coincide for a definition that roots its
 * own shape and differ for one that inherited its tag, and the difference is the point: a variant names the
 * definition the corpus has, so that a geometry correction cannot move it. Passing a computed formation id is the
 * one mistake this signature cannot catch, which is why the name says `fid`, and why the tag is a UID rather than a
 * digest: `test/formation-tags.mjs` checks every stored `fid` against the recorded minting in
 * `assets/formation-tag-provenance.json`, and deliberately NOT against the geometry the corpus has now.
 */
export function callVariantId(level: string, title: string, fid: string): string {
  return encodeId('variant', fnv1a64(callVariantCanonical(level, title, fid)));
}

/** Whether a string is a call-variant id this module produced. Case-insensitive, like its siblings. */
export function isCallVariantId(s: string): boolean {
  return isIdOf('variant', s);
}
