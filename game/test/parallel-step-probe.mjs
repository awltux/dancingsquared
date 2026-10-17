// A PARALLEL STEP THROUGH THE GAME'S OWN SEAM: the string a line carries, applied by the applier.
//
// WHY THIS IS A GATE. The engine can apply a group step as an OBJECT (`parallel-calls.mjs` pins that) and it can read a
// label back into one (`engine/test/step-parse.mjs` pins that). What neither pins is the game's path: its line is a list
// of STRINGS — what the wire records and what the server replays — so the seam between the two is a string containing
// ` || `, and a regression there would look like "the engine refused that call" rather than like a broken parse.
//
// THE ORACLE IS THE ENGINE'S OWN OBJECT FORM, built here over the same corpus: same board, same groups, applied through
// `Sequencer.applyToBoard(board, step)`. The game's string must reach the SAME BOARD, compared as a pose.
//
// Usage: node game/test/parallel-step-probe.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, makeSquaredSet, parseCallXml, setParser } from 'dancing-squared-engine';
import { createEngineApplier } from '../src/engine/applier.ts';
import { CORPUS } from '../../vite.corpus.ts';

setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = CORPUS;
void HERE;
const read = (p) => fs.readFileSync(path.join(ASSETS, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

// THE CORPUS, as the app's loader hands it over: one pair per TAM TITLE (the game's own rule), so the two sides are
// working from the same registrations.
const pairs = [];
const seen = new Set();
for (const file of fs.readdirSync(path.join(ASSETS, 'ms')).filter((f) => f.endsWith('.xml'))) {
  const xml = read(path.join('ms', file));
  for (const tam of parseCallXml(xml)) {
    if (!tam.title || seen.has(tam.title)) continue;
    seen.add(tam.title);
    pairs.push({ name: tam.title, xml });
  }
}
const applier = createEngineApplier({ movesXml, formationsXml, calls: pairs });
const start = makeSquaredSet();
const pose = (b) => b.dancers.map((d) => `${d.id}:${d.x},${d.y},${d.heading}`).join('|');

console.log(`== a two-group step through the applier (${pairs.length} titles registered) ==`);
{
  const readings = applier.readings(start).filter((r) => r.selection !== null);
  check(readings.length > 0, `${readings.length} group reading(s) to pair up`);

  // TWO DISJOINT SELECTIONS, and the label written the way `stepLabel` writes one.
  let witness = null;
  for (const a of readings) {
    const b = readings.find((other) => other.selection !== a.selection && other.call !== a.call);
    if (b) {
      witness = [a, b];
      break;
    }
  }
  check(witness !== null, 'a witness pair exists');
  const label = `${witness[0].selection} ${witness[0].call} || ${witness[1].selection} ${witness[1].call}`;

  // THE APPRAISER'S OWN ANSWER, and then the same move from the engine's OBJECT form as the oracle.
  const refusal = applier.refusalOf(start, label);
  check(refusal === null, `the applier accepts "${label}"${refusal ? ` (${refusal.reason})` : ''}`);
  if (refusal === null) {
    const viaGame = applier.apply(start, label);
    const seq = new Sequencer(movesXml, formationsXml);
    for (const call of pairs) seq.registerByTitle(call.name, call.xml);
    seq.setSnapMaxError(0);
    const oracle = seq.applyToBoard(start, {
      groups: [
        { selection: witness[0].selection, calls: [witness[0].call] },
        { selection: witness[1].selection, calls: [witness[1].call] },
      ],
    });
    check(oracle.legal, `and the engine's object form is legal too (${oracle.legal})`);
    check(pose(viaGame) === pose(oracle.board), 'and both reach the SAME board, so the string is not a second reading of the move');
    // BOTH GROUPS MOVED: a merge that dropped one lane would still be "legal" and would still differ from the start.
    const moved = witness.map((w) => applier.apply(start, (w.selection === null ? '' : `${w.selection} `) + w.call));
    check(pose(viaGame) !== pose(moved[0]) && pose(viaGame) !== pose(moved[1]), 'and it differs from EITHER group applied alone, so neither lane was dropped');
  }

  // A LABEL THE PARSER CANNOT READ IS ITS OWN REFUSAL, not an "unknown call" — the two are different mistakes, and a
  // player told "the engine refused X" for a malformed parallel step learns nothing.
  const malformed = applier.refusalOf(start, 'Heads ( Trade || Sides Trade');
  check(malformed !== null && malformed.reason.includes('parallel step'), `a malformed step says so (${malformed?.reason})`);
  // AND A PLAIN CALL IS UNTOUCHED: the seam must not route every call through the parser.
  check(applier.refusalOf(start, 'Promenade') === null || applier.refusalOf(start, 'Promenade')?.reason.includes('parallel') === false, 'a plain call is still applied as a call');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
