// THE TWO ADD-A-COPY BUTTONS IN THE MOVE TILE: `<A` before the title and `A>` at the far right of the header.
//
// Asked for as "add a [D]uplicate button at the top to the left and right of the current move header. This
// duplicates the Move and inserts it to the left or right of the current move, depending on which button was
// pressed. It should copy only the selected Move (even if multiple moves are selected), but across multiple
// dancers if they are selected." Then, in the same breath, "Perhaps [<A] and [A>] might be better text for the
// buttons", then "Move the [A>] to the far right."
//
// THE WHOLE FEATURE IS ONE ENGINE CALL, and that is why it is worth a probe rather than a glance: the tile
// builds no segment of its own. It hands `addMove` a move it already has and an index, and everything the
// button claims - that the copy is a copy, that it lands on the side that was pressed, that the moves already
// there are left alone - is `addMove`'s behaviour, not the tile's. So it is measured here rather than assumed.
//
// THE CLAIM THAT MATTERS MOST is the one the status line makes: "the copy is a new move, so it holds no copied
// point until C is pressed on it." The clipboard is a `WeakMap` keyed on the move's own segment (see
// `move-clipboard-probe.mjs`, where that ownership is the point). If `addMove` spliced the segment it was
// handed, the duplicate and the original would be ONE object and the copy would silently inherit the original's
// clipboard entry - the copy would look like it was holding a point nobody copied onto it. `addMove` CLONES,
// and section 1 is that measurement.
//
// The tile itself lives in `editor-ui.ts`, which is TypeScript inside Vite with a DOM and cannot run in this
// sandbox - the same limit `move-clipboard-probe.mjs` and `absolute-coords-probe.mjs` record. So the engine
// behaviour is measured, and the tile's use of it is read from the source.
//
// Run: node tools/duplicate-move-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const LEVELS = fs.readdirSync(path.join(POC_DIR, 'src/assets')).filter((d) => !d.includes('.') && d !== 'src');
const callAt = (level, f) => {
  try {
    return engine.normalizeInstance(engine.loadCallFromXml(
      fs.readFileSync(path.join(POC_DIR, 'src/assets', level, f), 'utf8'), movesXml, formationsXml, 0));
  } catch { return null; }
};

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const sameSeg = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const get = (level, f) => callAt(level, f);

// ---------------------------------------------------------------- 1. what `addMove` does with the move it is handed
console.log('\n== 1. the insert: `addMove` CLONES the move it is given, so a copy is a copy ==');
{
  let calls = 0, insertedIsFresh = 0, copyEqualsSource = 0, originalKept = 0, laterKept = 0, laterCount = 0;
  let headFresh = 0, tailFresh = 0, otherDancersKept = 0, sourceUnmutated = 0, countsGrew = 0;
  for (const level of LEVELS) {
    for (const f of fs.readdirSync(path.join(POC_DIR, 'src/assets', level))) {
      if (!f.endsWith('.xml')) continue;
      const call = get(level, f);
      if (!call || !call.dancers[0].path.length) continue;
      calls++;
      const len = call.dancers[0].path.length;
      const mid = Math.min(1, len - 1);
      const seg = call.dancers[0].path[mid];

      // THE PAIR THE TILE PRODUCES: same move, the index to its right.
      const right = engine.addMove(call, 0, seg, mid + 1);
      if (right.dancers[0].path.length === len + 1) countsGrew++;
      const copy = right.dancers[0].path[mid + 1];
      if (copy !== seg) insertedIsFresh++;
      if (sameSeg(copy, seg)) copyEqualsSource++;
      if (right.dancers[0].path[mid] === seg) originalKept++;
      if (right.dancers[0].path.slice(0, mid).every((s, k) => s === call.dancers[0].path[k]) &&
          right.dancers[0].path.slice(mid + 2).every((s, k) => s === call.dancers[0].path[mid + 1 + k])) laterKept++;
      laterCount++;
      if (right.dancers.slice(1).every((d, k) => d === call.dancers.slice(1)[k])) otherDancersKept++;
      if (call.dancers[0].path.length === len) sourceUnmutated++;

      // THE TWO EDGES THE BUTTONS CAN REACH: `at = 0` (the first move) and `at = length` (past the last one,
      // which is what the right-hand button produces on the final move of a track).
      if (engine.addMove(call, 0, seg, 0).dancers[0].path[0] !== seg) headFresh++;
      const tail = engine.addMove(call, 0, seg, len);
      if (tail.dancers[0].path.length === len + 1 && tail.dancers[0].path[len] !== seg) tailFresh++;
    }
  }
  console.log(`    ${calls} calls`);
  check(calls > 400, `the sweep is not trivial (${calls} calls over every level)`);
  check(insertedIsFresh === calls && headFresh === calls && tailFresh === calls,
    `the inserted move is a NEW object at every index, so it holds no clipboard entry of its own (${insertedIsFresh} mid, ${headFresh} head, ${tailFresh} tail)`);
  check(copyEqualsSource === calls,
    `and its numbers are the ORIGINAL's, move for move and beat for beat - a duplicate, not a re-pose (${copyEqualsSource} of ${calls})`);
  check(originalKept === calls,
    `the move that was duplicated keeps its own object, so a copied point already on it stays on it (${originalKept} of ${calls})`);
  check(laterKept === calls,
    `every OTHER move on that dancer keeps its object too, so their own copied points survive the insert (${laterKept} of ${calls})`);
  check(countsGrew === calls, `the dancer is one move longer, not the same length with a move overwritten (${countsGrew} of ${calls})`);
  check(otherDancersKept === calls,
    `and the other DANCERS are the very same objects they were, because a duplicate is per dancer (${otherDancersKept} of ${calls})`);
  check(sourceUnmutated === calls, `the instance that was passed in is not touched, which is what makes the edit undoable (${sourceUnmutated} of ${calls})`);
}

// ---------------------------------------------------------------- 2. the tile, read from the source
console.log('\n== 2. the tile: two buttons bracketing the header, each inserting on its own side ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const css = fs.readFileSync(path.join(POC_DIR, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const bodyOf = (header) => {
    const i = ui.indexOf(header);
    if (i < 0) return null;
    const j = ui.indexOf('\n  }', i);
    return ui.slice(i, j);
  };

  // ---- the two buttons, and the labels asked for
  check(/b\.textContent = side === 'left' \? '<A' : 'A>';/.test(ui),
    "the labels are the arrows themselves: `<A` on the left, `A>` on the right, as asked after a first cut used `D` twice");
  check(/b\.dataset\.key = `m\$\{this\.moveDancer\}:\$\{k\}:dup\.\$\{side\}`;/.test(ui),
    'each button has its own key, so a test or a style can tell the two sides apart');

  // ---- where they sit. `<A` is appended immediately left of the title; `A>` is appended AFTER the facing
  // ---- control, and the header's own `space-between` is what makes that the far right.
  check(/title\.append\(this\.duplicateButton\(k, 'left'\), name\);/.test(ui),
    '`<A` is appended immediately LEFT of the move\'s own title, in that order');
  check(/head\.append\(explicit, this\.duplicateButton\(k, 'right'\)\);/.test(ui),
    'and `A>` is appended after the facing control rather than beside the title - which is the "move it to the far right"');
  check(/#editorPanel \.ed-move\.selected \.ed-move-head \{[^}]*justify-content: space-between/.test(css),
    'the header is a `space-between` row, so the last item really does land on the right-hand edge');
  check(/head\.className = 'ed-move-head';/.test(ui) && /title\.className = 'ed-move-title';/.test(ui) &&
    /explicit\.className = 'ed-move-explicit';/.test(ui),
    'and the two sides are their own groups, so neither is stretched by the other\'s width');

  // ---- the styling is live CSS. A rule inside an unterminated comment is not a rule, which is exactly how
  // ---- the clipboard buttons once rendered as the dim default and were reported as hard to see.
  check(/#editorPanel \.ed-dup \{[^}]*color: var\(--text\)[^}]*\}/.test(css) &&
    /#editorPanel \.ed-dup \{[^}]*background: #1e2a38[^}]*\}/.test(css) &&
    /#editorPanel \.ed-dup \{[^}]*font-weight: 700[^}]*\}/.test(css),
    'the buttons are loud rather than the panel\'s dim default, and the rule survives the comments being taken out');
  check(/#editorPanel \.ed-move-title \{/.test(css) && /#editorPanel \.ed-move-explicit \{/.test(css),
    'both header groups are styled');

  // ---- the action: which index, on which dancers, and what it does NOT do
  const body = bodyOf('  private duplicateInstanceMove(') || '';
  check(/const from = this\.moveIndex;/.test(body) && /const at = side === 'left' \? from : from \+ 1;/.test(body),
    'the copy goes at `from` for the left button and `from + 1` for the right, so each button inserts on its own side of the SAME move');
  check(/for \(const d of targets\)/.test(body) && /const seg = next\.dancers\[d\]\?\.path\[from\];/.test(body) &&
    /next = addMove\(next, d, seg, at\);/.test(body),
    'each selected dancer duplicates ITS OWN move at that index - the per-dancer difference a group edit must preserve');
  check(/if \(!seg\) continue;/.test(body),
    'a dancer with no move at that index is SKIPPED rather than given one, the same rule the delete follows');
  check(/const targets = this\.selectedSorted\(\);/.test(body) && /targets\.length === 0/.test(body) &&
    /pick dancers above the table/.test(body),
    'and pressing it with nothing selected says so instead of doing nothing quietly');
  check(/this\.moveIndex = side === 'left' \? from \+ 1 : from;/.test(body),
    'the tile follows the COPY it just made - left of the original puts the cursor on the copy, right of it leaves the cursor on the original');
  check(/this\.circleTo = null;/.test(body),
    'the RUN IS CLEARED, because inserting shifts every later index and a run left naming them would name the wrong moves');
  check(!/toBeats|toMove|selectedRange/.test(body),
    'and the run is IGNORED rather than walked: the request is explicit that only the SELECTED MOVE is copied, even when a run is selected');
  check(/this\.commit\(next, `m\$\{this\.moveDancer\}:\$\{this\.moveIndex\}:dup\.\$\{side\}`\)/.test(body),
    'the whole multi-dancer insert is ONE commit, so one undo takes the whole press back');

  // ---- the clipboard, untouched: this action must neither read nor write it
  check(!/heldBy|moveClips/.test(body),
    'duplicating neither reads nor writes the clipboard - the copy is a new move and the original keeps whatever it held');
}

// ---------------------------------------------------------------- 3. every move of every dancer, both sides
console.log('\n== 3. the sweep: on every move of every dancer, the copy lands on the side whose button was pressed ==');
{
  let subjects = 0, leftOk = 0, rightOk = 0, freshOk = 0, sameOk = 0, neighboursOk = 0, cursorOk = 0;
  for (const level of LEVELS) {
    for (const f of fs.readdirSync(path.join(POC_DIR, 'src/assets', level))) {
      if (!f.endsWith('.xml')) continue;
      const call = get(level, f);
      if (!call) continue;
      for (let d = 0; d < call.dancers.length; d++) {
        const path0 = call.dancers[d].path;
        for (let from = 0; from < path0.length; from++) {
          subjects++;
          // The tile's own arithmetic, mirrored: left puts the copy AT the index, right puts it just after.
          const left = engine.addMove(call, d, path0[from], from);
          const right = engine.addMove(call, d, path0[from], from + 1);
          const lp = left.dancers[d].path;
          const rp = right.dancers[d].path;
          // LEFT: the copy is at `from`, the original has moved to `from + 1`.
          if (lp.length === path0.length + 1 && sameSeg(lp[from], path0[from]) && lp[from] !== path0[from] &&
              lp[from + 1] === path0[from]) leftOk++;
          // RIGHT: the original stays at `from`, the copy is at `from + 1`.
          if (rp.length === path0.length + 1 && rp[from] === path0[from] &&
              sameSeg(rp[from + 1], path0[from]) && rp[from + 1] !== path0[from]) rightOk++;
          if (lp[from] !== path0[from] && rp[from + 1] !== path0[from]) freshOk++;
          if (sameSeg(lp[from], path0[from]) && sameSeg(rp[from + 1], path0[from])) sameOk++;
          // Everything that was NOT the duplicated move and NOT the copy is the same object as before.

          const untouched = (p, skipNew, skipOld) => p.every((s, k) => {
            if (k === skipNew) return true;
            const srcIdx = k < skipNew ? k : k - 1;
            if (srcIdx === skipOld) return true;
            return s === path0[srcIdx];
          });
          if (untouched(lp, from, from) && untouched(rp, from + 1, from)) neighboursOk++;
          // The cursor rule the tile applies: `from + 1` after a left insert (the copy), `from` after a right
          // one (the original) - and the move under the cursor is the one that was just made or kept.
          if (lp[from + 1] === path0[from] && rp[from] === path0[from]) cursorOk++;
        }
      }
    }
  }
  console.log(`    ${subjects} (dancer, move) pairs over every level`);
  check(subjects > 1000, `the sweep is not trivial (${subjects} pairs)`);
  check(leftOk === subjects, `LEFT: the copy is the move at the original's index and the original slides right (${leftOk} of ${subjects})`);
  check(rightOk === subjects, `RIGHT: the original stays put and the copy is the new move after it (${rightOk} of ${subjects})`);
  check(freshOk === subjects, `either way the copy is a distinct object, so it cannot inherit the original's clipboard entry (${freshOk} of ${subjects})`);
  check(sameOk === subjects, `and it carries the original's numbers exactly (${sameOk} of ${subjects})`);
  check(neighboursOk === subjects, `no third move is disturbed, on either side (${neighboursOk} of ${subjects})`);
  check(cursorOk === subjects, `and the move the tile puts the cursor on is the one on the pressed side (${cursorOk} of ${subjects})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
