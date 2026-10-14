// Probe: does the BOARD FOLLOW THE SELECTION?
//
// The reported bug: selecting another move in the strip moved the highlight and the tile but left the
// Bezier handles sitting on the PREVIOUS move's control points. It is the same shape of fault as the
// trail-focus bug before it, and both are wiring faults - a method changed which move is being edited
// and did not re-point the stage - which no engine harness can see and which this sandbox cannot drive
// through a real browser.
//
// So this is a check on the SOURCE, and it is labelled as one: it parses `poc/src/editor-ui.ts`,
// finds every method that changes the selection (the move index, the travel/facing kind, the dancer
// set), and requires each one to reach the stage sync - `syncStageSelection`, or `renderInstance` or
// `commit`, which call it. Two rules, one exemption:
//
//   A. A method that CHANGES the selection must reach the stage sync.
//   B. A method that CALLS the strip renderer must reach it too, because that renderer clamps the
//      index itself and would otherwise change the selection from underneath a caller that forgot.
//   Exemption: a `render*` method may touch the selection, because every caller of a renderer is
//      itself required to sync after it - rule B is what makes that exemption safe rather than a hole.
//
// AND THE CHECK IS SHOWN TO FAIL. The last section runs the same analysis over a copy of the source
// with `selectMove`'s sync call removed - the code as it was - and requires a FAILURE. A structural
// check that cannot fail on the bug it was written for is decoration.
//
// Run: node tools/stage-sync-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from THIS FILE, so the audit runs from anywhere and not only from poc/.
const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRC = path.join(POC_DIR, 'src', 'editor-ui.ts');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/**
 * Replace comments and string/template contents with spaces, so brace counting and the statement scan
 * see only code. Character-by-character rather than by regex because a brace inside a template literal
 * or a `//` inside a string would otherwise move a method boundary.
 */
function stripLiterals(src) {
  // UTF-16, NOT CODE POINTS: `[...src]` splits by CODE POINT, so an astral character (an emoji, or any
  // U+1F… in a message) makes this array SHORTER than `src`, the `while (i < src.length)` walk runs off its
  // end, and every character after the first such character is blanked MISALIGNED - which silently merges
  // method bodies and turned "one place writes the Save label" into two. `split('')` is the same mutable
  // copy with the same indices as `src`.
  const out = src.split('');
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && n === '*') {
      let j = i + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, src.length));
      i = j + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Every class method with a body: name -> { start, body }. */
function methods(code) {
  const found = new Map();
  const re = /\n {2}(?:private |public |protected )?(?:static )?(?:async )?(?:get |set )?([A-Za-z_$][\w$]*)\s*[(<]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    // The body's `{` is the first one after the parameter list and any return type.
    let i = code.indexOf('{', m.index + m[0].length - 1);
    const close = code.indexOf(';', m.index + m[0].length - 1);
    if (i < 0 || (close >= 0 && close < i)) continue; // an abstract/typed member with no body
    let depth = 0;
    let j = i;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    found.set(m[1], { start: m.index, body: code.slice(m.index, j + 1) });
  }
  return found;
}

const MUTATORS = [
  /this\.moveIndex\s*=\s*[^=]/g,
  /this\.moveKind\s*=\s*[^=]/g,
  /this\.selectedDancers\s*=\s*[^=]/g,
  /this\.selectedDancers\.(?:add|delete)\(/g,
  // The ARC LOCK is selection-dependent state too: it follows the curve the tile is showing, so a
  // method that re-points the selection without re-deriving it would leave the lock describing a
  // different move - the same fault this audit exists for, one field over.
  /this\.arcOn\s*=\s*[^=]/g,
  /this\.arcKey\s*=\s*[^=]/g,
  // THE BOARD'S SCOPE is the same kind of state one level out: it decides whether the gizmo is a move's
  // control points or a dancer's start pose, so a method that flips it without resyncing would leave the
  // board drawing handles for the scope it just left.
  /this\.scope\s*=\s*[^=]/g,
  /this\.dancerAxis\s*=\s*[^=]/g,
];
const REACHES_STAGE = [/this\.syncStageSelection\(/, /this\.renderInstance\(/, /this\.commit\(/];

const audit = (label, src) => {
  const code = stripLiterals(src);
  const found = methods(code);
  const problems = [];
  const rows = [];
  for (const [name, { body }] of found) {
    const mutations = MUTATORS.flatMap((re) => body.match(re) ?? []);
    const callsStrip = /this\.renderMoveStrip\(/.test(body);
    const syncs = REACHES_STAGE.some((re) => re.test(body));
    const isRenderer = name.startsWith('render');
    if (mutations.length === 0 && !callsStrip) continue;
    const needsSync = (mutations.length > 0 && !isRenderer) || callsStrip;
    const ok = !needsSync || syncs;
    rows.push({ name, mutations: mutations.length, strip: callsStrip, syncs, exempt: isRenderer && mutations.length > 0, ok });
    if (!ok) problems.push({ name, mutations, callsStrip });
  }
  return { rows, problems, methodCount: found.size, label };
};

// ---------------------------------------------------------------- the audit
console.log("== Does the board follow the selection? (source audit of editor-ui.ts) ==");
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const { rows, problems, methodCount } = audit('editor-ui.ts', src);
console.log(`    ${methodCount} methods with bodies parsed; ${rows.length} touch the move/dancer selection or re-render the strip:`);
for (const r of rows) {
  const what = [
    r.mutations ? `${r.mutations} selection write${r.mutations > 1 ? 's' : ''}` : null,
    r.strip ? 'calls renderMoveStrip' : null,
    r.syncs ? 'reaches the stage sync' : 'NO stage sync',
    r.exempt ? '(renderer: its callers sync)' : null,
  ].filter(Boolean).join(', ');
  console.log(`      ${r.ok ? 'ok  ' : 'BAD '} ${r.name.padEnd(22)} ${what}`);
}
check(rows.length > 0, 'the audit found the selection-touching methods at all (an empty result would be a broken parser, not a clean file)');
check(problems.length === 0,
  problems.length === 0
    ? 'every method that changes the selection reaches the stage sync (handles + trail focus)'
    : `methods that change the selection WITHOUT re-pointing the stage: ${problems.map((p) => p.name).join(', ')}`);

// The mutation that caused the report, named so the fix cannot be quietly undone.
const selectMove = rows.find((r) => r.name === 'selectMove');
check(!!selectMove && selectMove.syncs && selectMove.mutations > 0,
  'selectMove (the reported bug) writes the selection AND syncs the stage');

// ---------------------------------------------------------------- the marks on the board
console.log('\n== The SELECTION is marked on the board: a ring per selected dancer, red per mismatch ==');
{
  const read = (rel) => fs.readFileSync(path.join(POC_DIR, 'src', rel), 'utf8').replace(/\r\n/g, '\n');
  // THE STAGE NO LONGER LIVES IN THIS APP: scene.ts and the magnet moved to packages/stage/,
  // so the stage read takes its own path while the app files keep POC_DIR/src.
  const uiSrc = read('editor-ui.ts');
  const browserSrc = read('browser.ts');
  const sceneSrc = fs.readFileSync(path.join(POC_DIR, '..', 'packages', 'stage', 'scene.ts'), 'utf8').replace(/\r\n/g, '\n');
  const mainSrc = read('main.ts');

  check(/selectionMarks\(selected: number\[\], mismatched: number\[\]\): void;/.test(uiSrc),
    'the editor asks the board to mark the selection, and names the dancers that DISAGREE in the same call');
  check(/private mismatchedDancers\(curve: CurveKind\): number\[\] \{[\s\S]{0,700}?!sameCurve\(ref, seg, curve\)/.test(uiSrc),
    'the mismatched set is built with `sameCurve` - the SAME comparison the coordinate gate locks the fields on - so the red tracks and the locked fields cannot be two opinions');
  check(/this\.host\.selectionMarks\(live \? this\.selectedSorted\(\) : \[\], live \? this\.mismatchedDancers\(this\.tabCurve\(\)\) : \[\]\);/.test(uiSrc),
    'and it is marked at the TOP of `syncStageSelection`, before every early return, so an empty selection clears the marks');
  check(/this\.host\.selectionMarks\(\[\], \[\]\);/.test(uiSrc),
    'with the marks taken OFF when the editor stops being the panel on screen, so the browse and sequencer views are not told that dancers are selected');
  check(/selectionMarks: \(selected, mismatched\) => browser\.setSelection\(selected, mismatched\)/.test(mainSrc),
    'main.ts hands both to ONE browser call');
  check(/setSelection\(selected: number\[\], mismatched: number\[\]\) \{[\s\S]{0,200}?this\.mismatchedDancers = new Set\(mismatched\);/.test(browserSrc),
    'which sets the two sets together, so the rings and the reds cannot describe two different selections');
  check(/v\.setSelected\(marked\);/.test(browserSrc) && /v\.setTrailWarning\(mismatch\);/.test(browserSrc),
    'and `applyDisplay` draws both: a ring per selected dancer and a warned track per mismatch');
  check(/v\.trail\.visible = on && \(this\.trailFocus == null \|\| focused \|\| mismatch\);/.test(browserSrc),
    'a warned track is KEPT ON SCREEN even when another dancer is focused, so the focus cannot hide the answer');
  {
    // ORDER, not presence: `setTrailHighlight` DIMS the trail underneath, so a warning applied before it would
    // be undone. Read as positions in the method rather than as a regex across it.
    const from = browserSrc.indexOf('private applyDisplay()');
    const to = browserSrc.indexOf('Show/hide the dancer views', from);
    const body = from >= 0 && to > from ? browserSrc.slice(from, to) : '';
    const atHighlight = body.indexOf('v.setTrailHighlight(');
    const atWarning = body.lastIndexOf('v.setTrailWarning(mismatch);');
    check(body.length > 0 && atHighlight >= 0 && atWarning > atHighlight,
      'and the warning is re-applied AFTER the highlight, which dims the trail underneath it');
  }
  check(/setTrailWarning\(on: boolean\): void \{[\s\S]{0,200}?setHex\(on \? TRAIL_MISMATCH_COLOR : this\.trailColor\)/.test(sceneSrc),
    'the warning is a REVERSIBLE state: it puts the couple colour back rather than restraining the track for good');
  check(/selectionRing: THREE\.Line;/.test(sceneSrc) && /this\.selectionRing\.position\.set\(pose\.x, 0\.02, -pose\.y\);/.test(sceneSrc),
    'the ring is a SCENE child placed from the pose, flat on the floor - so it is drawn in the 3D view AND the flat one, where the avatar group is hidden');
  check(/this\.stage\.scene\.add\(this\.views\[i\]\.selectionRing\);/.test(browserSrc) && /this\.stage\.scene\.remove\(v\.selectionRing\);/.test(browserSrc),
    'and it is added and removed with the views it belongs to');
}
// ---------------------------------------------------------------- the negative control
console.log('\n== The EDIT state rotates through the row\'s own three states ==');
{
  const uiSrc = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  check(/const EDIT_STATES: readonly \{ scope: 'move' \| 'dancer'; axis: 'position' \| 'rotation' \}\[\] = \[[\s\S]{0,240}?\{ scope: 'dancer', axis: 'rotation' \},\n\];/.test(uiSrc),
    'the three EDIT states are named in ONE list: Moves, Dancers + position, Dancers + rotation');
  check(/private cycleEditScope\(\): void \{[\s\S]{0,700}?this\.setScope\(next\.scope, next\.axis\);/.test(uiSrc),
    'and the E key rotates through them BY CALLING `setScope` - the same call the row\'s buttons make - so the buttons, the axis pair and the board cannot describe three different states');
}

console.log('\n== The check fails on the bug it was written for ==');
{
  // `selectMove` exactly as it was: strip re-render, trail focus, no handles.
  // EVERY sync call in the method, not just the first: `selectMove` now syncs on more than one path, so
  // removing one occurrence left the method correctly synced and the control passing over a body that had not
  // actually been broken - which is how a negative control quietly stops being one. The replacement is a
  // COMMENT, which `stripLiterals` blanks, so it cannot be mistaken for the call it replaced.
  const broken = src.replace(
    // SIGNATURE-AGNOSTIC, on purpose: this pinned `selectMove(k: number)` and stopped applying the moment the
    // method gained its `extend` parameter. This mutation is about the BODY, not the parameter list.
    /(private selectMove\([^)]*\) \{)([\s\S]*?)\n  \}\n/,
    (_all, head, body) => `${head}${body.split('this.syncStageSelection();').join('/* sync removed by the probe */')}\n  }\n`,
  );
  check(broken !== src, 'the negative control really is a different file (the edit applied)');
  const bad = audit('broken', broken);
  console.log(`    with the sync call removed: ${bad.problems.length} method(s) flagged - ${bad.problems.map((p) => p.name).join(', ') || 'NONE (the check is decoration)'}`);
  check(bad.problems.some((p) => p.name === 'selectMove'),
    'and it flags selectMove, which is the fault a caller reported');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
