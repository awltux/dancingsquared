// WHAT THE END SETUP ROW SAYS, AND WHEN IT OFFERS AN EXPORT.
//
// Asked for as: "Call Editor: Add a check to the call-changed event that calculates the end setup and looks it up in
// known formations. Set the End Setup to the found formation, or show 'Unknown formation'. If the end formation is
// unknown and it's an 8-dancer board, provide an 'export <formation>' button on the 'End Setup' row."
//
// WHY THE PLACEHOLDER AND NOT A NOTE BESIDE IT. The picker's leading option is the entry that means "nothing chosen",
// and "nothing chosen" is exactly "no formation in the corpus names the shape this call finishes on" - so writing the
// truth into that option puts the state in the control the caller is already reading, and there is no second line to
// disagree with it.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. the rule itself: a known formation leaves the neutral placeholder and offers nothing; an UNKNOWN one says
//      "Unknown formation" and offers the export; and the export needs EIGHT dancers, because every formation the
//      corpus ships is an eight-dancer set - a shorter end would be a block no call could name;
//   2. the two plausible wrong rules, each measured to fail exactly one check: "always offer the export" (red at six
//      dancers) and "always neutral" (red for an unknown end);
//   3. IT IS THE CORPUS'S OWN PROBLEM: how many of the corpus's calls finish on a shape the corpus cannot name, so
//      the reach of the feature is a number rather than a story - and how many of those are eight dancers, which is
//      the population the button is for;
//   4. the panel uses the rule and not a copy of it, that the name is recomputed for the END BOARD (the memo), and
//      that the export copies the END poses rather than the START ones - a copy-paste slip of `r.start` for `r.end`
//      would export a formation that is not the end at all, and every other check here would still pass.
//
// Run: node tools/end-setup-name-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { endSetupState, KEEP_END_PLACEHOLDER, UNKNOWN_FORMATION } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'end-setup-state.ts')).href
);
const { completeHalfSet } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);
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
console.log('\n== 1. what the row says, and when it offers an export ==');
{
  const known = endSetupState('Alamo Wave', 8);
  check(known.placeholder === KEEP_END_PLACEHOLDER && !known.canExport,
    'a formation the corpus names leaves the placeholder neutral and offers no export - there is nothing to author');
  const unknown8 = endSetupState('', 8);
  check(unknown8.placeholder === UNKNOWN_FORMATION && unknown8.canExport,
    'an unknown end on EIGHT dancers says "Unknown formation" and offers the export');
  for (const dancers of [2, 4, 6, 16]) {
    const other = endSetupState('', dancers);
    check(other.placeholder === UNKNOWN_FORMATION && !other.canExport,
      `an unknown end on ${dancers} dancers still says "Unknown formation", and offers NO export - the corpus's formations are all eight-dancer sets`);
  }
  for (const nothing of [null, undefined, '', '   ', '\t']) {
    check(endSetupState(nothing, 8).placeholder === UNKNOWN_FORMATION, `a ${JSON.stringify(nothing)} name is unknown, not a blank`);
  }
  // NEGATIVE CONTROLS: the two rules a first cut would plausibly ship.
  check(!endSetupState('', 6).canExport,
    'NEGATIVE CONTROL: "always offer the export" is red at six dancers - an exported six-dancer formation could never be named by a call');
  check(endSetupState('', 8).placeholder !== KEEP_END_PLACEHOLDER,
    'NEGATIVE CONTROL: "always the neutral placeholder" is red for an unknown end - which is the state the report was about');
}

// ---------------------------------------------------------------- 2. the corpus this is for
console.log('\n== 2. the corpus: how often the end is a formation the corpus does not name ==');
const assets = corpusRoot();
const movesXml = fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const formations = engine.parseFormations(formationsXml);
/** `corpusFormationsOfSize`, over the same file the panel reads: every formation completed to its played size. */
const formationsOfSize = (dancers) => {
  const out = [];
  for (const [name, ds] of formations) {
    const poses = completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
    if (poses.length === dancers) out.push({ name, poses });
  }
  return out;
};
const totals = { calls: 0, eight: 0, known: 0, unknown: 0, unknown8: 0 };
const unknownExamples = [];
for (const level of fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name)) {
  for (const f of fs.readdirSync(path.join(assets, level)).filter((x) => x.endsWith('.xml'))) {
    let variants;
    try {
      variants = engine.buildCallVariants(fs.readFileSync(path.join(assets, level, f), 'utf8'), movesXml, formationsXml);
    } catch {
      continue;
    }
    for (const variant of variants) {
      let call;
      try {
        call = engine.normalizeInstance(variant);
      } catch {
        continue;
      }
      totals.calls++;
      // THE PANEL'S OWN QUESTION, asked with the engine's own rule: does any formation of this call's size sit
      // exactly under the poses the dancers arrive at?
      const named = formationsOfSize(call.dancers.length).some((formation) => engine.endsOnFormation(call, formation.poses));
      if (call.dancers.length === 8) totals.eight++;
      if (named) totals.known++;
      else {
        totals.unknown++;
        if (call.dancers.length === 8) totals.unknown8++;
        else if (unknownExamples.length < 4) unknownExamples.push(`${level}/${f} "${call.title}" (${call.dancers.length} dancers)`);
      }
    }
  }
}
console.log(`    ${totals.calls} call variants: ${totals.known} finish on a formation the corpus names, ${totals.unknown} do not`);
console.log(`    of the ${totals.unknown} unknown, ${totals.unknown8} are eight-dancer boards - the population the export button is for`);
console.log(`    the rest have nowhere to go in formations.xml, e.g. ${unknownExamples.join(', ')}`);
check(totals.known > 0 && totals.unknown > 0,
  `both answers happen in the corpus (${totals.known} named / ${totals.unknown} not), so neither branch is dead code`);
check(totals.unknown8 > 0, `and ${totals.unknown8} of the unknown ends are eight-dancer boards, which is the case the export exists for`);
check(totals.unknown8 < totals.unknown,
  `while ${totals.unknown - totals.unknown8} unknown ends are NOT eight-dancer, so the size condition is doing work rather than always passing`);
check(totals.eight > 0 && totals.eight <= totals.calls, `the sweep saw ${totals.eight} eight-dancer variants of ${totals.calls}`);

// ---------------------------------------------------------------- 3. the panel
console.log('\n== 3. the panel uses the rule, on the END, and exports the END poses ==');
{
  const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
  check(/private renderEndSetupState\(\)[\s\S]{0,1200}?endSetupState\(/.test(src),
    'the row\'s state is the rule in `end-setup-state.ts`, imported rather than restated');
  check(/this\.renderEndTarget\(\);[\s\S]{0,200}?this\.renderEndSetupState\(\);/.test(src),
    'and it is redrawn with the rest of the panel, on every instance change - which is what makes it follow a CALL change');
  check(/const first = this\.endFormationSel\.options\[0\];[\s\S]{0,220}?first\.text = state\.placeholder/.test(src),
    'it writes the PICKER\'S PLACEHOLDER and not its selection, so a caller part-way through choosing is not overruled');
  check(/boardAtBeat\(call, call\.beats\)/.test(src) && /this\.endNameKey !== key/.test(src),
    'the name is computed for the END BOARD and memoised on it, so a handle drag does not re-walk the corpus');
  check(/const spots = instanceTable\(call\)\.map\(\(r\) => r\.end\);/.test(src),
    'the export copies the END poses - `r.end`, not `r.start`: a slip there would export the formation the call STARTED on and every other check would still pass');
  check(/formationExportXml\(call\.title, spots, corpusFormationPoses\)/.test(src),
    'and it is named after the call, because an unnamed shape has no name of its own');
  check(/<button id="edExportEndFormation" hidden /.test(html),
    'the button is in the End setup row and starts HIDDEN, so it cannot be pressed before the row knows the end is unknown');
  check(/this\.exportEndFormationBtn\.addEventListener\('click', \(\) => this\.doExportEndFormation\(\)\)/.test(src),
    'and its click is wired to the export');
  check(/private doExportFormation\(\)[\s\S]*?private doExportEndFormation\(\)[\s\S]*?private reportFormationExport\(/.test(src),
    'the two exports share ONE report of what the block is and what a paste would do, rather than two prose copies that can drift');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
