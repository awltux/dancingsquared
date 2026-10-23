// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/src/index.ts.
// DOES THE CORPUS WALK DANCERS THROUGH EACH OTHER? Corpus-wide, both body models side by side.
//
// WHY THIS TOOL EXISTS. `sequence-anim-collision-scan.mjs` asks the same question with a
// CENTRE-DISTANCE measure, and that measure cannot answer it: a dancer is not round. Two dancers 0.5
// apart facing the SAME way do not overlap (a body is only 0.5 deep) while two 0.5 apart FACING EACH
// OTHER overlap by 0.25, and a centre distance gives one number for both. The delta between this scan
// and that one IS the finding: the centre-distance census reports 0 modules with coincident dancers
// where the oriented model reports 723 (45.8%) overlapping.
//
// WHAT IT PRINTS, and why each part matters:
//   * both models' threshold sweeps. They are what shows 1.0 to be the wrong constant for either —
//     at a centre distance of 1.0 this refuses 704 of 1580 modules (44.6%), which is every legitimate
//     Dosado, because a Dosado pair is authored to pass at exactly 1.000.
//   * the penetration-depth distribution. `BODY_PATH_CLEARANCE` was chosen from it, and the choice is
//     pinned here rather than restated: the distribution is a long tail with NO clean band, which is
//     why the guard's threshold is contact (zero) rather than a number picked out of the histogram.
//   * the offending pair and beat for the worst modules, so a report names a witness rather than a
//     number.
//
// THE THRESHOLDS ARE IMPORTED FROM THE ENGINE, not typed in, so this instrument cannot drift into
// reporting a cut the engine does not enforce.
//
// Usage: node engine/test/tools/body-collision-scan.mjs
//
// Runs the REAL module corpus. Sampling is every 0.5 beat, deliberately the same grid the engine's own
// guard uses (`applicator.ts`'s `authoredPathGap`), so a threshold measured here is the threshold the
// guard enforces rather than a number from a different experiment.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  boardForFasrCode,
  FORMATIONS_FOR_LETTER,
  bodyGap,
  BODY_PATH_CLEARANCE,
  BODY_COLLISION_MIN,
} from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = corpusRoot();
const s = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = s.boardForFormation(n); if (b) return b; }
  return null;
};
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

/** The closest pair on a board by CENTRE DISTANCE — the old measure, kept for the comparison. */
const closestCentre = (board) => {
  const ds = board.dancers.filter((d) => !d.isGhost);
  let m = Infinity;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};

/** The closest pair on a board by BODY SEPARATION. Negative means the bodies overlap. */
const closestBody = (board) => {
  const ds = board.dancers.filter((d) => !d.isGhost);
  let m = Infinity, who = '';
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const g = bodyGap(ds[i], ds[j]);
      if (g < m) { m = g; who = `${ds[i].id}+${ds[j].id}`; }
    }
  }
  return { gap: m, who };
};

const STEP = 0.5;
const mods = [];
for (const file of walkJson(path.join(root, 'modules'))) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const code = START[mod.startFormation?.trim().toLowerCase()];
  const start = code === null
    ? s.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = s.flatten(mod.steps);
  const beats = s.sequenceBeats(flat, start);
  if (beats <= 0) continue;

  let centre = Infinity, body = Infinity, at = 0, who = '';
  for (let b = 0; b <= beats + 1e-9; b += STEP) {
    const board = s.evaluateSequence(flat, Math.min(b, beats), start).board;
    centre = Math.min(centre, closestCentre(board));
    const c = closestBody(board);
    if (c.gap < body) { body = c.gap; at = b; who = c.who; }
  }
  mods.push({ rel: path.relative(root, file).replace(/\\/g, '/'), centre, body, at, who, beats });
}

const bucket = (vals, lo, hi) => vals.filter((v) => v >= lo && v < hi).length;

const report = (label, key, thresholds) => {
  const v = mods.map((m) => m[key]);
  console.log(`\n=== ${label} ===`);
  console.log('  threshold   modules refused   share');
  for (const T of thresholds) {
    const n = v.filter((x) => x < T).length;
    console.log(`    ${String(T).padStart(5)}       ${String(n).padStart(4)} of ${mods.length}       ${((n / mods.length) * 100).toFixed(1)}%`);
  }
  const edges = [-0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  console.log('  distribution:');
  for (let i = 0; i < edges.length - 1; i++) {
    const n = bucket(v, edges[i], edges[i + 1]);
    const tag = edges[i + 1] <= 0 ? '  (OVERLAP)' : '';
    console.log(`    [${edges[i].toFixed(1)},${edges[i + 1].toFixed(1)})  ${'#'.repeat(Math.ceil(n / 12)).padEnd(22)} ${n}${tag}`);
  }
  console.log(`    [1.0,inf)  ${'#'.repeat(Math.ceil(v.filter((x) => x >= 1.0).length / 12)).padEnd(22)} ${v.filter((x) => x >= 1.0).length}`);
};

console.log(`${mods.length} module(s) with beats, sampled every ${STEP} beat`);
report('CENTRE DISTANCE (the old measure)', 'centre', [1.0, 0.8, 0.6, 0.4, 0.2, 0.1, 0.0]);
report('ORIENTED BODY, 1.0 wide x 0.5 deep (the model)', 'body', [1.0, 0.8, 0.6, 0.4, 0.2, 0.15, 0.1, 0.0, -0.25, -0.5]);

const overlapping = mods.filter((m) => m.body < 0);
console.log(`\n=== modules whose BODIES overlap (body gap < 0): ${overlapping.length} of ${mods.length} (${((overlapping.length / mods.length) * 100).toFixed(1)}%) ===`);
console.log('  worst 25 by penetration depth:');
for (const m of overlapping.sort((a, b) => a.body - b.body).slice(0, 25)) {
  console.log(`    body ${m.body.toFixed(3)} (centre ${m.centre.toFixed(3)})  @${m.at.toFixed(1)}/${m.beats.toFixed(1)}b  ${m.who}  ${m.rel}`);
}
console.log(`\n  centre distance is BLIND to these: modules that clear 1.0 by centre but OVERLAP as bodies: ${
  mods.filter((m) => m.centre >= 1.0 && m.body < 0).length}`);
console.log(`  modules the path guard (BODY_PATH_CLEARANCE = ${BODY_PATH_CLEARANCE}) would refuse: ${
  mods.filter((m) => m.body < BODY_PATH_CLEARANCE).length}`);
// NOT the same question as the endpoint threshold, and deliberately not labelled as if it were: this
// counts modules whose PATH minimum is under the endpoint constant. A module can qualify here with both
// endpoints clean (the squared-set Dosado is exactly that), so it shows how much a path-level reading
// adds over an endpoint one rather than predicting refusals.
console.log(`  ...and modules whose PATH minimum is under BODY_COLLISION_MIN = ${BODY_COLLISION_MIN}: ${
  mods.filter((m) => m.body < BODY_COLLISION_MIN).length}`);
