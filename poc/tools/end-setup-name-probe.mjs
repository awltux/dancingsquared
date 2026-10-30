// WHAT THE END SETUP ROW SAYS, AND WHEN IT OFFERS AN EXPORT.
//
// Asked for as: "Call Editor: Add a check to the call-changed event that calculates the end setup and looks it up in
// known formations. Set the End Setup to the found formation, or show 'Unknown formation'. If the end formation is
// unknown and it's an 8-dancer board, provide an 'export <formation>' button on the 'End Setup' row." And then: "The
// End Setup dropdown shows 'Unknown formation' if the start setup doesn't have a name. With the advent of the sid on all
// catalog formations, if the end formation is identified but not named, use the sid instead. At least this way the
// formation can be found."
//
// WHY THE PLACEHOLDER AND NOT A NOTE BESIDE IT. The picker's leading option is the entry that means "nothing chosen",
// and "nothing chosen" is exactly "no formation in the corpus names the shape this call finishes on" - so writing the
// truth into that option puts the state in the control the caller is already reading, and there is no second line to
// disagree with it.
//
// WHY THE SETUP ID AND NOT A BARE SENTENCE. The sid is the arrangement AND the authored order (`setup-id.ts`), and it
// is the key the Board drawer's Setup picker is keyed by - so an id is something a caller can look up where "Unknown
// formation" is a dead end. It is NOT offered as a choice here: this list is the corpus's NAMES
// (`corpusFormationsOfSize`), so an id could not be resolved by `doEndFormation`, and an option nothing can select
// would be a trap. The export stays the way out, because an id does not name the shape.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. the rule itself: a known formation leaves the neutral placeholder and offers nothing; an UNKNOWN one says
//      "Unknown Setup" and offers the export; an unknown one WITH a setup id says so and names the id; and the
//      export needs EIGHT dancers, because every formation the corpus ships is an eight-dancer set - a shorter end
//      would be a block no call could name;
//   2. the two plausible wrong rules, each measured to fail exactly one check: "always offer the export" (red at six
//      dancers) and "always neutral" (red for an unknown end); and, for the id, the BARE id as the whole statement,
//      which would read as a name the picker offers;
//   3. IT IS THE CORPUS'S OWN PROBLEM: how many of the corpus's calls finish on a shape the corpus cannot name, how many
//      of those carry a setup id at all, and how many of those ids are setups the Board picker already offers - so the
//      reach of the feature is a number rather than a story, and "the formation can be found" is counted;
//   4. the panel uses the rule and not a copy of it, that the name AND the id are recomputed for the END BOARD (one
//      memo, because they describe the same board), and that the export copies the END poses rather than the START
//      ones - a copy-paste slip of `r.start` for `r.end` would export a formation that is not the end at all, and every
//      other check here would still pass.
//
// Run: node tools/end-setup-name-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { endIdentityOptions, endSetupState, KEEP_END_PLACEHOLDER, UNKNOWN_SETUP } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'end-setup-state.ts')).href
);
const { buildSetupCatalogue } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'setup-catalogue.ts')).href);
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
  check(unknown8.placeholder === UNKNOWN_SETUP && unknown8.canExport,
    'an unknown end on EIGHT dancers says "Unknown Setup" and offers the export');
  for (const dancers of [2, 4, 6, 16]) {
    const other = endSetupState('', dancers);
    check(other.placeholder === UNKNOWN_SETUP && !other.canExport,
      `an unknown end on ${dancers} dancers still says "Unknown Setup", and offers NO export - the corpus's formations are all eight-dancer sets`);
  }
  for (const nothing of [null, undefined, '', '   ', '\t']) {
    check(endSetupState(nothing, 8).placeholder === UNKNOWN_SETUP, `a ${JSON.stringify(nothing)} name is unknown, not a blank`);
  }
  // THE SETUP ID, when the board has one and the corpus has no name for it.
  const withId = endSetupState('', 8, 'S1-4upypjh8');
  check(withId.placeholder === `${UNKNOWN_SETUP} (S1-4upypjh8)`,
    `an unknown end WITH a setup id states both - the claim and the id (${withId.placeholder})`);
  check(withId.canExport, '...and still offers the export: an id does not name the shape');
  check(endSetupState('Alamo Wave', 8, 'S1-4upypjh8').placeholder === KEEP_END_PLACEHOLDER,
    'a NAMED end ignores the id entirely, so the row can never offer a name and an id at once');
  for (const noId of [null, undefined, '', '   ']) {
    check(endSetupState('', 8, noId).placeholder === UNKNOWN_SETUP,
      `a ${JSON.stringify(noId)} id leaves the plain statement - the one board with no id has no physical dancers`);
  }
  check(endSetupState('', 6, 'S1-4upypjh8').placeholder === `${UNKNOWN_SETUP} (S1-4upypjh8)` &&
    !endSetupState('', 6, 'S1-4upypjh8').canExport,
    'the id does not move the export rule: six dancers still say it and still offer nothing');
  // NEGATIVE CONTROLS: the two rules a first cut would plausibly ship.
  check(!endSetupState('', 6).canExport,
    'NEGATIVE CONTROL: "always offer the export" is red at six dancers - an exported six-dancer formation could never be named by a call');
  check(endSetupState('', 8).placeholder !== KEEP_END_PLACEHOLDER,
    'NEGATIVE CONTROL: "always the neutral placeholder" is red for an unknown end - which is the state the report was about');
  check(endSetupState('', 8, 'S1-4upypjh8').placeholder !== 'S1-4upypjh8',
    'NEGATIVE CONTROL: a BARE id is not the statement - it would read as a name this picker offers, and the caller would try to select it');
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
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
    if (poses.length === dancers) out.push({ name, poses });
  }
  return out;
};
const totals = { calls: 0, eight: 0, known: 0, unknown: 0, unknown8: 0, withSid: 0, inCatalogue: 0, unknown8InCatalogue: 0, fidMatched: 0, aidMatched: 0 };
const unknownExamples = [];
const unknownEightExamples = [];
// THE SETUPS THE BOARD PICKER OFFERS, built the way `data.ts` hands them over, so "the formation can be found" is
// counted against a real list rather than asserted. A setup id is `S1-…`, the picker's own option value.
const setupSources = [];
for (const level of fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name)) {
  for (const f of filesOf(level).filter((x) => x.endsWith('.xml'))) {
    const tams = engine.parseCallXml(fs.readFileSync(path.join(assets, level, f), 'utf8'));
    setupSources.push({ file: `${level}/${f.replace(/\.xml$/, '')}`, tams: tams.map((tam, index) => ({ index, tam })) });
  }
}
const catalogue = buildSetupCatalogue({ formationsXml, files: setupSources });
const pickerSids = new Set(catalogue.rows.map((row) => row.sid));
for (const level of fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name)) {
  for (const f of filesOf(level).filter((x) => x.endsWith('.xml'))) {
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
        // THE ID THE ROW WOULD SHOW: the END board's setup id, computed by the engine's own function.
        const endBoard = engine.boardAtBeat(call, call.beats);
        const sid = engine.setupId(endBoard);
        if (sid !== null) {
          totals.withSid++;
          if (pickerSids.has(sid)) {
            totals.inCatalogue++;
            if (call.dancers.length === 8) totals.unknown8InCatalogue++;
            if (unknownEightExamples.length < 3) {
              unknownEightExamples.push(`${level}/${f} "${call.title}" -> ${sid}`);
            }
          }
        }
        // AND THE TWO CAPTIONS the row now lists above the names: is the SHAPE (`fid`) one the catalogue holds, and is the
        // ARRANGEMENT (`aid`) one it holds? That pair is the difference between "a known shape in a new arrangement" and
        // "a shape the corpus has never carried", which is what the lines are for.
        const fid = engine.formationId(endBoard);
        const aid = engine.arrangementId(endBoard);
        if (catalogue.rows.some((r) => r.fid === fid)) totals.fidMatched++;
        if (catalogue.rows.some((r) => r.aid === aid)) totals.aidMatched++;
      }
    }
  }
}
console.log(`    ${totals.calls} call variants: ${totals.known} finish on a formation the corpus names, ${totals.unknown} do not`);
console.log(`    of the ${totals.unknown} unknown, ${totals.unknown8} are eight-dancer boards - the population the export button is for`);
console.log(`    ${totals.withSid} of the ${totals.unknown} unknown ends carry a SETUP ID, and ${totals.inCatalogue} of those ids are setups the Board picker offers`);
console.log(`    of those unnamed ends, ${totals.fidMatched} stand on a SHAPE the catalogue holds and ${totals.aidMatched} on an ARRANGEMENT it holds - the two captions the picker now lists`);
console.log(`    ${totals.unknown8InCatalogue} of them are eight-dancer setups, e.g. ${unknownEightExamples.join(', ') || 'none'}`);
console.log(`    the rest have nowhere to go in formations.xml, e.g. ${unknownExamples.join(', ')}`);
check(totals.known > 0 && totals.unknown > 0,
  `both answers happen in the corpus (${totals.known} named / ${totals.unknown} not), so neither branch is dead code`);
check(totals.unknown8 > 0, `and ${totals.unknown8} of the unknown ends are eight-dancer boards, which is the case the export exists for`);
check(totals.unknown8 < totals.unknown,
  `while ${totals.unknown - totals.unknown8} unknown ends are NOT eight-dancer, so the size condition is doing work rather than always passing`);
check(totals.eight > 0 && totals.eight <= totals.calls, `the sweep saw ${totals.eight} eight-dancer variants of ${totals.calls}`);
check(totals.withSid > 0,
  `an unnamed end really does have an id to show: ${totals.withSid} of ${totals.unknown} carry one (the rest are boards with no physical dancers, the one case \`setupId\` refuses)`);
check(totals.inCatalogue > 0 && totals.inCatalogue <= totals.withSid,
  `and ${totals.inCatalogue} of those ids are setups the Board picker ALREADY offers - the population "the formation can be found" is true for`);
check(totals.unknown8InCatalogue > 0,
  `while ${totals.unknown8InCatalogue} of them are eight-dancer setups, so the row's id leads somewhere for the same boards the export is for`);
check(totals.fidMatched > 0 && totals.fidMatched <= totals.unknown,
  `and the id captions have a population: ${totals.fidMatched} of the ${totals.unknown} unnamed ends stand on a shape the catalogue holds`);
check(totals.aidMatched >= 0 && totals.aidMatched <= totals.unknown,
  `while ${totals.aidMatched} stand on an arrangement it holds - the rest are new shapes or new arrangements, which is what the captions say`);

// ---------------------------------------------------------------- 3. the panel
console.log('\n== 3. the panel uses the rule, on the END, and exports the END poses ==');
{
  const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
  check(/private renderEndSetupState\(\)[\s\S]{0,1600}?endSetupState\(info\.name,[\s\S]{0,120}?info\.setupId\)/.test(src),
    'the row\'s state is the rule in `end-setup-state.ts`, imported rather than restated, and it passes the id as well as the name');
  check(/this\.renderEndTarget\(\);[\s\S]{0,200}?this\.renderEndSetupState\(\);/.test(src),
    'and it is redrawn with the rest of the panel, on every instance change - which is what makes it follow a CALL change');
  check(/const first = this\.endFormationSel\.options\[0\];[\s\S]{0,220}?first\.text = state\.placeholder/.test(src),
    'it writes the PICKER\'S PLACEHOLDER and not its selection, so a caller part-way through choosing is not overruled');
  check(/boardAtBeat\(call, call\.beats\)/.test(src) && /this\.endInfoKey !== key/.test(src),
    'the name and the id are computed for the END BOARD and memoised on it, so a handle drag does not re-walk the corpus');
  check(/private endSetupInfo\(call: CallBundle\): \{ name: string; setupId: string \| null \}/.test(src) &&
    /this\.endInfoSid = setupId\(end\)/.test(src),
    'ONE read answers both: the id comes from the same END board as the name, because two reads could describe two different ends');
  check(!/endNameKey|endNameValue|endSetupName\(/.test(src),
    'and the old name-only memo is gone rather than left beside the new one, which is how two answers to one question appear');
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
  check(/the leading option says so and carries the board's SETUP ID/.test(html),
    'and the picker\'s tooltip says where the id comes from and that it is stated rather than offered');
}

// ---------------------------------------------------------------- 4. the fid and aid captions
//
// Asked for as: "If the unknown 'end setup' matches a formation or arrangement, list the fid and aid at the top of the list
// of setups." The two lines are IDENTITY, printed above the names, and the interesting case is the difference they draw:
// a board whose `fid` the catalogue holds is a KNOWN shape in a new arrangement, while one whose `fid` nothing holds is a
// shape the corpus has never carried.
console.log('\n== 4. the fid and aid, as captions above the names ==');
{
  const none = endIdentityOptions(null);
  check(none.length === 0, 'no identity (a board with no physical dancers) prints nothing rather than two dashes');
  check(endIdentityOptions({ fid: null, aid: null, shapes: [], arrangements: [] }).length === 0,
    'and a board with no ids at all is the same, so a four-dancer end does not gain a permanent empty line');

  const known = endIdentityOptions({
    fid: 'F3-1r9s5bst',
    aid: 'A1-abcdefgh',
    shapes: ['Lines'],
    arrangements: ['Normal Lines', 'Sashayed Lines'],
  });
  check(known.length === 2, `two matches print two lines (${known.length})`);
  check(known[0].id === 'F3-1r9s5bst' && known[0].label.startsWith('F3-1r9s5bst — formation: Lines'),
    `the FID comes first and names the shape the catalogue holds (${known[0].label})`);
  check(known[1].id === 'A1-abcdefgh' && /arrangement: Normal Lines \/ Sashayed Lines/.test(known[1].label),
    `the AID second, with the setup names it matches (${known[1].label})`);

  // THE DIFFERENCE THE LINES EXIST TO DRAW: a known shape in an unknown arrangement, and a shape nothing holds.
  const newArrangement = endIdentityOptions({ fid: 'F3-1r9s5bst', aid: 'A1-new', shapes: ['Lines'], arrangements: [] });
  check(/formation: Lines/.test(newArrangement[0].label) && /no corpus setup carries this arrangement/.test(newArrangement[1].label),
    `a KNOWN shape in a NEW arrangement says exactly that (${newArrangement.map((o) => o.label).join(' | ')})`);
  const newShape = endIdentityOptions({ fid: 'F3-new', aid: 'A1-new2', shapes: [], arrangements: [] });
  check(/no corpus formation carries this shape/.test(newShape[0].label),
    `and a shape nothing holds says so rather than printing a bare tag (${newShape[0].label})`);

  // THE SUMMARY, because an arrangement can be carried by many setups (a Static Square has aliases and arrangement twins).
  const many = endIdentityOptions({
    fid: 'F3-x', aid: 'A1-y', shapes: [], arrangements: ['A', 'B', 'C', 'D', 'E'],
  });
  check(/A \/ B \/ C \(\+2 more\)/.test(many[1].label),
    `more than three names are summarised rather than listing the whole catalogue (${many[1].label})`);
  // NEGATIVE CONTROL: a caption is not a name, so a board whose ids print still prints NO option a caller could select -
  // the panel marks them `disabled`, and this checks the model the panel is given (an `id` and a `label`, no value).
  check(Object.keys(known[0]).sort().join(',') === 'id,label',
    'a caption carries an id and a label and NOTHING a select could return, which is why the panel disables it');

  // ---- the panel, and the host it asks
  const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8').replace(/\r\n/g, '\n');
  const seq = fs.readFileSync(path.join(POC_DIR, 'src', 'sequencer-ui.ts'), 'utf8').replace(/\r\n/g, '\n');
  const main = fs.readFileSync(path.join(POC_DIR, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  check(/for \(const caption of this\.endIdentityCaptions\(\)\) \{\n      const option = new Option\(caption\.label, ''\);\n      option\.disabled = true;/.test(src),
    'the panel inserts the captions right after the placeholder and DISABLES them - an option nothing can select cannot become a trap');
  check(/private endIdentityCaptions\(\): EndIdentityOption\[\][\s\S]{0,700}?this\.host\.setupIdentity\(\{ fid, aid \}\)/.test(src),
    'and it asks the HOST what the corpus holds, rather than deriving a shape name in the panel');
  check(/this\.endInfoFid = formationId\(end\);/.test(src) && /this\.endInfoAid = arrangementId\(end\);/.test(src),
    'the two tags come from the SAME end board and memo as the name and the sid, because they describe one arrival');
  check(/if \(!showsNearFilter\(this\.endInfoName\)\) return \[\];/.test(src),
    'a NAMED end prints no ids: the picker already opens on its formation, so the lines would be noise');
  check(/setupIdentity\(ids: \{ fid: string \| null; aid: string \| null \}\): \{ shapes: string\[\]; arrangements: string\[\] \}/.test(seq) &&
    /for \(const row of this\.setupRows\) \{/.test(seq),
    'the host answers from the Board drawer\'s own setup catalogue, so "matches a formation or arrangement" is one list');
  check(/setupIdentity: \(ids\) => seqUi\.setupIdentity\(ids\)/.test(main),
    'and `main.ts` wires the editor to it, the same way it wires `startFormations`');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
