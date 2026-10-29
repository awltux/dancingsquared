// THE THIN BANNER'S CELLS, AS A PURE FUNCTION OF THE FACTS THE SHELL ALREADY HOLDS.
//
// REPORTED: "All pages have a thin banner containing current hints icons, login status, current score for drills and daily,
// a back button." The back button is the router's (`ui/pages.ts` and `main.ts`'s `paintChrome`), and the position line that
// used to sit beside the scores was withdrawn ("Remove this text section from the heading ... It causes the header to reflow
// onto the next line for mobile"); this
// module is the other four, because each is a SENTENCE about a number and the sentence is the part that can be wrong in
// ways a screenshot does not show: "not ranked" when the server is simply absent, a score of 0 printed where there is no
// score at all, a hint meter that counts to four.
//
// THE LOGIN STATUS IS A BADGE AND NOT A PARAGRAPH, and that is the second report: "The empty login account badge is missing
// from the header." A sentence tells a player their state and gives them nothing to press; a badge is the state AND the way
// to the account page, in every state including the empty one — which is the one that used to render as nothing at all on
// an offline build. So the four standings below are now the badge's ACCESSIBLE NAME rather than visible text, and the badge
// itself says "Sign in" or the email.
//
// WHY IT IS ITS OWN MODULE (AGENTS.md §4.3, §11.4.5). The app layer that owns the DOM is the one layer no probe can load,
// and this rule rots there: `theme-probe` and `shell-controls-probe` can see a token or an id, and neither can see that a
// signed-out player is being told they are ranked. `game/test/banner-probe.mjs` drives every combination of the facts below,
// including the two that are easy to get wrong — a header-identified player (`dev`, ranked without an account) and a score
// that is absent rather than zero.
//
// THE FACTS ARE PASSED IN, NEVER READ HERE: no storage, no clock, no network, no DOM. `main.ts` gathers them from the
// session, the saved game and the standing rule (`net/standing.ts`); this file decides only what they say.
import type { Standing } from '../net/standing.ts';

/** A number the banner may or may not have. `null` is "no score yet", which is NOT zero and must not print as one. */
export interface BannerFacts {
  /** Hints held, from the local balance (the drills earn it and the Daily spends it). */
  readonly hintsHeld: number;
  /**
   * THE SIGNED-IN PLAYER'S PUBLIC NAME, or null when nobody is signed in — and null ALSO for a signed-in player who has
   * not claimed one yet.
   *
   * IT WAS THE EMAIL, and REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose
   * the email address anywhere on the UI." The badge is `aria-label` plus `title` only (the button draws a person glyph),
   * so a name here is READ ALOUD and shown on hover — which is exactly why it may not be an address.
   */
  readonly playerAlias: string | null;
  /**
   * Whether a session exists, which `playerAlias` cannot say on its own: a signed-in player who has not claimed a name
   * yet has a null alias too, and that state must not be drawn as "Sign in".
   */
  readonly signedIn: boolean;
  /** What the server will do with a run, from `standingOf` — the one rule that decides it. */
  readonly standing: Standing;
  /** The level the player is on, for the scores cell's label. */
  readonly drillLevel: number;
  /**
   * THE PLAYER'S RANKED DRILL TOTAL, AS THE SERVER HOLDS IT — or zero when the app has no server score.
   *
   * IT WAS "THIS LEVEL'S BEST", THEN "THIS DRILL'S SCORE", THEN A DEVICE SUM. The first two were reports ("the drill score
   * seems to just show 100"; "there doesnt seem to be a running total"), and the third was the offline score this app has
   * now dropped: a sum of solved drills counted demo and practice runs the server never saw, so it could disagree with the
   * board (REPORTED: header 726 beside a leaderboard 1818). THE SERVER IS THE ONE POINT OF TRUTH: the shell passes its
   * ranked board score, and ZERO when there is none — 0 is the true "nothing earned", not a fallback to another quantity.
   */
  readonly drillTotal: number;
  /** Today's Daily score AS THE SERVER HOLDS IT, or null when there is none (a signed-out or practice run is unscored). */
  readonly dailyScore: number | null;
}

/** What the banner shows, one field per cell. */
export interface BannerView {
  /** The meter: filled for what is held, three slots, drawn inside a badge with no number beside it. */
  readonly pips: string;
  /** The meter's accessible name, which is where the number lives now that the row carries no words. */
  readonly hintsLabel: string;
  /** The level the scores belong to, as the row shows it: `L1`. */
  readonly levelText: string;
  /** The running total of solved drills — always a number, because a sum of nothing is zero. */
  readonly drillScore: string;
  /** Today's Daily score, or an em dash when there is none. */
  readonly dailyScore: string;
  /** The scores cell in words, for the group's accessible name: "Level 1: drill total 340, Daily no score". */
  readonly scoresLabel: string;
  /** The account badge's own text: the player's alias when there is one, "Sign in" when nobody is signed in. */
  readonly accountText: string;
  /**
   * The badge's accessible name, which carries the ranking as well as the identity — the fact the paragraph this button
   * replaced used to state, and the reason the four standings still have four distinct sentences.
   */
  readonly accountTitle: string;
  /** How the badge reads: a rank is `ok` and an absence of one is neutral. */
  readonly accountKind: 'ok' | 'info';
}

/** Three slots is the meter's width, matching the pips the footer carried before they moved here (`DESIGN.md` §10). */
const METER = 3;

/**
 * The cells, from the facts.
 *
 * THE ROW CARRIES NO SENTENCES, WHICH MOVED THE WORDS INTO ACCESSIBLE NAMES. REPORTED: "Remove the text Hints 0/3 and
 * surround the hint circles with a badge outline … The L1 100 Daily No Score should be simplified and moved up to the same
 * line as the hints on the left hand side … L1 {Drill Icon}:100 {Daily Icon}:0". So each cell is a picture of one fact and its
 * `aria-label` is the sentence that used to be printed: a meter of three circles named "Hints 2 of 3", and a level with a
 * glyph per game named "Level 1: drill best 280, Daily no score".
 *
 * A ZERO AND AN ABSENCE ARE STILL DIFFERENT THINGS, and the compact row says so with an em dash rather than a zero — see
 * `scoreValue`. `0` prints as `0`, because a zero IS a score a player earned.
 */
export function bannerView(facts: BannerFacts): BannerView {
  const held = Math.max(0, facts.hintsHeld);
  const filled = Math.min(METER, held);
  const pips = '●'.repeat(filled) + '○'.repeat(METER - filled);
  const account = accountBadge(facts);
  return {
    pips,
    hintsLabel: `Hints ${held} of ${METER}`,
    levelText: `L${facts.drillLevel}`,
    drillScore: String(facts.drillTotal),
    dailyScore: scoreValue(facts.dailyScore),
    scoresLabel: `Level ${facts.drillLevel}: drill total ${facts.drillTotal}, Daily ${scoreWords(facts.dailyScore)}`,
    accountText: account.text,
    accountTitle: account.title,
    accountKind: account.kind,
  };
}

/**
 * The badge's text, and who you are in its accessible name.
 *
 * THE TEXT IS THE IDENTITY AND THE TITLE IS THE STANDING, because a thin row has no space for a sentence and the badge is
 * the control, not the status line. `text` is the player's ALIAS (or "Sign in"), and `title` states whether what the
 * player does is recorded — which is the fact the four standings below have to keep telling apart. An address is never
 * either of them: REPORTED as "Dont expose the email address anywhere on the UI."
 *
 * A SIGNED-IN PLAYER WITH NO NAME IS ITS OWN CASE, and it must not read as "Sign in": they are signed in, and what they
 * are being asked for is a name for the leaderboard, which is where a name is needed. The unnamed state therefore says
 * so and keeps the `ok` ranking, because their runs are recorded either way.
 *
 * THE `dev` CASE IS THE ONE THAT MUST NOT READ AS AN ERROR: a server that names the player by a header IS ranked without an
 * account, and the footer's old sentence ("the server is recording nothing for a signed-out player") was wrong about
 * exactly that case (`net/standing.ts` records the measurement).
 */
function accountBadge(facts: BannerFacts): { text: string; title: string; kind: 'ok' | 'info' } {
  if (facts.playerAlias !== null) {
    return { text: facts.playerAlias, title: `Signed in as ${facts.playerAlias} — runs are ranked`, kind: 'ok' };
  }
  if (facts.standing === 'ranked' && facts.signedIn) {
    return { text: 'Your profile', title: 'Signed in — claim a name for the leaderboard', kind: 'ok' };
  }
  if (facts.standing === 'offline') return { text: 'Sign in', title: 'No server — this device only', kind: 'info' };
  if (facts.standing === 'ranked') return { text: 'Sign in', title: 'Ranked by this server — signing in keeps your progress', kind: 'ok' };
  return { text: 'Sign in', title: 'Not signed in — runs unranked', kind: 'info' };
}

/**
 * A score as the row prints it: the number, or an em dash for "none".
 *
 * THE DASH IS NOT A COSMETIC CHOICE. `0` is a score a player earned — a solved drill can be worth nothing — so printing `0`
 * for "nobody has played this yet" states something false; `—` is the same distinction `puzzle/board-period.ts` makes when it
 * answers null instead of inventing a month. `scoreWords` is what a screen reader hears for the same fact.
 */
function scoreValue(score: number | null): string {
  return score === null ? '—' : String(score);
}

/** The same fact in words, for the group's accessible name. */
function scoreWords(score: number | null): string {
  return score === null ? 'no score' : `best ${score}`;
}
