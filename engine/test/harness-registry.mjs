// ONE REGISTRY, AND A TOOL THAT SAYS IT IS ONE — the gate for `engine/test/` itself.
//
// THE RULE. Every harness under `engine/test/` is ONE of two things:
//   - a GATE: an entry in `engine/test/suite.mjs` (the one registry), run by `verify-suite.mjs`; or
//   - a ONE-SHOT DIAGNOSTIC: line 1 says so and names where its answer is recorded —
//       `// TIER: none — one-shot diagnostic; nothing runs it. Recorded: <path>.`
// `lib/` and `fixtures/` are libraries and data, not harnesses; `verify-suite.mjs` and `suite.mjs` are the
// runner and the registry themselves.
//
// WHY THIS EXISTS. AGENTS.md §5: "A probe nobody runs is already stale — wire it in or delete it." MEASURED when
// this landed (R2 triage, `22d2db0`): `engine/test/tools/` held 113 files and **104 of them were in no tier**, and
// nothing said so — TODO item 38 had noticed one of them. The failure is not that they exist (most are the
// instruments behind PLAN.md's numbers); it is that a reader cannot tell a gate from an archive, and a new
// analysis tool lands silently and is never run again. So every file states which it is, and this gate fails when
// one does not: unregistered AND unstamped is the state that must not exist.
//
// IT ALSO PINS THE REGISTRY ITSELF, in both directions: an entry that names no file (a dangling registration) and
// a file registered twice are both red, and every non-`light` entry must carry the `why` its banner prints.
//
// THE PINNED SET. 23 probes are recorded by `engine/test/tools/README.md` and by nothing else — the questions
// nobody wrote down anywhere else. They are kept as instruments and COUNTED here, so a new one is a decision and
// a removal updates the pin in the same commit (§11.2.8). A stamp that points at a real record is not pinned.
//
// WHAT IT CANNOT CHECK, stated rather than pretended: that the `Recorded:` path really answers the probe's
// question. It proves the path EXISTS and NAMES the probe — the rest is review, exactly like the `why` on a
// non-light entry.
//
// Usage: node engine/test/harness-registry.mjs   (from anywhere; reads text, no engine build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUITE } from './suite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const TOOLS = 'engine/test/tools';
const README = `${TOOLS}/README.md`;
/** The one stamp, in one place: the writer and the reader cannot drift. */
const STAMP_PREFIX = '// TIER: none — one-shot diagnostic; nothing runs it. Recorded: ';
const MACHINERY = new Set(['engine/test/verify-suite.mjs', 'engine/test/suite.mjs']);

/** The 23 probes whose only record is the directory README. A NAMED SET: red when it grows, and a shrink is a
 *  decision made in the commit that re-points the stamp (§11.2.8). */
const UNRECORDED = new Set([
  '7046-start-probe', 'ceder-7046-probe', 'handoff-2dancer', 'handoff-facing-pairs',
  'last-frame-branch-probe', 'parallel-probe', 'rlt-context-probe', 'rlt-probe', 'scircle-paths',
  'scircle-shift-probe', 'seek-beats-probe', 'sequence-dancer-order-probe', 'sequence-frame-jump-probe',
  'sequence-live-vs-walk-probe', 'sequence-promenade-flip-probe', 'sixteen-states-raw-probe',
  'squared-set-construction-probe', 'squared-set-pattern-order-probe', 'squared-set-sequence-probe',
  'squared-set-source-probe', 'squared-set-table-probe', 'start-formation-resolve-probe',
  'zero-line-boards-probe',
]);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- the rule as pure functions (unit-controlled)
const relOf = (abs) => abs.split(path.sep).join('/');
const isToolsFile = (rel) => rel.startsWith(`${TOOLS}/`);
const stemOf = (rel) => path.posix.basename(rel, '.mjs');

/** Which of the two things `rel` claims to be: `{ gate, entry }`, `{ tool, record }`, or `{ neither }` — and
 *  `{ both }` when a registered file also carries the stamp, which is the one state that is not allowed. */
function classify(rel, source, entries) {
  const entry = entries.find((e) => e.h === stemOf(rel) && (isToolsFile(rel) ? e.sub === 'tools' : e.sub === undefined));
  const firstLine = source.split(/\r?\n/)[0] ?? '';
  const record = firstLine.startsWith(STAMP_PREFIX) && firstLine.endsWith('.')
    ? firstLine.slice(STAMP_PREFIX.length, -1)
    : null;
  if (entry && record) return { both: true, entry, record };
  if (entry) return { gate: true, entry };
  if (record) return { tool: true, record };
  return { neither: true };
}

/** What is wrong with a stamp's record, or null. `texts` maps a repo-relative path to its text. */
function recordProblem(rel, record, texts) {
  if (!record) return `no "${STAMP_PREFIX}…" on line 1`;
  if (record === rel) return `the record is the file itself`;
  if (record.startsWith('/') || record.startsWith('.')) return `the record must be a REPO-RELATIVE path: ${record}`;
  if (!(record in texts)) return `the record does not exist: ${record}`;
  const stem = stemOf(rel);
  const names = new RegExp(`\\b${stem.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(texts[record]);
  return names ? null : `the record does not NAME the probe: ${record} never mentions "${stem}"`;
}

// ---------------------------------------------------------------- the tree
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (rel === `${TOOLS}/lib` || rel === 'engine/test/lib' || rel === 'engine/test/fixtures') continue;
      walk(rel, out);
    } else if (e.name.endsWith('.mjs')) {
      out.push(rel);
    }
  }
  return out;
}

const files = walk('engine/test', []).filter((rel) => !MACHINERY.has(rel));
const texts = new Map(files.map((rel) => [rel, fs.readFileSync(path.join(REPO, rel), 'utf8')]));
// The records may live outside the harness tree: read the docs lazily by path, through one cache.
const recordText = (rel) => {
  if (texts.has(rel)) return texts.get(rel);
  try {
    const t = fs.readFileSync(path.join(REPO, rel), 'utf8');
    texts.set(rel, t);
    return t;
  } catch {
    return null;
  }
};

console.log('harness-registry: one registry, and a tool that says it is one\n');
console.log(`== 1. the walk found the tree ==`);
console.log(`  ${files.length} harness file(s) under engine/test (the runner and the registry excluded); ${SUITE.length} registry entr(ies)`);
check(files.length > 150, `the walk found the harnesses (${files.length} files; a zero here is a FAILURE, not a pass)`);

console.log(`\n== 2. every harness is a GATE or a STAMPED DIAGNOSTIC (never neither, never both) ==`);
const problems = [];
const unrecorded = [];
for (const rel of files) {
  const kind = classify(rel, texts.get(rel), SUITE);
  if (kind.neither) { problems.push(`${rel}: registered in neither — add an entry in engine/test/suite.mjs, or the one-shot stamp on line 1`); continue; }
  if (kind.both) { problems.push(`${rel}: registered AND stamped — a gate is not a diagnostic`); continue; }
  if (kind.tool && kind.record === README) unrecorded.push(stemOf(rel));
}
for (const p of problems) console.log(`     ${p}`);
check(problems.length === 0, `every harness says what it is (${problems.length} problem(s) in ${files.length} files)`);

console.log(`\n== 3. every stamp's record EXISTS and NAMES the probe ==`);
const stampProblems = [];
for (const rel of files) {
  const kind = classify(rel, texts.get(rel), SUITE);
  if (!kind.tool) continue;
  const rec = kind.record;
  if (rec === rel) { stampProblems.push(`${rel}: the record is the file itself`); continue; }
  if (rec.startsWith('/') || rec.startsWith('.')) { stampProblems.push(`${rel}: the record must be repo-relative: ${rec}`); continue; }
  const text = recordText(rec);
  if (text === null) { stampProblems.push(`${rel}: the record does not exist: ${rec}`); continue; }
  const stem = stemOf(rel);
  const names = new RegExp(`\\b${stem.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(text);
  if (!names) stampProblems.push(`${rel}: ${rec} never mentions "${stem}"`);
}
for (const p of stampProblems) console.log(`     ${p}`);
check(stampProblems.length === 0, `every stamp points at a real record that names it (${stampProblems.length} problem(s))`);

console.log(`\n== 4. the registry and the filesystem agree, BOTH ways ==`);
const seen = new Map();
const dangling = [];
for (const e of SUITE) {
  const rel = e.sub === 'tools' ? `${TOOLS}/${e.h}.mjs` : `engine/test/${e.h}.mjs`;
  if (!fs.existsSync(path.join(REPO, rel))) dangling.push(`${e.h}: no file at ${rel}`);
  if (seen.has(e.h)) dangling.push(`${e.h}: registered twice`);
  seen.set(e.h, e);
}
for (const d of dangling) console.log(`     ${d}`);
check(dangling.length === 0, `no dangling entry and no duplicate (${dangling.length} problem(s) in ${SUITE.length} entries)`);

console.log(`\n== 5. every non-light entry carries its why ==`);
const whyless = SUITE.filter((e) => !e.light && !e.future && !e.why).map((e) => e.h);
check(whyless.length === 0, `every non-light, non-future entry has a why (${whyless.length} without: ${whyless.join(', ') || 'none'})`);

console.log(`\n== 6. the UNRECORDED set is exactly the pinned 23 (a NAMED SET: red when it grows) ==`);
const grew = unrecorded.filter((n) => !UNRECORDED.has(n)).sort();
const shrank = [...UNRECORDED].filter((n) => !unrecorded.includes(n)).sort();
console.log(`  ${unrecorded.length} probe(s) recorded only by ${README}`);
for (const n of grew) console.log(`     NOT PINNED: ${n} — write its answer down, or add it to UNRECORDED here in this commit`);
for (const n of shrank) console.log(`     PIN NO LONGER MATCHES: ${n} — lower the pin in the commit that re-pointed it`);
check(grew.length === 0, `no new unrecorded probe (${grew.length} unexpected)`);
check(shrank.length === 0, `every pinned probe is still unrecorded (${shrank.length} stale pin(s))`);

console.log(`\n== 7. the rule itself, with its controls ==`);
// THE CASE THIS GATE EXISTS FOR: a file that is neither registered nor stamped must classify as nothing.
check(classify('engine/test/tools/foo.mjs', "import fs from 'node:fs';\n", []).neither === true,
  'CONTROL: an unregistered, unstamped tool is NEITHER — the state that fails check 2');
check(classify('engine/test/tools/foo.mjs', `${STAMP_PREFIX}${README}.\n`, []).tool === true,
  'CONTROL: a stamped tool is a diagnostic');
check(classify('engine/test/foo.mjs', '// a header\n', [{ h: 'foo', light: true }]).gate === true,
  'CONTROL: a registered harness is a gate');
check(classify('engine/test/foo.mjs', `${STAMP_PREFIX}${README}.\n`, [{ h: 'foo', light: true }]).both === true,
  'CONTROL: registered AND stamped is caught');
check(classify('engine/test/tools/foo.mjs', '// a header\n', [{ h: 'foo', light: true }]).neither === true,
  "CONTROL: a sub-less entry does not register a tools file — the file is NEITHER without a stamp");
check(classify('engine/test/tools/foo.mjs', '// a header\n', [{ h: 'foo', sub: 'tools', light: true }]).gate === true,
  "CONTROL: a sub: 'tools' entry does register it");
check(recordProblem('engine/test/tools/foo.mjs', 'PLAN.md', { 'PLAN.md': 'nothing about it' }) !== null,
  'CONTROL: a record that does not name the probe is caught');
check(recordProblem('engine/test/tools/foo.mjs', 'PLAN.md', { 'PLAN.md': 'see foo.mjs' }) === null,
  'CONTROL: a record that names the probe passes');
check(recordProblem('engine/test/tools/foo.mjs', 'engine/test/tools/foo.mjs', {}) !== null,
  'CONTROL: a self-referential record is caught');
check(recordProblem('engine/test/tools/foo.mjs', 'NOWHERE.md', {}) !== null,
  'CONTROL: a missing record is caught');

console.log(`\nharness-registry: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures ? 1 : 0);
