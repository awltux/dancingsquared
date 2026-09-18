// PIN [0W] AND [0F] TO SPOTS, from All8's own reference-pair diagrams (fasr.htm, "Reference Pair
// shown in RED").
//
// WHY. The repo records no reference pair for `[0W]` and `[0F]`: no published ALIGNMENT discriminates
// their relationship letter (they are all `p`, where any pair agrees), so the corpus could not pin
// them. Orientation does not have that luxury - it needs the pair's POSITION - and without one the
// four boards a `[W]`/`[F]` code admits do not separate (24 of 72 codes collide,
// `fasroo-injectivity-probe.mjs`). All8 draws all four agreed pairs, so the diagram is the source.
//
// The sprite set on that page is a COLOUR set, not the couple set the 16-state pages use: 0 = red boy,
// 1 = red girl, 8 = black boy, 9 = black girl. The 0/1 tiles are therefore exactly the reference
// dancers, and there are FOUR of them because All8's convention has two reference positions
// "opposite each other" and the diagram shows both.
//
// METHOD, the same one that pinned [L] and [B]: search the print layouts and rotations for the one
// that reproduces the page's own TABLE facings, then check that [L]'s red pair covers the cells the
// corpus pinned (0,2)+(0,3) and [B]'s covers (2,0)+(3,0). Only then read [F] and [W].
//
// Usage: node engine/test/tools/fasr-reference-pair-probe.mjs   (network needed)

import { setParser, ARRANGEMENT_TABLES, REFERENCE_PAIR_SPOTS } from '../../dist/index.js';
import { DOMParser } from '@xmldom/xmldom';
setParser(DOMParser);

const html = await (await fetch('https://www.all8.com/sd/calling/fasr.htm')).text();
const heading = html.indexOf('Reference Pair shown in');
const window = html.slice(heading, heading + 12000);
const tilesOf = (cell) => [...cell.matchAll(/src="?d1\/(\d)([nesw])\.gif/gi)].map((t) => ({ n: Number(t[1]), dir: t[2] }));
const cells = [...window.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]).filter((c) => tilesOf(c).length === 8);
const LETTERS = ['L', 'B', 'F', 'W'];
if (cells.length < 4) { console.log(`only ${cells.length} diagram(s) found`); process.exit(1); }

const FACE = { e: '>', n: '^', w: '<', s: 'v' };
// Rotating the grid 90 degrees clockwise turns each facing with it: east -> south -> west -> north.
const CW = { '>': 'v', v: '<', '<': '^', '^': '>' };

/** Every print layout x rotation whose facings reproduce the page's own table for this letter. */
function layoutsOf(tiles, letter) {
  const t = ARRANGEMENT_TABLES[letter];
  if (!t) return [];
  const R = t.length, C = t[0].facing.length;
  const out = [];
  for (const [dr, dc] of [[R, C], [C, R]]) {
    if (dr * dc !== 8) continue;
    for (let k = 0; k < 4; k++) {
      let g = Array.from({ length: dr }, (_, r) => Array.from({ length: dc }, (_, c) => tiles[r * dc + c]));
      let f = g.map((row) => row.map((tile) => FACE[tile.dir]));
      let rr = dr, cc = dc;
      for (let s = 0; s < k; s++) {
        // Rotate the grid 90 degrees CLOCKWISE: out[c][rr - 1 - r] = g[r][c], facing e -> s -> w -> n.
        const ng = Array.from({ length: cc }, (_, r) => Array.from({ length: rr }, (_, c) => g[rr - 1 - c][r]));
        const nf = Array.from({ length: cc }, (_, r) => Array.from({ length: rr }, (_, c) => CW[f[rr - 1 - c][r]]));
        g = ng; f = nf; [rr, cc] = [cc, rr];
      }
      if (rr !== R || cc !== C) continue;
      if (t.every((row, i) => row.facing === f[i].join(''))) {
        const red = [];
        g.forEach((row, r) => row.forEach((tile, c) => { if (tile.n === 0 || tile.n === 1) red.push([r, c]); }));
        out.push({ shape: `${dr}x${dc}`, rotation: k * 90, grid: g, red });
      }
    }
  }
  return out;
}

const redCovers = (red, spots) => spots.every(([r, c]) => red.some(([rr, cc]) => rr === r && cc === c));

console.log('== every layout whose facings reproduce All8\'s own table, with its red pair ==');
const solution = {};
for (const letter of LETTERS) {
  const tiles = tilesOf(cells[LETTERS.indexOf(letter)]);
  const layouts = layoutsOf(tiles, letter);
  const pinned = REFERENCE_PAIR_SPOTS[letter];
  console.log(`\n[${letter}] ${layouts.length} layout(s) match the table`);
  for (const l of layouts) {
    const covers = pinned ? redCovers(l.red, pinned) : null;
    console.log(`   ${l.shape} rotated ${l.rotation} deg   red ${l.red.map((x) => `(${x})`).join('')}${covers === null ? '' : covers ? '   <- covers the pinned pair' : '   <- does not cover'}`);
    console.log(`       ${l.grid.map((row) => row.map((t) => `${t.n === 0 ? 'Rb' : t.n === 1 ? 'Rg' : t.n === 8 ? '.b' : '.g'}`).join(' ')).join('  |  ')}`);
  }
  if (letter === 'L' || letter === 'B') {
    solution[letter] = layouts.find((l) => pinned && redCovers(l.red, pinned)) ?? null;
  }
}

console.log('\n== the controls ==');
console.log(`   [L] pinned ${JSON.stringify(REFERENCE_PAIR_SPOTS.L)}: ${solution.L ? 'SOLVED by a layout' : 'no layout covers it'}`);
console.log(`   [B] pinned ${JSON.stringify(REFERENCE_PAIR_SPOTS.B)}: ${solution.B ? 'SOLVED by a layout' : 'no layout covers it'}`);

if (solution.L && solution.B && solution.L.shape === solution.B.shape && solution.L.rotation === solution.B.rotation) {
  console.log(`\n== both controls use the same layout (${solution.L.shape}, rotated ${solution.L.rotation} deg), so F and W are read the same way ==`);
  for (const letter of ['F', 'W']) {
    const l = layoutsOf(tilesOf(cells[LETTERS.indexOf(letter)]), letter)
      .find((x) => x.shape === solution.L.shape && x.rotation === solution.L.rotation);
    if (!l) { console.log(`  [${letter}] no matching layout`); continue; }
    // the two red couples; report both, since All8 says either position gives the same answer
    console.log(`\n  [${letter}] red cells: ${l.red.map((x) => `(${x})`).join(' ')}`);
    console.log(`      ${l.grid.map((row) => row.map((t) => `${t.n === 0 ? 'Rb' : t.n === 1 ? 'Rg' : t.n === 8 ? '.b' : '.g'}`).join(' ')).join('  |  ')}`);
  }
} else {
  console.log('\n  the two controls do not agree on a single layout, so F and W cannot be read off one');
}
