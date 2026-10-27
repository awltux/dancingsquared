// ONE TEMPO, THREE APPS - and the one place each of them turns a beat into a millisecond.
//
// Asked for as TODO item 49: `MS_PER_BEAT` was "declared twice and derived a third time - and the game's comment says
// it is reused". It is: MEASURED when this probe was written, three declarations existed and NONE imported another:
//
//   game/src/puzzle/config.ts    export const MS_PER_BEAT = 500;      the comment claimed to be "the ONLY place a
//                                                                    beat is related to a millisecond"
//   poc/src/sequencer-ui.ts      const MS_PER_BEAT = 500;             private, no import in either direction
//   poc-teacher/src/preview.ts   const MS_PER_BEAT = 60000 / PREVIEW_BPM;
//
// WHY NOT ONE OWNER. The obvious home is the engine, which owns the BEAT - but a playback tempo is presentation, and
// the game's copy lives in `src/puzzle/`, the pure seeded core that a probe loads under node's type stripping. The two
// apps share exactly one package, `dancing-squared-stage`, whose index re-exports `scene.ts` (and therefore `three`);
// importing the tempo from there would drag a renderer into the puzzle core, which is the thing that core exists to
// avoid. The teacher's is not a copy at all: it PREVIEWS at its own tempo (64 bpm), which is why it derives from a
// named BPM instead of a literal - that is the shape the other two would take if they ever needed a second tempo.
//
// SO: TWO COPIES, ONE GATE. This probe reads all three sources as TEXT (a panel and a pure module each cannot be
// imported here for their own reasons - DOM and type stripping respectively) and asserts that the two copies agree,
// that the agreement is the 120 bpm both comments claim, and that the teacher's derivation is a derivation. A change
// to either number without the other is a FAIL here rather than two apps showing different dances.
//
// Run: node poc/tools/tempo-probe.mjs   (from anywhere; reads text, needs no engine build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const GAME_CONFIG = 'game/src/puzzle/config.ts';
const POC_PANEL = 'poc/src/sequencer-ui.ts';
const TEACHER_PREVIEW = 'poc-teacher/src/preview.ts';

/** The number a source declares under `name`, or null when the declaration is GONE - which is a failure, not a zero. */
const declared = (source, name) => {
  const m = new RegExp(`(?:export )?const ${name} = (\\d+);`).exec(source);
  return m ? Number(m[1]) : null;
};

const game = declared(read(GAME_CONFIG), 'MS_PER_BEAT');
const poc = declared(read(POC_PANEL), 'MS_PER_BEAT');
check(game !== null, `${GAME_CONFIG} still declares \`MS_PER_BEAT\` (${game})`);
check(poc !== null, `${POC_PANEL} still declares \`MS_PER_BEAT\` (${poc})`);
check(game === poc, `the two copies AGREE (game ${game}, POC ${poc}) - a beat is the same length in both apps`);
// THE NUMBER ITSELF, so the agreement cannot be two identical mistakes: 120 beats a minute is what both comments say.
check(game === 60000 / 120, `and that value is 120 beats a minute (${game} ms = ${60000 / game} bpm)`);

// THE TEACHER PREVIEWS AT ITS OWN TEMPO, and the check is that it DERIVES rather than copies: a literal 937.5 would be
// a third copy of the same fact, while `60000 / PREVIEW_BPM` cannot drift from the BPM the panel exposes.
const teacher = read(TEACHER_PREVIEW);
check(/const PREVIEW_BPM = \d+;/.test(teacher), 'the teacher names its preview tempo (`PREVIEW_BPM`)');
check(/const MS_PER_BEAT = 60000 \/ PREVIEW_BPM;/.test(teacher),
  'and derives the beat length from it, so it is a third TEMPO rather than a third copy of the constant');

// THE NEGATIVE CONTROL: the comparison above fails on the fault it was written for - one copy moved, the other not.
{
  const moved = read(POC_PANEL).replace('const MS_PER_BEAT = ' + poc + ';', 'const MS_PER_BEAT = ' + (poc + 1) + ';');
  const movedValue = declared(moved, 'MS_PER_BEAT');
  check(movedValue === poc + 1 && movedValue !== game, 'moving one copy fails the agreement check (the control)');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
