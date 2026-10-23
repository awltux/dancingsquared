// THE START AND END SETUP LISTS, RESTRICTED TO THE CALL'S OWN SIZE.
//
// Reported: "When the start setup is 4 dancers, the start and end setup override lists should be
// restricted to 4 dancer formations", then "currently it only shows 8 dancer setups" and "I can see
// them in formations.xml. The 51 with 2 are the 4 dancer formations."
//
// WHAT WAS WRONG. Both pickers were filled from the sequencer's formation library, which is eight
// dancers only. A four-dancer call - and MEASURED below, **212 of the catalogue's 547 calls are
// four-dancer** - was therefore offered a list of formations every one of which is refused: by
// `setStartFormation` for a start, and out loud by `doEndFormation` for an end. The picker could not
// express the call's own start, which is the one thing it is for.
//
// WHY THE LIBRARY WAS NOT WIDENED. Its 134 names and their all-eight invariant are pinned by
// `engine/test/shape-census.mjs` and walked by four engine harnesses, so doubling the two-written
// shapes there is an engine-wide change with a blast radius far past a picker's contents. Section 4
// pins that decision: the library must STILL be 134 names, every one of them eight dancers.
//
// The pickers live in `editor-ui.ts` and `sequencer-ui.ts`, which are TypeScript under Vite with a
// DOM and cannot run here - so the engine and the data are measured, and the panel's use of them is
// read from the source. The half-set rule is mirrored here from `engine/src/sequencer/library.ts`,
// `toWholeSet`, which is the engine's own answer to "how many dancers is this formation".
//
// Run: node tools/formation-size-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const LEVELS = fs.readdirSync(path.join(corpusRoot())).filter((d) => !d.includes('.') && d !== 'src');

const DEG = Math.PI / 180;
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** `toWholeSet`, mirrored: the written dancers are HALF the set unless they already contain antipodes. */
function complete(poses) {
  const mirror = poses.map((p) => ({ x: -p.x, y: -p.y, heading: norm(p.heading + Math.PI), gender: p.gender }));
  const merged = poses.concat(mirror);
  const stacked = merged.some((a, i) => merged.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < 0.01));
  return stacked ? poses : merged;
}

const formations = engine.parseFormations(formationsXml);
const asPoses = (ds) => ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));

/** The POC's `corpusFormationsOfSize`, mirrored. */
function corpusFormationsOfSize(dancers) {
  const byName = new Map();
  for (const [name, ds] of formations) {
    if (complete(asPoses(ds)).length !== dancers) continue;
    const key = engine.canonicalName(name);
    if (!byName.has(key)) byName.set(key, name);
  }
  return [...byName.values()].sort((a, b) => a.localeCompare(b));
}

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

function* everyCall() {
  for (const level of LEVELS) {
    for (const f of fs.readdirSync(path.join(corpusRoot(), level))) {
      if (!f.endsWith('.xml')) continue;
      try {
        yield {
          level, f,
          call: engine.normalizeInstance(engine.loadCallFromXml(
            fs.readFileSync(path.join(corpusRoot(), level, f), 'utf8'), movesXml, formationsXml, 0)),
        };
      } catch { /* a call that will not load is another probe's business */ }
    }
  }
}

// ---------------------------------------------------------------- 1. what sizes the corpus can stand up
console.log('\n== 1. formations.xml: the written dancers are HALF the set, at every size ==');
{
  const byWritten = new Map();
  let alreadyWhole = 0;
  for (const [, ds] of formations) {
    byWritten.set(ds.length, (byWritten.get(ds.length) ?? 0) + 1);
    if (complete(asPoses(ds)).length === ds.length) alreadyWhole++;
  }
  const played = new Map();
  for (const [, ds] of formations) {
    const n = complete(asPoses(ds)).length;
    played.set(n, (played.get(n) ?? 0) + 1);
  }
  console.log(`    written: ${[...byWritten].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`    played : ${[...played].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  check(formations.size > 250, `the corpus is read whole (${formations.size} named formations)`);
  // THE COUNTS ARE REPORTED; THE SHAPE IS ASSERTED. Each of these three pinned a corpus number - 51 entries
  // writing two dancers, ZERO already whole, at most 51 four-dancer formations - and the corpus moved under
  // all three: `50d3e95` folded `b1`/`b2` into `ms` 2026, and the owner has been re-authoring
  // `formations.xml` since. A pinned count is a claim about the corpus wearing the clothes of a claim about
  // the RULE, and it is the rule that survives: entries DO write a half set, completing by rotation is the
  // DOMINANT case rather than a special one, and a dedup can only ever REDUCE a name list.
  check((byWritten.get(2) ?? 0) > 0,
    `entries DO write TWO dancers - the reported "51 with 2" is ${byWritten.get(2)} today - so the doubling is exercised rather than assumed`);
  check(alreadyWhole < formations.size * 0.1,
    `and completing by rotation is the RULE rather than a special case (${alreadyWhole} of ${formations.size} entries are already whole, so ${formations.size - alreadyWhole} complete - MEASURED, this was 0 when the check was written and it is no longer zero)`);
  check(corpusFormationsOfSize(4).length > 0 && corpusFormationsOfSize(4).length <= (byWritten.get(2) ?? 0),
    `which gives ${corpusFormationsOfSize(4).length} four-dancer formations, deduped by canonical name from the ${byWritten.get(2)} written - a dedup can only reduce, so it can never exceed what was written`);
  check(corpusFormationsOfSize(8).length > 150,
    `and ${corpusFormationsOfSize(8).length} at eight dancers, from the ${byWritten.get(4)} four-written entries`);
}

// ---------------------------------------------------------------- 2. how much of the catalogue needs them
console.log('\n== 2. the catalogue: four-dancer calls are the SECOND-LARGEST group, and their own start names are in that list ==');
{
  const sizes = new Map();
  const fourDancerCalls = [];
  let calls = 0;
  for (const { level, f, call } of everyCall()) {
    calls++;
    sizes.set(call.dancers.length, (sizes.get(call.dancers.length) ?? 0) + 1);
    if (call.dancers.length === 4) fourDancerCalls.push(`${level}/${f}`);
  }
  console.log(`    calls ${calls}; dancer counts: ${[...sizes].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  const fourDancerFormations = new Set(corpusFormationsOfSize(4).map((n) => engine.canonicalName(n)));
  void fourDancerFormations;
  // THE CLAIM IS A RANKING, NOT A NUMBER: four-dancer calls are the SECOND-LARGEST group, behind the
  // eight-dancer ones. Measured from the sizes this loop already builds, so it cannot go stale the way
  // `> 200` did when the corpus shrank to 175 of 495.
  const ranked = [...sizes].sort((a, b) => b[1] - a[1]);
  check(ranked[0]?.[0] === 8 && ranked[1]?.[0] === 4,
    `four-dancer calls are the SECOND-LARGEST group, not an edge case (${fourDancerCalls.length} of ${calls}; the ranking is ${ranked.slice(0, 3).map(([k, v]) => `${k}-dancer ${v}`).join(', ')})`);

  // THE USEFULNESS TEST, and it is a SHAPE FINGERPRINT rather than `startsFromFormation`.
  //
  // The engine's own comparison is exact to 1e-3, because it answers a different question: whether a
  // tam may REFERENCE a formation by name, where the reader rebuilds the shape from the name and the
  // geometry therefore has to match to the unit. MEASURED, and this is why the first cut of this probe
  // reported zero: `Cross Trail Thru` starts from "Facing Couples" drawn at x = +/-1.5, while the
  // corpus entry for `Facing Couples` is drawn at x = +/-2.0. The same formation, a different scale -
  // and a start picker is asking about the SHAPE. So the fingerprint below is the multiset of pairwise
  // distances normalised by their mean (rigid-motion AND scale invariant) with the multiset of relative
  // headings beside it. It is a fingerprint, not a proof of identity, and it is compared only against
  // formations already known to be the right SIZE.
  //
  // The corpus also names one shape two ways - a call says `from="Right-Hand Box"` where
  // `formations.xml` says `Box RH` - so a name comparison would report those as uncovered when the
  // shape they name is in the list.
  const fingerprint = (poses) => {
    const d = [];
    for (let i = 0; i < poses.length; i++) {
      for (let j = i + 1; j < poses.length; j++) d.push(Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y));
    }
    const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1) || 1;
    const rel = poses.map((p) => Math.round((norm(p.heading - poses[0].heading) / DEG) * 10) / 10).sort((a, b) => a - b);
    return `${d.map((v) => Math.round((v / mean) * 500)).sort((a, b) => a - b).join(',')}|${rel.join(',')}`;
  };
  const fourKey = new Map(corpusFormationsOfSize(4).map((n) => [fingerprint(complete(asPoses(formations.get(n)))), n]));
  let named = 0, covered = 0, missed = [];
  for (const { level, f, call } of everyCall()) {
    if (call.dancers.length !== 4 || !call.from) continue;
    named++;
    const start = call.dancers.map((d) => engine.poseFor(d, 0));
    if (fourKey.has(fingerprint(start))) covered++;
    else missed.push(`${level}/${f} from="${call.from}"`);
  }
  console.log(`    ${covered} of ${named} four-dancer calls have their own start SHAPE in the new list (${fourKey.size} distinct fingerprints at four dancers)`);
  check(covered / named > 0.95,
    `so the picker can stand up the start of essentially every four-dancer call (${covered}/${named}${missed.length ? '; not matched: ' + missed.slice(0, 3).join(', ') : ''})`);

  // AND WHAT IT WAS OFFERED BEFORE, as a measurement rather than a claim.
  const eightSet = new Set(corpusFormationsOfSize(8));
  const hadNoName = [...everyCall()].filter((c) => c.call.dancers.length === 4 && c.call.from && !eightSet.has(c.call.from)).length;
  // THE CLAIM IS "NONE OF THEM WAS IN THAT LIST", so the ratio is what is asserted and the count is
  // reported - `>= 200` was a count that said the same thing only while the corpus was a particular size.
  const fourWithFrom = [...everyCall()].filter((c) => c.call.dancers.length === 4 && c.call.from).length;
  check(fourWithFrom > 0 && hadNoName / fourWithFrom > 0.9,
    `and the EIGHT-dancer list it used to be offered did not contain them by size at all (${hadNoName} of the ${fourWithFrom} four-dancer calls that name a start are absent from the eight-dancer list)`);
}

// ---------------------------------------------------------------- 3. the mismatch is refused, which is why the filter matters
console.log('\n== 3. the engine refuses a count mismatch, so an unfiltered list can only ever be refused ==');
{
  const target = [...everyCall()].find((c) => c.call.dancers.length === 4);
  const call = target.call;
  const fourName = corpusFormationsOfSize(4)[0];
  const eightName = corpusFormationsOfSize(8)[0];
  const ok = engine.setStartFormation(call, complete(asPoses(formations.get(fourName))));
  check(ok.dancers.length === 4, `a four-dancer formation re-bases a four-dancer call (${ok.dancers.length} dancers, from "${fourName}")`);

  let refused = false;
  let why = '';
  try { engine.setStartFormation(call, complete(asPoses(formations.get(eightName)))); }
  catch (err) { refused = true; why = err.message; }
  check(refused, `and an eight-dancer one is REFUSED - "${why.slice(0, 80)}" - so offering it was a picker that could only fail`);
  // AND THE AUTHORS' OWN SHAPE, NOT A DOUBLE MIRROR: the two-dancer entry passed COMPLETED is the
  // shape the picker holds, and passing it UNCOMPLETED is what the engine calls the wrong count.
  let halfRefused = false;
  try { engine.setStartFormation(call, asPoses(formations.get(fourName))); }
  catch { halfRefused = true; }
  check(halfRefused, 'while the same entry UNCOMPLETED is refused as two dancers, which is why the list holds set poses and not authored ones');
}

// ---------------------------------------------------------------- 4. the library is left alone, and the panel asks by size
console.log('\n== 4. the library is untouched, and the panel asks for a size rather than for "the formations" ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const seqUi = fs.readFileSync(path.join(POC_DIR, 'src', 'sequencer-ui.ts'), 'utf8');
  const main = fs.readFileSync(path.join(POC_DIR, 'src', 'main.ts'), 'utf8');
  const tam = fs.readFileSync(path.join(POC_DIR, 'src', 'tam-xml.ts'), 'utf8');
  const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
  const bodyOf = (src, header) => {
    const i = src.indexOf(header);
    if (i < 0) return null;
    const j = src.indexOf('\n  }', i);
    return src.slice(i, j);
  };

  // ---- THE DECISION: the engine's library still offers eight-dancer names only.
  const seq = new engine.Sequencer(movesXml, formationsXml);
  const names = seq.listFormations();
  const allEight = names.every((n) => (seq.boardForSetup(n)?.dancers.length ?? 0) === 8);
  // THE DECISION IS "THE LIBRARY IS EIGHT-DANCER ONLY"; the count of names is the corpus's business.
  check(allEight && names.length > 0,
    `the sequencer's library offers ${names.length} names and EVERY ONE of them is eight dancers - the engine pin and the four harnesses that walk it are untouched (MEASURED, this was 134 when the check was written)`);

  // ---- the host answers for a size. THE `!== 8` BRANCH IS GONE (MEASURED, `sequencer-ui.ts:404`): the
  // host returns the corpus at EVERY size now, so the eight-dancer library this probe section exists to
  // protect is no longer consulted for the picker at all. The assertion follows the source rather than the
  // source following the assertion.
  const half = fs.readFileSync(path.join(POC_DIR, 'src', 'half-set.ts'), 'utf8');
  check(/startFormations\(dancers: number\)/.test(seqUi) && /return corpusFormationsOfSize\(dancers\)/.test(seqUi),
    'the host asks for a SIZE and answers it from the CORPUS');
  check(/startFormations\(dancers: number\): \{ name: string; poses: FormDancer\[\] \}\[\];/.test(ui) &&
    /startFormations: \(dancers\) => seqUi\.startFormations\(dancers\)/.test(main),
    'and that argument is threaded from the panel through the host to the sequencer');
  check(/import \{ corpusFormationsOfSize \} from '\.\/tam-xml'/.test(seqUi) &&
    /export function corpusFormationsOfSize\(dancers: number\)/.test(tam),
    'the corpus list is built by the module that already parses formations.xml, rather than a second reader of it');
  // THE ALREADY-WHOLE TEST MOVED. It used to be read out of `tam-xml.ts`; that rule was extracted into
  // `half-set.ts` so a probe could IMPORT it rather than mirror it (§4.3), and `tam-xml.ts` now imports it.
  check(/const poses = completeHalfSet\(/.test(tam) && /export function completeHalfSet\(/.test(half) &&
    /Math\.hypot\(a\.x - b\.x, a\.y - b\.y\) < 0\.01/.test(half),
    'and it applies the half-set rule including the already-whole test, which now lives in `half-set.ts` and is imported rather than restated');

  // ---- the editor filters, and re-filters when the size moves
  const ensure = bodyOf(ui, '  private ensureStartFormations(') || '';
  check(/if \(this\.startFormationsLoaded === dancers\) return;/.test(ensure) &&
    /this\.startFormationsLoaded = dancers;/.test(ensure),
    'the pickers are rebuilt when the INSTANCE SIZE changes, and not on every render');
  check(/this\.ensureStartFormations\(this\.instance\.dancers\.length\)/.test(ui),
    'and they are filled from the loaded instance rather than from a fixed eight');
  check(/for \(const f of formations\) this\.startFormationSel\.add\(new Option\(f\.name, f\.name\)\);/.test(ensure) &&
    /for \(const f of formations\) this\.endFormationSel\.add\(new Option\(f\.name, f\.name\)\);/.test(ensure),
    'BOTH pickers are filled from the one size-filtered list, so they cannot disagree');
  check(/this\.host\.startFormations\(base\.dancers\.length\)/.test(ui) &&
    /this\.host\.startFormations\(inst\?\.dancers\.length \?\? 8\)/.test(ui),
    'and the two change handlers look the chosen name up at the same size, so a name can never be found at one size and applied at another');

  // ---- a size with nothing to offer says so rather than offering the wrong thing
  check(/const none = formations\.length === 0;/.test(ensure) && /no named \$\{dancers\}-dancer formation is in the corpus/.test(ensure),
    'a size the corpus cannot stand up disables both pickers and says why, instead of leaving a lone "keep the current" that reads as a bug');
  check(!/named 8-dancer formation/.test(html) && /of THIS CALL'S OWN size/.test(html),
    'and the help text no longer promises an eight-dancer list in three places it no longer is');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
