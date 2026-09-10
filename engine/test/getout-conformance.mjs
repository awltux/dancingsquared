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
import { catalogueTitles, indexedTitles, engineNameFor } from './lib/engine-calls.mjs';

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
// The implemented catalogue is the `<tam>` titles. `indexedTitles` is the engine's
// own index (assets/src/calls.xml), which lists names that have no implementation -
// so an absent name can be told apart from a name the engine knows and cannot do.
const catalogue = catalogueTitles(assets);
const indexed = indexedTitles(assets);
console.log(`\n== Engine catalogue ==\n  ${catalogue.size} implemented call titles (<tam>), ${indexed.size} titles in the engine's own index`);

// --------------------------------------------------------- decoding the lines
//
// The abbreviation table and tokenizer live in lib/getout-decode.mjs so this script
// and getout-behaviour.mjs decode the corpus identically.
import { TOKENS, GROUP, tokenize, decodeToken } from './lib/getout-decode.mjs';

let lines = 0, decoded = 0;
const unknownTokens = new Map();
const plainRefs = new Map();  // whole-set call name -> get-outs using it
const scopedRefs = new Map(); // group-scoped reading -> get-outs using it
for (const a of fixture.alignments ?? []) {
  for (const line of a.getoutLines ?? []) {
    lines++;
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const seen = [];
    let ok = true;
    for (const tk of tokens) {
      const d = decodeToken(tk);
      if (d === null) { ok = false; unknownTokens.set(tk, (unknownTokens.get(tk) ?? 0) + 1); break; }
      seen.push(d);
    }
    if (!ok) continue;
    decoded++;
    for (const d of seen) {
      const m = d.scoped ? scopedRefs : plainRefs;
      m.set(d.name, (m.get(d.name) ?? 0) + 1);
    }
  }
}

console.log('\n== Decoding coverage (our abbreviation table, not All8\'s) ==');
console.log(`  ${lines} published get-out lines`);
console.log(`  ${decoded} decoded (${(100 * decoded / Math.max(1, lines)).toFixed(0)}%), ${
  [...unknownTokens.values()].reduce((a, b) => a + b, 0)} lines stopped at an unread token`);
const topUnknown = [...unknownTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
console.log(`  tokens we cannot read yet: ${topUnknown.map(([t, n]) => `${t}(${n})`).join(' ')}`);

// ------------------------------------------- call-name coverage vs the catalogue

console.log('\n== Call-name coverage: published get-outs vs the engine catalogue ==');
// A name All8 uses and the engine uses differently is NOT a missing call, so the
// All8 -> engine bridge is applied before comparing; whatever is still absent is a
// real gap. Bridged names are listed too, since the bridge currently lives in the
// test harness rather than in the engine's (empty) CALL_SYNONYMS.
const bridged = [...plainRefs.entries()].filter(([name]) => engineNameFor(name) !== name);
const missing = [...plainRefs.entries()]
  .map(([name, n]) => [engineNameFor(name), n, name] )
  .filter(([engineName]) => !catalogue.has(engineName))
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
console.log('  0 of them are executable today: the engine has no mapping from All8\'s FASR');
console.log('  alignment ids to a board, and cannot construct a board in those alignments.');
console.log('  Until that mapping exists this fixture measures vocabulary, not get-out behaviour.');

console.log('\n=================');
if (failures === 0) console.log('GETOUT CONFORMANCE: fixture OK');
else {
  console.log(`${failures} FIXTURE CHECK(S) FAILED`);
  process.exit(1);
}
