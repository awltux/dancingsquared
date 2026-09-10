// FASR alignment: naming a board's remaining three FASR dimensions.
//
// The engine already names the FORMATION (recognize / matchesNamed). A formation
// alone does not say where the boys and girls are, whose turn it is to be where,
// or which girl a boy is standing next to - and those three are exactly what a
// get-out is indexed by. All8's get-out pages are indexed `[0B1p]`, `[1W2p]`, ...
// rather than by call list, so to consume them the engine must be able to say
// which alignment a board is in.
//
//   ARRANGEMENT  which spots are occupied by boys and which by girls (6 states, 0-5)
//   SEQUENCE     the order of each gender around the formation, C.C.W. (4 states, 1-4)
//   RELATIONSHIP which of the 4 girls is adjacent to a reference boy (4 states, p c o r)
//
// Sources: https://www.all8.com/sd/calling/fasr.htm (definitions),
//          https://www.all8.com/sd/calling/arrngdia.htm (arrangement tables).
//
// ARRANGEMENT IS PER-FORMATION. There is no universal reading rule. All8's
// generic 6-pattern list (BGGB -> 0, ...) is stated for a wave, and in a wave
// arrangement 0 IS `BggB`; but arrangement 0 of Facing Lines is `gBgB`, which the
// same list would call 1. So the classifier matches the board against the
// published per-formation table for the formation it is in, rotating the board
// into that table's drawing frame first.

import type { Board, SeqDancer } from './types.js';
import { HOME_DANCERS } from './identity.js';
import { isKnownCouple } from './constants.js';

/** Callerlab/all8 arrangement number: 0 normal, 5 half-sashayed, 1-4 others. */
export type ArrangementNumber = 0 | 1 | 2 | 3 | 4 | 5;
/** Callerlab sequence state. 1 both in, 2 both out, 3 boys in/girls out, 4 boys out/girls in. */
export type SequenceCode = 1 | 2 | 3 | 4;
/** Callerlab relationship: partner, corner, opposite girl, right-hand girl. */
export type RelationshipCode = 'p' | 'c' | 'o' | 'r';

/**
 * Column order of All8's printed arrangement tables. Each row lists its six
 * gender patterns in this order, NOT in numeric order.
 */
export const ARRANGEMENT_NUMBER_ORDER: readonly ArrangementNumber[] = [0, 5, 1, 2, 3, 4];

/**
 * One row of an arrangement table: the facing of every spot on that row, and the
 * gender of every spot for each arrangement number, in ARRANGEMENT_NUMBER_ORDER.
 * Rows are listed top row first, columns left to right, as All8 prints them.
 */
interface ArrangementTableRow {
  facing: string;
  genders: string[];
}

/**
 * Per-formation arrangement tables, transcribed from
 * https://www.all8.com/sd/calling/arrngdia.htm and cross-checked against
 * engine/test/fixtures/all8-arrangements.json (a machine parse of that page)
 * plus the engine's own templates: every template below classifies as arrangement
 * 0, which is a third, independent agreement.
 *
 * Only the formations the engine has mapped to a template are listed. All8
 * publishes 36; the rest can be added as get-outs for them are taken up.
 */
export const ARRANGEMENT_TABLES: Record<string, ArrangementTableRow[]> = {
  // Box / 8-Chain Thru. Facing rows alternate, so the box pairs are (row1,row2)
  // and (row3,row4) within each column.
  B: [
    { facing: 'vv', genders: ['gB', 'Bg', 'BB', 'gg', 'gB', 'Bg'] },
    { facing: '^^', genders: ['Bg', 'gB', 'gg', 'BB', 'gB', 'Bg'] },
    { facing: 'vv', genders: ['gB', 'Bg', 'gg', 'BB', 'Bg', 'gB'] },
    { facing: '^^', genders: ['Bg', 'gB', 'BB', 'gg', 'Bg', 'gB'] },
  ],
  // Beginning Double Pass Thru: two columns moving one way, two the other.
  P: [
    { facing: 'vv', genders: ['gB', 'Bg', 'BB', 'gg', 'gB', 'Bg'] },
    { facing: 'vv', genders: ['gB', 'Bg', 'gg', 'BB', 'Bg', 'gB'] },
    { facing: '^^', genders: ['Bg', 'gB', 'gg', 'BB', 'gB', 'Bg'] },
    { facing: '^^', genders: ['Bg', 'gB', 'BB', 'gg', 'Bg', 'gB'] },
  ],
  // Facing Lines.
  L: [
    { facing: 'vvvv', genders: ['gBgB', 'BgBg', 'ggBB', 'BBgg', 'BggB', 'gBBg'] },
    { facing: '^^^^', genders: ['BgBg', 'gBgB', 'BBgg', 'ggBB', 'BggB', 'gBBg'] },
  ],
  // Parallel R-H Waves: alternating facing, so the wave runs along the row.
  W: [
    { facing: '^v^v', genders: ['BggB', 'gBBg', 'gBgB', 'BgBg', 'ggBB', 'BBgg'] },
    { facing: '^v^v', genders: ['BggB', 'gBBg', 'BgBg', 'gBgB', 'BBgg', 'ggBB'] },
  ],
  // R-H Two-Faced Lines.
  F: [
    { facing: '^^vv', genders: ['BggB', 'gBBg', 'BBgg', 'ggBB', 'BgBg', 'gBgB'] },
    { facing: '^^vv', genders: ['BggB', 'gBBg', 'ggBB', 'BBgg', 'gBgB', 'BgBg'] },
  ],
  // L-H Two-Faced Lines: [L.F] is All8's handedness marker for the left-hand
  // variant of [F]. Same shape, mirrored facings, and its own arrangement 0.
  'L.F': [
    { facing: 'vv^^', genders: ['gBBg', 'BggB', 'ggBB', 'BBgg', 'BgBg', 'gBgB'] },
    { facing: 'vv^^', genders: ['gBBg', 'BggB', 'BBgg', 'ggBB', 'gBgB', 'BgBg'] },
  ],
};

/**
 * Engine formation name -> All8 formation letter. Step 1
 * (engine/test/all8-formation-map.mjs, fixtures/all8-formation-map.json) mapped
 * every published All8 get-out family to one of the engine's templates; this is
 * that map keyed by the engine's names so a board can be classified from what
 * recognize() already returns.
 *
 * `Two-Faced Lines LH` is mapped to [L.F] directly. Step 1 could not name it
 * separately because getUniqueFormations dedupes congruent shapes INCLUDING
 * reflection, so the left-hand line collapsed into the right-hand one there;
 * recognize() does distinguish them, and the engine template really is the
 * left-hand variant (checked: it classifies as [L.F] arrangement 0).
 */
export const FORMATION_LETTER: Record<string, string> = {
  'Eight Chain Thru': 'B',
  'Double Pass Thru': 'P',
  'Normal Lines': 'L',
  'Normal Lines Compact': 'L',
  'Ocean Waves': 'W',
  'Ocean Waves RH BGGB Compact': 'W',
  'Two-Faced Lines': 'F',
  'Two-Faced Lines RH Compact': 'F',
  'Two-Faced Lines LH': 'L.F',
};

/** All8's formation letter for an engine formation name, or null if unmapped. */
export function letterForFormation(name: string | null): string | null {
  if (!name) return null;
  return FORMATION_LETTER[name] ?? null;
}

const FACE_CHARS = ['>', '^', '<', 'v']; // heading 0, 90, 180, 270 degrees
const QUARTER = Math.PI / 2;
const FACING_EPS = 1e-3;

/**
 * Axis-aligned facing of a heading as All8's table characters, or null when the
 * heading is not a multiple of 90 degrees (a t-bone dancer).
 */
function faceChar(heading: number): string | null {
  const k = Math.round(heading / QUARTER);
  if (Math.abs(heading - k * QUARTER) > FACING_EPS) return null;
  return FACE_CHARS[((k % 4) + 4) % 4];
}

const genderChar = (gender: string) => (gender === 'boy' ? 'B' : gender === 'girl' ? 'g' : '?');

interface Grid {
  rows: string[][]; // gender chars, top row first
  facing: string[]; // facing chars joined per row, top row first
  cells: SeqDancer[][]; // the dancer on each spot, same row/column order
}

/**
 * Project dancers onto their lattice: one row per distinct y (top first), one
 * column per distinct x (left first). Returns null unless the lattice is
 * completely and singly occupied, since a partly occupied grid cannot be read
 * against a full-formation table.
 */
function toGrid(dancers: SeqDancer[]): Grid | null {
  const xs = [...new Set(dancers.map((d) => +d.x.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set(dancers.map((d) => +d.y.toFixed(4)))].sort((a, b) => b - a);
  if (xs.length * ys.length !== dancers.length) return null;
  const at = new Map<string, SeqDancer>();
  for (const d of dancers) {
    const key = `${(+d.x.toFixed(4)).toFixed(4)},${(+d.y.toFixed(4)).toFixed(4)}`;
    if (at.has(key)) return null; // two dancers on one spot
    at.set(key, d);
  }
  const rows: string[][] = [];
  const facing: string[] = [];
  const cells: SeqDancer[][] = [];
  for (const y of ys) {
    const gRow: string[] = [];
    const fRow: string[] = [];
    const cRow: SeqDancer[] = [];
    for (const x of xs) {
      const d = at.get(`${x.toFixed(4)},${y.toFixed(4)}`);
      if (!d) return null;
      const f = faceChar(d.heading);
      if (!f) return null;
      gRow.push(genderChar(d.gender));
      fRow.push(f);
      cRow.push(d);
    }
    rows.push(gRow);
    facing.push(fRow.join(''));
    cells.push(cRow);
  }
  return { rows, facing, cells };
}

/**
 * A symmetry of the square, as a transform of (x, y, heading), plus the reading
 * of a board under it. `mirrored` marks the reflections.
 */
interface Symmetry {
  mirrored: boolean;
  quarterTurns: number;
  apply: (x: number, y: number, h: number) => { x: number; y: number; h: number };
}

function transformOf(mirrored: boolean, quarterTurns: number): Symmetry {
  return {
    mirrored,
    quarterTurns,
    apply: (x: number, y: number, h: number) => {
      let px = x;
      let py = y;
      let ph = h;
      if (mirrored) {
        // reflect across the vertical axis
        px = -px;
        ph = Math.PI - ph;
      }
      for (let i = 0; i < quarterTurns; i++) {
        // rotate 90 degrees counter-clockwise: (x, y) -> (-y, x)
        [px, py] = [-py, px];
        ph += QUARTER;
      }
      return { x: px, y: py, h: ph };
    },
  };
}

/** The 8 symmetries of the square. */
const SYMMETRIES: Symmetry[] = [false, true].flatMap((m) => [0, 1, 2, 3].map((k) => transformOf(m, k)));

/** A board moved by a symmetry and projected onto the table's own row/column lattice. */
function readUnder(dancers: SeqDancer[], s: Symmetry): Grid | null {
  return toGrid(
    dancers.map((d) => {
      const p = s.apply(d.x, d.y, d.heading);
      return { ...d, x: p.x, y: p.y, heading: p.h };
    }),
  );
}

/** The Reading whose FACINGS reproduce the table's layout, or null. */
function readingForLayout(dancers: SeqDancer[], table: ArrangementTableRow[], mirrored: boolean): Grid | null {
  for (const s of SYMMETRIES) {
    if (s.mirrored !== mirrored) continue;
    const grid = readUnder(dancers, s);
    if (!grid || grid.facing.length !== table.length) continue;
    if (grid.facing.every((f, i) => f === table[i].facing)) return grid;
  }
  return null;
}

export interface ArrangementResult {
  /** Arrangement number, or null when the board cannot be read as this formation. */
  number: ArrangementNumber | null;
  letter: string;
  /** Every distinct number the rotational readings produced. More than one means
   * the table is not symmetric under the ambiguity, so no single answer is justified. */
  candidates: ArrangementNumber[];
  /** Numbers that only a REFLECTED reading produces, i.e. the board is the mirror
   * image of this formation's declared handedness. Reported, never returned as the
   * answer - see the note on rotations below. */
  mirroredCandidates?: ArrangementNumber[];
  reason?: string;
}

/**
 * Read a board's arrangement number for a given All8 formation letter.
 *
 * The board is tried under all 4 ROTATIONS, because the engine's templates are
 * not stored in the orientation All8 drew the table in - they are 90 degrees
 * clockwise from it, so a rotation search is what makes the two comparable.
 *
 * Reflections are deliberately NOT accepted, only diagnosed. Mirroring a board is
 * not something dancers can do, and All8 publishes a separate table with mirrored
 * facings for the left-hand variant of a formation ([L.W] alongside [W], [L.F]
 * alongside [F]), so a board that only matches after reflection is not in this
 * letter's formation at all - it is the other-handed one. Accepting reflections
 * would also make the answer wrong rather than merely unhelpful: in [B], [P] and
 * [L] the left-right mirror of arrangement 0 is exactly arrangement 5's pattern,
 * so a reflection reading silently relabels 0 as 5.
 *
 * A symmetry matches when it reproduces the table's facing layout exactly; the
 * genders are then read off and compared with the six patterns. If rotational
 * readings disagree, the result is reported as ambiguous rather than guessed.
 */
export function arrangementFor(board: Board, letter: string): ArrangementResult {
  const table = ARRANGEMENT_TABLES[letter];
  if (!table) return { number: null, letter, candidates: [], reason: `no arrangement table transcribed for [${letter}]` };
  const dancers = board.dancers.filter((d) => !d.isGhost);
  if (dancers.length !== table.length * table[0].facing.length) {
    return { number: null, letter, candidates: [], reason: `formation has ${table.length}x${table[0].facing.length} spots, board has ${dancers.length} dancers` };
  }

  const rotations = new Set<ArrangementNumber>();
  const reflected = new Set<ArrangementNumber>();
  let sawFacingLayout = false;
  let sawFacingLayoutMirrored = false;
  for (const s of SYMMETRIES) {
    const grid = readUnder(dancers, s);
    if (!grid) continue;
    if (grid.facing.length !== table.length) continue;
    if (!grid.facing.every((f, i) => f === table[i].facing)) continue;
    if (s.mirrored) sawFacingLayoutMirrored = true;
    else sawFacingLayout = true;
    for (const n of ARRANGEMENT_NUMBER_ORDER) {
      const k = ARRANGEMENT_NUMBER_ORDER.indexOf(n);
      const matches = table.every((row, i) => grid.rows[i].join('') === row.genders[k]);
      if (!matches) continue;
      (s.mirrored ? reflected : rotations).add(n);
    }
  }

  const candidates = [...rotations].sort((a, b) => a - b);
  const mirroredCandidates = [...reflected].sort((a, b) => a - b).filter((n) => !rotations.has(n));
  if (candidates.length === 1) return { number: candidates[0], letter, candidates, mirroredCandidates };
  if (candidates.length === 0) {
    const layouts = table.map((r) => r.facing).join('/');
    return {
      number: null,
      letter,
      candidates,
      mirroredCandidates,
      reason: mirroredCandidates.length
        ? `board matches [${letter}] only as a REFLECTION (would read ${mirroredCandidates.join(', ')}), so its handedness is the mirror of this table - it belongs to the other-hand letter`
        : sawFacingLayout
          ? 'facing layout matches the table but no arrangement pattern does (genders disagree with all 6)'
          : sawFacingLayoutMirrored
            ? `no rotation of this board reproduces [${letter}]'s facing layout (${layouts}); only a reflection does`
            : `no rotation of this board reproduces [${letter}]'s facing layout (${layouts})`,
    };
  }
  return { number: null, letter, candidates, mirroredCandidates, reason: `ambiguous: rotational readings disagree (${candidates.join(', ')})` };
}

export interface SequenceResult {
  /** 1 both in, 2 both out, 3 boys in/girls out, 4 boys out/girls in; null if not classifiable. */
  code: SequenceCode | null;
  boys: number[] | null; // couple numbers in C.C.W. order, turned to start at couple 1
  girls: number[] | null;
  boysState: 'in' | 'out' | 'asymmetric' | 'unknown';
  girlsState: 'in' | 'out' | 'asymmetric' | 'unknown';
  reason?: string;
}

const isKnownSet = (couples: number[]) =>
  couples.length === 4 && [1, 2, 3, 4].every((c) => couples.includes(c));

/** Turn a cyclic couple order so it starts at couple 1, as All8's rule requires. */
function fromNumberOne(order: number[]): number[] {
  const i = order.indexOf(1);
  return i < 0 ? order : [...order.slice(i), ...order.slice(0, i)];
}

/**
 * Classify a board's sequence state.
 *
 * Callerlab/all8 rule: move around the formation in promenade direction
 * (counter-clockwise), starting with the #1 boy. Encountering the boys as
 * 1,2,3,4 means the boys are in sequence; 1,4,3,2 means out of sequence; any
 * other order is asymmetric. The same reading is taken for the girls, starting
 * with the #1 girl. The two states combine into one code.
 *
 * Order is taken by angle about the formation's centre, which yields the
 * non-self-intersecting cycle All8 describes for a star-shaped formation.
 */
export function sequenceFor(board: Board): SequenceResult {
  const unknown = (reason: string): SequenceResult =>
    ({ code: null, boys: null, girls: null, boysState: 'unknown', girlsState: 'unknown', reason });
  const dancers = board.dancers.filter((d) => !d.isGhost);
  const boys = dancers.filter((d) => d.gender === 'boy');
  const girls = dancers.filter((d) => d.gender === 'girl');
  if (boys.length !== 4 || girls.length !== 4) {
    return unknown(`need 4 boys and 4 girls, board has ${boys.length} and ${girls.length}`);
  }
  if (!isKnownSet(boys.map((d) => d.couple)) || !isKnownSet(girls.map((d) => d.couple))) {
    return unknown('dancers do not carry a full set of 4 known home couples (identity missing)');
  }
  const cx = dancers.reduce((s, d) => s + d.x, 0) / dancers.length;
  const cy = dancers.reduce((s, d) => s + d.y, 0) / dancers.length;
  const cycle = (list: SeqDancer[], gender: 'boy' | 'girl') => {
    const sorted = [...list].sort(
      (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    );
    return { order: fromNumberOne(sorted.map((d) => d.couple)), gender };
  };
  const b = cycle(boys, 'boy');
  const g = cycle(girls, 'girl');
  const stateOf = (order: number[]) => {
    const s = order.join();
    return s === '1,2,3,4' ? 'in' : s === '1,4,3,2' ? 'out' : 'asymmetric';
  };
  const boysState = stateOf(b.order) as SequenceResult['boysState'];
  const girlsState = stateOf(g.order) as SequenceResult['girlsState'];
  const base = { boys: b.order, girls: g.order, boysState, girlsState };
  if (boysState === 'in' && girlsState === 'in') return { code: 1, ...base };
  if (boysState === 'out' && girlsState === 'out') return { code: 2, ...base };
  if (boysState === 'in' && girlsState === 'out') return { code: 3, ...base };
  if (boysState === 'out' && girlsState === 'in') return { code: 4, ...base };
  return {
    code: null,
    ...base,
    reason: `sequence is asymmetric (boys ${b.order.join('')} ${boysState}, girls ${g.order.join('')} ${girlsState})`,
  };
}

/**
 * The home couples in promenade (counter-clockwise) order, derived from the home
 * square rather than assumed: [1, 2, 3, 4]. Every relationship below is an offset
 * in this cycle.
 */
export const HOME_RING_ORDER: readonly number[] = (() => {
  const boys = HOME_DANCERS.filter((d) => d.gender === 'boy');
  return boys
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map((d) => d.couple);
})();

/**
 * Which of the 4 girls a boy of couple `boyCouple` is related to, given the
 * couple of the girl he is paired with.
 *
 * The four relationships are the four girls in cyclic order around him, so the
 * letter is the offset between the girl's couple and his own in the promenade
 * cycle:
 *
 *   +0  p  partner            (his own couple)
 *   +1  r  right-hand girl    (the next couple counter-clockwise = on his right)
 *   +2  o  opposite girl      (across the square)
 *   +3  c  corner             (the previous couple = on his left)
 *
 * Checked against the home square: the #1 boy stands south facing the centre
 * with his partner on his right hand (All8's own worked example), the girl of
 * couple 2 on his right and the girl of couple 4 on his left, so the girl on his
 * left - his corner - is the couple he came from in the cycle, +3.
 */
export function relationshipCode(boyCouple: number, girlCouple: number): RelationshipCode {
  const offset = (((girlCouple - boyCouple) % 4) + 4) % 4;
  return (['p', 'r', 'o', 'c'] as const)[offset];
}

/**
 * All8's reference pair rules, verbatim. Callerlab has agreed a reference pair
 * for these four formations only, and only in standard arrangement; for anything
 * else relationship is not defined and must not be reported as if it were.
 * ("It is somewhat arbitrary which dancers we choose for the reference pair and
 * it unfortunately makes a definite difference, affecting which letter (p, c, o,
 * r) gets assigned.")
 */
export const REFERENCE_PAIR_RULES: Record<string, string> = {
  L: 'Facing Lines [0L] ... The Left-hand couple',
  B: 'Box / 8 Chain Thru [0B] ... Outside boy and dancer (girl) he is facing',
  F: 'R-H 2 Face Lines [0F] ... The trailing couple',
  W: 'Parallel R-H Waves [0W] ... The in facing end (boy) and adjacent dancer (girl)',
};

export interface Alignment {
  formation: string | null;
  letter: string | null;
  arrangement: ArrangementNumber | null;
  arrangementResult: ArrangementResult | null;
  sequence: SequenceCode | null;
  sequenceResult: SequenceResult;
  relationship: RelationshipCode | null;
  relationshipReason?: string;
  /** All8-style notation, e.g. "[0B1p]". */
  notation: string;
}

/**
 * Classify a board's full alignment.
 *
 * `referenceBoy` / `referenceGirl` are dancer IDs forming the reference pair.
 * Relationship is reported only when they are supplied: picking the reference
 * pair is a per-formation convention (REFERENCE_PAIR_RULES) that needs a board
 * whose identities are known, and All8 defines it for four formations only, so
 * this deliberately does not guess.
 */
export function alignmentOf(
  board: Board,
  formationName: string | null,
  opts: { referenceBoy?: number; referenceGirl?: number } = {},
): Alignment {
  const letter = letterForFormation(formationName);
  const arrangementResult = letter ? arrangementFor(board, letter) : null;
  const sequenceResult = sequenceFor(board);
  let relationship: RelationshipCode | null = null;
  let relationshipReason: string | undefined;
  if (!letter) {
    relationshipReason = 'formation is not mapped to an All8 letter';
  } else if (!REFERENCE_PAIR_RULES[letter]) {
    relationshipReason = `Callerlab defines relationship for [L], [B], [F] and [W] only; [${letter}] has no agreed reference pair`;
  } else if (opts.referenceBoy === undefined || opts.referenceGirl === undefined) {
    relationshipReason = 'no reference pair supplied';
  } else {
    const boy = board.dancers.find((d) => d.id === opts.referenceBoy);
    const girl = board.dancers.find((d) => d.id === opts.referenceGirl);
    if (!boy || !girl) relationshipReason = 'reference pair not on the board';
    else if (!isKnownCouple(boy.couple) || !isKnownCouple(girl.couple)) relationshipReason = 'reference pair has no home couple (identity missing)';
    else relationship = relationshipCode(boy.couple, girl.couple);
  }
  const notation = `[${arrangementResult?.number ?? '?'}${letter ?? '?'}${sequenceResult.code ?? '?'}${relationship ?? '?'}]`;
  return {
    formation: formationName,
    letter,
    arrangement: arrangementResult?.number ?? null,
    arrangementResult,
    sequence: sequenceResult.code,
    sequenceResult,
    relationship,
    relationshipReason,
    notation,
  };
}

// =====================================================================
// Part 2: the same three dimensions in reverse - building a board in a
// named alignment, and reading the relationship state off a whole board.
// =====================================================================

/** Engine formation templates that realise each All8 letter, best first. */
export const FORMATIONS_FOR_LETTER: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [name, letter] of Object.entries(FORMATION_LETTER)) (out[letter] ??= []).push(name);
  return out;
})();

/**
 * Split an All8 alignment id into its four parts. The arrangement is optional and
 * defaults to 0 (All8's own rule: an omitted arrangement means standard), and
 * sequence/relationship may be absent, as in `[0B]`.
 *
 *   'B1c'    -> { letter: 'B',    arrangement: 0, sequence: 1, relationship: 'c' }
 *   '5L2p'   -> { letter: 'L',    arrangement: 5, sequence: 2, relationship: 'p' }
 *   '1W1p'   -> { letter: 'W',    arrangement: 1, sequence: 1, relationship: 'p' }
 *   'L.F1p'  -> { letter: 'L.F',  arrangement: 0, sequence: 1, relationship: 'p' }
 */
export function parseAlignmentId(id: string): AlignmentSpec | null {
  const m = /^([0-5]?)([A-Za-z]{1,3}(?:\.[A-Za-z]{1,2})?)([1-4]?)([pocr]?)$/.exec(id.trim());
  if (!m) return null;
  return {
    letter: m[2],
    arrangement: (m[1] === '' ? 0 : Number(m[1])) as ArrangementNumber,
    sequence: m[3] === '' ? undefined : (Number(m[3]) as SequenceCode),
    relationship: m[4] === '' ? undefined : (m[4] as RelationshipCode),
  };
}

/** What an alignment id asks for. Sequence and relationship may be left open. */
export interface AlignmentSpec {
  letter: string;
  arrangement: ArrangementNumber;
  sequence?: SequenceCode;
  relationship?: RelationshipCode;
}

export interface PartnerPair {
  boy: number; // dancer id
  girl: number;
  distance: number;
}

export interface BoardLayout {
  /** Facing of every spot, top row first, as All8's table draws it. */
  rows: string[];
  /** The dancer standing on each spot, same row/column order. */
  cells: SeqDancer[][];
  /** The all8 table this reading was taken against. */
  table: ArrangementTableRow[];
}

/**
 * Read a board onto the given formation's own spot table: which dancer is on each
 * spot of All8's drawing.
 *
 * Almost everything in this module needs this one step, because All8 describes a
 * formation positionally ("the outside boy", "the in-facing end", "the left-hand
 * couple") and those words only mean something once the board has been laid onto
 * the table's grid. The rotation used is the one that reproduces the table's facing
 * layout; reflections are not considered, since a mirrored board is a different
 * formation's handedness.
 */
export function readLayout(board: Board, letter: string): BoardLayout | null {
  const table = ARRANGEMENT_TABLES[letter];
  if (!table) return null;
  const grid = readingForLayout(board.dancers.filter((d) => !d.isGhost), table, false);
  return grid ? { rows: grid.facing, cells: grid.cells, table } : null;
}export interface PairingResult {
  pairs: PartnerPair[] | null;
  reason?: string;
}

/**
 * WHICH TWO SPOTS ARE "THE TWO OF THEM", in the formation's own drawing.
 *
 * Relationship is "which of the 4 girls is adjacent to a reference boy", so it
 * needs a notion of adjacency that the formation, not the metric, supplies.
 * Proximity does NOT work and was measured to fail: in Facing Lines the two lines
 * are 4 apart while the dancers beside you in your own line are 2 apart, so
 * "nearest opposite-gender dancer" picks a line-neighbour rather than the couple
 * All8 means; and in the 8-Chain box a boy's facing partner and the dancer behind
 * him are both exactly 1 away, so it is not even well defined.
 *
 * What works is the formation's structure, and it is readable straight off All8's
 * own tables: the two spots of a column pair - columns {2k, 2k+1} of a row, or
 * rows {2k, 2k+1} of a column, depending on how that formation is drawn. This is
 * All8's "couple" for all four formations it defines a reference pair in, and each
 * of its four wordings lands on the same pair: the facing pair in a box ([0B] "the
 * dancer he is facing"), the two dancers side by side in a line ([0L] "the
 * left-hand couple"), the wave-adjacent pair ([0W] "the ... adjacent dancer"), and
 * the pair one behind the other in a two-faced line ([0F] "the trailing couple").
 *
 * The axis differs per formation because All8 draws them differently - a box as two
 * columns of four, a line as a row of four - not because the couples differ in kind.
 *
 * DERIVED, NOT ASSUMED: which axis applies is read from the published get-out
 * diagrams, in which every spot carries its couple number, so the partner of each
 * dancer is stated rather than inferred. Box/8-Chain uses the column pair (verified
 * on 6 alignments, all 6 reproducing the published letter) and Lines, Waves,
 * 2-Face Lines and L-H 2-Face Lines use the row pair (18 alignments, all 18). The
 * column pair is also the only one that is gender-consistent for [B]'s arrangement
 * 0 in a way that reproduces those letters; for [L] [W] [F] and [L.F] the row pair
 * is the one the diagrams state.
 */
export const ADJACENT_PAIR: Record<string, (r: number, c: number) => [number, number]> = {
  // Box / 8-Chain: a couple is the facing pair, drawn as the two rows of a column.
  B: (r, c) => [r % 2 === 0 ? r + 1 : r - 1, c],
  // Everything else: the pair is side by side along the line, drawn as two
  // neighbouring columns of a row.
  P: (r, c) => [r, c % 2 === 0 ? c + 1 : c - 1],
  L: (r, c) => [r, c % 2 === 0 ? c + 1 : c - 1],
  W: (r, c) => [r, c % 2 === 0 ? c + 1 : c - 1],
  F: (r, c) => [r, c % 2 === 0 ? c + 1 : c - 1],
  'L.F': (r, c) => [r, c % 2 === 0 ? c + 1 : c - 1],
};

/**
 * The reference pair's two SPOTS in the table frame, for the formations where it
 * could be pinned against published letters.
 *
 * All8 states the reference pair for [0L], [0B], [0F] and [0W] in words ("the
 * outside boy", "the left-hand couple", ...) but the words only resolve to a place
 * once you know which end or side of the drawing each refers to. Rather than guess,
 * this was solved against the corpus: for each formation, the spot whose boy (with
 * his adjacent girl) reproduces the PUBLISHED relationship letter for every
 * alignment is the reference.
 *
 * Only two formations have corpus alignments that can discriminate (the rest are
 * all `p`, where any pair agrees):
 *   [B] the pair at (row 2, col 0) and (row 3, col 0) reproduces all 6 of
 *       B1c B2r B4c B3r B1p B2p
 *   [L] the pair at (row 0, col 2) and (row 0, col 3) reproduces all 6 of
 *       L1p L2p L4r L3c 5L1p 5L2p
 * In both cases it is the only place that does, so the convention is pinned by the
 * data rather than chosen.
 *
 * Both spots are recorded, not just the one the boy stood on in those diagrams,
 * because a call can move a dancer within his own pair: after a Pass Thru the boy
 * and girl of the reference couple have exchanged spots. The reference is the pair,
 * and its boy is whichever of the two dancers is the boy.
 *
 * For [W] and [F] no published alignment discriminates, so nothing is recorded and
 * only unanimous states are reported. [P] is absent for a reason: no place works
 * there at all, because Beginning Double Pass Thru genuinely mixes side-by-side
 * couples with facing ones - which is precisely why All8 agreed a reference pair
 * for four formations and not for this one.
 */
export const REFERENCE_PAIR_SPOTS: Record<string, [number, number][]> = {
  B: [[2, 0], [3, 0]],
  L: [[0, 2], [0, 3]],
};

/** One boy-girl adjacent pair, with the relationship letter it implies. */
export interface AdjacentPairResult {
  boy: number;
  girl: number;
  boySpot: [number, number];
  girlSpot: [number, number];
  boyCouple: number;
  girlCouple: number;
  letter: RelationshipCode | null;
}

/**
 * Pair every boy with the girl in his formation-adjacent spot, using the board read
 * onto the formation's own drawing.
 *
 * This is the whole of "which girl is next to this boy" - no distances involved.
 */
export function adjacentPairs(board: Board, letter: string): { pairs: AdjacentPairResult[] | null; reason?: string } {
  const pairOf = ADJACENT_PAIR[letter];
  if (!pairOf) return { pairs: null, reason: `no adjacent-pair structure recorded for [${letter}]` };
  const layout = readLayout(board, letter);
  if (!layout) return { pairs: null, reason: `this board does not read as [${letter}]` };
  const rows = layout.cells.length;
  const cols = layout.cells[0].length;
  const pairs: AdjacentPairResult[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = layout.cells[r][c];
      if (a.gender !== 'boy') continue;
      const [r2, c2] = pairOf(r, c);
      if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) {
        return { pairs: null, reason: `spot (${r},${c}) has no adjacent spot in [${letter}]'s drawing` };
      }
      const b = layout.cells[r2][c2];
      if (b.gender !== 'girl') {
        return {
          pairs: null,
          reason: `in [${letter}] the spot adjacent to the boy at (${r},${c}) holds a ${b.gender}, so this board is not in a standard arrangement and "the girl next to him" is not defined`,
        };
      }
      const known = isKnownCouple(a.couple) && isKnownCouple(b.couple);
      pairs.push({
        boy: a.id,
        girl: b.id,
        boySpot: [r, c],
        girlSpot: [r2, c2],
        boyCouple: a.couple,
        girlCouple: b.couple,
        letter: known ? relationshipCode(a.couple, b.couple) : null,
      });
    }
  }
  if (pairs.length !== 4) return { pairs: null, reason: `expected 4 boy-girl adjacent pairs in [${letter}], found ${pairs.length}` };
  return { pairs };
}

export interface RelationshipState {
  /** The relationship letter of the board, or null when it cannot be stated. */
  code: RelationshipCode | null;
  /** Every adjacent pair, with the letter each implies. */
  pairs: AdjacentPairResult[];
  /** The pair All8's convention designates, when one is known for this formation. */
  reference?: AdjacentPairResult;
  reason?: string;
}

/**
 * Read a board's relationship state for a formation.
 *
 * In a symmetric state every boy's adjacent girl is in the same relationship, so a
 * unanimous answer is reported directly. Where the boys do not agree - All8's
 * warning that the reference pair "makes a definite difference, affecting which
 * letter gets assigned, especially in sequence states 3 and 4" - the answer comes
 * from the reference pair, which is pinned per formation in REFERENCE_BOY_SPOT.
 * Where no reference pair is known and the boys disagree, this says so and hands
 * back all four letters rather than picking one, because picking arbitrarily is
 * exactly the mistake All8 says the convention exists to prevent.
 */
export function relationshipStateOf(board: Board, letter: string): RelationshipState {
  const a = adjacentPairs(board, letter);
  if (!a.pairs) return { code: null, pairs: [], reason: a.reason };
  const letters = new Set(a.pairs.map((p) => p.letter));
  if (letters.size === 1 && !letters.has(null)) {
    return { code: [...letters][0] as RelationshipCode, pairs: a.pairs };
  }
  const spots = REFERENCE_PAIR_SPOTS[letter];
  if (spots) {
    const isRef = (p: AdjacentPairResult) =>
      spots.some(([r, c]) => p.boySpot[0] === r && p.boySpot[1] === c) &&
      spots.some(([r, c]) => p.girlSpot[0] === r && p.girlSpot[1] === c);
    const reference = a.pairs.find(isRef);
    if (reference?.letter) {
      return { code: reference.letter, pairs: a.pairs, reference };
    }
  }
  const shown = a.pairs.map((p) => p.letter ?? '?').join('');
  return {
    code: null,
    pairs: a.pairs,
    reason: letters.has(null)
      ? 'an adjacent pair has no home couple, so its relationship is undefined'
      : spots
        ? `the boys disagree (${shown}) and the reference pair does not resolve it`
        : `the boys disagree (${shown}) and All8 records no reference pair for [${letter}], so no single letter is justified${letter === 'P' ? ' (Beginning Double Pass Thru mixes side-by-side and facing couples, which is why it is outside the four formations Callerlab defines this for)' : ''}`,
  };
}

export interface ConstructionResult {
  boards: Board[];
  /** How many identity assignments were tried. */
  attempted: number;
  /** Why nothing was produced, when nothing was. */
  reason?: string;
}

/** Every ordering of a small array, in a stable order. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((v, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([v, ...rest]);
  });
  return out;
}

/**
 * Build every board that is in the requested alignment.
 *
 * The construction is the alignment model read backwards. The formation fixes the
 * SPOTS and their facings, which the engine's template supplies - with its real
 * metric, so the board is a board the engine can actually dance from. The
 * arrangement fixes the GENDER on each spot. What is left free is identity: which
 * home couple stands on which spot, and which of the two dancers of a couple takes
 * which spot. Enumerating that - 4! ways to place the boys x 4! for the girls =
 * 576 - and classifying each candidate covers the whole alignment space, so the
 * result is exactly the set of boards in the requested state rather than one guess
 * at it.
 *
 * Boards come back in the template's own coordinates (not All8's drawing frame),
 * because they are meant to be danced from.
 */
export function boardsForAlignment(template: Board, spec: AlignmentSpec): ConstructionResult {
  const table = ARRANGEMENT_TABLES[spec.letter];
  if (!table) return { boards: [], attempted: 0, reason: `no arrangement table transcribed for [${spec.letter}]` };
  const column = ARRANGEMENT_NUMBER_ORDER.indexOf(spec.arrangement);
  if (column < 0) return { boards: [], attempted: 0, reason: `${spec.arrangement} is not one of the 6 arrangement numbers` };
  const dancers = template.dancers.filter((d) => !d.isGhost);
  if (dancers.length !== table.length * table[0].facing.length) {
    return { boards: [], attempted: 0, reason: `[${spec.letter}] has ${table.length * table[0].facing.length} spots but the template has ${dancers.length} dancers` };
  }
  const layout = readingForLayout(dancers, table, false);
  if (!layout) {
    return { boards: [], attempted: 0, reason: `the template's facing layout does not match [${spec.letter}]'s under any rotation, so it is not this formation` };
  }

  // Each template dancer's spot, with the target arrangement's gender. The metric
  // and the facings stay the engine's; only gender is overwritten.
  const byId = new Map(dancers.map((d) => [d.id, d]));
  const spots: { x: number; y: number; heading: number; gender: 'boy' | 'girl' }[] = [];
  layout.cells.forEach((row, r) => {
    row.forEach((transformed, c) => {
      const orig = byId.get(transformed.id) ?? transformed;
      spots.push({
        x: orig.x,
        y: orig.y,
        heading: orig.heading,
        gender: table[r].genders[column][c] === 'B' ? 'boy' : 'girl',
      });
    });
  });
  const boySpots = spots.filter((s) => s.gender === 'boy');
  const girlSpots = spots.filter((s) => s.gender === 'girl');

  const boyIds = HOME_DANCERS.filter((d) => d.gender === 'boy');
  const girlIds = HOME_DANCERS.filter((d) => d.gender === 'girl');
  const boards: Board[] = [];
  let attempted = 0;
  for (const boyOrder of permutations(boyIds)) {
    for (const girlOrder of permutations(girlIds)) {
      attempted++;
      const place = (spotsForGender: typeof spots, order: typeof boyIds) =>
        spotsForGender.map((spot, i) => ({
          id: order[i].id,
          couple: order[i].couple,
          gender: order[i].gender as 'boy' | 'girl',
          x: spot.x,
          y: spot.y,
          heading: spot.heading,
        }));
      const board: Board = { dancers: [...place(boySpots, boyOrder), ...place(girlSpots, girlOrder)] };
      if (arrangementFor(board, spec.letter).number !== spec.arrangement) continue; // genders are fixed by construction; this only guards a mismatched letter
      if (spec.sequence !== undefined && sequenceFor(board).code !== spec.sequence) continue;
      if (spec.relationship !== undefined && relationshipStateOf(board, spec.letter).code !== spec.relationship) continue;
      boards.push(board);
    }
  }
  if (!boards.length) {
    return {
      boards,
      attempted,
      reason: `no identity assignment over ${attempted} puts this board in ${spec.arrangement}${spec.letter}${spec.sequence ?? ''}${spec.relationship ?? ''}`,
    };
  }
  return { boards, attempted };
}

/** The first board in the requested alignment, or null. */
export function boardForAlignment(template: Board, spec: AlignmentSpec): Board | null {
  return boardsForAlignment(template, spec).boards[0] ?? null;
}

const HEADING_BY_CHAR: Record<string, number> = { '>': 0, '^': QUARTER, '<': 2 * QUARTER, v: 3 * QUARTER };

/** Project cells carrying (x, y, facing) onto their lattice, top row first. */
function projectCells<T extends { x: number; y: number; facing: string }>(cells: T[]): { rows: string[]; cells: T[][] } | null {
  const xs = [...new Set(cells.map((c) => +c.x.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((c) => +c.y.toFixed(4)))].sort((a, b) => b - a);
  if (xs.length * ys.length !== cells.length) return null;
  const at = new Map<string, T>();
  for (const c of cells) {
    const key = `${(+c.x.toFixed(4)).toFixed(4)},${(+c.y.toFixed(4)).toFixed(4)}`;
    if (at.has(key)) return null;
    at.set(key, c);
  }
  const rows: string[] = [];
  const out: T[][] = [];
  for (const y of ys) {
    let f = '';
    const row: T[] = [];
    for (const x of xs) {
      const c = at.get(`${x.toFixed(4)},${y.toFixed(4)}`);
      if (!c) return null;
      row.push(c);
      f += c.facing;
    }
    rows.push(f);
    out.push(row);
  }
  return { rows, cells: out };
}

/**
 * Build the board All8's own text diagram describes.
 *
 * All8's get-out pages publish a diagram per alignment in which every spot carries
 * a FACING and a COUPLE NUMBER - so the diagram is a complete board: spot, facing,
 * and which home couple stands there. Gender is not written, but the alignment's
 * arrangement fixes it, so the diagram plus the arrangement determines all eight
 * dancers.
 *
 * The diagram is schematic (a unit lattice, no distances), so it cannot be danced
 * from directly: the engine's call matcher needs the formation's real metric. This
 * therefore takes the SPOTS and FACINGS from the engine's template and only the
 * COUPLE LAYOUT from the diagram, which yields the same board at a metric the
 * engine can dance.
 *
 * The diagram may be drawn rotated relative to the arrangement table - getoutd.htm
 * draws Facing Lines as 4x2 with east/west facings where arrngdia.htm draws it 2x4
 * with north/south ones - so the four rotations are tried and the one reproducing
 * the table's facing layout is used. Reflections are not tried: a mirrored diagram
 * would be the other-handed formation.
 */
export function boardFromDiagram(
  template: Board,
  letter: string,
  arrangement: ArrangementNumber,
  diagram: string,
): { board: Board | null; reason?: string } {
  const table = ARRANGEMENT_TABLES[letter];
  if (!table) return { board: null, reason: `no arrangement table transcribed for [${letter}]` };
  const column = ARRANGEMENT_NUMBER_ORDER.indexOf(arrangement);
  if (column < 0) return { board: null, reason: `${arrangement} is not one of the 6 arrangement numbers` };

  const raw: { x: number; y: number; heading: number; couple: number }[] = [];
  for (const [r, line] of diagram.split('\n').map((l) => l.trim()).filter(Boolean).entries()) {
    for (const [c, tok] of line.split(/\s+/).filter(Boolean).entries()) {
      const m = /^([v^<>])?(\d+)([v^<>])?$/.exec(tok);
      const arrow = m?.[1] ?? m?.[3];
      if (!m || !arrow) return { board: null, reason: `could not read diagram token "${tok}"` };
      raw.push({ x: c, y: -r, heading: HEADING_BY_CHAR[arrow], couple: Number(m[2]) });
    }
  }
  if (raw.length !== table.length * table[0].facing.length) {
    return { board: null, reason: `diagram has ${raw.length} spots, [${letter}] has ${table.length * table[0].facing.length}` };
  }

  let diag: { rows: string[]; cells: typeof raw[] } | null = null;
  for (const s of SYMMETRIES) {
    if (s.mirrored) continue;
    const p = projectCells(raw.map((c) => {
      const t = s.apply(c.x, c.y, c.heading);
      return { x: t.x, y: t.y, heading: t.h, facing: faceChar(t.h) ?? '?', couple: c.couple };
    }));
    if (p && p.rows.length === table.length && p.rows.every((f, i) => f === table[i].facing)) { diag = p; break; }
  }
  if (!diag) return { board: null, reason: `the diagram's facing layout matches [${letter}]'s table under no rotation` };

  const layout = readingForLayout(template.dancers.filter((d) => !d.isGhost), table, false);
  if (!layout) return { board: null, reason: `the template's facing layout does not match [${letter}]'s under any rotation` };
  const byId = new Map(template.dancers.map((d) => [d.id, d]));

  const dancers: SeqDancer[] = [];
  diag.cells.forEach((row, r) => row.forEach((cell, c) => {
    const orig = byId.get(layout.cells[r][c].id) ?? layout.cells[r][c];
    dancers.push({
      id: 0,
      couple: cell.couple,
      gender: table[r].genders[column][c] === 'B' ? 'boy' : 'girl',
      x: orig.x,
      y: orig.y,
      heading: orig.heading,
    });
  }));

  for (const couple of [1, 2, 3, 4]) {
    for (const gender of ['boy', 'girl'] as const) {
      const spot = dancers.find((d) => d.couple === couple && d.gender === gender);
      if (!spot) {
        return {
          board: null,
          reason: `in this arrangement the diagram puts no ${gender} in couple ${couple}, so the dancers cannot map onto home identities (this is the case All8 warns about: the convention is agreed only for standard arrangement)`,
        };
      }
      spot.id = HOME_DANCERS.find((h) => h.couple === couple && h.gender === gender)!.id;
    }
  }
  return { board: { dancers } };
}
