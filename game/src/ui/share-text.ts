// THE RESULT, AS A LINE A PLAYER CAN PASTE — Wordle's trick, without the tracker.
//
// WHY. REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The strongest retention
// mechanic in the daily-puzzle genre is the SHAREABLE RESULT: a short line of squares a player pastes into a group chat,
// which advertises the game to exactly the people who already play it. It is also the cheapest: no network, no image, no
// analytics — one string the clipboard takes.
//
// WHAT IT SAYS AND WHAT IT DELIBERATELY DOES NOT. Stars, the score, the time, and the day a Daily was played. It does NOT
// carry the player's line, the seed, the puzzle's identity or their name: a paste is public, and the call list would spoil
// the drill for whoever follows the link. The day is only included for a Daily, because a drill is not a date.
//
// A REFUSAL IS A VALUE. `shareText` returns `null` for a run that was not scored (no stars), so a caller cannot accidentally
// publish "0 of 3" — a shared line says a run HAPPENED.
//
// PURE AND PROBED. No clipboard, no DOM: `ui/drill-screen.ts` owns the button, this module owns the words, and
// `game/test/share-text-probe.mjs` pins the exact string for each shape.

/** What a share line needs from a finished run. */
export interface ShareParts {
  /** 1–3, the rank the result card gave the run. A run with no rank has nothing to share. */
  stars: number;
  score: number;
  /** Time on the clock, including the hint charge — the number the player was judged on. */
  elapsedSeconds: number;
  /** The server's `YYYY-MM-DD` for a Daily, or null for a drill. */
  day: string | null;
}

/** The three glyphs: filled for the stars earned, hollow for the rest. */
const STARS = '★';
const HOLLOW = '☆';

/**
 * The line, or `null` when there is nothing to share.
 *
 * THE TIME IS ONE DECIMAL UNDER TEN SECONDS and whole seconds above it, the same rule the card uses, so a paste and the
 * screen cannot disagree about a run's time.
 */
export function shareText(parts: ShareParts): string | null {
  const stars = Math.max(0, Math.min(3, Math.floor(parts.stars)));
  if (stars === 0) return null;
  const time = parts.elapsedSeconds < 10 ? `${parts.elapsedSeconds.toFixed(1)}s` : `${Math.round(parts.elapsedSeconds)}s`;
  const head = `Dancing Squared ${STARS.repeat(stars)}${HOLLOW.repeat(3 - stars)}`;
  const tail = parts.day ? ` · Daily ${parts.day}` : '';
  return `${head} · ${parts.score} pts · ${time}${tail}`;
}
