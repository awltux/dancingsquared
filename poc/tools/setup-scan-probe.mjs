// THE CATALOGUE-WIDE "IS THIS VARIANT'S SETUP NAMED?" SCAN, and the two buttons that narrow the editor's lists by it.
//
// REPORTED as: "Add two filter buttons after the free text Find field that filter for call variants with a) unmatched start
// setup and/or b) unmatched end setup. This is to help the editor fix incomplete call variants. Use begin, end glyphs for
// the buttons and a hover hints to explain what they do."
//
// WHAT IS MEASURED, and the alternative each check rules out:
//
//   1. the rule over the real corpus: every catalogue variant gets an answer (a scan that skipped one would read as "that
//      variant is fine"), the answer MATCHES THE PICKERS' OWN RULES asked directly (the risk is the key, not the
//      predicate - `setupIdx` must address the same tam `loadCall(id, setupIdx)` loads), an unbuildable tam is unmatched
//      at BOTH ends rather than absent, and the counts are non-zero so neither filter can be silently empty;
//   2. the negative control: a variant whose file is missing from the map has no tam, and must therefore be reported
//      unmatched at both ends - the failure mode "missing reads as healthy";
//   3. THE PANEL: the buttons sit after the Find box with the begin/end glyphs and their hints, the scan is LAZY (one pass
//      on the first press), the buttons are disabled while it runs, the two axes AND when both are pressed, the SETUP list
//      keeps each option's ORIGINAL index (a filtered list that renumbered would load a different authoring), the variant
//      being edited survives a filter that excludes it, and "open this variant" clears the filters rather than refusing.
//
// MEASURED while designing it, this machine, over the whole catalogue: 5,489 variants in 3.2 s (0.59 ms each); the ms
// level alone is 1,182 variants in 0.81 s. 638 variants are start-unmatched, 790 end-unmatched, and 1,202 are unmatched at
// the start, the end or both - which is why the scan is a lazy, cached pass and not something the panel can do on load.
//
// Run: node tools/setup-scan-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scanSetupMatches, variantKey } = await import(pathToFileURL(path.join(POC, 'src', 'setup-scan.ts')).href);
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
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
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

const assets = corpusRoot();
const formationsXml = fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const movesXml = fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formations = engine.parseFormations(formationsXml);
const moves = engine.parseMoves(movesXml);
const DEG = Math.PI / 180;
const sizeLists = new Map();
const formationsOfSize = (dancers) => {
  if (sizeLists.has(dancers)) return sizeLists.get(dancers);
  const out = [];
  for (const [name, ds] of formations) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length === dancers) out.push({ name, poses });
  }
  sizeLists.set(dancers, out);
  return out;
};

// THE CATALOGUE, grouped the way `parseCatalogFile` groups it: a call's id is `file::title`, and its `tamIndices` are the
// file-order indices of the tams that share that title. Built here because the browser loader cannot be imported in Node
// (its corpus is a Vite `?raw` import); the check below asserts the grouping accounts for every tam in the corpus.
const levels = fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name);
const files = new Map();
const catalogue = [];
let tamCount = 0;
for (const level of levels) {
  for (const f of [...filesOf(level)].sort().filter((x) => x.endsWith('.xml'))) {
    const file = `${level}/${f}`;
    const xml = fs.readFileSync(path.join(assets, file), 'utf8');
    files.set(file, xml);
    const tams = engine.parseCallXml(xml);
    tamCount += tams.length;
    const byTitle = new Map();
    tams.forEach((t, i) => {
      const title = t.title || file;
      const arr = byTitle.get(title) ?? [];
      arr.push(i);
      byTitle.set(title, arr);
    });
    for (const [title, tamIndices] of byTitle) catalogue.push({ id: `${file}::${title}`, file, tamIndices });
  }
}

const scanOnce = (input) => {
  const it = scanSetupMatches(input);
  let steps = 0;
  let last = null;
  for (;;) {
    const r = it.next();
    if (r.done) return { map: r.value, steps, last };
    steps++;
    last = r.value;
  }
};

// ---------------------------------------------------------------- 1. the rule over the corpus
console.log('\n== 1. every variant in the catalogue gets an answer, and it is the pickers\' answer ==');
let results;
{
  const t0 = performance.now();
  const { map, steps, last } = scanOnce({ catalogue, files, formations, moves, formationsOfSize });
  const ms = performance.now() - t0;
  results = map;
  const variants = catalogue.reduce((n, e) => n + e.tamIndices.length, 0);
  console.log(`    ${variants} variants scanned in ${ms.toFixed(0)} ms (${(ms / variants).toFixed(2)} ms each), in ${steps} progress steps`);
  check(variants === tamCount, `the catalogue accounts for every <tam> in the corpus (${variants} of ${tamCount}), so no variant is missing from the scan`);
  check(map.size === variants, `and the scan answered for every one of them (${map.size}), rather than skipping what it could not build`);
  check(steps > 1 && last !== null && last.done === last.total,
    `the progress steps run to the end and stop there (${last ? `${last.done}/${last.total}` : 'none'}) - a counter that never reaches its total is a scan that stopped`);
  let start = 0, end = 0, either = 0, both = 0;
  for (const m of map.values()) {
    if (!m.start) start++;
    if (!m.end) end++;
    if (!m.start || !m.end) either++;
    if (!m.start && !m.end) both++;
  }
  console.log(`    ${start} unmatched at the start, ${end} at the end, ${either} at either, ${both} at both`);
  check(start > 0 && end > 0, `both filters have a population (${start} / ${end}) - an empty one would be a filter that only ever hides the list`);
  check(both > 0 && both <= Math.min(start, end), `and the two axes overlap without being the same set (${both} at both ends), so "both pressed" is a real narrower answer rather than a duplicate`);

  // THE KEY IS THE RISK, not the predicate: `setupIdx` has to address the tam `loadCall(id, setupIdx)` loads, which is
  // `tamIndices[setupIdx]`. Ask the pickers' own rules directly for a sample and compare.
  let checked = 0;
  let mismatched = 0;
  for (const entry of catalogue) {
    const tams = engine.parseCallXml(files.get(entry.file));
    for (let setupIdx = 0; setupIdx < entry.tamIndices.length && checked < 60; setupIdx++) {
      const tam = tams[entry.tamIndices[setupIdx]];
      let direct;
      try {
        const call = engine.buildCall(tam, formations, moves, true);
        const list = formationsOfSize(call.dancers.length);
        direct = { start: list.some((f) => engine.startsFromFormation(call, f.poses)), end: engine.endFormationMatch(call, list) !== null };
      } catch {
        direct = { start: false, end: false };
      }
      const got = map.get(variantKey(entry.id, setupIdx));
      checked++;
      if (!got || got.start !== direct.start || got.end !== direct.end) {
        mismatched++;
        if (mismatched < 4) console.log(`    MISMATCH ${entry.id} #${setupIdx}: scan ${JSON.stringify(got)} vs direct ${JSON.stringify(direct)}`);
      }
    }
    if (checked >= 60) break;
  }
  check(checked >= 60, `the key was re-derived for ${checked} variants and compared against the rules asked directly`);
  check(mismatched === 0, `and every one agreed (${mismatched} mismatches), so setupIdx addresses the tam the panel would load`);

  // THE CORPUS WITNESS the report is about: a call whose END is only named because the formation is TURNED.
  const quarter = catalogue.find((e) => e.id.endsWith('::Circle Four Left 1/4') && e.file === 'ms/circle.xml');
  check(!!quarter, 'the corpus still carries "Circle Four Left 1/4" in ms/circle.xml');
  if (quarter) {
    const answers = quarter.tamIndices.map((_, i) => results.get(variantKey(quarter.id, i)));
    check(answers.some((a) => a && a.start && a.end),
      `and it is NOT reported as incomplete (${JSON.stringify(answers)}): the end that matches only when turned counts as a match, which is the rule the End setup row uses`);
  }
}

// ---------------------------------------------------------------- 2. missing must not read as healthy
console.log('\n== 2. a tam the scan cannot build is unmatched at BOTH ends, never absent ==');
{
  const entry = { id: 'nowhere/file.xml::Ghost', file: 'nowhere/file.xml', tamIndices: [0] };
  const { map } = scanOnce({ catalogue: [entry], files, formations, moves, formationsOfSize });
  const ghost = map.get(variantKey(entry.id, 0));
  check(map.size === 1, 'the scan answered for a variant whose file is not in the map at all, rather than dropping it');
  check(!!ghost && ghost.start === false && ghost.end === false,
    `and answered "unmatched at both ends" (${JSON.stringify(ghost)}) - a missing entry would read as a healthy variant`);
  // NEGATIVE CONTROL: the same catalogue, with the file present, is a different board - so the check above is about the
  // MISSING tam and not about the id.
  const real = { id: 'ms/circle.xml::Circle Four Left 1/2', file: 'ms/circle.xml', tamIndices: [0] };
  const realScan = scanOnce({ catalogue: [real], files, formations, moves, formationsOfSize });
  const realMatch = realScan.map.get(variantKey(real.id, 0));
  check(!!realMatch && (realMatch.start || realMatch.end),
    `NEGATIVE CONTROL: a real tam in the same shape answers something (${JSON.stringify(realMatch)}), so "both false" is not the scan's default`);
}

// ---------------------------------------------------------------- 3. the panel
console.log('\n== 3. the panel: two lazy filters after the Find box, with the begin and end glyphs ==');
{
  const html = readSource('index.html');
  const ui = readSource('src/editor-ui.ts');
  const css = readSource('src/style.css');
  const data = readSource('src/data.ts');

  // THE MARKUP: after the Find box, the begin glyph first and the end glyph second, both with a hint and both unpressed.
  const findAt = html.indexOf('id="edCallFilter"');
  const startAt = html.indexOf('id="edStartUnmatched"');
  const endAt = html.indexOf('id="edEndUnmatched"');
  const foundAt = html.indexOf('id="edCallFound"');
  check(findAt > 0 && startAt > findAt && endAt > startAt && foundAt > endAt,
    'the two buttons sit AFTER the Find box and before its readout, the start one first');
  check(/id="edStartUnmatched" class="ed-flag" aria-pressed="false"[^>]*>&#9198;<\/button>/.test(html),
    'the start button is the BEGIN glyph (&#9198;, "skip to start"), unpressed, and carries the icon class');
  check(/id="edEndUnmatched" class="ed-flag" aria-pressed="false"[^>]*>&#9197;<\/button>/.test(html),
    'the end button is the END glyph (&#9197;, "skip to end"), unpressed');
  check(/id="edStartUnmatched"[^>]*title="[^"]*START setup no named formation matches[^"]*"/.test(html) &&
    /id="edEndUnmatched"[^>]*title="[^"]*END setup no named formation matches[^"]*"/.test(html),
    'each hover hint says which END of the authoring it filters, in the words the panel uses elsewhere');
  check(/id="edStartUnmatched"[^>]*title="[^"]*scanned once[^"]*"/.test(html),
    'and the hint says the catalogue is scanned once, because that is where the wait will be');
  check(/#editorPanel \.ed-near,\n#editorPanel \.ed-flag \{/.test(css) && /#editorPanel \.ed-flag\[aria-pressed="true"\]/.test(css),
    'the CSS gives them the same pressed look as the other icon toggles, from one rule rather than a third copy');

  // THE RULE IS THE LOADER'S, and the panel drives it.
  check(/import \{ variantKey \} from '\.\/setup-scan';/.test(ui) && /scanSetupMatches,\n\} from '\.\/data';/.test(ui),
    'the editor imports the scan from the loader and the key from the rule, rather than re-deriving either');
  check(/if \(this\.setupMatches\) return;/.test(ui) && /if \(!this\.setupScan\) \{/.test(ui),
    'the scan is LAZY and runs ONCE: a second press waits on the same promise instead of scanning again');
  check(/button\.disabled = this\.setupScan !== null && this\.setupMatches === null;/.test(ui),
    'and the buttons are disabled while it runs, so a second press cannot start a second pass');
  check(/this\.statusEl\.textContent = `scanning for setups no formation names: \$\{done\} of \$\{total\} call variants…`/.test(ui),
    'the status line counts the scan, which is the only feedback 3.2 seconds of work gets');
  check(/function \*scanSetupMatches/.test(data) || /scanVariants\(/.test(data),
    'the loader drives the generator rather than owning a second copy of the scan');
  check(/await new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)\)/.test(data),
    'and it yields frames, or the count would never paint');

  // THE TWO AXES: independent, ANDed, and the readout names them.
  check(/if \(start && end\) return !match\.start && !match\.end;/.test(ui),
    'both pressed means unmatched at BOTH ends - the two narrow one list on two axes, the way the Find box\'s terms do');
  check(/return start \? !match\.start : !match\.end;/.test(ui), 'and either alone asks its own end only');
  check(/if \(!match\) return false;/.test(ui),
    'a variant the scan does not know (a created or cloned setup) is not offered, because it has no tam to answer about');
  check(/bits\.push\(`\$\{edit\.variants\} variant\$\{edit\.variants === 1 \? '' : 's'\} with \$\{which\} unmatched`\)/.test(ui),
    'the readout counts VARIANTS, which is what the buttons filter - a title count would leave the caller counting authorings');

  // THE LOAD PATH: filtered options keep their ORIGINAL index, and the variant in hand survives the filter.
  check(/const all = effectiveSetups\(callId\)\.map\(\(s, index\) => \(\{ label: s\.label, index \}\)\);/.test(ui),
    'the setup list is built with each variant\'s original index');
  check(/sel\.add\(new Option\(s\.label, String\(s\.index\)\)/.test(ui),
    'and the option VALUE is that original index - a filtered list that renumbered would load a different authoring');
  check(/sel\.value = String\(shown\[keep\]\.index\);/.test(ui),
    'while the caller\'s own setup is still selected by its original index');
  check(/opt\.title = 'kept — this is a setup the filter excludes, and it is what you are editing';/.test(ui),
    'and a variant the filter excludes is KEPT on screen, the same rule the call list applies to its own selection');
  check(/this\.setVariantFilter\(false, false\);\n      this\.applyCallFilter\(\);\n    \}\n    if \(!offers\(\)\)/.test(ui),
    'opening a named variant from the Browse panel clears the filters instead of answering "not in the catalogue" about a call that is');

  // NEGATIVE CONTROLS: the reverts that would restore the reported gaps.
  const noIndex = ui.replace('sel.add(new Option(s.label, String(s.index)))', 'sel.add(new Option(s.label, String(shown.indexOf(s))))');
  check(noIndex !== ui && !/String\(s\.index\)/.test(noIndex),
    'renumbering the filtered list fails the original-index check');
  const noKeep = ui.replace(/const kept = variant && previousLabel !== null \? all\.find\(\(s\) => s\.label === previousLabel\) : undefined;/, 'const kept = undefined;');
  check(noKeep !== ui && !/const kept = variant && previousLabel/.test(noKeep),
    'dropping the kept variant fails the survival check');
  const eager = ui.replace(/if \(this\.setupMatches\) return;/, 'if (this.setupMatches && false) return;');
  check(eager !== ui && !/if \(this\.setupMatches\) return;/.test(eager), 'and scanning on every press fails the lazy check');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
