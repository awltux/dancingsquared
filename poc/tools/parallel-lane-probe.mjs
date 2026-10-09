// Probe: the "+ Parallel call" flow builds a FIGURE - lanes of calls for several groups in the same slot.
//
// Asked for as: "how difficult would it be to allow multiple calls in a parallel set. If heads take 16 beats
// to do one call, the sides could do two 4-beat calls." - and then, on the reported defect, "when I add a
// third call to a parallel call it doesnt seem to animate and it seem to be added to the call list as a new
// call. Display the parallel lines of the calls list using symbols '||' for parallel, '+' for sequential
// combine, brackets to indicate scope".
//
// THE ENGINE HALF IS PINNED ELSEWHERE (`engine/test/parallel-calls.mjs` section 8 measures the beats, the
// per-lane boards, the early lane holding and the refusals; `engine/test/modules.mjs` pins the LABEL the list
// shows). What cannot be executed here is the PANEL: the picker decides what a lane is offered, the lanes grow
// by one call per Apply, and the beat balance the caller steers by is a sentence in the status line.
// `sequencer-ui.ts` is TypeScript inside Vite, so - like `escape-probe.mjs` and `facing-handle-probe.mjs` -
// this reads the source and checks the wiring.
//
// Run: node poc/tools/parallel-lane-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const ui = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
const html = fs.readFileSync(path.join(POC, 'index.html'), 'utf8');
const bodyOf = (header) => {
  const i = ui.indexOf(header);
  if (i < 0) return '';
  const j = ui.indexOf('\n  }', i);
  return ui.slice(i, j);
};

console.log('== the mode carries LANES, not one group and one pending call ==');
{
  check(/groups: \{ selection: string; calls: string\[\] \}\[\];\s*\n\s*active: number;/.test(ui),
    'the parallel mode holds the lanes and which one Apply appends to');
  check(/A lane with\s*\n?\s*\*?\s*an empty `calls` is one the caller has just opened and not yet filled/.test(ui),
    'and documents that an empty lane is one that has been opened and not filled');
  const entry = bodyOf('const remaining = who ? this.seq.remainingSelection(from, who) : null;');
  check(/groups: \[[\s\S]{0,200}?\{ selection: remaining, calls: \[\] \},/.test(entry) && /active: 1,/.test(entry),
    'entering the mode starts the remainder\'s lane EMPTY, with the applied call as lane 0 and the remainder active');
}

console.log('\n== Apply APPENDS to the ACTIVE lane, and a refusal keeps the mode ==');
{
  const apply = bodyOf('private applyParallel()');
  check(/const calls = \[\.\.\.lane\.calls, second\];/.test(apply),
    'the picked call is appended to the active lane');
  check(/const groups = p\.groups\.map\(\(g, i\) => \(i === p\.active \? \{ \.\.\.g, calls \} : g\)\);/.test(apply),
    'and every OTHER lane is carried through untouched - a third group is a third lane, not a new entry in the list');
  check(/const applied = this\.seq\.applyToBoard\(p\.start, step\);/.test(apply) && !/this\.seq\.applyStep\(step\)/.test(ui),
    'the composed step is checked once, on the board it starts from, and never applied a second time on the replayed board');
  // THE STATE HAS ONE OWNER NOW (`setParallel`, which writes `this.parallel` and runs the chrome with it), so
  // the refused branch holds by asking WHO was written: the mode kept is `p` ITSELF, the entry handed in at
  // the top of Apply. `this.parallel = p;` here would fail the owner probe's one-writer count, and the
  // behaviour - a refused lane leaves the mode on - is what this has to go red on.
  check(/this\.setParallel\(p\);/.test(apply) && !/this\.setParallel\(null\)/.test(apply) && !/this\.parallel\s*=/.test(apply),
    'a refused lane keeps the mode on, so the caller picks a different call instead of starting again');
  check(/back\[p\.index\] = this\.parallelEntry\(p\);/.test(apply),
    'and a REFUSED append restores the step as it was, however many lanes it had');
  // The two statements are the SAME as before the refactor apart from the write itself, which now goes
  // through `setParallel` - so this still asserts the board's SOURCE (`applied.lanes`), not just the setter's
  // name: dropping `laneRun` and re-applying the lane reddens it exactly as it did.
  const laneRun = /const laneRun = applied\.lanes\?\.find\(\(l\) => l\.selection === lane\.selection\)/.test(apply);
  check(laneRun && /const nextBoard = laneRun\?\.boards\[laneRun\.boards\.length - 1\] \?\? p\.board;/.test(apply)
    && /this\.setParallel\(\{ \.\.\.p, groups, board: nextBoard \}\);/.test(apply),
    'a successful one advances the mode\'s board from the APPLY\'s own report (`ApplyResult.lanes`), not by re-applying the lane');
  check(/const on = i === 0 \? p\.board : laneRun\?\.boards\[i\] \?\? p\.board;/.test(apply),
    'and the beat balance is read per call, against the board each call starts on');
}

console.log('\n== "+ Parallel call" OPENS ANOTHER LANE, and Done is the way out ==');
{
  // THE REPORTED DEFECT: the button meant "finish" once a lane had a call, so a caller reaching for a third
  // parallel group had the figure end under them and their next call land as a NEW entry in the list.
  const handler = bodyOf('this.parallelBtn.addEventListener');
  check(/const groups = \[\.\.\.p\.groups, \{ selection: forLane, calls: \[\] \}\];/.test(handler),
    'the button opens a lane for the dancers no lane has claimed');
  // Re-pointed at the setter; the entry it is handed is the assertion - a fresh lane made active (the last
  // one) and boarded on `p.start` rather than on the active lane's advanced board.
  check(/this\.setParallel\(\{ \.\.\.p, groups, active: groups\.length - 1, board: p\.start \}\);/.test(handler),
    'which becomes the active lane, starting back on the board the STEP starts from - a lane begins at beat 0');
  check(!/exitParallel/.test(handler),
    'and it NEVER finishes the figure, which is what used to turn a third call into a new entry in the list');
  check(/private unassignedLane\(\)/.test(ui) && /claimed\.join\(' and '\)/.test(ui),
    'who is left is the complement of the UNION of every lane, which the selection grammar already subtracts');
  check(/private laneGroups\(\)/.test(ui) && /ids\.every\(\(id\) => leftIds\.has\(id\)\)/.test(ui),
    'the lane\'s group is chosen from the named groups that sit INSIDE the unclaimed dancers');
  check(/const choices = this\.laneGroups\(\);/.test(ui) && /const chosen = picked && choices\.includes\(picked\) \? picked : null;/.test(ui),
    'defaulting to all of them - the ordinary two-group figure - and narrowing only when the caller picks one');
  // AN EMPTY LANE IS NARROWED IN PLACE by the same press, which is the one thing that press can usefully do
  // when the lane it opened has no call yet: the lane starts as 'everyone unclaimed' and the caller says
  // 'this lane is only the Side Boys', which is exactly how the remainder is SPLIT between two lanes.
  check(/if \(chosen && chosen !== lane\.selection\) \{/.test(handler)
    && /groups\.map\(\(g, i\) => \(i === p\.active \? \{ \.\.\.g, selection: chosen \} : g\)\)/.test(handler),
    'and an empty open lane is narrowed in place, so the remainder can be split between two lanes');
  check(/IN PARALLEL MODE THE GROUP SELECTOR ANSWERS A DIFFERENT QUESTION: WHO THE NEXT LANE GETS/.test(ui)
    && /this\.groupSelect\.value = list\.includes\(prev\) \? prev : list\[0\] \?\? '';/.test(ui)
    && /const list = choices\.length \? choices : \[this\.activeLane\(\)\?\.selection \?\? ''\]\.filter\(Boolean\);/.test(ui),
    'and the group selector is rebuilt for the mode, so the choice is made in the control that already means "who" (falling back to the ACTIVE lane when no lane can be opened, so it is never empty)');
  check(/const left = this.unassignedLane\(\);/.test(handler) && /if \(!left\) \{/.test(handler),
    'and when every dancer has a lane the button says so instead of opening an empty one');
  const done = bodyOf('private finishParallel()');
  check(/this\.exitParallel\(/.test(done),
    'Done leaves the mode');
  check(/this\.parallelDoneBtn\.addEventListener\('click', \(\) => this\.finishParallel\(\)\);/.test(ui),
    'and the Done button is wired to it');
  check(/id="seqParallelDone"/.test(html),
    'the button exists in the panel');
}

console.log('\n== the caller can SEE the figure and its balance ==');
{
  const apply = bodyOf('private applyParallel()');
  check(/= \$\{laneBeats\} of \$\{total\} beats/.test(apply),
    'the status line says how many of the STEP\'s beats the lane fills');
  check(/they stand for the other \$\{total - laneBeats\}/.test(apply),
    'and, when the lane is short, that the rest stands still and how to add to it');
  check(/or While… for another group/.test(apply),
    'while the way to a further parallel group is named in the same sentence');
  check(/const total = this\.seq\.sequenceBeats\(\[step\], p\.start\);/.test(apply),
    'the step\'s own cost is read from the ENGINE, which is what makes the balance true for three or more lanes');
  // THE FIGURE IS ON SCREEN THE WHOLE TIME IT IS BEING BUILT: a banner naming the lanes and the open one, and
  // the composer's own hint line. Both read the mode's own state, so neither can describe a figure the panel
  // is not in.
  //
  // THE MODE'S VISIBILITY NOW HAS ONE OWNER: `applyParallelChrome` sets the banner's `hidden` and the panel
  // edge from `this.parallel`, and `renderFigureBar` keeps only the CONTENT (the lanes). So the visibility
  // half is asserted where it is written, and the naming half where the lanes still are.
  const bar = bodyOf('private renderFigureBar()');
  const chrome = bodyOf('private applyParallelChrome()');
  check(/this\.figureBarEl\.hidden = !p;/.test(chrome) && /groups/.test(bar) && /map\(\(g\) =>/.test(bar),
    'the figure banner is shown exactly while a figure is being built, and names every lane');
  check(/this\.hudEl\.classList\.toggle\('seq-figure', !!p\);/.test(chrome),
    'and the panel\'s edge carries the mode too, so it is visible from anywhere in the timeline');
  const info = bodyOf('private renderSubsetInfo()');
  check(/Figure: <b>\$\{esc\(stepLabel\(this\.parallelEntry\(this\.parallel\)\)\)\}<\/b>/.test(info),
    'the panel shows the whole figure by its label, so the lanes and their scope are visible while it is built');
  const picker = bodyOf('private refreshCallSelect()');
  check(/const group = this\.parallel \? this\.activeLane\(\)\?\.selection \?\? null : this\.chosenGroup\(\)/.test(picker),
    'the picker narrows to the ACTIVE lane');
  check(/const on = this\.parallel \? this\.parallel\.board : this\.seq\.board;/.test(picker),
    'and asks `groupCanPerform` on the mode\'s board - which the active lane advances - so call 2 is offered only where its lane has left the group');
}

// A FIGURE ROW RE-OPENS THE FIGURE, so its FREE BEATS can still be filled. Asked for as: "when I click on a
// parallel slot in the sequencer, reload the parallel system so I can add more calls to the free beats in the
// slot." Every way out of the mode clears `parallel`, so before this the row was only a seek.
console.log('\n== clicking a figure row re-opens it, on the lane with the most free beats ==');
{
  const resume = bodyOf('private resumeFigure(idx: number): boolean {');
  check(/if \(!step \|\| !isGroupStep\(step\)\) return false;/.test(resume),
    'only a GROUP step re-opens - a plain row is still just a seek');
  check(/const groups = step\.groups\.map\(\(g\) => \(\{ selection: g\.selection, calls: groupCalls\(g\) \}\)\);/.test(resume),
    'the lanes come from the step ITSELF, so the banner and the picker describe the figure that is really in the list');
  check(/const start = this\.seq\.startBoard\(\);/.test(resume)
    && /const applied = this\.seq\.applyToBoard\(start, step\);/.test(resume)
    && !/this\.seq\.applyStep\(step\)/.test(resume),
    'and it is re-applied PURELY on the board the step starts from, which is where `seekTo` has just left the live board');
  check(/if \(f\.free > bestFree\) \{ bestFree = f\.free; active = i; \}/.test(resume),
    'the ACTIVE lane is the one with the most free beats - which is what was clicked for');
  // Re-pointed at the setter; what it is handed is still the apply's own last board for that lane.
  check(/this\.setParallel\(\{[\s\S]{0,120}?board: run\?\.boards\[run\.boards\.length - 1\] \?\? start,/.test(resume),
    'and the mode is rebuilt with the apply\'s own board for that lane, exactly as an append does');
  check(/this\.render\(\);\s*\n\s*this\.refreshCallSelect\(\);\s*\n\s*this\.setStatus\(/.test(resume),
    'it paints before it speaks, so the message keeps the colour it was given');
  const activate = bodyOf('private activateStep(idx: number) {');
  check(/this\.selectedStep = idx;/.test(activate) && /this\.seekTo\(idx\);/.test(activate)
    && /if \(!this\.resumeFigure\(idx\) && this\.parallel\) \{/.test(activate),
    'the row action seeks and then re-opens, and clears the mode when the row is not a figure');
  check(/if \(row\?\.dataset\.idx != null\) this\.activateStep\(Number\(row\.dataset\.idx\)\);/.test(ui)
    && /if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); this\.activateStep\(idx\); \}/.test(ui),
    'both the click and Enter/Space go through it, so the mouse and the keyboard cannot disagree');
  check(/seq-fig-mark/.test(ui) && /Click to re-open this figure and add calls to its free beats/.test(ui),
    'and a figure row is MARKED, because it is the one row whose click does more than seek');
  // THE FILL IS ONE FUNCTION, so the banner, the resume message and the status line cannot disagree.
  const fill = bodyOf('private laneFill(');
  check(/const applied = this\.seq\.applyToBoard\(p\.start, step\);/.test(fill)
    && /free: Math\.max\(0, total - beats\)/.test(fill),
    'the per-lane fill is read from the engine (its own apply, plus per-call `stepBeats`), not estimated');
  check(/const fill = this\.laneFill\(p\);/.test(ui) && /seq-fig-fill/.test(ui),
    'and the figure banner shows each lane\'s beats and free time beside the lane they belong to');
}

console.log('\n== the step forms are the engine\'s, and the single-call path is unchanged ==');
{
  const step = bodyOf('private parallelStep(');
  check(/g\.calls\.length > 1[\s\S]{0,120}?\{ selection: g\.selection, calls: \[\.\.\.g\.calls\] \}/.test(step),
    'a lane of several calls uses the engine\'s CALLS list form');
  check(/\{ selection: g\.selection, call: g\.calls\[0\] \}/.test(step),
    'and a lane of one uses the plain `{selection, call}` form - the same step the old single-pair flow built');
  const entry = bodyOf('private parallelEntry(');
  check(/if \(lanes\.length === 1\) return `\$\{lanes\[0\]\.selection\} \$\{lanes\[0\]\.calls\[0\]\}`;/.test(entry),
    'a one-lane figure is still the bare `"<group> <call>"` string, exactly as before');
  check(/back\[p\.index\] = this\.parallelEntry\(p\)/.test(bodyOf('private applyParallel()')) && /withStep\[p\.index\] = step;/.test(bodyOf('private applyParallel()')),
    'the figure REPLACES its history entry, so Undo removes the whole thing and the list shows one row');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
