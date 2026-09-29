// THE TWO AUTHORED PATHS, AS DATA.
//
// Both renderers agree on the trajectory, so the trajectory is what is left to examine. This prints
// the resolved movement list for each authored setup of `Single Circle Left Full` and samples the
// AUTHORED path, so the shape can be judged directly rather than inferred.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, boardAtBeat } from '../../dist/index.js';
setParser(DOMParser);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const TITLE = 'Single Circle Left Full';

const xml = read('poc/src/assets/ms/circle.xml');
const blocks = xml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
const tams = blocks.filter((b) => new RegExp(`title="${TITLE}"`).test(b));
console.log(`tams: ${tams.length}`);
tams.forEach((t, i) => {
  const form = (t.match(/formation="([^"]*)"/) ?? [])[1];
  const from = (t.match(/\bfrom="([^"]*)"/) ?? [])[1] ?? '(none)';
  const asym = (t.match(/asymmetric="([^"]*)"/) ?? [])[1] ?? '(none)';
  console.log(`\n[${i}] formation="${form}" from="${from}" asymmetric="${asym}"  paths=${(t.match(/<path>/g) || []).length} movements=${(t.match(/<movement/g) || []).length}`);
  console.log(`    raw: ${t.replace(/\s+/g, ' ').trim()}`);
});

for (const [i, t] of tams.entries()) {
  const seq = new Sequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'), [
    { name: TITLE, xml: `<calls>\n${t}\n</calls>` },
  ]);
  const v = seq.library.matchableVariants(TITLE)[0];
  console.log(`\n===== [${i}] "${v.formation}" : built dancers=${v.dancers.length} beats=${v.beats} =====`);
  console.log(`  setup: ${v.dancers.map((d) => `(${d.x},${d.y}) h=${(d.angleDeg).toFixed(0)}deg mirror=${!!d.mirror}`).join('  ')}`);
  const d0 = v.dancers[0];
  console.log(`  dancer0 path segments: ${d0.path.length}`);
  d0.path.forEach((s, k) => {
    console.log(`    seg${k}: beats=${s.beats} hands=${s.hands} translate(x2=${s.translate.x2}, y2=${s.translate.y2})`);
  });
  const pts = [];
  for (let b = 0; b <= v.beats + 1e-9; b += v.beats / 16) {
    const p = boardAtBeat(v, b);
    pts.push({ b, x: p.dancers[0].x, y: p.dancers[0].y });
  }
  console.log(`  authored trail of dancer0 (start (${d0.x},${d0.y})):`);
  for (const p of pts) {
    const r = Math.hypot(p.x - d0.x, p.y - d0.y);
    console.log(`    beat ${p.b.toFixed(2).padStart(5)}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})   ${r.toFixed(2)} from start`);
  }
  const maxR = Math.max(...pts.map((p) => Math.hypot(p.x - d0.x, p.y - d0.y)));
  const minHalfGap = Math.min(...pts.map((p) => Math.abs(p.x)));
  console.log(`  furthest point from its own start: ${maxR.toFixed(2)}`);
  void minHalfGap;
}
