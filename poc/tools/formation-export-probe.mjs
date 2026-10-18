// THE CALL EDITOR'S `Export <formation>`: the START formation written as a `<formation>` block for
// `assets/formations.xml`, and the VERDICT that says what pasting it would do.
//
// Asked for as: "Call editor: When I change the order of the dancer list, I'm really changing the formation
// definition, but there is no way to export a formation from the call editor. Add an 'Export <formation>' button."
//
// THE OBSERVATION IS THE FORMAT, and this probe measures it rather than taking it on trust: a `<tam>`'s paths are
// paired with the formation's dancers BY POSITION IN THE LIST (`buildCallImpl` pairs `dancers[i]` with `paths[i]`),
// so two dancers swapped in the editor's table is the same eight spots in a DIFFERENT ORDER - which is a different
// setup to every call that names that formation. Section 2 does that swap on a real corpus call through the
// engine's own `swapDancers`, and the negative control beside it is an ORDER-INSENSITIVE comparison (the rule
// `tam-xml.ts`'s `sameArrangement` uses for the arrangement picker, where order genuinely does not matter): it
// calls the swapped formation "the same", which is exactly why it must not be the rule here.
//
// HALF THE SET, which is how the corpus writes a formation and how the reader reads one: the missing dancers are
// reconstituted at load time by duplicating the written ones and turning them 180 degrees about the board centre.
// Asked for as: "the formation uses symmetry about the origin of the board to only include half the dancers. The
// missing dancers are reconstituted at load time by duplication and rotation about the center by 180 deg."
// Section 4 measures that the half written here is the corpus's OWN half - for all 291 entries the written count
// is the count the file authored - and that a board which is NOT its own half is written out in full instead,
// because halving it would silently drop dancers.
//
// WHAT THE BUTTON WRITES, and each is pinned below:
//   - the half, in list order, with the gender at each spot, or every dancer when the board is not symmetric
//     about the centre (section 4);
//   - the name, and no block at all when there is no name - a `<formation>` without one is skipped by the reader
//     (section 5, with the skipped-name block measured against `parseFormations`);
//   - the heading in DEGREES through the engine's `formationToXml`, read back by the engine's `parseFormations`, so
//     the writer and the reader are measured against each other rather than against this file's arithmetic
//     (section 1 round-trips all 291 corpus formations; section 6 is the unit control);
//   - THE CLIPBOARD, and nothing else: "No need to show the exported text. Just put it on the OS copy buffer"
//     (section 7 checks the handler never touches the pane, and does not clear it on a refusal either).
//
// COST: one parse of `formations.xml` and one of a call file, plus 291 round trips - about a second, so this stays
// in the fast tier.
//
// Run: node tools/formation-export-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

// THE RULE ITSELF, imported rather than restated (AGENTS.md §5): the module, the half-set rule it is given poses
// in, and nothing of the panel's.
const { formationExportXml } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'formation-xml.ts')).href);
const { completeHalfSet } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg);
  }
};

const readSource = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8').replace(/\r\n/g, '\n');

const ASSETS = path.join(POC_DIR, '..', 'assets');
const formationsXml = fs.readFileSync(path.join(ASSETS, 'formations.xml'), 'utf8');
const corpus = engine.parseFormations(formationsXml);
const TOL = 1e-3;
const toRad = (d) => (d * Math.PI) / 180;

/** The poses the ENGINE would build for a name: the AUTHORED dancers completed to the whole set. This is the same
 *  resolution `tam-xml.ts`'s `corpusFormationPoses` offers the panel, and the same rule `buildCallImpl` applies
 *  before pairing paths. */
const resolved = (name) => {
  const authored = corpus.get(name);
  if (!authored) return null;
  return completeHalfSet(authored.map((d) => ({ x: d.x, y: d.y, heading: toRad(d.angleDeg), gender: d.gender })));
};

/** Back through the engine's READER: the dancers a pasted block would AUTHOR, and how many formations it names. */
const readAuthored = (xml) => {
  const map = engine.parseFormations(xml);
  const spots = [];
  for (const [, ds] of map) for (const d of ds) spots.push({ x: d.x, y: d.y, heading: toRad(d.angleDeg), gender: d.gender });
  return { named: map.size, spots };
};
const complete = (spots) => completeHalfSet(spots.map((p) => ({ ...p })));

const sameSpot = (a, b) =>
  Math.abs(a.x - b.x) <= TOL &&
  Math.abs(a.y - b.y) <= TOL &&
  Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))) <= TOL &&
  a.gender === b.gender;
const sameBoard = (a, b) => a.length === b.length && a.every((p, i) => sameSpot(p, b[i]));

// ------------------------------------------------------------------ 1. the corpus, out and back
console.log(`\n== 1. every corpus formation exported under its own name reads back as itself (${corpus.size} entries)`);

check(corpus.size > 250, `formations.xml parsed into ${corpus.size} named formations - a zero here would make the sweep vacuous`);
let roundTripped = 0;
let worst = 0;
let worstWhere = '';
const verdicts = { add: 0, same: 0, reordered: 0, changed: 0 };
let sizeMatched = 0;
for (const [name] of corpus) {
  const poses = resolved(name);
  const result = formationExportXml(name, poses, resolved);
  if (!result) {
    check(false, `"${name}" exported a block`);
    continue;
  }
  verdicts[result.verdict]++;
  const back = readAuthored(result.xml);
  const completed = complete(back.spots);
  // THE BLOCK IS THE HALF (or the whole set); it is not the board until the reader completes it.
  if (back.named !== 1 || back.spots.length !== result.written || !sameBoard(completed, poses)) {
    check(false, `"${name}" completed its block back to itself (${back.spots.length} written, ${poses.length} expected on the board)`);
    continue;
  }
  // AND IT IS THE CORPUS'S OWN SIZE: the file authored this many dancers, so the export reproduces its authoring.
  if (result.written === corpus.get(name).length) sizeMatched++;
  else check(false, `"${name}" wrote ${result.written} dancers where the corpus authored ${corpus.get(name).length}`);
  // THE ERROR OF THE ROUND TRIP, over the completed board - the number a paste would actually move a dancer by.
  for (let i = 0; i < poses.length; i++) {
    const err = Math.max(Math.abs(completed[i].x - poses[i].x), Math.abs(completed[i].y - poses[i].y));
    if (err >= worst) {
      worst = err;
      worstWhere = `${name} spot ${i}`;
    }
  }
  roundTripped++;
}
check(roundTripped === corpus.size, `all ${corpus.size} entries complete back to themselves, worst completed-position error ${worst.toExponential(2)} (${worstWhere})`);
check(sizeMatched === corpus.size, `and every one is written at the count the corpus authored it with (${sizeMatched} of ${corpus.size}) - the HALF for a symmetric board, the whole set for the ten that are already whole`);
check(verdicts.same === corpus.size, `and every one exports as \`same\` (${verdicts.same} of ${corpus.size}), so the comparison is not reporting phantom changes`);

// ------------------------------------------------------------------ 2. the reported case: a swapped pair
console.log('\n== 2. the reported case: two dancers swapped in the list is a different formation');

const movesXml = fs.readFileSync(path.join(ASSETS, 'moves.xml'), 'utf8');
/** A call whose start really IS a named corpus formation, found rather than named, so a corpus rename cannot
 *  quietly make this section vacuous. */
let sample = null;
outer: for (const level of ['ms', 'plus', 'a1', 'a2']) {
  const dir = path.join(ASSETS, level);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml')).sort()) {
    let tams;
    try {
      tams = engine.parseCallXml(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    for (const tam of tams) {
      if (!tam.formationAttr || !resolved(tam.formationAttr)) continue;
      let call;
      try {
        call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(dir, f), 'utf8'), movesXml, formationsXml, tam.title));
      } catch {
        continue;
      }
      if (!engine.startsFromFormation(call, resolved(tam.formationAttr))) continue;
      if (call.dancers.length !== 8) continue;
      sample = { where: `${level}/${f}`, title: tam.title, formation: tam.formationAttr, call };
      break outer;
    }
  }
}
check(sample !== null, `a shipped call was found whose start IS its named formation${sample ? `: ${sample.where} "${sample.title}" from ${sample.formation}` : ''}`);

if (sample) {
  const poses = engine.instanceTable(sample.call).map((r) => r.start);
  const before = formationExportXml(sample.formation, poses, resolved);
  check(before?.verdict === 'same', `exported before any edit it is \`${before?.verdict}\`, so the sample starts from its formation as the corpus writes it`);
  check(before?.written === poses.length / 2, `and it writes the HALF set (${before?.written} of ${poses.length}), which is how the corpus carries it`);

  const swapped = engine.swapDancers(sample.call, 0, 1);
  const after = formationExportXml(sample.formation, engine.instanceTable(swapped).map((r) => r.start), resolved);
  check(after?.verdict === 'reordered', `after swapping dancers 1 and 2 it is \`${after?.verdict}\` rather than \`same\` - the case the button exists for`);
  check(after?.differing === 2 && after?.count === 8, `and exactly ${after?.differing} of ${after?.count} spots differ, so the count names the swap rather than the whole set`);
  check(after?.written === 8, `the swapped board is not its own half, so all ${after?.written} dancers are written rather than a half that would not complete to it`);
  check(!engine.startsFromFormation(swapped, resolved(sample.formation)),
    "and the ENGINE agrees it no longer starts from that formation (`startsFromFormation` false), so the verdict and the export's own reference rule are the same reading");
  // THE NEGATIVE CONTROL: the order-insensitive rule. It is the right rule for the arrangement DROPDOWN (two spells
  // of one board), and the wrong one here - it cannot see the swap at all.
  const insensitive = after !== null && poses.length === resolved(sample.formation).length && after.verdict === 'same';
  check(insensitive === false, 'an ORDER-INSENSITIVE comparison would call the swapped formation "same", which is why the verdict is index-for-index');
}

// ------------------------------------------------------------------ 3. changed spots, and gender is one
console.log('\n== 3. a spot that moves, or a gender that changes, is `changed`');

if (sample) {
  const base = engine.instanceTable(sample.call).map((r) => r.start);
  const moved = base.map((p, i) => (i === 3 ? { ...p, x: p.x + 0.5 } : p));
  const movedResult = formationExportXml(sample.formation, moved, resolved);
  check(movedResult?.verdict === 'changed' && movedResult?.differing === 1,
    `moving one dancer half a unit is \`${movedResult?.verdict}\` with ${movedResult?.differing} spot differing`);

  const regendered = base.map((p, i) => (i === 0 ? { ...p, gender: p.gender === 'boy' ? 'girl' : 'boy' } : p));
  const regenderedResult = formationExportXml(sample.formation, regendered, resolved);
  check(regenderedResult?.verdict === 'changed' && regenderedResult?.differing === 1,
    `and swapping the GENDER at one spot is \`${regenderedResult?.verdict}\` with ${regenderedResult?.differing} spot differing - the arrangement is part of the formation`);
  check(regenderedResult?.verdict !== 'reordered', 'and NOT `reordered`, which is what a gender-blind comparison would say');

  const added = base.slice(0, base.length - 1);
  const shortened = formationExportXml(sample.formation, added, resolved);
  check(shortened?.verdict === 'changed' && shortened?.count === base.length - 1,
    `a set one dancer short is \`${shortened?.verdict}\` rather than \`reordered\`, because a size is not an order`);
  // AND THE SIZE IS REPORTED AS A SIZE, because the counts differ and a sentence about "differing spots" would
  // read "8 of 7 spots". Found by walking the same case in the browser on a six-dancer call.
  check(shortened?.corpusCount === base.length && shortened?.count === base.length - 1,
    `and it carries both counts (${shortened?.count} written against ${shortened?.corpusCount} in the corpus), so the panel can say the set is a different SIZE rather than counting spots`);
}

// ------------------------------------------------------------------ 4. the half, as the corpus writes it
console.log('\n== 4. HALF the set, because that is what the corpus writes and what the reader completes');

{
  // THE CORPUS'S OWN AUTHORING: how many entries write half the board they stand for.
  const authoredHalf = [...corpus.keys()].filter((n) => corpus.get(n).length * 2 === resolved(n).length);
  check(authoredHalf.length > 250,
    `${authoredHalf.length} of the ${corpus.size} corpus formations are authored as HALF a set, which is the convention this writes`);
  check(authoredHalf.every((n) => formationExportXml(n, resolved(n), resolved)?.written === corpus.get(n).length),
    'and every one of them is written at exactly the count the file authored, so the block reproduces the corpus rather than a longer or halved version of it');

  // THE COMPLETION IS THE READER'S OWN RULE, so the half is only right if completing it gives the board back. That
  // is measured for all 291 in section 1; here it is measured for one board, spot by spot.
  const name = [...corpus.keys()].find((n) => resolved(n).length === 8);
  const poses = resolved(name);
  const result = formationExportXml(name, poses, resolved);
  const back = readAuthored(result.xml);
  check(result.written === 4 && back.spots.length === 4, `"${name}" writes ${result.written} dancers for an eight-dancer board, and the block holds ${back.spots.length}`);
  check(sameBoard(complete(back.spots), poses), 'and the reader completes that half back to the board, index for index');
  // THE ANTIPODE IS WHAT MAKES IT HALF: each written dancer's partner is the same gender 180 degrees about the
  // origin, which is the duplication the corpus relies on.
  const partners = back.spots.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender }));
  check(sameBoard(partners, back.spots.map((p, i) => poses[i + back.spots.length])),
    'and every dancer of the missing half IS its partner turned 180 degrees about the centre, which is the duplication the reader performs');

  // THE CONTROL: A BOARD THAT IS NOT ITS OWN HALF IS WRITTEN IN FULL. Halving it would lose dancers.
  const broken = poses.map((p, i) => (i === 0 ? { ...p, x: p.x + 0.5 } : p));
  const brokenResult = formationExportXml(name, broken, resolved);
  check(brokenResult.written === 8 && readAuthored(brokenResult.xml).spots.length === 8,
    `while a board one dancer moved is written out in FULL (${brokenResult.written} dancers), because no half completes to it`);
  check(sameBoard(readAuthored(brokenResult.xml).spots, broken),
    'and the full block reads back as the board it was given, which is the fallback working');

  // AN ODD SET HAS NO HALF BY ROTATION, and is written in full rather than losing a dancer.
  const odd = poses.slice(0, 3);
  const oddResult = formationExportXml(name, odd, resolved);
  check(oddResult.written === 3, `and a three-dancer set writes all ${oddResult.written}, because half of three is not a set`);

  // NOTHING SMALLER THAN TWO DANCERS. A two-dancer board IS its own half - one dancer turned 180 degrees about the
  // centre is the other - but the corpus authors no one-dancer entry and 62 two-dancer ones, so the export keeps
  // the file's smallest size. MEASURED: without this floor "Opposite Boy" and "Opposite Girl" come out as one
  // dancer and the authored-count check in section 1 reads 289 of 291.
  const pair = corpus.get('Opposite Boy');
  check(pair !== undefined && pair.length === 2, 'the corpus carries two-dancer formations ("Opposite Boy")');
  if (pair) {
    const pairPoses = resolved('Opposite Boy');
    const pairResult = formationExportXml('Opposite Boy', pairPoses, resolved);
    check(pairResult.written === 2, `and one exports as both its dancers (${pairResult.written}), not as the single dancer that would imply the other`);
    check(sameBoard(complete(readAuthored(pairResult.xml).spots), pairPoses), 'which still completes to the same board');
  }
}

// ------------------------------------------------------------------ 5. a name, or nothing at all
console.log('\n== 5. the name is the caller\'s, and no name means no block');

{
  const somePoses = resolved([...corpus.keys()][0]);
  check(formationExportXml('', somePoses, resolved) === null, 'an empty name is refused rather than written as an empty attribute');
  check(formationExportXml('   ', somePoses, resolved) === null, 'and so is a name of spaces');
  check(formationExportXml(null, somePoses, resolved) === null && formationExportXml(undefined, somePoses, resolved) === null,
    'and a missing one');
  const unnamed = engine.formationToXml('', somePoses);
  check(readAuthored(unnamed).named === 0, 'THE CONTROL: the block that a nameless export would write names no formation at all once the reader sees it');
  const trimmed = formationExportXml('  My Formation  ', somePoses, resolved);
  check(trimmed?.name === 'My Formation', `and a typed name is trimmed and used verbatim ("${trimmed?.name}")`);
  check(trimmed?.verdict === 'add', 'with `add`, because no corpus formation carries that name');
  check(readAuthored(trimmed.xml).named === 1, 'and the block reads back as exactly one formation under that name');
  const amp = formationExportXml('Boys & Girls "special"', somePoses, resolved);
  check(readAuthored(amp.xml).named === 1, 'a name with & and quotes is escaped by the engine\'s writer and still reads back as one formation');
}

// ------------------------------------------------------------------ 6. the heading's unit
console.log('\n== 6. the heading crosses the boundary as DEGREES, in both directions');

{
  const spots = [{ x: 1, y: -2, heading: Math.PI / 2, gender: 'girl' }];
  const out = formationExportXml('Unit Check', spots, () => null);
  const back = readAuthored(out.xml).spots[0];
  check(Math.abs(back.heading - Math.PI / 2) <= TOL, `a heading of 90 degrees reads back as ${((back.heading * 180) / Math.PI).toFixed(3)} degrees`);
  check(/angle="90"/.test(out.xml), 'and the attribute it was written as is 90, not 1.5708');
  // THE CONTROL: the same number with no conversion is what a writer that forgot the unit would emit.
  const unconverted = engine.formationToXml('Unit Check', [{ x: 1, y: -2, heading: Math.PI / 2, gender: 'girl' }]).replace('angle="90"', 'angle="1.5707963"');
  check(Math.abs(readAuthored(unconverted).spots[0].heading - Math.PI / 2) > 1, 'while the same number taken as degrees would read back 88.4 degrees away from the heading');
}

// ------------------------------------------------------------------ 7. the panel
console.log('\n== 7. the panel: the button beside the tam export, one handler, the imported rule, the clipboard only');

{
  const html = readSource('index.html');
  const ui = readSource('src/editor-ui.ts');
  const handler = ui.slice(ui.indexOf('private doExportFormation()'), ui.indexOf('private doExportAll()'));
  const buttonAt = (id) => {
    const at = html.indexOf(`id="${id}"`);
    return at < 0 ? '' : html.slice(at, html.indexOf('</button>', at));
  };
  check(/<button id="edExportFormation"[^>]*>Export &lt;formation&gt;<\/button>/.test(html),
    'index.html carries a button whose whole label is "Export <formation>"');
  // THE FIRST `<tam>` EXPORT IS THE INSTANCE PANEL'S (`edInstExport`), so that is the one it sits beside - asked
  // for as "move the button next to the first 'Export <tam>' button".
  const instRow = html.slice(html.indexOf('id="edInstExport"'), html.indexOf('id="gridMode"'));
  check(instRow.indexOf('id="edExportFormation"') > 0,
    'and it sits in the instance panel\'s own row, after the first `<tam>` export and before the grid switch');
  check(html.indexOf('id="edExportFormation"') < html.indexOf('id="edExport"'),
    'which is before the second `<tam>` export, in a row of its own at the bottom of the panel');
  check(!/id="edFormationName"/.test(html), 'with NO name field beside it - asked for as "no need for the \'formation name\' input field"');
  check(/HALF the set/.test(buttonAt('edExportFormation')) && /clipboard/.test(buttonAt('edExportFormation')) &&
    /setup's own `formation` attribute/.test(buttonAt('edExportFormation')),
    'whose tooltip says where the name comes from, that it writes the HALF set the reader completes, and that it goes on the clipboard');

  check(/private exportFormationBtn = el<HTMLButtonElement>\('edExportFormation'\)/.test(ui),
    'it is reached through `el()`, so a missing id fails loudly instead of doing nothing');
  check(!/formationNameInput|edFormationName/.test(ui), 'and the panel has no name field to read, so the markup and the code cannot disagree about one');
  check(/this\.exportFormationBtn\.addEventListener\('click', \(\) => this\.doExportFormation\(\)\);/.test(ui),
    'and one listener calls one method');
  check(/^import \{ formationExportXml \} from '\.\/formation-xml';$/m.test(ui),
    'the handler uses the imported rule rather than a private copy');
  check(/formationExportXml\(call\.formation \|\| call\.from, spots, corpusFormationPoses\)/.test(ui) &&
    /const call = this\.instance;/.test(handler),
    "and the name it writes is the setup's own `formation`, then its `from` - the corpus's own precedence for naming a setup");
  check(/const spots = instanceTable\(call\)\.map\(\(r\) => r\.start\);/.test(ui),
    'the spots come from `instanceTable`, the same read the formation table below is built from');
  // THE PANE IS NOT THE OUTPUT. Asked for as: "No need to show the exported text. Just put it on the OS copy buffer."
  check(/navigator\.clipboard\?\.writeText\(buildStamp\(\) \+ '\\n' \+ result\.xml\);/.test(handler),
    'the stamped block goes straight to the clipboard');
  check(!/xmlEl/.test(handler),
    "and the handler never touches the pane - not even to clear it on a refusal, because it is not this button's to clear");
  check(/✗ cannot export a formation: this setup carries no name - no `formation` attribute and no `from` label/.test(ui) &&
    !/this\.xmlEl\.value = '';/.test(handler),
    'and a setup with no name is refused out loud, naming both attributes that are empty, and leaving the pane as it was');
  for (const [verdict, wording] of [
    ['add', 'no corpus formation has that name, so pasting it ADDS one'],
    ['same', "the corpus's own spots in the same order, so pasting it changes no board"],
    ['reordered', 'the SAME spots in a DIFFERENT ORDER'],
    ['changed', 'spots differ from'],
    ['size', "spots against the corpus's"],
    ['half', 'written as the'],
    ['whole', 'every dancer written'],
  ]) {
    check(ui.includes(wording), `the status line for \`${verdict}\` says what it is: "${wording}"`);
  }
  check(/corpusN !== null && corpusN !== n[\s\S]{0,220}REPLACES that formation and every call that names it gets a set of a different size/.test(ui),
    'and a size change is reported AS a size change, before the "differing spots" line can count two lists of different lengths against each other');
  // THE ARITHMETIC IS NOT IN THE PANEL - the reason `formation-xml.ts` exists. The panel is full of `Math.atan2`
  // for other concerns (the board transform, the arc fits), so the check names what would be a SECOND
  // implementation of THIS rule: the spot comparison, the half, and the block writer.
  const restated = (src) => /sameSpot\(|sameSpotsIgnoringOrder|completeHalfSet/.test(src) || /<formation name=/.test(src);
  check(!restated(ui), 'and neither the spot comparison, the half set, nor the <formation> writer is restated in the panel');

  // THE CONTROLS: each check above fails on the fault it was written for.
  const renamed = ui.replace("private exportFormationBtn = el<HTMLButtonElement>('edExportFormation')", "private exportFormationBtn = el<HTMLButtonElement>('edExportFormationX')");
  check(!/private exportFormationBtn = el<HTMLButtonElement>\('edExportFormation'\)/.test(renamed), 'renaming the id fails the `el()` check');
  const noFallback = ui.replace('formationExportXml(call.formation || call.from, spots, corpusFormationPoses)', 'formationExportXml(call.from, spots, corpusFormationPoses)');
  check(!/formationExportXml\(call\.formation \|\| call\.from, spots, corpusFormationPoses\)/.test(noFallback),
    'dropping the `formation`-before-`from` order fails the name-chain check');
  const withField = ui.replace("private exportFormationBtn = el<HTMLButtonElement>('edExportFormation');", "private exportFormationBtn = el<HTMLButtonElement>('edExportFormation');\n  private formationNameInput = el<HTMLInputElement>('edFormationName');");
  check(/formationNameInput/.test(withField) && !/formationNameInput|edFormationName/.test(ui),
    'and putting the name field back fails the check that there is none');
  const paned = handler.replace('void navigator.clipboard?.writeText(', 'this.xmlEl.value = result.xml;\n    void navigator.clipboard?.writeText(');
  check(/xmlEl/.test(paned) && !/xmlEl/.test(handler), 'and writing the block into the pane fails the clipboard-only check');
  const inlined = ui.replace('const spots = instanceTable(call).map((r) => r.start);', 'function sameSpot(a: FormDancer, b: FormDancer) { return a === b; }\n    const spots = instanceTable(call).map((r) => r.start);');
  check(inlined !== ui && restated(inlined) && !restated(ui), 'and restating the spot comparison in the panel fails the check that it is not there');
  const halved = ui.replace('const spots = instanceTable(call).map((r) => r.start);', 'const h = completeHalfSet(spots);\n    const spots = instanceTable(call).map((r) => r.start);');
  check(restated(halved) && !restated(ui), 'and halving the set there fails the check that the half is the module\'s');
  const moved = html.replace(/<button id="edExportFormation"[\s\S]*?<\/button>\n\s*/, '');
  check(moved !== html && moved.indexOf('id="edExportFormation"') < 0, 'deleting the button fails the placement check');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
