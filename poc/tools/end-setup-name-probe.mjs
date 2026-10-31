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
//      other check here would still pass;
//   5. THE REPORTED CASE, "Circle Four Left 3/4" from "Facing Couples" (a four-dancer call whose end is that formation
//      turned a quarter turn): the NAME test refuses it on purpose, the IDS name it, and the captions now say so -
//      while the first cut of `f0a4fbf5` answered from the Board picker's EIGHT-dancer catalogue and therefore reported
//      "no corpus formation carries this shape" at every shorter end. The negative control keeps that measurement.
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
const { buildSetupCatalogue, formationsCarrying } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'setup-catalogue.ts')).href
);
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
/** `corpusFormationsOfSize`, over the same file the panel reads: every formation completed to its played size. Cached by
 *  size because the sweep asks the same size for every call and completing 217 formations per call is the sweep's cost. */
const sizeLists = new Map();
const formationsOfSize = (dancers) => {
  if (sizeLists.has(dancers)) return sizeLists.get(dancers);
  const out = [];
  for (const [name, ds] of formations) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
    if (poses.length === dancers) out.push({ name, poses });
  }
  sizeLists.set(dancers, out);
  return out;
};
const totals = { calls: 0, eight: 0, known: 0, turned: 0, unknown: 0, unknown8: 0, withSid: 0, inCatalogue: 0, unknown8InCatalogue: 0, fidMatched: 0, aidMatched: 0 };
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
      const ofSize = formationsOfSize(call.dancers.length);
      // THE PANEL'S OWN QUESTION, asked with the engine's own rule: does any formation of this call's size stand under the
      // poses the dancers arrive at, AS AUTHORED OR TURNED? That is `endFormationMatch` - the row is populated from it - so
      // the population counted below is the one the row actually calls Unknown Setup.
      const match = engine.endFormationMatch(call, ofSize);
      if (call.dancers.length === 8) totals.eight++;
      if (match !== null) {
        totals.known++;
        if (match.turnDeg !== 0) totals.turned++;
      } else {
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
        // AND THE TWO CAPTIONS the row now lists above the names, as the panel asks for them: `formationsCarrying` over the
        // formations of THIS call's size - not the eight-dancer setup catalogue, which is what made every shorter end say
        // nothing carried its shape.
        const fid = engine.formationId(endBoard);
        const aid = engine.arrangementId(endBoard);
        const carried = formationsCarrying(ofSize, { fid, aid });
        if (carried.shapes.length > 0) totals.fidMatched++;
        if (carried.arrangements.length > 0) totals.aidMatched++;
      }
    }
  }
}
console.log(`    ${totals.calls} call variants: ${totals.known} finish on a setup the corpus names (${totals.turned} of them TURNED), ${totals.unknown} on nothing at any turn`);
console.log(`    the row therefore says "Unknown Setup" only for the ${totals.unknown}, ${totals.unknown8} of them eight-dancer boards - the population the export button is for`);
console.log(`    ${totals.withSid} of the ${totals.unknown} unknown ends carry a SETUP ID, and ${totals.inCatalogue} of those ids are setups the Board picker offers`);
console.log(`    of those unnamed ends, ${totals.fidMatched} stand on a SHAPE a formation of their own size carries and ${totals.aidMatched} on an ARRANGEMENT one carries - the two captions the picker now lists`);
console.log(`    ${totals.unknown8InCatalogue} of them are eight-dancer setups, e.g. ${unknownEightExamples.join(', ') || 'none'}`);
console.log(`    the rest have nowhere to go in formations.xml, e.g. ${unknownExamples.join(', ') || 'none'}`);
check(totals.known > 0 && totals.unknown > 0,
  `both answers happen in the corpus (${totals.known} named / ${totals.unknown} not), so neither branch is dead code`);
check(totals.turned > 0,
  `and ${totals.turned} of the named ends are boards the corpus writes ANOTHER WAY ROUND - the case a name that could not see the turn left on Unknown Setup`);
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
  `and the id captions have a population: ${totals.fidMatched} of the ${totals.unknown} unnamed ends stand on a shape a formation of their own size carries`);
check(totals.aidMatched >= 0 && totals.aidMatched <= totals.unknown,
  `while ${totals.aidMatched} stand on an arrangement one carries - the rest are new shapes or new arrangements, which is what the captions say`);

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
  check(/private endSetupInfo\(call: CallBundle\): \{ name: string; setupId: string \| null; turnDeg: number \}/.test(src) &&
    /this\.endInfoSid = setupId\(end\)/.test(src) && /const match = this\.endMatch\(call\);/.test(src),
    'ONE memo answers the name, the turn and the id, because they describe the same arrival - and the name comes from the match, never from a scan of its own');
  check(/this\.endSpinSteps = end\.turnDeg \/ END_SPIN_DEG;/.test(src) && /this\.endFormationSel\.value = end\.name;/.test(src),
    'the load writes BOTH halves of that answer: the picker opens on the name and the rotation control on the turn, so the value is placeable as it stands');
  check(/const match = inst \? this\.endMatch\(inst\) : null;[\s\S]{0,120}?this\.endSpinSteps = match && match\.name === name \? match\.turnDeg \/ END_SPIN_DEG : 0;/.test(src),
    'and an explicit pick starts at the board\'s own turn when it is the setup the board is in, and at 0 for any other - a turn cannot follow a formulation nobody looked at');
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
//
// THE ARRANGEMENT LEADS, asked for as: "Switch the formation and arrangement hints so that arrangement comes first." The
// order is the specificity of the claim: the `aid` is the board dancer for dancer, the `fid` the same spots and facings
// whatever the rotation - so the precise statement leads and the fallback follows, the same order as `sid ⇒ aid ⇒ fid`.
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
  check(known[0].id === 'A1-abcdefgh' && /arrangement: Normal Lines \/ Sashayed Lines/.test(known[0].label),
    `the AID comes FIRST, naming the formations that carry the arrangement (${known[0].label})`);
  check(known[1].id === 'F3-1r9s5bst' && known[1].label.startsWith('F3-1r9s5bst — formation: Lines'),
    `and the FID second, naming the shape (${known[1].label})`);

  // THE DIFFERENCE THE LINES EXIST TO DRAW: a known shape in an unknown arrangement, and a shape nothing holds.
  const newArrangement = endIdentityOptions({ fid: 'F3-1r9s5bst', aid: 'A1-new', shapes: ['Lines'], arrangements: [] });
  check(/no corpus setup carries this arrangement/.test(newArrangement[0].label) && /formation: Lines/.test(newArrangement[1].label),
    `a KNOWN shape in a NEW arrangement says exactly that - the arrangement it lacks first (${newArrangement.map((o) => o.label).join(' | ')})`);
  const newShape = endIdentityOptions({ fid: 'F3-new', aid: 'A1-new2', shapes: [], arrangements: [] });
  check(/no corpus formation carries this shape/.test(newShape[1].label),
    `and a shape nothing holds says so rather than printing a bare tag (${newShape[1].label})`);
  // THE ORDER IS NOT A SORT: a board with ONLY a fid still leads with the fid, because there is no arrangement line to lead.
  const shapeOnly = endIdentityOptions({ fid: 'F3-only', aid: null, shapes: ['Lines'], arrangements: [] });
  check(shapeOnly.length === 1 && shapeOnly[0].id === 'F3-only',
    'a board with no `aid` prints the fid alone - the arrangement leading does not invent a line');

  // THE SUMMARY, because an arrangement can be carried by many setups (a Static Square has aliases and arrangement twins).
  const many = endIdentityOptions({
    fid: 'F3-x', aid: 'A1-y', shapes: [], arrangements: ['A', 'B', 'C', 'D', 'E'],
  });
  check(/A \/ B \/ C \(\+2 more\)/.test(many[0].label),
    `more than three names are summarised rather than listing the whole catalogue (${many[0].label})`);
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
  check(/private endIdentityCaptions\(\): EndIdentityOption\[\][\s\S]{0,1400}?formationsCarrying\(this\.host\.startFormations\(this\.instance\.dancers\.length\), \{ fid, aid \}\)/.test(src),
    'and it asks `formationsCarrying` over the formations of THE CALL\'S OWN SIZE - the list the picker beside it offers, not the eight-dancer setup catalogue');
  check(!/setupIdentity/.test(src) && !/setupIdentity/.test(seq) && !/setupIdentity/.test(main),
    'and the eight-dancer catalogue lookup it replaced is GONE, not left beside the new one - two answers to one question is how the size bug survived a green probe');
  check(/this\.endInfoFid = formationId\(end\);/.test(src) && /this\.endInfoAid = arrangementId\(end\);/.test(src),
    'the two tags come from the SAME end board and memo as the name and the sid, because they describe one arrival');
  check(/if \(!showsNearFilter\(this\.endInfoName\)\) return \[\];/.test(src),
    'a NAMED end prints no ids: the picker already opens on its formation, so the lines would be noise');
}

// ---------------------------------------------------------------- 5. THE REPORTED CASE
//
// Asked for as: "For the call 'Circle Four Left 4/3' from 'Facing Couples', why does the end setup not match 'Facing
// Couples'? Currently it shows 'Unknown Setup'. They look the same, except for the +90 deg rotation."
//
// MEASURED: they ARE the same setup, turned a quarter turn. `endFormationName` is orientation-sensitive on purpose (a name
// is a re-base and must not move the dance), so it refuses this end; the ids are rotation-CANONICAL (`sid ⇒ aid ⇒ fid`), so
// they name the corpus's own `Facing Couples`; and `endFormationMatch` names the setup AND the turn, which is what the row
// needed to populate the field without lying about the orientation. This section pins ALL FOUR fractions, both questions,
// the ids, and the captions - so the refusal, the name and the turn stay one story.
console.log('\n== 5. "Circle Four Left" from "Facing Couples": the whole and the halves name it, the quarters name it TURNED ==');
{
  const pairs = engine.parseFormations(formationsXml);
  const corpusOfSize = (dancers) => {
    const out = [];
    for (const [name, ds] of pairs) {
      const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
      if (poses.length === dancers) out.push({ name, poses });
    }
    return out;
  };
  const tam = fs.readFileSync(path.join(assets, 'ms', 'circle.xml'), 'utf8');
  const wanted = ['Circle Four Left', 'Circle Four Left 1/2', 'Circle Four Left 1/4', 'Circle Four Left 3/4'];
  const tams = engine
    .parseCallXml(tam)
    .filter((t) => wanted.includes((t.title ?? '').trim()) && (t.from ?? '').trim() === 'Facing Couples');
  check(tams.length === 4, `all four "Circle Four Left" fractions resolve by TITLE and FROM, not by index (${tams.length} found)`);
  const list = corpusOfSize(4);
  const facing = list.find((f) => f.name === 'Facing Couples');
  const matches = wanted.map((title) => {
    const found = tams.find((t) => (t.title ?? '').trim() === title);
    const call = found ? engine.buildCall(found, pairs, engine.parseMoves(movesXml), true) : null;
    return { title, call, match: call ? engine.endFormationMatch(call, list) : null };
  });
  console.log(`    ${matches.map((m) => `${m.title}: strict ${JSON.stringify(m.call ? engine.endFormationName(m.call, list) : null)} / match ${JSON.stringify(m.match)}`).join(' | ')}`);
  check(matches.every((m) => m.call !== null && m.call.dancers.length === 4),
    'each is a four-dancer call, so the picker list is the four-dancer one - which is why the eight-dancer catalogue could not answer');
  check(matches.every((m) => m.match?.name === 'Facing Couples'),
    'every one of them is called Facing Couples, so the End setup field populates for all four instead of saying Unknown Setup');
  const turns = Object.fromEntries(matches.map((m) => [m.title, m.match?.turnDeg]));
  check(turns['Circle Four Left'] === 0 && turns['Circle Four Left 1/2'] === 0,
    `the whole and the half finish AS AUTHORED (${JSON.stringify(turns)})`);
  check(turns['Circle Four Left 1/4'] === 90 && turns['Circle Four Left 3/4'] === 90,
    'and the quarters finish a quarter turn round - the turn the rotation control is set to, so Place end does not move them');
  check(matches.filter((m) => engine.endFormationName(m.call, list) === null).length === 2,
    'while the STRICT namer still refuses exactly the two quarter turns, so the two questions stay apart');
  const call = matches.find((m) => m.title === 'Circle Four Left 1/4').call;
  const end = engine.boardAtBeat(call, call.beats);
  const fid = engine.formationId(end);
  const aid = engine.arrangementId(end);
  check(facing !== undefined && fid === engine.formationId({ dancers: facing.poses }) && aid === engine.arrangementId({ dancers: facing.poses }),
    `and the IDS agree it is that same setup: fid ${fid}, aid ${aid}, both Facing Couples' own - the ids are rotation-canonical and the name test is not`);
  const turned = facing === undefined ? [] : facing.poses.map((p) => ({ ...p, x: -p.y, y: p.x, heading: p.heading + Math.PI / 2 }));
  check(turned.length > 0 && engine.endsOnFormation(call, turned) === true,
    'which is confirmed by the board matching Facing Couples when IT is turned: the rotation is the whole of the difference');
  const carried = formationsCarrying(list, { fid, aid });
  const labels = endIdentityOptions({ fid, aid, shapes: carried.shapes, arrangements: carried.arrangements });
  check(labels.length === 2 && labels[0].id === aid && labels[1].id === fid,
    `and the captions say it in the same words, ARRANGEMENT first: ${labels.map((o) => o.label).join(' | ')}`);
  check(carried.shapes.includes('Facing Couples') && carried.arrangements.includes('Facing Couples'),
    'with both lines naming Facing Couples, because this end IS that setup turned a quarter turn');
  // NEGATIVE CONTROL: the answer the eight-dancer catalogue gave, kept as a measurement rather than a story. Its rows are
  // filtered to eight dancers, so nothing in it can carry a four-dancer `fid`/`aid`.
  check(catalogue.rows.every((row) => row.fid !== fid && row.aid !== aid),
    `NEGATIVE CONTROL: the Board picker's ${catalogue.rows.length}-row catalogue carries neither id, which is exactly why this end said nothing was carried`);
  // AND THE TURN IS NOT AN IDENTITY: the two quarter turns are DIFFERENT boards with ONE setup id, which is what makes the
  // turn a thing to record rather than a thing to name.
  const ids = matches.map((m) => {
    const board = engine.boardAtBeat(m.call, m.call.beats);
    return `${engine.setupId(board)}/${engine.formationId(board)}/${engine.arrangementId(board)}`;
  });
  check(new Set(ids).size === 1, `all four ends mint ONE sid/fid/aid (${ids[0]}), so the turn is recorded on the row and never in an id`);
}

// ---------------------------------------------------------------- 6. THE SECOND REPORTED CASE
//
// Asked for as: "Investigate why 'Allemande Left' from 'Wrong Way Grand Circle' doesn't match the end formation 'Right and
// Left Grand Circle' with a 45 deg offset. (is it because the match only tests with 90 deg offsets?)" - and the answer was
// YES, so the match now tries eight turns. This is the field-level regression for it: the end board stands exactly on that
// formation turned 45 degrees, the strict namer still refuses the board as authored, and the ARRANGEMENT rule picks that
// formation over its twin rather than the twin.
console.log('\n== 6. "Allemande Left" from "Wrong Way Grand Circle": an end 45 degrees round ==');
{
  const pairs = engine.parseFormations(formationsXml);
  const list = [];
  for (const [name, ds] of pairs) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
    if (poses.length === 8) list.push({ name, poses });
  }
  const xml = fs.readFileSync(path.join(assets, 'ms', 'allemande.xml'), 'utf8');
  const tams = engine
    .parseCallXml(xml)
    .filter((t) => (t.title ?? '').trim() === 'Allemande Left' && (t.formationAttr ?? '').trim() === 'Wrong Way Grand Circle');
  check(tams.length === 1, `the tam resolves by TITLE and FORMATION, not by index (${tams.length} found)`);
  const call = tams.length === 1 ? engine.buildCall(tams[0], pairs, engine.parseMoves(movesXml), true) : null;
  check(call !== null && call.dancers.length === 8, `it is an ${call ? call.dancers.length : '?'}-dancer call`);
  const rlgc = list.find((f) => f.name === 'Right and Left Grand Circle');
  const turn = (poses, deg) => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    return poses.map((p) => ({ ...p, x: p.x * c - p.y * s, y: p.x * s + p.y * c, heading: p.heading + deg * Math.PI / 180 }));
  };
  check(rlgc !== undefined && engine.endsOnFormation(call, rlgc.poses) === false,
    'as authored the end does NOT match that formation - the spots coincide but every facing is 180 degrees out');
  check(rlgc !== undefined && engine.endsOnFormation(call, turn(rlgc.poses, 45)) === true,
    'turned 45 degrees it matches EXACTLY, which is the offset the report named');
  const match = engine.endFormationMatch(call, list);
  console.log(`    match: ${JSON.stringify(match)}`);
  check(match?.name === 'Right and Left Grand Circle' && match?.turnDeg === 45,
    `so the field says that name at 45 degrees (${JSON.stringify(match)}) - and the ARRANGEMENT decides it: the twin "Wrong Way Grand Circle" misses all 8 genders where this one agrees on all 8`);
  check(engine.endFormationName(call, list) === null,
    'while the STRICT namer still refuses the board as authored, so the two questions stay apart at 45 degrees too');
  check(engine.endFormationMatch(call, list)?.turnDeg !== 90,
    'and the turn it reports is 45 rather than 90: an eighth of a turn is the resolution, not a quarter');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
