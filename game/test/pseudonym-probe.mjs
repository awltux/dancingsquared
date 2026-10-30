// THE GENERATED PSEUDONYM, pinned: the three lists, the join, the space, and the deck that deals them.
//
// REPORTED: "If the player hasnt provided a name, generate a pseudonym from two or three lists of short words that can be
// joined together to make an interesting construct. The player can use a next button to generate a new one. The name lists
// should be long enough to work with 5 million players."
//
// THE SPACE IS THE REQUIREMENT, so it is measured rather than asserted: und nameable combinations after the name-length
// rule, against five million players, and the failure threshold is stated in the probe (100x the population) so a later
// shrink of a word list cannot pass quietly. The list rules are checked one by one — letters only, lengths, no duplicates —
// because a duplicate silently shrinks the space that everything else here rests on.
//
// Usage: node game/test/pseudonym-probe.mjs   (pure: no DOM, no network, no clock)
import { ALIAS_MAX, sanitizeAlias } from '../src/puzzle/alias.ts';
import { pseudonymFor, pseudonymSpace, PseudonymDeck, TAILS } from '../src/puzzle/pseudonym.ts';
import { CREATURES, QUALITIES } from '../src/puzzle/pseudonym-words.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Five million players, the number the report names. */
const PLAYERS = 5_000_000;

console.log('\n== 1. the word lists are what the join needs ==');
{
  for (const [name, list] of [['qualities', QUALITIES], ['creatures', CREATURES]]) {
    check(list.length >= 200, `there are ${list.length} ${name}`);
    check(list.every((word) => /^[a-z]{3,8}$/.test(word)), `every ${name} word is 3-8 lowercase letters (${list.filter((w) => !/^[a-z]{3,8}$/.test(w)).join(',') || 'none bad'})`);
    const duplicates = [...new Set(list.filter((word, index) => list.indexOf(word) !== index))];
    check(duplicates.length === 0, `and none is repeated, because a duplicate shrinks the space (${duplicates.join(',') || 'none'})`);
  }
  // THE TAIL IS THE THIRD LIST AND IT IS BUILT, so its rules are about the TABLES: 50 x 10 x 50 one-syllable pieces, each
  // three to five letters.
  check(TAILS.length === 25_000, `the tail table makes ${TAILS.length} tails`);
  check(TAILS.every((tail) => /^[a-z]{3,6}$/.test(tail)), `every tail is 3-6 lowercase letters (${TAILS.filter((t) => !/^[a-z]{3,6}$/.test(t)).join(',') || 'none bad'})`);
  check(new Set(TAILS).size === TAILS.length, 'and no tail repeats, which the tables make impossible rather than unlikely');
}

console.log('\n== 2. a name is three parts joined, and the alias rule accepts it ==');
{
  const first = pseudonymFor(0);
  check(typeof first === 'string' && first.length >= 3, `combination 0 is a name (${first})`);
  // THE PARTS ARE THE INDEX'S DIGITS, in a fixed order — so a probe can name a combination exactly.
  check(first === `${QUALITIES[0][0].toUpperCase()}${QUALITIES[0].slice(1)}${CREATURES[0][0].toUpperCase()}${CREATURES[0].slice(1)}${TAILS[0][0].toUpperCase()}${TAILS[0].slice(1)}`,
    `and it is the first quality, creature and tail, title-cased (${first})`);
  check(pseudonymFor(-1) === null && pseudonymFor(Number.MAX_SAFE_INTEGER) === null, 'an index outside the space answers null rather than a name');
  // A COMBINATION TOO LONG FOR A NAME IS REFUSED AND NOT TRUNCATED: a name cut to fit would collide with the full one on the
  // server's folded key. This is the rule that makes the space smaller than the raw product.
  const long = pseudonymFor(QUALITIES.length * CREATURES.length * TAILS.length - 1);
  check(long === null || long.length <= ALIAS_MAX, `the longest combination is either a name or refused (${long})`);
  // Every draw must be claimable as-is, which is the only reason to generate names through `sanitizeAlias`.
  let checked = 0;
  let invalid = 0;
  for (let index = 0; index < 20_000; index += 1897) {
    const name = pseudonymFor(index);
    if (name === null) continue;
    checked++;
    const verdict = sanitizeAlias(name);
    if (!verdict.ok) invalid++;
  }
  check(checked > 5 && invalid === 0, `every sampled name is a claimable alias (${invalid} refused of ${checked})`);
}

console.log('\n== 3. the space, against five million players ==');
{
  const space = pseudonymSpace();
  const raw = QUALITIES.length * CREATURES.length * TAILS.length;
  console.log(`       ${QUALITIES.length} qualities x ${CREATURES.length} creatures x ${TAILS.length} tails = ${raw}`);
  console.log(`       nameable after the ${ALIAS_MAX}-character rule: ${space}`);
  check(space < raw, `the length rule removes the combinations that cannot be a name (${raw - space} removed)`);
  check(space >= PLAYERS * 100, `and ${space} is at least 100x the five million players (${Math.round(space / PLAYERS)}x)`);
  // WHAT THAT MARGIN BUYS: a player's first draw is already taken only when all five million have claimed, and the share is
  // the population over the space — 0.2% here, which is what the Next button is sized against.
  const takenShare = PLAYERS / space;
  console.log(`       with all ${PLAYERS} names claimed, a fresh draw is taken ${(takenShare * 100).toFixed(2)}% of the time`);
  check(takenShare < 0.01, `which is under one draw in a hundred (${(takenShare * 100).toFixed(2)}%)`);
  // NEGATIVE CONTROL: the naive product is the number a report would quote, and it is wrong because it counts names that
  // cannot be claimed.
  check(pseudonymSpace() !== raw, 'CONTROL: the raw product is not the space, so counting list lengths alone would overstate it');
}

console.log('\n== 4. the deck: no repeats, and always a name ==');
{
  // A SEEDED RANDOM IS THE POINT OF TAKING `rand` AS AN ARGUMENT: a generator a probe cannot reproduce is one nobody can
  // measure. This is a tiny LCG, not a claim about randomness — the deck only has to not repeat itself.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const deck = new PseudonymDeck(rand);
  const drawn = new Set();
  let bad = 0;
  for (let i = 0; i < 5000; i++) {
    const name = deck.next();
    if (name === '' || !sanitizeAlias(name).ok) bad++;
    drawn.add(name);
  }
  check(drawn.size === 5000, `5000 presses deal 5000 different names (${drawn.size})`);
  check(bad === 0, `and every one is a claimable alias (${bad} bad)`);
  // NEGATIVE CONTROL: nothing in the deck appends a number, so a name cannot leak a counter into the board — the state a
  // "de-duplicate by suffixing" rule would leave.
  check([...drawn].every((name) => !/\d/.test(name)), 'CONTROL: no drawn name carries a digit, so nothing is a counter in disguise');
  // THE SAME SEA OF DRAWS WITH A RANDOM THAT NEVER VARIES: the deck must still answer a name, which is the bounded-walk
  // guarantee rather than an unbounded retry on a single index.
  const stuck = new PseudonymDeck(() => 0);
  const first = stuck.next();
  const second = stuck.next();
  check(first !== '' && second !== '' && first !== second,
    `a constant random still deals two different names (${first}, ${second})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
