// THE ID ENCODING AND THE DIGEST, SHARED BY EVERY DERIVED IDENTITY IN THIS TREE.
//
// WHY THIS MODULE EXISTS. Four keys are derived strings of the same shape: a formation's `F3-`, an arrangement's
// `A1-`, a setup's `S1-` and a call variant's `V1-`. They differ in WHAT they digest, not in how a digest becomes
// characters, so the alphabet, the width and the hash live here once. A second copy would be a second convention,
// and the first one to be fixed is the one nobody looks at. The chain is a refinement at each step: a setup is the
// arrangement plus the order its dancers are listed in (`setup-id.ts`), and an arrangement is the formation plus
// where the genders stand (`arrangement-id.ts`).
//
// ONE SHAPE FOR ALL FOUR: eight characters, one 64-bit digest. The schemes used to differ - six characters over
// 32 bits for a formation, eight over 64 for the two that existed then - and the width arithmetic was the most
// delicate paragraph in the file. It is gone because the difference bought nothing: a payload space of 36^width has
// to be at least as wide as its digest, 36^6 = 2,176,782,336 is under 2^32 and 36^7 = 78,364,164,096 is over it, so
// six was the most a 32-bit digest could fill - and the variant population, the largest of the four, was never going
// to stay under its six-character risk. The measured price of dropping to one width is the 64-bit digest on the
// formation path: 30.9 us per board against 20.7 us, which is 1.8% of a single `recognize` (567.6 us) and is paid
// once per board read, never per frame.
//
// WHY BASE 36 WITH A LOWERCASE PAYLOAD - `F3-a3k9m2zq`. An id is retyped by hand into a rule or a ledger, so it has
// to be told apart from itself character by character, and the two pairs that ruin a hand copy are `0`/`O` and
// `1`/`l`. Making the PAYLOAD lower case and keeping the digits makes both unambiguous: a `0` is never an `o`, a
// `1` is never an `l`. The version marker stays upper case (`F3-`) so it stands out as not-payload.
//
// WHY A SCHEME NAME RATHER THAN (PREFIX, WIDTH) ARGUMENTS. The prefix and the width are one fact about a scheme,
// and passing them as loose arguments meant a call site could pair the right prefix with the wrong width and
// produce an id that no checker accepts - in silence. `encodeId` and `isIdOf` therefore take a name out of
// `ID_SCHEMES`, and the table is the only place a prefix is written down.
//
// THE ALPHABET REDUCES RATHER THAN TRUNCATES. `encodeId` takes the digest modulo 36^8, so every character carries
// entropy: a truncation would leave the leading characters constant, which is exactly the defect the old
// 32-bit-at-eight-characters measurement recorded (`0` as the first character of every id).

/**
 * The alphabet: the digits, then the letters in lower case, so `0` can never be read as `o` and `1` never as
 * `l` when the id is retyped.
 */
export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const ID_BASE = ID_ALPHABET.length;

/** Every id has the same payload width. See the header for why one width replaced two. */
export const ID_WIDTH = 8;

/** The payload space of an id: 36^8 = 2,821,109,907,456, and every digest is reduced into it. */
export const ID_SPACE = BigInt(ID_BASE) ** BigInt(ID_WIDTH);

/** The four schemes. The value is the version prefix, and this table is where each is written down. */
export type IdSchemeName = 'formation' | 'arrangement' | 'setup' | 'variant';

/**
 * THE SCHEMES, AND THE PREFIXES ARE HISTORY. A prefix is bumped when the scheme's *canonicalisation* or its
 * encoding changes, because ids are persisted in rules and ledgers: `F3-` replaced `F1-` (26^5) and `F2-` (36^6,
 * 32-bit) when every scheme went to eight characters, and nothing had cited an `F2-` id at the time.
 */
export const ID_SCHEMES: Readonly<Record<IdSchemeName, string>> = {
  formation: 'F3-',
  arrangement: 'A1-',
  setup: 'S1-',
  variant: 'V1-',
};

/**
 * A digest rendered as an id: the scheme's prefix, then `ID_WIDTH` base-36 characters.
 *
 * The digest is REDUCED modulo the payload space rather than truncated, which is what keeps every character
 * carrying entropy.
 */
export function encodeId(scheme: IdSchemeName, digest: bigint): string {
  const base = BigInt(ID_BASE);
  let v = digest % ID_SPACE;
  if (v < 0n) v += ID_SPACE;
  let out = '';
  for (let i = 0; i < ID_WIDTH; i++) {
    out = ID_ALPHABET[Number(v % base)] + out;
    v /= base;
  }
  return ID_SCHEMES[scheme] + out;
}

/**
 * Whether a string is an id of this scheme. Case-insensitive, because a caller may retype one in upper case - and
 * because `evaluatePermissions` normalises both sides of a `boardId`, the checker and the matcher must agree.
 *
 * The prefix is escaped rather than assumed safe: a future scheme may carry a character that is a regex
 * metacharacter, and a silently non-matching pattern would make the checker accept nothing while the matcher
 * accepted everything.
 */
export function isIdOf(scheme: IdSchemeName, s: string): boolean {
  const escaped = ID_SCHEMES[scheme].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}[0-9a-z]{${ID_WIDTH}}$`, 'i').test(s);
}

/**
 * FNV-1a, 64 bit - the 64-bit offset basis and prime, masked to 64 bits.
 *
 * It walks UTF-16 code units, so every scheme digests the same kind of string the same way.
 */
export function fnv1a64(s: string): bigint {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h;
}
