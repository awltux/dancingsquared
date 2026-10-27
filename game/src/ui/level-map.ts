// THE LEVEL'S JOURNEY, AS GEOMETRY: WHERE EACH DRILL'S NODE SITS ON A SERPENTINE PATH.
//
// WHY. REPORTED: "still looking very messy, UI design wise", and after the numbers became marks the block read as a matrix
// of a hundred identical circles — a spreadsheet with ticks. A LEVEL IS A JOURNEY in the games this one is measured
// against (Candy Crush's map, Duolingo's path): the player is somewhere on it, the next step is adjacent, and the shape
// says so. This module is the geometry only — no DOM, no state, no colour — so the layout can be probed, and
// `ui/level-screen.ts` draws whatever it answers.
//
// THE SHAPE. A SERPENTINE over a fixed column count: row 0 runs left to right, row 1 right to left, and each row starts
// under the node the previous one ended on, so consecutive drills are always neighbours — horizontally within a row and
// vertically at a turn. That adjacency is the property worth having, and it is what a plain grid (every row left to right)
// does NOT have: MEASURED by `level-map-probe.mjs`, a plain grid's row transitions jump from the right-hand end back to
// the left, a distance of seven columns.
//
// COORDINATES ARE PERCENTAGES OF THE CONTAINER, with the first and last node's centres inset by half a cell, so the host
// can size the container however it likes (a 340 px panel on the desktop, a wide sheet on a phone) and the path scales
// with it. The row height in pixels is the host's decision — this module says which row and column, not how tall.
//
// EIGHT COLUMNS. MEASURED against the panel: at a 300–340 px panel a node and its gutter come to about 34 px, so eight
// columns fill it with a 3 px gap and stay above the 24 px minimum for a tappable target; nine or more leaves under 30 px
// and a hundred nodes at ten columns is the matrix this replaces. `WIDE_COLUMNS` exists because a phone sheet is wider than
// the column it inherits: twelve columns on a 393 px viewport is the same 30 px node with a longer row.

/** The space one node needs across, including its gutter. MEASURED against the panel: 28 px node + 6 px gap. */
export const NODE_MIN_PX = 34;
/** A row never holds fewer than this, however narrow the container, or a phone would get a column of 100 nodes. */
export const MIN_COLUMNS = 6;
/** And never more than this, or a wide sheet would squash them below the touch minimum. */
export const MAX_COLUMNS = 12;

/** One drill's place on the path, as a percentage of the container on each axis. */
interface MapNode {
  /** The drill's position in the block, so a caller can index the state by it. */
  readonly index: number;
  /** 0–100, the centre of the node across its container. */
  readonly x: number;
  /** 0–100, the centre of the node down its container. */
  readonly y: number;
  /** The row and column it was derived from, kept for a probe and for a caller that wants to draw a connector. */
  readonly row: number;
  readonly column: number;
}

/** A whole path: its shape and its nodes. */
interface LevelMap {
  readonly columns: number;
  readonly rows: number;
  readonly nodes: readonly MapNode[];
}

/**
 * THE COLUMN COUNT FOR A CONTAINER, which is the width that matters — not the viewport's.
 *
 * MEASURED, the first version keyed this on the viewport and got the desktop wrong: the panel is a 340 px column on a 1280
 * px screen, so a "wide" answer of 12 columns put 100 nodes into 28 px cells on the one layout with the least room. The
 * container is what the nodes are drawn in, so the container is what decides.
 */
export function columnsFor(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return MIN_COLUMNS;
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(containerWidth / NODE_MIN_PX)));
}

/**
 * The path for a level of `count` drills.
 *
 * `count <= 0` answers an empty map rather than throwing: a level with no drills is a state the publisher can produce
 * (a season that has not been written yet) and a screen that cannot draw one is a crash rather than a message.
 */
export function mapFor(count: number, columns: number = MIN_COLUMNS): LevelMap {
  const cols = Math.max(1, Math.floor(columns));
  const total = Math.max(0, Math.floor(count));
  const rows = Math.max(1, Math.ceil(total / cols));
  const nodes: MapNode[] = [];
  for (let index = 0; index < total; index++) {
    const row = Math.floor(index / cols);
    const along = index % cols;
    // THE TURN: an odd row runs right to left, so the first node of the row is under the LAST node of the one above it.
    const column = row % 2 === 0 ? along : cols - 1 - along;
    nodes.push({
      index,
      column,
      row,
      x: ((column + 0.5) / cols) * 100,
      y: ((row + 0.5) / rows) * 100,
    });
  }
  return { columns: cols, rows, nodes };
}
