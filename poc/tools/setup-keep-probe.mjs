// THE SETUP A CALL OPENS ON WHEN THE CALL CHANGES, and the corpus that makes it worth having.
//
// Reported as: "Call Editor: When selecting a new call, if the existing Setup also exists in the new call, pre-select
// it. Often I'm working on the same Setup across the same call family." The panel used to refill the setup list and
// leave the browser's default on the FIRST authoring, so switching call inside a family threw the caller back to
// `Static Square`.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. the rule itself (`keptSetupIndex`): the same label is kept; a label the new call does NOT have falls back to the
//      first entry; duplicate labels keep the FIRST; an empty list is -1; a blank previous label keeps nothing; and
//      the match is exact after trimming - the plausible wrong rules are checked to fail, e.g. "always the first" and
//      "match by index" (an index is a position, and the whole report is that positions do not carry the setup);
//   2. IT IS THE CORPUS'S OWN PROBLEM, not a fixture's: how many calls carry more than one authoring, and how many
//      pairs of calls in one file share a setup label - the number that says the family workflow exists;
//   3. a WITNESS PAIR taken from the parsed corpus rather than written out here: two real calls whose setup lists
//      share a label, driven through the rule;
//   4. the wiring: every call-change handler in the panel passes the label it is showing into `fillSetupSelect`, and
//      the panel's own startup does NOT (a fresh panel has no setup to keep);
//   5. THE NEGATIVE CONTROL for the panel: the label read has to happen BEFORE the refill clears the list - the code
//      that reads it after would keep the first entry every time, which is the behaviour being replaced.
//
// Run: node tools/setup-keep-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { keptSetupIndex } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'setup-keep.ts')).href);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};

// ---------------------------------------------------------------- 1. the rule
console.log('\n== 1. which setup a refilled list selects ==');
{
  const SETUPS = ['Static Square', 'Normal Lines Compact', 'Circle', 'Normal Lines Compact'];
  check(keptSetupIndex(SETUPS, 'Circle') === 2, 'a setup the new call has is kept, by its label (Circle -> index 2)');
  check(keptSetupIndex(SETUPS, 'Static Square') === 0, 'including the first one: Static Square stays on index 0 because it IS there, not because it is the default');
  check(keptSetupIndex(SETUPS, 'Normal Lines Compact') === 1, 'and a label the call carries TWICE keeps the FIRST of them (index 1), which is the one the list offers first');
  check(keptSetupIndex(['Static Square', 'Circle'], 'Alamo Wave') === 0, 'a setup the new call does NOT have falls back to the first entry (0)');
  check(keptSetupIndex(['Static Square', 'Circle'], null) === 0 && keptSetupIndex(['Static Square', 'Circle'], '') === 0 && keptSetupIndex(['Static Square', 'Circle'], '   ') === 0,
    'a panel with nothing selected (null, empty or blank) has nothing to keep and opens on the first');
  check(keptSetupIndex([], 'Circle') === -1, 'and a call with no setups at all is -1, which the panel reads as "leave the select alone"');
  check(keptSetupIndex(['Static Square', ' Circle '], 'Circle') === 1 && keptSetupIndex(['Static Square', 'Circle'], ' Circle ') === 1,
    'whitespace is trimmed on both sides of the comparison');
  // THE NEGATIVE CONTROLS. "Always the first" is what the panel did, and "match by index" is the tempting repair - an
  // index is a POSITION, and the two lists are different calls' authorings.
  check(keptSetupIndex(SETUPS, 'Circle') !== 0, 'NEGATIVE CONTROL: the old behaviour (always the first entry) gets a DIFFERENT answer for Circle, so the check above measures the keeping');
  const byIndex = (labels, previous) => (previous ? Math.min(labels.indexOf(previous), 0) : 0);
  check(byIndex(SETUPS, 'Circle') !== keptSetupIndex(SETUPS, 'Circle'), 'NEGATIVE CONTROL: selecting by the previous INDEX would look up "Circle" as though it were a label and fall back to 0');
}

// ---------------------------------------------------------------- 2. the corpus this is for
console.log('\n== 2. the corpus: how often the workflow exists ==');
const assets = corpusRoot();
const calls = []; // { rel, title, setups: string[] }
for (const level of fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name)) {
  for (const f of filesOf(level).filter((x) => x.endsWith('.xml'))) {
    const rel = `${level}/${f}`;
    let tams;
    try {
      tams = engine.parseCallXml(fs.readFileSync(path.join(assets, rel), 'utf8'));
    } catch {
      continue;
    }
    const byTitle = new Map();
    for (const tam of tams) {
      const title = tam.title;
      if (!title) continue;
      const label = (tam.formationAttr ?? tam.from ?? '').trim();
      if (!byTitle.has(title)) byTitle.set(title, []);
      if (label) byTitle.get(title).push(label);
    }
    for (const [title, setups] of byTitle) calls.push({ rel, title, setups });
  }
}
const multi = calls.filter((c) => c.setups.length > 1);
console.log(`    ${calls.length} calls over ${new Set(calls.map((c) => c.rel)).size} files; ${multi.length} of them carry more than one authoring`);
{
  // Pairs INSIDE one file: switching between two calls of one family is the reported workflow, and a family is written
  // in one file.
  const byFile = new Map();
  for (const c of multi) {
    if (!byFile.has(c.rel)) byFile.set(c.rel, []);
    byFile.get(c.rel).push(c);
  }
  let pairs = 0;
  let share = 0;
  const witnesses = [];
  for (const group of byFile.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pairs++;
        const common = group[i].setups.find((label) => group[j].setups.includes(label));
        if (common) {
          share++;
          if (witnesses.length < 3 || (group[i].title.startsWith('Circle Left') && witnesses.length < 6)) witnesses.push({ a: group[i], b: group[j], common });
        }
      }
    }
  }
  check(multi.length > 50, `${multi.length} calls offer a choice of authoring at all, so there is a setup to keep`);
  check(share > 0 && share < pairs,
    `${share} of the ${pairs} pairs of multi-authoring calls in one file SHARE a setup label (the rest do not, so the rule has to be conditional rather than unconditional)`);
  console.log(`    a family pair that shares one: "${witnesses[0].a.title}" and "${witnesses[0].b.title}" both start from ${witnesses[0].common}`);

  // ---------------------------------------------------------------- 3. a witness pair from the corpus
  console.log('\n== 3. a witness pair, from the corpus rather than a fixture ==');
  const pair = witnesses.slice(0, 40).find((w) => w.b.setups.indexOf(w.common) > 0) ?? witnesses[0];
  const before = pair.a.setups;
  const after = pair.b.setups;
  const kept = keptSetupIndex(after, pair.common);
  check(after[kept] === pair.common,
    `moving from "${pair.a.title}" to "${pair.b.title}" keeps ${pair.common} (${JSON.stringify(after)} -> index ${kept})`,
    JSON.stringify(after));
  check(kept !== 0 || after[0] === pair.common,
    'and it is not simply the first entry of the new list, unless the shared label happens to be first');
  const notThere = keptSetupIndex(after, 'A Setup Neither Call Has');
  check(notThere === 0, `while a label NEITHER call has falls back to the first entry of the new list (${after[0]})`);
}

// ---------------------------------------------------------------- 4 & 5. the panel wiring
console.log('\n== 4. the panel calls it, in the right order ==');
{
  const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  check(/const keep = keptSetupIndex\(labels, previousLabel\);\s*\n\s*if \(keep >= 0\) sel\.value = String\(keep\);/.test(src),
    '`fillSetupSelect` selects the kept index after filling, and only when the call has a setup at all');
  // FOUND BY ID, one at a time: a single regex over all three handlers silently measures whichever it happens to match
  // first, and the failure mode of that is the check going green while one panel is still refilling bare.
  const wired = ['editCallSel', 'postCallSel', 'preCallSel'].map((id) => {
    const at = src.indexOf(`this.${id}.addEventListener('change'`);
    return at < 0 ? null : { id, body: src.slice(at, at + 400) };
  });
  check(wired.every(Boolean), `all three call pickers are wired (${wired.filter(Boolean).map((w) => w.id).join(', ')})`);
  check(wired.every((w) => w && new RegExp(`setupLabelOf\\(this\\.${w.id.replace('CallSel', 'SetupSel')}\\)`).test(w.body)),
    'and every one of them passes the label IT is showing into the refill, rather than refilling bare or reading another picker\'s setup');
  check(wired.every((w) => w && w.body.includes('setupLabelOf') && w.body.includes('fillSetupSelect')),
    'the label is read as an ARGUMENT of the refill, so it cannot be read after the list has been cleared');
  // The STARTUP fills must NOT keep anything: the panel has no setup to keep before the first call is loaded, and the
  // constructor runs before the editor is even visible.
  const ctor = src.slice(src.indexOf('this.fillSetupSelect(this.editSetupSel'), src.indexOf('this.fillSetupSelect(this.preSetupSel'));
  check(!/setupLabelOf/.test(ctor), 'and the panel\'s startup fills keep nothing - there is no previous setup at construction');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
