// A CALL VARIANT'S IDENTITY: THE LEVEL, THE CALL, AND THE FORMATION IT STARTS FROM.
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
// WHY THE FORMATION IS A ROOT, NOT A FORMATION ID. A formation id is a CONTENT ADDRESS: edit one formation and
// every variant hanging off it is re-keyed. MEASURED over ms+plus, the busiest start shape carries 120 variants
// and the next four carry 115, 102 and 96 - so one geometry correction would move a hundred ids at once. The
// ROOT is the first formation id ever minted for a shape, carried forward through the ledger's aliases
// (`assets/formation-roots.json`): a geometry correction mints a new formation id, the ledger aliases it to the
// root, and THIS id does not move.
//
// THE PURITY CLAIM IS DIFFERENT FROM `formation-id.ts`'S, AND DELIBERATELY SO. A formation id is a pure function
// of the board. This id is a pure function of (level, title, formation root), and the root is a pure function of
// the board PLUS the checked-in ledger - it is history, not geometry. That is the whole point: an id that is
// re-derived from geometry cannot be a reference that survives an edit to geometry.
//
// WHY THE TITLE IS IN IT, WHEN A RETITLE IS THE THING THAT BREAKS. A retitle IS a rename, and the repo's rule is
// that a rename is a migration (§11.2.6): the ledger mints the new id and keeps the old one as an alias, so a
// consumer that named the old id keeps resolving. Excluding the title would make two different calls share an
// id, which is worse than a migration.
//
// WHY `V1-` AND EIGHT CHARACTERS. Eight characters is the tree's one payload width since the identity schemes
// were made consistent (`id-code.ts` owns it), and this scheme is the one that needed it: 1,730 variants today, over
// ms+plus alone, and the population grows with every level registered. The version marker means a change to the
// normalisation or the encoding cannot be mistaken for an old id.

import { encodeId, fnv1a64, isIdOf, ID_SCHEMES } from './id-code.js';

/** The scheme marker every call-variant id starts with. `id-code.ts` owns the table; a change to the
 *  normalisation or the encoding bumps it there. */
export const CALL_VARIANT_ID_VERSION = ID_SCHEMES.variant;

/**
 * The append-only ledger of formation roots: every formation id ever minted, mapped to the id the shape was first
 * known by. A JSON object so the ledger is a checked-in file the engine never reads itself - the caller injects
 * it, which is what keeps this module free of I/O.
 */
export type FormationRoots = Readonly<Record<string, string>>;

/**
 * The root a formation id belongs to: the id itself when the ledger has never seen it (a shape minted since the
 * last census), otherwise the id it was aliased to.
 *
 * Chains are followed because a ledger may record a rename before it is flattened, and a cycle is refused
 * rather than followed forever: a cycle is a ledger defect the census gate reports, and a hung build is a worse
 * way to learn about it.
 */
export function formationRootOf(formationId: string, roots: FormationRoots): string {
  const start = formationId;
  let current = start;
  const seen = new Set<string>([start]);
  for (;;) {
    const next = roots[current];
    if (next === undefined || next === current) return current;
    // A CYCLE HAS NO ROOT, so the id that was asked about is returned unchanged rather than an arbitrary
    // member of the cycle: a caller then sees a stable answer for a defective ledger, and the census gate is
    // what refuses the ledger.
    if (seen.has(next)) return start;
    seen.add(next);
    current = next;
  }
}

/**
 * The canonical serialisation the variant digest is taken over: level, title, root.
 *
 * THE TITLE IS FOLDED, AND ONLY FOR CASE AND WHITESPACE. `Swing` and `swing ` are one call written twice, so a
 * re-spelling must not mint a second id; but the fold goes no further than that, because the repo has already
 * paid for an over-eager normaliser - stripping fractions collides `Tag the Line` with `3/4 Tag the Line`
 * (`map-calls.mjs` carries the measurement).
 */
export function callVariantCanonical(level: string, title: string, formationRoot: string): string {
  const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${fold(level)}|${fold(title)}|${formationRoot}`;
}

/**
 * The variant's id: the scheme's prefix and the tree's one eight-character payload.
 *
 * `formationRoot` is a ROOT, not a formation id - `formationRootOf(formationId(board), roots)` is the call that
 * produces it. Passing a raw formation id is the one mistake this signature cannot catch, which is why the
 * name says root and the ledger gate checks that every referenced root exists.
 */
export function callVariantId(level: string, title: string, formationRoot: string): string {
  return encodeId('variant', fnv1a64(callVariantCanonical(level, title, formationRoot)));
}

/** Whether a string is a call-variant id this module produced. Case-insensitive, like its siblings. */
export function isCallVariantId(s: string): boolean {
  return isIdOf('variant', s);
}
