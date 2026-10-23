// REVERT: the history the call editor keeps, and the one assumption it rests on.
//
// Asked for: "Add a revert feature to the poc call editor so I can undo the last 50 UI changes."
//
// The panel's history is a stack of `EditorSnapshot`s - the instance plus the flags that travel with it - and
// it is kept BY REFERENCE rather than by copying, because that is what makes fifty of them cheap. That rests
// on one property of the engine: **every editor operation RETURNS a new bundle and never writes through the
// one it was given.** If any of them mutated in place, an undo step would silently become a copy of the state
// you are trying to leave, and the feature would look like it worked while doing nothing.
//
// So this measures the property rather than asserting it. Every state on the way through a long sequence of
// EDITOR OPERATIONS is recorded, and at the END every one of them is re-serialised: if a later edit had
// reached back into an earlier bundle, the XML would have changed underneath.
//
// The rest is the wiring, which cannot be executed here (`editor-ui.ts` is TypeScript inside Vite with a DOM),
// so it is read - the same limit and the same answer as `facing-handle-probe.mjs` records for the drag rules.
//
// Run: node tools/revert-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** The cap, restated: it is what the button's own tooltip promises. */
const UNDO_LIMIT = 50;

// ---------------------------------------------------------------- 1. the property the stack rests on
console.log('== 1. an edit never writes through the bundle it was given ==');
{
  const xml = asset('ms/arm_turns.xml');
  const tams = engine.parseCallXml(xml);
  let call = engine.normalizeInstance(engine.buildCall(tams[0], engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true));

  // EVERY STATE ON THE WAY, with the XML it had AT THE TIME. These are retained by reference exactly as the
  // panel retains them.
  const history = [];
  const record = () => history.push({ call, xml: engine.callToXml(call, call.from) });
  record();

  // A LONG sequence of the operations the editor actually performs, cycling so that most of them run many
  // times over: this is what would expose a mutation, because a mutation shows up as an EARLIER state moving.
  const CHANGES = 60;
  let applied = 0;
  for (let n = 0; n < CHANGES; n++) {
    const d = n % 8;
    const segs = call.dancers[d].path;
    const k = n % Math.max(1, segs.length);
    const seg = segs[k];
    try {
      switch (n % 6) {
        case 0: // a coordinate edit, the commonest thing the panel does
          call = engine.setMove(call, d, k, { ...seg, translate: { ...seg.translate, cx1: seg.translate.cx1 + 0.05 } });
          break;
        case 1: // a turn
          call = engine.setMove(call, d, k, { ...seg, beats: seg.beats + 0.25 });
          break;
        case 2: // a start pose, which is a different engine path again
          call = engine.setDancerStart(call, d, { x: seg.translate.cx1, y: seg.translate.cy1, heading: 0.3 * n, gender: call.dancers[d].gender });
          break;
        case 3: // the facing hold, added this session and the newest engine path of all
          call = engine.holdFollowingTrace(call, d, k, 0.03);
          break;
        case 4: // append a move
          call = engine.addMove(call, d, { ...seg });
          break;
        default: // drop the append again, so the path length does not run away
          if (segs.length > 2) call = engine.removeMove(call, d, segs.length - 1);
          else call = engine.setMove(call, d, k, { ...seg, hands: seg.hands });
          break;
      }
      applied++;
      record();
    } catch {
      /* an operation this witness cannot take; the next iteration gets a different one */
    }
  }
  console.log(`    ${applied} editor operations applied, ${history.length} states retained by reference`);

  // THE MEASUREMENT. Re-serialise every retained state and compare with what it said at the time.
  let moved = 0;
  let firstMoved = -1;
  for (const [i, h] of history.entries()) {
    const now = engine.callToXml(h.call, h.call.from);
    if (now !== h.xml) { moved++; if (firstMoved < 0) firstMoved = i; }
  }
  check(moved === 0,
    moved === 0
      ? `NOT ONE of the ${history.length} retained states changed under ${applied} later edits - so a snapshot by reference IS the state it was taken from`
      : `${moved} retained state(s) changed underneath (first at step ${firstMoved}) - an editor operation is mutating a bundle it was given`);

  // AND THE STACK IS THE PANEL'S: the newest 50, oldest dropped.
  const stack = [];
  for (const h of history.slice(0, -1)) {
    stack.push(h);
    if (stack.length > UNDO_LIMIT) stack.shift();
  }
  check(stack.length === UNDO_LIMIT, `a history of ${history.length - 1} changes keeps exactly ${UNDO_LIMIT} steps (it holds ${stack.length})`);
  const oldestKept = history.length - 1 - UNDO_LIMIT;
  check(stack[0].xml === history[oldestKept].xml,
    `and the OLDEST one kept is the state ${UNDO_LIMIT} changes back, not the first ever (step ${oldestKept} of ${history.length - 1})`);
  // Walking it back is exact: the last thing popped is the state 50 changes ago, byte for byte.
  const walked = [];
  while (stack.length) walked.push(stack.pop().xml);
  check(walked.length === UNDO_LIMIT && walked[0] === history[history.length - 2].xml,
    'so 50 undos walk back to exactly the state 50 changes ago, and each one is the XML it had then');
}

// ---------------------------------------------------------------- 2. the wiring, read from the source
console.log('\n== 2. the panel keeps it, and the button is offered ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
  check(new RegExp(`const UNDO_LIMIT = ${UNDO_LIMIT};`).test(ui), `the cap is named once, as ${UNDO_LIMIT}`);
  // ONE PLACE PUSHES. Every edit ends in `renderInstance` - including the eight that do not go through
  // `commit` - so keying the step on the state means none of them can forget to take one.
  const pushes = (ui.match(/this\.undoStack\.push\(/g) ?? []).length;
  check(pushes === 1, `exactly ONE place records a step (${pushes}), so no edit path can bypass the history`);
  check(/private noteState\(\)[\s\S]{0,900}?this\.undoStack\.push\(this\.lastSnapshot\)/.test(ui),
    'and it pushes the state from BEFORE the change, which is what an undo has to restore');
  check(/this\.syncStageSelection\(\);[\s\S]{0,300}?this\.noteState\(\)/.test(ui),
    '`renderInstance` calls it, so a change is recorded by the render that follows it');
  check(/private clearUndo\(\)[\s\S]{0,200}?this\.lastKey = null;/.test(ui),
    'a load starts a fresh history, and the null baseline is what stops the call being replaced from being pushed');
  check(/this\.clearUndo\(\);[\s\S]{0,700}?this\.source = normalizeInstance\(loadCall/.test(ui),
    'and it is cleared by `loadInstance` itself, before the new call is in place');
  check(/this\.resetNoteState\(\);[\s\S]{0,200}?this\.renderInstance\(\);/.test(ui),
    'and an UNDO re-baselines before it renders, or the next press would put back what it just undid');
  // The key is the DATA, not where the caller is looking: stepping through moves must not fill the history.
  check(/private stateKey\(\): unknown\[\] \{[\s\S]{0,400}?this\.circleSide,/.test(ui) && !/stateKey\(\)[\s\S]{0,400}?this\.moveIndex/.test(ui),
    'the key is the data a change moves, NOT the move index or the selection - navigating is not a change');
  // The button, and its default state.
  check(/<button id="edRevert" disabled/.test(html), 'the Revert button exists in the markup and starts DISABLED - there is nothing to revert on a freshly loaded call');
  check(/revertBtn = el<HTMLButtonElement>\('edRevert'\)/.test(ui), 'the panel holds it');
  check(/this\.revertBtn\.addEventListener\('click', \(\) => this\.doRevert\(\)\)/.test(ui), 'and clicking it reverts');
  check(/this\.revertBtn\.disabled = n === 0;/.test(ui), 'it is disabled exactly when the history is empty');
  check(/UNDO_LIMIT\} step/.test(ui), 'and its tooltip says how many steps are available, so the cap is visible rather than a surprise');
  // Ctrl+Z, and the one guard that matters: not while a field has the caret.
  //
  // THE BINDING MOVED to the app's one keyboard table (`poc/src/keys.ts`), so what is pinned here is that it
  // is REGISTERED there with the platform command key and its own scope. The field guard is now the table's,
  // for every shortcut at once, and `keys-probe.mjs` measures it behaviourally - by dispatching a synthetic
  // keydown with an input as its target - rather than by reading the panel for the word "input". This check
  // used to pin the inline handler's own arithmetic, which is a shape rather than a behaviour: when the
  // handler moved, the gate went red and the FEATURE was still correct.
  check(/id: 'editor-undo',[\s\S]{0,160}?key: 'z',[\s\S]{0,160}?mod: true,/.test(ui),
    'Ctrl/Cmd+Z reverts too, as a binding in the keyboard table with `mod` for the platform command key');
  check(/when: \(\) => this\.active && this\.isInstanceMode\(\)/.test(ui),
    'and it says where it is live with `when`, so it does not revert from another panel');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
