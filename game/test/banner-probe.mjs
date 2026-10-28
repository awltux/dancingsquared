// THE BANNER'S FOUR CELLS, PINNED — because each one is a sentence about a number, and a screenshot cannot tell a right one
// from a wrong one.
//
// REPORTED: "All pages have a thin banner containing current hints icons, login status, current score for drills and daily,
// a back button." The back button and the regime line are the router's and are pinned by `shell-controls-probe.mjs`; this
// probe is the other four, and every rule below was chosen against a plausible wrong version:
//   1. A ZERO IS NOT AN ABSENCE. "Daily 0" is a score a player could believe they had earned, so a fact with no score says
//      "no score" — the same distinction `puzzle/board-period.ts` makes when it answers null instead of inventing a month.
//      The negative control prints `0` and is caught by exactly that check.
//   2. THE SESSION IS NOT THE STANDING. A session means "ranked" to a naive rule, but `standingOf` outranks it with the
//      server's own `demo` flag — MEASURED in `game/test/standing-probe.mjs`, where the naive rule ranks a run the server has
//      just called a demo. Here the rule is only about WORDS, but the words must not claim more than the standing: a
//      `dev`-identified player is ranked with no account, and an offline build has no server at all.
//   3. THE METER CANNOT COUNT PAST ITS SLOTS, and cannot go negative: the glyph string is always three characters, whatever
//      the balance says. A held balance of 5 draws ●●● rather than four filled slots in a three-slot meter.
//   4. NO TWO STATES SAY THE SAME THING. Four standings, four sentences — a banner that says "not signed in" under a
//      signed-in player is the failure this pins.
//
// Usage: node game/test/banner-probe.mjs   (pure: no DOM, no storage, no clock, no engine)
import { bannerView } from '../src/ui/banner.ts';

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

/** The facts every case varies one of. A named default keeps each check to the thing it is about. */
const base = {
  hintsHeld: 0,
  playerEmail: null,
  standing: 'offline',
  drillLevel: 1,
  drillBest: null,
  dailyScore: null,
};

console.log('\n== 1. the hint meter ==');
{
  const pips = (held) => bannerView({ ...base, hintsHeld: held }).pips;
  check(pips(0) === '○○○', `nothing held draws three empty slots (${pips(0)})`);
  check(pips(2) === '●●○', `two held draws two filled (${pips(2)})`);
  check(pips(3) === '●●●', `a full balance draws three filled (${pips(3)})`);
  // THE CEILING AND THE FLOOR: the meter is three slots, so a balance past the cap is still three glyphs — and a negative
  // one (a corrupted save) is three empty ones rather than a string with a minus sign in it.
  check(pips(5) === '●●●', `a balance over the cap is still three glyphs (${pips(5)})`);
  check(pips(-2) === '○○○', `and a negative balance is three empty ones (${pips(-2)})`);
  check([...pips(1)].length === 3, 'every meter is exactly three glyphs wide, so the row cannot jump');
  check(bannerView({ ...base, hintsHeld: 2 }).hintsLabel === '2/3', 'and the count beside it is the same number, short');
}

console.log('\n== 2. who you are, and whether it counts ==');
{
  const cell = (facts) => bannerView({ ...base, ...facts });
  const signedIn = cell({ playerEmail: 'ada@example.com', standing: 'ranked' });
  check(signedIn.standingText === 'Signed in as ada@example.com', `a session names the player (${signedIn.standingText})`);
  check(signedIn.standingKind === 'ok', 'and reads as a good fact');
  const dev = cell({ standing: 'ranked' });
  check(dev.standingText === 'Ranked by this server', `a header-identified player is RANKED with no account (${dev.standingText})`);
  const unranked = cell({ standing: 'unranked' });
  check(unranked.standingText === 'Not signed in — runs unranked', `a demo says so in words (${unranked.standingText})`);
  const offline = cell({ standing: 'offline' });
  check(offline.standingText === 'No server — this device only', `and an offline build does not pretend (${offline.standingText})`);
  // THE NEGATIVE CONTROL: the plausible wrong rule — "a session means ranked, and no session means unranked" — is caught by
  // the `dev` check above, because that rule would say "runs unranked" where the server has just promised to rank them.
  const naive = (f) => (f.playerEmail !== null ? 'Signed in' : 'Not signed in');
  check(naive({ playerEmail: null, standing: 'ranked' }) === 'Not signed in' && dev.standingText === 'Ranked by this server',
    'CONTROL: the session-only rule disagrees with the standing rule exactly where a header-identified player is ranked');
  const sentences = new Set([signedIn, dev, unranked, offline].map((v) => v.standingText));
  check(sentences.size === 4, `no two states share a sentence (${sentences.size} of 4)`);
}

console.log('\n== 3. the two scores, and the absence of one ==');
{
  const nobody = bannerView({ ...base, drillLevel: 3 });
  check(nobody.drillText === 'L3 no score', `a level with no run says so (${nobody.drillText})`);
  check(nobody.dailyText === 'Daily no score', `and so does a day with none (${nobody.dailyText})`);
  check(!/ 0$/.test(nobody.drillText) && !/ 0$/.test(nobody.dailyText), 'neither prints a zero for "nothing"');
  const scored = bannerView({ ...base, drillLevel: 3, drillBest: 280, dailyScore: 0 });
  check(scored.drillText === 'L3 280', `a best Drill score is shown with its level (${scored.drillText})`);
  // A REAL ZERO IS A SCORE, and it must not be swallowed by the "no score" branch: `null` and `0` are different facts.
  check(scored.dailyText === 'Daily 0', `and a zero that was earned prints as a zero (${scored.dailyText})`);
  // THE NEGATIVE CONTROL: the plausible shortcut — `score ?? 0` — is caught here, because it prints a zero for an absence.
  const naive = (label, score) => `${label} ${score ?? 0}`;
  check(naive('Daily', null) === 'Daily 0' && nobody.dailyText === 'Daily no score',
    'CONTROL: the `?? 0` shortcut disagrees with the rule wherever there is no score');
}

console.log('\n== 4. every field is filled for every combination ==');
{
  // A SWEEP OVER THE PRODUCT, because the fields are independent and the bug this catches is a branch that returns early:
  // an empty string is silence on screen, and silence is indistinguishable from "not painted yet".
  const standings = ['offline', 'unranked', 'ranked'];
  const emails = [null, 'x@y'];
  const scores = [null, 0, 120];
  let empty = 0;
  let combos = 0;
  for (const standing of standings) {
    for (const playerEmail of emails) {
      for (const drillBest of scores) {
        for (const dailyScore of scores) {
          const view = bannerView({ ...base, standing, playerEmail, drillBest, dailyScore });
          combos++;
          for (const [name, value] of Object.entries(view)) if (value === '') empty++;
        }
      }
    }
  }
  check(combos === standings.length * emails.length * scores.length * scores.length,
    `the sweep drove ${combos} combinations (a zero here is a FAILURE, not a pass)`);
  check(empty === 0, `and no field was ever empty (${empty} empty)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
