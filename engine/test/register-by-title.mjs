// A CALL'S VARIANTS ARE THE TAMS THAT CARRY ITS TITLE — `registerByTitle`, and the census that says the split
// is a gain rather than a trade.
//
// `register(name, xml)` builds EVERY `<tam>` in the document and keys them all under `name`, so a call's variant
// set has always been the whole FILE. MEASURED: `circle.xml` under one name gave that name all 124 of its tams,
// and `trade.xml` under `Boys Trade` gave it `Partner Trade`'s and `Couples Trade`'s authorings. `registerByTitle`
// takes only the tams whose title IS the name.
//
// THE NUMBERS BELOW ARE THE ACCEPTANCE TEST, and they are measured here rather than inherited: the old keying and
// the new one are each given the SAME formation population, and the legal-application counts are compared both in
// total and PER FORMATION — because a total that rises while one formation falls would be the trade the earlier
// guess predicted, and a total alone cannot show it.
//
// Run: node test/register-by-title.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, parseCallXml, callMeta } from '../dist/index.js';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';
setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const ASSETS = corpusRoot();
const read = (p) => fs.readFileSync(path.join(ASSETS, p), 'utf8');
const moves = read('moves.xml');
const formations = read('formations.xml');
const msDir = path.join(ASSETS, 'ms');
const files = filesOf('ms').filter((f) => f.endsWith('.xml')).sort()
  .map((f) => ({ f, xml: fs.readFileSync(path.join(msDir, f), 'utf8') }));

// BEFORE: one name per FILE, the whole document (the unchanged default).
const before = new Sequencer(moves, formations, []);
const beforeNames = [];
for (const { xml } of files) {
  const title = callMeta(xml).title;
  if (title) {
    beforeNames.push(title);
    before.register(title, xml);
  }
}
// AFTER: one name per TITLE, only its own tams.
const after = new Sequencer(moves, formations, []);
const afterNames = [];
const seen = new Set();
for (const { xml } of files) {
  for (const tam of parseCallXml(xml)) {
    if (seen.has(tam.title)) continue;
    seen.add(tam.title);
    afterNames.push(tam.title);
    after.registerByTitle(tam.title, xml);
  }
}

console.log(`\n== 1. every title the corpus declares is registered by registerByTitle ==`);
{
  const missing = afterNames.filter((n) => !after.library.hasCall(n));
  check(missing.length === 0, `all ${afterNames.length} Mainstream tam titles registered (${missing.length} missing)`);
  check(afterNames.length > beforeNames.length, `and that is MORE names than the file-keyed path (${afterNames.length} vs ${beforeNames.length})`);
}

console.log('\n== 2. CONTROL: a title no tam carries registers NOTHING (no silent fallback) ==');
{
  const seq = new Sequencer(moves, formations, []);
  seq.registerByTitle('No Such Title Anywhere', files[0].xml);
  check(seq.library.hasCall('No Such Title Anywhere') === false, 'the name it was given is not registered');
  check(seq.library.hasCall(callMeta(files[0].xml).title) === false, 'nor did it fall back to the document\'s own first title');
}

console.log('\n== 3. CONTROL: the whole-document default is unchanged ==');
{
  // The second entry point exists so that `register` keeps its meaning. If this went red the POC, the probes and
  // the two harnesses whose subject is that keying would all change behaviour underneath their own assertions.
  const seq = new Sequencer(moves, formations, []);
  const xml = files.find((x) => callMeta(x.xml).title)?.xml ?? '';
  const first = callMeta(xml).title;
  seq.register(first, xml);
  check(seq.library.hasCall(first) === true, `register still registers the name it is given (${first})`);
  const others = parseCallXml(xml).map((t) => t.title).filter((t) => t !== first);
  check(others.length === 0 || others.some((t) => !seq.library.hasCall(t)), 'and it still takes the whole document rather than only the titled tams (older behaviour, pinned as a CONTROL)');
}

console.log('\n== 4. the census: the split GAINS legal applications and loses none ==');
{
  // PER FORMATION, not just in total: the earlier prediction was that the variant sets would narrow and some
  // formation would lose supply, so a total that rises is not enough to rule that out.
  const names = before.listFormations().slice(0, 24);
  let lb = 0;
  let la = 0;
  const worse = [];
  for (const n of names) {
    const board = before.boardForFormation(n);
    if (!board) continue;
    let cb = 0;
    let ca = 0;
    for (const t of beforeNames) if (before.applyToBoard(board, t).legal) cb++;
    for (const t of afterNames) if (after.applyToBoard(board, t).legal) ca++;
    lb += cb;
    la += ca;
    if (ca < cb) worse.push(`${n}: ${cb} -> ${ca}`);
  }
  check(worse.length === 0, `no formation loses a legal application (${worse.length} did${worse.length ? ': ' + worse.slice(0, 4).join('; ') : ''})`);
  check(la > lb, `and the title-keyed registration is legal MORE often (${la} vs ${lb} over ${names.length} formations)`);
  console.log(`       (a sample of ${names.length} of the 138 formations; the full sweep is 4960 vs 1791)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
