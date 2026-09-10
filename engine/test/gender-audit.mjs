// Gender-data audit: every FULL-SET (8-dancer) and HALF-SET (4-dancer) definition
// must have equal numbers of boys and girls. An imbalance in one of those is a
// DATA ERROR (a mistyped gender attribute), so it fails the build.
//
// Why only 8 and 4, for DEFINITIONS:
//   - A half-set definition is an authoring shortcut that is completed to the full
//     set by rotating it 180 degrees about the centre (square-dancing.md §7.1), so
//     a balanced half is what makes a balanced whole.
//   - SUBSET formations (square-dancing.md §7.2) genuinely describe a smaller group
//     - "Beaus Only" is two boys by definition, a "Column of 3" is three dancers -
//     so those are legitimately unbalanced. A subset can be ALL ONE GENDER, which is
//     exactly what makes an "all boys" / "all girls" call callable. They are
//     reported for information, not failed.
//
// BOARDS use a narrower rule: only a board holding the WHOLE set (8) must be
// balanced. A board of fewer dancers is a subset board (the boys acting, the
// centers acting) and may legitimately be all one gender.
//
// Boards are checked too: a board holding real genders must be balanced. A board
// whose genders are all 'phantom' has no identity yet (a synthesised formation
// board) and is reported as unknown rather than failed.
//
// Run: `npm run build && node test/gender-audit.mjs` from engine/.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, parseFormations } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const assets = 'poc/src/assets';
const movesXml = read(`${assets}/moves.xml`);
const formationsXml = read(`${assets}/formations.xml`);

/** Dancer counts of a setup, ignoring phantoms when deciding balance. */
function tally(genders) {
  const boys = genders.filter((g) => g === 'boy').length;
  const girls = genders.filter((g) => g === 'girl').length;
  const phantom = genders.filter((g) => g === 'phantom').length;
  return { n: genders.length, boys, girls, phantom, real: boys + girls };
}

// A DEFINITION must be balanced when it describes the whole set or a mirroring
// half: a 4-dancer setup is a half-set authoring shortcut completed to the full
// set by rotating it 180 degrees (square-dancing.md §7.1), so a balanced half is
// what makes a balanced whole.
const definitionRequiresBalance = (n) => n === 8 || n === 4;

// A BOARD is a different matter. A board of fewer than 8 dancers is a SUBSET board
// — the boys acting, the centers acting — and a subset can legitimately be all one
// gender (which is exactly what makes "all boys" / "all girls" calls callable).
// Only a board holding the WHOLE set must be balanced.
const boardRequiresBalance = (n) => n === 8;

let failures = 0;
let checked = 0;
const unbalancedPartial = [];

function judge(kind, label, genders, requiresBalance) {
  const t = tally(genders);
  if (t.real === 0) return; // identity unknown; nothing to judge
  checked++;
  if (t.boys === t.girls) return;
  if (requiresBalance(t.n)) {
    failures++;
    console.log(`  FAIL  ${kind}: ${label} — n=${t.n} boys=${t.boys} girls=${t.girls}${t.phantom ? ` phantom=${t.phantom}` : ''}`);
  } else {
    unbalancedPartial.push(`${kind}: ${label} — n=${t.n} boys=${t.boys} girls=${t.girls}${t.phantom ? ` phantom=${t.phantom}` : ''}`);
  }
}

console.log('== Formations (formations.xml) ==');
const formations = parseFormations(formationsXml);
for (const [name, ds] of formations) judge('formation', name, ds.map((d) => d.gender), definitionRequiresBalance);
console.log(`  ${formations.size} formations checked`);

console.log('\n== Call setups (every <tam> with <dancer> elements) ==');
const levels = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
let tams = 0;
for (const lv of levels) {
  const dir = path.join(root, assets, lv);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    for (const block of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
      const dancerTags = block.match(/<dancer\b[^>]*>/g) ?? [];
      if (dancerTags.length === 0) continue;
      tams++;
      const genders = dancerTags.map((d) => (d.match(/gender="([^"]*)"/) ?? [])[1] ?? 'boy');
      const title = (block.match(/title="([^"]*)"/) ?? [])[1] ?? f;
      const from = (block.match(/from="([^"]*)"/) ?? [])[1];
      judge('setup', `${lv}/${f} "${title}"${from ? ` from="${from}"` : ''}`, genders, definitionRequiresBalance);
    }
  }
}
console.log(`  ${tams} setups checked`);

console.log('\n== Boards ==');
// Registered with the full catalog so formation boards resolve.
const calls = [];
for (const lv of levels) {
  const dir = path.join(root, assets, lv);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    calls.push({ name: f.replace(/\.xml$/, ''), xml: readFileSync(path.join(dir, f), 'utf8') });
  }
}
const seq = new Sequencer(movesXml, formationsXml, calls);
seq.reset();
judge('board', 'home squared set', seq.startBoard().dancers.map((d) => d.gender), boardRequiresBalance);
let unknownIdentity = 0;
for (const name of seq.listFormations()) {
  const b = seq.boardForFormation(name);
  if (!b) continue;
  const t = tally(b.dancers.map((d) => d.gender));
  if (t.real === 0) unknownIdentity++;
  else judge('board', `synthesised "${name}"`, b.dancers.map((d) => d.gender), boardRequiresBalance);
}
console.log(`  ${unknownIdentity} synthesised boards carry no identity yet (Phase 6 will stamp the declared gender)`);

// A subset board may legitimately be ALL ONE GENDER - that is what makes "all boys"
// / "all girls" calls callable - so the boys-only and girls-only subsets of the set
// must NOT be reported as errors.
const home = seq.startBoard();
const boys = home.dancers.filter((d) => d.gender === 'boy');
const girls = home.dancers.filter((d) => d.gender === 'girl');
const beforePartial = unbalancedPartial.length;
judge('board', 'boys-only subset board', boys.map((d) => d.gender), boardRequiresBalance);
judge('board', 'girls-only subset board', girls.map((d) => d.gender), boardRequiresBalance);
const added = unbalancedPartial.length - beforePartial;
console.log(`  all-boys (n=${boys.length}) and all-girls (n=${girls.length}) subset boards: reported for information, not failed` +
  ` — ${added === 2 ? 'both counted as legitimate subsets' : 'NOTE: expected 2 informational entries, got ' + added}`);

console.log('\n== Legitimately unbalanced (informational, never failed) ==');
{
  const byKind = { formation: 0, setup: 0, board: 0 };
  for (const x of unbalancedPartial) byKind[x.split(':')[0]]++;
  console.log(`  ${unbalancedPartial.length} entries: ${byKind.formation} subset formations, ${byKind.setup} subset/partial setups, ${byKind.board} subset boards.`);
  console.log('  A subset can legitimately be ALL ONE GENDER - that is what makes "all boys" /');
  console.log('  "all girls" calls callable - so these are reported, never failed (square-dancing.md §7.2).');
  console.log('  Examples:');
  for (const x of unbalancedPartial.slice(0, 5)) console.log('    ' + x);
  if (unbalancedPartial.length > 5) console.log(`    ... and ${unbalancedPartial.length - 5} more`);
}

console.log('\n=================');
if (failures === 0) console.log('GENDER AUDIT PASSED');
else {
  console.log(`${failures} FULL/HALF-SET DEFINITION(S) ARE UNBALANCED — fix the data`);
  process.exit(1);
}
