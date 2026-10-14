// Probe: THE KEYBOARD TABLE - does a shortcut fire exactly when it should, and never when it should not?
//
// Asked for: "Add a keyboard shortcut system, as i'll add others in the future". A system with N shortcuts
// has N ways to be wrong, and the four that matter are the same four for all of them: a modifier that is not
// named, a field the caller is typing into, a key held down, and a panel that is not on screen.
//
// THIS DRIVES THE REAL MODULE, not a restatement of it. `src/keys.ts` takes its listener target as an
// argument, so a plain object stands in for `document` and synthetic events go through the same
// `matchKey`/`dispatchKey` the app runs - which is the whole reason the policy lives in a module rather than
// inside a `keydown` handler that can only be read with a regex.
//
// Run: node tools/keys-probe.mjs   (from anywhere; no engine build needed - this module is pure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = await import(pathToFileURL(path.join(POC_DIR, 'src', 'keys.ts')).href);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** A stand-in for `document`: it records how many listeners were attached, and fires them on demand. */
function fakeTarget() {
  const listeners = new Map();
  const t = {
    added: 0,
    removed: 0,
    addEventListener(type, fn) { t.added++; listeners.set(type, fn); },
    removeEventListener(type, fn) { t.removed++; listeners.delete(type); },
    fire(ev) {
      const fn = listeners.get('keydown');
      if (!fn) throw new Error('no keydown listener is installed');
      fn(ev);
    },
    count: () => listeners.size,
  };
  return t;
}

/** A stand-in for a KeyboardEvent. Only the fields `keys.ts` reads, plus the default it can cancel. */
function keyEvent(key, opts = {}) {
  return {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    altKey: !!opts.alt,
    shiftKey: !!opts.shift,
    repeat: !!opts.repeat,
    target: opts.target ?? { tagName: 'BODY' },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

// ============================================================ 1. the four decisions
console.log('== 1. A bare key: fires on the key, and on NOTHING that merely contains it ==');
{
  let runs = 0;
  const target = fakeTarget();
  keys.installKeys([{ id: 'g', key: 'g', run: () => { runs++; } }], target);

  const plain = keyEvent('g');
  target.fire(plain);
  check(runs === 1, 'a bare `g` runs the binding');
  check(plain.defaultPrevented, 'and its default is cancelled, so the key does not reach the browser as well');

  const upper = keyEvent('G');
  target.fire(upper);
  check(runs === 2, 'and `G` is the same shortcut - the comparison is case-insensitive, so Shift is not required');

  for (const [name, opts] of [['Ctrl+G', { ctrl: true }], ['Cmd+G', { meta: true }], ['Alt+G', { alt: true }], ['Shift+G', { shift: true }]]) {
    const ev = keyEvent('g', opts);
    target.fire(ev);
    check(runs === 2 && !ev.defaultPrevented,
      `${name} is LEFT ALONE: an unmentioned modifier must not be held, so the browser's own "find again" is not swallowed`);
  }
}

console.log('\n== 2. The command key is one flag, and it means what it says ==');
{
  const seen = [];
  const target = fakeTarget();
  keys.installKeys([{ id: 'undo', key: 'z', mod: true, run: () => seen.push('undo') }], target);

  target.fire(keyEvent('z', { ctrl: true }));
  target.fire(keyEvent('z', { meta: true }));
  check(seen.length === 2, 'Ctrl+Z and Cmd+Z are the same shortcut, which is what undo means on both platforms');

  for (const [name, opts] of [['a bare z', {}], ['Ctrl+Shift+Z', { ctrl: true, shift: true }], ['Ctrl+Alt+Z', { ctrl: true, alt: true }]]) {
    const ev = keyEvent('z', opts);
    target.fire(ev);
    check(seen.length === 2 && !ev.defaultPrevented, `${name} does NOT undo: a modifier that IS named must match too`);
  }
}

console.log('\n== 3. A field being typed into keeps its keys ==');
{
  let runs = 0;
  const target = fakeTarget();
  keys.installKeys([
    { id: 'bare', key: 'g', run: () => { runs++; } },
    { id: 'escape-hatch', key: 'Escape', whileTyping: true, run: () => { runs += 10; } },
  ], target);

  for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    target.fire(keyEvent('g', { target: el }));
  }
  check(runs === 0, 'a bare letter does nothing while the caller is typing into an input, a textarea, a select or a contenteditable - the `g` in a call filter is not a shortcut');

  target.fire(keyEvent('g', { target: { tagName: 'BODY' } }));
  check(runs === 1, 'and it is live again the moment the focus is on the page');
  target.fire(keyEvent('Escape', { target: { tagName: 'INPUT' } }));
  check(runs === 11, 'while a binding that ASKS for it (`whileTyping`) does fire inside a field');

  // A SCRUB BAR IS A CONTROL, NOT A FIELD, and this is the check the reported defect fails. `edScrub`,
  // `seqScrub` and `#scrub` are `<input type="range">`, and while `isTypingTarget` read only `tagName` every
  // click on one of them silenced W, A/F, S, E, G/B and Ctrl+Z. THE TWO LINES ARE ONE CHECK: a range that
  // fires is only correct BECAUSE the text input under it does not, so a rule that simply deleted the guard
  // passes the first `check` and fails the second.
  target.fire(keyEvent('g', { target: { tagName: 'INPUT', type: 'range' } }));
  check(runs === 12, 'but a SCRUB BAR IS NOT A FIELD: a bare letter fires while an <input type="range"> holds the focus');
  target.fire(keyEvent('g', { target: { tagName: 'INPUT', type: 'text' } }));
  check(runs === 12, 'and the text input beside it is the NEGATIVE CONTROL - the range fires only because this one does not');
}

console.log('\n== 4. Holding the key down flips once, not back and forth ==');
{
  let runs = 0;
  const target = fakeTarget();
  keys.installKeys([
    { id: 'once', key: 'g', run: () => { runs++; } },
    { id: 'held', key: 'h', repeat: true, run: () => { runs += 10; } },
  ], target);
  target.fire(keyEvent('g', { repeat: true }));
  check(runs === 0, 'an auto-repeat keystroke does not run a binding that did not ask for it, so holding G toggles once');
  target.fire(keyEvent('g', { repeat: false }));
  target.fire(keyEvent('h', { repeat: true }));
  check(runs === 11, 'and a binding that DOES ask for repeats gets them');
}

console.log('\n== 5. Ownership, order and one listener ==');
{
  const order = [];
  const target = fakeTarget();
  const off = keys.installKeys([
    { id: 'scoped-off', key: 'k', when: () => false, run: () => order.push('scoped-off') },
    { id: 'first', key: 'k', run: () => order.push('first') },
    { id: 'second', key: 'k', run: () => order.push('second') },
  ], target);

  check(target.added === 1 && target.count() === 1,
    'ONE listener is installed for the whole table, however many bindings there are');
  target.fire(keyEvent('k'));
  check(order.length === 1 && order[0] === 'first',
    `the FIRST matching binding wins and the later ones do not run (${order.join(',')}) - and \`when\` decides ownership before order does`);

  const unbound = keyEvent('q');
  target.fire(unbound);
  check(order.length === 1 && !unbound.defaultPrevented,
    'a key no binding owns is left entirely alone: nothing runs and the default is not cancelled');

  off();
  check(target.removed === 1 && target.count() === 0, 'and the disposer takes the one listener back off');

  // WHY THE GRID TOGGLE HAD TO MOVE OFF `G` RATHER THAN SHARE IT. The app's table is the grid binding first
  // and the panels after it (`main.ts`: `installKeys([...])` then `...editorUi.keyBindings()`), so two bindings
  // on one letter is not a conflict the table can report - the FIRST one silently wins and the second is dead.
  // Driven here with the real dispatcher, on the two bindings exactly as they would be spelled.
  const clash = [];
  const t2 = fakeTarget();
  const undoClash = keys.installKeys([
    { id: 'grid-mode', key: 'g', run: () => clash.push('grid') },
    { id: 'editor-select-girls', key: 'g', when: () => true, run: () => clash.push('girls') },
  ], t2);
  t2.fire(keyEvent('g'));
  check(clash.length === 1 && clash[0] === 'grid',
    `two bindings on one letter do NOT both run - the first wins and the second is unreachable (${clash.join(',')}), which is what moving the grid to W is for`);
  undoClash();
}

console.log('\n== 6. A table that cannot be trusted is refused ==');
{
  const target = fakeTarget();
  const throws = (bindings) => { try { keys.installKeys(bindings, target); return false; } catch { return true; } };
  check(throws([{ id: 'a', key: 'g', run: () => {} }, { id: 'a', key: 'h', run: () => {} }]),
    'two bindings sharing an id are refused, because one would silently shadow the other');
  check(throws([{ id: '', key: 'g', run: () => {} }]), 'a binding with no id is refused');
  check(throws([{ id: 'a', key: '', run: () => {} }]), 'and one with no key is refused, because it could never fire');
  check(target.count() === 0, 'and none of the three attached a listener on the way out');
}

// ============================================================ 7. the pieces on their own
console.log('\n== 7. The predicates, on their own ==');
check(keys.normaliseKey('G') === 'g' && keys.normaliseKey('Escape') === 'escape',
  'a letter and a named key are normalised the same way, so one comparison covers both');
check(keys.isTypingTarget({ tagName: 'INPUT' }) && keys.isTypingTarget({ tagName: 'div', isContentEditable: true }),
  'and a field is recognised by tag or by contenteditable');
check(!keys.isTypingTarget({ tagName: 'BODY' }) && !keys.isTypingTarget(null) && !keys.isTypingTarget(undefined),
  'while the page, and nothing at all, are not fields');
check(keys.isTypingTarget({ tagName: 'INPUT', type: 'text' }) && keys.isTypingTarget({ tagName: 'INPUT', type: 'number' }),
  'a TEXT-ENTRY input is a field, whatever its type - a number edits by arrow key, so it is not up for grabs');
check(!keys.isTypingTarget({ tagName: 'INPUT', type: 'range' }) && !keys.isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }),
  'and a scrub bar and a checkbox are CONTROLS rather than fields: the caller points at them, and the next key is a shortcut');

// ============================================================ 8. the wiring, read from source
console.log('\n== 8. The app uses the table, and no longer hand-rolls a listener ==');
const read = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8');
const mainSrc = read('src/main.ts');
const editorSrc = read('src/editor-ui.ts');
// Read for the collision check below: two panels' tables are installed side by side, and first-match-wins
// means a letter claimed twice is a binding that silently stops working.
const seqSrc = read('src/sequencer-ui.ts');
// Read for the scrub-bar check below: the reported defect names real controls, and the predicate above is
// only about them if the markup really spells them as range inputs.
const indexSrc = read('index.html');

check(/installKeys\(\[/.test(mainSrc), 'main.ts installs the table, once, for the whole app');
check(/\bid: 'grid-mode',\s*\n\s*key: 'w',/.test(mainSrc),
  'and the W grid toggle is a LINE in it - a document-level binding, which is what "works globally for all boards" means');
{
  const m = mainSrc.match(/id: 'grid-mode',\s*\n\s*key: 'w',([\s\S]{0,120}?)\n\s*\}/);
  check(!!m && !/mod:|alt:|shift:/.test(m[1]),
    'spelled as a BARE key - no modifier required and none tolerated, which is what leaves Cmd+W (close tab) to the browser');
}
check(/\.\.\.editorUi\.keyBindings\(\)/.test(mainSrc),
  'and each panel hands in its own, because only the panel knows when its shortcuts are live');
check(!/document\.addEventListener\('keydown'/.test(mainSrc),
  'main.ts no longer owns a keydown handler of its own - the table is the only one');

check(/keyBindings\(\): KeyBinding\[\]/.test(editorSrc), 'the editor exposes its own bindings');
check(/\bid: 'editor-undo',\s*\n\s*key: 'z',\s*\n\s*mod: true,/.test(editorSrc),
  'the Ctrl/Cmd+Z undo has moved onto the table, with `mod` for the platform command key');
check(/when: \(\) => this\.active && this\.isInstanceMode\(\)/.test(editorSrc),
  'and says where it is live with `when`, rather than by owning a listener that has to check');
check(/id: 'editor-handle-mode',[\s\S]{0,80}?key: 's',/.test(editorSrc),
  'the S key flips the handle mode between ends and controls, as a bare key in the same table');
check(/id: 'editor-edit-scope',[\s\S]{0,80}?key: 'e',/.test(editorSrc),
  "the E key rotates the board's EDIT state, as a bare key in the same table");
check(/when: \(\) => this\.active && this\.isInstanceMode\(\),[\s\S]{0,90}?run: \(\) => this\.cycleEditScope\(\)/.test(editorSrc),
  'live wherever the Edit row is on screen, which is the instance tab');
check(/when: \(\) => this\.hasSelectedMove\(\)/.test(editorSrc),
  'live only when there IS a move on screen to flip handles for');
check(/private hasSelectedMove\(\): boolean \{[\s\S]{0,400}?this\.isInstanceMode\(\)[\s\S]{0,200}?this\.moveIndex < d\.path\.length/.test(editorSrc),
  'which asks what the move tile itself needs - this panel, an instance, a dancer and a move at the selected index');
// THE GENDER SELECTS, on the letters the buttons are named for. Both halves are checked against the SOURCE,
// because the claim is not "G does something" but "G runs the same thing a click runs, where a click would".
check(/id: 'editor-select-girls',[\s\S]{0,60}?key: 'g',/.test(editorSrc) &&
  /id: 'editor-select-boys',[\s\S]{0,60}?key: 'b',/.test(editorSrc),
  'G and B are the two gender selects, on the letters those buttons carry');
check(/id: 'editor-select-girls',[\s\S]{0,200}?run: \(\) => this\.cycleGenderPicks\('girl'\)/.test(editorSrc) &&
  /id: 'editor-select-boys',[\s\S]{0,200}?run: \(\) => this\.cycleGenderPicks\('boy'\)/.test(editorSrc),
  'and each runs the SAME cycle method the button\'s own click handler runs, so the ticks cannot disagree with the label');
check(/id: 'editor-select-girls',[\s\S]{0,120}?when: \(\) => this\.active && this\.hasGender\('girl'\)/.test(editorSrc) &&
  /id: 'editor-select-boys',[\s\S]{0,120}?when: \(\) => this\.active && this\.hasGender\('boy'\)/.test(editorSrc),
  'live by the SAME test the button\'s `disabled` uses, so a key cannot select a set the button would have refused');
check(/private hasGender\(gender: Gender\): boolean \{[\s\S]{0,120}?this\.genderPicks\(gender, 0\)\.length > 0/.test(editorSrc) &&
  /this\.selBoysBtn\.disabled = !this\.hasGender\('boy'\);/.test(editorSrc) &&
  /this\.selGirlsBtn\.disabled = !this\.hasGender\('girl'\);/.test(editorSrc),
  'and that test is ONE function the button state reads too, rather than a second copy of the rule');
// THE MOVE STRIP'S TWO KEYS, pinned on the same three facts the gender pair is: the letters, the ONE method
// they run (so the key and the strip cannot disagree about which slot is next), and the `when` that makes them
// live exactly when the tile is.
check(/id: 'editor-move-prev',[\s\S]{0,60}?key: 'a',/.test(editorSrc) &&
  /id: 'editor-move-next',[\s\S]{0,60}?key: 'f',/.test(editorSrc),
  'A and F are the two move-step keys');
check(/id: 'editor-move-prev',[\s\S]{0,200}?run: \(\) => this\.stepMove\(-1\)/.test(editorSrc) &&
  /id: 'editor-move-next',[\s\S]{0,200}?run: \(\) => this\.stepMove\(1\)/.test(editorSrc),
  'and each runs the one `stepMove`, whose wrap is the imported rule in `move-nav.ts` (`move-nav-probe.mjs`)');
check(/id: 'editor-move-prev',[\s\S]{0,120}?when: \(\) => this\.hasSelectedMove\(\)/.test(editorSrc) &&
  /id: 'editor-move-next',[\s\S]{0,120}?when: \(\) => this\.hasSelectedMove\(\)/.test(editorSrc),
  'live by the SAME `hasSelectedMove` test `S` uses, so a step cannot be taken with no strip on screen');
// AND NOTHING ELSE MAY CLAIM EITHER LETTER: the table is first-match-wins, so a second binding on `a` or `f`
// would leave one of the two silently dead rather than reporting a conflict.
check(!/key: 'a',/.test(mainSrc) && !/key: 'f',/.test(mainSrc) && !/key: 'a',/.test(seqSrc) && !/key: 'f',/.test(seqSrc),
  'and no binding outside the editor claims A or F, so first-match-wins cannot kill a step key');
check(!/id: 'grid-mode'[\s\S]{0,80}?key: 'g'/.test(mainSrc),
  'with G no longer the grid toggle, so the two bindings cannot both claim it - the table is first-match-wins');
check(!/window\.addEventListener\('keydown'/.test(editorSrc),
  'and the editor no longer hand-rolls its own keydown either - there is ONE listener in the app');
// THE CONTROLS THE DEFECT WAS REPORTED AGAINST really are range inputs, so §3 and §7 are about the slider the
// caller clicked rather than an element invented for the probe.
check(/<input id="edScrub" type="range"/.test(indexSrc) && /<input id="seqScrub" type="range"/.test(indexSrc),
  'and the two scrub bars are `<input type="range">` in the markup, which is why reading only the tag made them fields');

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
