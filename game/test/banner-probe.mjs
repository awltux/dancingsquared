// THE BANNER'S FOUR CELLS, PINNED — because each one is a sentence about a number, and a screenshot cannot tell a right one
// from a wrong one.
//
// REPORTED: "All pages have a thin banner containing current hints icons, login status, current score for drills and daily,
// a back button." The back button is the router's and is pinned by `shell-controls-probe.mjs` (the position line that sat
// beside the scores is withdrawn: it reflowed the header onto a second line), so this probe is the other four, and every rule
// below was chosen against a plausible wrong version:
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
  playerAlias: null,
  signedIn: false,
  standing: 'offline',
  drillLevel: 1,
  drillTotal: 0,
  dailyScore: null,
};

console.log('\n== 1. the hint meter ==');
{
  // THE METER IS THREE BARS NOW — "The current circles in the header hint bank seem to be at odds with the badge outline.
  // Change it to a set of three bars within the badge outline." — so the view answers with the STATE of each slot and
  // `style.css` draws it. What is pinned here is the state: exactly three slots, filled from the left, never a fourth.
  const fills = (held) => bannerView({ ...base, hintsHeld: held }).hintFills;
  const drawn = (held) => fills(held).map((on) => (on ? '#' : '.')).join('');
  check(drawn(0) === '...', `nothing held draws three empty slots (${drawn(0)})`);
  check(drawn(2) === '##.', `two held draws two bars from the left (${drawn(2)})`);
  check(drawn(3) === '###', `a full balance draws three filled (${drawn(3)})`);
  // THE CEILING AND THE FLOOR: a balance past the cap is still three slots, and a negative one (a corrupted save) is three
  // empty ones rather than a fourth bar or a minus.
  check(drawn(5) === '###', `a balance over the cap is still three slots (${drawn(5)})`);
  check(drawn(-2) === '...', `and a negative balance is three empty ones (${drawn(-2)})`);
  check(fills(1).length === 3 && fills(5).length === 3, 'every meter is exactly three slots wide, so the row cannot jump');
  // NEGATIVE CONTROL: the shape that shipped was a GLYPH STRING (`'●●○'`), which no stylesheet can turn into bars per slot
  // — the report's mismatch in one line. A view that still answered `pips` would have no `hintFills` at all.
  check(fills(2) !== undefined && fills(2).every((on) => typeof on === 'boolean'),
    'CONTROL: the meter is a slot STATE, not a string of glyphs to be styled by luck');
  // THE NUMBER IS THE ACCESSIBLE NAME NOW. REPORTED: "Remove the text Hints 0/3 and surround the hint circles with a badge
  // outline" — the badge prints nothing, so the label is the only place the count exists and it must say it in full words.
  check(bannerView({ ...base, hintsHeld: 2 }).hintsLabel === 'Hints 2 of 3',
    `the badge's accessible name is the count in words (${bannerView({ ...base, hintsHeld: 2 }).hintsLabel})`);
}

console.log('\n== 2. who you are, and whether it counts ==');
{
  const cell = (facts) => bannerView({ ...base, ...facts });
  const signedIn = cell({ playerAlias: 'Ada Lovelace', signedIn: true, standing: 'ranked' });
  check(signedIn.accountText === 'Ada Lovelace', `the badge shows the player's alias when somebody is signed in (${signedIn.accountText})`);
  check(/Signed in as Ada Lovelace/.test(signedIn.accountTitle) && /ranked/.test(signedIn.accountTitle),
    `and its accessible name says so, with the ranking (${signedIn.accountTitle})`);
  check(signedIn.accountKind === 'ok', 'and it reads as a good fact');
  // THE EMAIL IS NOT THE NAME. REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont
  // expose the email address anywhere on the UI." Neither the text nor the accessible name may hold an address, and the
  // one way an address could reach this cell now is a caller passing one as an alias — which the check below catches.
  check(!/[@]/.test(signedIn.accountText) && !/[@]/.test(signedIn.accountTitle),
    'and an address is never what the badge says, in either place');
  // A SIGNED-IN PLAYER WITH NO NAME IS NOT A SIGNED-OUT ONE, and it is the state a player sees between signing in and
  // claiming a name: it must not read as "Sign in", and it must not lose the `ok` ranking.
  const unnamed = cell({ playerAlias: null, signedIn: true, standing: 'ranked' });
  check(unnamed.accountText !== 'Sign in' && unnamed.accountKind === 'ok',
    `a signed-in player who has claimed no name yet is drawn as signed in (${unnamed.accountText} / ${unnamed.accountKind})`);
  check(/claim a name/.test(unnamed.accountTitle), `and asked for one in the accessible name (${unnamed.accountTitle})`);
  // THE EMPTY BADGE THE REPORT ASKED FOR: a signed-out player gets a CONTROL that says "Sign in" — not a sentence, and not
  // nothing, which is what an offline build used to render. REPORTED as "The empty login account badge is missing from the
  // header".
  check(cell({ standing: 'unranked' }).accountText === 'Sign in', 'a signed-out player gets "Sign in", never an empty cell');
  check(cell({ standing: 'offline' }).accountText === 'Sign in', 'and so does an offline build');
  check(cell({ standing: 'ranked' }).accountText === 'Sign in', 'and a header-identified player, who has no account to name');
  const dev = cell({ standing: 'ranked' });
  check(dev.accountKind === 'ok' && /Ranked by this server/.test(dev.accountTitle),
    `a header-identified player is RANKED with no account (${dev.accountTitle})`);
  const unranked = cell({ standing: 'unranked' });
  check(/runs unranked/.test(unranked.accountTitle), `a demo says so in the badge's name (${unranked.accountTitle})`);
  const offline = cell({ standing: 'offline' });
  check(/No server/.test(offline.accountTitle), `and an offline build does not pretend (${offline.accountTitle})`);
  // THE NEGATIVE CONTROL: the plausible wrong rule — "a session means ranked, and no session means unranked" — is caught by
  // the `dev` check above, because that rule would call a header-identified player unranked where the server has just
  // promised to rank them.
  const naive = (f) => (f.signedIn ? 'Signed in' : 'Not signed in');
  check(naive({ signedIn: false, standing: 'ranked' }) === 'Not signed in' && dev.accountKind === 'ok',
    'CONTROL: the session-only rule disagrees with the standing rule exactly where a header-identified player is ranked');
  // THE FOUR STANDINGS STILL TELL THEMSELVES APART — that discrimination moved from the old paragraph's text into the badge's
  // accessible name, and it is the thing a reader needs before trusting a score.
  const titles = new Set([signedIn, dev, unranked, offline].map((v) => v.accountTitle));
  check(titles.size === 4, `no two states share an accessible name (${titles.size} of 4)`);
}

console.log('\n== 3. the level, the running total and the Daily ==');
{
  // REPORTED: "The L1 100 Daily No Score should be simplified ... L1 {Drill Icon}:100 {Daily Icon}:0", then "there doesnt seem to
  // be a running total for the drill puzzles. Not sure whats its counting every time I resolve a drill." So the drill's number is
  // a TOTAL, and the Daily's is today's score.
  const nobody = bannerView({ ...base, drillLevel: 3 });
  check(nobody.levelText === 'L3', `the cell starts with the level (${nobody.levelText})`);
  // A TOTAL OF NOTHING IS ZERO AND THAT IS THE TRUE ANSWER — unlike a Daily nobody has played, which is an absence.
  check(nobody.drillScore === '0', `a player who has solved nothing has a total of zero (${nobody.drillScore})`);
  check(nobody.dailyScore === '—', `a day with no run shows a dash (${nobody.dailyScore})`);
  check(nobody.scoresLabel === 'Level 3: drill total 0, Daily no score',
    `and the accessible name says both in words (${nobody.scoresLabel})`);
  const scored = bannerView({ ...base, drillLevel: 3, drillTotal: 340, dailyScore: 0 });
  check(scored.drillScore === '340', `the running total is the number alone (${scored.drillScore})`);
  // A REAL ZERO IS A SCORE, and it must not be swallowed by the "no score" branch: `null` and `0` are different facts, and the
  // compact cell is where that distinction is easiest to lose.
  check(scored.dailyScore === '0', `and a Daily zero that was earned prints as a zero (${scored.dailyScore})`);
  check(scored.scoresLabel === 'Level 3: drill total 340, Daily best 0',
    `with the words to match (${scored.scoresLabel})`);
  // THE TOTAL MOVES WHEN A DRILL IS SOLVED, which is the complaint: a fixed 100 could not tell a player what it was counting. The
  // check is the arithmetic itself, over the same facts a solve changes.
  const before = bannerView({ ...base, drillTotal: 340 });
  const after = bannerView({ ...base, drillTotal: 340 + 120 });
  check(before.drillScore === '340' && after.drillScore === '460',
    `solving a drill worth 120 takes the total from ${before.drillScore} to ${after.drillScore}`);
  // THE NEGATIVE CONTROL: the plausible shortcut — `score ?? 0` — is caught here, because it prints a zero for an absence where
  // the Daily's absence must be a dash.
  const naive = (score) => `${score ?? 0}`;
  check(naive(null) === '0' && nobody.dailyScore === '—',
    'CONTROL: the `?? 0` shortcut disagrees with the rule wherever there is no score');
  // AND THE DASH IS NOT `0` — the two must be told apart by the value itself, not only by the label.
  check(naive(null) !== nobody.dailyScore && naive(0) === scored.dailyScore,
    'CONTROL: "no score" and "scored zero" are different strings');
}

console.log('\n== 4. every field is filled for every combination ==');
{
  // A SWEEP OVER THE PRODUCT, because the fields are independent and the bug this catches is a branch that returns early:
  // an empty string is silence on screen, and silence is indistinguishable from "not painted yet".
  const standings = ['offline', 'unranked', 'ranked'];
  // AN ALIAS, AND THE TWO NOTHING-STATES: a null name with a session (signed in, no name yet) and a null one without.
  const aliases = [null, 'Ada Lovelace'];
  const scores = [null, 0, 120];
  let empty = 0;
  let combos = 0;
  for (const standing of standings) {
    for (const playerAlias of aliases) {
      for (const drillTotal of scores) {
        for (const dailyScore of scores) {
          const signedIn = playerAlias !== null;
          const view = bannerView({ ...base, standing, playerAlias, signedIn, drillTotal, dailyScore });
          combos++;
          for (const [name, value] of Object.entries(view)) if (value === '') empty++;
        }
      }
    }
  }
  check(combos === standings.length * aliases.length * scores.length * scores.length,
    `the sweep drove ${combos} combinations (a zero here is a FAILURE, not a pass)`);
  check(empty === 0, `and no field was ever empty (${empty} empty)`);
  // AND THE SIGNED-IN-WITHOUT-A-NAME COMBINATION IS IN THE SWEEP ABOVE ONLY BY ACCIDENT, so it is driven explicitly: it is
  // the state between signing in and claiming a name, which a sweep keyed on the alias alone would never reach.
  const between = bannerView({ ...base, standing: 'ranked', playerAlias: null, signedIn: true });
  check(between.accountText !== '' && between.accountTitle !== '' && between.accountKind === 'ok',
    `the signed-in-but-unnamed state is filled and ranked (${between.accountText} / ${between.accountKind})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
