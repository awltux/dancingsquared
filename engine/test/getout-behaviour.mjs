// Step 4 of the get-out conformance work: RUN the published get-outs.
//
// Steps 1-3 made every alignment nameable and constructible. This finally asks the
// question the corpus exists to answer: **how far does the engine actually get
// through All8's published get-outs, and where exactly does it stop?**
//
// WHAT THIS IS: a diagnostic report, not a conformance gate. The corpus is taken as
// correct, so every stop is an engine deficiency; the deliverable is to make each one
// EXPRESSIBLE and CLASSIFIED rather than to chase individual calls. So the numbers
// below are findings. The only things treated as failures are structural: a start
// board that cannot be built, a harness that cannot run at all, or a contradiction
// inside our own model.
//
// METHOD, per published line:
//   1. start from the board All8's own diagram for that alignment describes, rebuilt
//      at the engine's metric (step 3) - so the start state is All8's, not a guess;
//   2. decode the line with the shared abbreviation table (a token we cannot read is
//      reported as undecoded, never guessed);
//   3. apply the calls in order and stop at the first that does not apply, recording
//      WHICH call and WHY;
//   4. if the whole line applies, ask whether the state it reaches is one the standard
//      finish resolves from - the caller-convention criterion agreed for this
//      workstream (reaching a state where --AL / --RLG / --Prom resolves), not the
//      engine's stricter "sitting on the literal home board".
//
// The reason categories matter more than the totals, because they have different
// owners: `unknown call` is a catalogue gap (a call All8 names that the engine does
// not have), `no setup` is an engine gap (the call exists but its setup does not
// match the board it was reached from), and `undecoded` is OUR gap in reading All8.
//
// Run: `npm run build && node test/getout-behaviour.mjs` from engine/.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  setParser,
  Sequencer,
  arrangementFor,
  sequenceFor,
  relationshipStateOf,
  findCodedMove,
  splitSelection,
} from '../dist/index.js';
import { decodeLine } from './lib/getout-decode.mjs';
import { callsByTitle, engineNameFor } from './lib/engine-calls.mjs';
import { startBoardFor } from './lib/all8-boards.mjs';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };

// ------------------------------------------------------------------ the engine

const assets = path.join(root, 'poc/src/assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// ----------------------------------------------------------------- the corpus

const FIXTURE = path.join(__dirname, 'fixtures', 'all8-getouts.json');
if (!existsSync(FIXTURE)) { console.log(`FAIL: no fixture at ${FIXTURE}`); process.exit(1); }
const corpus = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** Classify a failure reason into its owner. */
function reasonKind(reason) {
  if (!reason) return 'other';
  if (/^Unknown call/.test(reason)) return 'unknown call';
  if (/^No setup in this call matches/.test(reason)) return 'no setup';
  if (/selection/i.test(reason)) return 'selection';
  if (/^Module/.test(reason)) return 'module';
  return 'other';
}

/**
 * A geometry-derived call (a coded pivot, or a whole-set resolve such as Promenade)
 * that carries a precondition fails with a sentence of its own rather than one of the
 * applicator's messages, so it needs its own category: it is neither a catalogue gap
 * nor a matching gap. The reason is the engine's own explanation of what about the
 * board makes the call impossible, and on the corpus it is the most informative
 * message in the report.
 */
function isResolvePrecondition(callName) {
  // The name may be group-scoped ("All Promenade", which All8 writes as `A-Prom` and
  // which is just the resolve), so the base name is what carries the precondition.
  const base = splitSelection(callName).call;
  const move = findCodedMove(base);
  return !!(move && move.precondition);
}

/** Calls that finish a square. A get-out's whole point is reaching one of these. */
const RESOLVES = ['Allemande Left', 'Right and Left Grand', 'Promenade'];
const isResolve = (name) => RESOLVES.includes(name);

/**
 * Some "tokens" are not All8 notation at all but prose that leaked into the lists -
 * "Look for", "where N is 0, 1, 2, or 3" - or a bare section marker like "Plus".
 * Counting those as tokens WE cannot read would overstate our own gap and put
 * misleading entries at the top of the decode list, so they are separated out.
 */
const PROSE = /^(Plus|Look|where|and|or|if|the|see|then|Twice|Once)\b/i;
const isProseToken = (token) => /\s/.test(token) || PROSE.test(token);

// ------------------------------------------------ 1. a start board per alignment

console.log('== 1. a start board for every alignment ==');
const setups = [];
for (const a of corpus.alignments) {
  const start = startBoardFor(seq, a);
  if (!start.board) {
    if (!start.spec) console.log(`  skip  ${a.id}: not an FASR id (family ${a.family})`);
    else fail(`${a.id}: cannot build a start board (${start.reason})`);
    continue;
  }
  const { spec, board } = start;
  setups.push({
    alignment: a,
    spec,
    board,
    classified: arrangementFor(board, spec.letter).number === spec.arrangement
      && sequenceFor(board).code === spec.sequence
      && relationshipStateOf(board, spec.letter).code === spec.relationship,
    recognised: seq.knownFormation(board),
  });
}
console.log(`  ${setups.length} of ${corpus.alignments.length} alignments have a start board built from All8's own diagram`);
const classifiedBack = setups.filter((s) => s.classified).length;
console.log(`  ${classifiedBack} of them classify back to their own alignment id (step 3; the rest are the [P] gap)`);
const recognised = new Map();
for (const s of setups) recognised.set(s.recognised ?? '(unrecognised)', (recognised.get(s.recognised ?? '(unrecognised)') ?? 0) + 1);
console.log('  what the engine calls the start boards:');
for (const [name, n] of [...recognised.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${name}`);
if (!setups.length) { fail('no start boards at all - the harness cannot run'); }

// ------------------------------------------------------ 2. run the get-out lines

console.log('\n== 2. running the published get-outs ==');

function runLine(startBoard, line) {
  const decoded = decodeLine(line);
  if (decoded.undecoded !== undefined) {
    return isProseToken(decoded.undecoded)
      ? { outcome: 'prose', token: decoded.undecoded }
      : { outcome: 'undecoded', token: decoded.undecoded };
  }
  const calls = decoded.calls.map((c) => ({ ...c, engine: engineNameFor(c.name) }));
  let board = startBoard;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const r = seq.applyToBoard(board, call.engine);
    if (!r.legal) {
      // A stop on the LAST call, when that call is the finish, is a different
      // finding from a stop in the body: the get-out took the dancers all the way
      // to the state it was written to reach, and only the finish call itself did
      // not apply. Those are cheap to fix and worth separating out.
      const isFinish = i === calls.length - 1 && isResolve(call.engine);
      return {
        outcome: 'stopped',
        call: call.engine,
        published: call.name,
        index: i,
        depth: i + 1,
        reason: r.reason,
        kind: isFinish ? 'FINISH only - body completed'
          : isResolvePrecondition(call.engine) ? 'resolve cannot apply from here'
            : reasonKind(r.reason),
        calls: calls.length,
      };
    }
    board = r.board;
  }
  const resolves = RESOLVES.filter((name) => seq.applyToBoard(board, name).legal);
  const lastIsResolve = calls.length > 0 && isResolve(calls[calls.length - 1].engine);
  return {
    outcome: 'ran',
    board,
    formation: seq.knownFormation(board),
    resolves,
    lastIsResolve,
    calls: calls.length,
  };
}

const LISTS = [['getoutLines', 'published get-out lines'], ['plusLines', 'Plus-level lines']];
const allRuns = [];
for (const [key, label] of LISTS) {
  const total = corpus.alignments.reduce((n, a) => n + (a[key]?.length ?? 0), 0);
  let undecoded = 0, prose = 0, ran = 0, stopped = 0, endsAtFinish = 0, reachesResolve = 0;
  const reasons = new Map();
  const stoppingCalls = new Map();
  const depths = new Map();
  for (const s of setups) {
    for (const line of s.alignment[key] ?? []) {
      const r = runLine(s.board, line);
      allRuns.push({ alignment: s.alignment.id, key, line, ...r });
      if (r.outcome === 'prose') { prose++; continue; }
      if (r.outcome === 'undecoded') { undecoded++; continue; }
      if (r.outcome === 'ran') {
        ran++;
        if (r.lastIsResolve || r.resolves.length) reachesResolve++;
        if (r.lastIsResolve) endsAtFinish++;
        continue;
      }
      stopped++;
      reasons.set(r.kind, (reasons.get(r.kind) ?? 0) + 1);
      stoppingCalls.set(r.call, (stoppingCalls.get(r.call) ?? 0) + 1);
      // Depth is only meaningful for a BODY failure. A one-call get-out that is
      // nothing but a finish would otherwise be counted as "failed at the first
      // call", which reads as "the start board is unusable" when in fact the body
      // did its job.
      if (r.kind !== 'FINISH only - body completed') {
        const bucket = r.depth === 1 ? 'first call' : r.depth <= 3 ? `call ${r.depth}` : 'call 4+';
        depths.set(bucket, (depths.get(bucket) ?? 0) + 1);
      }
    }
  }
  console.log(`\n  ${label}: ${total} lines`);
  console.log(`      ${undecoded} stopped at a token we cannot decode (our gap)`);
  console.log(`      ${prose} are page text rather than a get-out line`);
  console.log(`      ${stopped} decoded but stopped at a call (${(100 * stopped / Math.max(1, undecoded + ran + stopped)).toFixed(0)}% of decoded)`);
  console.log(`      ${ran} ran to the end, of which ${endsAtFinish} ended by applying the finish itself`);
  console.log(`        and ${reachesResolve} in total reach a state the standard finish resolves from`);
  if (reasons.size) {
    console.log('      why they stopped:');
    for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`        ${String(n).padStart(4)}  ${k}`);
  }
  if (depths.size) {
    console.log('      how far into the BODY they stopped (finish-only stops excluded): ' +
      [...depths.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join('  '));
  }
  if (stoppingCalls.size) {
    const top = [...stoppingCalls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    console.log('      most common stopping calls:');
    for (const [c, n] of top) console.log(`        ${String(n).padStart(4)}x  ${c}`);
  }
  if (key === 'getoutLines') {
    console.log('      per alignment (lines that ran to the end / decoded lines):');
    for (const s of setups) {
      const mine = allRuns.filter((r) => r.alignment === s.alignment.id && r.key === 'getoutLines');
      if (!mine.length) continue;
      const dec = mine.filter((r) => r.outcome !== 'undecoded').length;
      const okN = mine.filter((r) => r.outcome === 'ran').length;
      const fin = mine.filter((r) => r.outcome === 'stopped' && r.kind === 'FINISH only - body completed').length;
      const res = mine.filter((r) => r.outcome === 'ran' && (r.lastIsResolve || r.resolves.length)).length;
      const mark = okN === dec && dec > 0 ? 'ok  ' : okN > 0 ? 'part' : dec === 0 ? '--  ' : 'none';
      console.log(`        ${mark}  ${s.alignment.id.padEnd(6)} ${String(okN).padStart(3)}/${String(dec).padStart(3)} ran, ${String(res).padStart(3)} reached a resolve, ${String(fin).padStart(2)} stopped only at the finish`);
    }
  }
}

// ------------------------------------------------------------- 3. the blockers

console.log('\n== 3. the blockers, by owner ==');
// Ordered by how much of the corpus each one accounts for, because that is the order
// they are worth fixing in - and the biggest one is ours, not the engine's.
const unreadTokens = new Map();
for (const r of allRuns) if (r.outcome === 'undecoded') unreadTokens.set(r.token, (unreadTokens.get(r.token) ?? 0) + 1);
const unreadTotal = [...unreadTokens.values()].reduce((a, b) => a + b, 0);
console.log(`  OUR DECODER GAP - ${unreadTotal} lines stop at a token our abbreviation table cannot read.`);
console.log('  This is the biggest single blocker and it is not an engine deficiency, so it is the');
console.log('  cheapest to move: each token below is one line of All8 notation to decode.');
for (const [t, n] of [...unreadTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  console.log(`      ${String(n).padStart(4)}x  ${t}`);
}
console.log(`      (${unreadTokens.size} distinct tokens)`);
const unknownNames = new Map();
const noSetupNames = new Map();
const finishOnly = new Map();
const otherReasons = new Map();
for (const r of allRuns) {
  if (r.outcome !== 'stopped') continue;
  if (r.kind === 'FINISH only - body completed') { finishOnly.set(r.call, (finishOnly.get(r.call) ?? 0) + 1); continue; }
  if (r.kind === 'unknown call') unknownNames.set(r.call, (unknownNames.get(r.call) ?? 0) + 1);
  else if (r.kind === 'no setup') noSetupNames.set(r.call, (noSetupNames.get(r.call) ?? 0) + 1);
  else otherReasons.set(`${r.kind}: ${r.reason ?? ''}`.slice(0, 90), (otherReasons.get(`${r.kind}: ${r.reason ?? ''}`.slice(0, 90)) ?? 0) + 1);
}
console.log('  BODY COMPLETED, ONLY THE FINISH FAILED - the cheapest wins: the get-out reached the');
console.log('  state it was written to reach and the resolve call itself did not apply:');
for (const [name, n] of [...finishOnly.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`      ${String(n).padStart(4)}x  ${name}`);
}
if (!finishOnly.size) console.log('      (none)');
console.log(`      ${[...finishOnly.values()].reduce((a, b) => a + b, 0)} line(s) in this category.`);
console.log('  CATALOGUE GAPS - calls All8 names that the engine does not register at all:');
for (const [name, n] of [...unknownNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`      ${String(n).padStart(4)}x  ${name}`);
}
console.log(`      (${unknownNames.size} distinct call names) - each one is a call to add, and adding it`);
console.log('      unblocks every get-out that stops there.');
console.log('  ENGINE GAPS - the call exists but will not match the board it was reached from:');
for (const [name, n] of [...noSetupNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`      ${String(n).padStart(4)}x  ${name}`);
}
console.log(`      (${noSetupNames.size} distinct call names) - these need the call to match from more`);
console.log('      formations, not merely to exist.');
if (otherReasons.size) {
  console.log('  OTHER (worth a look - neither of the above):');
  for (const [k, n] of [...otherReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`      ${String(n).padStart(4)}x  ${k}`);
}

const firstCallStops = allRuns.filter((r) => r.outcome === 'stopped' && r.depth === 1 && r.kind !== 'FINISH only - body completed').length;
const bodyStops = allRuns.filter((r) => r.outcome === 'stopped' && r.kind !== 'FINISH only - body completed').length;
console.log(`\n  A BODY failure at the very first call is the worst kind: the start board is not`);
console.log(`  usable and the get-out never begins.`);
console.log(`      ${firstCallStops} of ${bodyStops} body failures happen at the very first call`);
console.log(`      (a further ${allRuns.filter((r) => r.outcome === 'stopped' && r.kind === 'FINISH only - body completed').length} stops are finish-only and are counted above, not here)`);

// ------------------------------------------------- 4. what "success" looks like

console.log('\n== 4. how far the published get-outs actually get ==');
// Under the caller convention agreed for this workstream, a get-out succeeds by
// reaching a state the standard finish resolves from - not by sitting on the literal
// home board. So a line that ran and whose own last call WAS the finish has
// succeeded; a line that ran to a state a resolve applies from has also succeeded;
// the rest completed without resolving, which is the interesting third case.
const outcomes = { resolved: [], resolvable: [], completedUnresolved: [], stoppedBody: [], stoppedFinish: [], undecoded: [], prose: [] };
for (const r of allRuns) {
  if (r.outcome === 'prose') outcomes.prose.push(r);
  else if (r.outcome === 'undecoded') outcomes.undecoded.push(r);
  else if (r.outcome === 'stopped') (r.kind === 'FINISH only - body completed' ? outcomes.stoppedFinish : outcomes.stoppedBody).push(r);
  else if (r.lastIsResolve) outcomes.resolved.push(r);
  else if (r.resolves.length) outcomes.resolvable.push(r);
  else outcomes.completedUnresolved.push(r);
}
const total = allRuns.length;
const line = (label, list, note) => console.log(
  `      ${String(list.length).padStart(4)}  ${(100 * list.length / total).toFixed(0).padStart(3)}%  ${label}${note ? `  - ${note}` : ''}`);
console.log(`  of ${total} published lines (get-out and Plus alike):`);
line('reached the finish and applied it', outcomes.resolved, 'SUCCESS by the caller convention');
line('reached a state a finish resolves from', outcomes.resolvable, 'SUCCESS by the caller convention');
line('completed the body but did not resolve', outcomes.completedUnresolved, 'body ran; end state not a finish state');
line('stopped only at the finish', outcomes.stoppedFinish, 'body ran; the resolve call itself would not apply');
line('stopped part-way through the body', outcomes.stoppedBody, 'the real coverage gap');
line('stopped at a token we cannot decode', outcomes.undecoded, 'our gap in reading All8');
line('page text, not a get-out line', outcomes.prose, 'not a conformance datum at all');
console.log('\n  The end states of the completed-but-unresolved lines, by what the engine calls them:');
const unresolved = new Map();
for (const r of outcomes.completedUnresolved) unresolved.set(r.formation ?? '(unrecognised)', (unresolved.get(r.formation ?? '(unrecognised)') ?? 0) + 1);
for (const [k, n] of [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`      ${String(n).padStart(4)}  ${k}`);

console.log('\n=================');
console.log(failures === 0
  ? 'GETOUT BEHAVIOUR: report complete (this is a diagnostic, not a gate).'
  : `GETOUT BEHAVIOUR: ${failures} structural failure(s).`);
if (failures) process.exitCode = 1;
