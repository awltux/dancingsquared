// A TITLE THAT NAMES A RELATION IS A CLAIM ABOUT IDENTITY — and a board with no home couples cannot answer it.
//
// REPORTED: from a `Right and Left Grand Circle` the Drill offered `Dosado your Partner` as an option, and it did not
// look like a call that could be made from there. It was LEGAL by the only test the applicator makes: a call applies by
// tiling the board with one of its authored formations, and `Dosado your Partner` is authored from the two-dancer
// formation `Adjacent Dancers Close`, which a grand circle provides four times over (MEASURED: four groups, 1+2, 3+4,
// 5+6, 7+8, each 2.00 units apart). Nothing in that path reads the word "Partner".
//
// AND THE BOARD COULD NOT HAVE SUPPLIED IT. A formation whose name the couple registry covers (`alignment.ts`'s
// `FORMATION_SETUP_CODE`, eight names) stands up with its canonical home couples; every other one stands up ANONYMOUS,
// every dancer carrying `UNKNOWN_COUPLE`. MEASURED at level 1: of the 12 start boards the level's calls declare, 5 carry
// real couples and 7 do not — `Circle`, `Right and Left Grand Circle`, `Right and Left Grand Static Square`,
// `Column LH GBGB`, `Four Dancer Star Promenade`, `Ocean Waves LH BGBG`, `Ocean Waves LH BGGB`.
//
// SO THE RULE IS: a title that names your partner or your corner is only readable on a board that carries home couples.
// The geometry between two dancers cannot say whether they are partners, and `constants.ts` already says what
// `UNKNOWN_COUPLE` means — "nothing may treat this as a couple". Refusing is the honest answer; the alternative silently
// turns "the adjacent dancer" into "your partner", which is the reported defect and is a wrong CALL rather than a wrong
// picture.
//
// WHY THE REFUSAL IS HERE AND NOT IN THE MATCHER: the matcher matches a GEOMETRIC formation and is right to; the
// relation is a fact about the TITLE, and the applicator is the one place every caller's string is read (`applyToBoard`,
// `applySearch`, modules, lanes). Putting it at the reading boundary means the picker, the Drill, the Daily, the
// generator, the solver and the FSM all inherit it rather than each filtering its own list (AGENTS.md §11.4 #4).
//
// WHAT THIS DOES NOT DECIDE is whether a relation is SATISFIED once couples ARE known: on a board with identity a
// two-dancer formation still tiles whatever adjacent pair fits, and only the ones the applicator's own partition accepts
// are danced. That is a narrower question and it has no witness yet; this module states the boundary it does cover.
import { isKnownCouple } from './constants.js';
import type { Board } from './types.js';

/** The relations a call title can name, and the phrase a refusal uses for each. */
const RELATIONS: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\bpartner\b/i, what: 'your partner' },
  { pattern: /\bcorner\b/i, what: 'your corner' },
];

/**
 * Which relation `title` names, or null.
 *
 * IT IS THE TITLE, NOT THE FORMATION, because the corpus authors `Dosado your Partner` from `Adjacent Dancers Close` —
 * a shape, not a relation — and `Do Sa Do` from the same shape means the dancers opposite each other. The word is the
 * claim; the formation is where they stand.
 */
export function relationNamedBy(title: string): string | null {
  for (const { pattern, what } of RELATIONS) if (pattern.test(title)) return what;
  return null;
}

/**
 * Whether the board carries any home couple at all.
 *
 * ONE known couple is enough: `identifyByAssignment` is all-or-nothing against a setup's own spots, so a board it
 * covered has every dancer assigned, and a board it did not has none. The predicate says "some" rather than "all" so a
 * partly-identified board is treated as knowing its couples — refusing on it would be a second rule this module has no
 * measurement for.
 */
export function carriesCouples(board: Board): boolean {
  return board.dancers.some((d) => isKnownCouple(d.couple));
}

/**
 * The refusal for an application of `title` to `board`, or null when it may be read.
 *
 * THE SENTENCE SAYS WHICH relation and WHY it cannot be read, and it names the board's lack rather than the call's
 * fault: the call is well authored, and it is the board that cannot referee a partner.
 */
export function relationRefusal(board: Board, title: string): string | null {
  const what = relationNamedBy(title);
  if (!what) return null;
  if (carriesCouples(board)) return null;
  return `${title} names ${what}, and this board carries no home couples to read it from.`;
}
