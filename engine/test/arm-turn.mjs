// THE ARM TURN FAMILY IS A RULE, AND IT REPRODUCES THE TAMS IT REPLACES.
//
// CALLERLAB Mainstream, `Arm Turn Family / a. Right/Left Arm Turn`: Facing Dancers and Mini-Wave, "the amount
// of turn can be specified as a fraction (Half, Three-Quarters, Full) or implicitly by the next call", with the
// command examples `Left Arm Turn Three-Quarters`, `All Arm Turn Half` and `Centers Arm Turn Three-Quarters`.
// The corpus authored exactly two of those combinations - `Left Arm Turn 3/4` and `Right Arm Turn 3/4` - so
// every other fraction of either hand was unreachable. `engine/src/sequencer/arm-turn.ts` derives the family:
// each forearm grip rotates rigidly about the midpoint of the grip.
//
// WHAT MAKES THIS A GATE RATHER THAN A DEMONSTRATION. The two authored tams are the REFERENCE, and section 1
// requires the rule to reproduce both of them exactly - every dancer's position and heading, index for index.
// That is what pins the SIGN (left turns one way, right the other) and the PAIRING (which dancers are in a grip
// together), and it is the check the first version of the rule failed by exactly one pair's width: the mirrored
// sign puts every position right and every identity in the pair swapped.
//
// THE SECTIONS AFTER THAT MEASURE WHAT THE TAMS CANNOT: a fraction nobody authored, the hand that has no grips
// on a board (a right arm turn from a LEFT-hand wave must be refused, not quietly turned the other way), and the
// CALLERLAB timing, which is per fraction.
//
// Run: node test/arm-turn.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, armTurn, armTurnProblem, ARM_TURN_FRACTIONS, loadCallFromXml, normalizeInstance, instanceBeats, poseFor, setParser } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');
const armTurnsXml = read('ms/arm_turns.xml');

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};
const fmt = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
const deg = (r) => fmt((norm(r) * 180) / Math.PI);

/** An authored call's start board as a sequencer Board (ids are the only field an instance dancer lacks). */
const authored = (title) => {
  const call = normalizeInstance(loadCallFromXml(armTurnsXml, movesXml, formationsXml, { title }));
  const beats = instanceBeats(call);
  return {
    title,
    beats,
    start: call.dancers.map((d) => poseFor(d, 0)),
    end: call.dancers.map((d) => poseFor(d, beats)),
  };
};
const boardOf = (poses) => ({
  dancers: poses.map((p, i) => ({ id: i + 1, couple: (i % 4) + 1, gender: 'boy', x: p.x, y: p.y, heading: p.heading })),
});
const seq = new Sequencer(movesXml, formationsXml, []);
// The sequencer's own call registry would take minutes to build from the corpus and this rule needs none of it:
// `applyToBoard` reaches a CODED MOVE before the catalogue, which is exactly the path under test.
const leftWave = boardOf(authored('Left Arm Turn 3/4').start);
const rightWave = boardOf(authored('Right Arm Turn 3/4').start);

// ---------------------------------------------------------------- 1. the rule against the two authored tams
console.log('== 1. the rule reproduces BOTH authored tams exactly ==');
for (const [title, hand] of [['Left Arm Turn 3/4', 'left'], ['Right Arm Turn 3/4', 'right']]) {
  const a = authored(title);
  const r = armTurn(boardOf(a.start), hand, (3 * Math.PI) / 2);
  if (!('board' in r)) { check(false, `${title} applies to its own start board`, r.reason); continue; }
  let worst = 0;
  let worstH = 0;
  r.board.dancers.forEach((d, i) => {
    worst = Math.max(worst, Math.hypot(d.x - a.end[i].x, d.y - a.end[i].y));
    worstH = Math.max(worstH, Math.abs(norm(d.heading - a.end[i].heading)));
  });
  check(worst < 1e-9 && worstH < 1e-9,
    `"${title}": every dancer's position and heading match the tam (worst ${fmt(worst)} units, ${deg(worstH)} deg)`,
    `${r.board.dancers.map((d) => `(${fmt(d.x)},${fmt(d.y)})`).join(' ')}\n        vs ${a.end.map((p) => `(${fmt(p.x)},${fmt(p.y)})`).join(' ')}`);
}

// ---------------------------------------------------------------- 2. the fractions no tam authors
console.log('\n== 2. the fractions the corpus never authored, through the sequencer ==');
{
  const apply = (board, name) => seq.applyToBoard(board, name);
  const headings = (board, r) => {
    const before = new Map(board.dancers.map((d) => [d.id, d.heading]));
    return [...new Set(r.board.dancers.map((d) => deg(d.heading - before.get(d.id))))];
  };
  for (const [name, board, want] of [
    ['Left Arm Turn 1/2', leftWave, -180],
    ['Left Arm Turn 3/4', leftWave, -90],
    ['Left Arm Turn Full', leftWave, 0],
    ['Right Arm Turn 1/2', rightWave, 180],
    ['Right Arm Turn 3/4', rightWave, 90],
    ['Right Arm Turn Full', rightWave, 0],
    ['All Arm Turn Half', rightWave, 180],
  ]) {
    const r = apply(board, name);
    if (!r.legal) { check(false, `"${name}" applies`, r.reason); continue; }
    // COMPARED AS NUMBERS: -180 and 180 are the same facing but not the same string, and the measured value
    // prints with three decimals, so a string comparison would fail on formatting rather than on the turn.
    const got = headings(board, r).map((d) => Number(d));
    check(got.length === 1 && (got[0] === want || Math.abs(got[0] - want) === 360),
      `"${name}" turns every dancer ${want} degrees (got ${got.join(', ')})`);
  }
  // `All` is a SELECTION, and it must not change the reading: the same call with every dancer selected is the
  // whole-board call.
  const plain = apply(rightWave, 'Arm Turn 1/2');
  const all = apply(rightWave, 'All Arm Turn 1/2');
  check(plain.legal && all.legal && JSON.stringify(plain.board.dancers.map((d) => [d.x, d.y])) === JSON.stringify(all.board.dancers.map((d) => [d.x, d.y])),
    '"All Arm Turn 1/2" is the same motion as "Arm Turn 1/2", so the selection is carried and not re-read');
}

// ---------------------------------------------------------------- 3. the wrong hand is REFUSED, not turned
console.log('\n== 3. a hand that has no grips is refused, and the reason names the dancer ==');
{
  // THE NEGATIVE CONTROL FOR THE HAND. A right arm turn from a LEFT-hand wave is not that call, and the whole
  // family would be meaningless if the rule simply turned whichever grips it found.
  const wrong = armTurnProblem(leftWave, 'right');
  check(wrong !== null, `a right arm turn from a LEFT-hand wave is refused (${wrong})`);
  check(!!wrong && /holds no right forearm/.test(wrong), 'and the reason says which forearm is missing, not just "not a wave"');
  check(armTurnProblem(rightWave, 'right') === null, 'while the same call applies to a right-hand wave, so the refusal is about the board');
  // A LINE OF DANCERS ALL FACING ONE WAY has no grips at all: every dancer holds a forearm, but nobody holds
  // one back the other way, so it is not a Mini-Wave.
  const line = { dancers: leftWave.dancers.map((d) => ({ ...d, heading: 0 })) };
  check(armTurnProblem(line, 'left') !== null, 'and a line all facing one way is refused too');
}

// ---------------------------------------------------------------- 4. the timing is CALLERLAB's
console.log("\n== 4. CALLERLAB's timing, per fraction ==");
{
  const beatsOf = (name) => seq.stepBeats(rightWave, name);
  // WHERE EACH NUMBER COMES FROM, per fraction: CALLERLAB gives a single number for the half and a range for the
  // other two. The three-quarter turn takes the CORPUS's own 4.5 - inside the range, and keeping a shipped call's
  // timeline where it already was - and the two nobody authored take the middle of their range.
  const want = new Map([
    ['1/2', [4, "CALLERLAB's single number for Half"]],
    ['3/4', [4.5, "the corpus's own beats for `Left Arm Turn 3/4`, inside CALLERLAB's 4 to 6"]],
    ['Full', [7, "the middle of CALLERLAB's 6 to 8"]],
  ]);
  for (const frac of ARM_TURN_FRACTIONS) {
    const name = `Arm Turn ${frac.spellings[0]}`;
    const [beats, why] = want.get(frac.spellings[0]);
    check(beatsOf(name) === beats, `"${name}" costs ${beatsOf(name)} beats - ${why}`);
  }
}

// ---------------------------------------------------------------- 5. every spelling the table claims resolves
console.log('\n== 5. every hand spelling and fraction spelling resolves ==');
{
  const hands = ['Arm Turn', 'Right Arm Turn', 'Left Arm Turn'];
  let tried = 0;
  let resolved = 0;
  for (const frac of ARM_TURN_FRACTIONS) {
    for (const spelling of frac.spellings) {
      for (const hand of hands) {
        const name = `${hand} ${spelling}`;
        tried++;
        if (seq.applyToBoard(rightWave, name).legal || seq.applyToBoard(leftWave, name).legal) resolved++;
        else check(false, `"${name}" is registered and applies to the hand its name gives`);
      }
    }
  }
  check(tried === resolved, `all ${tried} name spellings of the family resolve and turn (${resolved} applied)`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
