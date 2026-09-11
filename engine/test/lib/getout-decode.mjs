// Re-export shim. The All8 notation table, tokenizer and line decoder now live in the ENGINE
// (`engine/src/sequencer/all8-notation.ts`), because the sequence import/export feature needs them
// from production code and a second copy of a 130-entry abbreviation table is exactly how two
// readers drift apart.
//
// This file used to hold that table. It is kept as a shim so every harness keeps importing the same
// names from the same path, and so there is still ONE module to grep for All8 notation.
//
// What stays HERE, deliberately, is the harness's own policy and reporting:
//   - `KNOWN_CATALOGUE_GAPS` is a reviewable statement about which All8 names the engine does not
//     implement. It is a conformance GATE input, not notation, so it is not engine API.
//   - `decodeStats` / `formatRanking` produce the two token rankings the harness prints.
//
// Run: used by test/getout-conformance.mjs, test/getout-behaviour.mjs, test/promenade.mjs.

import { TOKENS, MULTI_TOKENS, REPEAT_TOKENS, SUFFIX_TOKENS, GROUP, tokenize, decodeToken, decodeTokenAll, decodeLine, normalizeToken } from '../../dist/index.js';

export { TOKENS, MULTI_TOKENS, REPEAT_TOKENS, SUFFIX_TOKENS, GROUP, tokenize, decodeToken, decodeTokenAll, decodeLine, normalizeToken };

/**
 * Names All8 uses that the catalogue genuinely does NOT implement.
 *
 * RE-EXPORTED FROM THE ENGINE, NOT DEFINED HERE. This file used to carry its own copy, and the two
 * copies DRIFTED: the engine's was left holding `Eight Chain 1`..`Eight Chain 5` and `Run Left`/
 * `Run Right` (all of which the engine does implement now) and was missing `Back Up`, `Square Thru 5`
 * and `Trade Right`. Two lists is how a table silently becomes two tables - the same mistake the
 * verify-suite header warns about - so there is now ONE definition, in the engine, and this is the
 * shim for it. `engine/test/catalogue.mjs` and `getout-conformance.mjs` both read it from here.
 */
export { KNOWN_CATALOGUE_GAPS } from "../../dist/sequencer/all8-notation.js";
/**
 * Both token rankings over a set of published lines.
 *
 * TWO rankings, because they answer different questions and this repo has previously quoted
 * one while naming the other's harness:
 *
 *   - `firstFail` counts each token once per line, at the FIRST unreadable position - which is
 *     what the runner actually stops on, so it measures how many lines a fix would unblock;
 *   - `allOcc` counts every occurrence anywhere in the line, including tokens sitting behind an
 *     earlier unknown, so it measures the true size of the vocabulary gap.
 *
 * They disagree materially (`&Roll` is 21 first-failure but 41 all-occurrence; `LA` is 6 vs 14),
 * so a work queue built from one of them is not the same queue as a queue built from the other.
 */
export function decodeStats(lines) {
  const firstFail = new Map();
  const allOcc = new Map();
  let decoded = 0;
  let undecoded = 0;
  for (const line of lines) {
    const tokens = tokenize(line);
    let failed = false;
    tokens.forEach((tk, i) => {
      // Repeat and suffix tokens are readable exactly when something precedes them - the same rule
      // `decodeLine` applies - and it must be applied here too, or a line whose only unknown is a
      // leading `Twice`/`ToWav` would be counted as decoded by one reader and not the other.
      const t = normalizeToken(tk);
      const lineScoped = REPEAT_TOKENS.has(t) || t in SUFFIX_TOKENS;
      const readable = lineScoped ? i > 0 : decodeToken(tk) !== null;
      if (readable) return;
      allOcc.set(tk, (allOcc.get(tk) ?? 0) + 1);
      if (!failed) { firstFail.set(tk, (firstFail.get(tk) ?? 0) + 1); failed = true; }
    });
    if (failed) undecoded++; else decoded++;
  }
  return { total: lines.length, decoded, undecoded, firstFail, allOcc };
}

/** `token(count) token(count) â€¦`, most frequent first, ties broken by token so a report is
 * stable between runs. */
export function formatRanking(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t, n]) => `${t}(${n})`)
    .join(' ');
}
