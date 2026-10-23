// A FORMATION'S IDENTITY, COMPUTED FROM THE BOARD ITSELF — the key a rule can name when the board has no
// name.
//
// WHY THIS EXISTS. A permission rule's `board` is matched against `recognize`'s name, and that namer is a
// CURATED caption: MEASURED, it names **16 of the corpus's 138 eight-dancer formations**. The permissive
// namer behind it (`corpusFormation`) names all 138, exactly and by their own names - but it is not what the
// permission layer reads, and nothing names the 2- and 4-dancer setups an EMBEDDED `<tam>` carries (MEASURED
// over the authoring starts of 15 calls: of 100 boards, 44 are named by `recognize`, 14 more by the exact
// corpus name, and 42 by neither - "Facing Dancers Close", "Right-Hand Wave" and their siblings, which
// `formations.xml` does not carry). A rule that cannot name a board cannot govern it, so this module gives
// every board a NAME-INDEPENDENT identity.
//
// WHAT THE IDENTITY IS. Two boards share an id iff they are the same shape up to rotation and position, to
// `FORMATION_ID_GRID` (0.25 units) and `FORMATION_ID_HEADING_STEP` (22.5 degrees). Within that it is an identity
// and not a best guess: an input of the board's OWN spots and facings, with no library consulted and no scan
// order to tie-break.
//
// WHY 0.25 AND NOT THE 1.0 UNIT THE REPO CALLS ITS MUST-REJECT DIFFERENCE. Quantising rounds, and rounding has
// to break exact ties somewhere - and a rounding rule that breaks a tie the same way under a quarter turn does
// not exist. MEASURED: at a 1.0 grid, **136 of the corpus's 2208 coordinates** sit exactly on its tie boundary
// (`1.5`, `-3.5`, ...) and the id stops being rotation-invariant for the formations that carry them - `Circle`,
// `Alamo Wave`, `H-Beam`, `Diamond Between Kouples` all reported a different id after a quarter turn. At 0.25
// there are **0 ties in the corpus**, so the quantisation is exactly rotation- and translation-equivariant, and
// 0.25 still separates every pair that must stay apart (`Normal Lines` and `Normal Lines Compact` are 0.5
// apart). The band the id tolerates is therefore +/-0.125 units: float residue and the engine's own arithmetic,
// NOT a caller's placement error - a board a caller is standing on slightly wrong is what `recognize`'s ~0.5
// per-dancer slack and its NAME are for, and the name is tried before the id.
//
// THE SAME ARGUMENT APPLIES TO FACINGS, and it cost a measurement to find: the heading step is 22.5 degrees
// (see that constant), because `Circle`'s facings are exact 22.5 multiples that sit ON a 45-degree grid's tie
// boundary - so half of them rounded one way and half the other, and `Circle` and `Alamo Wave` stopped keeping
// their id through a quarter turn.
//
// WHAT THOSE TWO GRIDS DO NOT BUY, stated rather than left to be found. A board that lands EXACTLY on either
// tie boundary - a coordinate at an odd 0.125 offset, a facing at an odd 11.25 degrees - is not rotation-stable,
// because no rounding rule can break a tie the same way under a quarter turn. MEASURED: none of the corpus's
// 2208 coordinates or 1104 facings does, which is why the invariance holds where the engine's boards live; the
// harness pins that count so a corpus edit that introduces one is a red line rather than a silent split.
//
// WHAT IT IGNORES, DELIBERATELY: gender, and every slot of home identity (`couple`, sequence, relationship).
// A formation NAME does not distinguish those either - `Static Square` is one name whatever gender stands on
// which spot, and `Two-Faced Lines RH BGGB Compact` is a spelling of `Two-Faced Lines` - and a rule that did
// distinguish them would be arrangement-specific, where `PermissionRule.going` is already the field for that.
// MEASURED as the design working: `Facing Couples` and `Sashayed Couples` (one geometry, two gender
// arrangements) are one id, and a relabelled home square keeps the home id.
//
// WHAT IT MUST NOT IGNORE: CHIRALITY. A reflection-invariant key collapses 19 pairs of the corpus's 138
// formations into one id - `Diamonds` / `Diamonds LH Girl Points`, `Galaxy Facing LH Box` / `... RH Box`,
// `Thar LH Boys` / `Thar RH Boys` - which are exactly the distinctions names make (`Two-Faced Lines` vs
// `Two-Faced Lines LH`). And it must not ignore SPACING: a topology-only key collapses `Normal Lines` with
// `Normal Lines Compact`, `Ocean Waves` with `Ocean Waves RH BGGB Compact`, `Two-Faced Lines` with
// `Two-Faced Lines RH Compact`. Both are pinned by `engine/test/formation-id.mjs` sections 5 and 6, each as
// the negative control for the property beside it.
//
// WHY THE ID IS A DIGEST RATHER THAN A LETTER CODE. All8's formation letters (`S L W F L.F B P`) are the
// FORMATION slot of a FASR code and look like the natural vocabulary for this - but they are Callerlab/All8's
// names for the states their 16-state table uses, they cover 10 engine formation names, and the corpus does
// not decompose into them (`Diamonds`, `Galaxy`, `Blocks`, `Butterfly`, `Hourglass`, `Thar`, `Alamo`, `3/4
// Tag` are none of the seven). A four-letter extension of that slot would LOOK like an All8 code and would
// not be one, which is the "two conventions in one tree" trap. So the letters stay where the oracle is (the
// panel displays the All8 code beside this id when the board has one), and the id is a pure function of the
// geometry: the canonical serialisation below, digested to FIVE base-26 letters behind a scheme version.
//
// FIVE AND NOT FOUR: 26^4 is 456,976 and 26^5 is 11.9M. MEASURED over 243 sampled boards (the 138 formations
// plus the authoring starts of 20 calls) there are 169 distinct shapes and ZERO collisions at four, five and
// six letters - but a collision is a SILENT wrong rule match, so four letters carries roughly 3% risk at that
// population and five roughly 0.1%. The harness pins zero collisions over the corpus; five is the insurance.
//
// THE VERSION PREFIX IS NOT DECORATION: ids are persisted in `PERMISSION_RULES`, so a change to the
// quantisation or the canonicalisation must produce a string that cannot be mistaken for an old one.

import type { Board } from './types.js';

/** The scheme marker every id starts with. Bump it when the canonicalisation or the quantisation changes. */
export const FORMATION_ID_VERSION = 'F1-';

/**
 * Positions are quantised to this many units. A QUARTER of the 1.0-unit must-reject difference, because the
 * quantisation has to be exactly rotation-equivariant to keep the id rotation-invariant: see the header for
 * the 136 corpus coordinates that sit on a 1.0 grid's tie boundary, and the 0 that sit on this one's.
 */
export const FORMATION_ID_GRID = 0.25;

/**
 * Headings are quantised to this step — 22.5 degrees, the smallest facing difference the corpus's formations
 * actually use (`Circle`'s eight dancers face along the arc, not the axes). NOT 45: MEASURED, `Circle`'s facings
 * are exact 22.5 multiples, which sit ON a 45-degree grid's tie boundary, so half of them rounded one way and
 * half the other and the id stopped surviving a quarter turn.
 */
export const FORMATION_ID_HEADING_STEP = Math.PI / 8;

/** Facing steps in a full turn, so a heading is an integer in [0, STEPS). */
const STEPS = 16;

/**
 * THE CANONICAL SERIALISATION the digest is taken over — exported so the harness can pin the thing the id
 * is a function of, rather than only the digest, and so a person can diff two boards by it.
 *
 * The order of the operations is the correctness: quantise FIRST (so the four rotations compare exactly
 * rather than within a tolerance), then for each quarter-turn translate the set to its own origin, serialise
 * every dancer as `x,y,headingStep` and SORT, and keep the lexicographically smallest of the four strings.
 * That drops the dancer array's order, the board's position and its rotation all at once.
 *
 * IT IS NOT SORTED BY DANCER IDENTITY and cannot be: the serialisation has to be a function of the geometry
 * alone, and a board's dancers are the same shapes in whatever order they arrived in.
 */
export function formationCanonical(board: Board): string {
  const step = (h: number): number => {
    const k = Math.round(h / FORMATION_ID_HEADING_STEP) % STEPS;
    return (k + STEPS) % STEPS;
  };
  const q = (v: number): number => Math.round(v / FORMATION_ID_GRID);
  const spots = board.dancers.map((d) => ({ x: q(d.x), y: q(d.y), h: step(d.heading) }));
  let best: string | null = null;
  for (let turn = 0; turn < 4; turn++) {
    const turned = spots.map(({ x, y, h }) => {
      let X = x;
      let Y = y;
      for (let i = 0; i < turn; i++) { const nx = -Y; const ny = X; X = nx; Y = ny; }
      return { x: X, y: Y, h: (h + turn * (STEPS / 4)) % STEPS };
    });
    const minX = Math.min(...turned.map((p) => p.x));
    const minY = Math.min(...turned.map((p) => p.y));
    const key = turned.map((p) => `${p.x - minX},${p.y - minY},${p.h}`).sort().join('|');
    if (best === null || key < best) best = key;
  }
  // THE DANCER COUNT IS PART OF THE KEY, so a four-dancer corner and an eight-dancer set cannot collide by
  // carrying the same handful of spots.
  return `${spots.length}|${best ?? ''}`;
}

/** FNV-1a, 32 bit. The digest is only ever compared with itself, so a simple stable hash is the requirement. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Five base-26 letters, so an id is one word of uppercase with no case-folding ambiguity. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_WIDTH = 5;
const ID_SPACE = 26 ** ID_WIDTH;

/**
 * The board's formation id: `F1-` and five letters.
 *
 * GHOSTS ARE PART OF THE SHAPE. A phantom occupies a spot the set's dancers are avoiding, so a board with
 * one is a different formation - the same rule `sameBoardById` states ("Ghost dancers ARE compared, like any
 * other dancer: a phantom is part of the formation the engine matched").
 */
export function formationId(board: Board): string {
  let v = fnv1a(formationCanonical(board)) % ID_SPACE;
  let out = '';
  for (let i = 0; i < ID_WIDTH; i++) {
    out = LETTERS[v % 26] + out;
    v = Math.floor(v / 26);
  }
  return FORMATION_ID_VERSION + out;
}

/** Whether a string is a formation id this module produced. An id and a name are both strings, so the two need
 *  telling apart at any boundary that accepts either. */
export function isFormationId(s: string): boolean {
  return new RegExp(`^${FORMATION_ID_VERSION}[A-Z]{${ID_WIDTH}}$`).test(s);
}
