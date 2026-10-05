// FIT THE DOSADO TAMS' FACING (ROTATE) CURVES so each dancer keeps facing its partner.
//
// THE DEFECT. Reported from use: "the Dosado has the 'All Except Heads' dancers flipping from infacing to
// facing the home positions". MEASURED on the lane `Step Forward + Dosado`: the angle between each dancer's
// heading and the bearing to its partner has mean 49deg and worst 180deg - at the middle of the call the pair
// is exactly BACK TO BACK, each facing its own home side, while the path rotates the pair about its midpoint.
//
// WHY, BY CONSTRUCTION. A `rotate` curve is `(0,0) -> (cx3,0) -> (cx4,cy4) -> (x4,y4)` - `cy3` is always 0, as
// `tamination.dtd` says - and `poseFor` reads it as a TURN: `a = angle(1) - angle(0)`
// (`engine/src/core.ts:111-131`). The direction at t=0 is therefore ALWAYS +x and the whole turn rides on the
// last segment, `(x4,y4) - (cx4,cy4)`. EVERY movement of every `Facing Dancers *` tam our editor exported has
// `y4 == cy4`, i.e. a turn of EXACTLY 0 - four zeros per path, both paths. (The editor can only express a turn
// through that last segment, because its export writes `cx3=cx1 cx4=cx2 cy4=cy2 x4=x2 y4=y2` and drops the
// editor Bezier's own `cy1`: `poc/src/editor.ts:2281`.)
//
// WHAT THIS DOES. The turn each movement needs is the change in the BEARING TO THE PARTNER, sampled on the
// DRAWN poses (`evaluateVariantAt` with `rebase = false`, exactly as `animateParallelBoard` matches a group -
// the tam's own frame is NOT the drawn one, because the matched variant is re-based onto the board). Because
// `poseFor` applies a movement's translation in the frame as it stands at that movement's START and only THEN
// turns the frame, each movement's translation controls are rotated BACK by the accumulated turn, which leaves
// the drawn path where it was.
//
// MEASURED RESULT (fitted 2026-10-04; 8 tams = the three `Facing Dancers *` classes x Dosado and Left Dosado,
// 64 movement lines):
//
//   heading vs bearing-to-partner   middle pairs   mean 49deg -> 9deg,  worst 180deg -> 29deg
//                                   squared set    mean 55deg -> 13deg, worst 180deg -> 37deg
//   drawn PATH, shipped vs fitted                  worst 4.97e-16 units (float precision - unchanged)
//   last animated frame vs applied board           0.0e+0 both, and `scoped-dosado` stays green
//
// The residual 29-37deg is TIMING, not geometry: the bearing turns at the pair's own pace while the encoding
// turns with the rotate curve's own angle profile, so the facing lags by up to a quarter of a 90deg movement.
// Fitting the curve's control points to the bearing profile would remove it.
//
// NOT IDEMPOTENT, AND THAT IS GUARDED. The counter-rotation is absolute - it undoes the accumulated turn the
// fitted data already carries - so a second run would rotate every path a second time. The shipped signature
// (every movement with `y4 == cy4`) is checked first, and anything else stops the run unless `--force` is
// given: a re-export from the editor can be re-fitted, a fitted file cannot be double-fitted by accident.
// That also means the tool REFUSES on the shipped fitted file, in report mode as well as `--write` - the
// numbers above are its output from the run that produced the file, and the standing gates for the result are
// `engine/test/scoped-dosado.mjs` (all green) and `engine/test/behaviour-audit.mjs` (PASS 149 / FAIL 2, the two
// pre-existing reds, unchanged by this data).
//
// Usage: node poc/tools/dosado-facing-fit.mjs            (report + verify, on UNFITTED tams)
//        node poc/tools/dosado-facing-fit.mjs --write    (rewrite poc/src/assets/ms/dosado.xml)
import { Sequencer, setParser } from '../../engine/dist/index.js';
import { callsByTitle } from '../../engine/test/lib/engine-calls.mjs';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
setParser(DOMParser);
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');
const target = path.join(assets, 'ms', 'dosado.xml');
let out = read('ms/dosado.xml');
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const norm = (d) => ((d + 180) % 360 + 360) % 360 - 180;
// A LOOKBEHIND, because `cy4="0.2"` CONTAINS `y4="0.2"` - and so does `cx4` contain `x4`, and `cx2` `x2`.
// Without it every read and write of x4/y4/x2/y2 lands on the neighbouring control point, which is exactly
// what the first working attempt did: the turn was written into `cx4`/`cy4` instead of the endpoint.
const attr = (s, k) => {
  const m = s.match(new RegExp(`(?<![A-Za-z])${k}="(-?[0-9.eE+]+)"`));
  return m ? Number(m[1]) : null;
};
const setAttr = (s, k, v) => s.replace(new RegExp(`(?<![A-Za-z])${k}="-?[0-9.eE+]+"`), `${k}="${v}"`);
const literals = true; // regex literals below use \d (NOT \\d - that was the bug in the first attempt)

const TARGETS = ['Facing Dancers Close', 'Facing Dancers Compact', 'Facing Dancers', 'Facing Dancers Far'];
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(assets));
const an = seq.analyzer;

/** The formation's own 2-dancer poses, straight out of `formations.xml` (the tams are authored at that scale). */
function poses(formation) {
  const f = read('formations.xml').match(new RegExp(`<formation name="${formation}"[\\s\\S]*?</formation>`));
  if (!f) return null;
  const ds = [...f[0].matchAll(/<dancer\b[^>]*\/>/g)].map((m) => {
    const g = (k) => Number((m[0].match(new RegExp(`${k}="(-?[0-9.]+)"`)) ?? [])[1] ?? 0);
    return { x: g('x'), y: g('y'), heading: rad(g('angle')) };
  });
  return ds.length === 2 ? ds : null;
}

let rewritten = 0;
// NOT IDEMPOTENT, AND IT REFUSES TO PRETEND OTHERWISE. The counter-rotation is absolute (it undoes the
// accumulated turn the fitted data already carries), so running this a second time on fitted tams would
// rotate every path a second time. The shipped signature - every movement with y4 == cy4, i.e. no turn - is
// therefore checked first, and anything else stops the run unless --force is given.
{
  const zeroTurn = TARGETS.every((formation) => ['Dosado', 'Left Dosado'].every((title) => {
    const block = out.match(new RegExp(`<tam title="${title}"[^>]*formation="${formation}"[\\s\\S]*?</tam>`));
    if (!block) return true;
    return (block[0].match(/<movement [^>]*\/>/g) ?? []).every((mv) => {
      const y4 = attr(mv, 'y4'), cy4 = attr(mv, 'cy4');
      return y4 == null || cy4 == null || Math.abs(y4 - cy4) < 1e-9;
    });
  }));
  if (!zeroTurn && !process.argv.includes('--force')) {
    console.log('REFUSING: these tams already carry a facing turn (y4 != cy4 somewhere). They look FITTED,');
    console.log('and running again would rotate every path a second time. Pass --force to override.');
    process.exit(1);
  }
}
for (const formation of TARGETS) {
  const ps = poses(formation);
  if (!ps) { console.log(`  ${formation}: no 2-dancer poses`); continue; }
  const board = { dancers: ps.map((p, i) => ({ id: i + 1, x: p.x, y: p.y, heading: p.heading, gender: i === 0 ? 'boy' : 'girl' })) };
  const m = an.matcher.findMatchingVariant(board, 'Dosado', 1e-3);
  if (!m) { console.log(`  ${formation}: no variant matched`); continue; }
  if (m.reflect) { console.log(`  ${formation}: matched REFLECTED - skipped`); continue; }
  for (const title of ['Dosado', 'Left Dosado']) {
    const block = out.match(new RegExp(`<tam title="${title}"[^>]*formation="${formation}"[\\s\\S]*?</tam>`));
    if (!block) continue;
    const paths = block[0].match(/<path>[\s\S]*?<\/path>/g) ?? [];
    const moves = paths.map((p) => p.match(/<movement [^>]*\/>/g) ?? []);
    if (moves.length !== 2 || moves[0].length !== moves[1].length) continue;
    // The tam's movement boundaries in its own beats.
    const bounds = [0];
    for (const mv of moves[0]) bounds.push(bounds[bounds.length - 1] + (attr(mv, 'beats') ?? 0));
    // The DRAWN pair at each boundary, sampled EXACTLY as the animator does it: `rebase = false` is what
    // `animateParallelBoard` passes when it matches a group.
    const drawn = bounds.map((t) => an.evaluateVariantAt(board, m, t, false).dancers);
    // For each tam path j, the board dancer that plays it:
    const who = m.mapping;  // board index -> variant index
    const pathMoves = [0, 1].map((j) => {
      const bi = who.indexOf(j);
      if (bi < 0) return null;
      const other = bi === 0 ? 1 : 0;
      const bearing = drawn.map((ds) => {
        const u = ds[bi], v = ds[other];
        return deg(Math.atan2(v.y - u.y, v.x - u.x));
      });
      const turns = [];
      for (let k = 1; k < bearing.length; k++) turns.push(norm(bearing[k] - bearing[k - 1]));
      return turns;
    });
    // Rewrite: counter-rotate each movement's translation by the accumulated turn, then encode the turn.
    const rebuilt = moves.map((mv, j) => {
      const turns = pathMoves[j];
      if (!turns) return mv;
      let acc = 0;
      return mv.map((s0, k) => {
        let s = s0;
        if (acc !== 0) {
          const c = Math.cos(rad(-acc)), sn = Math.sin(rad(-acc));
          const rot = (px, py) => [px * c - py * sn, px * sn + py * c];
          for (const [xk, yk] of [['cx1', 'cy1'], ['cx2', 'cy2']]) {
            const px = attr(s, xk), py = attr(s, yk);
            if (px == null || py == null) continue;
            const [nx, ny] = rot(px, py);
            s = setAttr(setAttr(s, xk, nx.toFixed(4)), yk, ny.toFixed(4));
          }
          const [ex, ey] = rot(attr(s, 'x2'), attr(s, 'y2'));
          s = setAttr(setAttr(s, 'x2', ex.toFixed(4)), 'y2', ey.toFixed(4));
        }
        const a = turns[k] ?? 0;
        const cx4 = attr(s, 'cx4') ?? 1;
        const cy4 = attr(s, 'cy4') ?? 0;
        s = setAttr(s, 'cx3', '1');
        s = setAttr(s, 'x4', (cx4 + Math.cos(rad(a))).toFixed(4));
        s = setAttr(s, 'y4', (cy4 + Math.sin(rad(a))).toFixed(4));
        acc = norm(acc + a);
        return s;
      });
    });
    let blockNew = block[0];
    paths.forEach((p, j) => { blockNew = blockNew.replace(p, `<path>\n      ${rebuilt[j].join('\n      ')}\n    </path>`); });
    const turnsText = rebuilt.map((mv) => mv.map((s) => {
      const a = deg(Math.atan2(attr(s, 'y4') - (attr(s, 'cy4') ?? 0), attr(s, 'x4') - (attr(s, 'cx4') ?? 0)));
      return norm(a).toFixed(0).padStart(4);
    }).join('')).join('  |  ');
    console.log(`  ${formation} / ${title}: turns ${turnsText}`);
    out = out.replace(block[0], blockNew);
    rewritten++;
  }
}
console.log(`${rewritten} tam(s) rewritten`);

// ---- verification ---------------------------------------------------------------------------------
const middle = an.applicator.applyToBoard(seq.boardForFormation('Static Square'), { selection: 'All Except Heads', call: 'Step Forward' }).board;
const square = seq.boardForFormation('Static Square');

function measure(label, seq2, board, selection) {
  const an2 = seq2.analyzer;
  const res = an2.applicator.applyToBoard(an2.selectedSubBoard(board, selection).board, { call: 'Dosado' });
  const groups = res.parallel?.groups ?? [];
  const step = { selection, call: 'Dosado' };
  const beats = seq2.sequenceBeats([step], board);
  let worst = 0, mean = 0, n = 0, prev = null, maxMove = 0, last = null;
  for (let i = 0; i <= 32; i++) {
    const b = seq2.evaluateSequence([step], (i / 32) * beats, board).board;
    for (const g of groups) {
      const [p, q] = g.map((d) => b.dancers.find((x) => x.id === d.id));
      for (const [u, v] of [[p, q], [q, p]]) {
        const off = Math.abs(norm(deg(u.heading) - deg(Math.atan2(v.y - u.y, v.x - u.x))));
        worst = Math.max(worst, off); mean += off; n++;
      }
    }
    if (prev) for (const d of b.dancers) { const e = prev.find((x) => x.id === d.id); maxMove = Math.max(maxMove, Math.hypot(d.x - e.x, d.y - e.y)); }
    prev = b.dancers;
    last = b;
  }
  const applied = an2.applicator.applyToBoard(board, step).board;
  let drift = 0;
  for (const d of last.dancers) { const e = applied.dancers.find((x) => x.id === d.id); drift = Math.max(drift, Math.hypot(d.x - e.x, d.y - e.y)); }
  console.log(`  ${label}: heading-vs-partner mean ${(mean / Math.max(1, n)).toFixed(0)}deg worst ${worst.toFixed(0)}deg | step-frame move ${maxMove.toFixed(3)} | last frame vs applied ${drift.toExponential(1)}`);
}

function withDosado(xmlText) {
  return callsByTitle(assets).map((c) => (c.name === 'Dosado'
    ? { name: c.name, xml: `<calls>${(xmlText.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []).join('\n')}</calls>` }
    : c));
}

console.log('\n=== verification ===');
const shipped = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(assets));
measure('AS SHIPPED, middle   ', shipped, middle, 'All Except Heads');
const fitted = new Sequencer(read('moves.xml'), read('formations.xml'), withDosado(out));
measure('FITTED,     middle   ', fitted, middle, 'All Except Heads');
measure('FITTED,     square set', fitted, square, 'All Except Heads');
measure('AS SHIPPED, square set', shipped, square, 'All Except Heads');

// The path must be unchanged: compare positions frame by frame, shipped vs fitted.
{
  const step = { selection: 'All Except Heads', call: 'Dosado' };
  const beats = shipped.sequenceBeats([step], middle);
  let worst = 0;
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * beats;
    const a = shipped.evaluateSequence([step], t, middle).board;
    const b = fitted.evaluateSequence([step], t, middle).board;
    for (const d of a.dancers) { const e = b.dancers.find((x) => x.id === d.id); worst = Math.max(worst, Math.hypot(d.x - e.x, d.y - e.y)); }
  }
  console.log(`  PATH DEVIATION shipped vs fitted (middle): worst ${worst.toExponential(2)} units`);
}

if (process.argv.includes('--write')) { writeFileSync(target, out, 'utf8'); console.log('\nwritten.'); }
