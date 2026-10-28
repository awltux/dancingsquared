// THE THIN BANNER'S CELLS, AS A PURE FUNCTION OF THE FACTS THE SHELL ALREADY HOLDS.
//
// REPORTED: "All pages have a thin banner containing current hints icons, login status, current score for drills and daily,
// a back button." The back button and the regime line are the router's (`ui/pages.ts` and `main.ts`'s `paintChrome`); this
// module is the other four, because each is a SENTENCE about a number and the sentence is the part that can be wrong in
// ways a screenshot does not show: "not ranked" when the server is simply absent, a score of 0 printed where there is no
// score at all, a hint meter that counts to four.
//
// WHY IT IS ITS OWN MODULE (AGENTS.md §4.3, §11.4.5). The app layer that owns the DOM is the one layer no probe can load,
// and this is exactly the rule that rots there: `theme-probe` and `shell-controls-probe` can see a token or an id, and
// neither can see that a signed-out player is being told they are ranked. `game/test/banner-probe.mjs` drives every
// combination of the facts below, including the two that are easy to get wrong — a header-identified player (`dev`, ranked
// without an account) and a score that is absent rather than zero.
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
  /** The meter: filled for what is held, three slots. The whole cell is `aria-hidden`, because the footer states it. */
  readonly pips: string;
  /** The count beside the meter, short enough for a thin row. */
  readonly hintsLabel: string;
  readonly standingText: string;
  /** How the standing sentence reads: a rank is `ok`, the absence of one is neutral. */
  readonly standingKind: 'ok' | 'info';
  readonly drillText: string;
  readonly dailyText: string;
}

/** Three slots is the meter's width, matching the footer's pips before they moved here (`DESIGN.md` §10). */
const METER = 3;

/**
 * The four cells, from the facts.
 *
 * EACH SENTENCE IS CHOSEN SO THAT A ZERO AND AN ABSENCE CANNOT BE CONFUSED: a Daily nobody has played says so in words
 * rather than "0", which is a score a player could believe they had earned — the same distinction `puzzle/board-period.ts`
 * makes when it answers null instead of inventing a month.
 *
 * THE PIPS ARE THE ICONS THE REPORT ASKED FOR, and the words beside them are the same fact: the meter alone would be
 * unreadable for a colour-blind player and silent to a screen reader, which is the rule the footer's balance already
 * followed before the meter moved here. The COUNT IN WORDS LIVES IN THE FOOTER (`#balance`, which also says how many
 * successes the next hint needs) — one sentence in one place, and the banner carries the icons.
 */
export function bannerView(facts: BannerFacts): BannerView {
  const held = Math.max(0, facts.hintsHeld);
  const filled = Math.min(METER, held);
  const pips = '●'.repeat(filled) + '○'.repeat(METER - filled);
  const standing = standingCell(facts);
  return {
    pips,
    hintsLabel: `${held}/${METER}`,
    standingText: standing.text,
    standingKind: standing.kind,
    drillText: scoreCell(`L${facts.drillLevel}`, facts.drillBest),
    dailyText: scoreCell('Daily', facts.dailyScore),
  };
}

/**
 * Who you are, and whether what you do is recorded.
 *
 * THE SESSION COMES FIRST AND THE STANDING SECOND, because they answer different questions: the email is "which player is
 * this" and the standing is "will the server record what I do". The one combination that must not read as an error is
 * `dev` with no session — a server that names the player by a header IS ranked without an account, and the footer's old
 * sentence ("the server is recording nothing for a signed-out player") was wrong about exactly that case (`net/standing.ts`
 * records the measurement).
 */
function standingCell(facts: BannerFacts): { text: string; kind: 'ok' | 'info' } {
  if (facts.playerEmail !== null) return { text: `Signed in as ${facts.playerEmail}`, kind: 'ok' };
  if (facts.standing === 'offline') return { text: 'No server — this device only', kind: 'info' };
  if (facts.standing === 'ranked') return { text: 'Ranked by this server', kind: 'ok' };
  return { text: 'Not signed in — runs unranked', kind: 'info' };
}

/** A score, or that there is not one. Never `0` for "none": that is a score a player could believe they had. */
function scoreCell(label: string, score: number | null): string {
  return score === null ? `${label} no score` : `${label} ${score}`;
}
