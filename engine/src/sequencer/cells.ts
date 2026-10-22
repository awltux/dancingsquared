// The CELL vocabulary: a board's identity as a CELL of a finite, DECLARED lattice, rather than as a
// point in a continuous geometry space.
//
// WHY THIS EXISTS. The FSM's node set is the thing that either stays bounded or explodes, and the
// measurement that settled the direction is in `buildFsmTable`: adding every end board as a state
// DIVERGES (1840 new geometries at level 1, 3005 states after enumerating 400 and still growing),
// because the end pose of a call is a Bezier evaluated at the end and lands on an arbitrary point.
// What bounds a node set is not reachability - it is DECLARATION. A state exists because we declared
// it, and a board that is not on the lattice is not a state.
//
// THE CELL IS FOUR PARTS, and each is read off the board by machinery that already exists:
//
//   geometry     the rotation/reflection-invariant positions+headings canonical form. MEASURED: it
//                reproduces the engine's own state count from the same sources `buildFsmTable` draws
//                on (157 by exact key against the engine's 155 at its 1.0 dedupe tolerance), so it is
//                the same lattice the FSM already uses, made explicit.
//   arrangement  the board's GENDER pattern on that geometry's own slots, as a string. This is the
//                half All8 calls an arrangement and it does NOT need a formation letter: the engine's
//                210 named formations are only 131 distinct geometries, and the 136 names that share
//                one differ by gender alone (`Ocean Waves` is NINE names on ONE geometry).
//   sequence     `sequenceFor` - codes 1..4, or null where the boards disagree (All8's own
//                "asymmetric", measured at 512 of 576 boards per formation).
//   relationship `relationshipStateOf` - which DOES need a letter, because the reference pair is a
//                per-formation convention and Callerlab records one for [L] [B] [F] [W] only.
//
// WHAT THAT SPLIT MEANS FOR THE VOCABULARY, measured on the shipped catalogue and recorded here
// because it is the finding that shapes the whole plan: `FORMATION_LETTER` maps NINE engine names to
// SIX letters, so All8's FASR names only **17 of the 2052** distinct end geometries the FSM's own
// transitions reach. FASR cannot be the node key for the other 2035, and FASROO cannot fix it -
// `fasrooOf` refuses a formation with no reference pair rather than inventing one.
//
// SO THE VOCABULARY IS OURS TO AUTHOR. `geometryId` + `arrangement` together are a complete identity
// that needs no authority's permission, and All8's notation is kept as an ANNOTATION (`fasr`) for the
// six families where it exists. Inventing letters for `[D]`/`[T]`/`[G]` would contradict both
// authorities; inventing a CELL for them does not, because a cell asserts only what the board IS.
//
// NOTHING IN THE ENGINE'S BEHAVIOUR READS THIS YET. It is the vocabulary + measurement stage: the
// lattice is declared and the split is reported (`test/tools/cell-census.mjs`) before any state set
// changes.

import { matchFormations, type Matchable } from './match.js';
import {
  alignmentOf,
  letterForFormation,
  relationshipStateOf,
  sequenceFor,
  type RelationshipCode,
  type SequenceCode,
} from './alignment.js';
import type { Board } from './types.js';

/** The rounding, in lattice units, at which two geometries are the same point. */
export const CELL_ROUND = 0.05;

/**
 * The rotation/reflection-invariant key of a set of dancers: positions and HEADINGS, centred, taken
 * over all eight 45-degree rotations and both reflections, then reduced to the lexicographically
 * smallest ordering of rounded tuples.
 *
 * Positions AND headings, deliberately. A positions-only key conflates a squared set with
 * `Static Facing Out` and with both `Static MiniWaves`, which are four different boards; that mistake
 * was made and measured once already while sizing the closure, and it undercounted by a factor of
 * 3.5. The group is exactly the one `matchFormations` quotients by (8 rotations x reflection), so two
 * boards share a key precisely when the matcher would call them congruent.
 */
export function geometryKey(dancers: Matchable[]): string {
  const n = dancers.length;
  if (n === 0) return '';
  const cx = dancers.reduce((s, d) => s + d.x, 0) / n;
  const cy = dancers.reduce((s, d) => s + d.y, 0) / n;
  let best: string | null = null;
  for (const reflect of [false, true]) {
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      const pts = dancers.map((d) => {
        let x = d.x - cx;
        let y = d.y - cy;
        if (reflect) x = -x;
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        let h = d.heading + th + (reflect ? Math.PI : 0);
        // A BUCKET KEY, NOT A NORMALISER — folded to [0, 2PI) and then quantised to CELL_ROUND for the
        // sorted string key below. `normAngle` is (-PI, PI], so a heading of -0.5 keys as 5.783 here and
        // as -0.5 there: a different lattice, not a different spelling of the same one.
        h = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return [Math.round(rx / CELL_ROUND), Math.round(ry / CELL_ROUND), Math.round(h / CELL_ROUND)];
      });
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const s = pts.map((p) => p.join(',')).join(';');
      if (best === null || s < best) best = s;
    }
  }
  return best!;
}

/** One declared geometry: the shape, the names that realise it, and the gender patterns seen on it. */
export interface CellGeometry {
  id: number;
  /** The first name that realises this geometry - the FSM's state key when it has one. */
  name: string;
  dancers: Matchable[];
  /** Every name that realises it. 136 of the engine's 210 names share a geometry with another. */
  names: string[];
  /** Every distinct gender pattern seen on it, in slot order. An "arrangement" in All8's sense. */
  patterns: string[];
  /** The All8 letters the names map to (via FORMATION_LETTER), in name order. Often empty. */
  letters: string[];
}

/** A board's cell. `geometryId` is null when the board is OFF the declared lattice. */
export interface BoardCell {
  geometryId: number | null;
  geometryName: string | null;
  /** The board's gender pattern on the geometry's own slots, e.g. "BggB". */
  pattern: string | null;
  /** Index of `pattern` among the geometry's declared patterns; null when the pattern is new. */
  arrangement: number | null;
  sequence: SequenceCode | null;
  relationship: RelationshipCode | null;
  /** All8's formation letter, when one exists for this geometry. */
  letter: string | null;
  /** All8's notation ("[0B1p]"), with `?` for every part the engine cannot read. */
  fasr: string;
  /** Stable identity: `id|pattern|sequence|relationship`. NULL when the board is off the lattice. */
  key: string | null;
}

export interface CellLattice {
  geometries: CellGeometry[];
  byKey: Map<string, CellGeometry>;
  /** The geometry a name realises, for callers that already know the name. */
  byName: Map<string, CellGeometry>;
  cellOf(board: Board): BoardCell;
}

/** The gender character of a slot, with `?` for an unknown (phantom) gender. */
function genderChar(g: Matchable['gender']): string {
  return g === 'boy' ? 'B' : g === 'girl' ? 'g' : '?';
}

/** A board's dancers as matchables - the shape `matchFormations` and `geometryKey` take. */
export function boardMatchables(board: Board): Matchable[] {
  return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple }));
}

/**
 * The gender pattern `dancers` presents ON `geometry`'s slots - read in the GEOMETRY's own slot
 * order, not the board's array order, because the array order is the renderer's binding and carries
 * no correspondence (see `reorderLike`).
 */
function patternOf(dancers: Matchable[], geometry: Matchable[]): string | null {
  const m = matchFormations(dancers, geometry, 6.0);
  if (!m) return null;
  const out = new Array<string>(geometry.length).fill('?');
  for (let i = 0; i < dancers.length; i++) out[m.mapping[i]] = genderChar(dancers[i].gender);
  return out.join('');
}

/**
 * Build the lattice from the shapes a caller declares. The FSM's own two sources are
 * `CallLibrary.getUniqueFormations()` and `CallLibrary.allVariantSetups()` - the same pair
 * `buildFsmTable` draws its state set from - so the lattice is the engine's state set made explicit
 * rather than a second opinion about what a formation is.
 *
 * THE FIRST ENTRY WINS a geometry, matching `buildFsmTable`'s own "named formations first" order, so
 * a state keeps the human-readable name rather than an `@embed#N`.
 */
export function buildCellLattice(entries: { name: string; dancers: Matchable[] }[]): CellLattice {
  const geometries: CellGeometry[] = [];
  const byKey = new Map<string, CellGeometry>();
  const byName = new Map<string, CellGeometry>();
  for (const e of entries) {
    const key = geometryKey(e.dancers);
    const existing = byKey.get(key);
    if (existing) {
      existing.names.push(e.name);
      byName.set(e.name, existing);
      const p = patternOf(e.dancers, existing.dancers);
      if (p !== null && !existing.patterns.includes(p)) existing.patterns.push(p);
    } else {
      const g: CellGeometry = {
        id: geometries.length,
        name: e.name,
        dancers: e.dancers,
        names: [e.name],
        patterns: [e.dancers.map((d) => genderChar(d.gender)).join('')],
        letters: [],
      };
      geometries.push(g);
      byKey.set(key, g);
      byName.set(e.name, g);
    }
    const letter = letterForFormation(e.name);
    const g = byKey.get(key)!;
    if (letter && !g.letters.includes(letter)) g.letters.push(letter);
  }
  return {
    geometries,
    byKey,
    byName,
    cellOf(board: Board): BoardCell {
      const dancers = boardMatchables(board);
      const g = byKey.get(geometryKey(dancers));
      const seq = sequenceFor(board).code;
      if (!g) {
        // OFF THE LATTICE. The sequence is still read, because it depends only on identity and
        // angles, but there is no geometry to hang an arrangement or a relationship on.
        return {
          geometryId: null, geometryName: null, pattern: null, arrangement: null,
          sequence: seq, relationship: null, letter: null,
          fasr: alignmentOf(board, null).notation, key: null,
        };
      }
      const pattern = patternOf(dancers, g.dancers);
      const idx = pattern === null ? -1 : g.patterns.indexOf(pattern);
      const letter = g.letters[0] ?? null;
      const rel = letter ? relationshipStateOf(board, letter).code : null;
      return {
        geometryId: g.id,
        geometryName: g.name,
        pattern,
        arrangement: idx === -1 ? null : idx,
        sequence: seq,
        relationship: rel,
        letter,
        fasr: alignmentOf(board, g.name).notation,
        key: `${g.id}|${pattern ?? '?'}|${seq ?? '?'}|${rel ?? '?'}`,
      };
    },
  };
}
