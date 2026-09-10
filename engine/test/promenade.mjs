// Promenade — the standard finish — and the corpus evidence for it.
//
// WHY THIS EXISTS: All8's published corpus indexes its get-outs by alignment and
// typically ends them at a conventional finish (`--AL`, `--RLG`, `--Prom`). The
// engine had Allemande Left and Right and Left Grand, but bare `Promenade` was a
// call it KNEW (assets/src/calls.xml indexes it) and could not PERFORM: the shipped
// promenade.xml implements only the qualified forms (Heads Promenade 1/2, Sides
// Promenade Full, Star Promenade, ...). Every get-out that finishes with `--Prom`
// therefore stopped with "Unknown call" once its body had already reached the state
// it was written to reach.
//
// The rule implemented in src/sequencer/promenade.ts is Taminations' own, and the
// gates below hold it to the corpus rather than to that description:
//
//   * a promenade returns the LITERAL home squared set — every dancer back on its
//     own spot and facing — from any rotated squared set, and from the formations the
//     corpus actually promenades out of (facing lines, two-faced lines);
//   * it refuses a set that cannot be promenaded home, and says which way it fails:
//     couples permuted round the ring (out of sequence), couples not one per side of
//     the square, partners not standing together as a couple, or no home identity at
//     all;
//   * the analyser neither teleports a board home for a promenade that does not apply
//     nor counts one as a "zero" it is not.
//
// Run: `npm run build && node test/promenade.mjs` from engine/.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, promenadeHome, PROMENADE_BEATS } from '../dist/index.js';
import { callsByTitle, engineNameFor } from './lib/engine-calls.mjs';
import { decodeLine } from './lib/getout-decode.mjs';
import { startBoardFor } from './lib/all8-boards.mjs';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const assets = path.join(root, 'poc/src/assets');

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);
const flip = (h) => (h > Math.PI ? 2 * Math.PI : 0) + h;const face = (h) => Math.round((((h * 180) / Math.PI) % 360 + 360) % 360);

/** Exact-pose comparison by dancer id: position and facing, both to zero tolerance. */
function sameBoard(a, b) {
  if (a.dancers.length !== b.dancers.length) return `dancer count ${a.dancers.length} vs ${b.dancers.length}`;
  const byId = new Map(b.dancers.map((d) => [d.id, d]));
  for (const d of a.dancers) {
    const e = byId.get(d.id);
    if (!e) return `no dancer ${d.id} in the expected board`;
    if (Math.abs(d.x - e.x) > 1e-9 || Math.abs(d.y - e.y) > 1e-9) {
      return `dancer ${d.id} at (${d.x.toFixed(2)},${d.y.toFixed(2)}), expected (${e.x.toFixed(2)},${e.y.toFixed(2)})`;
    }
    if (face(d.heading) !== face(e.heading)) return `dancer ${d.id} facing ${face(d.heading)}, expected ${face(e.heading)}`;
  }
  return null;
}

/** Rotate a board by k quarter-turns counter-clockwise (a rotation, never a mirror). */
function rotated(board, k) {
  return {
    dancers: board.dancers.map((d) => {
      let { x, y } = d;
      for (let i = 0; i < k; i++) [x, y] = [-y, x];
      return { ...d, x, y, heading: flip(d.heading + (k * Math.PI) / 2) };
    }),
  };
}

const home = seq.startBoard();

// ------------------------------------------------------- 1. home, and rotations of it

console.log('== 1. a promenade returns the literal home squared set ==');
for (const turns of [0, 1, 2, 3]) {
  const from = rotated(home, turns);
  const r = seq.applyToBoard(from, 'Promenade');
  if (!r.legal) { fail(`a squared set rotated ${turns * 90} degrees: ${r.reason}`); continue; }
  const diff = sameBoard(r.board, home);
  if (diff) { fail(`a squared set rotated ${turns * 90} degrees promenaded to the wrong board: ${diff}`); continue; }
  if (seq.knownFormation(r.board) !== 'Static Square') fail(`rotated ${turns * 90} degrees: ends as ${seq.knownFormation(r.board)}`);
  else ok(`squared set rotated ${turns * 90} degrees -> every dancer back on its own spot and facing`);
}
// The alias All8 writes as --PromH.
{
  const r = seq.applyToBoard(home, 'Promenade Home');
  const diff = r.legal ? sameBoard(r.board, home) : r.reason;
  if (diff) fail(`"Promenade Home" from home: ${diff}`); else ok('"Promenade Home" is the same call');
}

// ------------------------------------------- 2. the formations the corpus promenades out of

console.log('\n== 2. the corpus promenades out of formations that are not squared sets ==');
// All8's [L.F1p] page has exactly one get-out: "--PromH", with no body at all. So the
// start board of that alignment IS a board All8 says promenades home, and it is a
// two-faced line, not a squared set.
const corpus = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'all8-getouts.json'), 'utf8'));
const pure = corpus.alignments.find((a) => a.id === 'L.F1p');
if (!pure) fail('the corpus no longer has the [L.F1p] alignment');
else {
  const start = startBoardFor(seq, pure);
  if (!start.board) fail(`[L.F1p]: ${start.reason}`);
  else {
    const before = seq.knownFormation(start.board);
    const r = seq.applyToBoard(start.board, 'Promenade');
    const diff = r.legal ? sameBoard(r.board, home) : r.reason;
    if (diff) fail(`[L.F1p] ("--PromH" and nothing else): ${diff}`);
    else ok(`[L.F1p] (${before}) promenades home with no body at all`);
  }
}
// Facing lines in sequence: the couples are together and one per quadrant, so the
// dancers form up and promenade. This is a positive case the engine must NOT reject.
for (const id of ['L1p', 'W1p', 'F1p']) {
  const a = corpus.alignments.find((x) => x.id === id);
  if (!a) { fail(`the corpus no longer has [${id}]`); continue; }
  const start = startBoardFor(seq, a);
  const r = start.board ? seq.applyToBoard(start.board, 'Promenade') : { legal: false, reason: start.reason };
  if (!r.legal) { fail(`[${id}] (${start.board ? seq.knownFormation(start.board) : '?'}) cannot promenade home: ${r.reason}`); continue; }
  const diff = sameBoard(r.board, home);
  if (diff) fail(`[${id}] promenaded to the wrong board: ${diff}`);
  else ok(`[${id}] (${seq.knownFormation(start.board)}) promenades home`);
}

// ------------------------------------------------------ 3. what it must refuse, and why

console.log('\n== 3. the boards a promenade must refuse ==');
const refused = (label, board, expect) => {
  const r = seq.applyToBoard(board, 'Promenade');
  if (r.legal) { fail(`${label}: accepted, but should not be`); return; }
  if (!r.reason || !expect.test(r.reason)) { fail(`${label}: refused for the wrong reason: ${r.reason}`); return; }
  ok(`${label}: refused — ${r.reason}`);
};

// (a) the couples permuted round the ring: no single wheeling brings everybody home.
{
  const swapped = { dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, couple: 2 } : d.couple === 2 ? { ...d, couple: 1 } : { ...d })) };
  refused('couples 1 and 2 swapped round the ring', swapped, /out of sequence/);
}
// (b) two couples on the same side of the square: there is no ring to promenade.
{
  const bunched = {
    dancers: home.dancers.map((d) => (d.couple === 4 ? { ...d, x: d.x + 4, y: d.y + 4.5 } : { ...d })),
  };
  refused('couples 3 and 4 both on the north side', bunched, /not spread one per side/);
}
// (c) partners not standing together: this is the guard that stops a broken body
//     being laundered into a success (see section 4).
refused('partners 4 apart', {
  dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, x: d.x * 2 } : { ...d })),
}, /not standing as a couple/);
refused('partners on the same spot', {
  dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, x: d.x / 8 } : { ...d })),
}, /not standing as a couple/);
// (d) no home identity: a template board has couples but no couple NUMBERS, and
//     "promenade home" is only meaningful against the dancers' own home spots.
{
  const template = seq.boardForFormation('Normal Lines');
  if (!template) fail('no "Normal Lines" template board');
  else refused('a Formation-tab template (no home identity)', template, /identity/);
}
// (e) All8's [B2r] box: an alignment whose page lists "G-UTurn --Prom", but whose
//     couple layout in All8's own diagram is the MIRROR of the home square (couples
//     3,2,1,4 counter-clockwise where home is 1,2,3,4). No rotation of that board
//     reaches the home square, so this finish cannot be identity-preserving. Recorded
//     as a finding, not silently accepted — see square-dancing.md.
{
  const a = corpus.alignments.find((x) => x.id === 'B2r');
  const start = a ? startBoardFor(seq, a) : { reason: 'no [B2r] in the corpus' };
  if (!start.board) fail(`[B2r]: ${start.reason}`);
  else {
    const g = seq.applyToBoard(start.board, 'Girls U-Turn Back');
    if (!g.legal) fail(`[B2r] "Girls U-Turn Back": ${g.reason}`);
    else refused('[B2r] after "Girls U-Turn Back"', g.board, /out of sequence/);
  }
}

// ------------------------------------------------------------ 4. the analyser agrees

console.log('\n== 4. the analyser: beats, no teleport, and no false zero ==');
if (seq.sequenceBeats(['Promenade']) !== PROMENADE_BEATS) fail('sequenceBeats(["Promenade"]) is not the coded beat count');
else ok(`a promenade occupies ${PROMENADE_BEATS} beats on the timeline`);
if (!seq.isZero(['Promenade'])) fail('a promenade from home is not reported as a zero');
else ok('a promenade from home is a zero (it returns home in sequence, facing restored)');
{
  // Interpolate from a board that is NOT home, or the test would compare home to
  // home at every beat and prove nothing: [L.F1p]'s start board is a two-faced line,
  // and All8's own page for it says the promenade finish works from there.
  const from = startBoardFor(seq, corpus.alignments.find((x) => x.id === 'L.F1p')).board;
  const half = seq.evaluateSequence(['Promenade'], PROMENADE_BEATS / 2, from).board;
  const diff = sameBoard(half, home);
  if (!diff) fail('the board half way through a promenade is already home (it should be in motion)');
  else ok('half way through a promenade the board is in motion, not home');
  const endDiff = sameBoard(seq.evaluateSequence(['Promenade'], PROMENADE_BEATS, from).board, home);
  if (endDiff) fail(`at the last beat of a promenade the board is not home: ${endDiff}`);
  else ok('at the last beat of a promenade the board is exactly home');
}
// A promenade that does not apply must not teleport the board home mid-replay.
{
  const box = startBoardFor(seq, corpus.alignments.find((x) => x.id === 'B2r'));
  const g = seq.applyToBoard(box.board, 'Girls U-Turn Back');
  const ev = seq.evaluateSequence(['Promenade'], PROMENADE_BEATS, g.board);
  const diff = sameBoard(ev.board, g.board);
  if (diff) fail(`a promenade that does not apply teleported the board: ${diff}`);
  else ok('a promenade that does not apply leaves the replay where it was');
  // isZero always replays from the home set, so the false-zero case is checked the
  // other way round: a board the promenade cannot finish from is not home, so a
  // sequence that reaches it must not report a zero.
  if (seq.isZero(['Promenade', 'Girls U-Turn Back'])) fail('"Promenade, Girls U-Turn Back" was reported as a zero');
  else ok('a sequence whose promenade cannot apply is not reported as a zero');
}

// ------------------------------------------------- 5. the published corpus, measured

console.log('\n== 5. every published get-out that ends in Promenade, replayed ==');
// For each published line whose LAST call is the finish, play the body and then ask
// for the finish. Two things must hold whatever the outcome: an applied finish lands
// on the literal home board (never somewhere else), and a refused one says why.
const FINISHES = ['Promenade', 'Promenade Home'];
const outcomes = { resolved: [], refused: [], stoppedBody: [] };
for (const a of corpus.alignments) {
  const start = startBoardFor(seq, a);
  if (!start.board) continue;
  for (const key of ['getoutLines', 'plusLines']) {
    for (const line of a[key] ?? []) {
      const decoded = decodeLine(line);
      if (decoded.undecoded !== undefined || !decoded.calls.length) continue;
      const calls = decoded.calls.map((c) => engineNameFor(c.name));
      if (!FINISHES.includes(calls[calls.length - 1])) continue;
      let board = start.board, bodyRan = true;
      for (const call of calls.slice(0, -1)) {
        const r = seq.applyToBoard(board, call);
        if (!r.legal) { bodyRan = false; break; }
        board = r.board;
      }
      if (!bodyRan) { outcomes.stoppedBody.push({ id: a.id, line }); continue; }
      const r = seq.applyToBoard(board, calls[calls.length - 1]);
      if (!r.legal) { outcomes.refused.push({ id: a.id, line, reason: r.reason }); continue; }
      const diff = sameBoard(r.board, home);
      if (diff) { fail(`${a.id} "${line.trim()}": the finish landed somewhere other than home: ${diff}`); continue; }
      outcomes.resolved.push({ id: a.id, line });
    }
  }
}
const total = outcomes.resolved.length + outcomes.refused.length + outcomes.stoppedBody.length;
console.log(`  ${total} published lines end in a promenade finish`);
console.log(`      ${outcomes.resolved.length} promenade home (the finish applies)`);
console.log(`      ${outcomes.refused.length} body ran but the finish does not apply here`);
console.log(`      ${outcomes.stoppedBody.length} stop earlier in the body (not this workstream)`);
console.log('  the refusals, by reason — these are bodies that reach a state a promenade');
console.log('  cannot finish from, i.e. either our own body bugs or a real open question:');
const byReason = new Map();
for (const r of outcomes.refused) {
  const key = /not standing as a couple/.test(r.reason) ? 'partners not together (broken body)'
    : /out of sequence/.test(r.reason) ? 'couples out of sequence'
      : /not spread one per side/.test(r.reason) ? 'couples not one per side'
        : `other: ${r.reason}`;
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`        ${String(n).padStart(3)}  ${k}`);
for (const r of outcomes.refused) console.log(`        [${r.id}] ${r.line.trim().slice(0, 52)}`);
if (outcomes.refused.some((r) => !r.reason)) fail('a refusal came back with no reason');
// The floor is the measured result of this work: 12 of the 21 lines whose body runs to
// the finish. It may only go up — a fall means the promenade rule or a body call
// regressed, and a rise means a body call was fixed (update this number deliberately).
if (outcomes.resolved.length < 12) {
  fail(`only ${outcomes.resolved.length} published promenade get-outs resolve; 12 did when this gate was written`);
}

console.log('\n=================');
console.log(failures === 0 ? 'PROMENADE: all gates passed.' : `PROMENADE: ${failures} gate(s) failed.`);
if (failures) process.exitCode = 1;
