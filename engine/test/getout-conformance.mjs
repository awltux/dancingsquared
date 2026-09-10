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
const levels = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
const catalogue = new Set();
for (const lv of levels) {
  const dir = path.join(assets, lv);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    for (const m of xml.matchAll(/<tam\b[^>]*\btitle="([^"]*)"/g)) catalogue.add(m[1]);
  }
}
console.log(`\n== Engine catalogue ==\n  ${catalogue.size} call titles across ${levels.length} level folders`);

// --------------------------------------------------------- decoding the lines
//
// Conservative on purpose: a token is only decoded when its expansion is
// unambiguous to us. Everything else counts as UNDECODED so the report never
// quietly invents a call name. Prefixes A-/B-/G-/C-/E- are All/Boys/Girls/Centers/
// Ends, which is how All8 writes group-scoped calls (e.g. B-Run = Boys Run).
const TOKENS = {
  AL: 'Allemande Left',
  RLG: 'Right and Left Grand',
  WWGrd: 'Wrong Way Grand',
  Prom: 'Promenade',
  PromH: 'Promenade Home',
  PasTh: 'Pass Thru',
  SldTh: 'Slide Thru',
  BxGnt: 'Box the Gnat',
  RLT: 'Right and Left Thru',
  RollA: 'Rollaway',
  StrTh: 'Star Thru',
  CirL: 'Circle Left',
  CirR: 'Circle Right',
  JoinH: 'Join Hands',
  UTurn: 'U-Turn Back',
  'T1/4': 'Touch 1/4',
  A8Cir: 'All 8 Circulate',
  SwThr: 'Swing Thru',
  TrdBy: 'Trade By',
  TrdWv: 'Trade the Wave',
  Trd: 'Trade',
  DixiS: 'Dixie Style to a Wave',
  DixiG: 'Dixie Grand',
  SpTop: 'Spin the Top',
  FanTp: 'Fan the Top',
  Ext: 'Extend',
  Scoot: 'Scoot Back',
  DoSaD: 'Do Sa Do',
  DoPaso: 'Do Paso',
  TrnTh: 'Turn Thru',
  'R.PBy': 'Right Pull By',
  StepW: 'Step to a Wave',
  'Ca3/4': 'Cast Off 3/4',
  CtrIn: 'Centers In',
  PsOcn: 'Pass the Ocean',
  CalTw: 'California Twirl',
  ChasR: 'Chase Right',
  FwdBk: 'Forward and Back',
  LoadB: 'Load the Boat',
  'Col.C': 'Column Circulate',
  PeelO: 'Peel Off',
  SpltC: 'Split Circulate',
  '1/2.C': '1/2 Circulate',
  LHing: 'Left Hinge',
  Run: 'Run',
  Fold: 'Fold',
  BendL: 'Bend the Line',
  LSwTh: 'Left Swing Thru',
  Recyc: 'Recycle',
  Swing: 'Swing',
  DPT: 'Double Pass Thru',
  VeerR: 'Veer Right',
  VeerL: 'Veer Left',
  XFold: 'Cross Fold',
  Zoom: 'Zoom',
  Tag: 'Tag the Line',
  DoPaS: 'Do Paso',
  WhlDl: 'Wheel and Deal',
  RvFlt: 'Reverse Flutterwheel',
  Cir: 'Circulate',
};
// N-hand counts: All8's digit counts HANDS (e.g. --SqTh1 = Square Thru with one
// hand), which is not the standard call suffix, so only the counts that ARE real
// call names (2, 3, 4) are expanded. `--SqTh1`/`--SqTh5`/`--8Chn*` are therefore
// left undecoded rather than expanded into names the catalogue cannot have.
for (let n = 2; n <= 4; n++) TOKENS[`SqTh${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`SqT@${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`LSqT${n}`] = `Left Square Thru ${n}`;
const GROUP = { A: 'All', B: 'Boys', G: 'Girls', C: 'Centers', E: 'Ends' };

/** Split a published line into its tokens, preserving nothing else. All8 separates
 * calls with wide gaps, but an aside can collapse that to a single space
 * (`--CtrIn  B-Fold "behind your girl" --Prom`), so asides are removed first. */
function tokenize(line) {
  return line
    .replace(/\([^)]*\)/g, '  ')           // drop parenthetical asides
    .replace(/"[^"]*"/g, '  ')             // drop quoted asides
    .split(/\s{2,}|\s+-\s+/)               // All8 separates calls with wide gaps
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/^[-\s!|]+/, '').replace(/[,.;:]+$/, '').trim())
    .filter(Boolean);
}

/** Decode a token to a call name, or null when we cannot read it. A group prefix
 * (A-/B-/G-/C-/E-) is decoded but flagged `scoped`, because the composed name
 * ("Boys Run") is a reading of All8's shorthand rather than a name All8 prints. */
function decodeToken(token) {
  const t = token.replace(/^[-\s!|]+/, '').trim();
  const g = /^([ABGCE])-(.+)$/.exec(t);
  if (g) {
    const base = TOKENS[g[2]];
    return base ? { name: `${GROUP[g[1]]} ${base}`, scoped: true } : null;
  }
  const base = TOKENS[t];
  return base ? { name: base, scoped: false } : null;
}

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
const missing = [...plainRefs.entries()]
  .filter(([name]) => !catalogue.has(name))
  .sort((a, b) => b[1] - a[1]);
console.log(`  WHOLE-SET names (decoded without a group prefix, so the comparison is fair):`);
console.log(`    ${plainRefs.size} distinct, ${plainRefs.size - missing.length} registered, ${missing.length} ABSENT`);
for (const [name, n] of missing.slice(0, 18)) console.log(`      ${String(n).padStart(3)}x  ${name}`);
if (missing.length > 18) console.log(`      ... and ${missing.length - 18} more`);
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
