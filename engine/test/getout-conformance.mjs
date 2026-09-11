// Get-out conformance against the published all8.com corpus.
//
// The fixture (fixtures/all8-getouts.json) holds Rich Reel's published get-outs,
// verbatim, indexed by FASR ALIGNMENT ([B1c] "ZERO BOX", [L1p] "ZERO LINES", ...).
// It is an INDEPENDENT ORACLE: get-outs written down by callers, not derived from
// this engine. The value of having it is that it can disagree with us.
//
// What this checks:
//   1. FIXTURE INTEGRITY (a hard failure): the corpus must parse, carry unique
//      alignment ids, valid all8.com URLs, and a plausible number of lines. A
//      silently truncated corpus would be worse than none.
//   2. CALL-NAME COVERAGE: each published get-out is decoded with a conservative
//      abbreviation table below and checked against the engine's CATALOGUE. A
//      get-out you cannot call is a get-out you cannot test, so the missing names
//      are the actionable output. The table is ours, not All8's - All8's own
//      notation reference (help.cgi) returns HTTP 500, so anything we cannot read
//      with confidence is left UNDECODED and counted rather than guessed.
//   3. ALIGNMENT COVERAGE (reported, not failed): All8 indexes get-outs by
//      alignment, so a conformance run needs a board in that alignment. The engine
//      cannot yet construct most of them, so this reports how many alignments are
//      executable instead of pretending to verify them.
//
// Run: `npm run build && node test/getout-conformance.mjs` from engine/.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer } from '../dist/index.js';
import { splitSelection } from '../dist/sequencer/selection.js';
import { catalogueTitles, implementedTitles, indexedTitles, engineNameFor, callsByTitle } from './lib/engine-calls.mjs';
import { startBoardFor } from './lib/all8-boards.mjs';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
// Optional argument: run against an alternative corpus file.
const FIXTURE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'fixtures', 'all8-getouts.json');

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${msg}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- the fixture

if (!existsSync(FIXTURE)) {
  console.log(`FAIL: fixture not found at ${FIXTURE}`);
  process.exit(1);
}
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

console.log('== Fixture integrity (all8.com get-out corpus) ==');
check(typeof fixture.source === 'string' && fixture.source.startsWith('https://www.all8.com/'),
  'fixture records its all8.com source', fixture.source);
check(Array.isArray(fixture.alignments) && fixture.alignments.length >= 20,
  'fixture holds the alignment set', `${fixture.alignments?.length ?? 0} alignments`);
const ids = (fixture.alignments ?? []).map((a) => a.id);
check(new Set(ids).size === ids.length, 'alignment ids are unique', `${ids.length} ids`);
check(ids.every((id) => typeof id === 'string' && id.length > 0), 'every alignment has an id');
const badUrl = (fixture.alignments ?? []).filter((a) => !String(a.url ?? '').startsWith('https://www.all8.com/'));
check(badUrl.length === 0, 'every alignment records a valid all8.com URL', badUrl.length ? badUrl.map((a) => a.id).join(', ') : 'ok');
// An alignment must carry get-outs SOMEWHERE, but not necessarily in getoutLines:
// 5L1p and 2W2p publish no pre-Plus get-outs at all, only Plus-level ones.
const noLines = (fixture.alignments ?? []).filter((a) =>
  !((a.getoutLines?.length ?? 0) + (a.plusLines?.length ?? 0) + (a.conversionLines?.length ?? 0)));
check(noLines.length === 0, 'every alignment carries get-outs in some list', noLines.length ? noLines.map((a) => a.id).join(', ') : 'ok');
const totalLines = (fixture.alignments ?? []).reduce((n, a) => n + (a.getoutLines?.length ?? 0), 0);
check(totalLines >= 200, 'the corpus is not truncated', `${totalLines} published get-out lines`);
if (fixture.failures?.length) {
  console.log(`  note: ${fixture.failures.length} page(s) failed to fetch: ${fixture.failures.map((f) => f.id).join(', ')}`);
}

// ------------------------------------------------------- the engine catalogue

const assets = path.join(root, 'poc/src/assets');
// The catalogue must include assets/src/calls.xml (the resolve and concept calls)
// and must be read by TITLE - see lib/engine-calls.mjs for why both matter.
// The IMPLEMENTED catalogue is the `<tam>` titles PLUS the geometry-derived calls the
// engine computes from the board (the coded pivots and `Promenade`) - comparing
// coverage against the `<tam>` titles alone reports an implemented call as missing.
// `indexedTitles` is the engine's own index (assets/src/calls.xml), which lists names
// that have no implementation - so an absent name can be told apart from a name the
// engine knows and cannot do.
const catalogue = catalogueTitles(assets);
const implemented = implementedTitles(assets);
const indexed = indexedTitles(assets);
console.log(`\n== Engine catalogue ==\n  ${catalogue.size} implemented call titles (<tam>), `
  + `${implemented.size} performable names (adding the ${implemented.size - catalogue.size} geometry-derived ones), `
  + `${indexed.size} titles in the engine's own index`);

// The Sequencer, only so that alignment coverage below can MEASURE how many alignments
// can actually be set up rather than assert it.
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// --------------------------------------------------------- decoding the lines
//
// The abbreviation table and tokenizer live in lib/getout-decode.mjs so this script
// and getout-behaviour.mjs decode the corpus identically.
import { TOKENS, MULTI_TOKENS, GROUP, tokenize, decodeLine, KNOWN_CATALOGUE_GAPS, decodeStats, formatRanking } from './lib/getout-decode.mjs';

let lines = 0, decoded = 0;
const unknownTokens = new Map();
const plainRefs = new Map();  // whole-set call name -> get-outs using it
const scopedRefs = new Map(); // group-scoped reading -> get-outs using it
for (const a of fixture.alignments ?? []) {
  for (const line of a.getoutLines ?? []) {
    lines++;
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    // `decodeLine`, not `decodeToken`: only the line-level reader can resolve `Twice`, which
    // repeats the previous call and therefore has no token-level answer.
    const res = decodeLine(line);
    if ('undecoded' in res) { unknownTokens.set(res.undecoded, (unknownTokens.get(res.undecoded) ?? 0) + 1); continue; }
    decoded++;
    for (const d of res.calls) {
      const m = d.scoped ? scopedRefs : plainRefs;
      m.set(d.name, (m.get(d.name) ?? 0) + 1);
    }
  }
}

console.log('\n== Decoding coverage (our abbreviation table, not All8\'s) ==');
console.log(`  ${lines} published get-out lines`);
console.log(`  ${decoded} decoded (${(100 * decoded / Math.max(1, lines)).toFixed(0)}%), ${
  [...unknownTokens.values()].reduce((a, b) => a + b, 0)} lines stopped at an unread token`);
const topUnknown = [...unknownTokens.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  tokens we cannot read yet (ALL ${topUnknown.length}, most frequent first):`);
console.log(`    ${formatRanking(unknownTokens, 40)}`);
if (topUnknown.length > 40) console.log(`    ... and ${topUnknown.length - 40} more, once each`);

// ---------------------------------------------------------------------------------------
// THE GATE: every abbreviation must expand to a call the engine can actually perform.
//
// This replaces a `check(true, ...)`, which is to say it replaces nothing at all. A wrong
// expansion does not crash and does not fail a gate: it moves a line from "our decoder gap"
// into "the engine has no such call", so the harness previously ACCUSED THE ENGINE of a gap
// that was really our misreading, and nothing could tell the two apart.
//
// The rule cannot be "is it implemented", because the corpus legitimately names calls the
// engine lacks (`Join Hands`, `1/2 Circulate`). So the rule is: implemented, OR explicitly
// declared in KNOWN_CATALOGUE_GAPS. That makes each gap a DELIBERATE, reviewable statement
// instead of an accident, and it makes a mis-expansion fail loudly here.
// ---------------------------------------------------------------------------------------
console.log('\n== Every abbreviation expands to a call the engine has, or a DECLARED gap ==');
{
  // "The engine has it" has to be asked the way the APPLICATOR asks it. A group-scoped datum like
  // `Leaders Trade` is not a catalogue title - it is a selection prefix plus a base call, and
  // `CallApplicator.applyToBoardInner` routes it through the selection path. `leaders` is a real
  // selection in `grouping.ts`, so `Leaders Trade` dances today; calling it a gap because
  // `implementedTitles()` does not list the string would be exactly the mis-attribution this
  // section exists to prevent. The base call is still checked, so `Boys Cross Run` stays a gap
  // (bare `Cross Run` is not implemented) and nothing is let through.
  const implementedOrScoped = (name) => {
    const n = engineNameFor(name);
    if (implemented.has(n)) return true;
    const s = splitSelection(n);
    return !!s.selection && implemented.has(s.call);
  };
  // The corpus's OWN decoded names are checked too, not only the table's values. A cross-token
  // modifier (`1-1/2`, `1/2of`) COMPOSES a name that appears in no `TOKENS` entry, so checking only
  // `Object.values(TOKENS)` let every composed reading (`1/2 U-Turn Back`, `Split Circulate 1 1/2`)
  // through unchecked - the same "the gate does not cover this path" hole this section was written
  // to close, one level up. `plainRefs` is exactly the whole-set names the corpus decoded.
  const declared = new Set([...Object.values(TOKENS), ...Object.values(MULTI_TOKENS).flat(), ...plainRefs.keys()]);
  const undeclared = [...declared].filter((n) => !implementedOrScoped(n) && !KNOWN_CATALOGUE_GAPS.has(n));
  const declaredButStale = [...KNOWN_CATALOGUE_GAPS].filter((n) => implementedOrScoped(n));
  const gapButNotUsed = [...KNOWN_CATALOGUE_GAPS].filter((n) => !declared.has(n));

  if (undeclared.length > 0) {
    check(false, `abbreviation(s) expand to a call the engine does NOT implement: ${undeclared.join(', ')}`,
      'either the expansion is wrong (a phantom name) or the gap must be declared in KNOWN_CATALOGUE_GAPS');
  } else {
    check(true, `all ${declared.size} table names are implemented or declared gaps`);
  }
  if (declaredButStale.length > 0) {
    check(false, `declared as a catalogue gap but the engine DOES implement it now: ${declaredButStale.join(', ')}`,
      'remove it from KNOWN_CATALOGUE_GAPS so the gap count stays honest');
  }
  if (gapButNotUsed.length > 0) {
    check(true, `declared gaps no longer referenced by any table entry (harmless, still real): ${gapButNotUsed.join(', ')}`);
  }
  console.log(`  declared catalogue gaps: ${[...KNOWN_CATALOGUE_GAPS].join(', ')}`);
}

// Both rankings over BOTH lists, so a work queue is not built from a slice of one of them.
// The two disagree materially: `&Roll` is 21 first-failure but 41 all-occurrence, because a
// token sitting behind an earlier unknown is invisible to the first-failure count.
console.log('\n== Both token rankings (first-failure vs all-occurrence) ==');
{
  const all = [];
  for (const a of fixture.alignments ?? []) {
    for (const key of ['getoutLines', 'plusLines']) for (const l of a[key] ?? []) all.push(l);
  }
  const s = decodeStats(all);
  console.log(`  over get-out AND Plus lines: ${s.total} lines, ${s.decoded} fully decoded, ${s.undecoded} stopped`);
  console.log(`  FIRST-FAILURE (lines a fix would unblock), ${s.firstFail.size} distinct:`);
  console.log(`    ${formatRanking(s.firstFail, 20)}`);
  console.log(`  ALL-OCCURRENCE (true vocabulary size), ${s.allOcc.size} distinct:`);
  console.log(`    ${formatRanking(s.allOcc, 20)}`);
}

// ------------------------------------------- call-name coverage vs the catalogue

console.log('\n== Call-name coverage: published get-outs vs the engine catalogue ==');
// A name All8 uses and the engine uses differently is NOT a missing call, so the
// All8 -> engine bridge is applied before comparing; whatever is still absent is a
// real gap. Bridged names are listed too, since the bridge currently lives in the
// test harness rather than in the engine's (empty) CALL_SYNONYMS.
const bridged = [...plainRefs.entries()].filter(([name]) => engineNameFor(name) !== name);
const missing = [...plainRefs.entries()]
  .map(([name, n]) => [engineNameFor(name), n, name] )
  .filter(([engineName]) => !implemented.has(engineName))
  .sort((a, b) => b[1] - a[1]);
console.log(`  WHOLE-SET names (decoded without a group prefix, so the comparison is fair):`);
console.log(`    ${plainRefs.size} distinct, ${plainRefs.size - missing.length} registered, ${missing.length} ABSENT`);
for (const [name, n, published] of missing.slice(0, 18)) {
  const known = indexed.has(name) ? 'indexed by the engine but NOT implemented' : 'not in the engine at all';
  console.log(`      ${String(n).padStart(3)}x  ${name}${published === name ? '' : `  (All8 writes "${published}")`}  - ${known}`);
}
if (missing.length > 18) console.log(`      ... and ${missing.length - 18} more`);
if (bridged.length) {
  console.log(`  NAMED DIFFERENTLY (present, not gaps - the bridge lives in lib/engine-calls.mjs for now):`);
  for (const [name, n] of bridged) console.log(`      ${String(n).padStart(3)}x  "${name}" -> "${engineNameFor(name)}"`);
}
console.log(`  GROUP-SCOPED readings (reported for information, NOT compared): ${scopedRefs.size} distinct`);
console.log(`    e.g. ${[...scopedRefs.keys()].slice(0, 8).join(', ')}`);
// Reported, not gated: an absent name is either a catalogue gap or a wrong
// expansion on our side, and telling those apart needs All8's own notation key.
check(true, 'call-name coverage measured', `${plainRefs.size - missing.length}/${plainRefs.size} whole-set names registered`);

console.log('\n== Alignment coverage (can we even set up the board?) ==');
const families = new Map();
for (const a of fixture.alignments ?? []) families.set(a.family, (families.get(a.family) ?? 0) + 1);
for (const [fam, n] of [...families.entries()].sort()) console.log(`  ${String(n).padStart(2)} alignments  ${fam}`);
// This used to print "0 of them are executable today" and say the fixture measured
// vocabulary rather than behaviour. That stopped being true at step 3, which gave the
// engine a board for every alignment it can parse All8's diagram for; the corpus is now
// RUN by test/getout-behaviour.mjs. Measured here rather than asserted, so the claim
// cannot go stale again in silence.
if (!seq) check(false, 'the harness has no Sequencer to build start boards with');
const buildable = (fixture.alignments ?? []).filter((a) => startBoardFor(seq, a).board);
check(buildable.length >= 25, 'most alignments have a start board built from All8\'s own diagram',
  `${buildable.length} of ${(fixture.alignments ?? []).length}`);
console.log("  All8's own diagram (test/lib/all8-boards.mjs), so the corpus is runnable and the");
console.log('  behaviour report (test/getout-behaviour.mjs) is the measurement that matters here.');

console.log('\n=================');
if (failures === 0) console.log('GETOUT CONFORMANCE: fixture OK');
else {
  console.log(`${failures} FIXTURE CHECK(S) FAILED`);
  process.exit(1);
}
