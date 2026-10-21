// Probe: THE MARKER THAT SAYS WHERE A SEQUENCE ROW'S CALL COMES FROM.
//
// Asked for as: "add a small marker to indicate if a call used in a sequence is a CodedMove or from the
// catalogue."
//
// The rule is a pure function (`poc/src/step-source.ts`), so this runs it over the REAL catalogue rather than
// reading the panel's source. What it has to prove is that the badge cannot LIE - that a name with a coded
// rule is not reported as an authored tam and, more importantly, that a name with NEITHER (a stored module, a
// call the catalogue does not ship) is not quietly reported as `catalogue`, which is what a two-way
// `findCodedMove(name) ? ... : 'catalogue'` would do.
//
// Run: node poc/tools/step-source-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const { callSource, stepSource } = await import('./../src/step-source.ts');
const { callsByTitle } = await import(pathToFileURL(path.join(POC, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
const assets = path.join(POC, '..', 'assets');
const seq = new engine.Sequencer(
  fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const isModule = (n) => seq.isModule(n);
// A MODULE REGISTERED HERE RATHER THAN LOADED. The app's own modules come through `validCederModules`, which
// is Vite-only (`import.meta.glob`), so a probe cannot import it - and it does not need to: the rule under
// test asks the SEQUENCER what it registered, and `registerModule` is the same call the app makes with the
// corpus's steps. The name is deliberately one no catalogue file authors, so the answer can only have come
// from the module predicate.
const MODULE_NAME = 'Probe Module (a sequence, not a call)';
seq.registerModule(MODULE_NAME, ['Pass Thru', 'Touch a Quarter']);

console.log('== the five answers, on named witnesses ==');
// DERIVED WITH NO CATALOGUE UNDERNEATH IT AT ALL - `Step Forward` has no tam in any corpus file.
check(callSource('Step Forward') === 'derived', '`Step Forward` is DERIVED - the corpus has no such call');
check(callSource('Fold') === 'derived' && callSource('Run') === 'derived' && callSource('Sweep a Quarter') === 'derived',
  'and so are `Fold`, `Run` and `Sweep a Quarter`');
// DERIVED WITH THE CATALOGUE AS A DECLARED FALLBACK - the five, and this is the check that makes the badge
// three-way rather than two-way.
for (const name of ['Do Sa Do', 'Swing Thru', 'Left Swing Thru', 'Fan the Top', 'Forward and Back']) {
  check(callSource(name) === 'derived+catalogue', `\`${name}\` is DERIVED WITH A CATALOGUE FALLBACK`);
}
// CATALOGUE - a name with no coded rule.
check(callSource('Pass Thru') === 'catalogue' && callSource('Allemande Left') === 'catalogue',
  '`Pass Thru` and `Allemande Left` are CATALOGUE calls');
// A SELECTION IS STRIPPED, because the registry is keyed on the base call: the scoped spelling is the same
// rule, and this is the marker agreeing with the walk about what the call is.
check(callSource('Heads Forward and Back') === 'derived+catalogue'
  && callSource('Heads Step Forward') === 'derived'
  && callSource('All 8 Face Right') === 'catalogue',
  'a scoped spelling is classified on its BASE call, exactly as the walk splits it');
// A MODULE IS NOT A CATALOGUE CALL. This is the negative control for the whole rule: the plausible wrong
// implementation is `findCodedMove(name) ? ... : 'catalogue'`, and a module name is not in either registry.
const mods = seq.listModules();
console.log(`    ${mods.length} module(s) registered with the sequencer`);
check(mods.includes(MODULE_NAME), 'the module is registered, so the walk below is about a real one');
check(stepSource(MODULE_NAME, isModule).source === 'module',
  `a stored module (${MODULE_NAME}) is reported as a MODULE, not as an authored tam - which is what the two-way rule would have said`);
check(!seq.library.hasCall(MODULE_NAME) && !engine.findCodedMove(MODULE_NAME),
  'and it really is in neither registry, so the answer could only have come from the module predicate');

console.log('\n== a whole STEP, including a "while" ==');
check(stepSource('Pass Thru', isModule).source === 'catalogue', 'a bare call step is that call');
check(stepSource({ selection: 'Heads', call: 'Forward and Back' }, isModule).source === 'derived+catalogue',
  'a {selection, call} step is classified on its base call');
const figure = { groups: [{ selection: 'Heads', call: 'Step Forward' }, { selection: 'Sides', call: 'Pass Thru' }] };
const mixed = stepSource(figure, isModule);
check(mixed.source === 'mixed', 'a "while" whose lanes disagree is MIXED');
check(JSON.stringify(mixed.calls.map((c) => c.source)) === JSON.stringify(['derived', 'catalogue']),
  'and it reports each lane\'s own source, so the tooltip can say WHICH lane is which rather than just "mixed"');
const agreed = { groups: [{ selection: 'Heads', call: 'Pass Thru' }, { selection: 'Sides', call: 'Touch a Quarter' }] };
check(stepSource(agreed, isModule).source === 'catalogue',
  'a "while" whose lanes AGREE is that source, not `mixed` - otherwise every figure would be uninformative');
const oneLane = { groups: [{ selection: 'Heads', call: 'Swing Thru' }] };
check(stepSource(oneLane, isModule).source === 'derived+catalogue',
  'and a one-lane figure is that lane\'s call (the commonest figure shape)');
check(stepSource({ groups: [] }, isModule).source === 'mixed',
  'a step with no lanes at all is `mixed` rather than an invented source');

console.log('\n== the counts, over the registry itself ==');
// The three numbers the rule's own header states. A movement in EITHER direction fails, so an overlap that
// appeared or vanished is re-pinned deliberately rather than absorbed.
//
// RE-PINNED 23 -> 21 AND 11 -> 10 when the derived Promenade family was removed from `coded-moves.ts` so it
// could be hand-authored from tams: that took TWO registry entries with it (`Promenade`/`Promenade Home`,
// which are one move, and `Promenade 1/2`). AT THE TIME only `Promenade 1/2` was among the overlapped names -
// the catalogue authored it in `ms/promenade.xml` and authored no bare `Promenade` - which is why the overlap
// fell by one while the registry fell by two. THE CORPUS AUTHORS BOTH BARE NAMES NOW (the CALLERLAB
// `Promenade` and `Promenade Home`), so that explanation no longer describes the tree: what keeps these
// numbers where they are is that NEITHER name is a CODED MOVE any more, so `codedAlsoAuthored` below cannot
// see them either way. The fallback count is unchanged at 5, and that is the check that says so rather than
// a claim about it.
const codedAlsoAuthored = engine.CODED_MOVES.filter((m) => seq.library.hasCall(m.name)).map((m) => m.name);
const withFallback = engine.CODED_MOVES.filter((m) => m.catalogueFallback).map((m) => m.name);
console.log(`    ${engine.CODED_MOVES.length} coded moves; ${codedAlsoAuthored.length} also authored; ${withFallback.length} with a catalogue fallback`);
console.log(`    authored too: ${codedAlsoAuthored.join(', ')}`);
// RE-PINNED 21/10 -> 33/11 when the ARM TURN FAMILY became derived (`arm-turn.ts`): twelve registry entries - three
// fractions times six spellings times two hands, which is 21 + 12 = 33 - and ONE new overlap, because the corpus
// authors `Left Arm Turn 3/4` and that is the first alias of the left-hand entry (`Right Arm Turn 3/4` is not any
// entry's NAME, only an alias, so it is not counted here). Both movements are additions from a widening, which is
// the one legitimate direction for a count like this to move (§11.2.8); the fallback count stays at 5, and the
// check below still says so rather than assuming it.
check(engine.CODED_MOVES.length === 33, `the coded registry holds ${engine.CODED_MOVES.length} moves`);
check(codedAlsoAuthored.length === 11, `${codedAlsoAuthored.length} of them ALSO have catalogue authorings`);
check(withFallback.length === 5
  && ['Do Sa Do', 'Swing Thru', 'Left Swing Thru', 'Fan the Top', 'Forward and Back'].every((n) => withFallback.includes(n)),
  `and exactly ${withFallback.length} declare a catalogue fallback: ${withFallback.join(', ')}`);
// THE RULE AND THE REGISTRY CANNOT DISAGREE: every coded move is classified from the move itself.
const wrong = engine.CODED_MOVES.filter((m) => callSource(m.name) !== (m.catalogueFallback ? 'derived+catalogue' : 'derived'));
check(wrong.length === 0, `every coded move is classified from its own \`catalogueFallback\` (${wrong.length} disagree)`);

console.log('\n== the wiring, so the badge is actually on the row ==');
// NORMALISED LINE ENDINGS. The app's sources are CRLF in the working tree, so a multi-line regex written with
// `\n` matches nothing and the checks below would pass or fail on the file's history rather than its content
// (AGENTS trap 2 - it has bitten this repo more than once).
const readSource = (p) => fs.readFileSync(path.join(POC, p), 'utf8').replace(/\r\n/g, '\n');
const ui = readSource('src/sequencer-ui.ts');
const css = readSource('src/style.css');
check(/import \{ stepSource \} from '\.\/step-source';/.test(ui), 'the panel imports the rule');
check(/private sourceMark\(step: ModuleStep\): string \{/.test(ui), 'and has one method that renders the marker');
check(/\+ this\.sourceMark\(step\)/.test(ui), 'and every timeline row calls it, so no row is left unmarked');
check(/seq-src \$\{meta\.cls\}/.test(ui), 'the badge carries its source class');
check(/title="\$\{esc\(label\)\}" aria-label="\$\{esc\(label\)\}"/.test(ui),
  'and both a title and an aria-label, so the badge is readable by hover and by a screen reader');
// EVERY SOURCE THE RULE CAN RETURN HAS A BADGE, or a step would render as an unstyled or empty span.
const marks = /SOURCE_MARK: Record<CallSource[\s\S]*?\n  \};/.exec(ui)?.[0] ?? '';
for (const s of ['derived', 'derived+catalogue', 'catalogue', 'mixed', 'module']) {
  check(marks.includes(s), `the badge table covers \`${s}\``);
}
for (const cls of ['src-derived', 'src-both', 'src-cat', 'src-mixed', 'src-module']) {
  check(marks.includes(cls) && css.includes(`.seq-src.${cls}`), `and \`${cls}\` is styled`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
