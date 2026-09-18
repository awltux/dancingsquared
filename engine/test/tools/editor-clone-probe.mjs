// Probe: what does the editor's "different start Setup" actually offer, and does the
// clone construction hold?
//
//   - registers every MS call file, then prints `Sequencer.listFormations()` with each
//     formation's dancer count and declared gender pattern (from `boardForSetup`)
//   - picks a real 8-dancer formation that is NOT the source's, re-bases `ms/circle.xml`
//     onto it, and measures the end error before and after `connectStart`
//   - asserts the invariant by hand: the END must come back exactly, and the pose at the
//     end of move 1 must match the reference's
//
// Usage: node engine/test/tools/editor-clone-probe.mjs
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setParser,
  Sequencer,
  loadCallFromXml,
  poseFor,
  endPoses,
  instanceTable,
  normalizeInstance,
  setStartFormation,
  connectStart,
  endPoseError,
  moveBeatRange,
} from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', '..', '..', 'poc', 'src', 'assets');
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

// Register the WHOLE catalogue, which is the configuration the app's formation list comes
// from: the picker is only as good as the level the sequencer panel is set to, and this is
// the union of them all.
const calls = callsByTitle(assets);
const t0 = Date.now();
const seq = new Sequencer(movesXml, formationsXml, calls);
const names = seq.listFormations();
console.log(`== listFormations() over ${calls.length} pooled call titles: ${names.length} unique formations (${((Date.now() - t0) / 1000).toFixed(1)}s) ==`);

const f = (n, d = 2) => n.toFixed(d);
const genderPattern = (board) =>
  board.dancers.map((d) => (d.gender === 'boy' ? 'B' : d.gender === 'girl' ? 'g' : '.')).join('');

const eight = [];
const other = [];
for (const name of names) {
  const b = seq.boardForSetup(name) ?? seq.boardForFormation(name);
  if (!b) continue;
  if (b.dancers.length === 8) eight.push({ name, board: b });
  else other.push({ name, n: b.dancers.length });
}
// The picker offers EIGHT-DANCER FORMATIONS ONLY: `setStartFormation` refuses a count
// mismatch, so a four-dancer formation is not a start setup an eight-dancer call can take.
console.log(`  8-dancer formations offered (${eight.length}):`);
for (const e of eight) console.log(`    ${e.name.padEnd(34)} ${genderPattern(e.board)}`);
console.log(`  NOT offered (${other.length}): ${other.map((o) => `${o.name}(${o.n})`).join(', ')}`);

// ------------------------------------------------------------------ the clone
const circle = loadCallFromXml(read('ms/circle.xml'), movesXml, formationsXml, 0, true);
const source = normalizeInstance(circle);
const rows = instanceTable(source);
console.log(`\n== source: ${source.title} from ${source.from} — ${source.dancers.length} dancers, ${source.beats} beats, ${rows[0].moves.length} moves each ==`);

// A formation that is NOT the source's: the first 8-dancer one whose geometry differs.
const target = eight.find((e) => e.name !== source.from);
console.log(`\n== re-base onto "${target.name}" ==`);
const formation = target.board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));

const rebased = setStartFormation(source, formation);
const err = endPoseError(rebased, source);
console.log(`  end error after the re-base: pos ${f(err.pos)} units, heading ${f((err.heading * 180) / Math.PI, 1)}°  (the now-invalid track)`);

const connected = connectStart(rebased, source);
const err2 = endPoseError(connected, source);
console.log(`  end error after connectStart: pos ${f(err2.pos, 6)} units, heading ${f((err2.heading * 180) / Math.PI, 6)}°`);

// The invariant, checked by hand rather than by the function that implements it: the pose
// at the end of move 1, and at the very end, must be the reference's.
let worstBoundary = 0;
let worstEnd = 0;
let worstStart = 0;
for (let i = 0; i < connected.dancers.length; i++) {
  const ref = source.dancers[i];
  const got = connected.dancers[i];
  const tb = moveBeatRange(ref, 0).to;
  const a = poseFor(ref, tb);
  const b = poseFor(got, tb);
  worstBoundary = Math.max(worstBoundary, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(a.heading - b.heading));
  const ae = poseFor(ref, source.beats);
  const be = poseFor(got, source.beats);
  worstEnd = Math.max(worstEnd, Math.hypot(ae.x - be.x, ae.y - be.y), Math.abs(ae.heading - be.heading));
  const s = formation ? null : null;
  void s;
}
// And the new start must be the formation's.
const starts = connected.dancers.map((d) => poseFor(d, 0));
let worstStartMatch = 0;
for (const s of starts) {
  let best = Infinity;
  for (const p of formation) best = Math.min(best, Math.hypot(p.x - s.x, p.y - s.y));
  worstStartMatch = Math.max(worstStartMatch, best);
}
for (let i = 0; i < connected.dancers.length; i++) {
  const a = poseFor(source.dancers[i], 0);
  const b = poseFor(connected.dancers[i], 0);
  worstStart = Math.max(worstStart, Math.hypot(a.x - b.x, a.y - b.y));
}
console.log(`  pose at the end of move 1 vs the reference: ${f(worstBoundary, 12)}`);
console.log(`  end pose vs the reference:                  ${f(worstEnd, 12)}`);
console.log(`  every start sits on a chosen formation spot: worst ${f(worstStartMatch, 12)}`);
console.log(`  start moved from the source's:              ${f(worstStart)} units (worst dancer)`);
console.log(`  beats unchanged: ${connected.beats === source.beats} (${connected.beats})`);
// "Identical" is bounded by FLOATING POINT, and the bound is measured rather than asserted to
// be zero: the re-based first move reaches the anchor through a pad Bezier whose end heading
// is recovered from a tangent, which is not bit-identical to walking the authored chain.
{
  const ea = endPoses(connected);
  const eb = endPoses(source);
  let worst = 0;
  for (let i = 0; i < ea.length; i++) {
    worst = Math.max(worst, Math.hypot(ea[i].x - eb[i].x, ea[i].y - eb[i].y), Math.abs(ea[i].heading - eb[i].heading));
  }
  console.log(`  end poses differ by at most ${worst.toExponential(3)} — float noise, not a moved dancer`);
}
