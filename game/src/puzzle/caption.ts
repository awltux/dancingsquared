// THE WORDS OVER A BOARD, AND THE PROVENANCE BEHIND THEM.
//
// TWO FACTS PER CAPTION, AND THEY ARE ABOUT DIFFERENT BOARDS. The words describe the WAYPOINT the panel is showing —
// its position in the route and the corpus's name for it, which is what the player reads. The hover text describes the
// BOARD THE PANEL IS ACTUALLY DRAWING, and that is not always the waypoint: on the live pair the left panel is the
// player's own board (`main.ts`'s `currentPair`), and a Daily lets them leave the route, so the two can be different
// arrangements. A hover that described the waypoint would name a picture that is not on screen.
//
// THE HOVER IS THE SETUP ID (`S1-…`), NOT THE NAME. REPORTED: "Sometimes the couple colouring isnt what I'd expect for
// the setup name, so I wanted a way to identify the source XML element so I can verify where it's coming from." A name
// cannot answer that, twice over: `recognize`/`corpusFormation` collapse the EIGHT SYMMETRIES (so a rotation and its
// reflection share a caption), and both ignore the ARRAY ORDER — which is exactly what the colouring reads, because
// `packages/stage`'s `displayCouple` colours a board the engine cannot stamp by INDEX PAIR. `setupId` is the one scheme
// that keeps the order (`setup-id.ts`: "which two dancers are couple 1", the pair "the displayed colour read off the
// array"), and `scripts/tag-formations.mjs` writes every definition's own sid into the corpus, so the id can be pasted
// straight into `git grep 'sid="S1-…"' assets/` to name the element(s) the setup came from — or read in one step out of
// `assets/formation-tag-provenance.json`, which maps each minted tag to `<file> - <name>`. MEASURED by
// `caption-probe.mjs`: one squared set relisted by one place keeps its name and its arrangement and gets a different
// `S1-` id, which is the case that made this diagnostic worth having, and an empty board gets no hover rather than the
// word "null".
//
// THE SEPARATOR AND THE WORDING ARE THE SCREEN'S, NOT THIS MODULE'S INVENTION: they were written inline in `main.ts` and
// are moved here verbatim, because a caption whose format lives only in the screen has no gate (AGENTS.md trap 27). The
// em dash is deliberate and the probe pins it byte for byte.

// THE ID COMES FROM THE ENGINE'S `ids` ENTRY, NOT ITS WHOLE SURFACE: this module needs one scheme out of it, and the
// other specifier below is a TYPE, erased before any runtime import happens (`engine/src/entries/ids.ts` is the layer
// whose own header names the POC modules that ask it for exactly these three id functions).
import { setupId } from 'dancing-squared-engine/ids';
import type { Board } from 'dancing-squared-engine';

/** What a board's caption says, and what its hover text carries. */
interface BoardCaption {
  /** `Setup, 2 of 4 — Ocean Wave`, or `Setup, 2 of 4` when the corpus has no name for the waypoint. */
  text: string;
  /**
   * The setup id of the board the panel is drawing, or `''` when it has no physical dancers — a tooltip that said
   * "null" would be a defect the developer has to read past, and an absent `title` is the same absence `setupId`'s
   * own refusal is.
   */
  hover: string;
}

/** Everything the caption needs: where in the route, what to call it, and the board under it. */
interface CaptionSpec {
  /** The waypoint's position in the route, 0-based. The caption shows it 1-based, and it is never the board's own. */
  index: number;
  /** The corpus's name for the WAYPOINT, or `''` where it has none. */
  label: string;
  /** The board the panel draws, which the hover text is taken over. */
  board: Board;
}

/** One caption: the words the player reads and the id a developer needs. */
export function boardCaption(spec: CaptionSpec): BoardCaption {
  // ONE LINE, `<count>: <name>` — REPORTED: "Change the dance board title to a 1 liner e.g. "<call_count>: Circle". Use small
  // text, as it's not that important to the game." It read "Setup, 2 of 4 — Ocean Wave", which is a sentence where a
  // signpost belongs, and it wrapped to two lines over a 390 px board. The COUNT is the waypoint's position in the route,
  // 1-based: it is the only count this module is given, and it is the one the paging arrows move. The ROLE ("Setup" /
  // "Waypoint" / "Goal") is gone with the sentence — the live pair's left board is the player's own, which the board itself
  // shows, and the last waypoint's caption is the one over the goal.
  const position = `${spec.index + 1}`;
  return {
    text: spec.label ? `${position}: ${spec.label}` : position,
    hover: setupId(spec.board) ?? '',
  };
}
