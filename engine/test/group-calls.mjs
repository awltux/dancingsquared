// THE GROUP PICKER'S LIST: what a group can actually DO.
//
// Two defects are pinned here, both measured on a Static Square with `Head Boys`:
//   1. the picker showed "no calls, just Modules" - every whole-set call was dropped by a bad guard;
//   2. the list asked WHOLE-BOARD legality, so it offered `Promenade`, `Promenade 1/2` and `Swing Your
//      Partner`, which the group cannot perform.
//
// `groupCanPerform` asks the question the picker has: compose the group onto the call and apply it.
//
// A THIRD THING IS PINNED, added with the vocabulary: `GROUP_NAMES` is the ONE list of group names - the
// picker's offered lists are built from it and a permission rule's `group` is written against it - and the
// last section checks it against every named formation in both directions.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, splitSelection, GROUP_NAMES } from '../dist/index.js';
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

console.log('\n== THE GROUP VOCABULARY IS ONE LIST ==');
// `GROUP_NAMES` is what a permission rule's `group` may usefully carry, and it is the same array the
// picker's two lists are built from (`SUBSET_GROUP_NAMES` / `COMBINED_GROUP_NAMES`, filtered per board by
// `keepProperSubsets`). Two things go wrong with a list like this and both are checked here: it drifts
// from what the picker offers, and it grows a name nothing can ever resolve.
{
  const names = GROUP_NAMES;
  check(names[0] === 'All 8', `the whole-board reading is first (${names[0]})`);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check(dupes.length === 0, `no duplicate names (${dupes.join(', ') || 'none'})`);
  check(names.every((n) => typeof n === 'string' && n.trim() === n && n.length > 0),
    'every entry is a trimmed, non-empty string');
  // NO OFFERED NAME MAY BE MISSING FROM THE LIST - the direction that matters, over every named formation
  // rather than one witness board.
  const boards = seq.listFormations().map((n) => seq.boardForFormation(n)).filter(Boolean);
  const offered = new Set();
  for (const b of boards) for (const n of seq.subsetGroups(b)) offered.add(n);
  for (const b of boards) for (const n of seq.combinedGroups(b)) offered.add(n);
  const missing = [...offered].filter((n) => !names.includes(n));
  check(missing.length === 0,
    `every name offered on any of the ${boards.length} named formations is IN the list (${missing.length} missing: ${missing.slice(0, 4).join(', ')})`);
  // AND THE OTHER DIRECTION, MEASURED: a name no named formation can reach. Three are known and kept on
  // purpose (see `SUBSET_GROUP_NAMES`); the ceiling is what turns a FOURTH into a red instead of a rumour.
  const unreachable = names.filter((n) => n !== 'All 8' && !offered.has(n));
  check(unreachable.length <= 3,
    `at most 3 names are unreachable from a named formation (${unreachable.length}: ${unreachable.join(', ') || 'none'})`);
  console.log(`    ${names.length} name(s); ${offered.size} of them offered somewhere in the corpus; ${unreachable.length} unreachable`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
