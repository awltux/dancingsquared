// Probe: THE MOVE TILE'S HANDS SELECTOR, and the values it is allowed to offer.
//
// Asked for: "All Moves should have a 'hands' selector below the 'beats' selector. Search the taminations
// code to find the currently valid values."
//
// WHERE THE VALUES COME FROM. `hands` is free text in a tam's `<movement>`, and `mapHands`
// (`engine/src/convert.ts`) reads it case-insensitively and maps ANYTHING IT DOES NOT RECOGNISE to `none`.
// That is the trap a selector has to answer: a list offering a value the engine does not honour would write
// `none` and say nothing. So the values are NOT mirrored here - the UI's own list is read out of
// `editor-ui.ts` and every entry is fed to the REAL reader and read back. A test of the mapping, not of a
// copy of it.
//
// The negative control is the other half: a value the engine does NOT know must come back as `none`, or the
// round trip above proves nothing about which words are honoured.
//
// The rest is wiring, which is DOM code no engine harness can run, so it is read as source - the same
// arrangement `move-beats-probe.mjs` uses for the duration field beside it.
//
// Run: node poc/tools/editor-hands-probe.mjs   (from anywhere; engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const read = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8').replace(/\r\n/g, '\n');
/** The app's own source is NOT the corpus — a separate reader, so the two cannot be confused. */
const readApp = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');
const ui = readApp('src/editor-ui.ts');
const css = readApp('src/style.css');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** A two-dancer tam whose first move holds `hands`, so the reader can be asked what it made of one word. */
const tamWith = (hands) => `<tamination>
  <tam title="Hands Probe" asymmetric="true">
    <formation>
      <dancer gender="boy" x="-1" y="0" angle="0"/>
      <dancer gender="girl" x="1" y="0" angle="180"/>
    </formation>
    <path><movement hands="${hands}" beats="2" cx1="0.5" cy1="0" cx2="1" cy2="0" x2="1.5" y2="0"/></path>
    <path><movement hands="${hands}" beats="2" cx1="0.5" cy1="0" cx2="1" cy2="0" x2="1.5" y2="0"/></path>
  </tam>
</tamination>`;

/** What the ENGINE makes of one written hand state. */
const readBack = (hands) => {
  const call = engine.loadCallFromXml(tamWith(hands), movesXml, formationsXml, { title: 'Hands Probe' });
  return call.dancers[0].path[0].hands;
};

// ============================================================ 1. the values, through the engine
console.log('== 1. every value the selector offers is one the engine honours ==');
const listMatch = /const HANDS: Hands\[\] = \[([^\]]*)\]/.exec(ui);
const offered = (listMatch?.[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
console.log(`    the UI offers ${offered.length}: ${offered.join(', ')}`);
check(offered.length > 0, 'the selector has a list of values to offer at all');
check(offered.includes('none'), 'and it includes `none`, which is what an unwritten hand state means');
for (const h of offered) {
  const back = readBack(h);
  check(back === h, `"${h}" survives the round trip through the engine (${back})`);
}
// AND THE WORDS ARE HONOURED CASE-INSENSITIVELY, which is why the list may spell them in lower case.
check(readBack('GRIPBOTH') === 'gripboth', 'the engine reads a hand state case-insensitively, so the list may spell it lower case');

// ============================================================ 2. the control, and that the test bites
console.log('\n== 2. the round trip can fail, and the control cannot lie ==');
check(readBack('not-a-hand-state') === 'none',
  'a word the engine does NOT know comes back as `none` - which is the silent failure this list exists to prevent, and it is what makes section 1 a test rather than a tautology');
check(readBack('griplefts') === 'none' && readBack('') === 'none',
  'and so does a near-miss and an empty value, so a typo cannot pass as a real state');

// ============================================================ 3. the wiring
console.log('\n== 3. the control is a list, on every move, under the beats field ==');
const tile = (() => {
  const i = ui.indexOf('tile.appendChild(beatsField);');
  return i < 0 ? '' : ui.slice(i, i + 1600);
})();
check(/const handsSel = document\.createElement\('select'\)/.test(tile),
  'the hands control is a `<select>`, not a text field - the whole point of asking the engine for its values');
check(/for \(const h of HANDS\) handsSel\.add\(new Option\(h, h/.test(tile),
  'and its options are built from the one list, so the menu and the round trip above cannot disagree');
check(/h === seg\.hands/.test(tile),
  'with the move\'s current state preselected, so the control OPENS on the truth rather than on the first entry');
// A LIST SELECTS A VALUE; it does not type one. `mapHands` reading a typo as `none` is unreachable from here.
check(/handsSel\.addEventListener\('change', \(\) => this\.setMoveHands\(handsSel\.value as Hands\)\)/.test(tile),
  'and choosing an entry writes it through `setMoveHands`');
// BELOW THE BEATS FIELD, which is what was asked for, and unconditional so it reaches EVERY move.
check(ui.indexOf('tile.appendChild(beatsField);') < ui.indexOf('tile.appendChild(handsWrap);') &&
  ui.indexOf('tile.appendChild(handsWrap);') > -1,
  'the hands control is appended AFTER the beats field, so it sits below it in the tile');
check(!/if \([^)]*\)\s*tile\.appendChild\(handsWrap\);/.test(tile),
  'and it is appended unconditionally, so it is on every move rather than on the ones that happen to hold hands');

console.log('\n== 4. the writer, and the difference it reports ==');
const setter = (() => {
  const i = ui.indexOf('private setMoveHands(');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1200 : j);
})();
check(/this\.commitMoveChange\(\(s\) => \(\{ \.\.\.s, hands: v \}\)/.test(setter),
  'the write goes through `commitMoveChange`, so it reaches every selected dancer AND inherits the empty-selection refusal instead of writing nowhere quietly');
check(/const was = this\.instance;/.test(setter) && /if \(this\.instance === was\) return;/.test(setter),
  'and the status line is only written when the edit actually LANDED, so it cannot talk over a refusal');
check(/did not all have the same before/.test(setter),
  'and flattening a difference between the dancers is SAID, not silent - afterwards there is nothing to notice');
// THE READER SKIPS A DANCER WITH NO MOVE THERE, the rule every other group edit follows.
const reader = (() => {
  const i = ui.indexOf('private selectedHands(');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1200 : j);
})();
check(/if \(seg\) values\.push\(seg\.hands\)/.test(reader) && /varies: new Set\(values\)\.size > 1/.test(reader),
  'the reader counts only the dancers that HAVE a move at this index, and reports whether their hand states differ');

console.log('\n== 5. the marker is live CSS, and it reaches a LIST ==');
check(/#editorPanel \.ed-group\.mixed input\b[^{]*\{[^}]*border-color: var\(--warn\)[^}]*\}/.test(css),
  'a disagreeing selection marks the field with the warning colour rather than locking it, because one hand state for several dancers is a real edit');
// THE ONE THAT WOULD SILENTLY DO NOTHING: the marker rule named only `input`, and this control is a
// `<select>`, so a selector list that forgot `select` would leave the warning invisible on the very field.
check(/#editorPanel \.ed-group\.mixed [^{]*select[^{]*\{[^}]*border-color: var\(--warn\)[^}]*\}/.test(css),
  'and that rule reaches `select` as well as `input` - otherwise the hands field would wear no warning at all');
check(/if \(hands\?\.varies\) handsWrap\.classList\.add\('mixed'\)/.test(tile),
  'and the wrap is marked when the selection disagrees, which is what the rule above is for');
check(/NOT all hold the same here/.test(tile),
  'the field names the values themselves to the caller who hovers it, so the difference is visible before the write');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
