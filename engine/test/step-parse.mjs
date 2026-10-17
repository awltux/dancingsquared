// `parseStep` — the inverse of `stepLabel`, and the thing that lets a parallel step travel as TEXT.
//
// WHY THIS IS A GATE. A step can already be APPLIED as a `ModuleStep` (`Sequencer.applyToBoard` takes one) and the
// group-step RULES are pinned elsewhere (`engine/test/parallel-calls.mjs`, `engine/test/modules.mjs`). What was missing
// is the way back: `stepLabel` wrote a step down and nothing read it back. The game's Daily carries its line as STRINGS
// — that is what the wire records and what the server replays — so a parallel step (two groups dancing different calls
// at once) only survives if the label can be read into the step it came from. This harness pins exactly that and
// nothing that is already pinned.
//
// THE THREE THINGS MEASURED:
//   1. round trip — `stepLabel(parseStep(x)) === x` for every shape `stepLabel` produces;
//   2. the APPLY invariant — the parsed step reaches the SAME BOARD as the original, because a parse that keeps the text
//      and loses a lane's boundary would round-trip as a string and dance one group twice;
//   3. refusals — a label that cannot be read back is null, never a guess.
//
// Usage: node engine/test/step-parse.mjs   (the engine must be built)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { parseStep, Sequencer, setParser, stepLabel } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', '..', 'assets');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. the label round-trips ==');
{
  const steps = [
    'Dosado',
    { selection: 'Heads', call: 'Dosado' },
    { groups: [{ selection: 'Heads', calls: ['Promenade'] }, { selection: 'Sides', calls: ['Trade'] }] },
    { groups: [{ selection: 'Heads', calls: ['Trade', 'Touch a Quarter'] }, { selection: 'Sides', calls: ['Promenade'] }] },
    // THE TWO-WORD SELECTION, which a split on the first space would read backwards.
    { groups: [{ selection: 'Head Boys', calls: ['Dosado'] }, { selection: 'Beaus', calls: ['Trade'] }] },
  ];
  for (const step of steps) {
    const label = stepLabel(step);
    const parsed = parseStep(label);
    check(parsed !== null, `"${label}" parses`);
    check(parsed !== null && stepLabel(parsed) === label, `and round-trips to the same label${parsed && stepLabel(parsed) !== label ? ` (${stepLabel(parsed)})` : ''}`);
  }
  // NEGATIVE CONTROL: a label with no ` || ` comes back as ITSELF, so `parseStep` is not wrapping every call in a lane —
  // which would change how the applicator reads a scoped call like `Heads Dosado`.
  check(typeof parseStep('Dosado') === 'string' && parseStep('Heads Dosado') === 'Heads Dosado', 'a label with no ` || ` stays a plain step string');
}

console.log('\n== 2. the parsed step dances the same board as the original ==');
{
  const read = (p) => readFileSync(path.join(ASSETS, p), 'utf8');
  // THE WHOLE MAINSTREAM CATALOGUE, registered the way `applicable-moves.mjs` does: group readings need the corpus, and
  // a handful of titles has none (MEASURED: with three registered, `applicableMoves` returns ZERO group readings).
  const seq = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(ASSETS));
  if (!seq.setFormation('Static Square')) throw new Error('the corpus no longer declares Static Square');
  const board = seq.boardForFormation('Static Square');
  const pose = (b) => b.dancers.map((d) => `${d.id}:${d.x},${d.y},${d.heading}`).join('|');

  // THE STEPS ARE DERIVED FROM WHAT THIS BOARD OFFERS, rather than guessed: two readings for DIFFERENT selections are a
  // witness that applies, and a hard-coded pair would be measuring the corpus's current authoring instead.
  const readings = seq.applicableMoves(board).filter((r) => r.selection !== null);
  const pairs = [];
  for (const a of readings) {
    const b = readings.find((other) => other.selection !== a.selection && other.call !== a.call);
    if (b) pairs.push([a, b]);
    if (pairs.length === 2) break;
  }
  check(pairs.length === 2, `two disjoint-selection witness pairs exist on a squared set (${pairs.length})`);
  for (const [a, b] of pairs) {
    const step = { groups: [{ selection: a.selection, calls: [a.call] }, { selection: b.selection, calls: [b.call] }] };
    const direct = seq.applyToBoard(board, step);
    const roundTripped = seq.applyToBoard(board, parseStep(stepLabel(step)));
    check(direct.legal && roundTripped.legal, `"${stepLabel(step)}" applies both ways (${direct.legal}, ${roundTripped.legal})`);
    // THE BOARD IS THE PROOF: compared as a POSE, because that is what the game draws and scores. A parse that kept the
    // text and lost a lane's boundary would dance one group's call twice and still round-trip as a string.
    check(direct.legal && pose(direct.board) === pose(roundTripped.board), `and the parsed step reaches the same board (${stepLabel(step)})`);
  }
}

console.log('\n== 3. a label that cannot be read back is null, not a guess ==');
{
  // ONLY A LABEL WITH ` || ` HAS PARTS TO GET WRONG, and a part is judged on its own: a single-part label is a plain
  // step name, whatever it looks like, and the applicator is what decides if it is a call.
  for (const [label, why] of [
    ['Heads Promenade ||  || Sides Trade', 'an empty part'],
    ['Heads ( Trade || Sides Trade', 'an unclosed bracket'],
    ['Heads ( Trade ) || Sides Trade', 'a bracket around one call, which the writer never produces'],
    ['Trade || Sides Promenade', 'a part with no selection'],
    ['Heads  || Sides Trade', 'a part with a selection and no call'],
  ]) {
    check(parseStep(label) === null, `${why} is refused (${JSON.stringify(label)})`);
  }
  check(parseStep('Sides Trade || Heads Promenade') !== null, 'NEGATIVE CONTROL: while a two-lane label does parse');
  // AND A SINGLE-PART LABEL IS NOT VALIDATED, deliberately: `Heads ( Trade )` is the applicator's problem, and refusing it
  // here would make `parseStep('Dosado')` a special case of a group parser it is not.
  check(parseStep('Heads ( Trade )') === 'Heads ( Trade )', 'while a single-part label is passed through untouched');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
