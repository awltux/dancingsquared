// A GENERATED PSEUDONYM — a quality, a creature and a constructed tail, joined — and the deck that deals them.
//
// REPORTED: "If the player hasnt provided a name, generate a pseudonym from two or three lists of short words that can be
// joined together to make an interesting construct. The player can use a next button to generate a new one. The name lists
// should be long enough to work with 5 million players."
//
// THREE PARTS, AND THE THIRD IS BUILT RATHER THAN LISTED. `QUALITIES` and `CREATURES` are real words (`pseudonym-words.ts`
// says why there are only two real lists); the TAIL is one syllable assembled from the tables below — an onset, a vowel
// and a coda — which is what a name's tail is ("Brost", "Keln") and what gives the space its size without a third
// dictionary. `JollyBadgerBrost` is the shape.
//
// THE SPACE IS THE REQUIREMENT, SO IT IS COMPUTED RATHER THAN ASSERTED. 515 qualities x 220 creatures x 25,000 tails is
// 2.8 x 10^9 combinations; the ones whose joined name exceeds `ALIAS_MAX` (16) cannot be a name, and `pseudonymSpace()`
// returns the exact surviving count by walking the length histograms (9 x 9 x 6) rather than a sample. At five million
// claimed names the chance a fresh draw is already taken is 5e6 / space — `game/test/pseudonym-probe.mjs` prints it and
// fails if the space drops below 100 x the population, which is the margin the Next button is sized against.
//
// NOTHING HERE CLAIMS UNIQUENESS. The server owns that (`POST /me/alias` is create-only on a folded key and answers
// `alias_taken`), so a draw that collides is REFUSED WHERE NAMES ARE CLAIMED and the player presses Next — which is also why
// this module keeps a session set of what it has already handed out: a player pressing Next twice in a row must not be
// shown the same name, which is the one collision the deck can prevent itself.
import { ALIAS_MAX, sanitizeAlias } from './alias.ts';
import { CREATURES, QUALITIES } from './pseudonym-words.ts';

/**
 * The tail's onsets. Two letters at most, so a tail stays three to six characters.
 *
 * EVERY PAIR HERE IS PRONOUNCEABLE AFTER A VOWEL, which is the only test this table has to pass: a tail is read as the
 * name's last syllable, so "Brost" and "Keln" are names where "Bxost" would be a typo.
 */
const TAIL_ONSETS: readonly string[] = [
  'b', 'br', 'd', 'dr', 'f', 'fr', 'g', 'gr', 'h', 'k',
  'kr', 'l', 'm', 'n', 'p', 'pr', 'r', 's', 'sk', 'sl',
  'sn', 'st', 't', 'tr', 'v', 'w', 'z', 'bl', 'cl', 'fl',
  'gl', 'pl', 'sh', 'th', 'ch', 'sw', 'tw', 'sc', 'sp', 'sm',
  'kn', 'wr', 'qu', 'j', 'c', 'x', 'y', 'ph', 'rh', 'wh',
];

/** The vowel of the tail. `y` is here because it is one in the last syllable of a name ("Bryst"). */
const TAIL_VOWELS: readonly string[] = ['a', 'e', 'i', 'o', 'u', 'y', 'ae', 'ai', 'ea', 'oo'];

/** The coda closes the syllable, two letters at most for the same reason as the onsets. */
const TAIL_CODAS: readonly string[] = [
  'n', 'r', 'l', 's', 'm', 't', 'k', 'd', 'x', 'sh',
  'th', 'ch', 'nd', 'rn', 'lt', 'sk', 'st', 'ng', 'ck', 'ff',
  'mp', 'nt', 'rd', 'rk', 'ss', 'll', 'mm', 'tt', 'zz', 'ph',
  'rb', 'lm', 'lp', 'ns', 'lf', 'gh', 'ft', 'pt', 'ct', 'sp',
  'sm', 'sn', 'wl', 'ws', 'wn', 'pl', 'bl', 'dl', 'gl', 'kl',
];

/** Every tail, in a fixed order: onset outer, vowel, coda inner. The order IS the index's meaning (`pseudonymFor`). */
export const TAILS: readonly string[] = TAIL_ONSETS.flatMap((onset) =>
  TAIL_VOWELS.flatMap((vowel) => TAIL_CODAS.map((coda) => `${onset}${vowel}${coda}`)));

/** The title-cased join of the three parts: `JollyBadgerBrost`. */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The pseudonym at an INDEX, or null when that combination is not a name this game can take.
 *
 * THE INDEX IS THE WHOLE IDENTITY — quality, creature and tail are its digits in mixed radix — so the deck can walk the
 * space without a list, and a probe can ask for "combination 0" and "the last one" without a random number generator.
 *
 * A COMBINATION IS REFUSED RATHER THAN TRUNCATED when it is too long for `ALIAS_MAX`: a name cut to fit would collide with
 * the full one on the server's folded key, and a 16-character limit is a fact about the leaderboard row rather than
 * something to work around here. `sanitizeAlias` is the judge, not a length check of my own, so the one rule that decides
 * what a name may be keeps deciding it.
 */
export function pseudonymFor(index: number): string | null {
  const total = QUALITIES.length * CREATURES.length * TAILS.length;
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  const tail = TAILS[index % TAILS.length] ?? '';
  const rest = Math.floor(index / TAILS.length);
  const creature = CREATURES[rest % CREATURES.length] ?? '';
  const quality = QUALITIES[Math.floor(rest / CREATURES.length) % QUALITIES.length] ?? '';
  const name = `${titleCase(quality)}${titleCase(creature)}${titleCase(tail)}`;
  return sanitizeAlias(name).ok ? name : null;
}

/**
 * How many DIFFERENT names the three lists can make, after the length rule — counted exactly, not sampled.
 *
 * THE HISTOGRAM IS THE POINT: the naive answer (`515 x 220 x 25000`) is a product of three list lengths, and it is wrong
 * because a name that exceeds `ALIAS_MAX` cannot be claimed. The surviving count is the number of (quality, creature, tail)
 * triples whose joined, title-cased length is at most `ALIAS_MAX`, summed over the length distributions — 9 x 9 x 6 terms,
 * which is cheap enough to be a gate rather than a claim. Title casing does not change a length, so the sum is exact.
 */
export function pseudonymSpace(): number {
  const lengths = (words: readonly string[]): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const word of words) counts.set(word.length, (counts.get(word.length) ?? 0) + 1);
    return counts;
  };
  const qualities = lengths(QUALITIES);
  const creatures = lengths(CREATURES);
  const tails = lengths(TAILS);
  let space = 0;
  for (const [qLen, qCount] of qualities) {
    for (const [cLen, cCount] of creatures) {
      for (const [tLen, tCount] of tails) {
        if (qLen + cLen + tLen <= ALIAS_MAX) space += qCount * cCount * tCount;
      }
    }
  }
  return space;
}

/**
 * The deck: what Next draws from.
 *
 * IT TAKES ITS RANDOMNESS AS AN ARGUMENT, because a generator whose output a probe cannot reproduce is a generator nobody
 * can measure — the same reason `puzzle/config.ts` injects `rand` into the generator. It keeps the names it has handed out
 * for the life of the page, so pressing Next twice never shows the same name even though the space is far larger than any
 * session.
 *
 * A DRAW THAT LANDS ON AN UNNAMEABLE COMBINATION (too long) IS SKIPPED, and the loop is bounded: the space is 10^9 and the
 * share of unnameable combinations is a minority, so a bounded walk finds a name in a few tries — but a bound is what makes
 * "cannot loop for ever" a property rather than a hope, and the fallback is the LAST name drawn rather than an exception.
 */
export class PseudonymDeck {
  private readonly rand: () => number;
  private readonly used = new Set<string>();
  private last = '';
  /** The last index dealt, so the fallback walk has somewhere to start and never returns a repeat. */
  private cursor = -1;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /**
   * The next name, or the previous one when nothing usable was found in the walk.
   *
   * THE SPACE HAS NO DUPLICATE NAMES BY CONSTRUCTION — an index IS a combination — so the set of handed-out names is the
   * only filter needed beyond the length rule.
   */
  next(): string {
    const total = QUALITIES.length * CREATURES.length * TAILS.length;
    for (let attempt = 0; attempt < 64; attempt++) {
      const index = Math.min(total - 1, Math.floor(this.rand() * total));
      const name = pseudonymFor(index);
      if (name === null || this.used.has(name)) continue;
      this.used.add(name);
      this.cursor = index;
      this.last = name;
      return name;
    }
    // A BOUNDED WALK, THEN A DETERMINISTIC ONE. A random source that never varies (a stuck PRNG in a test, a seeded source
    // that keeps returning the same value) would otherwise deal the same name twice, which is the one thing this class
    // promises not to do. Stepping forward from the last index is a search of the space, not a second random: it terminates
    // within a thousand steps because the nameable space is 2 x 10^9 and only a handful of combinations are ever used.
    for (let step = 1; step <= 1000; step++) {
      const index = (this.cursor + step + total) % total;
      const name = pseudonymFor(index);
      if (name === null || this.used.has(name)) continue;
      this.used.add(name);
      this.cursor = index;
      this.last = name;
      return name;
    }
    // THE FALLBACK IS STILL A NAME, never an empty string: a caller that fills an input with nothing would look broken,
    // and the server's `alias_taken` refusal is the only collision handling the game needs.
    if (this.last === '') this.last = pseudonymFor(0) ?? 'JollyBadgerBrost';
    return this.last;
  }
}
