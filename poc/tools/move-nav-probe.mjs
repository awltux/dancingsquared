// Probe: THE A AND F KEYS STEP THE SELECTED MOVE SLOT, AND WRAP AT BOTH ENDS.
//
// Asked for as: "Add keyboard shortcuts to change the currently selected Move slot. Use A-KEY to select the
// previous move (lower index), rotating to the end after it reaches 0 index. Similarly use F-KEY to select the
// next move (higher index), rotating to the start after last index."
//
// THE ARITHMETIC IS IMPORTED, NOT MIRRORED (§5). It lives in `poc/src/move-nav.ts`, which has no DOM and no
// `three`, so node's type stripping loads it here - the same arrangement `scrub-keep.ts` has with
// `editor-setup-scrub-probe.mjs`. A probe that restated `(i + d + n) % n` would be measuring its own copy.
//
// NEGATIVE CONTROL, and it is the obvious alternative: a CLAMP. Measured below, `min(count - 1, i + 1)` and
// `max(0, i - 1)` agree with the rule on EVERY mid-strip case and differ only at the two ends - so the two
// wrap checks are the ones that rule them out, and the "one slot along" checks cannot.
//
// THE DOM IS OUT OF REACH, so the wiring is read as source: that `editor-ui.ts` imports this rule, that
// `stepMove` is its caller and then goes through `selectMove`, and that the move readout names the keys. That
// half is the weakest and is stated as such - it proves the panel asks the rule, not that a keystroke arrived.
//
// NOT OBSERVED IN A BROWSER: this sandbox cannot start the Vite app, so the two keys were not pressed against
// the running panel. What is measured here is the rule and the wiring, and the commit says the same.
//
// Run: node poc/tools/move-nav-probe.mjs   (from anywhere; no engine build needed - this module is pure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8').replace(/\r\n/g, '\n');

const { stepMoveIndex } = await import(pathToFileURL(path.join(POC, 'src/move-nav.ts')).href);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// THE RULE THIS REPLACES, spelled out so the checks below can be shown to distinguish it rather than merely
// to agree with the new one. Both halves are the reflex every image-strip implementation starts with.
const clampPrev = (i) => Math.max(0, i - 1);
const clampNext = (i, n) => Math.min(n - 1, i + 1);

console.log('== the two ends, which is what "rotating" means ==');
check(stepMoveIndex(0, -1, 6) === 5,
  'A on the FIRST move (slot 0 of 6) goes to the LAST slot (5)');
check(stepMoveIndex(5, 1, 6) === 0,
  'and F on the last move goes back to the first (5 -> 0)');
check(clampPrev(0) === 0 && clampNext(5, 6) === 5,
  'while the clamp this replaces sits still at both ends (0 -> 0, 5 -> 5) - so these two checks, and not the mid-strip ones, are the negative control');

console.log('\n== and one slot along everywhere else ==');
check(stepMoveIndex(2, -1, 6) === 1, 'A in the middle steps one slot lower (2 -> 1)');
check(stepMoveIndex(2, 1, 6) === 3, 'and F one slot higher (2 -> 3)');
check(clampPrev(2) === stepMoveIndex(2, -1, 6) && clampNext(2, 6) === stepMoveIndex(2, 1, 6),
  'which the clamp gets right too - so these checks cannot tell the two rules apart, and the wrap checks are the ones that must');

console.log('\n== a full lap visits every slot once and comes back ==');
{
  const lap = (direction) => {
    let at = 0;
    const seen = [];
    for (let k = 0; k < 6; k++) {
      at = stepMoveIndex(at, direction, 6);
      seen.push(at);
    }
    return { at, seen };
  };
  const fwd = lap(1);
  const back = lap(-1);
  check(fwd.at === 0 && new Set(fwd.seen).size === 6,
    `six presses of F from move 1 visit all six slots and return to move 1 (${fwd.seen.join(', ')})`);
  check(back.at === 0 && new Set(back.seen).size === 6,
    `and six presses of A do the same the other way (${back.seen.join(', ')})`);
}

console.log('\n== the two sizes that are not "several moves" ==');
check(stepMoveIndex(0, -1, 1) === 0 && stepMoveIndex(0, 1, 1) === 0,
  'a dancer with ONE move stays on it in both directions - the strip cannot walk off either end of a slot that is the whole strip');
check(stepMoveIndex(0, -1, 0) === null && stepMoveIndex(0, 1, 0) === null,
  'and a dancer with NO moves has nowhere to step: the rule says null rather than 0');
check(stepMoveIndex(0, -1, 0) !== 0,
  'which is the distinction that matters - "nowhere to step" must not read as "slot 0"');

console.log('\n== the panel asks this rule, and the readout names the keys ==');
const ui = read('src/editor-ui.ts');
const html = read('index.html');
check(/import \{ stepMoveIndex \} from '\.\/move-nav';/.test(ui),
  '`editor-ui.ts` imports the step rule rather than spelling the wrap out in the panel');
const step = /private stepMove\(direction: -1 \| 1\) \{([\s\S]*?)\n  \}/.exec(ui);
check(!!step && /stepMoveIndex\(this\.moveIndex, direction, this\.currentMoves\(\)\.length\)/.test(step[1]),
  '`stepMove` asks it with the selected slot, the direction and the strip length - and with no second clamp of its own');
check(!!step && /this\.selectMove\(next\);/.test(step[1]),
  'and then moves the cursor through `selectMove`, the same call a tile click makes, so the tile, the board and the readout cannot disagree');
check(/<span id="edMoveInfo"[^>]*title="[^"]*A steps[^"]*F[^"]*"/.test(html),
  'and the move readout names the keys in its tooltip, which is the only place in the app a shortcut is written down');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
