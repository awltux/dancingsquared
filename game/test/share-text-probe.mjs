// THE SHARE LINE, PINNED EXACTLY — because a paste is public and a near-miss is a spoiler or a lie.
//
// REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The shareable result is the
// genre's strongest retention trick (Wordle's grid) and costs nothing: a string the clipboard takes, no network, no image,
// no analytics. `ui/share-text.ts` owns the words; this probe pins them character for character, which is the only way to
// be sure a later edit does not start publishing the player's line, the seed or their name.
//
// WHAT THIS PINS:
//   1. THE EXACT STRING for each rank, a short and a long run, and a Daily with its day. A test that only checked
//      "contains Dancing Squared" would pass a line that had grown a call list.
//   2. NOTHING PRIVATE: no seed, no line, no puzzle identity — asserted by construction, over every shape.
//   3. A REFUSAL IS `null` for a run with no stars, so a caller cannot paste "☆☆☆".
//   4. THE TIME RULE IS THE CARD'S: one decimal under ten seconds, whole above, so the paste and the screen agree.
//
// Usage: node game/test/share-text-probe.mjs   (pure: no clipboard, no DOM, no engine)
import { shareText } from '../src/ui/share-text.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const base = { stars: 3, score: 300, elapsedSeconds: 4.25, day: null };

console.log('\n== 1. the exact line ==');
{
  check(shareText(base) === 'Dancing Squared ★★★ · 300 pts · 4.3s', `a clean run reads exactly (${shareText(base)})`);
  check(shareText({ ...base, stars: 2, score: 120 }) === 'Dancing Squared ★★☆ · 120 pts · 4.3s',
    `two stars keeps one hollow (${shareText({ ...base, stars: 2, score: 120 })})`);
  check(shareText({ ...base, stars: 1 }) === 'Dancing Squared ★☆☆ · 300 pts · 4.3s',
    `one star keeps two (${shareText({ ...base, stars: 1 })})`);
  check(shareText({ ...base, elapsedSeconds: 12.4 }) === 'Dancing Squared ★★★ · 300 pts · 12s',
    `twelve seconds is whole seconds (${shareText({ ...base, elapsedSeconds: 12.4 })})`);
  check(shareText({ ...base, elapsedSeconds: 9.99 }) === 'Dancing Squared ★★★ · 300 pts · 10.0s',
    `just under ten keeps its decimal (${shareText({ ...base, elapsedSeconds: 9.99 })})`);
  check(shareText({ ...base, day: '2026-10-15' }) === 'Dancing Squared ★★★ · 300 pts · 4.3s · Daily 2026-10-15',
    `a Daily names the day (${shareText({ ...base, day: '2026-10-15' })})`);
}

console.log('\n== 2. nothing private, over every shape ==');
{
  const shapes = [base, { ...base, stars: 2 }, { ...base, stars: 1 }, { ...base, day: '2026-10-15' }];
  const leaked = shapes.map((parts) => shareText(parts)).filter((text) => /seed|line|moves|Promenade|#\d/.test(text));
  check(leaked.length === 0, `no call list, seed or puzzle identity in any line (${leaked.length} leaked)`, leaked.join(' | '));
  // THE DAY APPEARS ONLY FOR A DAILY: a drill has no date, and a line that invented one would be false.
  check(!shareText(base).includes('Daily') && !shareText(base).includes('2026'),
    'a drill line carries no day');
}

console.log('\n== 3. a refusal is a value ==');
{
  check(shareText({ ...base, stars: 0 }) === null, 'no stars is null, not "☆☆☆"');
  check(shareText({ ...base, stars: -1 }) === null, 'and a negative rank is refused the same way');
  // A RANK ABOVE THREE IS CLAMPED rather than drawing a fourth star the card never gave.
  check(shareText({ ...base, stars: 7 }) === 'Dancing Squared ★★★ · 300 pts · 4.3s', 'a rank above three clamps to three');
  check(shareText({ ...base, stars: 2.9 }).startsWith('Dancing Squared ★★☆'), 'and a fraction floors to the rank it earned');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
