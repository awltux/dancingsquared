// SETTLED: which authored instance of `Single Circle Left Full` the sequencer uses, at which
// tolerance, and where the resulting circle centres land.
//
// THE REPORT. Start board `Normal Lines`, apply `Single Circle Left Full`. `ms/circle.xml` authors
// the title twice, Far FIRST:
//
//   [0] formation="Facing Dancers Far"  written dancers (-3,0) (3,0)  -> half-gap 3
//   [1] formation="Facing Dancers"      written dancers (-2,0) (2,0)  -> half-gap 2
//
// `Normal Lines` is pairs at x = +/-2, i.e. half-gap 2, so [1] is the right one. `parallelApply`
// returns on the FIRST variant that tiles (`part.error` is computed and then discarded), so [0]
// wins whenever it tiles at all, whatever its error.
//
// THREE TRAPS THIS PROBE AVOIDS, all of which produced wrong answers before:
//   1. It does NOT rebuild the registration. It takes the two `<tam>` blocks from the same
//      comment-stripped index list `registrationXml` uses, in order.
//   2. `boardAtBeat` stamps EVERY dancer of a 2-dancer setup with `id: 0` (`assignHomeIdentity`
//      has no home identity to read off a two-dancer shape), so a Map keyed by `id` collapses the
//      two dancers into one and both paths look identical. Positions are read by ARRAY INDEX.
//   3. The centre is fit over the poses of ONE dancer, not inferred from a shared radius.
//
// Usage: node engine/test/tools/scircle-probe.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardAtBeat } from '../../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

const TITLE = 'Single Circle Left Full';
const FROM = 'Normal Lines';
// The two tolerances the engine really uses, hard-coded on purpose: a probe must fail loudly if
// they move, not silently follow. `constants.ts` / `config.ts` carry the same values.
const DEFAULT_MATCH_MAX = 1.5; // interactive apply: parallelApply(rebase=true)
const SEARCH_MATCH_MAX = 6.0;  // animator grouping + every sub-apply (rebase=false)

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8');

// ---- the app's own registration input -----------------------------------------------------------
const circleXml = read('ms/circle.xml');
const blocks = circleXml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
const tams = blocks.filter((b) => new RegExp(`title="${TITLE}"`).test(b));
if (tams.length !== 2) {
  console.log(`EXPECTED 2 authored setups of "${TITLE}" in the app's index list, found ${tams.length}`);
  process.exit(1);
}
const formOf = (x) => (x.match(/formation="([^"]*)"/) ?? [])[1];
console.log(`== the app's registration list for "${TITLE}" (in order) ==`);
tams.forEach((t, i) => console.log(`  [${i}] formation="${formOf(t)}"`));

const mkSeq = (labels) =>
  new Sequencer(read('moves.xml'), read('formations.xml'),
    labels.map(([name, xml]) => ({ name, xml: `<calls>\n${xml}\n</calls>` })));

// The app at runtime: BOTH setups under one title, Far first.
const appSeq = mkSeq([[TITLE, tams.join('\n')]]);
const board = appSeq.boardForFormation(FROM);
const phys = board.dancers.filter((d) => !d.isGhost);
console.log(`\n== start board (${FROM}) ==`);
console.log(`  ${phys.map((d) => `#${d.id}(${d.x},${d.y})`).join(' ')}`);

const variants = appSeq.library.matchableVariants(TITLE);
console.log(`\n== variants the library holds ==`);
variants.forEach((v, i) =>
  console.log(`  [${i}] formation="${v.formation}" symmetry=${v.symmetry} built dancers=${v.dancers.length} beats=${v.beats} setup ${v.dancers.map((d) => `(${d.x},${d.y})`).join(' ')}`));

// ---- the app's own apply ------------------------------------------------------------------------
console.log(`\n== seq.applyToBoard("${FROM}", "${TITLE}") - the app's own path ==`);
const res = appSeq.applyToBoard(board, TITLE);
console.log(`  legal=${res.legal}${res.reason ? ` reason="${res.reason}"` : ''}`);
if (res.parallel) {
  const i = variants.indexOf(res.parallel.variant);
  console.log(`  APPLIED VARIANT: [${i}] formation="${res.parallel.variant.formation}"`);
  console.log(`  groups: ${res.parallel.groups.map((g) => g.map((d) => `#${d.id}`).join('+')).join('  ')}`);
} else if (res.legal) {
  console.log('  no parallel grouping: applied as a whole-board call');
}

// ---- per-variant tiling at BOTH real tolerances --------------------------------------------------
console.log(`\n== per-variant tiling (parallelApply's own predicate), matchMargin=${appSeq.config.matchMargin} ==`);
for (const tol of [DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX]) {
  console.log(`  ---- tol ${tol} (${tol === DEFAULT_MATCH_MAX ? 'interactive apply' : 'search / sub-apply / animator grouping'}) ----`);
  variants.forEach((v, i) => {
    const setup = v.dancers.map((d) => appSeq.library.variantMatchable(d));
    const k = setup.length;
    const n = phys.length;
    if (k <= 1 || k >= n || n % k !== 0) {
      console.log(`    [${i}] SKIPPED by parallelApply (k=${k}, n=${n}, n%k=${n % k})`);
      return;
    }
    const full = appSeq.applicator.partition(setup, phys, tol);
    const part = full ?? appSeq.applicator.partitionPartial(setup, phys, tol);
    const sub = part ? appSeq.applicator.applyToBoardInner({ dancers: part.groups[0].map((d) => ({ ...d })) }, TITLE, [], false, false) : null;
    console.log(`    [${i}] "${v.formation}": partition=${full ? `FULL err=${full.error.toFixed(4)} groups=${full.groups.length}` : 'no'}`
      + ` partial=${part ? `YES err=${part.error.toFixed(4)}` : 'no'}`
      + `${sub ? ` sub-apply=${sub.legal ? 'legal' : `ILLEGAL (${sub.reason})`}` : ''}`);
  });
  const fits = variants
    .map((v, i) => {
      const setup = v.dancers.map((d) => appSeq.library.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= phys.length || phys.length % k !== 0) return null;
      const part = appSeq.applicator.partition(setup, phys, tol) ?? appSeq.applicator.partitionPartial(setup, phys, tol);
      return part ? { i, error: part.error } : null;
    })
    .filter(Boolean);
  const first = fits[0];
  const best = [...fits].sort((a, b) => a.error - b.error)[0];
  console.log(`    variants that fit: ${fits.length ? fits.map((f) => `[${f.i}]err=${f.error.toFixed(4)}`).join(' ') : 'none'}`);
  if (first) {
    console.log(`    FIRST-FIT would pick [${first.i}] "${variants[first.i].formation}" (err ${first.error.toFixed(4)})`
      + `; LOWEST-ERROR would pick [${best.i}] "${variants[best.i].formation}" (err ${best.error.toFixed(4)})`
      + `  -> ${first.i === best.i ? 'AGREE' : '*** DISAGREE ***'}`);
  }
}

// ---- where the circles actually land -------------------------------------------------------------
/**
 * The CENTRE of one dancer's authored path, found by MINIMISING THE VARIANCE OF ITS DISTANCES to
 * the centre - i.e. the point the path is most nearly a circle about.
 *
 * Deliberately not an algebraic circle fit: the authored path is a chain of cubic Beziers and is
 * only approximately circular (a least-squares fit of it leaves a 0.5-unit residual), and an
 * algebraic fit on an ill-conditioned arc reports a confident centre tens of units away. Coordinate
 * descent on the variance is robust to that and reports its own residual, so a bad answer is
 * visible rather than asserted.
 */
function fitCircle(pts) {
  const cost = (cx, cy) => {
    const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    return rs.reduce((a, r) => a + (r - mean) ** 2, 0) / rs.length;
  };
  let best = [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
  let bestCost = cost(best[0], best[1]);
  for (let step = 1.0; step > 1e-5; step /= 2) {
    for (let iter = 0; iter < 200; iter++) {
      let improved = false;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const c = cost(best[0] + dx, best[1] + dy);
        if (c < bestCost - 1e-12) { best = [best[0] + dx, best[1] + dy]; bestCost = c; improved = true; }
      }
      if (!improved) break;
    }
  }
  const [cx, cy] = best;
  const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  return { cx, cy, r: mean, resid: Math.max(...rs.map((r) => Math.abs(r - mean))) };
}

console.log(`\n== the authored circle of each variant, and the centre it would sit on when APPLIED ==`);
console.log(`   (a group's authored path is pure-relative, so its centre adds to the mapped dancer's own start)`);
variants.forEach((v, i) => {
  console.log(`  [${i}] "${v.formation}"`);
  v.dancers.forEach((d, di) => {
    const pts = [];
    for (let s = 0; s <= 32; s++) pts.push(boardAtBeat(v, (v.beats * s) / 32).dancers[di]);
    const c = fitCircle(pts);
    const start = boardAtBeat(v, 0).dancers[di];
    // Offset of the fitted centre from the dancer's own authored start: the SAME offset applies on
    // any board, which is how a 4-gap authored stance on a 2-gap board lands its centre.
    console.log(`      dancer${di}: authored start=(${start.x.toFixed(2)},${start.y.toFixed(2)})`
      + ` centre offset from start=(${c.cx.toFixed(3)}, ${c.cy.toFixed(3)}) radius=${c.r.toFixed(3)} maxresid=${c.resid.toFixed(4)}`);
  });
});

// The centre each variant lands on, on THIS board, for the pair the app groups.
console.log(`\n== where the APPLIED grouping's circles land on the real board ==`);
if (res.parallel) {
  const v = res.parallel.variant;
  const vi = variants.indexOf(v);
  const mids = res.parallel.groups.map((g) => {
    const mx = g.reduce((s, d) => s + d.x, 0) / g.length;
    const my = g.reduce((s, d) => s + d.y, 0) / g.length;
    return { ids: g.map((d) => '#' + d.id).join('+'), mid: [mx, my] };
  });
  console.log(`  applied [${vi}] "${v.formation}"`);
  // Each group is animated along the variant's own authored path, pure-relative, so the authored
  // centre OFFSET from the authored start is what lands on the board.
  const offs = v.dancers.map((_, di) => {
    const pts = [];
    for (let s = 0; s <= 32; s++) pts.push(boardAtBeat(v, (v.beats * s) / 32).dancers[di]);
    const c = fitCircle(pts);
    const start = boardAtBeat(v, 0).dancers[di];
    return [c.cx - start.x, c.cy - start.y];
  });
  res.parallel.groups.forEach((g) => {
    const mx = g.reduce((s, d) => s + d.x, 0) / g.length;
    const my = g.reduce((s, d) => s + d.y, 0) / g.length;
    const centres = g.map((d, k) => {
      const o = offs[k % offs.length];
      return [d.x + o[0], d.y + o[1]];
    });
    const cmx = centres.reduce((s, c) => s + c[0], 0) / centres.length;
    const cmy = centres.reduce((s, c) => s + c[1], 0) / centres.length;
    const gap = Math.hypot(centres[0][0] - centres[1][0], centres[0][1] - centres[1][1]);
    console.log(`  group ${g.map((d) => '#' + d.id).join('+')}: pair midpoint=(${mx.toFixed(2)},${my.toFixed(2)})`
      + ` -> dancer centres ${centres.map((c) => `(${c[0].toFixed(2)},${c[1].toFixed(2)})`).join(' and ')}`
      + `  (their midpoint (${cmx.toFixed(2)},${cmy.toFixed(2)}), ${gap.toFixed(2)} apart)`);
  });
  const report = mids.length;
  void report;
}

// ---- what the OTHER variant would have produced, for contrast -------------------------------------
const other = variants.find((v) => v !== res.parallel?.variant);
if (other) {
  const oi = variants.indexOf(other);
  const offs = other.dancers.map((_, di) => {
    const pts = [];
    for (let s = 0; s <= 32; s++) pts.push(boardAtBeat(other, (other.beats * s) / 32).dancers[di]);
    const c = fitCircle(pts);
    const start = boardAtBeat(other, 0).dancers[di];
    return [c.cx - start.x, c.cy - start.y];
  });
  console.log(`\n== CONTRAST: had [${oi}] "${other.formation}" been applied to the same groups ==`);
  res.parallel?.groups.forEach((g) => {
    const centres = g.map((d, k) => {
      const o = offs[k % offs.length];
      return [d.x + o[0], d.y + o[1]];
    });
    console.log(`  group ${g.map((d) => '#' + d.id).join('+')}: centres ${centres.map((c) => `(${c[0].toFixed(2)},${c[1].toFixed(2)})`).join(' and ')}`);
  });
}
