// GROWING AND SHRINKING THE SET: THE TWO CLONE-ONLY BUTTONS, AND WHAT THEY MUST KEEP WORKING.
//
// Reported: "The dancer add and remove no longer seems to work. It was working. Perhaps a test needs to be
// added to prevent subsequent changes disabling it."
//
// IT WORKS, AND THIS FILE IS THE TEST. Driven in a real browser at the time of writing: Clone revealed the
// Set row; `+ dancer` took `_Finish Line of 6 Half Tag` from 6 dancers to 7 and reported "added dancer 7,
// copied from dancer 1 ... the set now holds 7"; the Start and End pickers came back DISABLED with "no named
// 7-dancer formation is in the corpus, so this call cannot be re-based onto one"; Revert then read "1 of up
// to 50 steps available". `- selected` took it back to 6, the pickers came back with "Compact Wave of 6",
// and Revert read "2 of up to 50 steps" - so each press is ONE undo step. `- selected` with nothing selected
// changed nothing, which is the refusal, not a silent failure.
//
// SO WHAT THIS GATES. Three things can take the feature away without touching either handler:
//
//   1. THE ROW IS CLONE-ONLY. `renderCloneChrome` un-hides `edDancerCountRow` only while a clone is being
//      built, so a change to that ONE expression removes the whole feature from the panel while both
//      handlers stay perfectly correct. Section 2 pins the gate.
//   2. THE ENGINE HAS TO ACCEPT THE COUNT. `+ dancer` builds a bundle with a hand-made extra `DancerSpec`
//      and `- selected` builds one with dancers filtered out, and BOTH then go through `normalizeInstance`,
//      `instanceTable`, `instanceBeats` and the export. The corpus ships 2, 4, 6, 8, 12 and 16 dancers and
//      nothing else, so 3, 5, 7, 9, 11, 13, 14 and 15 are shapes NO SHIPPED CALL HAS - and that is where a
//      change elsewhere would surface as "the button does nothing". Section 3 measures every count.
//   3. THE COPY HAS TO BE DEEP. A `Seg` is keyed in a `WeakMap` for its copied end point, so a new dancer
//      sharing the donor's segments would share every clipboard entry with it. Section 4 pins it.
//
// Run: node tools/dancer-count-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const movesXml = fs.readFileSync(path.join(POC_DIR, '../assets/moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(POC_DIR, '../assets/formations.xml'), 'utf8');
const uiSrc = fs.readFileSync(path.join(POC_DIR, 'src/editor-ui.ts'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(POC_DIR, 'src/style.css'), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const load = (file) =>
  engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(POC_DIR, '../assets', file), 'utf8'), movesXml, formationsXml, 0));

// ------------------------------------------------------------------ 1. the wiring
console.log('== 1. both buttons exist, are wired, and are guarded the same way ==');
check(/<button id="edDancerAdd"/.test(htmlSrc), 'index.html carries the `+ dancer` button');
check(/<button id="edDancerRemove"/.test(htmlSrc), 'and the `- selected` button');
check(/<div class="row" id="edDancerCountRow" hidden>/.test(htmlSrc),
  'inside a row of their own, `hidden` in the markup as the pre-script default only');
check(/this\.dancerAddBtn\.addEventListener\('click', \(\) => this\.addInstanceDancer\(\)\);/.test(uiSrc),
  'and `+ dancer` is wired to `addInstanceDancer`');
check(/this\.dancerRemoveBtn\.addEventListener\('click', \(\) => this\.removeInstanceDancers\(\)\);/.test(uiSrc),
  'and `- selected` to `removeInstanceDancers`');
check(/private dancerCountRowEl = el<HTMLDivElement>\('edDancerCountRow'\);/.test(uiSrc),
  'the controller holds the row, so it can be shown and hidden');

// ------------------------------------------------------------------ 2. the clone-only gate, as the caller SEES it
console.log('\n== 2. the ONE expression that decides whether the buttons can do anything ==');
check(/const cloning = this\.asClone && this\.isInstanceMode\(\);/.test(uiSrc),
  '`renderCloneChrome` derives "cloning" from the clone flag AND the editor mode');
check(/this\.dancerAddBtn\.disabled = !cloning;/.test(uiSrc) && /this\.dancerRemoveBtn\.disabled = !cloning;/.test(uiSrc),
  'and BOTH size buttons are DISABLED unless a clone is being built - that flag is the whole gate');
// A GREYED CONTROL STILL HAS TO LOOK GREYED, and it did not: `:hover` MATCHES A DISABLED BUTTON - CSS will
// style one, it is only the pointer EVENTS that stop - so `#hud button:hover`'s accent border lit these up
// GREEN under the pointer while they did nothing, which reads as live.
check(/#editorPanel button:disabled:hover \{ border-color: #2a3542; \}/.test(cssSrc),
  'the accent hover is NEUTRALISED for a disabled panel button, so a greyed control cannot light up green');
check(/#editorPanel button:disabled \{ opacity: 0\.4; cursor: not-allowed; \}/.test(cssSrc),
  'and it dims with a not-allowed cursor - the treatment the panel already gives its disabled clip and tab groups');
// THE ROW WAS ONCE HIDDEN INSTEAD, and that is what this file was written for: the feature was working the
// whole time and there was nothing on screen to say it was clone-only, so its absence read as breakage.
check(/this\.dancerCountRowEl\.hidden = false;/.test(uiSrc) && !/this\.dancerCountRowEl\.hidden = !cloning;/.test(uiSrc),
  'the ROW is no longer hidden for it - a control that is absent cannot explain itself');
check(/const SIZE_LOCKED_TITLE =/.test(uiSrc),
  'the explanation is a named message rather than a sentence in the middle of the render');
check(/this\.dancerAddBtn\.title = cloning \? this\.dancerAddTitle : SIZE_LOCKED_TITLE;/.test(uiSrc) &&
  /this\.dancerRemoveBtn\.title = cloning \? this\.dancerRemoveTitle : SIZE_LOCKED_TITLE;/.test(uiSrc),
  'and it is swapped in on hover: the locked message while greyed, the markup\'s own wording while live');
check(/if \(!this\.dancerAddTitle\) this\.dancerAddTitle = this\.dancerAddBtn\.title;/.test(uiSrc) &&
  /if \(!this\.dancerRemoveTitle\) this\.dancerRemoveTitle = this\.dancerRemoveBtn\.title;/.test(uiSrc),
  'the live wording is captured OFF THE MARKUP before it can be overwritten, so it survives every pass');
check(/Only a CLONE can have dancers added or removed/.test(uiSrc),
  'and the locked message states the RULE rather than merely refusing');
check(/private addInstanceDancer\(\) \{[\s\S]{0,200}?if \(!call \|\| !this\.asClone\) return;/.test(uiSrc),
  '`addInstanceDancer` still refuses outside a clone, so the greyed button is not the only guard');
check(/private removeInstanceDancers\(\) \{[\s\S]{0,200}?if \(!call \|\| !this\.asClone\) return;/.test(uiSrc),
  'and so does `removeInstanceDancers`');
check(/const MAX_DANCERS = 16;/.test(uiSrc) && /const MIN_DANCERS = 2;/.test(uiSrc),
  'the bounds are 2 and 16, named once');
check(/call\.dancers\.length >= MAX_DANCERS/.test(uiSrc) && /this\.refusal\(/.test(uiSrc),
  'and the ceiling is refused OUT LOUD rather than being a disabled button');
check(/remaining < MIN_DANCERS/.test(uiSrc),
  'and the floor of two is refused with the numbers, for the same reason');
check(/this\.ensureStartFormations\(next\.dancers\.length\);/.test(uiSrc),
  'BOTH handlers rebuild the Start/End pickers for the count that is now on screen');

// ------------------------------------------------------------------ 3. every count the buttons can reach
console.log('\n== 3. the engine, at every count the two buttons can reach (2..16) ==');
const base = load('ms/arm_turns.xml');
const counts = [];
{
  // The ADD, exactly as `addInstanceDancer` builds it: a hand-made deep copy of the donor. It starts from the
  // SMALLEST set the floor allows and grows to the ceiling, so every count between the two bounds is covered
  // rather than only the ones a shipped call happens to have.
  let call = { ...base, dancers: base.dancers.slice(0, 2) };
  for (let target = 2; target <= 16; target++) {
    while (call.dancers.length < target) {
      const donor = call.dancers[call.dancers.length - 1];
      const copy = {
        ...donor,
        path: donor.path.map((s) => ({ ...s, translate: { ...s.translate }, rotate: s.rotate ? { ...s.rotate } : null })),
      };
      call = { ...call, dancers: [...call.dancers, copy] };
    }
    try {
      const n = engine.normalizeInstance(call);
      const rows = engine.instanceTable(n);
      const beats = engine.instanceBeats(n);
      const xml = engine.callToXml(n, n.from);
      counts.push({ n: call.dancers.length, rows: rows.length, beats, xml: xml.length });
    } catch (e) {
      counts.push({ n: call.dancers.length, error: e.message });
    }
  }
}
const bad = counts.filter((c) => c.error || c.rows !== c.n || !(c.beats > 0) || !(c.xml > 0));
check(counts.length === 15 && counts[0].n === 2 && counts[14].n === 16,
  `the add was exercised at every count from 2 to 16 (${counts.length} counts)`);
check(bad.length === 0, `every one of them normalizes, tables, times and exports${bad.length ? ` - broken: ${JSON.stringify(bad)}` : ''}`);

// The REMOVE, exactly as `removeInstanceDancers` builds it: filter the selection out.
const removals = [];
for (let keep = 2; keep <= base.dancers.length; keep++) {
  const selected = base.dancers.map((_, i) => i).slice(keep);
  const next = { ...base, dancers: base.dancers.filter((_, i) => !selected.includes(i)) };
  try {
    const n = engine.normalizeInstance(next);
    removals.push({ n: n.dancers.length, rows: engine.instanceTable(n).length, xml: engine.callToXml(n, n.from).length });
  } catch (e) {
    removals.push({ n: next.dancers.length, error: e.message });
  }
}
check(removals.length === 7, `the remove was exercised down to two (${removals.map((r) => r.n).join(', ')})`);
check(removals.every((r) => !r.error && r.rows === r.n && r.xml > 0), 'and every count it can leave behind survives too');

// The picker, which `ensureStartFormations` rebuilds on both paths. An EMPTY list is a valid answer, and the
// panel says why: the counts it is empty for are exactly the ones no shipped call has.
{
  const parsed = engine.parseFormations(formationsXml);
  const sizes = [];
  for (let n = 2; n <= 16; n++) {
    const names = new Set();
    for (const [name, ds] of parsed) {
      const poses = ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * (Math.PI / 180), gender: d.gender }));
      const mirror = poses.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender }));
      const merged = poses.concat(mirror);
      const stacked = merged.some((a, i) => merged.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < 0.01));
      const whole = stacked ? poses : merged;
      if (whole.length === n) names.add(engine.canonicalName(name));
    }
    sizes.push({ n, list: names.size });
  }
  const withList = sizes.filter((s) => s.list > 0).map((s) => s.n);
  const empty = sizes.filter((s) => s.list === 0).map((s) => s.n);
  console.log(`    counts with a formation to offer: ${withList.join(', ')}`);
  console.log(`    counts with NONE (the picker must disable and say so): ${empty.join(', ')}`);
  check(withList.includes(6) && withList.includes(4) && withList.includes(12),
    'the counts a clone is most likely to land on DO have formations to offer');
  check(empty.includes(7) && empty.length > 0,
    `and the counts that do not are a non-empty set the panel has a message for (${empty.join(', ')})`);
  check(/this\.startFormationSel\.disabled = none;/.test(uiSrc) && /no named \$\{dancers\}-dancer formation is in the corpus/.test(uiSrc),
    'which `ensureStartFormations` handles by disabling the picker and putting the reason in its tooltip');
}

// ------------------------------------------------------------------ 4. the copy is deep
console.log('\n== 4. the new dancer gets its OWN segments, or it shares every copied end point ==');
{
  const donor = base.dancers[0];
  const copy = {
    ...donor,
    path: donor.path.map((s) => ({ ...s, translate: { ...s.translate }, rotate: s.rotate ? { ...s.rotate } : null })),
  };
  const sharesSeg = copy.path.some((s, i) => s === donor.path[i]);
  const sharesTranslate = copy.path.some((s, i) => s.translate === donor.path[i].translate);
  const sharesRotate = copy.path.some((s, i) => s.rotate && s.rotate === donor.path[i].rotate);
  check(!sharesSeg && !sharesTranslate && !sharesRotate,
    'no segment, translate or rotate object is shared with the donor');
  // AND THE MIRROR OF THAT CLAIM: mutating the copy must not reach the donor.
  copy.path[0].translate.cx1 = 99;
  check(donor.path[0].translate.cx1 !== 99, 'so writing to the new dancer leaves the donor alone');
  check(/path: donor\.path\.map\(\(s\) => \(\{ \.\.\.s, translate: \{ \.\.\.s\.translate \}, rotate: s\.rotate \? \{ \.\.\.s\.rotate \} : null \}\)\)/.test(uiSrc),
    'and that is the deep copy `addInstanceDancer` actually performs');
}

// ------------------------------------------------------------------ 5. and it fails on the faults it guards
console.log('\n== 5. the checks fail on the faults they were written for ==');
{
  const notGreyed = uiSrc.replace('this.dancerAddBtn.disabled = !cloning;', 'this.dancerAddBtn.disabled = false;');
  check(notGreyed !== uiSrc && !/this\.dancerAddBtn\.disabled = !cloning;/.test(notGreyed),
    'leaving the size buttons live outside a clone fails the gate that notices');
  const reHidden = uiSrc.replace('this.dancerCountRowEl.hidden = false;', 'this.dancerCountRowEl.hidden = !cloning;');
  check(reHidden !== uiSrc && !/this\.dancerCountRowEl\.hidden = false;/.test(reHidden),
    'and going back to HIDING the row - the fault that was reported as "it no longer works" - fails the check that it stays on screen');
  const noReason = uiSrc.replace(/const SIZE_LOCKED_TITLE =[\s\S]*?Press Clone above to start one\.';/, 'const SIZE_LOCKED_TITLE = \'\';');
  check(noReason !== uiSrc && !/Only a CLONE can have dancers added or removed/.test(noReason),
    'an empty locked message - a greyed button with nothing to say - fails too');
  const stillGreen = cssSrc.replace(
    '#editorPanel button:disabled:hover { border-color: #2a3542; }',
    '#editorPanel button:disabled:hover { border-color: var(--accent); }',
  );
  check(stillGreen !== cssSrc && !/#editorPanel button:disabled:hover \{ border-color: #2a3542; \}/.test(stillGreen),
    "and letting the accent back onto a disabled button's hover - the green outline that was reported - fails the check that stops it");
  const noCapture = uiSrc.replace('if (!this.dancerAddTitle) this.dancerAddTitle = this.dancerAddBtn.title;', '');
  check(noCapture !== uiSrc && !/if \(!this\.dancerAddTitle\)/.test(noCapture),
    'and without the capture the locked tooltip would overwrite the live one for good, which also fails');
  const shallow = uiSrc.replace(
    'path: donor.path.map((s) => ({ ...s, translate: { ...s.translate }, rotate: s.rotate ? { ...s.rotate } : null })),',
    'path: donor.path,',
  );
  check(shallow !== uiSrc && !/path: donor\.path\.map/.test(shallow),
    'sharing the donor\'s path instead of copying it fails the deep-copy check');
  const noRebuild = uiSrc.replace(/this\.ensureStartFormations\(next\.dancers\.length\);/g, '');
  check(noRebuild !== uiSrc && !/this\.ensureStartFormations\(next\.dancers\.length\);/.test(noRebuild),
    'dropping the picker rebuild from both handlers fails the check that both still rebuild it');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
