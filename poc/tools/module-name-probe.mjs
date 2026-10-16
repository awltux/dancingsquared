// Probe: A MODULE MAY NOT TAKE A CALL'S NAME.
//
// Asked for, after the conflict was found: "registerModule should refuse a name that is already a call and
// say so."
//
// WHY IT HAS TO BE REFUSED. `CallLibrary.flatten` resolves a name to a MODULE BEFORE a call, so a module
// registered under a call's title takes that name over everywhere a sequence is flattened. MEASURED, with a
// module named `Single File Promenade to Home` whose content is `Pass Thru`: `flatten([thatName])` returned
// `["Pass Thru"]`, and when the module CONTAINED its own name the cycle guard dropped it so `flatten`
// returned `[]` and the call became UNAPPLIABLE. `legalWithResults` then dropped the name from both of its
// loops - it is in `callNames()` and in `moduleNames()` - so the title vanished from the picker's call list
// AND from its module list at once, and `restoreModules` brought it back on every reload.
//
// THE ENGINE HALF IS MEASURED BY IMPORT: register a call, try to take its name, and ask whether the CALL
// still works afterwards - which is the property that actually matters, and the one the refusal exists to
// protect. The panel half is wiring, so it is read as source.
//
// Run: node poc/tools/module-name-probe.mjs   (from anywhere; build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);

const read = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');
const movesXml = read('src/assets/moves.xml');
const formationsXml = read('src/assets/formations.xml');
const ui = read('src/sequencer-ui.ts');
const css = read('src/style.css');
const CALL = 'Single File Promenade Home';

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const fresh = () => new engine.Sequencer(movesXml, formationsXml, callsByTitle(path.join(POC_DIR, 'src', 'assets')));

console.log('== 1. the refusal, and that it says so ==');
{
  const seq = fresh();
  seq.reset();
  let thrown = null;
  try { seq.registerModule(CALL, ['Pass Thru']); } catch (e) { thrown = e; }
  check(!!thrown, 'registering a module under a CALL\'s name throws');
  check(!!thrown && thrown.message.includes(CALL),
    `and the message names the name at fault ("${thrown?.message.slice(0, 60)}...")`);
  check(!!thrown && /already a call/.test(thrown.message),
    'and says what the conflict is, so the caller knows what to change');
  check(!seq.isModule(CALL), 'and nothing was registered - the refusal is not a partial write');
  check(!seq.listModules().includes(CALL), 'the module list does not carry it either');
}

console.log('\n== 2. and the CALL is left exactly as it was ==');
{
  const seq = fresh();
  seq.reset();
  const beforeLegal = seq.legalNext().includes(CALL);
  const beforeBeats = seq.stepBeats(seq.board, CALL);
  const beforeApply = seq.applyStep(CALL).legal;
  try { seq.registerModule(CALL, ['Pass Thru']); } catch { /* expected */ }
  check(beforeLegal, 'the call was a legal next call to begin with');
  check(seq.legalNext().includes(CALL),
    'and it STILL is after the refusal - which is the whole point, because the shadowing used to drop it from the picker');
  check(JSON.stringify(seq.flatten([CALL])) === JSON.stringify([CALL]),
    'and the name still means the CALL when a sequence is flattened, not the module it refused');
  check(seq.stepBeats(seq.board, CALL) === beforeBeats,
    `and it still costs what it did (${beforeBeats} beats)`);
  check(seq.applyStep(CALL).legal === beforeApply && beforeApply,
    'and it still applies - the call is undamaged');
}

console.log('\n== 3. the key is the SAME canonical key `register` stores under ==');
{
  const seq = fresh();
  seq.reset();
  // `canonicalName('Do Sa Do')` is `Dosado`, and `register` keys calls on that - so the ALIAS of a call is
  // refused too. A check written against the raw string would let this one through and take `Dosado` over.
  let thrown = null;
  try { seq.registerModule('Do Sa Do', ['Pass Thru']); } catch (e) { thrown = e; }
  check(!!thrown, 'an ALIAS of a call ("Do Sa Do", which canonicalises to "Dosado") is refused as well');
  check(!seq.isModule('Do Sa Do'), 'and it is not registered under the alias either');
  check(seq.legalNext().includes('Dosado'), 'while the call it aliases is untouched');
}

console.log('\n== 4. control: a name of its own registers and works ==');
{
  const seq = fresh();
  seq.reset();
  let thrown = null;
  try { seq.registerModule('My Own Module', ['Pass Thru']); } catch (e) { thrown = e; }
  check(!thrown, 'a module whose name is not a call registers without complaint');
  check(seq.isModule('My Own Module'), 'and it is a module');
  check(seq.legalNext().includes('My Own Module'), 'and it is offered as a next call, so the refusal did not make modules unusable');
  check(seq.sequenceBeats(seq.flatten(['My Own Module']), seq.board) > 0,
    'and it has a non-zero duration, so the picker can label it');
}

console.log('\n== 5. the panel reports the refusal instead of swallowing it ==');
const save = (() => {
  const i = ui.indexOf('private saveModule()');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1600 : j);
})();
check(/try \{[\s\S]{0,120}?this\.seq\.registerModule\(name, \[\.\.\.this\.history\]\);[\s\S]{0,120}?\} catch/.test(save),
  '`saveModule` catches the engine\'s refusal');
check(/this\.setStatus\('warn', `\$\{\(err as Error\)\.message\} Nothing was saved\.`\)/.test(save),
  'and shows the ENGINE\'S OWN message, so the reason is the one the engine gave rather than a second wording');
check(/catch[\s\S]{0,200}?return;/.test(save),
  'and it returns, so a refused name is not stored');
check(save.indexOf('registerModule') < save.indexOf('this.modules.push'),
  'the registration is attempted BEFORE anything is stored or listed, so a refusal leaves no trace');

console.log('\n== 6. a module already saved under a call\'s name cannot take the app down ==');
const restore = (() => {
  const i = ui.indexOf('private restoreModules()');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 1400 : j);
})();
check(/try \{[\s\S]{0,120}?this\.seq\.registerModule\(m\.name, m\.calls\);[\s\S]{0,80}?\} catch/.test(restore),
  '`restoreModules` catches per module, so a stored module the engine now refuses cannot throw out of the constructor');
check(!/splice|filter|this\.modules\s*=/.test(restore),
  'and it does NOT drop it: a module left in storage with nothing on screen to delete it from is unreachable');
const rebuild = (() => {
  const i = ui.indexOf('private rebuildSeq()');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 2000 : j);
})();
check(/this\.restoreModules\(\);/.test(rebuild) && !/this\.seq\.registerModule\(m\.name/.test(rebuild),
  'and `rebuildSeq` goes through it too, so a LEVEL CHANGE cannot throw on a refused module either');
check(ui.indexOf('this.restoreModules();') < ui.indexOf('this.refreshModulesList();', ui.indexOf('this.loadModules();')),
  'the constructor restores BEFORE drawing, so the drawer can ask the library which modules registered');

console.log('\n== 7. the drawer says which modules are not registered ==');
const list = (() => {
  const i = ui.indexOf('private refreshModulesList()');
  if (i < 0) return '';
  const j = ui.indexOf('\n  }\n', i);
  return ui.slice(i, j < 0 ? i + 2000 : j);
})();
check(/const live = this\.seq\.isModule\(m\.name\);/.test(list),
  'each row asks the LIBRARY whether that module registered, rather than remembering a flag that could disagree with it');
check(/seq-mod-dead/.test(list) && /not registered/.test(list),
  'and a row that did not register says so, because a row that quietly does nothing is the failure this whole change is about');
check(/#seqPanel #seqModules \.seq-mod-dead \{[^}]*color: var\(--warn\)[^}]*\}/.test(css),
  'and that marker is a live CSS rule in the warning colour');
check(/class="seq-mod-del"/.test(list),
  'and the row still carries its delete control, which is the only way that module can be removed');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
