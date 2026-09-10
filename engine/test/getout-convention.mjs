// The caller convention in the getout()/fixIt() search.
//
// DECIDED: the engine's own search adopts the caller convention — a get-out succeeds
// by reaching a state from which a standard finish CLOSES the square (`Allemande
// Left`, `Right and Left Grand`, `Promenade` — All8's `--AL` / `--RLG` / `--Prom`),
// not by sitting on the literal home board. See square-dancing.md §9.1 step 5.
//
// HOW IT IS IMPLEMENTED, and why the gates below are shaped this way: the finish is a
// FINAL EDGE, not a looser goal. When a board is one finish away from home the search
// appends that finish to the path it returns, so a returned path still ends on the
// literal home board and every existing consumer (the FSM amendment gate, the UI's
// "apply getout", the older tests) keeps the contract it had. What changes is what the
// search can REACH:
//
//   * `Promenade` is now a usable edge even though it is geometry-derived and absent
//     from the catalog, which is what makes a promenade-finish get-out findable;
//   * a board one finish away is no longer a dead end.
//
// The safety property this gate exists for: adopting the convention must never make a
// path claim to resolve when it does not. Every path this file accepts is replayed
// through the Sequencer's own interactive apply and must end on the home board with
// every dancer back on its OWN spot and facing, compared by identity.
//
// Run: `npm run build && node test/getout-convention.mjs` from engine/.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, STANDARD_FINISHES } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
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
const corpus = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'all8-getouts.json'), 'utf8'));

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);

const HOME = seq.startBoard();
const homeById = new Map(HOME.dancers.map((d) => [d.id, d]));

/** Every dancer on its OWN home spot (position and facing), compared by identity. */
function onHome(board) {
  if (board.dancers.length !== HOME.dancers.length) return `dancer count ${board.dancers.length}`;
  for (const d of board.dancers) {
    const h = homeById.get(d.id);
    if (!h) return `no home dancer ${d.id}`;
    if (Math.abs(d.x - h.x) > 1e-6 || Math.abs(d.y - h.y) > 1e-6) {
      return `dancer ${d.id} at (${d.x.toFixed(2)},${d.y.toFixed(2)}), home is (${h.x},${h.y})`;
    }
    if (Math.abs(d.heading - h.heading) > 1e-6) return `dancer ${d.id} is not facing home`;
  }
  return null;
}

/** Play a path the way a caller's next click does: through the Sequencer. */
function play(start, calls) {
  seq.setBoard(start);
  for (const name of calls) {
    const step = seq.apply(name);
    if (!step.legal) return { ok: false, reason: `"${name}" not legal here: ${step.reason}` };
  }
  return { ok: true, board: seq.startBoard() };
}

/** A getout must be a path the Sequencer can play to home. This is the safety gate
 * every other check in this file leans on. */
function acceptPath(label, start, path) {
  const played = play(start, path);
  if (!played.ok) { fail(`${label}: returned path does not play: ${played.reason}`); return false; }
  const off = onHome(played.board);
  if (off) { fail(`${label}: returned path does not end home: ${off}`); return false; }
  return true;
}

const boardFor = (id) => startBoardFor(seq, corpus.alignments.find((a) => a.id === id)).board;

// ------------------------------------------- 1. a finish is a usable final edge

console.log('== 1. a finish closes the getout, and is part of the path ==');
// [L.F1p] is a two-faced line whose ONLY published get-out is `--PromH`: nothing else
// in the catalog gets the set home from there, so this is the case that needs the
// geometry-derived resolve to be a search edge at all.
{
  const start = boardFor('L.F1p');
  const before = seq.legalCalls(start).filter((c) => c === 'Promenade');
  if (before.length) fail('[L.F1p]: Promenade is in legalCalls, so this is not a search-edge test');
  seq.setBoard(start);
  const path = seq.getout({ target: 'Static Square', maxCalls: 3, budget: 400 });
  if (!path) fail('[L.F1p]: no getout found (the promenade edge is not being used)');
  else if (!STANDARD_FINISHES.includes(path[path.length - 1])) {
    fail(`[L.F1p]: getout [${path.join(' > ')}] does not close with a standard finish`);
  } else if (acceptPath('[L.F1p]', start, path)) {
    ok(`[L.F1p] (${seq.knownFormation(start)}) -> [${path.join(' > ')}]`);
  }
}
// A board one finish away must be closed, not treated as a dead end: from home,
// everything is a zero, so take a single call away and ask.
{
  const start = boardFor('L1p');
  seq.setBoard(start);
  const path = seq.getout({ target: 'Static Square', maxCalls: 3, budget: 400 });
  if (!path) fail('[L1p]: no getout found');
  else if (acceptPath('[L1p]', start, path)) ok(`[L1p] -> [${path.join(' > ')}]`);
}

// ---------------------------------------- 2. maxCalls bounds the returned path

console.log('\n== 2. maxCalls bounds the path, the appended finish included ==');
for (const maxCalls of [1, 2, 3]) {
  seq.setBoard(boardFor('L1p'));
  const path = seq.getout({ target: 'Static Square', maxCalls, budget: 400 });
  if (path && path.length > maxCalls) fail(`maxCalls=${maxCalls} returned ${path.length} calls: [${path.join(' > ')}]`);
  else ok(`maxCalls=${maxCalls} -> ${path ? `[${path.join(' > ')}]` : 'null'}`);
}

// ------------------------------------- 3. the convention does not loosen the goal

console.log('\n== 3. the convention adds an edge; it never loosens what "resolved" means ==');
// A getout() call costs seconds here — the candidate list is the whole ~2200-title
// catalog, and a board that has NO getout makes the search spend its whole budget
// proving it. So this sweeps the boards that DO have one, at a small budget, and the
// negatives are pinned by the promenade rule directly (below) rather than by search.
const SAMPLE = [
  ['L.F1p', 'a promenade-finish alignment (its only published get-out is --PromH)'],
  ['L1p', 'facing lines in sequence'],
  ['W1p', 'right-hand waves in sequence'],
  ['F1p', 'right-hand two-faced lines in sequence'],
  ['B1c', 'the zero box'],
];
let sampled = 0, found = 0, closedByFinish = 0;
for (const [id, why] of SAMPLE) {
  const start = boardFor(id);
  if (!start) { fail(`[${id}]: no start board (${why})`); continue; }
  sampled++;
  seq.setBoard(start);
  const path = seq.getout({ target: 'Static Square', maxCalls: 3, budget: 60 });
  if (!path) { fail(`[${id}] no getout found (${why})`); continue; }
  found++;
  if (!acceptPath(`[${id}]`, start, path)) continue;
  const body = play(start, path.slice(0, -1));
  const viaFinish = STANDARD_FINISHES.includes(path[path.length - 1]) && !(body.ok && onHome(body.board));
  if (viaFinish) closedByFinish++;
  ok(`[${id}] -> [${path.join(' > ')}]${viaFinish ? '  (closed by the finish)' : ''}`);
}
console.log(`  ${found} of ${sampled} sampled alignments have a getout; ${closedByFinish} needed the finish`);
// The floor is the measured result of this step (all five). It may only go up; a fall
// means the finish edge or the search regressed.
if (found < SAMPLE.length) fail(`only ${found} of ${sampled} sampled alignments have a getout`);

// The other direction: the [B] boxes our reading of All8's own diagrams refuses a
// promenade from must STAY refused. If they ever start resolving by promenade, the
// recorded disagreement has been papered over rather than settled.
console.log('\n== 3b. the recorded [B]-box disagreement is not silently resolved ==');
for (const id of ['B2r', 'B2p', 'B4c']) {
  const start = boardFor(id);
  if (!start) { fail(`[${id}]: no start board`); continue; }
  const r = seq.applyToBoard(start, 'Promenade');
  if (r.legal) fail(`[${id}]: a promenade is now legal from this box - the open question was answered by accident`);
  else ok(`[${id}]: promenade still refused (${(r.reason ?? '').slice(0, 58)}...)`);
}

// ------------------------------------------------- 4. non-home targets unaffected

console.log('\n== 4. a non-home target is reached literally, with no finish appended ==');
{
  // Shallow on purpose (one call): a search for a target with no finish shortcut is
  // expensive, and the property being pinned is structural - `goalFinish` consults the
  // finishes only for the home target.
  const start = boardFor('L1p');
  seq.setBoard(start);
  const path = seq.getout({ target: 'Facing Couples', maxCalls: 1, budget: 20 });
  if (!path) ok('no one-call path to Facing Couples (fine: the target has no finish shortcut)');
  else if (path.some((c) => STANDARD_FINISHES.includes(c))) fail(`a finish was appended to a non-home target: [${path.join(' > ')}]`);
  else {
    const played = play(start, path);
    if (!played.ok) fail(`non-home path does not play: ${played.reason}`);
    else if (seq.matchesNamed(played.board, 'Facing Couples')) ok(`[Facing Couples] -> [${path.join(' > ')}] reached literally`);
    else fail(`non-home path does not reach Facing Couples (ends as ${seq.knownFormation(played.board)})`);
  }
}

// --------------------------------------------------------- 5. fixIt agrees

console.log('\n== 5. fixIt uses the same goal ==');
{
  // depth 0 = "which calls lead to a goal" with no further lookahead. Deeper values
  // re-enumerate the whole catalog per node AND per candidate (equivalents widening is
  // quadratic in the catalog), which takes minutes - a pre-existing cost, recorded as
  // an open item. What is pinned here is only that the goal fixIt tests is the same one
  // the search uses: a call leading to a state the finish closes counts as a fix.
  const start = boardFor('L.F1p');
  seq.setBoard(start);
  const fixes = seq.fixIt({ target: 'Static Square', depth: 0 });
  if (!fixes.length) fail('[L.F1p]: fixIt offers nothing, though a getout exists from here');
  else ok(`[L.F1p]: fixIt keeps the getout alive via [${fixes.slice(0, 5).join(', ')}${fixes.length > 5 ? '...' : ''}]`);
  seq.setBoard(HOME);
  const fromHome = seq.fixIt({ target: 'Static Square', depth: 0 });
  if (!fromHome.length) fail('fixIt from home offers nothing');
  else ok(`from home: fixIt offers ${fromHome.length} call(s)`);
}

// --------------------------------------------- 6. no finish, no false success

console.log('\n== 6. a board nothing closes from still returns null ==');
{
  // A promenade-able board and a board one finish away are the positive cases; this is
  // the negative one: the set is a squared set in sequence whose couples have been
  // pushed radially outward, which no standard finish closes from.
  const scattered = {
    dancers: HOME.dancers.map((d) => ({ ...d, x: d.x * 3, y: d.y * 3 })),
  };
  seq.setBoard(scattered);
  const path = seq.getout({ target: 'Static Square', maxCalls: 2, budget: 20 });
  if (path) {
    const played = play(scattered, path);
    if (!played.ok || onHome(played.board)) fail('a path was returned but does not do what it claims');
    else ok(`(note) a path was found from a stretched set: [${path.join(' > ')}]`);
  } else ok('null, as it should be (nothing there closes the square)');
}

console.log('\n=================');
console.log(failures === 0 ? 'GETOUT CONVENTION: all gates passed.' : `GETOUT CONVENTION: ${failures} gate(s) failed.`);
if (failures) process.exitCode = 1;
