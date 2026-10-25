// THE ORDER A CALL LIST IS SHOWN IN, which is NOT alphabetical: a call's title is built as
// `<name> <fraction>[ <end>]`, and the fraction is a part of a TURN, so "1/2" and "1/4" and "3/4" are three points
// on one axis rather than three words.
//
// REPORTED as: "Add a better sorting algorithm to the lists of calls, currently its alphanumeric, but this results
// in ordering that doesnt make sense. This mainly revolves around the naming conventions and use of fractions in
// the titles", with the wanted order spelled out:
//
//     Circle Left, Circle Left 3/4, Circle Left 1/2, Circle Left 1/4,
//     Circle Left Home, Circle Left 3/4 Home, Circle Left 1/2 Home, Circle Left 1/4 Home
//
// WHY THAT IS THE ORDER. Within one name the fraction DESCENDS, because a longer turn reads as "more" than a
// shorter one and a caller scanning the family wants the biggest first; and the END words form a SECOND group after
// all the plain ones, so the eight Circle Left authorings read as two columns of four. Alphabetical gives
// `1/2, 1/4, 3/4` - neither ascending nor descending by value, because it is comparing characters - and it files
// each `Home` authoring under its fraction (`… 1/2 Home` between `… 1/2` and `… 1/4`), so the eight interleave
// instead of grouping.
//
// WHAT COUNTS AS WHICH, MEASURED over the corpus's 2197 distinct titles (all nine levels):
//
//   - 115 titles end with a fraction, and EVERY one of them is a proper fraction of a turn (no `2/1`, no `1 1/2` at
//     the end), so the token this module reads is `n/d` with `n/d < 1`;
//   - 16 titles end with `Home`, and it is the ONLY word that occurs in that position among the 115 fraction
//     titles. The other things that follow a fraction are the call's own name and stay in the base - `Recycle` (10),
//     `Mix` (9), `Thru` (9), `Tag` (6), `Cast and Relay`, `to a Wave`, `the Deucey` ... - so a general "trailing
//     word is an end" rule would be wrong: `1/2 Recycle` is one call name, not `1/2` plus an end.
//
// EVERYTHING ELSE IS LEFT ALONE. A trailing INTEGER stays in the base, so `Square Thru 2` / `2 1/2` / `3` / `4` keep
// their natural ascending order (`Square Thru 2` before `Square Thru 2 1/2`, both before `Square Thru 3`) instead of
// being turned into a descending run of counts. The same goes for the long descriptive titles, whose comparison is
// plain natural order.
//
// NATURAL ORDER WITHIN A BASE, not byte order: `localeCompare` with `numeric` puts `Square Thru 2` before
// `Square Thru 10`, which plain string order gets backwards.

/** The words that may follow the fraction as an END of the call. Measured - see the header; `Home` is the only one. */
const END_WORDS = ['Home'];

/** A trailing proper fraction of a turn, `n/d` with `n/d < 1`. */
const FRACTION_AT_END = /\s(\d+)\s*\/\s*(\d+)$/;

/** A trailing end word, with the space before it. */
const endAtEnd = (title: string): { end: string; base: string } | null => {
  for (const word of END_WORDS) {
    const m = new RegExp(`\\s${word}$`, 'i').exec(title);
    if (m) return { end: word, base: title.slice(0, m.index) };
  }
  return null;
};

interface CallTitleParts {
  /** The name with a trailing fraction and a trailing end word taken off. */
  base: string;
  /** The end word (`Home`), or '' when the title carries none. */
  end: string;
  /** The trailing fraction of a turn, as a number, or null when there is none. */
  fraction: number | null;
}

/** Split a call title into the three parts `compareCallTitles` sorts by. */
export function parseCallTitle(title: string): CallTitleParts {
  let rest = title.trim();
  // THE END WORD IS STRIPPED FIRST, because it is the outermost part of `<name> <fraction> <end>`: a title like
  // `Circle Left 3/4 Home` ends with `Home`, so looking for the fraction first would leave the base as
  // `Circle Left 3/4` and every `… Home` authoring would sort away from its own family.
  const end = endAtEnd(rest);
  if (end) rest = end.base.trimEnd();
  let fraction: number | null = null;
  const frac = FRACTION_AT_END.exec(rest);
  if (frac) {
    const value = Number(frac[1]) / Number(frac[2]);
    // A PROPER part of a turn only, which is every fraction the corpus puts at the end of a title. `2/1` would be a
    // count, and treating it as a turn would file it with the fractions.
    if (value > 0 && value < 1) {
      fraction = value;
      rest = rest.slice(0, frac.index).trimEnd();
    }
  }
  return { base: rest, end: end ? end.end : '', fraction };
}

/** Natural comparison of two strings: numbers inside them compare as numbers. */
const natural = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || a.localeCompare(b, 'en');

/**
 * A call title's position in a list, in the order the Corpus's own naming asks for.
 *
 * A TOTAL order (base, then end, then fraction, then the raw title), so it can be handed to
 * `Array.prototype.sort` directly - a comparator that is not total makes V8's sort produce a different answer for
 * different array lengths, silently.
 */
export function compareCallTitles(a: string, b: string): number {
  const pa = parseCallTitle(a);
  const pb = parseCallTitle(b);
  const byBase = natural(pa.base, pb.base);
  if (byBase !== 0) return byBase;
  // THE END COMES AFTER THE PLAIN ONES: within one base, the no-end group first, then `Home`. The rank is the
  // index in `END_WORDS` (so a second end word, were there one, would sort after `Home`), and none is 0.
  const endRank = (end: string) => (end === '' ? 0 : END_WORDS.indexOf(end) + 1);
  const byEnd = endRank(pa.end) - endRank(pb.end);
  if (byEnd !== 0) return byEnd;
  // THE FRACTION DESCENDS. A title with NO fraction sorts before every fractioned one, which is why the key runs
  // from -1 (none) up to -0.75, -0.5, -0.25 (3/4, 1/2, 1/4).
  const fractionKey = (v: number | null) => (v === null ? -1 : -v);
  const byFraction = fractionKey(pa.fraction) - fractionKey(pb.fraction);
  if (byFraction !== 0) return byFraction;
  // Two titles that agree on all three are compared as they are written, so the order is still total.
  return a.localeCompare(b, 'en');
}

/** The same order over objects that carry a `title`, for the panels that sort call records rather than strings. */
export const compareCallsByTitle = (a: { title: string }, b: { title: string }): number => compareCallTitles(a.title, b.title);
