// THE LEVEL PATH'S GEOMETRY, PINNED — and the one property that makes it a path rather than a grid.
//
// REPORTED: "still looking very messy, UI design wise", which after the numbers became marks was a matrix of a hundred
// identical circles. A level is a JOURNEY in the games this one is measured against, and the thing a journey gives a
// player is ADJACENCY: the next step is next to the one you are on, including at the end of a row. A plain grid fails
// exactly there — its row four ends at the right-hand edge and row five starts at the left — so a hundred nodes read as a
// table. This probe pins the serpentine turn, the adjacency it buys, and the percentage coordinates the screen draws with.
//
// WHAT THIS PINS:
//   1. COUNT AND ORDER. Every drill has exactly one node, in the block's own order, so a caller can index the state by it.
//   2. ADJACENCY. Between consecutive drills the node moves by exactly one column, or by one row in the SAME column at a
//      turn — never a jump. That is the rule a grid breaks, and the `plainGrid` control below shows it breaking it.
//   3. THE TURN GOES THE RIGHT WAY. Row 1's first node sits under row 0's LAST node (the same column), which is what a
//      serpentine means; a grid puts it under the first.
//   4. NO OVERLAP, and every centre inside its own container.
//   5. THE COLUMNS RULE. `columnsFor` answers 8 below the shell's 900 px breakpoint and 12 at or above it, so the host does
//      not carry a second copy of the number.
//   6. THE NODE IS SQUARE AT EVERY CONTAINER WIDTH. The geometry above says WHERE a node sits; this section reads the
//      stylesheet that draws it, because the failure it pins is a CSS one — REPORTED: "Keep the Drill grid cells square.
//      Currently they seem to stretch along the horizontally when displayed on PC or tablet." Sections 1-5 are pure
//      geometry; section 6 reads text and still needs no DOM.
//
// THE NEGATIVE CONTROLS are `plainGrid` (a left-to-right-every-row layout, which fails the adjacency check on the first
// turn and passes everything else) and, in section 6, the rule as it stood before the fix — `max-height` with no
// `max-width` — which the two shape checks reject and no other check in this file does.
//
// Usage: node game/test/level-map-probe.mjs   (geometry plus one stylesheet read: no engine, no DOM)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapFor, columnsFor, MIN_COLUMNS, MAX_COLUMNS, NODE_MIN_PX,
} from '../src/ui/level-map.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The rejected shape: every row runs left to right. Used only as the control. */
const plainGrid = (count, cols) => Array.from({ length: count }, (_, index) => ({
  index,
  row: Math.floor(index / cols),
  column: index % cols,
}));

/** The step between two nodes, as a reader of the picture would describe it. */
const step = (a, b) => ({ columns: Math.abs(b.column - a.column), rows: Math.abs(b.row - a.row) });

console.log('\n== 1. one node per drill, in order ==');
{
  for (const count of [1, 7, 8, 9, 16, 100]) {
    const map = mapFor(count);
    check(map.nodes.length === count, `a level of ${count} has ${map.nodes.length} node(s)`);
    check(map.nodes.every((node, i) => node.index === i), `and they are in the block's order (${count})`);
  }
  check(mapFor(0).nodes.length === 0 && mapFor(0).rows === 1, 'an empty level answers an empty map rather than throwing');
  check(mapFor(-3).nodes.length === 0, 'and so does a negative count');
}

console.log('\n== 2. adjacency: the next drill is next to this one, always ==');
{
  const map = mapFor(100);
  const jumps = [];
  for (let i = 1; i < map.nodes.length; i++) {
    const s = step(map.nodes[i - 1], map.nodes[i]);
    // ONE column along, or one row down in the same column. Anything else is a jump.
    const adjacent = (s.columns === 1 && s.rows === 0) || (s.columns === 0 && s.rows === 1);
    if (!adjacent) jumps.push(`${map.nodes[i - 1].index}->${map.nodes[i].index} (${JSON.stringify(s)})`);
  }
  check(jumps.length === 0, `every one of the 99 steps is a neighbour (${jumps.length} jumps)`, jumps.slice(0, 4).join(', '));
  // NEGATIVE CONTROL: the grid this replaces, on the same level. Its first turn jumps seven columns and every row after it
  // does the same, so the check above is not passing because every layout would pass it.
  const grid = plainGrid(100, 8);
  let gridJumps = 0;
  for (let i = 1; i < grid.length; i++) {
    const s = step(grid[i - 1], grid[i]);
    if (!((s.columns === 1 && s.rows === 0) || (s.columns === 0 && s.rows === 1))) gridJumps++;
  }
  check(gridJumps > 0, `a plain grid would fail the same check ${gridJumps} time(s) — the control`);
}

console.log('\n== 3. the turn goes the right way ==');
{
  const map = mapFor(16, 8);
  const row0 = map.nodes.filter((n) => n.row === 0);
  const row1 = map.nodes.filter((n) => n.row === 1);
  check(row0.length === 8 && row1.length === 8, `sixteen drills over eight columns is two rows of eight (${row0.length}, ${row1.length})`);
  check(row1[0].column === row0[row0.length - 1].column,
    `row 1 starts under row 0's LAST node (column ${row1[0].column} = ${row0[row0.length - 1].column})`);
  check(row1[1].column === row1[0].column - 1, 'and then runs backwards, which is the serpentine');
  // THE CONTROL AGAIN, on this rule: a grid's second row starts under the FIRST node, one column 0 against column 7.
  const grid = plainGrid(16, 8);
  check(grid[8].column === 0 && grid[7].column === 7,
    `a plain grid starts row 1 under column ${grid[8].column} while row 0 ended on ${grid[7].column}`);
  // AN ODD ROW COUNT MUST NOT BREAK THE RULE: three rows turn twice.
  const three = mapFor(24, 8);
  check(three.rows === 3 && three.nodes[16].row === 2, 'a third row exists at 24 drills');
  check(three.nodes[16].column === three.nodes[15].column, 'and row 2 starts under row 1\'s last node');
  check(three.nodes[23].column === 7, 'then runs forwards again');
}

console.log('\n== 4. inside the container, and never on top of each other ==');
{
  const map = mapFor(100);
  const inside = map.nodes.every((n) => n.x > 0 && n.x < 100 && n.y > 0 && n.y < 100);
  check(inside, 'every centre is strictly inside the 0–100 box');
  const keys = new Set(map.nodes.map((n) => `${n.row}:${n.column}`));
  check(keys.size === map.nodes.length, `no two nodes share a cell (${keys.size} of ${map.nodes.length})`);
  // THE INSET: the first column's centre is half a cell in, not at the edge, so a node cannot hang off the container.
  const map8 = mapFor(8, 8);
  check(Math.abs(map8.nodes[0].x - (0.5 / 8) * 100) < 1e-9, `the first centre is half a cell in (${map8.nodes[0].x}%)`);
  const map7 = mapFor(7, 8);
  check(Math.abs(map7.nodes[0].y - 50) < 1e-9, 'a single row is centred vertically (50%)');
}

console.log('\n== 5. the one column-count rule: the CONTAINER decides, not the viewport ==');
{
  // THE PANEL IS 340 px ON A 1280 px SCREEN, so a viewport-keyed rule put twelve columns into the one layout with the least
  // room. MEASURED here: the count follows the container's width, one column per `NODE_MIN_PX` and clamped at both ends.
  check(columnsFor(340) === 10, `a 340 px panel asks for ${columnsFor(340)} columns`);
  check(columnsFor(300) === 8, `a 300 px panel asks for ${columnsFor(300)}`);
  check(columnsFor(393) === 11, `a phone sheet asks for ${columnsFor(393)}`);
  check(columnsFor(NODE_MIN_PX * MIN_COLUMNS - 1) === MIN_COLUMNS,
    `anything narrower than ${NODE_MIN_PX * MIN_COLUMNS} px clamps to ${MIN_COLUMNS}`);
  check(columnsFor(2000) === MAX_COLUMNS, `a very wide container clamps to ${MAX_COLUMNS}`);
  check(columnsFor(0) === MIN_COLUMNS && columnsFor(Number.NaN) === MIN_COLUMNS,
    'a container that has not been measured yet answers the floor rather than NaN');
  // NEGATIVE CONTROL: a FIXED count — the shape this replaces — cannot be right at both ends, because 340 px and a phone
  // sheet want different numbers and the panel's own worst case is the wide rule's best one.
  check(columnsFor(340) !== columnsFor(393), 'a fixed count would answer the same at both widths, and this rule does not');
  const wide = mapFor(100, MAX_COLUMNS);
  check(wide.rows === 9 && wide.nodes.length === 100, `100 drills at ${MAX_COLUMNS} columns is ${wide.rows} rows`);
  // A COLUMN COUNT OF ZERO OR A FRACTION IS CLAMPED rather than producing NaNs in a CSS percentage.
  check(mapFor(4, 0).columns === 1 && mapFor(4, 3.7).columns === 3, 'a silly column count is clamped, not propagated');
  check(mapFor(4, 0).nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'and produces finite coordinates');
}

console.log('\n== 6. a node is SQUARE at every container width (the stylesheet) ==');
{
  // THE RULE THAT DRAWS THE NODE, read from the file that owns it. It appears twice — the shape and the tabular figures —
  // so every body is gathered rather than only the first. The readers are named so the control below runs the SAME ones.
  const css = fs.readFileSync(path.join(GAME, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies = [...css.matchAll(/#levelBlock \.cell\s*\{([^}]*)\}/g)].map((m) => m[1]);
  check(bodies.length >= 1, `style.css carries the node's rule (${bodies.length} block(s))`);
  const rule = bodies.join(';');
  const asksSquare = (r) => /aspect-ratio:\s*1/.test(r);
  const capsWidth = (r) => /max-width:/.test(r);
  const capsHeight = (r) => /max-height:/.test(r);
  const widthFromColumns = (r) => /width:\s*calc\(100%\s*\/\s*var\(--level-columns/.test(r);
  check(asksSquare(rule), `the node asks for a square (${rule.replace(/\s+/g, ' ').trim().slice(0, 90)}…)`);
  // THE CAP MUST BE ON THE AXIS THE PERCENTAGE SETS. `aspect-ratio` derives the other axis, so a cap on the derived one
  // fights the square: the width keeps growing with the container and the height stops. That is the reported stretch.
  check(capsWidth(rule), 'and the cap is on the width, the axis the percentage sets');
  check(!capsHeight(rule), 'with NO height cap, which would flatten the node as its container widens');
  check(widthFromColumns(rule),
    'and the width is derived from the column count the screen writes, so a node cannot overflow its own column');
  // THE NEGATIVE CONTROL: the rule as it stood before the fix — a `max-height` cap and no `max-width` — run through the SAME
  // four readers. It passes the square request and the column-derived width and fails exactly the cap pair, so the pair is
  // what rules it out and the other two checks cannot be passing by accident.
  const before = [...'#levelBlock .cell { width: calc(100% / var(--level-columns, 10) - var(--space-xs)); aspect-ratio: 1; max-height: 32px; }'
    .matchAll(/#levelBlock \.cell\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
  check(asksSquare(before) && widthFromColumns(before), 'CONTROL: the old rule still asks for a square and still derives its width');
  check(capsHeight(before) && !capsWidth(before), 'CONTROL: but it caps the HEIGHT and not the width, so exactly the cap pair above fails');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
