// Probe: THE SEQUENCER HUD'S SHAPE - four zones, four drawers, one status line, one transport, a timeline
// that reads, and a keyboard.
//
// WHY IT EXISTS. The panel was one flat stack of rows and text blocks: Margin first, a board-view row between
// the picker and its button, the transport below six search buttons, the sequence last and smallest, nine
// readouts in DOM order, and no keyboard at all. A redesign is easy to drift back out of - the next control
// added "just here" is how the stack happened - so the SHAPE is pinned: which control lives in which zone,
// that the timeline carries the data it claims to, and that every shortcut is panel-scoped.
//
// It reads `index.html` and the panel's source, because the panel is TypeScript inside Vite and cannot be
// executed headlessly (the same reason `parallel-lane-probe.mjs` and `escape-probe.mjs` read the source).
//
// Run: node poc/tools/sequencer-hud-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const html = fs.readFileSync(path.join(POC, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
const main = fs.readFileSync(path.join(POC, 'src', 'main.ts'), 'utf8');
const css = fs.readFileSync(path.join(POC, 'src', 'style.css'), 'utf8');

/** The `<div id="seqPanel">` block, by brace-free tag counting: the panel's own closing `</div>`. */
const panelStart = html.indexOf('<div id="seqPanel"');
const panel = (() => {
  if (panelStart < 0) return '';
  let depth = 0;
  const re = /<(\/?)(div|details|select|textarea)\b[^>]*?(\/?)>/g;
  re.lastIndex = panelStart;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, close, tag, selfClose] = m;
    if (selfClose === '/' || tag === 'select' || tag === 'textarea') continue;
    depth += close ? -1 : 1;
    if (depth === 0) return html.slice(panelStart, m.index + m[0].length);
  }
  return html.slice(panelStart);
})();
const drawer = (id) => {
  const i = panel.indexOf(`<details class="seq-drawer" id="${id}"`);
  if (i < 0) return '';
  const j = panel.indexOf('</details>', i);
  return panel.slice(i, j);
};
const zone = (marker, endMarker) => {
  const i = panel.indexOf(marker);
  if (i < 0) return '';
  const j = panel.indexOf(endMarker, i + marker.length);
  return panel.slice(i, j < 0 ? undefined : j);
};

console.log('== four zones, and every control in exactly one of them ==');
check(panel.length > 0, 'the panel is found in index.html');
check(/class="row seq-session"/.test(panel) && /<span id="seqBoardChip"/.test(panel),
  'the SESSION line carries the Level that scopes the picker and the board the sequence stands on');
check(/<div id="seqFigureBar" class="seq-bar" hidden>/.test(panel),
  'the FIGURE banner exists and starts hidden');
const composer = zone('id="seqGroup"', '<div class="row seq-timeline-head">');
for (const id of ['seqGroup', 'seqCallFilter', 'seqCallSelect', 'seqApply', 'seqParallel', 'seqStatus', 'seqSubsetInfo']) {
  check(composer.includes(`id="${id}"`), `${id} is in the composer`);
}
check(composer.indexOf('id="seqCallFilter"') < composer.indexOf('id="seqCallSelect"'),
  'and the Filter sits ABOVE the Call list it narrows');
// A SUBSET OF ONE: `reset()` must be able to say "nothing to clear", so the timeline owns it.
check(composer.indexOf('id="seqUndo"') < 0 && /id="seqUndo"/.test(panel),
  'Undo is NOT in the composer - it belongs to the timeline it edits');
const timeline = zone('<div class="row seq-timeline-head">', '<div class="seq-transport">');
for (const id of ['seqTotals', 'seqUndo', 'seqRedo', 'seqReset', 'seqSequence']) {
  check(timeline.includes(`id="${id}"`), `${id} is in the timeline header or its list`);
}
const transport = zone('<div class="seq-transport">', '<details class="seq-drawer" id="seqSolve"');
for (const id of ['seqPlay', 'seqStepBack', 'seqStepFwd', 'seqBeatInput', 'seqBeat', 'seqSpeed', 'seqScrub']) {
  check(transport.includes(`id="${id}"`), `${id} is in the transport`);
}
check(transport.indexOf('id="seqScrub"') > transport.indexOf('id="seqPlay"'),
  'and the scrub sits beside the transport that drives it, not between the buttons and the list');

console.log('\n== the secondary tools are DRAWERS, closed by default ==');
for (const [id, holds] of [
  ['seqSolve', ['seqTabGetout', 'seqTabGetin', 'seqTabFix', 'seqSolveRun', 'seqSolveApply', 'seqFixList', 'seqMatrixInfo']],
  ['seqBoard', ['seqFormation', 'seqSetFormation', 'seqBoardRot', 'seqView2d', 'seqFasr']],
  ['seqLibrary', ['seqModuleName', 'seqSaveModule', 'seqModules', 'seqAll8Text', 'seqAll8Import', 'seqAll8Export']],
  ['seqAdvanced', ['seqMargin', 'seqCopyPos']],
]) {
  const d = drawer(id);
  check(d.length > 0, `${id} is a <details> drawer`);
  check(!/<details[^>]*\sopen/.test(d), `${id} is CLOSED by default, so the primary flow fits without scrolling`);
  for (const child of holds) check(d.includes(`id="${child}"`), `  ${child} lives in ${id}`);
}
// FIVE SEARCH BUTTONS BECAME ONE QUESTION AND ONE APPLY.
check(!/id="seqGetout"|id="seqGetin"|id="seqFixIt"|id="seqApplyGetout"|id="seqMatrixGetout"/.test(html),
  'the five search buttons are gone, so there is one vocabulary for them');
check(/id="seqMatrixFirst" type="checkbox"/.test(panel),
  'and the rigid getout is a toggle on the getout QUESTION rather than a button of its own');

console.log('\n== one status line, one transport, one undo pair ==');
const idCount = (id) => (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
for (const id of ['seqStatus', 'seqPlay', 'seqScrub', 'seqUndo', 'seqRedo', 'seqCallSelect', 'seqSpeed']) {
  check(idCount(id) === 1, `exactly one #${id} in the document`);
}
check(/role="status" aria-live="polite"/.test(panel),
  'the status line is a live region, so the answer to Add is announced rather than only drawn');
check(/this\.statusEl\.className = 'seq-status';/.test(ui),
  'and the paint resets its colour, so a message cannot wear the previous one\'s kind');
check(/private setStatus\(kind: 'ok' \| 'warn' \| 'error', text: string\)/.test(ui),
  'writes that are not followed by a paint go through one setter');

console.log('\n== the TIMELINE is the document: a row per step, with beats, a bar and a delete ==');
const timelineFn = ui.slice(ui.indexOf('private renderTimeline()'), ui.indexOf('private markTimelineCurrent'));
check(/tabindex="0" data-idx="\$\{i\}"/.test(timelineFn), 'a row per history step, and it is focusable');
check(/aria-current="step"/.test(timelineFn), 'the row under the playhead is marked for a screen reader');
check(/\$\{perStep\[i\]\.toFixed\(1\)\} b/.test(timelineFn), 'each row shows the beats THAT step costs');
check(/seq-bar-fill" style="width:\$\{bar\}%"/.test(timelineFn), 'and a bar whose width is its share of the longest step');
check(/class="seq-del" data-del="\$\{i\}"/.test(timelineFn), 'with the delete on the row itself');
check(/esc\(stepLabel\(step\)\)/.test(timelineFn), 'the label is escaped - it carries authored call names');
// A FIGURE ROW IS MARKED, because it is the one row whose click does more than seek: it re-opens the figure
// (`resumeFigure`) so calls can be added to whatever beats are still free.
check(/const figure = isGroupStep\(step\);/.test(timelineFn) && /seq-fig-mark/.test(timelineFn)
  && /Click to re-open this figure and add calls to its free beats/.test(timelineFn),
  'a FIGURE row is marked, and says in its tooltip that the click re-opens the figure');
check(/const scale = Math\.max\(1, \.\.\.perStep\);/.test(timelineFn),
  'the bars are scaled by the LONGEST step, so a 16-beat call looks three times a 4-beat one');
check(/this\.stop \? this\.stop\.index : -1/.test(timelineFn) && /historyRowOfFlat\(badFlat\)/.test(timelineFn),
  'and the first step the walk cannot play is flagged from the engine\'s own stop, mapped to a ROW');
check(/No calls yet — pick a <b>Who<\/b>/.test(timelineFn),
  'the empty sequence teaches the flow instead of showing dim italics');
// THE PLAYMARK MUST NOT REBUILD THE LIST: this runs once per frame.
check(/markTimelineCurrent\(this\.stepAtPlayhead\(\)\)/.test(ui.slice(ui.indexOf('private renderPlayhead'))),
  'the playhead moves its row mark from the frame loop');
const markFn = ui.slice(ui.indexOf('private markTimelineCurrent'), ui.indexOf('private historyRowOfFlat'));
check(!/innerHTML/.test(markFn), 'and that mark touches class names only - never the list\'s markup');
check(/this\.stepStarts/.test(ui), 'the row a beat falls in is read from start beats computed once per rebuild');

console.log('\n== ADD, WHILE…, FINISH FIGURE: one vocabulary ==');
check(/>Add to sequence<\/button>/.test(panel), 'the primary button says Add to sequence');
check(/>While…<\/button>/.test(panel), 'the parallel button is named While…');
check(/>Finish figure<\/button>/.test(panel), 'and the way out of a figure says Finish figure');
check(/this\.applyBtn\.textContent = this\.parallel \? 'Add to lane' : 'Add to sequence';/.test(ui),
  'the primary button says what it will do in the mode it is in');
// A MESSAGE MUST NOT SEND THE CALLER TO A BUTTON THAT IS NOT THERE. Comments are excluded on purpose: the
// history of what the buttons used to be called belongs in the record, not in what the panel says.
const messageLines = ui.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
const staleNames = messageLines.filter((l) => /"\+ Parallel call"|Done finishes|press Apply/.test(l));
check(staleNames.length === 0,
  `no message still names a button that no longer exists${staleNames.length ? `: ${staleNames[0].trim()}` : ''}`);

console.log('\n== UNDO/REDO is one snapshot per action, and the keyboard is panel-scoped ==');
check(/private pushUndo\(\)/.test(ui) && /undoStack: HistorySnapshot\[\]/.test(ui) && /redoStack: HistorySnapshot\[\]/.test(ui),
  'undo/redo hold snapshots of the history');
check(/startBoard: this\.startBoard/.test(ui) && /this\.startBoard = snap\.startBoard;/.test(ui),
  'a snapshot holds the START BOARD too, so undoing Clear does not replay the calls from the wrong square');
for (const [fn, why] of [
  ['private applySelected()', 'Add'],
  ['private applyParallel()', 'a lane append'],
  ['private applySolve()', 'an applied getout'],
  ['private deleteStep(', 'a removed step'],
  ['private reset()', 'Clear'],
]) {
  const body = ui.slice(ui.indexOf(fn), ui.indexOf(fn) + 4000);
  check(/this\.pushUndo\(\)/.test(body.slice(0, body.indexOf('\n  }'))),
    `${why} takes a snapshot, so it is exactly one Undo`);
}
check(/^  keyBindings\(\): KeyBinding\[\] \{/m.test(ui) && /keyBindings\(\): KeyBinding\[\];/.test(ui),
  'the panel exports its own key bindings');
const bindings = ui.slice(ui.indexOf('keyBindings(): KeyBinding[] {'), ui.indexOf('private stepBy('));
for (const [key, what] of [
  ["key: ' '", 'Space plays'],
  ["key: 'ArrowLeft'", 'the arrows step beats'],
  ["key: 'z', mod: true", 'Ctrl+Z undoes'],
  ["key: 'Enter'", 'Enter adds'],
  ["key: 'Delete'", 'Delete removes the selected step'],
  ["key: 'Escape'", 'Escape leaves the figure'],
]) {
  check(bindings.includes(key), `${what} (${key})`);
}
check((bindings.match(/when: live/g) ?? []).length >= 8,
  'and every binding is panel-scoped, so none of them fires while the editor is the panel on screen');
check(/\.\.\.seqUi\.keyBindings\(\),/.test(main),
  'main.ts installs them in the one table, beside the editor\'s');
check(/hudEl\?\.classList\.toggle\('seq', seq\);/.test(main),
  'and the panel\'s own layout class is driven by the mode');

console.log('\n== the layout rules that make the zones work ==');
check(/#hud\.seq \{ display: flex; flex-direction: column; overflow: hidden; \}/.test(css),
  'the panel does not scroll when the sequencer is up - it is a flex column');
check(/#seqPanel\{|#hud\.seq #seqPanel \{ display: flex; flex-direction: column; min-height: 0; flex: 1; \}/.test(css),
  'and the panel fills it, so the timeline can be the only scrolling region');
check(/#seqPanel \.seq-timeline \{[^}]*overflow-y: auto/.test(css), 'the timeline is the scrolling region');
check(/#seqPanel \.seq-transport \{ flex: 0 0 auto;/.test(css), 'the transport is pinned rather than scrolled away');
check(/#hud :focus-visible \{ outline: 2px solid var\(--accent\)/.test(css),
  'and the app has a focus style, which a keyboard-driven transport needs');

console.log('\n== every id the panel reaches for exists in the markup ==');
// THE ONE FAILURE MODE A REDESIGN OF THIS SIZE CANNOT HAVE: `el()` casts `null` to the element type, so a
// renamed or mistyped id is not a type error - it is a crash on the first property read, in the browser, at
// the moment that row is first painted. `tsc` cannot see it and the DOM-free probes cannot either, so the
// two files are cross-checked here.
const wanted = [...ui.matchAll(/el<[^>]+>\('([^']+)'\)/g)].map((m) => m[1]);
check(wanted.length > 20, `the panel reaches for ${wanted.length} elements by id`);
const missing = [...new Set(wanted)].filter((id) => !new RegExp(`id="${id}"`).test(html));
check(missing.length === 0, `every one of them exists in index.html${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
check(new Set(wanted).size === wanted.length,
  'and each is declared once, so two fields cannot drift apart over the same control');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
