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
const assets = path.resolve(here, '..', '..', 'assets');

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
// the pin meaningful: 16 tams say "All" (everyone moves, where the mirror is correct) and 10 name a
// real subset ("Ends" 4, "Centers" 3, "Heads" 2, "Sides" 1).
//
// 28 -> 26, AND THE DIRECTION IS THE POINT. This pin counted 28 while the harness read the corpus with a raw
// `<tam>` regex: TWO OF THEM ARE COMMENTED OUT - `a1/split_square_thru.xml`'s `Heads Start` and `Sides Start`, both
// `actives="All"` - so they were never shipped tams, the corpus does not author them and the engine can never
// build them. The walk now goes through `packages/corpus`, which parses with the engine's own reader, so the two
// phantom declarations are gone and `All` falls 18 -> 16. NOTHING IN THE CORPUS CHANGED.
{
  const EXPECTED = { All: 16, Ends: 4, Centers: 3, Heads: 2, Sides: 1 };
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
// the ORDER witness fails if the walk goes back to ascending, and the `Circulate` setups fail if
// the pool is narrowed to the highest level that defines a title (`poc/src/data.ts` used to do that).
{
  const byId = (b) => b.dancers.slice().sort((a, c) => a.id - c.id);
  const normDeg = (d) => {
    let x = (d * 180) / Math.PI % 360;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };

  // Witness 1 — ORDER, PINNED STRUCTURALLY, AND THAT IS A MEASUREMENT. This witness used to be a
  // DANCE: the retired `b1/circle.xml` authored `Forward .59` + 8x `cl` and stopped, while
  // `ms/circle.xml` authored the round trip, so the two walks produced different end boards.
  // **`b1` is not a level any more** - `ASSET_LEVELS` has no `b1` and `assets/b1` does not
  // exist - and of the 31 titles that ARE still defined at two or more levels, NOT ONE is
  // order-sensitive: all 31 applied from all 138 named formations under both walks give the same
  // board for **4278 applications**, identical to the digit. So no dance can witness the order
  // today, and asking the pool itself is the honest instrument. It still fails for the wrong walk
  // (measured: see the negative control below), and it costs no application.
  const tamBlock = (rel, title) => {
    const xml = readFileSync(path.join(assets, rel), 'utf8');
    return (xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [])
      .find((blk) => (blk.match(/title="([^"]*)"/) ?? [])[1] === title);
  };
  // `Circulate` is the witness because it is defined at TWO levels whose authorings are different
  // setups rather than more of the same: `ms/circulate.xml` (the wave) and `c1/circulate.xml`
  // (`Thar`, `Wrong Way Thar`). THE `c1` BLOCK MUST COME FIRST, because `c1` is the HIGHER level and
  // the walk is highest-first - `callsByTitle` gathers `ASSET_LEVELS` REVERSED, so `c3b` is pooled
  // before `c1` before `ms`. THE NEGATIVE CONTROL is the rule reversed, and it was MEASURED rather
  // than assumed: walking `ASSET_LEVELS` ascending puts the `ms` block first and fails this check
  // (ms at 7, c1 at 2768 under the ascending walk; c1 at 7, ms at 2528 as shipped). Asserting the
  // levels in the other order is the mistake this comment exists to stop - it reads as obviously
  // right and is inverted.
  const pooled = callsByTitle(assets).find((c) => c.name === 'Circulate');
  const msBlock = tamBlock('ms/circulate.xml', 'Circulate');
  const c1Block = tamBlock('c1/circulate.xml', 'Circulate');
  check(!!pooled && !!msBlock && !!c1Block, 'both authorings of `Circulate` and its pool are present');
  const at = (blk) => (pooled && blk ? pooled.xml.indexOf(blk) : -1);
  check(at(msBlock) >= 0 && at(c1Block) >= 0 && at(c1Block) < at(msBlock),
    `the pool lists the HIGHER level first (c1 at ${at(c1Block)}, ms at ${at(msBlock)})`);

  // Witness 1b — THE ROUND TRIP, AND WHICH TITLE AUTHORS IT. `ms/circle.xml`'s own section header
  // says `CIRCLE LEFT FAMILY FROM STATIC SQUARE TO CIRCLE`, and the file publishes the round trip
  // under the sibling title: `Circle Left Home` ends exactly where it started, while the
  // BARE `Circle Left` is authored to end in the `Circle` formation. Both halves are asserted,
  // because a corpus change that made the bare title round-trip is worth seeing - and this is now a
  // CORPUS assertion, not an order one.
  //
  // THE SIBLING IS `Circle Left Home`, AND THE NAME IT REPLACED (`Circle Left - Stop at Home`) NAMED
  // NOTHING. That is how this check came to be red for the whole of the corpus's rename, and the three
  // checks under it kept printing `ok` while it was: `applyToBoard` hands back the INPUT board with
  // `legal: false`, so residuals measured on it are zero, its headings are unchanged and it is still the
  // square - the identity, scored as a perfect round trip. So legality now GATES those three rather than
  // sitting beside them: a dead title costs four reds that each name the refusal (§11.2.1).
  const square = seq.boardForFormation('Static Square');
  const cl = seq.applyToBoard(square, 'Circle Left Home');
  check(cl.legal, `\`Circle Left Home\` is legal from a Static Square (${cl.reason ?? 'ok'})`);
  if (!cl.legal) {
    check(false, `and it ROUND-TRIPS - NOT MEASURED: the call was refused (${cl.reason})`);
    check(false, `and leaves every facing where it found it - NOT MEASURED: the call was refused (${cl.reason})`);
    check(false, `the board after \`Circle Left Home\` is named Static Square - NOT MEASURED: the call was refused (${cl.reason})`);
  } else {
    const a = byId(square);
    const b = byId(cl.board);
    const posResid = Math.max(...a.map((d, i) => Math.hypot(d.x - b[i].x, d.y - b[i].y)));
    const headResid = Math.max(...a.map((d, i) => Math.abs(normDeg(b[i].heading - d.heading))));
    check(posResid < 0.01,
      `and it ROUND-TRIPS (worst position residual ${posResid.toFixed(4)})`);
    check(headResid < 1,
      `and leaves every facing where it found it (worst heading residual ${headResid.toFixed(2)} deg)`);
    check(seq.knownFormation(cl.board) === 'Static Square',
      `the board after \`Circle Left Home\` is named Static Square (got ${seq.knownFormation(cl.board)})`);
  }
  const bare = seq.applyToBoard(square, 'Circle Left');
  check(bare.legal && seq.knownFormation(bare.board) === 'Circle',
    `while the BARE \`Circle Left\` ends on the Circle formation (got ${bare.legal ? seq.knownFormation(bare.board) : 'illegal'}) - the corpus authors the round trip under the sibling title`);

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
