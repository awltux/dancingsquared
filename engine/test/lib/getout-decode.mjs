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

import { TOKENS, MULTI_TOKENS, REPEAT_TOKENS, GROUP, tokenize, decodeToken, decodeTokenAll, decodeLine, normalizeToken } from '../../dist/index.js';

export { TOKENS, MULTI_TOKENS, REPEAT_TOKENS, GROUP, tokenize, decodeToken, decodeTokenAll, decodeLine, normalizeToken };

/**
 * Names All8 uses that the catalogue genuinely does NOT implement.
 *
 * This list exists to make "this is a real catalogue gap" DIFFERENT from "we mis-expanded a
 * token", which are otherwise indistinguishable from the outside: before this, a mis-expansion
 * showed up as an absent name and was reported as an engine deficiency. Declaring each one is
 * what lets `getout-conformance.mjs` require every OTHER token to expand to a call the engine
 * actually has, and fail loudly if one does not.
 *
 * Measured (Phase 2): 59 of the table's 64 distinct names are implemented. These are the 5 that
 * are not, and they are genuine engine gaps, not decoding errors:
 *   Join Hands, 1/2 Circulate            - absent from the catalogue entirely
 *   Left Hinge                           - absent entirely (only bare `Hinge` exists)
 *   Fold, Cross Fold                     - in the index, with no <tam> anywhere
 */
export const KNOWN_CATALOGUE_GAPS = new Set([
  'Join Hands',
  '1/2 Circulate',
  'Left Hinge',
  'Fold',
  'Cross Fold',
  // Confirmed by All8's own abbreviation list, so the READING is not in doubt - the engine simply
  // does not implement the call. Declaring them here is what moves those corpus lines out of "our
  // gap in reading All8" and into a correct engine-gap attribution. `Single Hinge` alone is 11
  // lines, and the biggest single item left on the decoder ranking.
  // `Single Hinge` and `Left Hand Hinge` are NOT here any more: Phase 6 bridged both to the
  // engine's `Hinge` in CALL_SYNONYMS, which is where All8's own key puts them ("Hinge
  // {designated} Hinge (prefer SHing if designating all)"; "LHing ... Hinge by the Left"). The
  // gate's stale-gap check is what caught each of them in turn.
  'Right-hand Star',
  'Sweep 1/4',
  '1/2 Tag',
  'Eight Chain 1',
  'Eight Chain 2',
  'Eight Chain 3',
  'Eight Chain 4',
  'Eight Chain 5',
  'Ladies In And The Men Sashay',
  'Cross Run',
  'See Saw',
  // Second pass over All8's key. Each READING is authoritative (copied from the key, not inferred)
  // and each was checked against `implementedTitles()`: the engine really has no such call. In
  // particular `Square Thru 1` is a surprising gap - the catalogue ships Square Thru 1 1/2, 2, 3
  // and 4, so the ONE-hand version is the odd one missing, and All8 uses it (`--SqTh1 --AL`).
  'Square Thru 1',
  'Circle 2',
  'Run Left',
  'Run Right',
]);

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
      // A repeat token is readable exactly when there is something behind it to repeat, which is
      // the same rule `decodeLine` applies - and it must be applied here too, or a line whose only
      // unknown is a leading `Twice` would be counted as decoded by one ranking and not the other.
      const readable = REPEAT_TOKENS.has(normalizeToken(tk)) ? i > 0 : decodeToken(tk) !== null;
      if (readable) return;
      allOcc.set(tk, (allOcc.get(tk) ?? 0) + 1);
      if (!failed) { firstFail.set(tk, (firstFail.get(tk) ?? 0) + 1); failed = true; }
    });
    if (failed) undecoded++; else decoded++;
  }
  return { total: lines.length, decoded, undecoded, firstFail, allOcc };
}

/** `token(count) token(count) …`, most frequent first, ties broken by token so a report is
 * stable between runs. */
export function formatRanking(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t, n]) => `${t}(${n})`)
    .join(' ');
}
