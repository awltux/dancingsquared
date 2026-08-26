// Sequencer headless test. Run after `npm run build` (tsc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

// Extract just the <tam> blocks whose title matches, so a call with several
// setups (e.g. Heads/Sides Pass Thru) doesn't pollute a name's variant list.
const filterTam = (p, title) => {
  const xml = read(p);
  const blocks = xml.match(/<tam\b[\s\S]*?<\/tam>/g) || [];
  const kept = blocks.filter((b) => new RegExp(`title="${title}"`).test(b));
  return '<calls>\n' + kept.join('\n') + '\n</calls>';
};

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');
const ms = (name) => read(`../../poc/src/assets/ms/${name}.xml`);

const seq = new Sequencer(movesXml, formationsXml, [
  { name: 'Allemande Left', xml: ms('allemande') },
  { name: 'Swing Thru', xml: ms('swing_thru') },
  { name: 'Promenade', xml: ms('promenade') },
  { name: 'Circle Left', xml: ms('circle') },
  { name: 'Heads Spin the Top', xml: ms('spin_the_top') },
  { name: 'Double Pass Thru', xml: ms('double_pass_thru') },
  { name: 'Heads Pass Thru', xml: filterTam('../../poc/src/assets/b1/pass_thru.xml', 'Heads Pass Thru') },
]);

console.log('== Sequencer: start ==');
check(seq.board.dancers.length === 8, 'starts with 8 dancers');
check(['Squared Set', 'Static Square'].includes(seq.recognize(seq.board).name), `start recognized as a squared set: ${seq.recognize(seq.board).name}`);

console.log('== Sequencer: legalNext from Squared Set ==');
const legal = seq.legalNext();
check(legal.includes('Allemande Left'), `legalNext includes Allemande Left: [${legal.join(', ')}]`);

console.log('== Sequencer: apply a legal call (Allemande Left) ==');
const startBoard = seq.startBoard();
const step = seq.apply('Allemande Left');
check(step.legal === true, 'Allemande Left is legal from Squared Set');
const changed = step.board.dancers.filter((d, i) => {
  const s = startBoard.dancers[i];
  return Math.hypot(d.x - s.x, d.y - s.y) > 0.01 || Math.abs(d.heading - s.heading) > 0.01;
}).length;
check(changed >= 4, `dancers changed (position or facing): ${changed}`);

console.log('== Sequencer: illegal call (Swing Thru from Squared Set) ==');
seq.reset();
const step2r = seq.apply('Swing Thru');
check(step2r.legal === false, 'Swing Thru is NOT legal from Squared Set');

console.log('== Sequencer: identity + FASR ==');
const fasr = seq.fasr();
check(fasr.arrangement.includes('4 couples'), `arrangement: ${fasr.arrangement}`);
check(Object.keys(fasr.relationship).length === 8, 'FASR relationships for all 8 dancers');
const p1 = fasr.relationship[1];
check(p1.partner != null && p1.corner != null, `dancer 1: partner=${p1.partner} corner=${p1.corner}`);

console.log('== Sequencer: getout (bounded) ==');
seq.reset();
const g = seq.getout({ maxCalls: 2 });
check(Array.isArray(g) || g === null, `getout returns a path or null: ${g ? g.join(' > ') : 'null'}`);

console.log('== Sequencer: re-base must not rotate the set (Circle Left -> Allemande Left) ==');
seq.reset();
const cr = seq.apply('Circle Left');
const al = seq.apply('Allemande Left');
// Dancer identities stay with the dancers; the couples must keep their home
// orientation (couple 3 north, couple 1 south) rather than flipping 180 deg
// because the matcher chose an arbitrary rotation of the symmetric squared set.
const byId = Object.fromEntries(al.board.dancers.map((d) => [d.id, d]));
const c3north = byId[1].y > 0 && byId[2].y > 0;
const c1south = byId[5].y < 0 && byId[6].y < 0;
const c2east = byId[3].x > 0 && byId[4].x > 0;
const c4west = byId[7].x < 0 && byId[8].x < 0;
check(cr.legal, 'Circle Left legal from home');
check(al.legal, 'Allemande Left legal after Circle Left');
check(c3north && c1south && c2east && c4west, `re-base keeps home couple orientation (c3 north=${c3north}, c1 south=${c1south}, c2 east=${c2east}, c4 west=${c4west})`);

console.log('== Sequencer: re-base must not rotate the set (Heads Spin the Top -> Double Pass Thru) ==');
seq.reset();
const hst = seq.apply('Heads Spin the Top');
const dpt = seq.apply('Double Pass Thru');
// After Heads Spin the Top the set is a Quarter Tag facing either N-S
// (headings ~+/-90) or E-W (headings ~0/180) depending on the authored setup.
// Re-basing onto Double Pass Thru's canonical setup must PRESERVE that facing,
// not spin the set 90 deg (a N-S set must stay N-S, an E-W set must stay E-W).
check(hst.legal, 'Heads Spin the Top legal from home');
check(dpt.legal, 'Double Pass Thru legal after Heads Spin the Top');
const facingMode = (b) => {
  const degs = b.dancers.map((d) => {
    const deg = (d.heading * 180) / Math.PI;
    return ((deg % 360) + 360) % 360; // normalize to [0,360)
  });
  // all headings must be within 30 deg of the 0/180 axis (E-W) or the 90/270
  // axis (N-S). Compute which axis each heading is on, then require a single axis.
  const offAxis = (a) => Math.min(a % 180, 180 - (a % 180));
  const modes = degs.map((a) => (offAxis(a) < 30 ? 0 : offAxis(a - 90) < 30 ? 90 : -1));
  return modes.every((m) => m === modes[0]) && modes[0] !== -1 ? modes[0] : -1;
};
const hstMode = facingMode(hst.board);
check(hstMode === 90 || hstMode === 0, `Heads Spin the Top ends in a coherent NS/EW facing (mode=${hstMode})`);
const dptMode = facingMode(dpt.board);
check(dptMode === hstMode, `re-base keeps the set facing (${hstMode === 90 ? 'N-S' : 'E-W'}, no 90deg flip): ${dpt.board.dancers.map((d) => (d.heading * 180 / Math.PI).toFixed(0)).join(', ')}`);

console.log('== Sequencer: Heads calls act on HOME heads after the set rotates ==');
seq.reset();
// Rotate the home square 90deg CCW (positions + headings), keeping identities,
// so the original heads are no longer at the N/S slots. A "Heads X" call must
// still target those original heads, not whoever now stands at N/S.
const rotP = (x, y, hDeg, deg) => { const r = deg * Math.PI / 180; return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r), h: hDeg + deg }; };
const rotated = seq.startBoard().dancers.map((d) => {
  const p = rotP(d.x, d.y, d.heading * 180 / Math.PI, 90);
  return { ...d, x: Math.round(p.x), y: Math.round(p.y), heading: p.h * Math.PI / 180 };
});
const rHPT = seq.applyToBoard({ dancers: rotated }, 'Heads Pass Thru');
const startR = Object.fromEntries(rotated.map((d) => [d.id, d]));
const movedIds = rHPT.board.dancers.filter((d) => Math.hypot(d.x - startR[d.id].x, d.y - startR[d.id].y) > 0.01)
  .map((d) => d.id).sort((a, b) => a - b);
const expectedHeads = rotated.filter((d) => d.couple % 2 === 1).map((d) => d.id).sort((a, b) => a - b);
check(JSON.stringify(movedIds) === JSON.stringify(expectedHeads),
  `Heads Pass Thru on a rotated square moves the ORIGINAL heads (moved=[${movedIds}], expect=[${expectedHeads}])`);

console.log('\n=================');
if (failures === 0) console.log('SEQUENCER TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
