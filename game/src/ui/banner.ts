// THE THIN BANNER'S CELLS, AS A PURE FUNCTION OF THE FACTS THE SHELL ALREADY HOLDS.
//
// REPORTED: "All pages have a thin banner containing current hints icons, login status, current score for drills and daily,
// a back button." The back button and the regime line are the router's (`ui/pages.ts` and `main.ts`'s `paintChrome`); this
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
  /** The signed-in player's email, or null when nobody is signed in. */
  readonly playerEmail: string | null;
  /** What the server will do with a run, from `standingOf` — the one rule that decides it. */
  readonly standing: Standing;
  /** The level the player is on, for the Drill score's label. */
  readonly drillLevel: number;
  /** This level's best Drill score on this device, or null when there is none. */
  readonly drillBest: number | null;
  /** Today's Daily score on this device, or null when none was recorded. */
  readonly dailyScore: number | null;
}

/** What the banner shows, one field per cell. */
export interface BannerView {
  /** The meter: filled for what is held, three slots. */
  readonly pips: string;
  /** The count beside the meter, short enough for a thin row. It is the meter in words, not a second copy of it. */
  readonly hintsLabel: string;
  /** The account badge's own text: an email when somebody is signed in, "Sign in" when nobody is. */
  readonly accountText: string;
  /**
   * The badge's accessible name, which carries the ranking as well as the identity — the fact the paragraph this button
   * replaced used to state, and the reason the four standings still have four distinct sentences.
   */
  readonly accountTitle: string;
  /** How the badge reads: a rank is `ok` and an absence of one is neutral. */
  readonly accountKind: 'ok' | 'info';
  readonly drillText: string;
  readonly dailyText: string;
}

/** Three slots is the meter's width, matching the pips the footer carried before they moved here (`DESIGN.md` §10). */
const METER = 3;

/**
 * The four cells, from the facts.
 *
 * EACH SENTENCE IS CHOSEN SO THAT A ZERO AND AN ABSENCE CANNOT BE CONFUSED: a Daily nobody has played says "no score"
 * rather than "0", which is a score a player could believe they had earned — the same distinction `puzzle/board-period.ts`
 * makes when it answers null instead of inventing a month.
 *
 * THE PIPS ARE THE ICONS THE REPORT ASKED FOR and the count beside them is the same fact in words: the meter alone would be
 * unreadable for a colour-vision difference and silent to a screen reader. The LONGER sentence (how many successes the next
 * hint needs, and whose balance it is) lives on the Setup page with the rest of the device's bookkeeping — the report that
 * asked for the icons also asked for the debug-style text to leave the play screens.
 */
export function bannerView(facts: BannerFacts): BannerView {
  const held = Math.max(0, facts.hintsHeld);
  const filled = Math.min(METER, held);
  const pips = '●'.repeat(filled) + '○'.repeat(METER - filled);
  const account = accountBadge(facts);
  return {
    pips,
    hintsLabel: `Hints ${held}/${METER}`,
    accountText: account.text,
    accountTitle: account.title,
    accountKind: account.kind,
    drillText: scoreCell(`L${facts.drillLevel}`, facts.drillBest),
    dailyText: scoreCell('Daily', facts.dailyScore),
  };
}

/**
 * The badge's text, and who you are in its accessible name.
 *
 * THE TEXT IS THE IDENTITY AND THE TITLE IS THE STANDING, because a thin row has no space for a sentence and the badge is
 * the control, not the status line. `text` is the email (or "Sign in"), and `title` states whether what the player does is
 * recorded — which is the fact the four standings below have to keep telling apart.
 *
 * THE `dev` CASE IS THE ONE THAT MUST NOT READ AS AN ERROR: a server that names the player by a header IS ranked without an
 * account, and the footer's old sentence ("the server is recording nothing for a signed-out player") was wrong about
 * exactly that case (`net/standing.ts` records the measurement).
 */
function accountBadge(facts: BannerFacts): { text: string; title: string; kind: 'ok' | 'info' } {
  if (facts.playerEmail !== null) {
    return { text: facts.playerEmail, title: `Signed in as ${facts.playerEmail} — runs are ranked`, kind: 'ok' };
  }
  if (facts.standing === 'offline') return { text: 'Sign in', title: 'No server — this device only', kind: 'info' };
  if (facts.standing === 'ranked') return { text: 'Sign in', title: 'Ranked by this server — signing in keeps your progress under an email', kind: 'ok' };
  return { text: 'Sign in', title: 'Not signed in — runs unranked', kind: 'info' };
}

/** A score, or that there is not one. Never `0` for "none": that is a score a player could believe they had. */
function scoreCell(label: string, score: number | null): string {
  return score === null ? `${label} no score` : `${label} ${score}`;
}
