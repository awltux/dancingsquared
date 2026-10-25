// Dancer-selection resolution. A subset call may be prefixed by a selection that
// names which dancers act (Heads, All, Centers, Boys, Girls, Ends, Couples, Men,
// Women, Leaders, Same 4, Head Position, Couple #N, "N Boys Have Girl On Right",
// etc.). This module parses a selection string into a group key usable by
// Grouping.subsetOf, and a "base call" with the selection removed.

// Map a normalized selection string to a Grouping.subsetOf group key, or null if
// not a recognized single-group selection.
//
// `'partner'` USED TO BE HERE, mapped to `'partners'`, and it was a DANGLING KEY: `Grouping.subsetOf`
// has no `partners` case, so the mapping made `splitSelection` claim a selection that nothing could
// ever resolve. MEASURED on the census's one case, `Partner Trade 1 1/2`: it split into
// `{ selection: 'Partner', call: 'Trade 1 1/2' }`, neither name is a registered call, and the failure
// surfaced as "Unresolvable selection: Partner" - an accusation about a GROUP, for a call the engine
// simply does not have. `Partner Trade` and `Partner Hinge` ARE registered calls, so the whole-board
// path already handles them and never reaches this table. Removing the key makes the engine say what
// is true: `Unknown call: Partner Trade 1 1/2`.
const SELECTION_GROUP: Record<string, string> = {
  'heads': 'heads', 'sides': 'sides', 'boys': 'boys', 'girls': 'girls',
  'men': 'men', 'women': 'women', 'ladies': 'girls', 'centers': 'centers',
  'ends': 'ends', 'couples': 'couples', 'all': 'all', 'everybody': 'all',
  'everyone': 'all', 'leaders': 'leaders', 'trailers': 'trailers',
  'beaus': 'beaus', 'belles': 'belles',
  // THE SINGULAR TOKEN FORMS, because the combination grammar is built from TOKENS and the reference
  // spells them singular: `coded_call.dart`'s `specifier` is `Boys?|Girls?|Beaus?|Belles?|Center\d?|
  // Ends?|Lead(er)?s?|Trail(er)?s?|Heads?|Sides?|...`, and its test corpus writes "Head Boys",
  // "Head Girls", "Side Boys", "End Girl". Without these, "Head Boys" has no token for "Head" and the
  // expression never parses at all. They are aliases of the plural keys above - one group each, not a
  // second vocabulary.
  'head': 'heads', 'side': 'sides', 'boy': 'boys', 'girl': 'girls',
  'man': 'men', 'woman': 'women', 'lady': 'girls', 'center': 'centers',
  'end': 'ends', 'couple': 'couples', 'leader': 'leaders', 'trailer': 'trailers',
  'beau': 'beaus', 'belle': 'belles',
};

// Multi-word selectors recognized as a fixed phrase -> (groupKey | special).
//
// `head ladies` AND `side ladies` USED TO BE HERE, mapping to `heads`/`sides`, and that was WRONG in a
// way the combination grammar fixes: "Head Ladies" names the GIRLS of the head couples, and the
// mapping handed back ALL FOUR head dancers. With tokens intersected it resolves through the general
// rule instead (`heads` ∩ `girls`), which is the two dancers the phrase actually means.
// `head couples`/`side couples` STAY, because there "couples" means the whole couple rather than the
// couples' boys or girls, which is not an intersection of anything.
const PHRASE_SELECTION: Record<string, string> = {
  'same 4': 'same4', 'same four': 'same4',
  'head position': 'headposition', 'side position': 'sideposition',
  'head couples': 'heads', 'side couples': 'sides', 'very centers': 'verycenters',
  'outside 6': 'outside6', 'outer 6': 'outside6',
  'four ladies': 'girls', 'all 4 couples': 'all', 'all four couples': 'all',
};

// Regexes for parametric selectors. Each returns {group, ...} or null.
const COUPLE_RE = /^couple #(\d+)$/;
const THOSE_COUPLE_RE = /^those in couple #(\d+) spot$/;
const HEAD_LADIES_N_RE = /^(\d+) ladies chain$/;
const N_BOYS_GIRL_RIGHT_RE = /^(one|two|three|four) (boy|girl)s? have (girl|boy) on (right|left)$/;
const N_SELECTION_RE = /^(one|two|three|four) (boys|girls|men|women|ladies)$/;
const N_COUPLE_RE = /^couple #(\d+) and #(\d+)$/;

/**
 * EVERY GROUP NAME THE ENGINE CAN OFFER, as data - the single source for the picker's "Who" list, for a
 * permission rule's `group`, and for anything that has to name all of them.
 *
 * WHY A LIST RATHER THAN A GENERATOR. The combination grammar is general (`parseGroupExpression`: tokens
 * intersect within a side, sides union, a negator subtracts), so the space is thousands of strings and most
 * are nonsense ("Girls and Trailer Boys"). What a caller actually says is a short, well-known list, so the
 * engine offers that; `Sequencer.subsetGroups` / `combinedGroups` then keep only the names that resolve to
 * a proper subset WHERE THE DANCERS ARE STANDING. These arrays are those candidates BEFORE the board
 * filter, which is what makes them the vocabulary rather than one board's answer.
 *
 * THREE ARRAYS, BECAUSE THEY HAVE TWO CONSUMERS WITH DIFFERENT NEEDS. A permission rule names a CATEGORY -
 * "every single-group reading", "the couple selectors", "the combinations" - while the picker needs an
 * ORDER. So the categories are `SINGLES_GROUP_NAMES` and `COUPLES_GROUP_NAMES`, the combinations are
 * `COMBINED_GROUP_NAMES`, and `SUBSET_GROUP_NAMES` is the first two in picker order. A rule may spread any
 * of them: `group: ['All 8', ...SINGLES_GROUP_NAMES]` denies every whole-set gender reading at once.
 *
 * THE ORDER IS THE PICKER'S, so it is not alphabetical and must not be re-sorted.
 *
 * THREE NAMES HERE RESOLVE ON NO NAMED FORMATION, and they are kept deliberately rather than pruned:
 * `Couples` is everyone on a square (so never a PROPER subset there) and appears only on a board holding a
 * couple among others, and `Very Center Boys` / `Very Center Girls` need a board whose very centres are one
 * gender. MEASURED over the 138 named formations, 0 of them reach each; `test/group-calls.mjs` pins that
 * count, so a fourth unreachable name is a red line instead of a rumour.
 *
 * `All 8` IS NOT A SELECTION - it is the whole-board reading, and the one spelling a request carries
 * (`mayOffer` normalises an absent, null or `All 8` request group to it). It is first because it is the
 * picker's default, and it is deliberately NOT in any of the arrays below: they are all filtered as PROPER
 * subsets, and the whole board is not one.
 */
export const SINGLES_GROUP_NAMES: readonly string[] = [
  'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Centers',
  'Ends', 'Couples', 'Leaders', 'Trailers', 'Beaus', 'Belles',
];

export const COUPLE_GROUP_NAMES: readonly string[] = [
  'Couple #1', 'Couple #2', 'Couple #3', 'Couple #4',
];

/** The readings that name WHOLE COUPLES - the head and side pairs, and the numbered couples. */
export const COUPLES_GROUP_NAMES: readonly string[] = [
  'Heads', 'Sides',
  ...COUPLE_GROUP_NAMES,
];

/**
 * The same eighteen names in the ORDER THE PICKER SHOWS THEM, which is the only order that matters here:
 * `Sequencer.subsetGroups` returns this array filtered, and the group `<select>` is built from what it
 * returns.
 *
 * IT IS SPELLED OUT RATHER THAN COMPOSED FROM THE TWO CATEGORIES, because the two serve different
 * consumers - a permission rule wants a CATEGORY ("every single-group reading") while the picker wants an
 * ORDER, and the caller's own order leads with `Heads` and `Sides`, not with `Boys`. Composing it as
 * `[...SINGLES, ...COUPLES]` silently moved the two most-named groups to the end of the dropdown.
 * `test/group-calls.mjs` pins that this list is exactly the two categories as a SET, so a name added to a
 * category and forgotten here is a red rather than a name the picker cannot offer.
 */
export const SUBSET_GROUP_NAMES: readonly string[] = [
  ...COUPLES_GROUP_NAMES, ...SINGLES_GROUP_NAMES,
];

/** The combinations - see `SUBSET_GROUP_NAMES` for the order and the three unreachable names. */
export const COMBINED_GROUP_NAMES: readonly string[] = [
  // THE FOUR THE CALLER NAMES. "Head Boys" is two dancers, not the four heads.
  'Head Boys', 'Head Girls', 'Head Men', 'Head Women', 'Head Beaus', 'Head Belles',
  'Side Boys', 'Side Girls', 'Side Men', 'Side Women', 'Side Beaus', 'Side Belles',
  // POSITION AND ROLE, which exist only in the formations that have them.
  'Center Boys', 'Center Girls', 'End Boys', 'End Girls',
  'Leader Boys', 'Leader Girls', 'Trailer Boys', 'Trailer Girls',
  'Very Center Boys', 'Very Center Girls',
  // UNIONS - the reference's `DoubleSelector`, e.g. the two diagonal pairs.
  'Head Boys and Side Girls', 'Head Girls and Side Boys',
  'Head Boys and Head Girls', 'Side Boys and Side Girls',
];

/** Every group name the engine offers: the whole-board reading, then the halves in picker order. */
export const GROUP_NAMES: readonly string[] = ['All 8', ...SUBSET_GROUP_NAMES, ...COMBINED_GROUP_NAMES];


/** Normalize a selection phrase for lookup. */
export function normalizeSelection(s: string): string {
  return s.trim().toLowerCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a selection string to a group key for Grouping.subsetOf, or a special
 * token. Returns null when unrecognized.
 */
export function selectionGroup(sel: string): string | null {
  const n = normalizeSelection(sel);
  if (!n) return null;
  if (SELECTION_GROUP[n]) return SELECTION_GROUP[n];
  if (PHRASE_SELECTION[n]) return PHRASE_SELECTION[n];
  if (COUPLE_RE.test(n)) return 'couples'; // specific couple handled by resolver
  if (THOSE_COUPLE_RE.test(n)) return 'couples';
  if (N_BOYS_GIRL_RIGHT_RE.test(n)) return 'boys-girl-right';
  if (N_SELECTION_RE.test(n)) return 'gender-count';
  if (HEAD_LADIES_N_RE.test(n)) return 'girls';
  if (N_COUPLE_RE.test(n)) return 'couples';
  return null;
}

/**
 * THE READING a raw call string names: the LIBRARY's own name when it publishes one, otherwise a group plus a base
 * call.
 *
 * WHY THE ORDER MATTERS, and why this is not `splitSelection` with a nicer name. `Heads Pass Thru` is a `<tam
 * title=...>` in `ms/pass_thru.xml`, so the applicator applies it as a WHOLE-BOARD call; splitting it into `Pass Thru`
 * for the heads consults a vocabulary nobody authored. `Heads Dosado` is the other case and must still split, because
 * the catalogue publishes `Dosado` and the scoped form is a reading over it. So the decision is "does the library
 * publish this name", which is why it is a parameter rather than an import: `selection.ts` owns no library.
 *
 * ONE FUNCTION, because two callers (the picker through `Sequencer.mayOffer` and the apply through
 * `CallApplicator.permissionRefusal`) must not answer that question differently — and before this existed they did.
 */
export function resolveReading(
  raw: string,
  published: (name: string) => boolean,
): { call: string; group: string | null } {
  if (published(raw)) return { call: raw, group: null };
  const s = splitSelection(raw);
  return { call: s.call, group: s.selection ?? null };
}

/**
 * Split a raw call string like "Centers Pass Thru" or "Same 4 Star Thru" into a
 * selection (or null) and the base call. Returns { selection, call }.
 */
export function splitSelection(raw: string): { selection?: string; call: string } {
  const s = raw.trim();
  if (!s) return { call: s };
  const words = s.split(/\s+/);
  // Try progressively longer leading selection phrases (up to 8 words), longest first. 8 rather than
  // 6 because a COMBINATION is longer than any single phrase: "Head Girls and Side Boys" is five
  // words of selection before the call even starts.
  const max = Math.min(8, words.length);
  for (let len = max; len >= 1; len--) {
    const sel = words.slice(0, len).join(' ');
    // `parseGroupExpression` is GREEDY and stops at the first word that is not a token, so it can
    // consume FEWER words than this slice - `expr.words` is what it actually took, and the call text
    // must start after THAT or the seam lands inside the selection.
    let taken = 0;
    if (selectionGroup(sel) !== null) taken = len;
    else {
      const expr = parseGroupExpression(sel);
      if (expr && expr.words === len) taken = len;
    }
    if (taken === 0) continue;
    const rest = words.slice(taken).join(' ');
    if (rest) return { selection: sel, call: rest };
  }
  return { call: s };
}

// ------------------------------------------------------------------ combinations

/**
 * A combined selection: TERMS, each a list of group keys that are INTERSECTED, and unioned together —
 * with a term able to be NEGATED, which subtracts it.
 *
 * THE GRAMMAR IS THE REFERENCE'S, not an invention. `taminations-flutter`'s `coded_call.dart` defines
 * the token vocabulary (`specifier`) and `common/double_selector.dart` composes it:
 *
 *     ($specifier)+ and ($specifier)+        tokens within a side INTERSECT, sides UNION
 *
 * so "Head Boys" is `heads ∩ boys` — the two dancers — and "Head Boys and Side Girls" is
 * `(heads ∩ boys) ∪ (sides ∩ girls)`. MEASURED before this existed: every one of those phrases
 * resolved to `null`, and "Head Ladies" resolved to ALL FOUR heads because it was a phrase mapping.
 */
interface GroupTerm {
  /** Group keys, intersected in order. */
  keys: string[];
  /** A negated term is SUBTRACTED from the union of the positive ones. */
  negated: boolean;
}

export interface GroupExpression {
  terms: GroupTerm[];
  /** How many leading words of the input the expression consumed. */
  words: number;
}

/** Words that SEPARATE terms rather than naming one. */
const TERM_BREAK = 'and';
/** Words that introduce a NEGATED term. */
const NEGATORS = new Set(['except', 'ignore', 'prefer', 'no']);

/**
 * Parse a leading group expression, or null when the text is not one.
 *
 * GREEDY AND PREFIX-ONLY, which is what the reference's usage is: every compound selector in its test
 * corpus sits at the FRONT of a call name ("Head Boys Kick Off", "Side Girls Cross Run"). So this
 * consumes words from the left until one cannot be part of the expression, and reports how many it
 * took - `splitSelection` is what decides whether the remainder is a call.
 */
export function parseGroupExpression(raw: string): GroupExpression | null {
  const words = normalizeSelection(raw).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const terms: GroupTerm[] = [{ keys: [], negated: false }];
  let consumed = 0;
  let i = 0;
  // STICKY NEGATION. Once a negator is seen, everything after it is subtracted - the reference's
  // `Except` takes the WHOLE remainder (`name.replaceFirst('except( the)?')` then resolves it as one
  // selector in its own context), so "All Except Head Boys and Side Girls" removes the UNION of the
  // two, not just "Head Boys".
  let negated = false;
  while (i < words.length) {
    const w = words[i];
    if (w === TERM_BREAK) {
      // " and " starts a NEW term. Its sign follows the section it is in - positive normally,
      // NEGATED once a negator has appeared. A trailing "and" names nothing, so it ends the expression
      // and lets `splitSelection` treat the remainder as call text.
      if (terms[terms.length - 1].keys.length === 0) break;
      terms.push({ keys: [], negated });
      i++;
      continue;
    }
    if (NEGATORS.has(w)) {
      // A negator both starts a new term and flips the section to negative: "All Except Head Boys".
      if (terms[terms.length - 1].keys.length === 0) break;
      negated = true;
      terms.push({ keys: [], negated: true });
      i++;
      continue;
    }
    // Longest phrase first, so "very centers" and "couple #2" match before their parts do. A phrase
    // is a token in its own right ("Head Couples" is the whole couple, NOT `heads ∩ couples`), so it
    // must be matched here rather than by the per-word rules below.
    let matched = 0;
    let key: string | null = null;
    for (let len = Math.min(3, words.length - i); len >= 1; len--) {
      const phrase = words.slice(i, i + len).join(' ');
      const k = PHRASE_SELECTION[phrase] ?? SELECTION_GROUP[phrase] ?? null;
      if (k !== null) { matched = len; key = k; break; }
    }
    if (key === null) break; // not a token: the expression ends here
    terms[terms.length - 1].keys.push(key);
    i += matched;
    consumed = i;
  }
  // An EMPTY trailing term is a separator with nothing after it ("Head Boys and") - drop it rather
  // than fail, because the words before it are still a usable expression.
  const usable = terms.filter((t) => t.keys.length > 0);
  // There must be at least one POSITIVE term: "Except Head Boys" alone has nothing to subtract from.
  if (usable.length === 0 || !usable.some((t) => !t.negated)) return null;
  // A SINGLE KEY IS NOT A COMBINATION - it is the plain selection `selectionGroup` already resolves,
  // and routing it here would bypass the special resolvers ("same 4", "couple #1"). But an
  // INTERSECTION of several keys IS one, even though it is a single term: "Head Boys" is
  // `heads ∩ boys`. So this counts KEYS, not terms.
  if (usable.length === 1 && usable[0].keys.length < 2) return null;
  return { terms: usable, words: consumed };
}
