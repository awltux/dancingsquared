// ============================================================================================
// DOES THE SHIPPED CATALOGUE ACTUALLY LOAD?
//
// WHY THIS EXISTS. `Sequencer`'s constructor used to register each call inside a bare `catch`,
// and `CallLibrary.loadVariants` threw on the first `<tam>` it could not build. One bad
// `from=` attribute therefore erased an ENTIRE call and said nothing. Measured on the shipped
// assets, that silently lost two real Mainstream calls - `Ferris Wheel` (nine tams) and
// `Couples Circulate` - because one tam each names `T-Bone Couples`, a formation
// `formations.xml` does not ship (upstream does not ship it either; it has only
// `T-Bone Couples 1` and `T-Bone Couples 2`, so the unnumbered name is ambiguous and is NOT
// guessed here). The only symptom was `Unknown call: Ferris Wheel` much later, buried in a
// corpus report among dozens of genuine gaps.
//
// So there are two gates here and they guard different things:
//
//   1. NO CALL MAY VANISH. Every title handed to the sequencer must come back as a registered
//      call. This is the regression that actually happened.
//   2. THE KNOWN SKIPS ARE PINNED EXACTLY. A tam that cannot be built is now recorded rather
//      than thrown; the set is asserted against a literal list, so a NEW loss fails the build
//      instead of quietly shrinking the engine. Fixing one of the known skips must be an
//      explicit edit here too - the point is that the number cannot drift unnoticed.
// ============================================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');

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

// The calls that were lost and are the reason this harness exists. If either of these ever goes
// missing again the message should say so by name rather than reporting a number.
const REGRESSIONS = ['Ferris Wheel', 'Couples Circulate'];

/**
 * The tams that cannot be built today, EXACTLY. Both are the same dangling formation reference,
 * and it is the only one in the catalogue.
 */
const KNOWN_SKIPS = [
  { call: 'Ferris Wheel', reason: 'No formation "T-Bone Couples" for Ferris Wheel' },
  { call: 'Couples Circulate', reason: 'No formation "T-Bone Couples" for Couples Circulate' },
];

console.log('== every catalogue title the sequencer is given comes back as a call ==');
{
  const supplied = new Set(callsByTitle(assets).map((c) => c.name));
  const registered = new Set(seq.library.callNames());
  const missing = [...supplied].filter((n) => !registered.has(n));
  console.log(`  ${supplied.size} titles supplied, ${registered.size} registered`);
  check(missing.length === 0, missing.length
    ? `${missing.length} title(s) vanished during registration: ${missing.join(', ')}`
    : 'no title is lost during registration');
  for (const name of REGRESSIONS) {
    check(seq.library.hasCall(name), `"${name}" is registered (it was silently dropped once)`);
  }
}

console.log('\n== the skips that DO happen are recorded, and are exactly the known ones ==');
{
  const got = seq.registrationFailures()
    .map((f) => ({ call: f.call, reason: f.reason }))
    .sort((a, b) => a.call.localeCompare(b.call) || a.reason.localeCompare(b.reason));
  const want = [...KNOWN_SKIPS].sort((a, b) => a.call.localeCompare(b.call) || a.reason.localeCompare(b.reason));
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) {
    check(true, `exactly the ${want.length} known tam skip(s) are recorded, and nothing else`);
  } else {
    check(false, 'the recorded tam skips changed');
    console.log(`        want: ${JSON.stringify(want, null, 0)}`);
    console.log(`        got : ${JSON.stringify(got, null, 0)}`);
  }
  // A silently-empty list would pass the comparison above only if the known list were emptied,
  // so also assert the count is what the catalogue actually produces.
  check(want.length > 0, 'the known-skip list is non-empty (the shipped catalogue is not clean)');
  check(seq.registrationFailures().length === want.length,
    `the failure count is ${want.length}, not ${seq.registrationFailures().length}`);
}

console.log('\n=================');
if (failures === 0) console.log('CATALOGUE TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
