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
  const out = [...src];
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
const src = fs.readFileSync(SRC, 'utf8');
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

// ---------------------------------------------------------------- the negative control
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
