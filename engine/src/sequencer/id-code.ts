// THE ID ENCODING AND THE DIGESTS, SHARED BY EVERY DERIVED IDENTITY IN THIS TREE.
//
// WHY THIS MODULE EXISTS. Three keys are derived strings of the same shape: a formation's `F2-`, an
// arrangement's `A1-` and a call variant's `V1-`. They differ in WHAT they digest, not in how a digest becomes
// characters, so the alphabet, the width arithmetic and the hashes live here once. A second copy would be a
// second convention, and the first one to be fixed is the one nobody looks at.
//
// WHY BASE 36 WITH A LOWERCASE PAYLOAD - `F2-a3k9m2`. An id is retyped by hand into a rule or a ledger, so it
// has to be told apart from itself character by character, and the two pairs that ruin a hand copy are `0`/`O`
// and `1`/`l`. Making the PAYLOAD lower case and keeping the digits makes both unambiguous: a `0` is never an
// `o`, a `1` is never an `l`. The version marker stays upper case (`F2-`) so it stands out as not-payload.
//
// TWO DIGEST WIDTHS, AND WHY BOTH ARE NEEDED. The payload space is 36^width, and a digest narrower than that
// space leaves the leading characters dead. MEASURED: 36^6 = 2,176,782,336 sits UNDER 2^32 = 4,294,967,296, so
// a six-character payload is fully used by a 32-bit digest; 36^7 = 78,364,164,096 is OVER it, so an
// eight-character payload encoded from 32 bits ALWAYS begins with `0` and carries no more entropy than six.
// The eight-character identities (`A1-`, `V1-`) therefore digest with 64 bits; the six-character one does not.
//
// THE 32-BIT DIGEST IS NOT A POWER OF 36, so the encoding is not exactly uniform: 2^32 / 36^6 = 1.973, which
// gives 97.31% of codes two hash preimages and the rest one. MEASURED, the effect on the collision probability
// is a factor of 1.01 - the birthday figures cited per scheme stand - so the digest stays 32 bits FNV-1a where
// the width allows it. A base above 40, or a seventh character, needs the 64-bit digest before it could be used.
//
// A SCHEME IS A PREFIX AND A WIDTH, NEVER A BARE STRING. `isIdOf` exists because an id and a name are both
// strings, and any boundary that accepts either has to tell them apart. It is case-insensitive for the same
// reason `evaluatePermissions` normalises both sides of a `boardId`: an id retyped in upper case must be the
// same id to the checker and to the matcher.

/**
 * The alphabet: the digits, then the letters in lower case, so `0` can never be read as `o` and `1` never as
 * `l` when the id is retyped.
 */
export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const ID_BASE = ID_ALPHABET.length;

/** The payload space of an id of this width: 36^width. */
export function idSpace(width: number): bigint {
  return BigInt(ID_BASE) ** BigInt(width);
}

/**
 * A digest rendered as an id: the version prefix, then `width` base-36 characters.
 *
 * The digest is REDUCED modulo the payload space rather than truncated, which is what keeps every character
 * carrying entropy at the widths this tree uses (see the width arithmetic above).
 */
export function encodeId(prefix: string, digest: number | bigint, width: number): string {
  const space = idSpace(width);
  const base = BigInt(ID_BASE);
  let v = (typeof digest === 'number' ? BigInt(digest) : digest) % space;
  if (v < 0n) v += space;
  let out = '';
  for (let i = 0; i < width; i++) {
    out = ID_ALPHABET[Number(v % base)] + out;
    v /= base;
  }
  return prefix + out;
}

/**
 * Whether a string is an id of this scheme. Case-insensitive, because a caller may retype one in upper case.
 *
 * The prefix is escaped rather than assumed safe: a future scheme may carry a character that is a regex
 * metacharacter, and a silently non-matching pattern would make the checker accept nothing while the matcher
 * accepted everything.
 */
export function isIdOf(prefix: string, width: number, s: string): boolean {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}[0-9a-z]{${width}}$`, 'i').test(s);
}

/** FNV-1a, 32 bit. The digest is only ever compared with itself, so a simple stable hash is the requirement. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * FNV-1a, 64 bit - the same algorithm with the 64-bit offset basis and prime, masked to 64 bits.
 *
 * It exists for the eight-character schemes and for nothing else: at six characters the 32-bit digest already
 * fills the space (see the header), so using this one there would cost BigInt arithmetic for no added entropy.
 * It walks UTF-16 code units, exactly as the 32-bit version does, so the two agree about what they are hashing.
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
