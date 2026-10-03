// Probe: DOES THE PANEL SAY A CLONE IS BEING BUILT, EVERYWHERE IT CHANGES A BUTTON?
//
// A clone is not a mode. It is the instance editor with `asClone` set, and the ONE thing that flag changes
// is what Save does - it ADDS a setup instead of replacing the one the instance came from. Everything a
// caller sees is otherwise identical, which is exactly why the state has to be written down in three
// places: the bar over the table, the Save button's own label, and the HUD's edge. A clone in hand, with a
// button saying "Save", is a caller about to overwrite the setup they meant to copy.
//
// This is the third bug of ONE shape in this panel (the trail focus, the Bezier handles and the skipped
// `registerUserFormations` were the others): a method changed state and did not update a second view of it.
// So the check is structural - the kind `stage-sync-probe.mjs` already uses - because it is browser wiring
// that no engine harness can see and this sandbox cannot drive:
//
//   A. EVERY method that writes `asClone` must reach `renderCloneChrome` (directly, or through
//      `renderInstance`, which calls it).
//   B. The Save button's label must be written in exactly ONE place, so the Fix and Create modes cannot
//      inherit "Save as new setup" from a clone that is no longer on screen - which is why `applyMode`
//      has to reach the chrome too, and why the chrome has to be re-asked when the MODE changes and not
//      only when the instance does.
//
// Run: node tools/clone-chrome-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** Replace comments and string/template contents with spaces, so the statement scan sees only code. */
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
    if (c === '/' && n === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; blank(i, j); i = j; }
    else if (c === '/' && n === '*') { let j = i + 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++; blank(i, Math.min(j + 2, src.length)); i = j + 2; }
    else if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; } blank(i + 1, j); i = j + 1; }
    else i++;
  }
  return out.join('');
}

/** Every class method with a body: name -> body. */
function methods(code) {
  const found = new Map();
  const re = /\n {2}(?:private |public |protected )?(?:static )?(?:async )?(?:get |set )?([A-Za-z_$][\w$]*)\s*[(<]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    let i = code.indexOf('{', m.index + m[0].length - 1);
    const close = code.indexOf(';', m.index + m[0].length - 1);
    if (i < 0 || (close >= 0 && close < i)) continue;
    let depth = 0;
    let j = i;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    found.set(m[1], code.slice(m.index, j + 1));
  }
  return found;
}

const WRITES_FLAG = /this\.asClone\s*=\s*(?:true|false)\s*;/g;

const audit = (src) => {
  const code = stripLiterals(src);
  const found = methods(code);
  const rows = [];
  const problems = [];
  for (const [name, body] of found) {
    const writes = (body.match(WRITES_FLAG) ?? []).length;
    if (writes === 0) continue;
    // `renderInstance` counts as reaching it: it calls the chrome, and `renderCloneChrome` itself
    // writes no flag, so there is no cycle for the exemption to hide behind.
    const direct = /this\.renderCloneChrome\(/.test(body);
    // `swapInstance` is the OTHER way into `renderInstance` - it assigns the instance, shows it and renders - so
    // a method that writes the flag and hands the swap to it has re-written the chrome just the same.
    const viaRender = /this\.renderInstance\(/.test(body) || /this\.swapInstance\(/.test(body);
    rows.push({ name, writes, direct, viaRender, ok: direct || viaRender });
    if (!(direct || viaRender)) problems.push(name);
  }
  const saveWriters = [...found].filter(([, body]) => /this\.saveBtn\.textContent\s*=/.test(body)).map(([n]) => n);
  const applyMode = found.get('applyMode') ?? '';
  return {
    rows,
    problems,
    saveWriters,
    // The mode handler must reach the chrome, and the chrome must ask the mode before it writes.
    applyModeReaches: /this\.renderCloneChrome\(/.test(applyMode),
    chromeAsksMode: /this\.isInstanceMode\(\)/.test(found.get('renderCloneChrome') ?? ''),
  };
};

const src = read('src/editor-ui.ts');
const good = audit(src);

console.log('== Every write of `asClone` reaches the clone chrome ==');
for (const r of good.rows) {
  const how = r.direct ? 'reaches renderCloneChrome directly' : r.viaRender ? 'reaches it through renderInstance/swapInstance' : 'NO clone chrome';
  console.log(`      ${r.ok ? 'ok  ' : 'BAD '} ${r.name.padEnd(18)} ${r.writes} write(s), ${how}`);
}
check(good.rows.length >= 3, `the audit found the methods that set the flag at all (${good.rows.length}; an empty result would be a broken parser, not a clean file)`);
check(good.problems.length === 0,
  good.problems.length === 0
    ? 'no method sets the clone flag without re-writing the chrome'
    : `methods that set the clone flag WITHOUT re-writing the chrome: ${good.problems.join(', ')}`);

console.log('\n== …and the chrome cannot outlive the mode it belongs to ==');
check(good.saveWriters.length === 1 && good.saveWriters[0] === 'renderCloneChrome',
  `the Save button's label is written in exactly one place (${good.saveWriters.join(', ') || 'nowhere'}), so no other path can invent it`);
check(good.chromeAsksMode, 'and that one place asks the MODE, not only the flag: the Save button sits outside the instance panel and is shared with Fix and Create');
check(good.applyModeReaches, 'and the mode handler reaches it, because changing mode does not re-render the instance');

// SHOWN TO FAIL, or it is decoration. Two of the faults this was written for, put back into copies.
console.log('\n== the check fails on the bugs it was written for ==');
{
  // `doClone` as it was: the flag set AFTER the reload's own render, and no chrome pass of its own.
  const broken = src.replace(/\n\s*this\.renderCloneChrome\(\);\n(\s*this\.statusEl\.textContent = 'cloned)/, '\n$1');
  check(broken !== src, 'the negative control really is a different file (the edit applied)');
  const bad = audit(broken);
  console.log(`    with doClone's chrome pass removed: ${bad.problems.join(', ') || 'NONE (the check is decoration)'}`);
  check(bad.problems.includes('doClone'), 'and it flags doClone - the button a caller actually presses, whose label would keep saying "Save"');

  // The ApplyMode pass removed: the label then survives into Fix and Create, where Save replaces.
  const noMode = audit(src.replace(/(private applyMode\(\) \{[\s\S]*?)this\.renderCloneChrome\(\);/, '$1'));
  check(!noMode.applyModeReaches, 'and removing the mode handler\'s pass is caught, which is the fault of the label outliving the clone it described');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
