// Probe: DELETING A SAVED MODULE FROM THE LIBRARY DRAWER.
//
// Asked for: "Add a delete icon after each module listed under Library. This will remove the user defined
// Module from the system."
//
// THE ENGINE HALF IS MEASURED BY IMPORT, not mirrored: `unregisterModule` is a real removal on the same
// map `registerModule` writes to, so the probe can register one and ask whether it is gone. The engine had
// no way to remove a module before this, and the two obvious alternatives are both wrong, which is why the
// method exists at all:
//
//   - rebuilding the library DOES drop the registration, and the panel already does that on a level change
//     (`rebuildSeq`) - but that path also clears the history and resets the board, so using it to delete
//     one saved module would throw away the sequence the caller has open.
//   - doing nothing to the live library leaves the module in the CALL PICKER until something else happens
//     to rebuild it, which is a half-deletion the caller sees at once.
//
// The panel half is wiring, which no engine harness can run, so it is read as source.
//
// Run: node poc/tools/module-delete-probe.mjs   (from anywhere; build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const read = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');
const ui = read('src/sequencer-ui.ts');
const css = read('src/style.css');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

console.log('== 1. the removal itself, through the engine ==');
{
  const seq = new engine.Sequencer(read('../assets/moves.xml'), read('../assets/formations.xml'));
  const NAME = 'Probe Module';
  seq.registerModule(NAME, ['Pass Thru']);
  check(seq.isModule(NAME), 'a registered module IS a module');
  check(seq.listModules().includes(NAME), 'and it is listed');
  check(seq.getModules().some((m) => m.name === NAME), 'and it has its steps');
  seq.unregisterModule(NAME);
  check(!seq.isModule(NAME), 'after the delete it is NOT a module any more, so the picker stops offering it');
  check(!seq.listModules().includes(NAME), 'and it is gone from the list');
  check(!seq.getModules().some((m) => m.name === NAME), 'and from the readable module set');

  // THE KEY IS `canonicalName`, WHICH IS A SYNONYM MAP AND NOT A NORMALISER: `CALL_SYNONYMS[name] ??
  // FORMATION_SYNONYMS[name] ?? name`. It does not trim and it does not fold case, so a module is removed
  // by the name it was REGISTERED under and a differently-spelled name removes NOTHING. Asserted rather
  // than assumed, because the intuitive claim ("it is canonicalised, so any spelling works") is false -
  // and it is the reason the panel has to pass the STORED `m.name` rather than anything it derives.
  seq.registerModule('Probe Module Two', ['Pass Thru']);
  seq.unregisterModule('  probe module two  ');
  check(seq.isModule('Probe Module Two'),
    'a differently-spelled name removes NOTHING - the key transform maps synonyms, it does not trim or fold case');
  seq.unregisterModule('Probe Module Two');
  check(!seq.isModule('Probe Module Two'), 'and the name it was registered under does remove it');
}

console.log('\n== 2. and it cannot take anything it should not ==');
{
  const seq = new engine.Sequencer(read('../assets/moves.xml'), read('../assets/formations.xml'));
  seq.registerModule('Keep Me', ['Pass Thru']);
  seq.unregisterModule('Something Never Registered');
  check(seq.isModule('Keep Me'), 'deleting an unknown name removes NOTHING else');
  // A CURATED module ships with the engine and is not in the user map, so this must be inert.
  check(seq.isModule('Running Bear'), 'the curated `Running Bear` is a module to begin with');
  seq.unregisterModule('Running Bear');
  check(seq.isModule('Running Bear'),
    'and unregistering it does NOT remove it - the explicit removal only ever touches USER modules');
}

console.log('\n== 3. the icon, and where it sits ==');
const row = (() => {
  const i = ui.indexOf('private refreshModulesList()');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1600 : j);
})();
check(/class="seq-mod-del" data-mod-del="\$\{i\}"/.test(row),
  'every module row renders a delete control carrying the module INDEX');
check(/aria-label="Delete saved module \$\{esc\(m\.name\)\}"/.test(row),
  'and it is labelled with the module it deletes, so the icon is not an unlabelled `×` to a screen reader');
// THE ICON IS A SIBLING OF THE LOAD SPAN, NOT INSIDE IT. The span IS the load action; a `×` nested in it
// would have to stop propagation to avoid loading AND deleting on one click. Asserted as an ORDER, not as
// adjacency: the row legitimately renders more than the name and the calls - it now also carries the "not
// registered" marker - and a check pinning the button's exact neighbours went red when that marker was
// added, without the button ever moving. What must hold is that the load span is CLOSED before it opens.
const spanClose = row.indexOf('</span>');
const delButton = row.indexOf('<button class="seq-mod-del"');
check(spanClose >= 0 && delButton > spanClose,
  'and it is rendered AFTER the row, outside the clickable `.seq-module` span - so one click cannot be both a load and a delete');
// The negative control for the check above: nest the button in the span and the order inverts, so THIS is
// the check a plausible "put the × next to the name" edit fails, and the order check fails with it.
check(delButton >= 0 && row.slice(0, spanClose).indexOf('<button') < 0,
  'no button is opened at all inside the load span');

console.log('\n== 4. the click cannot do both ==');
const handler = (() => {
  const i = ui.indexOf("this.modulesEl.addEventListener('click'");
  if (i < 0) return '';
  const j = ui.indexOf('\n    });', i);
  return ui.slice(i, j < 0 ? i + 900 : j);
})();
check(/closest\('\.seq-mod-del'\)/.test(handler) && /this\.deleteModule\(Number\(del\.dataset\.modDel\)\)/.test(handler),
  'the drawer\'s ONE click handler reads the delete control');
check(handler.indexOf("closest('.seq-mod-del')") < handler.indexOf("closest('.seq-module')"),
  'and it is tested BEFORE the load, so a delete returns rather than falling through to loading the module it just removed');
check(/if \(del\?\.dataset\.modDel != null\) \{ this\.deleteModule\([\s\S]{0,60}?\); return; \}/.test(handler),
  'and that branch RETURNS, which is what stops the load running on the same click');

console.log('\n== 5. the delete removes all three things, and leaves the board alone ==');
const del = (() => {
  const i = ui.indexOf('private deleteModule(');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1600 : j);
})();
check(/this\.modules\.splice\(index, 1\)/.test(del), 'it drops the entry the drawer lists');
check(/this\.persistModules\(\)/.test(del), 'it drops the stored copy, so the module does not come back on reload');
check(/this\.seq\.unregisterModule\(m\.name\)/.test(del), 'and it drops the LIVE registration, so the picker stops offering it');
check(/this\.refreshModulesList\(\)/.test(del) && /this\.refreshCallSelect\(\)/.test(del),
  'then redraws both the drawer and the picker');
check(/const m = this\.modules\[index\];\s*\n\s*if \(!m\) return;/.test(del),
  'it is keyed on the INDEX from the clicked row, so two modules sharing a name cannot delete each other');
// THE TRAP. `rebuildSeq` would drop the registration too, and it clears the history on the way.
check(!/rebuildSeq/.test(del),
  'it does NOT rebuild the sequencer: `rebuildSeq` clears the history, so deleting a saved module would throw away the open sequence');
check(!/this\.history/.test(del),
  'and it never touches the sequence or the board - the caller\'s work survives a delete');

console.log('\n== 6. the marker is live CSS that reaches a module row ==');
check(/#seqPanel #seqModules \.seq-mod-del \{[^}]*color: var\(--dim\)[^}]*\}/.test(css),
  'the delete has a rule of its own - the timeline\'s `×` rule is scoped to `#seqPanel .seq-row`, which a module row is not');
check(/#seqPanel #seqModules \.seq-mod-del:hover \{[^}]*color: var\(--warn\)[^}]*\}/.test(css),
  'and it warns on hover, the same signal the step delete uses');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
