// ============================================================================================
// THE TARGET SUITE for All8's published Mainstream singing-call figures (fig_m.htm).
//
// THIS HARNESS IS DELIBERATELY NOT PART OF `verify` OR `verify:light`.
//
// It states the FINISH LINE, not the current state: every one of the 188 figures Rich Reel
// publishes must be fully recognised by the engine. It is kept separate because it is red
// today and will stay red until the remaining edge cases are fixed - a permanently-failing
// harness in the pre-commit gate would train everyone to ignore the gate, which is worse than
// not having the suite at all.
//
//   run it with:   npm run verify:figures --prefix engine
//
// WHAT "RECOGNISED" MEANS, in two levels, both gated:
//   1. READ      - every call cell decodes to an engine call name. An unread cell means we
//                  cannot read All8's notation, which is our gap.
//   2. KNOWN     - every engine name is a call the engine actually has (catalogue variant or
//                  coded move). A name we can produce but cannot dance is a different gap, and
//                  conflating the two is how a decoder gap gets mistaken for a missing call.
//
// A third level is REPORTED but not gated: whether the figure RUNS end-to-end from Static
// Square. That is the reference-sequence work, and it needs a start board and finish handling
// that this suite does not yet own.
//
// The reader lives in `test/lib/all8-figures.mjs` so that the future reference-sequence
// feature reuses the same reading of the page rather than growing a second one.
// ============================================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { CODED_MOVES, Sequencer, setParser } from '../dist/index.js';
import { KNOWN_CATALOGUE_GAPS } from '../dist/sequencer/all8-notation.js';
import { splitSelection } from '../dist/sequencer/selection.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import {
  ALL8_FIGURE_START,
  figureEngineCalls,
  loadAll8Figures,
  toReferenceSequence,
  unreadCells,
} from './lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const data = loadAll8Figures();
// ALIASES, not just canonical names. A coded move is one registry entry with several authored
// spellings, and the applicator resolves every one of them - `findCodedMove` keys on all of them -
// so `Promenade Home` DANCES today. Listing only `m.name` reported it as a call the engine does not
// have, which is the same "ask it the way the applicator asks" mistake round 36 fixed in
// `getout-conformance.mjs`, in a third disguise.
const codedNames = new Set(CODED_MOVES.flatMap((m) => m.aliases));

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);
const note = (msg) => console.log(`  note  ${msg}`);

console.log(`All8 Mainstream singing-call figures - ${data.source}`);
console.log(`  ${data.attribution}`);
console.log(`  ${data.figures.length} published figures, every one starting from ${ALL8_FIGURE_START}`);
console.log('  A line across is one complete 64-beat figure; an indented line shares its leading');
console.log('  calls with a line above it. `(3)`/`(*)` link to All8\'s get-outs from that position.');

// ------------------------------------------------------------------ 1. READ
console.log('\n== 1. can we READ every cell of every figure? (gated) ==');
const cells = data.figures.flatMap((f) => f.calls);
const unread = unreadCells(data);
{
  const pct = ((unread.length / cells.length) * 100).toFixed(1);
  console.log(`  ${data.figures.length} figures, ${cells.length} call cells, ${unread.length} unread (${pct}%)`);
  if (unread.length) {
    const byToken = new Map();
    for (const u of unread) byToken.set(u.token, (byToken.get(u.token) ?? 0) + 1);
    const ranked = [...byToken.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    fail(`${unread.length} call cells across ${byToken.size} distinct tokens are not readable`);
    console.log('        distinct unread tokens (count, token):');
    for (const [tok, n] of ranked) {
      const figs = [...new Set(unread.filter((u) => u.token === tok).map((u) => u.figureId))];
      console.log(`          ${String(n).padStart(3)}  ${tok.padEnd(16)} e.g. ${figs.slice(0, 4).join(' ')}`);
    }
  } else {
    ok(`all ${cells.length} call cells across ${data.figures.length} figures are readable`);
  }
}

// ------------------------------------------------------------------ 2. KNOWN
console.log('\n== 2. does the engine HAVE every call it read? (gated) ==');
{
  // "Has the call" has to be asked the way the APPLICATOR asks it, not as a catalogue-title
  // lookup. `Centers Pass Thru` and `Girls Circulate` are not catalogue titles - they are a
  // selection prefix plus a base call, and the applicator routes them through the selection
  // path. Testing `library.hasCall` alone would report every group-scoped call in the corpus as
  // a missing call, which is exactly the decoder-gap-vs-missing-call confusion this suite is
  // supposed to avoid. So: a title, a coded move, or a selection whose BASE resolves.
  const hasCallDeep = (name) => {
    if (seq.library.hasCall(name) || codedNames.has(name)) return true;
    const s = splitSelection(name);
    return !!s.selection && (seq.library.hasCall(s.call) || codedNames.has(s.call));
  };
  const names = [...new Set(data.figures.flatMap((f) => figureEngineCalls(f, { includeOptional: true })))];
  const unknown = names.filter((n) => !hasCallDeep(n));
  console.log(`  ${names.length} distinct engine call names appear across the figures`);
  if (unknown.length) {
    fail(`${unknown.length} of them are calls the engine does not have`);
    console.log('        ' + unknown.sort().join('\n        '));
    // The two gaps are DIFFERENT and the count alone cannot tell them apart. A name declared in
    // `KNOWN_CATALOGUE_GAPS` is a deliberate, reviewable statement that All8 names a call the engine
    // does not implement; anything else is an undeclared reading that wants a second look. This is
    // reported rather than subtracted, because the suite is a FINISH LINE: a figure using a call the
    // engine lacks is not recognised yet, whichever list the name is on.
    const declared = unknown.filter((n) => KNOWN_CATALOGUE_GAPS.has(n) || (splitSelection(n).call && KNOWN_CATALOGUE_GAPS.has(splitSelection(n).call)));
    if (declared.length) {
      note(`${declared.length} of those are DECLARED engine gaps (KNOWN_CATALOGUE_GAPS), not mis-readings:`);
      console.log('        ' + declared.sort().join(', '));
    }
    const undeclared = unknown.filter((n) => !declared.includes(n));
    if (undeclared.length) note(`${undeclared.length} are NOT declared anywhere: ${undeclared.sort().join(', ')}`);
    if (unknown.includes('Ferris Wheel')) {
      console.log('        NOTE `Ferris Wheel` is NOT a missing call - it has nine <tam> definitions and');
      console.log('        fails to LOAD (sequencer.ts:59 swallows the error in a bare `catch`). See PLAN.md.');
    }
  } else {
    ok(`the engine has all ${names.length} of them (catalogue title, coded move, or selection + base)`);
  }
}

// ------------------------------------------------------------------ 3. links and optional calls
console.log('\n== 3. the layout All8 uses around the calls is preserved ==');
{
  const withLinks = data.figures.filter((f) => f.links.length > 0);
  const linkCount = data.figures.reduce((n, f) => n + f.links.length, 0);
  const unresolved = data.figures.filter((f) => f.links.some((l) => l.label === '*')).length;
  if (!linkCount) fail('no get-out links were captured - the `(N)` markers are being dropped');
  else ok(`${linkCount} get-out links captured across ${withLinks.length} figures (${unresolved} marked "no resolve yet")`);

  // A link's position has to survive the share resolution, or it points at the wrong call.
  const bad = data.figures.filter((f) => f.links.some((l) => l.afterCall < 0 || l.afterCall > f.calls.length));
  if (bad.length) fail(`${bad.length} figures have a get-out link outside their own call list`);
  else ok('every get-out link sits within its figure\'s call list, share-adjusted');

  const optional = data.figures.flatMap((f) => f.calls.filter((c) => c.optional));
  if (!optional.length) fail('no optional `(Call)` cells were captured - they are being dropped as prose');
  else ok(`${optional.length} optional cells captured and flagged, so they can be included or omitted`);

  const spoken = data.figures.filter((f) => f.spoken);
  ok(`${spoken.length} figures carry quoted delivery text, flagged and excluded from the calls`);
}

// ------------------------------------------------------------------ 4. reusability
console.log('\n== 4. the figures are loadable as reference sequences (gated) ==');
{
  const seqs = data.figures.map((f) => toReferenceSequence(f));
  const empty = seqs.filter((s) => s.calls.length === 0);
  const dupIds = seqs.length !== new Set(seqs.map((s) => s.id)).size;
  if (empty.length) fail(`${empty.length} figures load as a reference sequence with no calls`);
  else if (dupIds) fail('reference-sequence ids are not unique');
  else ok(`all ${seqs.length} figures load as { id, start, calls, links } with unique ids`);
  const s = seqs.find((x) => x.id === 'figm22');
  if (s) console.log(`        e.g. ${s.id}: ${s.start} > ${s.calls.slice(0, 6).join(' / ')}${s.calls.length > 6 ? ' ...' : ''}`);
}

// ------------------------------------------------------------------ 5. run (reported, not gated)
console.log(`\n== 5. do the figures RUN from ${ALL8_FIGURE_START}? (reported, not yet gated) ==`);
{
  const start = seq.boardForFormation(ALL8_FIGURE_START);
  if (!start) {
    fail(`no ${ALL8_FIGURE_START} board - the run stage cannot work`);
  } else {
    let ran = 0, stopped = 0;
    const stopCalls = new Map();
    for (const f of data.figures) {
      const calls = figureEngineCalls(f);
      if (!calls.length) { stopped++; continue; }
      let board = start;
      let stoppedAt = null;
      for (const name of calls) {
        const r = seq.applyToBoard(board, name);
        if (!r.legal) { stoppedAt = name; break; }
        board = r.board;
      }
      if (stoppedAt === null) ran++;
      else { stopped++; stopCalls.set(stoppedAt, (stopCalls.get(stoppedAt) ?? 0) + 1); }
    }
    console.log(`  ${ran} of ${data.figures.length} figures run end-to-end`);
    console.log(`  ${stopped} stop, most often at:`);
    for (const [name, n] of [...stopCalls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`      ${String(n).padStart(3)}  ${name}`);
    }
    note('this stage is the reference-sequence work and is not gated yet');
  }
}

console.log('\n=================');
if (failures) {
  console.log(`ALL8 FIGURES: ${failures} gate(s) FAILED - this is the TARGET suite, so red is expected`);
  console.log(`  until the edge cases above are fixed. It is not part of \`verify\` or \`verify:light\`.`);
  process.exitCode = 1;
} else {
  console.log('ALL8 FIGURES: every published Mainstream figure is recognised.');
}
