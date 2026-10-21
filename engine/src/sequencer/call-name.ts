// A CALL NAME, READ FROM WHATEVER A HUMAN OR ANOTHER NOTATION WROTE — one entry point, one search order.
//
// WHY THIS EXISTS. The corpus's titles are one vocabulary (`CALL_TITLE`) and the strings that arrive are
// another: the app's picker, All8's published get-outs, the book, a caller typing into the sequencer, a test
// fixture. Until now each caller assembled its own answer out of `isCallTitle` / `canonicalName` /
// `splitSelection` and they did it differently — `getout-conformance` re-asked the applicator's rule, the
// editor harness read `from` where it meant `formation`, and an All8 figure decoded to `Promenade Home`, a name
// no tam authors (`c03683f`'s module header carries that cost). This module is the ONE place that answers
// "what call does this string name", and it always says HOW it answered or why it could not.
//
// THE SEARCH ORDER IS MEASURED, not a preference, and each step has a reason a later step cannot take over:
//
//   1. THE TITLE, exactly, then case- and whitespace-insensitively. FIRST, because `selection.ts` splits
//      "All 4 Couples Square Thru 2 to a Wave" into a selection plus a base call — and that whole string IS a
//      corpus title, so a selection-first order would break a published name into a reading nobody authored.
//      The normalised order is safe: MEASURED, no two of the corpus's 2190 titles collide once case and runs
//      of whitespace are folded. PUNCTUATION IS KEPT, because titles carry it (`"O" Cross and Turn`,
//      `Square Thru, on the Second Hand`, `Tidal 3 and 1 Line #1`) and stripping it would lose real names.
//   2. THE ALIAS DICTIONARY (`CALL_ALIAS`) — descriptions that name a call without being its title.
//   3. THE SPOKEN-NAME TABLE (`CALL_SYNONYMS`, through `canonicalName`) — All8 writes `Do Sa Do` for the
//      catalogue's `Dosado`. These are DIFFERENTLY NAMED calls, not descriptions, which is why they are a
//      separate table consulted here rather than folded into `CALL_ALIAS`: a synonym must not be able to
//      shadow a title, and MEASURED, none of the 19 keys is also a title.
//   4. THE SELECTION (`splitSelection`): "Heads Dosado" is a reading over `Dosado`, and the base call is read
//      by this same function, recursively, so "Heads Promenade to Home" works as well as "Heads Dosado".
//   5. THE TWO CORPUS SUFFIXES, structurally. The families spell their modifiers differently and BOTH are
//      measured in the corpus: the circle family suffixes ` Home` in the TITLE (`Circle Left Home`), while the
//      promenade family suffixes ` - Keep Walking`. So "Circle Left to Home" finds `Circle Left Home`, and
//      "Promenade Keep Walking" finds `Promenade - Keep Walking`, without either convention being restated
//      here — step 1 finds whatever the corpus actually authors.
//   6. ALL8'S OWN NOTATION (`decodeLine`), last, for a string that is shorthand rather than prose. ONLY WHEN IT
//      YIELDS EXACTLY ONE CALL: `Sw&Pr` is a figure of two calls, not a name, and calling it one would be the
//      mis-attribution `getout-conformance` exists to prevent.
//   7. REFUSAL, with what was tried and up to three titles whose words overlap the input.
//
// AND A CALL THAT DECODES TO A NAME THE CORPUS LACKS IS A REFUSAL, NOT A MATCH. `SqTh4` decodes to
// `Square Thru 4`, which `KNOWN_CATALOGUE_GAPS` declares the engine cannot dance; this module reports the
// decoded name in `tried` and refuses, because "resolves to a name nothing authors" is the failure mode the
// whole `CALL_TITLE` mechanism was built to make visible.
import { CALL_TITLE, isCallTitle, type CallTitle } from './call-titles.js';
import { CALL_SYNONYMS, canonicalName } from './constants.js';
import { decodeLine } from './all8-notation.js';
import { splitSelection } from './selection.js';

/**
 * DESCRIPTIONS THAT NAME A CALL WITHOUT BEING ITS TITLE, keyed in normalised form (lower case, single spaces).
 *
 * A KEY HERE MUST NOT BE A TITLE: the title step runs first, so such an entry would be dead weight that reads
 * as if it were doing something — `engine/test/call-names.mjs` fails a key that has become a title, which is
 * also what makes the promenade entry below removable when that convention is settled.
 *
 * `promenade home` -> `Promenade` IS THE SEAM, WRITTEN DOWN ONCE. CALLERLAB names the home-ending promenade
 * `Promenade Home`, and this corpus has no such tam: the family was retitled so the BARE name is the
 * home-ending one (`e02b434`), MEASURED — `Promenade [Right and Left Grand Static Square]` finishes dancer 1
 * at (-1,-3) facing 90deg, exactly the corpus `Static Square` spot, while `Promenade - Keep Walking` finishes
 * mid-stride. So the CALLERLAB description maps onto the title this corpus authors. IF THE FAMILY IS RETITLED
 * BACK to the ` Home` spelling, this entry stops resolving anything (the title step answers first), the gate
 * reports it as dead, and deleting it is the whole migration.
 */
export const CALL_ALIAS: Record<string, CallTitle> = {
  'promenade home': 'Promenade',
  'promenade to home': 'Promenade',
  'wrong way promenade home': 'Wrong Way Promenade',
  'single file promenade home': 'Single File Promenade',
};

/** FOLD CASE AND RUNS OF WHITESPACE. Nothing else: titles carry punctuation that must survive (§ the header). */
const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Titles by folded form, built once — 2190 keys, and MEASURED collision-free. */
const TITLE_BY_FOLDED = new Map<string, CallTitle>();
for (const title of Object.keys(CALL_TITLE) as CallTitle[]) {
  TITLE_BY_FOLDED.set(fold(title), title);
}

/** The spoken-name table by folded form, so `do sa do` and `Do Sa Do` answer the same. */
const SYNONYM_BY_FOLDED = new Map<string, string>();
for (const [from, to] of Object.entries(CALL_SYNONYMS)) SYNONYM_BY_FOLDED.set(fold(from), to);

/** How a reading was found. Named so a caller can tell a title match from a guess, and a test can pin each. */
export type CallNameHow = 'title' | 'alias' | 'synonym' | 'selection' | 'suffix' | 'all8' | 'none';

export interface CallNameReading {
  /** Did this name a call the corpus carries? */
  ok: boolean;
  /** The canonical title, when `ok`. */
  title: CallTitle | null;
  /** A selection phrase the string carried ("Heads", "All Except Girls"), as `selection.ts` normalises it. */
  selection: string | null;
  how: CallNameHow;
  /** Every step tried, in order — so a refusal names its own search instead of saying "unknown call". */
  tried: string[];
  /** On failure, up to three titles whose words overlap the input. Never a guess about which was meant. */
  suggestions: CallTitle[];
}

/** Titles whose words overlap the input's, best first — the "did you mean" a refusal can offer. */
function suggestionsFor(raw: string): CallTitle[] {
  const words = new Set(fold(raw).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (words.size === 0) return [];
  const scored: { title: CallTitle; hits: number; length: number }[] = [];
  for (const title of Object.keys(CALL_TITLE) as CallTitle[]) {
    const have = new Set(fold(title).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    let hits = 0;
    for (const word of words) if (have.has(word)) hits++;
    if (hits > 0) scored.push({ title, hits, length: title.length });
  }
  scored.sort((a, b) => b.hits - a.hits || a.length - b.length || (a.title < b.title ? -1 : 1));
  return scored.slice(0, 3).map((s) => s.title);
}

/** The reading of `raw`, without a selection split — the steps that answer for one name. */
function readOne(raw: string, tried: string[]): { title: CallTitle | null; how: CallNameHow } {
  tried.push(`title ${JSON.stringify(raw)}`);
  if (isCallTitle(raw)) return { title: raw, how: 'title' };
  const folded = TITLE_BY_FOLDED.get(fold(raw));
  if (folded) return { title: folded, how: 'title' };

  const alias = CALL_ALIAS[fold(raw)];
  if (alias && isCallTitle(alias)) {
    tried.push(`alias ${JSON.stringify(fold(raw))}`);
    return { title: alias, how: 'alias' };
  }

  const synonym = SYNONYM_BY_FOLDED.get(fold(raw));
  if (synonym && isCallTitle(synonym)) {
    tried.push(`synonym ${JSON.stringify(fold(raw))} -> ${JSON.stringify(synonym)}`);
    return { title: synonym, how: 'synonym' };
  }
  const canon = canonicalName(raw);
  if (canon !== raw && isCallTitle(canon)) {
    tried.push(`canonicalName ${JSON.stringify(raw)} -> ${JSON.stringify(canon)}`);
    return { title: canon, how: 'synonym' };
  }

  // THE TWO CORPUS SUFFIXES. `to Home` is the phrase form of the circle family's ` Home` title suffix;
  // `Keep Walking` is the promenade family's. Neither restates a convention: each retries the TITLE steps
  // with the spelling the corpus actually uses.
  for (const [phrase, suffix] of [
    [' to home', ' home'],
    [' keep walking', ' - keep walking'],
  ] as const) {
    if (!fold(raw).endsWith(phrase)) continue;
    const base = raw.trim().replace(/\s+/g, ' ');
    const stem = base.slice(0, base.length - phrase.length);
    for (const candidate of [`${stem}${suffix}`, stem]) {
      tried.push(`suffix ${JSON.stringify(candidate)}`);
      const hit = TITLE_BY_FOLDED.get(fold(candidate));
      if (hit) return { title: hit, how: 'suffix' };
    }
  }
  return { title: null, how: 'none' };
}

/**
 * Read a raw call string: the title, the selection it was read under, how the name was found, and on failure
 * what was tried plus the closest titles. Never throws — a refusal is a value (AGENTS.md §11.1).
 */
export function readCallName(raw: string): CallNameReading {
  return read(raw, 0);
}

function read(raw: string, depth: number): CallNameReading {
  const tried: string[] = [];
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, title: null, selection: null, how: 'none', tried: ['empty input'], suggestions: [] };

  const direct = readOne(text, tried);
  if (direct.title) return { ok: true, title: direct.title, selection: null, how: direct.how, tried, suggestions: [] };

  // THE SELECTION COMES AFTER THE WHOLE STRING, so a published name that begins with a selection word stays a
  // name (`All 4 Couples Square Thru 2 to a Wave`) — the rule `selection.ts`'s `resolveReading` states as
  // "does the library publish this name", asked here of the CORPUS rather than of the library.
  const split = splitSelection(text);
  if (split.selection) {
    tried.push(`selection ${JSON.stringify(split.selection)}`);
    const inner = readOne(split.call, tried);
    if (inner.title) {
      return { ok: true, title: inner.title, selection: split.selection, how: 'selection', tried, suggestions: [] };
    }
  }

  // ALL8 LAST, and only a SINGLE call: a figure of two calls is not a name. THE DECODED NAME IS ITSELF A RAW
  // CALL STRING and is read by these same rules — All8 writes `Heads Promenade 1/2`, which is a SELECTION over
  // a title rather than a title, and `DoSaD ToWav` for a name only the synonym table knows. One level of
  // recursion, because a decoded name that itself needs decoding would be a codec disagreeing with itself.
  if (depth < 1) {
    const decoded = decodeLine(text);
    if (decoded.calls.length === 1 && !decoded.undecoded) {
      const name = decoded.calls[0].name;
      tried.push(`all8 ${JSON.stringify(text)} -> ${JSON.stringify(name)}`);
      if (name !== text) {
        const inner = read(name, depth + 1);
        if (inner.ok) {
          return { ok: true, title: inner.title, selection: inner.selection, how: 'all8', tried: [...tried, ...inner.tried], suggestions: [] };
        }
      }
    } else if (decoded.undecoded) {
      tried.push(`all8 could not decode ${JSON.stringify(decoded.undecoded)}`);
    } else {
      tried.push(`all8 decoded ${decoded.calls.length} calls, which is a figure rather than a name`);
    }
  }

  return { ok: false, title: null, selection: null, how: 'none', tried, suggestions: suggestionsFor(text) };
}
