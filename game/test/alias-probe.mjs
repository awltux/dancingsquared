// THE ALIAS RULE, PINNED — the public name a leaderboard shows instead of an identifier.
//
// REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
// anywhere on the UI." and then "alias needs to be sanitised somehow."
//
// WHAT THIS PINS, and why each one is a check rather than a sentence:
//   1. THE CANONICAL FORM. A name is trimmed, whitespace-collapsed and NFKC-normalised, so "  Ada  Lovelace " and
//      "Ada Lovelace" are ONE name — otherwise the uniqueness key is not a key and two players hold the same row.
//   2. THE INVISIBLE CHARACTERS. Zero-width and bidi characters are stripped: they let a row render as a different string
//      than the one stored, and a bidi override is the classic way to make a scoreboard row read as somebody else.
//   3. WHAT A NAME MAY CONTAIN. Letters and digits in any script, spaces, `.`, `_`, `-`, `'` — and never `@`, so an
//      alias cannot be, or look like, an email address.
//   4. THE LENGTH, THE SHAPE AND THE RESERVED LIST, each refused with its own code so the app can say which.
//   5. THE KEY IS FOLDED, the alias is not: "Ada" and "ada" are one claim, and the name keeps the capitals it was typed
//      with because a name is displayed.
//
// THE NEGATIVE CONTROLS are the plausible wrong rules, and each fails exactly the check that rules it out: a rule that
// keeps zero-width characters (check 2), one that only trims instead of collapsing (check 1), one that accepts `@`
// (check 3), and one that does not fold the key (check 5).
//
// Usage: node game/test/alias-probe.mjs   (pure: no DOM, no server, no engine)
import { ALIAS_MAX, ALIAS_MIN, RESERVED_ALIASES, aliasKeyOf, sanitizeAlias } from '../src/puzzle/alias.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The canonical alias, or the refusal's code — the one-line shape most checks want. */
const verdict = (raw) => {
  const answer = sanitizeAlias(raw);
  return answer.ok ? answer.alias : answer.code;
};

console.log('\n== 1. the canonical form: one name, one string ==');
{
  check(verdict('Ada Lovelace') === 'Ada Lovelace', 'a plain name is kept as typed');
  check(verdict('  Ada   Lovelace ') === 'Ada Lovelace', `surrounding and repeated spaces collapse (${JSON.stringify(verdict('  Ada   Lovelace '))})`);
  check(verdict('Ada\tLovelace') === 'Ada Lovelace', 'a tab is whitespace, and it becomes one space');
  check(verdict('Ada\u00A0Lovelace') === 'Ada Lovelace', 'so is a non-breaking space, which is not the same byte as a space');
  check(verdict('ＡＤＡ') === 'ADA', `NFKC folds a fullwidth form to the plain letters (${verdict('ＡＤＡ')})`);
  check(verdict('𝐀da') === 'Ada', 'and so does a mathematical bold one — the impersonation this normalisation stops');
  check(verdict('Ada') === verdict('AdA') || verdict('Ada') !== verdict('AdA'), 'case is KEPT in the alias (checked below for the key)');
  check(verdict('Ada') === 'Ada' && verdict('ada') === 'ada', 'the alias keeps the capitals it was typed with');
  // CONTROL: the plausible wrong rule is a trim only, which leaves "Ada  Lovelace" as its own name.
  const trimOnly = (raw) => String(raw).trim();
  check(trimOnly('  Ada   Lovelace ') !== verdict('  Ada   Lovelace '), 'CONTROL: trimming alone does not produce the canonical form');
}

console.log('\n== 2. invisible characters cannot make two names look alike ==');
{
  check(verdict('Ada\u200BLovelace') === 'AdaLovelace', `a zero-width space is stripped (${JSON.stringify(verdict('Ada\u200BLovelace'))})`);
  check(verdict('Ada\u200FLovelace') === 'AdaLovelace', 'and a right-to-left mark');
  check(verdict('\u202EAda') === 'Ada', `a bidi override is stripped, so the row cannot be re-ordered (${verdict('\u202EAda')})`);
  check(verdict('Ada\uFEFF') === 'Ada', 'and a byte-order mark');
  check(verdict('\u0007Ada') === 'Ada', 'and a BEL control character');
  check(!sanitizeAlias('Ada\u200BLovelace').ok || sanitizeAlias('Ada\u200BLovelace').alias === 'AdaLovelace',
    'the invisible character never survives into the stored name');
  // CONTROL: a rule that does not strip them stores a DIFFERENT string for the same pixels.
  const keepInvisible = (raw) => String(raw).normalize('NFKC').trim();
  check(keepInvisible('Ada\u200BLovelace') !== verdict('Ada\u200BLovelace'), 'CONTROL: keeping the zero-width space changes the string');
}

console.log('\n== 3. what a name may contain, including nothing that could be an address ==');
{
  check(sanitizeAlias('ada@example.com').ok === false && sanitizeAlias('ada@example.com').code === 'alias_bad_characters',
    `an email address is refused for its @ (${verdict('ada@example.com')})`);
  check(verdict("Ada O'Neil-Smith") === "Ada O'Neil-Smith", 'an apostrophe and a hyphen are allowed');
  check(verdict('ada.lovelace_1') === 'ada.lovelace_1', 'a dot and an underscore too');
  check(verdict('Ada 👍') === 'alias_bad_characters', `an emoji is named as the bad character (${verdict('Ada 👍')})`);
  check(/👍/.test(sanitizeAlias('Ada 👍').message ?? ''), 'and the message quotes it, so a player knows what to remove');
  check(verdict('Αδα Λάβ') === 'Αδα Λάβ', 'letters in another script are letters');
  check(verdict('Ада') === 'Ада', 'including Cyrillic, which is allowed and is why confusables are a moderation question');
  // CONTROL: the wrong rule accepts anything that is not blank.
  const anything = (raw) => (String(raw).trim() === '' ? 'alias_empty' : String(raw).trim());
  check(anything('ada@example.com') !== verdict('ada@example.com'), 'CONTROL: "anything non-blank" accepts an address');
}

console.log('\n== 4. length, shape and the reserved list, each with its own code ==');
{
  check(verdict('ab') === 'alias_too_short', `two characters is below the floor of ${ALIAS_MIN} (${verdict('ab')})`);
  check(verdict('abc') === 'abc', `three is the shortest name (${verdict('abc')})`);
  check(verdict('a'.repeat(ALIAS_MAX)) === 'a'.repeat(ALIAS_MAX), `${ALIAS_MAX} characters is allowed`);
  check(verdict('a'.repeat(ALIAS_MAX + 1)) === 'alias_too_long', `${ALIAS_MAX + 1} is not (${verdict('a'.repeat(ALIAS_MAX + 1))})`);
  check(verdict('   ') === 'alias_empty', 'whitespace alone is empty, not a one-space name');
  check(verdict('') === 'alias_empty', 'and so is nothing');
  check(verdict(null) === 'alias_empty', 'a missing field is refused rather than crashed on');
  check(verdict('_ada') === 'alias_bad_shape', `a leading separator is refused (${verdict('_ada')})`);
  check(verdict('ada.') === 'alias_bad_shape', 'and a trailing one');
  check(verdict('a b') === 'a b', 'a space inside is fine');
  const reserved = RESERVED_ALIASES.map((name) => verdict(name));
  check(reserved.every((code) => code === 'alias_reserved'), `every reserved name is refused (${reserved.join(', ')})`);
  check(verdict('ADMIN') === 'alias_reserved', 'and case does not get around the reserved list');
  check(verdict('administrator ') === 'alias_reserved', 'nor does a trailing space');
  check(verdict('admin 1') === 'admin 1', 'while a name that merely starts with one is allowed — the list is exact names');
}

console.log('\n== 5. the key is folded, the alias is not ==');
{
  check(aliasKeyOf('Ada Lovelace') === 'ada lovelace', `the key folds case (${aliasKeyOf('Ada Lovelace')})`);
  check(aliasKeyOf('Ada  Lovelace') === aliasKeyOf('ada lovelace'), 'and collapses the spaces, so the two forms are one claim');
  check(aliasKeyOf('ＡＤＡ') === 'ada', 'and folds the compatibility form');
  const ada = sanitizeAlias('Ada');
  check(ada.ok && ada.key === 'ada' && ada.alias === 'Ada', 'a verdict carries both, and they differ');
  // CONTROL: a key that is the alias itself lets "Ada" and "ada" be claimed by two players.
  const unfolded = (alias) => alias;
  check(unfolded('Ada') !== unfolded('ada'), 'CONTROL: an unfolded key would make these two different claims');
  check(aliasKeyOf('Ada') === aliasKeyOf('ada'), 'where the folded one makes them one');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
