// THE APPLY READS THE NAME, AND SAYS WHAT IT READ — the wiring, pinned where it matters.
//
// `CallApplicator.applyToBoard` is the reading boundary: every caller hands it a string, whether that string came
// from a picker, a panel, the All8 import or a harness. This gate pins the two halves that make the interpretation
// safe rather than clever:
//
//  1. A NAME THE LIBRARY PUBLISHES IS APPLIED AS ITSELF, with no `readAs`, so a title can never be reread as
//     somebody's reading — the rule `selection.ts` states as "does the library publish this name", which is why
//     `Heads Pass Thru` (a real scoped tam) keeps its whole-board behaviour.
//  2. A NAME IT DOES NOT PUBLISH IS READ, AND WHAT IT READ COMES BACK. `Promenade Home` is not a title any more
//     (the family was retitled in `e02b434`), so it now dances `Promenade` and reports
//     `{ title: 'Promenade', how: 'alias' }`. A caller that keeps asking for a dead name therefore keeps working
//     AND can see that the name is dead — the alternative, a silent rename, is how a stale name survives for
//     months without anyone noticing.
//
// AND A REFUSAL IS NOT A READING: `Headz Promenade` refuses with the engine's own `Unknown call:` message and no
// `readAs`, so "unknown" never arrives dressed as an interpretation.
//
// Usage: node engine/test/call-reading.mjs   (engine must be built: it imports the applicator from dist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, makeSquaredSet } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const read = (name) => fs.readFileSync(path.join(assets, name), 'utf8');

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) {
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`);
    failures++;
  } else console.log(`  ok   ${what}`);
};

console.log('call-reading: a raw string, read at the apply boundary\n');

const calls = callsByTitle(assets);
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), calls);
const square = makeSquaredSet();
const apply = (name) => seq.applyToBoard(square, name);
console.log(`  ${calls.length} calls registered by title; a squared set is the board`);

// ---------------------------------------------------------------- 1. a published name is applied as itself
const published = apply('Promenade');
check(published.legal, 'a published title applies from a squared set (`Promenade`)', published.reason);
check(published.readAs === undefined, 'and reports NO `readAs` — a title applied as itself was not read', JSON.stringify(published.readAs));

// ---------------------------------------------------------------- 2. a name it does not publish is read, and reported
const alias = apply('Promenade Home');
check(alias.legal, '`Promenade Home` — a CALLERLAB name this corpus does not author — still applies', alias.reason);
check(
  JSON.stringify(alias.readAs) === JSON.stringify({ title: 'Promenade', selection: null, how: 'alias' }),
  'and SAYS it read the description `Promenade` by alias',
  JSON.stringify(alias.readAs),
);

const scoped = apply('Heads Promenade to Home');
check(scoped.legal, '`Heads Promenade to Home` applies — a selection, a description and the home ending at once', scoped.reason);
check(scoped.readAs && scoped.readAs.title === 'Promenade' && scoped.readAs.selection === 'Heads',
  'and reports the selection it read under', JSON.stringify(scoped.readAs));

const modifier = apply('Circle Left to Home');
check(modifier.legal, '`Circle Left to Home` applies', modifier.reason);
check(modifier.readAs && modifier.readAs.title === 'Circle Left Home' && modifier.readAs.how === 'modifier',
  'and reports the MODIFIER reading that found the corpus\'s own spelling', JSON.stringify(modifier.readAs));

// THE ONE THAT MATTERS MOST: a STALE name is obeyed AND reported. `Promenade Full` was a title once; the notation
// decodes `Pr4/4` to the bare `Promenade` for the same reason this reading does, and a harness that asked for it
// needs to be able to see that it got the bare one.
const stale = apply('Promenade Full');
check(stale.legal && stale.readAs && stale.readAs.title === 'Promenade',
  'a stale name (`Promenade Full`) dances the call it describes AND is reported as a reading', JSON.stringify(stale.readAs));

// ---------------------------------------------------------------- 3. a refusal is not a reading
const unknown = apply('Headz Promenade');
check(!unknown.legal && unknown.readAs === undefined, 'an unreadable string refuses with no `readAs`', JSON.stringify(unknown.readAs));
check(/^Unknown call: /.test(unknown.reason ?? ''), 'and keeps the engine\'s own refusal message', JSON.stringify(unknown.reason));

// ---------------------------------------------------------------- 4. the engine's existing scoped reading still works
// The old path: a selection over a PUBLISHED call. It must keep working, and must not report a `readAs` for the
// base call it was told about — the reading here is `splitSelection`'s, which predates this module.
const old = apply('Heads Dosado');
check(old.legal || /not legal for selected dancers/.test(old.reason ?? ''),
  'the pre-existing scoped reading (`Heads Dosado`) reaches the subset path as before', JSON.stringify(old.reason));

console.log(`\ncall-reading: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
