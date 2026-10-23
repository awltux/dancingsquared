// THE MOVE'S DURATION, as an editable field in the move tile.
//
// Asked for: "Add a beats edit field to the Move."
//
// A MOVE'S `beats` IS NOT LIKE ITS COORDINATES, and that difference is what this probe is about. It is
// not written in either of the two spaces the tile's grid has columns for, it is not per-curve (the
// Move and Facing tabs are two shapes of ONE move, and the move lasts as long as it lasts), and the
// ENGINE DOES NOT VALIDATE IT - `setMove` stores `beats: 0` and `beats: -2` without complaint, so a
// typo would reach the track and the scrub would divide by it. The panel is therefore the only thing
// standing between a slipped digit and a broken track, and section 2 is the measurement that says so.
//
// THE FIELD ALSO HAS TO NOTICE A DIFFERENCE RATHER THAN CREATE ONE UNSEEN. A coordinate field LOCKS
// when the selected dancers disagree, because one number cannot describe several shapes. One TIMING for
// several dancers is a real edit, so the beats field stays live - but 271 of the corpus's 495 calls
// hold a move whose beats differ between dancers, so a multi-dancer selection routinely spans several
// timings, and section 1 measures how routine that is. (Those two numbers are MEASURED by section 1 and
// were 285 of 547 before `50d3e95` retired the `b1`/`b2` duplicates; they are restated here because the
// header is what a reader sees first, and a stale count in it is worse than none.)
//
// The tile lives in `editor-ui.ts`, which is TypeScript inside Vite with a DOM and cannot run in this
// sandbox - the same limit `move-clipboard-probe.mjs` and `absolute-coords-probe.mjs` record. So the
// engine's behaviour and the corpus are measured here, and the panel's use of them is read from the
// source.
//
// Run: node tools/move-beats-probe.mjs   (from poc/)

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
const LEVELS = fs.readdirSync(path.join(corpusRoot())).filter((d) => !d.includes('.') && d !== 'src');
// THE FOUR `.xml` FILES UNDER THE LEVEL DIRECTORIES THAT ARE NOT CALLS: the moves registry and three rule
// tables. They sit in a level directory because that is where the loader looks, so a coverage check that
// merely counts `*.xml` is always four short - and a check with a magic floor cannot say WHICH four.
// Naming them is what lets the check below be an EQUALITY on call files. MEASURED: 499 `.xml` files, of
// which 495 build, and the difference is exactly these four.
const NOT_CALLS = new Set(['moves.xml', 'facing_couples_rule.xml', 'ocean_wave_rule.xml', 'passing_rule.xml']);
const CALL_FILES = LEVELS.reduce((n, level) => n
  + fs.readdirSync(path.join(corpusRoot(), level)).filter((f) => f.endsWith('.xml') && !NOT_CALLS.has(f)).length, 0);
const callAt = (level, f) => {
  try {
    return engine.normalizeInstance(engine.loadCallFromXml(
      fs.readFileSync(path.join(corpusRoot(), level, f), 'utf8'), movesXml, formationsXml, 0));
  } catch { return null; }
};
function* everyCall() {
  for (const level of LEVELS) {
    for (const f of fs.readdirSync(path.join(corpusRoot(), level))) {
      if (!f.endsWith('.xml')) continue;
      const call = callAt(level, f);
      if (call) yield { level, f, call };
    }
  }
}

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ---------------------------------------------------------------- 1. what the corpus holds
console.log('\n== 1. the corpus: beats are fractional, positive, and often differ between dancers ==');
{
  const hist = new Map();
  let segments = 0, calls = 0, fractional = 0, nonPositive = 0, min = Infinity, max = -Infinity;
  let disagreeIndices = 0, callsWithDisagreement = 0, largestSpread = 0, widest = null;
  for (const { level, f, call } of everyCall()) {
    calls++;
    for (const d of call.dancers) {
      for (const s of d.path) {
        segments++;
        hist.set(s.beats, (hist.get(s.beats) ?? 0) + 1);
        if (!Number.isInteger(s.beats)) fractional++;
        if (!(s.beats > 0)) nonPositive++;
        if (s.beats < min) min = s.beats;
        if (s.beats > max) max = s.beats;
      }
    }
    // THE SAME MOVE ACROSS THE DANCERS, which is the selection a group edit acts on.
    const n = Math.max(...call.dancers.map((d) => d.path.length));
    let bad = false;
    for (let k = 0; k < n; k++) {
      const vals = call.dancers.map((d) => d.path[k]?.beats).filter((v) => v !== undefined);
      if (new Set(vals).size > 1) {
        disagreeIndices++;
        bad = true;
        const spread = Math.max(...vals) - Math.min(...vals);
        if (spread > largestSpread) {
          largestSpread = spread;
          widest = `${level}/${f} move ${k + 1}: [${vals.join(', ')}]`;
        }
      }
    }
    if (bad) callsWithDisagreement++;
  }
  console.log(`    ${calls} calls, ${segments} segments`);
  console.log(`    beats run ${min} .. ${max}; ${fractional} segments are not whole numbers`);
  console.log(`    histogram: ${[...hist].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}:${n}`).join(' ')}`);
  console.log(`    ${callsWithDisagreement} calls hold such a move (${disagreeIndices} indices); widest spread ${largestSpread}`);
  if (widest) console.log(`    ${widest}`);
  // EVERY CALL FILE, COUNTED RATHER THAN GUESSED AT. This was `calls > 500`, a floor that went stale the
  // moment `50d3e95` retired about 52 calls - and a floor cannot say whether a shortfall means files were
  // skipped or calls stopped building. An equality against the enumerated call files says both, and it
  // fails if a NEW call file is added without being swept, which the floor could never notice.
  check(calls === CALL_FILES,
    `the sweep is every call in the corpus (${calls} of ${CALL_FILES} call files; the ${NOT_CALLS.size} non-call .xml files - the moves registry and three rule tables - are excluded by name)`);
  check(nonPositive === 0, `NO segment has a duration of zero or less (${nonPositive}), so a zero typed here is a typo rather than an authoring choice`);
  check(fractional > 1000, `FRACTIONAL beats are ordinary rather than a rounding error to be tidied away (${fractional} of ${segments})`);
  check(min >= 0.1 && max <= 9.5, `and the whole corpus sits between ${min} and ${max} beats, a long way inside the 64-beat phrase the field refuses beyond`);
  check(callsWithDisagreement > 200,
    `the selected dancers ROUTINELY differ - ${callsWithDisagreement} of ${calls} calls hold a move that does (${disagreeIndices} indices, spread up to ${largestSpread}) - so a field that stayed silent about it would hide a real difference`);
}

// ---------------------------------------------------------------- 2. what the engine does with a duration
console.log('\n== 2. the engine stores whatever it is handed, so the panel is the only thing that refuses ==');
{
  const first = [...everyCall()][0];
  const call = first.call;
  const k = Math.min(1, call.dancers[0].path.length - 1);
  const seg = call.dancers[0].path[k];

  // THE NONSENSE VALUES, which a number field can produce from a slipped keystroke.
  const zero = engine.setMove(call, 0, k, { ...seg, beats: 0 });
  const negative = engine.setMove(call, 0, k, { ...seg, beats: -2 });
  check(zero.dancers[0].path[k].beats === 0,
    `beats 0 is accepted and STORED (${zero.dancers[0].path[k].beats}) - nothing downstream refuses it`);
  check(negative.dancers[0].path[k].beats === -2,
    `and so is a negative duration (${negative.dancers[0].path[k].beats})`);

  // A REAL EDIT: it survives, and it moves the call's own length.
  const before = call.beats;
  const raised = engine.setMove(call, 0, k, { ...seg, beats: seg.beats + 2 });
  check(raised.dancers[0].path[k].beats === seg.beats + 2,
    `a real change survives the write (${seg.beats} -> ${raised.dancers[0].path[k].beats})`);
  check(raised.beats > before,
    `and the call's own length follows it (${before} -> ${raised.beats}), which is what the scrub and the strip are drawn from`);
  check(engine.normalizeInstance(raised).dancers[0].path[k].beats === seg.beats + 2,
    'the value is still there after the instance is normalised, so it is a duration and not a derived figure');

  // FRACTIONAL, the case a step of 1 would quietly round away.
  const frac = engine.setMove(call, 0, k, { ...seg, beats: 1.5 });
  check(frac.dancers[0].path[k].beats === 1.5, `and a fractional duration is kept exactly (1.5 -> ${frac.dancers[0].path[k].beats})`);

  // WHAT THE CALLER SEES: the move's own span, and every later move's, on the call's clock.
  const spanOf = (c, j) => engine.moveBeatRange(c.dancers[0], j);
  const base = spanOf(call, k);
  const after = spanOf(raised, k);
  const lastK = call.dancers[0].path.length - 1;
  const shifted = lastK > k ? spanOf(raised, lastK).from - spanOf(call, lastK).from : 0;
  console.log(`    move ${k + 1} on the call's clock: ${base.from}..${base.to} -> ${after.from}..${after.to}`);
  check(after.from === base.from && Math.abs(after.to - (base.to + 2)) < 1e-9,
    `the edited move starts where it did and ends 2 beats later, so the edit lengthens the move rather than moving it`);
  check(lastK <= k || Math.abs(shifted - 2) < 1e-9,
    `and every LATER move is pushed along by the same 2 beats (${shifted}), so the rest of the track keeps its own durations`);
}

// ---------------------------------------------------------------- 3. the call's length is the longest dancer
console.log('\n== 3. a call is as long as its LONGEST dancer, which is why a group edit can change it ==');
{
  let calls = 0, maxRule = 0, allSame = 0, neither = 0;
  for (const { call } of everyCall()) {
    calls++;
    const totals = call.dancers.map((d) => d.path.reduce((a, s) => a + s.beats, 0));
    const longest = Math.max(...totals);
    if (Math.abs(call.beats - longest) < 1e-9) maxRule++;
    else if (new Set(totals.map((t) => Math.round(t * 1e6))).size === 1) allSame++;
    else neither++;
  }
  console.log(`    ${maxRule} of ${calls} calls: call.beats == the longest dancer's total`);
  check(maxRule > calls * 0.95,
    `the call's length IS its longest dancer's track (${maxRule} of ${calls}), so lengthening a move on a dancer who is already the longest lengthens the call - and on a shorter one may not`);
}

// ---------------------------------------------------------------- 4. the field, read from the source
console.log('\n== 4. the field: in the tile, on the corpus key, refusing what the engine will not ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const css = fs.readFileSync(path.join(POC_DIR, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const bodyOf = (header) => {
    const i = ui.indexOf(header);
    if (i < 0) return null;
    const j = ui.indexOf('\n  }', i);
    return ui.slice(i, j);
  };

  // ---- the field itself
  check(/const beatsField = this\.field\(\s*`m\$\{i\}:\$\{k\}:beats`,/.test(ui),
    'the field is built on the key the rest of the panel already uses for a move\'s beats');
  check(/refreshNumberFields[\s\S]{0,900}?values\.push\(\[`m\$\{i\}:\$\{k\}:beats`, seg\.beats\]\)/.test(ui),
    'which is the key `refreshNumberFields` already writes, so the number stays live during a handle drag and keeps focus through the rebuild');
  // The gap between the two appends is the comment that explains the placement, so the budget is
  // generous and the assertion is about the ORDER rather than about the prose being short.
  check(/tile\.appendChild\(tabs\);[\s\S]{0,3000}?tile\.appendChild\(beatsField\);/.test(ui),
    'and it is placed in the tile just after the two shape tabs, not among the coordinate columns - a duration is in neither of the two spaces the grid has columns for');
  check(ui.indexOf('tile.appendChild(beatsField)') < ui.indexOf('tile.appendChild(grid)'),
    'the field comes BEFORE the coordinate grid, so it is never one of the coordinate columns');
  check(/const beatsField = this\.field\([\s\S]{0,400}?BEAT_STEP,/.test(ui),
    'the spinner nudges by a quarter beat');

  // ---- the refusals, which are the point of the method
  const setter = bodyOf('  private setMoveBeats(') || '';
  check(/if \(!\(v > 0\)\)/.test(setter) && /this\.refusal\(/.test(setter) && /this\.renderInstance\(key\)/.test(setter),
    'a duration of zero or less is REFUSED out loud and the field is put back to the value the move actually has');
  check(/if \(v > MAX_MOVE_BEATS\)/.test(setter) && /slipped digit/.test(setter),
    'and a value beyond a whole phrase is refused too, as a slipped digit rather than a duration anyone meant');
  check(/const was = this\.instance;[\s\S]{0,600}?if \(this\.instance === was\) return;/.test(setter),
    'the status line is only written when the edit actually LANDED, so it cannot talk over a refusal the write itself made');
  check(/did not all have the same before/.test(setter),
    'and when the write has flattened a difference between the dancers, it SAYS so - afterwards there is nothing left to notice');
  check(/const before = this\.selectedBeats\(\);/.test(setter) && /before\?\.values\.length/.test(setter),
    'the count it reports is the dancers that actually HAVE a move at this index, not the whole selection');

  // ---- the marker
  const reader = bodyOf('  private selectedBeats(') || '';
  check(/varies: new Set\(values\)\.size > 1/.test(reader) && /if \(seg\) values\.push\(seg\.beats\)/.test(reader),
    'what the selection holds is read keyed on the move, skipping a dancer with no move there - the same rule every other group edit follows');
  check(/if \(beats\?\.varies\) beatsField\.classList\.add\('mixed'\)/.test(ui),
    'a selection that disagrees is MARKED on the field rather than locked, because one timing for several dancers is a real edit');
  check(/NOT all last the same here/.test(ui),
    'and the field names the values themselves to the caller who hovers it, so the difference is visible before the write rather than after');
  // THE SELECTOR IS A LIST AND THE CHECK SAYS SO. It used to require `... .mixed input {` exactly, which
  // pinned the SHAPE of the stylesheet rather than its rule: the hands selector beside the beats field is a
  // `<select>`, so the marker rule now names both, and the intent - a live rule that reaches the field with
  // the warning colour - is what is asserted. `\b[^{]*\{` spans the rest of the selector list.
  check(/#editorPanel \.ed-group\.mixed input\b[^{]*\{[^}]*border-color: var\(--warn\)[^}]*\}/.test(css) &&
    /#editorPanel \.ed-group\.mixed label \{[^}]*color: var\(--warn\)[^}]*\}/.test(css),
    'the marker is live CSS - a rule inside an unterminated comment is not a rule - and it is the warning colour, distinct from the dimming a locked field wears');

  // ---- the constants, and that their evidence is in this file
  check(/const MAX_MOVE_BEATS = 64;/.test(ui) && /const BEAT_STEP = 0\.25;/.test(ui),
    'the ceiling and the step are named constants, and the comment that defines the ceiling cites the corpus range this probe measures');
  check(!/beats\s*[<>=]\s*0\s*;/.test(ui.replace(/if \(!\(v > 0\)\)/g, '')),
    'nothing else in the panel silently clamps a duration, so this field is the single place it is decided');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
