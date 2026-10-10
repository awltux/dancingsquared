// Probe: `While…` IS LIVE WHENEVER THERE IS A LANE TO OPEN, and that is a REMAINDER - never the mode flag.
//
// REPORTED: "Clear the sequencer, select Heads, `Promenade 3/4 to Home`, Add to Sequence. Enters While mode.
// Press 'Finish figure'. Select the newly created sequence slot. I want to add a new call for the sides so I
// press While button, but it doesn't seem to do anything. Adding a call ends up in the next slot."
//
// DRIVEN IN A BROWSER at commit `41ba359`, from the built `poc/dist`: at the end of step 3 (inside the figure)
// the accessibility tree reads
//   `button "All Except Heads left — pick their call ..."` - NO disabled marker;
// and at step 6 (after `Finish figure` and clicking the row it left) the same button reads
//   `button "Give the dancers the current call did NOT move their own call ..." [disabled]`.
// The panel's `Finish figure` and its timeline-row click both clear `this.parallel`, so an enable condition of
// `!p` kills the one control that can start the other group - the press is a no-op and the next `Add` lands in
// the NEXT SLOT, which is the second half of the report.
//
// WHAT THE ENABLE CONDITION HAS TO BE, and each part is a check below:
//
//   - it is TRUE while a figure is open (the press adds another lane) AND TRUE while no figure is open but the
//     SELECTED step's own call left dancers unclaimed (the press opens that figure's first lane) - so it is
//     NOT the mode flag `!p`;
//   - IT IS THE HANDLER'S OWN REMAINDER, `unassignedLane()`, and not a second copy of the arithmetic: the
//     press consumes that reading and the button is painted from it. A condition computed differently from
//     the code behind it is the drift `41ba359` removed, and a condition that re-derives the remainder here is
//     that drift coming back;
//   - the remainder has to be answerable with no figure open, which is why `unassignedLane()` and
//     `unclaimedIds()` read `figureForWhile()` - the open figure, or the one the selected step still
//     describes - instead of `this.parallel`;
//   - `Finish figure` is the OTHER way round and keeps `!p`: it ends a figure, so it is live only while one is
//     being built.
//
// WHY THIS PROBE READS SOURCE. `sequencer-ui.ts` builds DOM against a live `#hud` and cannot run under plain
// node - the same limit `parallel-owner-probe.mjs`, `parallel-lane-probe.mjs`, `subset-highlight-probe.mjs` and
// `sequencer-busy-probe.mjs` record. So the wiring is read from the source; the BROWSER evidence above is what
// says the wiring is the whole of the defect, and it is quoted rather than re-run here.
//
// PINS WIRING ONLY. The checks below are text and counts; they say WHICH expression is written and WHERE, and
// cannot see whether the button is grey on screen. That observation was made by hand in a browser against
// `poc/dist` at `41ba359` and is the report quoted in the header, not a check this probe runs.
//
// Run: node poc/tools/parallel-while-enable-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
/** The app's TypeScript is checked in with CRLF, so a multi-line literal match has to normalise first. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

const ui = readSource('src/sequencer-ui.ts');

/** The body of a class member, from its declaration to its own closing brace at the class-member indent. */
const bodyOf = (s, decl) => {
  const i = s.indexOf(decl);
  if (i < 0) return '';
  const j = s.indexOf('\n  }', i);
  return j < 0 ? '' : s.slice(i, j);
};

// THE READINGS THE CHECKS AND THE NEGATIVE CONTROLS BOTH USE, so a mutant is judged by the same rule the
// shipped file is - a control that re-implements the predicate proves nothing about the predicate.
const chrome = 'private applyParallelChrome() {';
const handlerDecl = 'this.parallelBtn.addEventListener';
/** The `While…` enable condition, as written. */
const enableExpr = (s) => {
  const m = /this\.parallelBtn\.disabled = ([^;]+);/.exec(bodyOf(s, chrome));
  return m ? m[1].trim() : '';
};
/** How many places assign `parallelBtn.disabled` at all - the owner probe pins 5 chrome writes, this pins ONE. */
const whileWriters = (s) => (s.match(/this\.parallelBtn\.disabled\s*=/g) ?? []).length;
/** The reopen block of the click handler, from `if (!this.parallel)` to the end of the handler. */
const reopenBlock = (s) => {
  const h = bodyOf(s, handlerDecl);
  const i = h.indexOf('if (!this.parallel) {');
  return i < 0 ? '' : h.slice(i);
};
/** What the reopen's message reads its group FROM - the first `const left =` in the reopen block. */
const reopenLeft = (s) => {
  const m = /const left = ([^;]+);/.exec(reopenBlock(s));
  return m ? m[1].trim() : '';
};

// ------------------------------------------------------------------ 1. the condition itself
console.log('== 1. `While…` is enabled from a REMAINDER, not from the mode flag ==');

check(enableExpr(ui) !== '', '`parallelBtn.disabled` is written in `applyParallelChrome`, the one chrome method');
check(enableExpr(ui) !== '!p',
  `the condition is NOT the bare mode flag, which dies when "Finish figure" clears the mode (found \`${enableExpr(ui)}\`)`);
check(/this\.unassignedLane\(\)/.test(enableExpr(ui)),
  'it asks for the REMAINDER, through the same `unassignedLane()` the press below consumes');
check(!/remainingSelection|unclaimedIds|selectionIds/.test(enableExpr(ui)),
  'and it does NOT re-derive that remainder inline - a second copy of the arithmetic is the drift this pins');
check(whileWriters(ui) === 1,
  `exactly ONE assignment to \`parallelBtn.disabled\` in the file (found ${whileWriters(ui)})`);
check(/this\.parallelDoneBtn\.disabled = !p;/.test(bodyOf(ui, chrome)),
  '`Finish figure` keeps `!p`: it ENDS a figure, so it is live only while one is being built');

// ------------------------------------------------------------------ 2. the remainder outlives the mode
console.log('\n== 2. the remainder is answerable with no figure open ==');

const un = bodyOf(ui, 'private unassignedLane(): string | null {');
const ids = bodyOf(ui, 'private unclaimedIds(p: ParallelEntry | null): number[] {');
check(/const p = this\.figureForWhile\(\);/.test(un) && !/const p = this\.parallel;/.test(un),
  '`unassignedLane` reads the figure `figureForWhile` names, not `this.parallel` - so it answers with none open');
check(/if \(!p \|\| this\.unclaimedIds\(p\)\.length === 0\) return null;/.test(un),
  'and null still means "no remainder": the emptiness is measured in IDS, not inferred from a selector');
check(ids !== '' && /const claimed = new Set<number>\(\);/.test(ids),
  '`unclaimedIds` takes the figure it is handed, so the candidate is not rebuilt for one answer');

const fig = bodyOf(ui, 'private figureForWhile(): ParallelEntry | null {');
check(/if \(this\.parallel\) return this\.parallel;/.test(fig),
  '`figureForWhile` returns the OPEN figure untouched, so nothing about a live figure moved');
check(/const step = this\.history\[this\.selectedStep\];/.test(fig),
  'and otherwise builds one from the SELECTED step in the timeline');
check(/isGroupStep\(step\)\) return null;/.test(fig),
  'a figure row is excluded - `resumeFigure` re-opens it from its own lanes');
check(/if \(!spec\.selection\) return null;/.test(fig),
  'a step that names nobody leaves no remainder, so it is not a candidate');
check(/const start = this\.seq\.startBoard\(\);/.test(fig)
  && /const remaining = this\.seq\.remainingSelection\(start, spec\.selection\);/.test(fig),
  'the remainder is the ENGINE\'s answer for the step\'s own start board, the same reading `applySelected` took');
check(/\{ selection: spec\.selection, calls: \[spec\.call\] \},/.test(fig)
  && /\{ selection: remaining, calls: \[\] \},/.test(fig)
  && /active: 1,/.test(fig) && /index: this\.selectedStep,/.test(fig),
  'the candidate is the entry `applySelected` builds: lane 0 the step\'s own call, the remainder\'s lane open, empty and active, replacing that row');

// ------------------------------------------------------------------ 3. the press consumes the same reading
console.log('\n== 3. the press that opens the first lane consumes the SAME remainder ==');

const handler = bodyOf(ui, handlerDecl);
const reopen = reopenBlock(ui);
check(/if \(!this\.parallel\) \{/.test(reopen) && /const reopened = this\.figureForWhile\(\);/.test(reopen),
  'with no figure open the press re-opens the one the selected step describes');
check(/this\.setParallel\(reopened\);/.test(reopen) && /this\.refreshCallSelect\(\);/.test(reopen),
  'and hands it to the mode, rebuilding the picker - inside a figure the list answers for the remainder');
check(/this\.unassignedLane\(\)/.test(reopenLeft(ui)),
  'the message names the remainder from `unassignedLane()`, the same call the enable condition is derived from');
check(!/remainingSelection/.test(handler),
  'and the handler never re-derives a remainder of its own');
check(/if \(!p\) \{/.test(handler) && /nothing to pair/.test(handler),
  'the no-remainder press still says so, rather than silently doing nothing');

// ------------------------------------------------------------------ 4. the faults the checks were written for
console.log('\n== 4. the checks fail on the faults they were written for ==');
{
  // THE REPORTED DEFECT, injected: the old flag-only condition. Caught by the "not the bare mode flag" check
  // AND by the "asks for the remainder" check; the one-writer count and the inline-derivation check stay
  // GREEN, which is why those are separate.
  const flagOnly = ui.replace('this.parallelBtn.disabled = !p && !this.unassignedLane();', 'this.parallelBtn.disabled = !p;');
  check(flagOnly !== ui && whileWriters(flagOnly) === 1
    && enableExpr(flagOnly) === '!p' && !/this\.unassignedLane\(\)/.test(enableExpr(flagOnly)),
    'reverting to `!p` fails the bare-flag check AND the asks-for-a-remainder check, with the count still one');

  // A SECOND COPY OF THE REMAINDER, which is the drift this probe exists for: the same question asked a
  // different way. Caught by the "does not re-derive it inline" check, and by the same-reading check that the
  // press satisfies - only those two.
  const secondCopy = ui.replace('!this.unassignedLane()', "!this.seq.remainingSelection(this.seq.board, this.chosenGroup() ?? 'All 8')");
  check(secondCopy !== ui
    && /this\.unassignedLane\(\)/.test(enableExpr(ui)) && !/this\.unassignedLane\(\)/.test(enableExpr(secondCopy))
    && /remainingSelection/.test(enableExpr(secondCopy))
    && !/remainingSelection/.test(enableExpr(ui)),
    'a re-derived condition fails the same-remainder check AND the inline-derivation check, neither of which the flag-only mutant hits');

  // THE PRESS STOPPED READING THE SHARED REMAINDER. Caught by the reopen-message check alone - the condition,
  // the counts and `figureForWhile` are all untouched by it.
  const hardCoded = ui.replace("const left = this.unassignedLane() ?? '';", "const left = 'All Except Heads';");
  check(hardCoded !== ui && !/this\.unassignedLane\(\)/.test(reopenLeft(hardCoded))
    && /this\.unassignedLane\(\)/.test(reopenLeft(ui)),
    'hard-coding the message\'s group fails the same-reading check in the press, and only that one');

  // A SECOND WRITER OF THE BUTTON, which is how two readings of one condition start. Caught by the ONE-writer
  // count alone.
  const secondWriter = ui.replace(
    '      const p = this.parallel;\n      if (!p) {',
    '      this.parallelBtn.disabled = !this.parallel;\n      const p = this.parallel;\n      if (!p) {');
  check(secondWriter !== ui && whileWriters(secondWriter) === 2 && whileWriters(ui) === 1,
    'writing the button again in the handler fails the ONE-assignment check, which is the only check it moves');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
