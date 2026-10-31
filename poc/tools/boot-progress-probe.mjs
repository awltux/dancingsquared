// THE STARTUP BAR COVERS THE WHOLE STARTUP, AND SAYS WHAT IT IS DOING.
//
// REPORTED as: "The startup progress bar seems to miss monitoring progress at the start and the end of the startup phase.
// There are long pauses while it is obviously doing something, but there is no feedback through the progress bar."
//
// MEASURED on a warm dev server, in ms since the navigation's time origin (the scratch `bootMark`, one run, this machine),
// and the reason the shape of this change is what it is:
//
//     main@3238           the module graph, before ANY app code runs       3.2 s   nothing can report - the page has no JS yet
//     download-run@3309   first corpus file                                  80 ms
//     download-end@4292   the 509 XML files                                 1.0 s   per-file ticks (already correct)
//     parse-end@5197      the catalogue walk                                0.9 s   ONE tick, at the end
//     seq@8623            the sequencer, one synchronous call               3.1 s   bar pinned at 100%, label "Initialising"
//     browse@8623, editor@8660, finish@8663                                 0.2 s
//
// So the bar was missing at BOTH ends: nothing at all before the app ran, one silent jump through the parse, and - the
// worst of it - 100% and a single word for the 3.3 seconds of panel construction that came after.
//
// WHAT IS PINNED HERE, and the alternative each check rules out:
//
//   1. the MAPPING (`bootPercent`): download owns 0-60, parse 60-85, the build steps run 85->99, `finishLoading` sets
//      100. Monotone across the phases, clamped against a loader that miscounts, and the join between the last parse
//      fraction and the first build step is EXACT - a jump backwards would be the bar lying about the phase;
//   2. the WORDS (`bootLabel`): the percentage is in the sentence, so a bar that moved with no number would fail; and
//      the build steps are NAMED, because "Initialising" for 3.3 seconds is what the report was about;
//   3. the PLUMBING, read from the source: `main.ts` paints every build step through `buildStep`, which awaits a frame
//      before the work (a paint batched with the work is not a paint), `finishLoading` is the only writer of 100, and
//      `data.ts` reports the parse per chunk with a yielded frame;
//   4. the START, which no JavaScript can report: `index.html` carries the sweep element and `style.css` animates a
//      `transform`, the one kind of motion a blocked main thread cannot stop.
//
// Run: node tools/boot-progress-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { bootLabel, bootPercent, BUILD_STEPS } = await import(pathToFileURL(path.join(POC, 'src', 'boot-progress.ts')).href);

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. the mapping
console.log('\n== 1. the bar has a position for every fraction the loader reports ==');
{
  check(bootPercent('download', 0) === 0 && bootPercent('download', 1) === 60,
    `download runs 0 -> 60 (${bootPercent('download', 0)} -> ${bootPercent('download', 1)})`);
  check(bootPercent('parse', 0) === 60 && bootPercent('parse', 1) === 85,
    `parse picks up exactly where download leaves off and runs to 85 (${bootPercent('parse', 0)} -> ${bootPercent('parse', 1)})`);
  check(bootPercent('parse', 0) === bootPercent('download', 1),
    'so the phase boundary is one position, not two - a gap would show as the bar jumping on a phase change');
  // MONOTONE INSIDE EACH PHASE, sampled the way the loader reports it.
  for (const phase of ['download', 'parse']) {
    let prev = -1;
    let ok = true;
    for (let i = 0; i <= 100; i++) {
      const p = bootPercent(phase, i / 100);
      if (p < prev) ok = false;
      prev = p;
    }
    check(ok, `${phase}: every reported fraction moves the bar forwards or holds it`);
  }
  // CLAMPED: a loader that reports 1.4 or -3 must not overflow the bar or run it backwards - and a NaN must not
  // produce `NaN%` in the DOM.
  check(bootPercent('download', 2) === 60 && bootPercent('download', -1) === 0 && bootPercent('parse', 9) === 85,
    'a fraction outside 0..1 is clamped rather than allowed to overflow');
  check(Number.isFinite(bootPercent('parse', Number.NaN)), `a NaN fraction still gives a number (${bootPercent('parse', Number.NaN)}) - the fill would otherwise read "NaN%"`);

  // AND THE BUILD STEPS JOIN IT, ascending and never past 100.
  const percents = BUILD_STEPS.map((s) => s.percent);
  check(percents[0] === bootPercent('parse', 1),
    `the first build step starts exactly where the parse ends (${percents[0]} === ${bootPercent('parse', 1)})`);
  check(percents.every((p, i) => p > 0 && p <= 100 && (i === 0 || p > percents[i - 1])),
    `and the steps ascend towards 100 (${percents.join(' -> ')})`);
  check(percents[percents.length - 1] < 100,
    'while the last step stays under 100: only `finishLoading` may say the startup is done');
  // NEGATIVE CONTROL: the flat share the old bar used (download 0-70, then a constant "Initialising" at 70-100 for the
  // parse AND everything after it) - the shape the report was about. It fails the parse-owns-60-85 check above.
  const oldShare = (phase, frac) => (phase === 'download' ? frac * 70 : 70);
  check(oldShare('parse', 0) === oldShare('parse', 1) && bootPercent('parse', 0) !== bootPercent('parse', 1),
    'NEGATIVE CONTROL: the old mapping gave the parse phase ONE position for every fraction, which is why the bar sat still through it');
}

// ---------------------------------------------------------------- 2. the words
console.log('\n== 2. the bar says what it is doing, in words that change ==');
{
  check(/^Downloading data 42%$/.test(bootLabel('download', 0.42)), `the download label carries its own number (${bootLabel('download', 0.42)})`);
  check(/^Reading the call files 42%$/.test(bootLabel('parse', 0.42)), `and so does the parse - a DIFFERENT sentence, because it is different work (${bootLabel('parse', 0.42)})`);
  check(bootLabel('parse', 0) !== bootLabel('parse', 1), 'the sentence changes as the phase progresses, so a frozen label means frozen work');
  check(bootLabel('download', 0.004) === 'Downloading data 0%' && bootLabel('download', 0.999) === 'Downloading data 100%',
    'the rounding is the caller-visible percent: 0.4% reads 0 and 99.9% reads 100');
  // THE STEP LABELS NAME THE WORK, and they are distinct - a bar that said the same word for four steps would be the
  // "Initialising" the report was about, spread out.
  check(BUILD_STEPS.length >= 3, `there are ${BUILD_STEPS.length} named build steps`);
  check(new Set(BUILD_STEPS.map((s) => s.text)).size === BUILD_STEPS.length, 'every step label is distinct');
  check(BUILD_STEPS.every((s) => s.text.length > 8 && /…$/.test(s.text)),
    'each one is a sentence that ends in an ellipsis, because the work is still in progress');
  check(BUILD_STEPS.some((s) => /sequencer/i.test(s.text)),
    'and the biggest step is NAMED as the sequencer, which is the 3.1 second block the report saw as dead air');
  // NEGATIVE CONTROL: the one word the old bar used for everything after the download.
  check(BUILD_STEPS.every((s) => s.text !== 'Initialising'),
    'NEGATIVE CONTROL: no step falls back to "Initialising" - the label the report was about');
}

// ---------------------------------------------------------------- 3. the plumbing
console.log('\n== 3. the panel and the loader use it, read from source ==');
{
  const main = readSource('src/main.ts');
  const data = readSource('src/data.ts');
  const html = readSource('index.html');
  const css = readSource('src/style.css');

  check(/import \{ BUILD_STEPS, bootLabel, bootPercent, type BootStep, type BootPhase \} from '\.\/boot-progress';/.test(main),
    '`main.ts` imports the rule rather than keeping a private copy of the split or the wording');
  check(!/frac \* 0\.7/.test(main) && !/0\.7 \+ frac \* 0\.3/.test(main),
    'and the old 70/30 arithmetic is GONE rather than left beside the new mapping');
  check(/function updateLoading\(phase: BootPhase, frac: number\): void \{\n  paintLoading\(bootPercent\(phase, frac\), bootLabel\(phase, frac\)\);/.test(main),
    'the loader\'s reports go through the rule, one call for the position and the sentence');
  check(/async function buildStep<T>\(step: BootStep, run: \(\) => T\): Promise<T> \{\n  paintLoading\(step\.percent, step\.text\);\n  if \(loadingSweep\) loadingSweep\.hidden = false;\n  await new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)\);\n  return run\(\);\n\}/.test(main),
    'and every build step PAINTS FIRST, turns the sweep on, and YIELDS A FRAME before the work - a paint batched with the work it announces is not a paint');
  // EACH STEP IS WRAPPED, and the four `await buildStep` calls are the four steps: a step left unwrapped is a silent
  // stretch, which is the whole defect.
  const wrapped = (main.match(/await buildStep\(BUILD_STEPS\[/g) || []).length;
  check(wrapped === BUILD_STEPS.length, `every declared step is actually run through \`buildStep\` (${wrapped} of ${BUILD_STEPS.length})`);
  check(/const seqUi = await buildStep\(BUILD_STEPS\[0\], \(\) => initSequencer\(stage\)\);/.test(main),
    'the sequencer - the 3.1 second block - is the first wrapped step');
  check(/const browser = await buildStep\(BUILD_STEPS\[1\], \(\) => new CallBrowser/.test(main) &&
    /const editorUi = await buildStep\(BUILD_STEPS\[2\], \(\) => initEditor/.test(main) &&
    /const resumed = await buildStep\(BUILD_STEPS\[3\], \(\) => rememberLastSession\(\)\)/.test(main),
    'and the browse list, the editor and the session restore follow it in order');
  check(/paintLoading\(100, 'Ready'\)/.test(main),
    '100 is painted in `finishLoading`, once every panel above it has been built');
  const hundreds = (main.match(/paintLoading\(100/g) || []).length;
  check(hundreds === 1, `and NOWHERE ELSE: the bar claimed to be finished while a third of the startup was still to come (${hundreds} writer(s) of 100)`);

  // THE LOADER: the parse reports per chunk and yields, or the ticks are batched into one and the bar never paints mid-walk.
  check(/onProgress\?\.\('parse', \(i \+ CHUNK\) \/ entries\.length\);/.test(data),
    '`data.ts` reports the parse fraction of each CHUNK, not one tick at the end');
  check(/await new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)\);\n        \}/.test(data),
    'and yields a frame after each chunk, so the report reaches the screen');
  check(/const CHUNK = \d+;/.test(data), 'the chunk size is a named constant rather than a literal in the loop');

  // THE START: markup + a compositor animation, because no JavaScript can run before the module graph has loaded.
  check(/<div id="loadingSweep" class="loading-sweep"><\/div>/.test(html),
    'the markup carries the sweep element the start needs');
  check(/<div id="loadingLabel" class="loading-label">Starting&hellip;<\/div>/.test(html),
    'and the first sentence is "Starting", not "Loading", which says nothing about what is happening');
  check(/\.loading-sweep \{[^}]*animation: loading-sweep 1\.1s ease-in-out infinite;/.test(css) &&
    /@keyframes loading-sweep \{\n  from \{ transform: translateX\(-100%\); \}/.test(css),
    'and the sweep animates a TRANSFORM, which the compositor keeps running while the main thread is blocked');
  check(!/\.loading-fill\.indeterminate/.test(css),
    'the fill is NOT put into an animated state of its own: its width is the real percentage, and the sweep is an overlay');

  // NEGATIVE CONTROLS: the two reverts that would restore the reported behaviour.
  const noYield = main.replace(/  await new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)\);\n/, '');
  check(noYield !== main && !/async function buildStep<T>\(step: BootStep, run: \(\) => T\): Promise<T> \{\n  paintLoading\(step\.percent, step\.text\);\n  if \(loadingSweep\) loadingSweep\.hidden = false;\n  await new Promise/.test(noYield),
    'dropping the frame yield fails the step check');
  const oneTick = data.replace(/onProgress\?\.\('parse', \(i \+ CHUNK\) \/ entries\.length\);/, "onProgress?.('parse', 1);");
  check(oneTick !== data && !/onProgress\?\.\('parse', \(i \+ CHUNK\)/.test(oneTick),
    'and going back to one tick at the end fails the parse check');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
