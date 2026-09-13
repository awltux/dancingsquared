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

import { Sequencer, parseCallXml, setParser } from '../dist/index.js';
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

console.log('\n== the `actives` attribute is carried, and the shipped data is PINNED ==');
// The attribute says WHICH DANCERS a tam's paths describe. Nobody read it, and that is the whole
// reason `Centers Split Two` dances as a whole-board `Pass Thru`: the tam is authored against a
// FOUR-dancer `Eight Chain Thru` formation with `actives="Centers"`, and the engine MIRRORS that
// setup to eight, so the centres' motion is applied to everybody (PLAN.md, Phase C). Carrying the
// attribute is the first half - the plumbing that makes the mis-registration visible and gateable;
// what to DO with it at the apply path is a separate, riskier step.
//
// The values are pinned as a literal so the shipped data cannot drift silently, and so that adding
// a subset-authored tam is a deliberate edit. Counting by VALUE rather than by tam is what makes
// the pin meaningful: 18 tams say "All" (everyone moves, where the mirror is correct) and 10 name a
// real subset ("Ends" 4, "Centers" 3, "Heads" 2, "Sides" 1).
{
  const EXPECTED = { All: 18, Ends: 4, Centers: 3, Heads: 2, Sides: 1 };
  const got = new Map();
  let declared = 0;
  for (const { xml } of callsByTitle(assets)) {
    for (const tam of parseCallXml(xml)) {
      if (!tam.actives) continue;
      declared++;
      got.set(tam.actives, (got.get(tam.actives) ?? 0) + 1);
    }
  }
  check(got.size > 0, 'the pipeline carries `actives` at all (it was parsed by nobody)');
  check(declared === Object.values(EXPECTED).reduce((a, b) => a + b, 0),
    `exactly ${Object.values(EXPECTED).reduce((a, b) => a + b, 0)} shipped tams declare actives=, not ${declared}`);
  const mismatched = Object.entries(EXPECTED).filter(([k, v]) => got.get(k) !== v);
  check(mismatched.length === 0,
    `the declared values are unchanged (${[...got.entries()].map(([k, v]) => `${k}:${v}`).sort().join(' ')})`);
  if (mismatched.length) console.log(`        wanted ${JSON.stringify(EXPECTED)}`);
  // ...and the one that motivated the plumbing says what it says, so the record cannot rot.
  const split = parseCallXml(
    readFileSync(path.join(assets, 'ms', 'split_the_outside_couple.xml'), 'utf8'),
  ).filter((t) => t.actives);
  check(split.length > 0 && split.every((t) => t.actives === 'Centers'),
    `"Centers Split Two"'s tams are the subset-authored witness (${split.map((t) => t.actives).join(', ')})`);
}

console.log('\n== a call defined at several LEVELS: the pool is highest-first, and nothing is dropped ==');
// WHY THIS IS A GATE. A title defined at two levels is two AUTHORINGS of one call, and
// `FormationMatcher.findMatchingVariant` decides an equal error by array order, so the order of
// the pool decides which authoring dances. `callsByTitle` used to walk `ASSET_LEVELS` ascending,
// which handed every tie to the LOWEST level; reverting that is silent everywhere except here.
// The two witnesses pin both halves of the rule, and each one alone is satisfied by a WRONG rule:
// the round trip fails if the order goes back to ascending, and the `Circulate` setups fail if the
// pool is narrowed to the highest level that defines a title (`poc/src/data.ts` used to do that).
{
  const byId = (b) => b.dancers.slice().sort((a, c) => a.id - c.id);
  const normDeg = (d) => {
    let x = (d * 180) / Math.PI % 360;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };

  // Witness 1 — ORDER. `b1/circle.xml` authors `Forward .59` + 8x `cl` and stops, so the dancer
  // never steps back out of the circle: that authoring ends at radius 2.61 with a 43.8 degree
  // heading error. `ms/circle.xml` authors the round trip and ends exactly where it started.
  const square = seq.boardForFormation('Static Square');
  const cl = seq.applyToBoard(square, 'Circle Left');
  check(cl.legal, 'Circle Left is legal from a Static Square');
  const a = byId(square);
  const b = byId(cl.board);
  const posResid = Math.max(...a.map((d, i) => Math.hypot(d.x - b[i].x, d.y - b[i].y)));
  const headResid = Math.max(...a.map((d, i) => Math.abs(normDeg(b[i].heading - d.heading))));
  check(posResid < 0.01,
    `Circle Left from a Static Square ROUND-TRIPS (worst position residual ${posResid.toFixed(4)}, was 0.6140 under the ascending order)`);
  check(headResid < 1,
    `Circle Left leaves every facing where it found it (worst heading residual ${headResid.toFixed(2)} deg, was 43.80)`);
  check(seq.knownFormation(cl.board) === 'Static Square',
    `the board after Circle Left is still named Static Square (got ${seq.knownFormation(cl.board)})`);

  // Witness 2 — NOTHING IS DROPPED. `Circulate` is defined in `ms/circulate.xml` AND in
  // `c1/circulate.xml`, whose tams are `Thar`, `Wrong Way Thar`, `Star Promenade`,
  // `Reverse Star Promenade` - different setups, not more of the same. Keeping only the highest
  // level that defines the title therefore loses every Mainstream `Circulate` AND the 39 figures
  // that use one. Measured: 90 figures pooled, 64 with the highest level alone.
  const waves = seq.boardForFormation('Ocean Waves');
  const circ = seq.applyToBoard(waves, 'Circulate');
  check(circ.legal,
    `Circulate is still legal from Ocean Waves, a setup only the Mainstream authoring carries (${circ.reason ?? 'ok'})`);
}

console.log('\n=================');
if (failures === 0) console.log('CATALOGUE TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
