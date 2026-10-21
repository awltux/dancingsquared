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
//      of whitespace are folded. PUNCTUATION IS KEPT, because titles carry it — MEASURED, the corpus has titles
//      with commas, quotes, slashes and brackets (`All Around the Corner, See Saw Your Partner`,
//      `(From offset columns) "Z" Walk and Dodge`) and folding it away would lose real names.
//   2. THE ALIAS DICTIONARY (`CALL_ALIAS`) — descriptions that name a call without being its title.
//   3. THE SPOKEN-NAME TABLE (`CALL_SYNONYMS`, through `canonicalName`) — All8 writes `Do Sa Do` for the
//      catalogue's `Dosado`. These are DIFFERENTLY NAMED calls, not descriptions, which is why they are a
//      separate table consulted here rather than folded into `CALL_ALIAS`: a synonym must not be able to
//      shadow a title, and MEASURED, none of the 19 keys is also a title.
//   4. THE SELECTION (`splitSelection`): "Heads Dosado" is a reading over `Dosado`, and the base call is read
//      by this same function, recursively, so "Heads Promenade to Home" works as well as "Heads Dosado".
//   5. THE TRAILING MODIFIER (`MODIFIERS`), for a phrase that changes ONE call rather than adding a second:
//      `to Home`, `Keep Walking` / `don't stop` / `don't slow down`, `Half`/`Halfway`, `full`/`4/4`, and the
//      bracketed form `Promenade (Keep Walking)`. Each entry rewrites the stem to the spelling the corpus
//      authors, so no convention is restated here — step 1 finds whatever the corpus actually has.
//   6. ALL8'S OWN NOTATION (`decodeLine`), for a string that is shorthand rather than prose. ONLY WHEN IT
//      YIELDS EXACTLY ONE CALL: `Sw&Pr` is a figure of two calls, not a name, and calling it one would be the
//      mis-attribution `getout-conformance` exists to prevent. THE DECODED NAME IS RE-READ by these same
//      rules, which is what makes `H-Pr1/2` resolve — All8 decodes it to `Heads Promenade 1/2`, a selection
//      over a title rather than a title.
//   7. REFUSAL, with what was tried and up to three titles whose words overlap the input.
//
// A FIGURE OF SEVERAL CALLS IS A DIFFERENT QUESTION, and `readCallSequence` answers it: it reads the whole
// string as ONE name first (so `Head Boys and Side Girls Promenade` stays a selection and `All 4 Couples ...`
// stays a title), and only when that fails does it split — on `;`, on ` and `, and finally through All8's own
// decoder, which is where `Sw&Pr` becomes `Swing Your Partner; Promenade`. A split is only accepted when EVERY
// part reads, so a half-understood figure is a refusal rather than a silent truncation.
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
export type CallNameHow = 'title' | 'alias' | 'synonym' | 'selection' | 'modifier' | 'all8' | 'none';

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

  // THE TRAILING MODIFIER, tried here because it is a spelling of ONE name rather than a second call. See
  // `MODIFIERS` for the table, the oracle behind each entry, and why the `to home` entry offers TWO candidates.
  const modified = stripTrailingModifier(raw);
  if (modified) {
    for (const candidate of modified.candidates) {
      tried.push(`modifier ${JSON.stringify(modified.modifier)} -> ${JSON.stringify(candidate)}`);
      const hit = TITLE_BY_FOLDED.get(fold(candidate));
      if (hit) return { title: hit, how: 'modifier' };
    }
  }
  return { title: null, how: 'none' };
}

/**
 * TRAILING MODIFIERS, AS DESCRIPTIONS, mapped onto the spelling this corpus authors — one table for what used to
 * be two hardcoded suffix rules.
 *
 * EVERY ENTRY IS A PHRASE THE ORACLE OR THE CORPUS USES, not an invention:
 *  - `to home` is the phrase form of the circle family's ` Home` TITLE suffix (`Circle Left Home`), so it
 *    rewrites to `<stem> home` and lets the title step decide;
 *  - `keep walking`, `don't stop`, `don't slow down` and the doubled form are CALLERLAB's own words for the
 *    same command (`callerlab-ms.txt`, Promenade Family: "Promenade, Keep Walking; Promenade, don't stop,
 *    don't slow down"), and the corpus spells that call `Promenade - Keep Walking`;
 *  - `half`/`halfway` is the oracle's "Heads Promenade Half (or Halfway)", and the corpus spells the fraction
 *    `1/2`;
 *  - `full`/`4/4` is the reverse: a full promenade IS the bare title (the notation table's `Pr4/4` decodes to
 *    `Promenade` for the same reason), so the modifier is DELETED rather than appended.
 *
 * `rewrite` returns the whole candidate string, so a modifier can append, substitute or delete. The longest
 * matching phrase wins, so "don't stop, don't slow down" is not read as "don't stop".
 */
const MODIFIERS: readonly { phrase: string; candidates: (stem: string) => string[] }[] = [
  { phrase: "don't stop, don't slow down", candidates: (s) => [`${s} - keep walking`] },
  { phrase: 'keep walking', candidates: (s) => [`${s} - keep walking`] },
  { phrase: "don't stop", candidates: (s) => [`${s} - keep walking`] },
  { phrase: "don't slow down", candidates: (s) => [`${s} - keep walking`] },
  // TWO SPELLINGS, because the two families mark the home ending DIFFERENTLY and both are measured in the corpus:
  // the circle family suffixes ` Home` in the TITLE (`Circle Left Home`), while the promenade family's home-ending
  // tam is the BARE fraction (`Promenade 3/4` — the retitle in `e02b434`). Offering only `<stem> home` read
  // `Sides Promenade 3/4 to Home` as `Promenade 3/4 home`, a title nothing authors, and refused it: MEASURED as
  // five failures in `step-forward.mjs` sections 8 and 9. So the modifier offers BOTH candidates and lets the
  // title step decide, which is the rule the rest of this module follows.
  { phrase: 'to home', candidates: (s) => [`${s} home`, s] },
  { phrase: 'halfway', candidates: (s) => [`${s} 1/2`] },
  { phrase: 'half', candidates: (s) => [`${s} 1/2`] },
  { phrase: '4/4', candidates: (s) => [s] },
  { phrase: 'full', candidates: (s) => [s] },
];

/**
 * A trailing modifier and the candidates it rewrites to, or null.
 *
 * IT ALSO UNWRAPS PARENTHESES, because "Promenade (Keep Walking)" is how the same modifier is written when it is
 * an aside: the bracketed tail is removed and offered as the modifier, so the phrase table above can answer for
 * it instead of a second table for brackets.
 */
function stripTrailingModifier(raw: string): { modifier: string; candidates: string[] } | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  // A bracketed tail, e.g. "Promenade (Keep Walking)". `[^()]*` keeps it to one level, which is all the corpus
  // and the oracle use; a nested aside is refused rather than mis-split.
  const bracketed = text.match(/^(.*?)\s*\(([^()]*)\)$/);
  if (bracketed) {
    const inside = bracketed[2].trim();
    const stem = bracketed[1].trim();
    const known = MODIFIERS.find((m) => fold(m.phrase) === fold(inside));
    if (known && stem) return { modifier: inside, candidates: known.candidates(stem) };
    return { modifier: inside, candidates: [`${stem} ${inside}`] };
  }
  // A comma-separated or space-separated tail, LONGEST PHRASE FIRST.
  for (const mod of [...MODIFIERS].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const sep of [', ', ' ']) {
      const tail = `${sep}${mod.phrase}`;
      if (fold(text).endsWith(fold(tail))) {
        const stem = text.slice(0, text.length - tail.length).trim();
        if (stem) return { modifier: mod.phrase, candidates: mod.candidates(stem) };
      }
    }
  }
  return null;
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

/** How a sequence was found: as one name, or split by one of the three separators. */
export type CallSequenceHow = 'single' | ';' | 'and' | 'all8' | 'none';

export interface CallSequenceReading {
  /** Did EVERY part of this string name a call? */
  ok: boolean;
  /** One reading for a single name, or one per part of a figure. Empty on failure. */
  calls: CallNameReading[];
  how: CallSequenceHow;
  /** On failure: every split that was tried, and the part that did not read. */
  tried: string[];
}

/**
 * A FIGURE, READ AS ITS CALLS — one name if that is what it is, several if it is a sequence.
 *
 * THE WHOLE STRING IS READ FIRST, and that is the rule that keeps the joins unambiguous. `Head Boys and Side
 * Girls Promenade` is ONE selection over one call and `Girls Swing Thru and Promenade` is TWO calls; only the
 * whole-string attempt can tell them apart, because the first reads complete and the second does not. So a
 * successful single reading always wins, and a split is attempted only when it fails.
 *
 * EVERY PART MUST READ. A split that leaves one part unreadable is a REFUSAL that names the part, not a
 * truncation — "the first three calls of your figure are fine" is exactly the confident-half-answer this repo
 * keeps paying for (AGENTS.md §11.2.11).
 *
 * THE SEPARATORS ARE TRIED IN A FIXED ORDER — `;` (never part of a call name here), then ` and ` (a word that
 * separates terms as well as calls, which is why the whole-string attempt comes first), then All8's decoder for
 * shorthand like `Sw&Pr`, which yields the same answer `decodeLine` already publishes.
 */
export function readCallSequence(raw: string): CallSequenceReading {
  const tried: string[] = [];
  const text = String(raw ?? '').trim();
  const whole = readCallName(text);
  if (whole.ok) return { ok: true, calls: [whole], how: 'single', tried: [...whole.tried] };
  tried.push(...whole.tried);

  const attempts: { how: CallSequenceHow; parts: string[] }[] = [];
  const semi = text.split(';').map((p) => p.trim()).filter(Boolean);
  if (semi.length > 1) attempts.push({ how: ';', parts: semi });
  const and = text.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (and.length > 1) attempts.push({ how: 'and', parts: and });
  const decoded = decodeLine(text);
  if (decoded.calls.length > 1) attempts.push({ how: 'all8', parts: decoded.calls.map((c) => c.name) });

  for (const attempt of attempts) {
    const calls = attempt.parts.map((part) => readCallName(part));
    const bad = calls.map((c, i) => ({ c, part: attempt.parts[i] })).filter((x) => !x.c.ok);
    tried.push(`split on ${attempt.how} -> ${attempt.parts.length} part(s)${bad.length ? `, ${bad.length} did not read` : ''}`);
    if (bad.length === 0) return { ok: true, calls, how: attempt.how, tried };
    for (const x of bad) tried.push(`  part ${JSON.stringify(x.part)} refused`);
  }

  return { ok: false, calls: [], how: 'none', tried };
}
