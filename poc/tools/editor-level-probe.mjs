// Probe: DOES THE EDITOR'S LEVEL SELECTOR NARROW THE LISTS WITHOUT TAKING THE CALL AWAY?
//
// The request: "In the call editor | edit instance, add a Level selector ... under the Mode element,
// and make MS the default selection", named Level "like the other screens".
//
// There is nothing here to measure numerically: the behaviour lives in DOM code that no engine harness
// can run. What CAN be checked is the wiring, and two of these rules are the ones that would break
// silently:
//
//   1. THE LEVEL GOES INTO THE ONE PLACE THAT BUILDS A CALL LIST (`fillCallSelect`), not into a second
//      filtering path beside it. Three selects are filled from that one function, so a level applied
//      anywhere else narrows some lists and not others.
//   2. IT IS A VIEW, NOT A LOAD. `fillCallSelect` re-inserts the currently selected call when either
//      control excludes it, and the level handler must NOT reload the instance: changing the selector
//      would otherwise throw away edits in progress, which is the one thing a filter must not do.
//
// Run: node tools/editor-level-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** A method's body, from its signature to the `\n  }` that closes it at class-member indentation. */
function body(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) return '';
  const end = src.indexOf('\n  }\n', i);
  return end < 0 ? src.slice(i) : src.slice(i, end);
}

/** The rules, applied to the panel's source so the same analysis can run over a broken copy. */
function wiring(html, editor) {
  const fill = body(editor, 'private fillCallSelect(');
  const filter = body(editor, 'private applyCallFilter(');
  const handler = /this\.levelSel\.addEventListener\('change', \(\) => ([^;]*)\);/.exec(editor);
  return {
    // The control is a LEVEL control under Mode, and it is the same kind of control the other
    // screens carry (a select, filled from the catalogue).
    underMode: /<select id="edMode">[\s\S]*?<\/select>\s*<\/div>\s*<div class="row">[\s\S]*?<select\s+id="edLevel"/.test(html),
    // MS by default, and only when the catalogue really has it.
    defaultsToMs: /const DEFAULT_LEVEL = 'ms'/.test(editor) && /this\.levelSel\.value = DEFAULT_LEVEL/.test(editor),
    // Every level reachable, so the selector is a narrowing and not a wall.
    allLevels: /new Option\('All levels', ''\)/.test(editor),
    // The catalogue decides which levels are offered.
    fromCatalogue: /for \(const lv of availableLevels\(\)\) this\.levelSel\.add/.test(editor),
    // The level filters INSIDE the one function that builds a call list...
    filtersInFill: /const level = this\.levelSel\.value;/.test(fill) && /if \(level && c\.level !== level\) continue;/.test(fill),
    // ...and the entries carry the TITLE alone, the level having moved to the selector above them.
    titleOnly: /const label = \(c: CallInfo\) => c\.title;/.test(fill),
    // ...and the selection is still kept when the level excludes it.
    keepsSelection: /const opt = new Option\(`▸ \$\{label\(keep\)\}`/.test(fill) && /sel\.insertBefore\(opt, sel\.firstChild\)/.test(fill),
    // All three lists are filled from that one function and nowhere else.
    fillsAllThree: (filter.match(/this\.fillCallSelect\(/g) || []).length === 3
      && (editor.match(/this\.fillCallSelect\(/g) || []).length === 3,
    // And the handler only re-narrows: it reloads nothing.
    viewOnly: handler !== null && /applyCallFilter\(\)/.test(handler[1]) && !/load(Instance|EditSetup|Post|Pre)\s*\(/.test(handler[1]),
  };
}

const html = read('index.html');
const src = { 'editor-ui.ts': read('src/editor-ui.ts') };
const good = wiring(html, src['editor-ui.ts']);

console.log('== the wiring, as it is ==');
check(good.underMode, 'the Level selector is a row of its own directly under the Mode row');
check(good.defaultsToMs, 'and it opens on MS, but only after checking the catalogue actually has that level (a select ignores an id it does not hold, so setting it blindly would leave the first option selected and the default a lie)');
check(good.allLevels, 'with "All levels" among the options: the level narrows what the lists OFFER, and without it every other level would be unreachable from the editor');
check(good.fromCatalogue, 'the levels offered come from the loaded catalogue, the same rule the browse and sequence views use');
check(good.filtersInFill, 'the level is applied INSIDE `fillCallSelect`, the one function that builds a call list');
check(good.titleOnly, 'and the entries carry the call TITLE alone: the level is stated once by the selector above the list instead of being repeated at the start of every name');
check(good.keepsSelection, 'and the selected call is still re-inserted when the level excludes it');
check(good.fillsAllThree, 'all three lists (edit, post, pre) are filled through that one function, so no list can be narrowed differently');
check(good.viewOnly, 'changing the level only re-narrows the lists: it does not reload the instance, which is what would silently discard an edit in progress');

// ---------------------------------------------------------------------------
// THE FACING OVERRIDE IS GONE, and this is what says so rather than leaving it to a diff.
//
// Asked for as: "The Facing selector is not required. It is always auto selected." It is: `poseFor` reads each
// move's AUTHORED rotation curve and falls back to the travel tangent only where that move has none, so the
// data already picks per move, and a selector over the top could only disagree with it. The option that WAS
// there - "Along travel" - forced every move to follow its tangent, which is a different dance from the one the
// file describes.
console.log('\n== the Facing override is gone, and the authored reading is the only one ==');
const browser = read('src/browser.ts');
check(!/<select\s+id="facing"/.test(html), 'no `#facing` selector is left in the panel');
check(!/facingSelect/.test(browser), 'and nothing reads one, so removing the control cannot leave a null behind');
check(/allPoses\(call, t, 'rotation'\)/.test(browser), "and the preview poses the dancers with the call's OWN facing, which is what `poseFor` reads move by move");
// THE CONTROL ON THE CONTROL: this removed a UI override, not an engine capability, and the engine side is
// checked so that "the mode is gone everywhere" cannot be mistaken for the same thing.
check(/'rotation' \| 'travel'/.test(read('../engine/src/core.ts')), 'the ENGINE still carries both heading modes - this removed a control, not a capability');

// The default is a STRING, and a string that named a programme the catalogue does not carry would set
// nothing (see `populateLevels`), so it is checked against the catalogue's own level list rather than
// against the request that asked for it.
console.log('\n== the default is a level the catalogue really carries ==');
const levelOrder = (/levelOrder = \[([^\]]*)\]/.exec(read('src/data.ts'))?.[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
const def = /const DEFAULT_LEVEL = '([^']+)'/.exec(src['editor-ui.ts'])?.[1] ?? '';
const offersLevel = (lv) => {
  const dir = path.join(POC_DIR, 'src/assets', lv);
  return levelOrder.includes(lv) && fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.xml'));
};
check(def !== '' && offersLevel(def), `the default \`${def}\` is in the catalogue's level order and has calls under src/assets/${def}`);
check(!offersLevel('mainstream') && !offersLevel(''), 'and a default naming a programme the catalogue does not carry is caught, as is an empty one');

// ---------------------------------------------------------------------------
// THE BROWSE LIST'S Edit BUTTON, and the whole chain it has to travel.
//
// Asked for: "On the Browse calls tab, add an Edit button ager the del button that opens the selected call in the
// call Editor tab", placed at "the end of the row of buttons titled xml, In Corpus and del".
//
// IT IS A CROSS-PANEL JUMP, so every link is checked rather than the endpoints: the row has to grow a fourth
// button in the right place, the handler has to pass IDs rather than the prose `origin`, the host interface has
// to declare the method, `main.ts` has to switch the MODE and not just call through, and the editor has to load
// the call the same way its own dropdowns do.
console.log("\n== the Browse list's Edit button, end to end ==");
const browserSrc = read('src/browser.ts');
const formationsSrc = read('src/formations.ts');
const mainSrc = read('src/main.ts');
const editorSrc = read('src/editor-ui.ts');
check(/data-del="\$\{i\}"[\s\S]{0,500}?data-load="\$\{i\}"[\s\S]{0,700}?data-edit="\$\{i\}"/.test(browserSrc),
  'the row runs ... del, LOAD, Edit - the load sits between them, which is where it was asked for');
// ---------------------------------------------------------------------------
// AND THE load BUTTON, which loads the call into the BROWSE tab itself.
//
// Asked for: "Add a load before the edit button, the loads the call into the Browse Call tab and sets the Level,
// Call and Setup according to the setup for the load button."
//
// THE ORDER IS THE INVARIANT. `populateCalls` only offers the calls of the level the selector names, so setting
// the Call before the Level would be choosing it from a list that does not contain it - the same trap the
// editor's `openCall` has, and the same fix.
const bodyOf = (sig) => {
  const i = browserSrc.indexOf(sig);
  return i < 0 ? '' : browserSrc.slice(i, browserSrc.indexOf('\n  }\n', i));
};
const loadFn = bodyOf('private loadFormationCall(');
check(/button\[data-load\]/.test(browserSrc) && /this\.loadFormationCall\(f\)/.test(browserSrc),
  'the load button calls one method');
check(loadFn !== '', 'which exists');
check(/this\.levelSelect\.value = entry\.level;[\s\S]{0,140}?this\.populateCalls\(callId\);/.test(loadFn),
  'the LEVEL is set BEFORE the call is chosen, because the call list only offers that level');
check(/this\.refreshSetups\(\);[\s\S]{0,240}?this\.tamSelect\.value = idx;/.test(loadFn),
  'and the SETUP is chosen after the setups are rebuilt for that call');
check(/this\.loadCurrent\(\);/.test(loadFn),
  'and it actually shows the call, through the same load the selectors use');
check(/if \(this\.callSelect\.value !== callId\)/.test(loadFn),
  'and a call the level does not offer is REPORTED rather than leaving the panel on whatever was there before');
// ONE RULE FOR THE TARGET, so the two buttons cannot disagree about which call a formation row means.
check((browserSrc.match(/this\.formationTarget\(f\)/g) ?? []).length === 2,
  'both `load` and `Edit` resolve their target through the one helper');
check(/callId: f\.callId \?\? this\.callSelect\.value,[\s\S]{0,90}?setupIdx: f\.setupIdx \?\? parseInt/.test(browserSrc),
  'which prefers the ids the formation was made with and falls back to the current selection for older ones');// AND THE NAME ABOVE THEM. Read the other way round the row is a toolbar with the name trailing off the end of
// it - and with four buttons there is often no room left for the name at all. Asked for as: "I think the text
// should be above the bottons, as it looks confusing the other way round."
check(/ed-formation"><span class="part">[\s\S]{0,320}?data-xml="\$\{i\}"/.test(browserSrc),
  'the formation NAME comes first, before any of the buttons');
check(/#hud \.row\.ed-formation \.part \{ flex: 1 0 100%; \}/.test(read('src/style.css')),
  'and the stylesheet gives it the whole first line, so the buttons really start on the next one rather than sharing it');
// The handler resolves the target through the shared helper (checked below, where the ids and the fallback
// live) and then goes through the host rather than reaching into the editor itself.
check(/button\[data-edit\]/.test(browserSrc) && /this\.host\.openEditor\(t\.callId, t\.setupIdx/.test(browserSrc),
  'and its handler goes through the host rather than reaching into the editor itself');
check(/callId\?: string;[\s\S]{0,200}?setupIdx\?: number;/.test(formationsSrc),
  'which is why a formation now stores those ids: `origin` is display text and cannot be resolved back to a call');
check(/callId: this\.callSelect\.value,[\s\S]{0,80}?setupIdx: parseInt\(this\.tamSelect\.value/.test(browserSrc),
  'and they are recorded at the moment it is created');
check(/openEditor\(callId: string, setupIdx: number/.test(browserSrc), 'the host interface declares it');
check(/openEditor: \(callId, setupIdx[\s\S]{0,200}?modeSelect\.value = 'editor';[\s\S]{0,120}?applyMode\(\);[\s\S]{0,90}?editorUi\.openCall\(callId, setupIdx/.test(mainSrc),
  'and the app switches the MODE SELECTOR to the editor and applies it - a call that loaded without the panel being shown would look like nothing happened');
// The IMPLEMENTATION, not the interface declaration, which indexOf finds first and which has no body.
// The IMPLEMENTATION, not the interface declaration - indexOf finds the interface first and it has no body.
const oi = editorSrc.indexOf('openCall(callId: string, setupIdx: number) {');
const openCall = oi < 0 ? '' : editorSrc.slice(oi, editorSrc.indexOf('\n  }\n', oi));
check(openCall !== '', 'the editor has an `openCall`');
check(/this\.loadEditSetup\(\);\s*\n\s*this\.loadInstance\(\);/.test(openCall), 'and it loads the setup and the instance');
check(/this\.levelSel\.value = '';[\s\S]{0,160}?this\.callQuery = '';[\s\S]{0,60}?this\.applyCallFilter\(\);/.test(openCall),
  'and it clears the Level and the Find filter when the call would otherwise not be in the list');
check(!/instanceEdited = true/.test(openCall) && !/setMove\(|commit\(|setDancer(Start|End|Gender)\(/.test(openCall),
  'and it EDITS NOTHING - choosing a call and loading it is what clicking the two lists does, so a caller who only wanted to look has changed nothing and Save is not offered');
// ---------------------------------------------------------------------------
// THE FULL SQUARE, ALWAYS - the mirror checkbox is gone.
//
// Asked for as: "The full square (mirror) checkbox is not required as it should always be enabled." It decides
// whether a half-set `<tam>` is built as four dancers or mirrored to eight, and a formation is half the set it
// represents - so the whole set is the only reading there is. The control, the plumbing that carried its state
// into the editor, and the field a formation stored it in are all removed rather than left switched on.
console.log('\n== the full square is the only reading ==');
// (`editorSrc`, `browserSrc`, `mainSrc` and `formationsSrc` are read once above, by the sections that check the
// Edit button.)
check(!/<input id="mirror"/.test(html), 'the checkbox is GONE from the panel');
check(!/mirrorCheck/.test(mainSrc) && !/mirrorCheck/.test(browserSrc),
  'and nothing reads or writes it - a control removed while something still reads it would be the same bug wearing a different face');
check(!/onMirrorChange/.test(browserSrc), 'the handler that reloaded on it is gone too');
check(/this\.showCall\(loadCall\(id, tamIndex, true\)\);/.test(browserSrc),
  'the Browse tab loads the FULL SQUARE, which is the only reading there is');
check(!/instanceMirror/.test(editorSrc) && /loadCall\(id, tam, true\)/.test(editorSrc),
  'and the editor does the same, by the same rule rather than by a flag carried between panels');
check(!/mirror\?: boolean;/.test(formationsSrc) && !/f\.mirror/.test(browserSrc),
  'and a formation no longer stores a reading that cannot vary');
check(/openEditor\(callId: string, setupIdx: number\): void;/.test(browserSrc) && /openCall\(callId: string, setupIdx: number\): void;/.test(editorSrc),
  'so the Edit path carries the call and the setup and nothing else');
console.log('\n== the check fails on the bugs it was written for ==');
{
  const unfiltered = wiring(html, src['editor-ui.ts'].replace('const level = this.levelSel.value;', 'const level = \'\';'));
  check(!unfiltered.filtersInFill, 'the selector stops narrowing anything when the filter line goes (the panel would show every level while the control claimed MS)');

  const noDefault = wiring(html, src['editor-ui.ts'].replace('this.levelSel.value = DEFAULT_LEVEL;', 'this.levelSel.value = \'\';'));
  check(!noDefault.defaultsToMs, 'and the default is not the default once the assignment goes');

  const reloads = wiring(html, src['editor-ui.ts'].replace("this.levelSel.addEventListener('change', () => this.applyCallFilter());", "this.levelSel.addEventListener('change', () => { this.loadInstance(); });"));
  check(!reloads.viewOnly, 'and a level change that reloads the instance is caught: the call would be replaced and edits in progress lost');

  const unpinned = wiring(html, src['editor-ui.ts'].replace('sel.insertBefore(opt, sel.firstChild);', 'void keep;'));
  check(!unpinned.keepsSelection, 'and so is dropping the pinned option, which is what makes the filter a view rather than a way to change what you have selected');

  const prefixed = wiring(html, src['editor-ui.ts'].replace('const label = (c: CallInfo) => c.title;', 'const label = (c: CallInfo) => `${c.level.toUpperCase()} · ${c.title}`;'));
  check(!prefixed.titleOnly, 'and the level prefix is caught when it comes back at the start of every call name');

  // The Facing removal, checked against the two ways it could come back: put the control back in the panel, or
  // read a mode from somewhere. A check that only looked for the missing element would pass on a panel whose
  // selector had merely been RENAMED, and the read is the half that actually decides how the dancers pose.
  const restored = html.replace('<label title="Look straight down', '<select id="facing"><option value="rotation">r</option></select><label title="Look straight down');
  check(/<select\s+id="facing"/.test(restored) && !/<select\s+id="facing"/.test(html), 'the check catches the control being put BACK, and passes on the panel as it stands');
  check(!/allPoses\(call, t, 'rotation'\)/.test(browser.replace("allPoses(call, t, 'rotation')", 'allPoses(call, t, this.facingSelect.value)')), 'and catches the mode being read from a control again, which is the half that would actually change the dance');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
