// Probe: the SAVED MODULES are read through one validating parser, by both readers.
//
// Two modules read the same localStorage key and only one checked what it found. The browse view's
// `savedModules` rejected an entry with no `name` or no `calls` array; the sequencer's `loadModules` cast
// whatever it parsed straight to `Module[]`. `refreshModulesList` then maps over the result FROM THE
// CONSTRUCTOR, which `main.ts` awaits at top level - so a stored `{"a":1}` (not an array) or a single `{}`
// threw during startup and took the whole app down, while the browse view carried on as if nothing were wrong.
//
// A SAVED MODULE IS A SEQUENCE DOCUMENT: besides its calls it carries the board it was RECORDED on and the
// board its replay ENDED on, and loading it stands the dancers up there instead of at home. The parser decides
// KEEP-OR-DROP for those two references; WHICH board an `sid` names is `sequence-json.ts`'s question, refused by
// name at load time, so this probe measures the shape rule and the wiring that uses it - not the catalogue.
//
// The parser is pure and imports nothing but types, so this calls it directly under node's type stripping
// rather than reading its text.
//
// Run: node poc/tools/stored-modules-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const { parseStoredModules } = await import('./../src/stored-modules.ts');

console.log('== what a corrupt store yields ==');
const cases = [
  ['a JSON object instead of an array', '{"a":1}', 0],
  ['the literal null', 'null', 0],
  ['a number', '42', 0],
  ['truncated JSON', '[{"name":"x","calls":', 0],
  ['nothing stored at all', null, 0],
  ['an empty string', '', 0],
  ['an entry that is not an object', '[null,7,"x"]', 0],
  ['an entry with no calls', '[{"name":"x"}]', 0],
  ['an entry with no name', '[{"calls":["Pass Thru"]}]', 0],
  ['an entry whose calls is a string', '[{"name":"x","calls":"Pass Thru"}]', 0],
];
for (const [what, raw, expect] of cases) {
  const got = parseStoredModules(raw);
  check(got.length === expect, `${what} yields ${expect} module(s) rather than throwing`);
}

console.log('\n== what a good store yields ==');
const good = parseStoredModules('[{"name":"a","calls":["Pass Thru"]},{"name":"b","calls":[{"call":"Swing Thru","selection":"Heads"}]}]');
check(good.length === 2, 'two well-formed entries both survive');
check(good[0].name === 'a' && good[0].calls[0] === 'Pass Thru', 'the first keeps its name and its steps');
check(good[1].calls[0].call === 'Swing Thru' && good[1].calls[0].selection === 'Heads', 'and a scoped step keeps its selection, which is what tells two calls apart');
const mixed = parseStoredModules('[{"name":"good","calls":[]},{},{"name":"also good","calls":[]}]');
check(mixed.length === 2 && mixed[0].name === 'good' && mixed[1].name === 'also good',
  'A BAD ENTRY IN THE MIDDLE LOSES ITSELF, NOT THE LIST - the others still load');
const extra = parseStoredModules('[{"name":"a","calls":[],"level":"ms","tags":["x"]}]');
check(extra.length === 1 && !('level' in extra[0]) && !('tags' in extra[0]),
  'unknown fields are dropped rather than carried forward as a schema this module would then own');

console.log('\n== a "while" step, in both the stored shapes ==');
// THE SEQUENCER SAVES THE RAW HISTORY, so a "while" step saved before lanes existed is
// `{groups:[{selection, call}]}` in a caller's browser, while the canonical write is now a LANE
// (`{selection, calls:[...]}`). The upgrade happens in THIS parser - the one both readers share - so
// nothing downstream has to know the old shape exists.
const legacy = parseStoredModules('[{"name":"w","calls":[{"groups":[{"selection":"Centers","call":"Square Thru"},{"selection":"Outsides","call":"Trade"}]}]}]');
check(legacy.length === 1, 'a stored "while" step survives the parse rather than being dropped as an unknown step');
check(legacy[0]?.calls[0]?.groups?.[0]?.calls?.length === 1 && legacy[0].calls[0].groups[0].calls[0] === 'Square Thru',
  'and its LEGACY single-`call` lane is upgraded to the canonical `calls` list, so one shape reaches the app');
const lane = parseStoredModules('[{"name":"w","calls":[{"groups":[{"selection":"Sides","calls":["Trade","Pass Thru"]}]}]}]');
check(lane.length === 1 && lane[0].calls[0].groups[0].calls.length === 2,
  'a canonical LANE keeps every call, in order');
const broken = parseStoredModules('[{"name":"w","calls":[{"groups":[{"selection":"Sides"}]}]},{"name":"ok","calls":["Pass Thru"]}]');
check(broken.length === 1 && broken[0].name === 'ok',
  'a group with NO call loses its whole module rather than silently shortening the sequence, and the next entry still loads');
const stringLane = parseStoredModules('[{"name":"w","calls":[{"groups":[{"selection":"Sides","calls":"Trade"}]}]}]');
check(stringLane.length === 0, 'and a lane whose calls are not a list is refused rather than read as one call');

console.log('\n== a module\'s two boards, and what counts as one ==');
const poses = (n) => Array.from({ length: n }, (_, i) => ({ gender: i % 2 ? 'girl' : 'boy', x: i, y: i, heading: 0 }));
const REF = JSON.stringify({ sid: 'S1-abc', aid: 'A1-def', fid: 'F3-ghi', name: 'Zero Box' });
const withBoards = parseStoredModules(`[{"name":"m","calls":["Pass Thru"],"start":${REF},"end":${JSON.stringify({ sid: 'S1-xyz', name: 'Right-Hand Star' })}}]`);
check(withBoards.length === 1, 'a module that records where it starts and ends survives the parse');
check(withBoards[0]?.start?.sid === 'S1-abc' && withBoards[0]?.start?.aid === 'A1-def' && withBoards[0]?.end?.sid === 'S1-xyz',
  'and both references come through with their ids, which is what the loader resolves the board from');
check(withBoards[0]?.start?.name === 'Zero Box', 'the caption comes through too, so the drawer can name the board it loads from');
const legacyModule = parseStoredModules('[{"name":"a","calls":["Pass Thru"]}]');
check(legacyModule.length === 1 && legacyModule[0].start === undefined && legacyModule[0].end === undefined,
  'A MODULE SAVED BEFORE THE FIELDS EXISTED loads with neither, which means "from home" - it is not dropped');
const emptyRef = parseStoredModules('[{"name":"a","calls":[],"start":{}}]');
check(emptyRef.length === 0,
  'an EMPTY reference drops the module: `{}` names no board, and reading it as "start from nowhere" is worse than not offering it');
// The negative controls for the shape rule, one field at a time - each is the plausible wrong edit (trust the
// value, coerce it, or accept a short pose list), and each fails ONLY the check it is named for.
for (const [what, ref] of [
  ['a non-string id', '{"sid":42}'],
  ['an empty id', '{"sid":""}'],
  ['a list instead of an object', '[]'],
  ['the string "Zero Box"', '"Zero Box"'],
  ['a non-finite pose', JSON.stringify({ dancers: poses(8).map((p, i) => (i ? p : { ...p, x: 'NaN' })) })],
  ['seven poses where a sequence is eight-dancer', JSON.stringify({ dancers: poses(7) })],
]) {
  check(parseStoredModules(`[{"name":"a","calls":[],"start":${ref}}]`).length === 0,
    `${what} is refused, and the module that holds it is dropped rather than loaded from the wrong board`);
}
const exact = parseStoredModules(`[{"name":"a","calls":[],"start":${JSON.stringify({ dancers: poses(8) })}}]`);
check(exact.length === 1 && exact[0].start?.dancers?.length === 8,
  'while the exact-pose form an export writes for an uncatalogued board is accepted, all eight of it');
check(exact[0]?.start?.dancers?.[0]?.gender === 'boy' && exact[0]?.start?.dancers?.[1]?.gender === 'girl',
  'and each pose keeps its gender and heading, because a start is an ARRANGEMENT and not just eight positions');
const badEnd = parseStoredModules('[{"name":"a","calls":[],"start":{"sid":"S1-a"},"end":{"sid":""}}]');
check(badEnd.length === 1 && badEnd[0].start?.sid === 'S1-a' && badEnd[0].end === undefined,
  'a MALFORMED END is not fatal: nothing about loading depends on it, so it is dropped and the module keeps its place in the list');

console.log('\n== and both readers are the same reader ==');
const seq = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
const mods = fs.readFileSync(path.join(POC, 'src', 'modules.ts'), 'utf8');
check(/this\.modules = parseStoredModules\(localStorage\.getItem\(MODULES_STORAGE_KEY\)\)/.test(seq),
  'the sequencer parses the stored list through it');
check(seq.includes("import { parseStoredModules } from './stored-modules';"), 'and imports it rather than copying it');
check(/return parseStoredModules\(localStorage\.getItem\(MODULES_STORAGE_KEY\)\)/.test(mods),
  'the browse view reads the same key through the same function');
check(!/JSON\.parse\(localStorage\.getItem\(MODULES_STORAGE_KEY\)/.test(seq + mods),
  'and the unvalidated parse is GONE from both, not left beside it');
check(/catch \{\s*return \[\];/.test(fs.readFileSync(path.join(POC, 'src', 'stored-modules.ts'), 'utf8')),
  'the one parser is the one that swallows a corrupt store');

console.log('\n== the panel records both boards, and loads through the stored one ==');
{
  const save = (() => {
    const i = seq.indexOf('private saveModule()');
    const j = seq.indexOf('\n  }\n', i);
    return i < 0 ? '' : seq.slice(i, j < 0 ? i + 2400 : j);
  })();
  check(/start: this\.setupRefOfBoard\(/.test(save) && /end: this\.setupRefOfBoard\(/.test(save),
    'Save module records WHERE IT STARTS AND WHERE IT ENDS, so a module is a sequence rather than a list of calls');
  check(/this\.startBoard \?\? this\.seq\.startBoard\(\)/.test(save),
    'the start is the board the saved sequence was loaded on, or home when it was never moved - not the board as it stands now');
  check(save.indexOf('registerModule') < save.indexOf('this.setupRefOfBoard'),
    'and the boards are only recorded once the engine has accepted the name, so a refusal still leaves no trace');
  // ONE CONVERSION FOR EVERY BOARD THE APP WRITES DOWN: the document's export and a saved module's boards are
  // the same data. A second conversion would be a second format, and the two would drift.
  check((seq.match(/this\.setupRefOfBoard\(/g) ?? []).length >= 3,
    'the document\'s start, its end and a saved module\'s two boards all go through one conversion');
  const load = (() => {
    const i = seq.indexOf('private loadModule(');
    const j = seq.indexOf('\n  }\n', i);
    return i < 0 ? '' : seq.slice(i, j < 0 ? i + 2400 : j);
  })();
  check(/resolveSetupRef\(start, this\.sequenceResolvers\(\)/.test(load),
    'loading a saved module RESOLVES its stored board with the resolver a sequence document uses - not a second reader of `sid`s');
  check(/this\.seq\.setSetupBoard\(read\.start\.dancers, read\.start\.label\)/.test(load),
    'and stands it up through `setSetupBoard`, the call the Board drawer uses, so the identity rules are the same');
  check(/if \('reason' in read\) \{[\s\S]{0,120}?return;/.test(load),
    'a start this app cannot resolve REFUSES and loads nothing, rather than replaying the module from home');
  check(/this\.loadSteps\(m\.calls, undefined, read\.start\.label/.test(load),
    'and the steps go through the shared `loadSteps`, so a module load is the same act as a document load');
  check(!/openSequence\(m\.calls\)[\s\S]{0,0}/.test(seq.slice(seq.indexOf('this.modulesEl.addEventListener'), seq.indexOf("this.seqListEl.addEventListener"))),
    'the drawer no longer hands a module straight to `openSequence`, which would have dropped the stored start');
  check(/this\.loadModule\(Number\(t\.dataset\.mod\)\)/.test(seq),
    'the row\'s click goes through `loadModule`');
  // The row says where the module starts and ends. Its absence is what tells a caller their old module begins at home.
  const list = (() => {
    const i = seq.indexOf('private refreshModulesList()');
    const j = seq.indexOf('\n  }\n', i);
    return i < 0 ? '' : seq.slice(i, j < 0 ? i + 2400 : j);
  })();
  check(/seq-mod-boards/.test(list) && /m\.start\.name/.test(list) && /m\.end\?\.name/.test(list),
    'and its row shows the two boards it dances between, from the module\'s own record rather than a second guess');
  check(/if \(!start\) \{ this\.openSequence\(m\.calls\); return; \}/.test(load),
    'a module with no stored start falls back to the from-home replay it has always had');
  check(/startFormation: m\.start\.name/.test(mods),
    'the browse view carries the same label, so opening a saved module from "used by" starts where it was saved too');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
