// DID THE PRE-`afaae4a` INDEX SHIFT ACTUALLY CAUSE THE REPORTED WRONG INSTANCE?
//
// `poc/src/data.ts` `registrationXml` indexed tams with a RAW-TEXT regex while `entry.tamIndices`
// came from a DOM walk (which skips `<!-- -->`). At HEAD `ms/circle.xml` carries 142 raw tams and
// only 104 live ones - 38 commented - so the two lists drift and the app registers whatever sits at
// the SHIFTED index. `afaae4a` stripped comments first. The HANDOVER records that the change was
// never shown to alter this call's registration, which is why it did not fix the report.
//
// This probe closes that gap: it registers the SHIFTED tam and reports whether the engine then
// produces the reported symptom (a `Normal Lines` pair circling about mirrored centres).
//
// Usage: node engine/test/tools/scircle-shift-probe.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardAtBeat } from '../../dist/index.js';

const TITLE = 'Single Circle Left Full';
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const circleXml = read('poc/src/assets/ms/circle.xml');
const blocks = circleXml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];

// The index list the DOM walk builds, which is what `entry.tamIndices` holds.
const domTams = [];
{
  const doc = new DOMParser().parseFromString(circleXml, 'text/xml');
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 8) continue;
      if (c.nodeType === 1 && c.nodeName === 'tam') domTams.push(c);
      walk(c);
    }
  };
  walk(doc);
}
const idx = [];
domTams.forEach((t, i) => { if (t.getAttribute('title') === TITLE) idx.push(i); });
console.log(`DOM tams: ${domTams.length}   comment-stripped regex tams: ${blocks.length}`);
console.log(`the app's tamIndices for "${TITLE}": ${idx.join(', ')}`);

const label = (b) => (b.match(/formation="([^"]*)"/) ?? [])[1];

const mkSeq = (xmls) =>
  new Sequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'),
    [{ name: TITLE, xml: `<calls>\n${xmls.join('\n')}\n</calls>` }]);

// A robust centre: the point the authored path is most nearly circular about. See scircle-probe.mjs.
function centreOf(variant, i) {
  const pts = [];
  for (let s = 0; s <= 64; s++) pts.push(boardAtBeat(variant, (variant.beats * s) / 64).dancers[i]);
  const cost = (cx, cy) => {
    const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    return rs.reduce((a, r) => a + (r - m) ** 2, 0) / rs.length;
  };
  let best = [0, 0], bc = cost(0, 0);
  for (let step = 1.0; step > 1e-5; step /= 2) {
    for (let it = 0; it < 200; it++) {
      let imp = false;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const c = cost(best[0] + dx, best[1] + dy);
        if (c < bc - 1e-12) { best = [best[0] + dx, best[1] + dy]; bc = c; imp = true; }
      }
      if (!imp) break;
    }
  }
  return { cx: best[0], cy: best[1], var: bc };
}

const CASES = [
  ['FIXED (afaae4a)   : blocks[tamIndices]', idx.map((i) => blocks[i])],
  ['SHIFTED (pre-fix) : blocks[tamIndices+1]', idx.map((i) => blocks[i + 1] ?? blocks[0])],
];

for (const [name, tamXml] of CASES) {
  console.log(`\n== ${name} ==`);
  tamXml.forEach((b, i) => console.log(`  [${i}] formation="${label(b)}"`));
  const seq = mkSeq(tamXml);
  const board = seq.boardForFormation('Normal Lines');
  const res = seq.applyToBoard(board, TITLE);
  const variants = seq.library.matchableVariants(TITLE);
  if (!res.legal) { console.log(`  apply: REFUSED (${res.reason})`); continue; }
  const vi = res.parallel ? variants.indexOf(res.parallel.variant) : -1;
  console.log(`  apply: legal, variant ${vi >= 0 ? `[${vi}] "${res.parallel.variant.formation}"` : 'whole-board'}`);
  if (res.parallel) {
    console.log(`  groups: ${res.parallel.groups.map((g) => g.map((d) => '#' + d.id).join('+')).join('  ')}`);
    const v = res.parallel.variant;
    const offs = v.dancers.map((_, di) => {
      const c = centreOf(v, di);
      const s = boardAtBeat(v, 0).dancers[di];
      return [c.cx - s.x, c.cy - s.y];
    });
    res.parallel.groups.slice(0, 2).forEach((g) => {
      const mx = g.reduce((s, d) => s + d.x, 0) / g.length;
      const my = g.reduce((s, d) => s + d.y, 0) / g.length;
      const cs = g.map((d, k) => [d.x + offs[k % offs.length][0], d.y + offs[k % offs.length][1]]);
      const gap = Math.hypot(cs[0][0] - cs[1][0], cs[0][1] - cs[1][1]);
      console.log(`    ${g.map((d) => '#' + d.id).join('+')} midpoint=(${mx.toFixed(2)},${my.toFixed(2)})`
        + ` centres ${cs.map((c) => `(${c[0].toFixed(2)},${c[1].toFixed(2)})`).join(' / ')}  gap=${gap.toFixed(2)}`);
    });
  }
}
