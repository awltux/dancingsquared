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
  for (const y of ys) {
    const gRow: string[] = [];
    const fRow: string[] = [];
    for (const x of xs) {
      const d = at.get(`${x.toFixed(4)},${y.toFixed(4)}`);
      if (!d) return null;
      const f = faceChar(d.heading);
      if (!f) return null;
      gRow.push(genderChar(d.gender));
      fRow.push(f);
    }
    rows.push(gRow);
    facing.push(fRow.join(''));
  }
  return { rows, facing };
}

/**
 * The 8 symmetries of the square, as transforms of (x, y, heading). `mirrored`
 * marks the four that reflect rather than rotate.
 */
function symmetries(): { apply: (x: number, y: number, h: number) => { x: number; y: number; h: number }; mirrored: boolean }[] {
  const out = [];
  for (const mirror of [false, true]) {
    for (let k = 0; k < 4; k++) {
      out.push({
        mirrored: mirror,
        apply: (x: number, y: number, h: number) => {
          let px = x;
          let py = y;
          let ph = h;
          if (mirror) {
            // reflect across the vertical axis
            px = -px;
            ph = Math.PI - ph;
          }
          for (let i = 0; i < k; i++) {
            // rotate 90 degrees counter-clockwise: (x, y) -> (-y, x)
            [px, py] = [-py, px];
            ph += QUARTER;
          }
          return { x: px, y: py, h: ph };
        },
      });
    }
  }
  return out;
}

const SYMMETRIES = symmetries();

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
    const moved = dancers.map((d) => {
      const p = s.apply(d.x, d.y, d.heading);
      return { ...d, x: p.x, y: p.y, heading: p.h };
    });
    const grid = toGrid(moved);
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
