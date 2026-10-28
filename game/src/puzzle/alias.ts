// A PLAYER'S PUBLIC NAME — the alias a leaderboard shows instead of an identifier, as a pure rule.
//
// REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
// anywhere on the UI." — and then "alias needs to be sanitised somehow."
//
// WHY THIS IS A MODULE AND NOT A VALIDATOR IN A HANDLER. Two processes decide what an alias may be: the app, which has
// to tell a player WHY a name it typed was refused before spending a request on it, and the server, which must not trust
// that the app ran at all. A second copy of the rule would be exactly the drift AGENTS.md §5 forbids — so the rule is
// here, in the barrel the server already imports (`api/src/levels.ts` imports `dancing-squared-game`), and both call it.
//
// WHAT "SANITISED" MEANS HERE, IN ORDER, because each step is a decision:
//
//   1. UNICODE-NORMALISE FIRST. `NFKC` collapses the compatibility forms — a fullwidth `ＡＤＡ` becomes `ADA`, a
//      mathematical bold `𝐀DA` becomes `ADA` — so a name cannot LOOK like another player's while being a different
//      sequence of code points. Without this, "uniqueness" is a claim about bytes rather than about what a person sees.
//   2. STRIP WHAT IS NOT A CHARACTER. C0/C1 controls (including tab and newline), DEL, the zero-width set
//      (`U+200B`-`U+200D`, `U+2060`, `U+FEFF`) and the BIDI overrides (`U+202A`-`U+202E`, `U+2066`-`U+2069`, `U+200E`,
//      `U+200F`). A bidi override lets a name render as a different string than the one stored — the classic trick for
//      making a leaderboard row read as somebody else — and a zero-width character lets two accounts hold names that are
//      different bytes and identical pixels.
//   3. COLLAPSE WHITESPACE. Every run of whitespace (space, `U+00A0`, `U+3000`, and whatever survived step 2) becomes one
//      space, and the ends are trimmed. `"  Ada  Lovelace "` and `"Ada Lovelace"` are the same name, so they must be the
//      same string — otherwise the uniqueness key is not a key.
//   4. KEEP ONLY WHAT A NAME IS MADE OF: letters and digits in any script, and the separators space, `.`, `_`, `-`, `'`.
//      No `@`, deliberately: an alias is not an address, and one that contains `@` invites both confusion with an email
//      and a "looks like a login" spoof — this is also what makes it impossible for an alias to BE an email.
//   5. LENGTH 3 TO 16 CODE POINTS, after all of the above. Sixteen is what fits a leaderboard row beside a score at
//      `--fs-small`; three is the shortest thing that is a name rather than an initial.
//   6. THE SHAPE: the first and last characters must be letters or digits, so a name cannot start or end with a separator
//      (`_you_`, `.hidden`), which is how a name would otherwise be made to look like a marker or a path.
//
// A REFUSAL IS A VALUE WITH A CODE, because three different callers need three different sentences: the app shows
// `message` under its input, the server returns `code` in the body, and the probe pins both. There is no `throw`.
//
// AND THE UNIQUENESS KEY IS PART OF THIS RULE, not a second statement in `keys.ts`: `aliasClaimKey` is the lowercased,
// already-normalised form, so two players cannot hold names that differ only by case or by a compatibility form.

/** The shortest alias a player may claim. */
export const ALIAS_MIN = 3;

/** The longest, and the reason: a leaderboard row draws it beside a score at `--fs-small`. */
export const ALIAS_MAX = 16;

/**
 * The names this game keeps for itself.
 *
 * A RESERVED LIST IS NOT A PROFANITY FILTER AND MUST NOT PRETEND TO BE ONE. What it stops is the name that would be read
 * as the OPERATOR's — a row called "admin" or "support" on a public board is a claim about who that player is, and the
 * one thing an alias must never be is a claim to authority. Abuse between players is a moderation question and is not
 * solved by a list in a client (AGENTS.md §6: a check that cannot be audited is worse than none).
 */
export const RESERVED_ALIASES: readonly string[] = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'operator',
  'support',
  'staff',
  'system',
  'dancing squared',
  'dancingsquared',
  'you',
  'guest',
  'anonymous',
];

/** A refusal's code, so a caller can branch without reading the sentence. */
export type AliasRefusal =
  | 'alias_empty'
  | 'alias_too_short'
  | 'alias_too_long'
  | 'alias_bad_characters'
  | 'alias_bad_shape'
  | 'alias_reserved';

/** What the rule answers: the canonical name, or why not. */
export type AliasVerdict =
  | { readonly ok: true; readonly alias: string; readonly key: string }
  | { readonly ok: false; readonly code: AliasRefusal; readonly message: string };

/** Characters a name may contain, besides letters and digits. */
const SEPARATORS = " ._-'";

/** Zero-width and bidi characters: invisible, and both are impersonation tools. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Every control character below space, plus DEL and the C1 range. */
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * THE WHITESPACE CONTROLS BECOME A SPACE BEFORE THE REST ARE STRIPPED, because they MEAN whitespace: "Ada<TAB>Lovelace"
 * is two words, and a rule that deletes the tab runs them together into a different name. The other controls mean
 * nothing at all and are removed.
 */
const WHITESPACE_CONTROLS = /[\t\n\v\f\r]/g;

/** A run of whitespace, whatever the normalisation left of it. */
const WHITESPACE = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/** One character that may survive step 4: a letter, a digit, or a separator. */
const ALLOWED = /^[\p{L}\p{Nd} ._'-]$/u;

/** A letter or a digit, for the two ends. */
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/**
 * The canonical form of a claimed alias, or the reason it is refused.
 *
 * The order of the checks is the order a player needs them in: emptiness, then the characters that are not a name,
 * then the length that is left, then the shape, then the reserved list — so "ada@example.com" is refused for the `@`
 * rather than for being 15 characters, which is a sentence that would send the player to the length next.
 */
export function sanitizeAlias(raw: unknown): AliasVerdict {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'alias_empty', message: 'an alias is a name, so it must be text' };
  }
  const normalised = raw
    .normalize('NFKC')
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(CONTROLS, '')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim();
  if (normalised === '') {
    return { ok: false, code: 'alias_empty', message: 'an alias cannot be empty' };
  }
  const points = [...normalised];
  // THE BAD CHARACTER IS NAMED, not just refused: a player who typed a heart or an accent the rule does not take needs to
  // know which character to remove, and a character class in the message cannot be read.
  const bad = points.find((character) => !ALLOWED.test(character));
  if (bad !== undefined) {
    return {
      ok: false,
      code: 'alias_bad_characters',
      message: `an alias may use letters, numbers, spaces and ${SEPARATORS.trim().split('').join(' ')}, so it cannot contain "${bad}"`,
    };
  }
  if (points.length < ALIAS_MIN) {
    return { ok: false, code: 'alias_too_short', message: `an alias needs at least ${ALIAS_MIN} characters` };
  }
  if (points.length > ALIAS_MAX) {
    return { ok: false, code: 'alias_too_long', message: `an alias can be at most ${ALIAS_MAX} characters` };
  }
  if (!LETTER_OR_DIGIT.test(points[0] ?? '') || !LETTER_OR_DIGIT.test(points[points.length - 1] ?? '')) {
    return { ok: false, code: 'alias_bad_shape', message: 'an alias must start and end with a letter or a number' };
  }
  const key = aliasKeyOf(normalised);
  if (RESERVED_ALIASES.includes(key)) {
    return { ok: false, code: 'alias_reserved', message: `"${normalised}" is kept by the game, so it cannot be claimed` };
  }
  return { ok: true, alias: normalised, key };
}

/**
 * The uniqueness key for a name that has already been through `sanitizeAlias`.
 *
 * CASEFOLDED AND SPACE-COLLAPSED, SO TWO PIXEL-IDENTICAL NAMES ARE ONE CLAIM. The alias itself keeps the capitals the
 * player chose — a name is displayed, and "Ada Lovelace" is a better row than "ada lovelace" — while the KEY is folded,
 * so "Ada" and "ada" cannot both be claimed. `toLowerCase` rather than `toLocaleLowerCase`, deliberately: the key must
 * not depend on the machine's locale, or the same claim would collide on one server and not another.
 */
export function aliasKeyOf(alias: string): string {
  return alias.normalize('NFKC').replace(WHITESPACE, ' ').trim().toLowerCase();
}
