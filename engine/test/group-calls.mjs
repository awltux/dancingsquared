// THE GROUP PICKER'S LIST: what a group can actually DO.
//
// Two defects are pinned here, both measured on a Static Square with `Head Boys`:
//   1. the picker showed "no calls, just Modules" - every whole-set call was dropped by a bad guard;
//   2. the list asked WHOLE-BOARD legality, so it offered `Promenade`, `Promenade 1/2` and `Swing Your
//      Partner`, which the group cannot perform.
//
// `groupCanPerform` asks the question the picker has: compose the group onto the call and apply it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, splitSelection } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const board = seq.boardForFormation('Static Square');
const group = 'Head Boys';

console.log('== the group can do Dosado ==');
check(seq.groupCanPerform(board, group, 'Dosado') === true,
  `${group} can perform Dosado`);
check(seq.groupCanPerform(board, group, 'Pass Thru') === true,
  `${group} can perform Pass Thru`);

console.log('\n== and CANNOT do these, which whole-board legality offered anyway ==');
for (const call of ['Promenade', 'Promenade 1/2', 'Swing Your Partner']) {
  const whole = seq.applyToBoard(board, call).legal;
  const forGroup = seq.groupCanPerform(board, group, call);
  check(forGroup === false, `${group} cannot perform ${call} (whole-board legal=${whole}, group legal=${forGroup})`);
}

console.log('\n== a call that names its own dancers is not the group\'s to perform ==');
check(seq.groupCanPerform(board, group, 'Heads Square Thru 4') === false,
  'a call with its own selection is refused for the group');

console.log('\n== the picker list is non-empty and contains Dosado ==');
{
  const WHOLE = ['all', 'everybody', 'everyone', 'all 8', 'all 4 couples'];
  const legal = seq.legalNext().sort((a, b) => a.localeCompare(b));
  const whole = [];
  for (const n of legal) {
    if (seq.isModule(n)) continue;
    const s = splitSelection(n).selection;
    if (s && !WHOLE.includes(s.toLowerCase())) {
      if (s.toLowerCase() === group.toLowerCase()) whole.push(splitSelection(n).call);
    } else if (!s) {
      const bare = splitSelection(n).call;
      if (seq.groupCanPerform(board, group, bare)) whole.push(bare);
    }
  }
  const list = [...new Set(whole)].sort((a, b) => a.localeCompare(b));
  console.log(`  list size: ${list.length}`);
  check(list.length > 0, `the group's call list is not empty (${list.length} calls)`);
  check(list.includes('Dosado'), 'Dosado IS offered for Head Boys - the reported symptom');
  check(!list.includes('Promenade'), 'Promenade is NOT offered, because the group cannot do it');
  // Every call offered must actually be performable - the list cannot disagree with the applicator.
  const notPerformable = list.filter((c) => !seq.groupCanPerform(board, group, c));
  check(notPerformable.length === 0,
    `every offered call is performable by the group (${notPerformable.length} were not: ${notPerformable.slice(0, 4).join(', ')})`);
}

console.log('\n== the other named groups behave the same ==');
for (const g of ['Head Girls', 'Side Boys', 'Side Girls']) {
  check(seq.groupCanPerform(board, g, 'Dosado') === true, `${g} can perform Dosado`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
