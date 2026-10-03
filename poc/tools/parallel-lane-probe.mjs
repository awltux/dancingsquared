// Probe: the "+ Parallel call" flow builds a LANE - several calls for one group in the same time slot.
//
// Asked for as: "how difficult would it be to allow multiple calls in a parallel set. If heads take 16 beats
// to do one call, the sides could do two 4-beat calls."
//
// THE ENGINE HALF IS PINNED ELSEWHERE (`engine/test/parallel-calls.mjs` section 8 measures the beats, the
// per-lane boards, the early lane holding and the refusals). What cannot be executed here is the PANEL: the
// picker decides what the remainder is offered, the lane grows by one call per Apply, and the beat balance
// the caller steers by is a sentence in the status line. `sequencer-ui.ts` is TypeScript inside Vite, so -
// like `escape-probe.mjs` and `facing-handle-probe.mjs` - this reads the source and checks the wiring.
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
const bodyOf = (header) => {
  const i = ui.indexOf(header);
  if (i < 0) return '';
  const j = ui.indexOf('\n  }', i);
  return ui.slice(i, j);
};

console.log('== the mode carries a LANE, not one pending call ==');
{
  check(/remaining: string;\s*\n\s*calls: \{ selection: string; call: string \}\[\];/.test(ui),
    'the parallel mode holds the calls the remainder has been given SO FAR, not a single pending partner');
  check(/advances by one call each time the caller/.test(ui),
    'and its board is documented as the board the LANE\'S NEXT CALL starts on');
  const entry = bodyOf('const remaining = who ? this.seq.remainingSelection(from, who) : null;');
  check(/calls: \[\],/.test(entry), 'entering the mode starts an EMPTY lane (the first Apply makes it one call)');
}

console.log('\n== Apply APPENDS to the lane, and a refusal keeps the mode ==');
{
  const apply = bodyOf('private applyParallel()');
  check(/const lane = \[\.\.\.p\.calls, \{ selection: p\.remaining, call: second \}\];/.test(apply),
    'the picked call is appended to the lane so far');
  check(/groups: \[p\.first, \{ selection: p\.remaining, calls: lane\.map\(\(c\) => c\.call\) \}\]/.test(apply),
    'and the step is rebuilt as one group with a CALLS list - the engine\'s lane form');
  check(/this\.parallel = p;/.test(apply) && !/this\.parallel = null;/.test(apply),
    'a refused lane keeps the mode on, so the caller picks a different call instead of starting again');
  const laneRun = /const laneRun = applied\.lanes\?\.find\(\(l\) => l\.selection === p\.remaining\)/.test(apply);
  check(laneRun && /this\.parallel = \{ \.\.\.p, board: nextBoard, calls: lane \};/.test(apply),
    'a successful one advances the mode\'s board from the APPLY\'s own report (`ApplyResult.lanes`), not by re-applying the lane');
  check(/const on = i === 0 \? p\.board : laneRun\?\.boards\[i\] \?\? p\.board;/.test(apply),
    'and the beat balance is read per call, against the board each call starts on');
  // THE STEP IS CHECKED ONCE, ON THE BOARD IT STARTS FROM. `replayHistory` has already put the live board
  // past the step, so applying it there applies it TWICE - harmless for a single pair and fatal as soon as a
  // lane can be built: MEASURED in the browser, appending `Touch a Quarter` to `… while All Except Heads
  // Trade` was refused with the HEADS' own call failing from a board the heads had left.
  check(/const applied = this\.seq\.applyToBoard\(p\.start, step\);/.test(apply) && !/this\.seq\.applyStep\(step\)/.test(ui),
    'the composed step is checked on the board it starts from, and never applied a second time on the replayed board');
  check(/back\[p\.index\] = p\.calls\.length > 0[\s\S]{0,120}?groups: \[p\.first, \{ selection: p\.remaining, calls: p\.calls\.map\(\(c\) => c\.call\) \}\]/.test(apply),
    'and a REFUSED append puts the LANE back as it was, rather than collapsing the step to the bare first call');
}

console.log('\n== the caller can SEE the balance, which is the point of the feature ==');
{
  const apply = bodyOf('private applyParallel()');
  check(/= \$\{laneBeats\} of \$\{firstBeats\} beats/.test(apply),
    'the status line says how many of the partner\'s beats the lane fills');
  check(/beats standing; Apply again to fill it, or press "\+ Parallel call" to finish/.test(apply),
    'and, when the lane is short, that the rest stands still and how to add to it');
  check(/the lane is \$\{laneBeats - firstBeats\} beats LONGER/.test(apply),
    'while a lane longer than its partner says which call stands for the difference - the engine does not silently trim it');
}

console.log('\n== the button seeds the picker, then FINISHES the step ==');
{
  // The one action that used to be missing once Apply stopped clearing the mode.
  check(/if \(this\.parallel\.calls\.length > 0\) \{[\s\S]{0,400}?this\.exitParallel\(/.test(ui),
    'pressing "+ Parallel call" again finishes the step and leaves the mode (it is the Done the lane needs)');
  check(/this\.parallelBtn\.title = this\.parallel[\s\S]{0,900}?Apply again adds a second call to the same lane/.test(ui),
    'and the button says so, including that a second Apply adds to the same lane');
  const picker = bodyOf('private refreshCallSelect()');
  check(/const group = this\.parallel \? this\.parallel\.remaining : this\.chosenGroup\(\)/.test(picker),
    'the picker still narrows to the remainder');
  check(/const on = this\.parallel \? this\.parallel\.board : this\.seq\.board;/.test(picker),
    'and asks `groupCanPerform` on the mode\'s board - which the lane advances - so call 2 is offered only where its lane has left the group');
}

console.log('\n== the single-call path is unchanged ==');
{
  // The regression guard: Apply once and finish must still compose exactly the pair the old flow built.
  const apply = bodyOf('private applyParallel()');
  check(/const step: ModuleStep = \{ groups: \[p\.first, \{ selection: p\.remaining, calls: lane\.map\(\(c\) => c\.call\) \}\] \};/.test(apply),
    'one call in the lane builds a one-call lane, which is the same step as the single `call` form (the engine reads both)');
  check(/withStep\[p\.index\] = step;/.test(apply),
    'the pair still REPLACES the first call\'s history entry, so Undo removes both and the list shows one row');
  check(/: `\$\{p\.first\.selection\} \$\{p\.first\.call\}`;/.test(apply),
    'and the restore for a lane that has no calls yet is still the bare `"<group> <call>"` string, exactly as before');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
