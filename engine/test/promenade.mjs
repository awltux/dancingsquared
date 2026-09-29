// Promenade — the standard finish — and the corpus evidence for it.
//
// WHY THIS EXISTS: All8's published corpus indexes its get-outs by alignment and
// typically ends them at a conventional finish (`--AL`, `--RLG`, `--Prom`). The
// engine had Allemande Left and Right and Left Grand, but bare `Promenade` was a
// call it KNEW (assets/src/calls.xml indexes it) and could not PERFORM: the shipped
// promenade.xml implements only the qualified forms (Heads Promenade 1/2, Sides
// Promenade Full, Star Promenade, ...). Every get-out that finishes with `--Prom`
// therefore stopped with "Unknown call" once its body had already reached the state
// it was written to reach.
//
// The rule implemented in src/sequencer/promenade.ts is Taminations' own, and the
// gates below hold it to the corpus rather than to that description:
//
//   * a promenade returns the LITERAL home squared set — every dancer back on its
//     own spot and facing — from any rotated squared set, and from the formations the
//     corpus actually promenades out of (facing lines, two-faced lines);
//   * it refuses a set that cannot be promenaded home, and says which way it fails:
//     couples permuted round the ring (out of sequence), couples not one per side of
//     the square, partners not standing together as a couple, or no home identity at
//     all;
//   * the analyser neither teleports a board home for a promenade that does not apply
//     nor counts one as a "zero" it is not.
//
// Run: `npm run build && node test/promenade.mjs` from engine/.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, promenadeHome, PROMENADE_BEATS, boardForFasrCode } from '../dist/index.js';
import { callsByTitle, engineNameFor } from './lib/engine-calls.mjs';
import { decodeLine } from './lib/getout-decode.mjs';
import { startBoardFor, templateForLetter } from './lib/all8-boards.mjs';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const assets = path.join(root, 'poc/src/assets');

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);
const flip = (h) => (h > Math.PI ? 2 * Math.PI : 0) + h;const face = (h) => Math.round((((h * 180) / Math.PI) % 360 + 360) % 360);

/** Exact-pose comparison by dancer id: position and facing, both to zero tolerance. */
function sameBoard(a, b) {
  if (a.dancers.length !== b.dancers.length) return `dancer count ${a.dancers.length} vs ${b.dancers.length}`;
  const byId = new Map(b.dancers.map((d) => [d.id, d]));
  for (const d of a.dancers) {
    const e = byId.get(d.id);
    if (!e) return `no dancer ${d.id} in the expected board`;
    if (Math.abs(d.x - e.x) > 1e-9 || Math.abs(d.y - e.y) > 1e-9) {
      return `dancer ${d.id} at (${d.x.toFixed(2)},${d.y.toFixed(2)}), expected (${e.x.toFixed(2)},${e.y.toFixed(2)})`;
    }
    if (face(d.heading) !== face(e.heading)) return `dancer ${d.id} facing ${face(d.heading)}, expected ${face(e.heading)}`;
  }
  return null;
}

/** Rotate a board by k quarter-turns counter-clockwise (a rotation, never a mirror). */
function rotated(board, k) {
  return {
    dancers: board.dancers.map((d) => {
      let { x, y } = d;
      for (let i = 0; i < k; i++) [x, y] = [-y, x];
      return { ...d, x, y, heading: flip(d.heading + (k * Math.PI) / 2) };
    }),
  };
}

const home = seq.startBoard();

// ------------------------------------------------------- 1. home, and rotations of it

console.log('== 1. a promenade returns the literal home squared set ==');
for (const turns of [0, 1, 2, 3]) {
  const from = rotated(home, turns);
  const r = seq.applyToBoard(from, 'Promenade');
  if (!r.legal) { fail(`a squared set rotated ${turns * 90} degrees: ${r.reason}`); continue; }
  const diff = sameBoard(r.board, home);
  if (diff) { fail(`a squared set rotated ${turns * 90} degrees promenaded to the wrong board: ${diff}`); continue; }
  if (seq.knownFormation(r.board) !== 'Static Square') fail(`rotated ${turns * 90} degrees: ends as ${seq.knownFormation(r.board)}`);
  else ok(`squared set rotated ${turns * 90} degrees -> every dancer back on its own spot and facing`);
}
// The alias All8 writes as --PromH.
{
  const r = seq.applyToBoard(home, 'Promenade Home');
  const diff = r.legal ? sameBoard(r.board, home) : r.reason;
  if (diff) fail(`"Promenade Home" from home: ${diff}`); else ok('"Promenade Home" is the same call');
}

// ------------------------------------------- 2. the formations the corpus promenades out of

console.log('\n== 2. the corpus promenades out of formations that are not squared sets ==');
// All8's [L.F1p] page has exactly one get-out: "--PromH", with no body at all. So the
// start board of that alignment IS a board All8 says promenades home, and it is a
// two-faced line, not a squared set.
const corpus = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'all8-getouts.json'), 'utf8'));
const pure = corpus.alignments.find((a) => a.id === 'L.F1p');
if (!pure) fail('the corpus no longer has the [L.F1p] alignment');
else {
  const start = startBoardFor(seq, pure);
  if (!start.board) fail(`[L.F1p]: ${start.reason}`);
  else {
    const before = seq.knownFormation(start.board);
    const r = seq.applyToBoard(start.board, 'Promenade');
    const diff = r.legal ? sameBoard(r.board, home) : r.reason;
    if (diff) fail(`[L.F1p] ("--PromH" and nothing else): ${diff}`);
    else ok(`[L.F1p] (${before}) promenades home with no body at all`);
  }
}
// Facing lines in sequence: the couples are together and one per quadrant, so the
// dancers form up and promenade. This is a positive case the engine must NOT reject.
for (const id of ['L1p', 'W1p', 'F1p']) {
  const a = corpus.alignments.find((x) => x.id === id);
  if (!a) { fail(`the corpus no longer has [${id}]`); continue; }
  const start = startBoardFor(seq, a);
  const r = start.board ? seq.applyToBoard(start.board, 'Promenade') : { legal: false, reason: start.reason };
  if (!r.legal) { fail(`[${id}] (${start.board ? seq.knownFormation(start.board) : '?'}) cannot promenade home: ${r.reason}`); continue; }
  const diff = sameBoard(r.board, home);
  if (diff) fail(`[${id}] promenaded to the wrong board: ${diff}`);
  else ok(`[${id}] (${seq.knownFormation(start.board)}) promenades home`);
}

// ------------------------------------------------------ 3. what it must refuse, and why

console.log('\n== 3. the boards a promenade must refuse ==');
const refused = (label, board, expect) => {
  const r = seq.applyToBoard(board, 'Promenade');
  if (r.legal) { fail(`${label}: accepted, but should not be`); return; }
  if (!r.reason || !expect.test(r.reason)) { fail(`${label}: refused for the wrong reason: ${r.reason}`); return; }
  ok(`${label}: refused — ${r.reason}`);
};

// (a) the couples permuted round the ring: no single wheeling brings everybody home.
{
  const swapped = { dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, couple: 2 } : d.couple === 2 ? { ...d, couple: 1 } : { ...d })) };
  refused('couples 1 and 2 swapped round the ring', swapped, /out of sequence/);
}
// (b) two couples on the same side of the square: the ring is formed on the way round, so the
//     LAYOUT is not the refusal - but a body with dancers on top of each other still is.
{
  const bunched = {
    dancers: home.dancers.map((d) => (d.couple === 4 ? { ...d, x: d.x + 4, y: d.y + 4.5 } : { ...d })),
  };
  refused('couples 3 and 4 both on the north side', bunched, /on top of each other/);
}
// (c) partners NOT standing together is no longer a refusal, and that is a measured correction:
//     a pair takes promenade position from wherever they are, and the corpus's legitimate
//     pre-promenade boards have partners SIX apart because they are waves. 3 of the 32 published
//     figures that used to stop on Promenade stopped on exactly this band. What must still be
//     refused is a body that has fallen apart - dancers on the same spot - which is the collision
//     guard these two cases now pin, one on each side.
{
  const apart = { dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, x: d.x * 2 } : { ...d })) };
  const r = seq.applyToBoard(apart, 'Promenade');
  if (!r.legal) fail(`partners 4 apart is the normal case and must promenade: ${r.reason}`);
  else ok('partners 4 apart promenades home (forming the ring is part of the call)');
}
refused('dancers on the same spot', {
  dancers: home.dancers.map((d) => (d.couple === 1 ? { ...d, x: d.x / 8 } : { ...d })),
}, /on top of each other/);
// (d) no home identity: a template board has couples but no couple NUMBERS, and
//     "promenade home" is only meaningful against the dancers' own home spots.
{
  const template = seq.boardForFormation('Normal Lines');
  if (!template) fail('no "Normal Lines" template board');
  else refused('a Formation-tab template (no home identity)', template, /identity/);
}
// (e) All8's [B2r] box: an alignment whose page lists "G-UTurn --Prom", but whose
//     couple layout in All8's own diagram is the MIRROR of the home square (couples
//     3,2,1,4 counter-clockwise where home is 1,2,3,4). No rotation of that board
//     reaches the home square, so this finish cannot be identity-preserving. Recorded
//     as a finding, not silently accepted — see square-dancing.md.
{
  const a = corpus.alignments.find((x) => x.id === 'B2r');
  const start = a ? startBoardFor(seq, a) : { reason: 'no [B2r] in the corpus' };
  if (!start.board) fail(`[B2r]: ${start.reason}`);
  else {
    const g = seq.applyToBoard(start.board, 'Girls U-Turn Back');
    if (!g.legal) fail(`[B2r] "Girls U-Turn Back": ${g.reason}`);
    else refused('[B2r] after "Girls U-Turn Back"', g.board, /out of sequence/);
  }
}

// ------------------------------------------- 3b. CALLERLAB's temporary couple number
//
// "The figure portion of singing calls almost always causes each Woman to progress to a new Man.
// Once this has happened, she temporarily takes on the Head/Side identity and home position of that
// Man." The engine never applies that convention to the board — doing so globally cost figures
// (PLAN.md phase 19, measured twice) because `couple` also carries the Heads/Sides identity a later
// `Heads ...` call targets. It is applied where identity is READ instead: `promenadeProblem` groups
// the dancers by their PHYSICAL pairing, each pair taking the MAN's couple, when the board is
// unambiguously a set of man-and-woman couples two apart.
//
// MEASURED on the board `figm` #31/#83 reaches (the chain `... Pass Thru | Trade By | Swing Your
// Partner | Promenade`): an Eight Chain Thru whose physical couples are (#1B,#6G), (#2G,#5B),
// (#3B,#4G), (#7B,#8G) — every one a man and a woman two apart.
//
// THE STALE CASE THIS GATE WAS WRITTEN FOR IS GONE, and that is a fix rather than a loss. The chain
// used to end with the stored identity pairing #1 with #2 and #5 with #6, six apart across the set,
// because the `Boys Run` inside it picked its partner from the HOME couple: at that point `#1` faced
// south and `#8` faced north, so no pair was standing as a couple and the fallback named `#6` - who
// was FOUR units away, and not beside the runner at all. `Run` now reads the current pairing
// (`couples.ts`), `#1` and `#8` are co-facing and two apart at that moment, and the run takes the
// dancer beside it. The chain therefore arrives at a board whose physical couples and stored couples
// AGREE, so `Promenade` no longer needs the convention to resolve THIS board.
//
// The convention itself is still exercised, and still must not weaken the in-sequence refusal below.
// What this block pins now is the property the chain can still witness: the physical couples are the
// side-by-side pairs, and `Promenade` is legal there. If a future change makes the chain stale again,
// the assertions still hold — and the note above says what to look for.
{
  console.log('\n== 3b. CALLERLAB\'s temporary couple number, read where identity is used ==');
  // The exact board, built by replaying the published chain rather than by hardcoding coordinates.
  let b = seq.startBoard();
  for (const call of [
    'Heads Promenade 1/2', 'Heads Square Thru 4', 'Touch 1/4', 'Scoot Back', 'Boys Run',
    'Star Thru', 'Pass Thru', 'Trade By', 'Swing Your Partner',
  ]) {
    const r = seq.applyToBoard(b, call);
    if (!r.legal) { fail(`figm31 chain: "${call}" refused: ${r.reason}`); b = null; break; }
    b = r.board;
  }
  if (b) {
    // Assert the WITNESS is what it claims to be before using it, so the gate cannot go vacuous.
    const byId = new Map(b.dancers.map((d) => [d.id, d]));
    const side = (a, c) =>
      Math.abs(Math.hypot(byId.get(a).x - byId.get(c).x, byId.get(a).y - byId.get(c).y) - 2) < 0.35 &&
      byId.get(a).heading === byId.get(c).heading;
    if (!(side(1, 6) && side(2, 5) && side(3, 4) && side(7, 8))) {
      fail('figm31 witness: the physical couples are not two apart side by side');
    } else {
      // The physical pairs are the side-by-side pairs, which is the fact `Promenade` anchors the ring
      // from. Whether the STORED couples disagree is reported rather than required: the chain used to
      // end stale (see the note above) and now ends consistent, and both are valid boards for the
      // property under test. Requiring the stale shape would make the gate fail on the fix.
      ok('the witness is an Eight Chain Thru whose physical pairs are the side-by-side pairs');
      const spread = Math.hypot(byId.get(1).x - byId.get(2).x, byId.get(1).y - byId.get(2).y);
      console.log(`  (#1,#2) separation: ${spread.toFixed(2)}` +
        ` - ${spread > 2.35 ? 'STALE, the case this gate was written for' : 'the chain now ends with the stored couples together'}`);
      const r = seq.applyToBoard(b, 'Promenade');
      if (!r.legal) fail(`Promenade must be legal on the chain's own board: ${r.reason}`);
      else ok('Promenade is legal there: the physical couples anchor two-to-a-side');
    }
  }
  // ...and the convention must NOT weaken the genuine in-sequence refusal: a set whose rings are
  // permuted is still refused (this is the [B2r] case above, re-stated as the control).
  const a = corpus.alignments.find((x) => x.id === 'B2r');
  if (a) {
    const start = startBoardFor(seq, a);
    if (start.board) {
      const g = seq.applyToBoard(start.board, 'Girls U-Turn Back');
      if (g.legal) refused('[B2r] control still refused after the convention', g.board, /out of sequence/);
    }
  }
}

// ------------------------------------------------------------ 4. the analyser agrees

console.log('\n== 4. the analyser: beats, no teleport, and no false zero ==');
if (seq.sequenceBeats(['Promenade']) !== PROMENADE_BEATS) fail('sequenceBeats(["Promenade"]) is not the coded beat count');
else ok(`a promenade occupies ${PROMENADE_BEATS} beats on the timeline`);
if (!seq.isZero(['Promenade'])) fail('a promenade from home is not reported as a zero');
else ok('a promenade from home is a zero (it returns home in sequence, facing restored)');
{
  // Interpolate from a board that is NOT home, or the test would compare home to
  // home at every beat and prove nothing: [L.F1p]'s start board is a two-faced line,
  // and All8's own page for it says the promenade finish works from there.
  const from = startBoardFor(seq, corpus.alignments.find((x) => x.id === 'L.F1p')).board;
  const half = seq.evaluateSequence(['Promenade'], PROMENADE_BEATS / 2, from).board;
  const diff = sameBoard(half, home);
  if (!diff) fail('the board half way through a promenade is already home (it should be in motion)');
  // "In motion" used to be checked as "not home", which a wobble passes. A half-beat of a
  // promenade is a long way round the ring, so the tightening is a FLOOR on how far the worst
  // dancer has actually travelled from the board it started on.
  let moved = 0;
  {
    const by = new Map(half.dancers.map((d) => [d.id, d]));
    for (const d of from.dancers) {
      const e = by.get(d.id);
      if (e) moved = Math.max(moved, Math.hypot(e.x - d.x, e.y - d.y));
    }
  }
  if (moved < 1.0) {
    fail(`half way through a promenade from [L.F1p] the worst dancer has moved only ${moved.toFixed(3)} units of the 4 units it must - the call is not dancing`);
  } else ok(`half way through a promenade from [L.F1p] the board is in motion, not home (worst dancer ${moved.toFixed(2)} units from its start)`);
  const endDiff = sameBoard(seq.evaluateSequence(['Promenade'], PROMENADE_BEATS, from).board, home);
  if (endDiff) fail(`at the last beat of a promenade the board is not home: ${endDiff}`);
  else ok('at the last beat of a promenade the board is exactly home');
}

// ------------------------------------------- 4b. the ring's travel comes from the CALL
//
// A FULL `Promenade` IS "promenade until you are home", so FROM HOME its end board IS the board it
// started on - and an animation that derives its arc from the start->end difference then has nothing
// to sweep and leaves all eight dancers standing while the timeline counts eight beats. That is the
// POC report this gate exists for ("the dancers don't move, but the sequencer counts 8 beats"), and
// the CALLERLAB definitions are the rule that fixes it: "Promenade Direction: Counter-clockwise",
// and "Especially in singing calls, Promenade Home is usually more than a quarter of the way around
// the set. If not, dancers are often expected to add a full Promenade." So from a squared set the
// call is one full circuit counter-clockwise. The reference agrees and it is the stronger evidence
// because it is an animation: Taminations' `promenade_home.dart` repeatedly applies `Counter Rotate`
// (a quarter turn about the set centre) in a `do/while` until the dancer's location angle returns to
// its home anchor, which from a squared set is four of them.
//
// The primitives below pin the SHAPE, the DIRECTION and the MAGNITUDE in one measurement each, and
// they are exact rather than approximate: the arc is `as + (trip + lap) * t` at the ring's own
// radius, so a quarter of the way through the call every dancer is a quarter turn counter-clockwise
// from where it started, to floating-point precision.
console.log('\n== 4b. a full promenade from home is one counter-clockwise circuit ==');
{
  const centre = (b) => {
    const p = b.dancers.filter((d) => !d.isGhost);
    return { x: p.reduce((s, d) => s + d.x, 0) / p.length, y: p.reduce((s, d) => s + d.y, 0) / p.length };
  };
  /** The same board turned `turn` radians counter-clockwise about its own centre. Positions only:
   * a ring move eases each dancer's FACING towards the end board's, so only the wheel is compared. */
  const spin = (b, turn) => {
    const c = centre(b);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return {
      dancers: b.dancers.map((d) => {
        const x = d.x - c.x;
        const y = d.y - c.y;
        return { ...d, x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
      }),
    };
  };
  const worstGap = (a, b) => {
    const by = new Map(b.dancers.map((d) => [d.id, d]));
    let worst = 0;
    for (const d of a.dancers) {
      const e = by.get(d.id);
      if (!e) return Infinity;
      worst = Math.max(worst, Math.hypot(d.x - e.x, d.y - e.y));
    }
    return worst;
  };

  const quarter = worstGap(seq.evaluateSequence(['Promenade'], PROMENADE_BEATS / 4, home).board, spin(home, Math.PI / 2));
  if (quarter > 1e-9) fail(`a quarter of the way through a full promenade, the worst dancer is ${quarter.toFixed(4)} units from a quarter turn counter-clockwise (it must be exact)`);
  else ok('a quarter of the way in, every dancer is exactly a quarter turn counter-clockwise from home');

  const opposite = seq.evaluateSequence(['Promenade'], PROMENADE_BEATS / 2, home).board;
  const half = worstGap(opposite, spin(home, Math.PI));
  if (half > 1e-9) fail(`half way through a full promenade, the worst dancer is ${half.toFixed(4)} units from the opposite side of the set (it must be exact)`);
  else ok('half way in, every dancer is exactly on the opposite side of the set - it is dancing, not standing still');

  // The floor the whole gate is about: a promenade from home MOVES every dancer. The squared set's
  // dancers stand 3 from the centre, so half a circuit is 6 units, and the old derivation moved
  // them 0.000.
  let moved = 0;
  {
    const by = new Map(opposite.dancers.map((d) => [d.id, d]));
    for (const d of home.dancers) {
      const e = by.get(d.id);
      if (e) moved = Math.max(moved, Math.hypot(e.x - d.x, e.y - d.y));
    }
  }
  if (moved < 5.0) fail(`half way through a full promenade from home the worst dancer has moved only ${moved.toFixed(3)} units`);
  else ok(`and each dancer has travelled ${moved.toFixed(2)} units by then`);

  const endDiff = sameBoard(seq.evaluateSequence(['Promenade'], PROMENADE_BEATS, home).board, home);
  if (endDiff) fail(`the last beat of a full promenade is not exactly home: ${endDiff}`);
  else ok('and the last beat is exactly home again, facing restored');

  // A FRACTION CARRIES ITS OWN TRAVEL and takes no lap: its end board is the home ring turned by
  // the fraction, so half way through a half it is a QUARTER turn round - not the three quarters a
  // leaked full lap would make it.
  const halfOfHalf = worstGap(seq.evaluateSequence(['Promenade 1/2'], PROMENADE_BEATS / 4, home).board, spin(home, Math.PI / 2));
  if (halfOfHalf > 1e-9) fail(`half way through a half promenade the worst dancer is ${halfOfHalf.toFixed(4)} units from a quarter turn counter-clockwise (the fraction must not take the full call's lap)`);
  else ok('half way through a "Promenade 1/2" the dancers are a quarter round, so the fraction takes no lap');
}

// ------------------------------------------- 4c. a ring's couples are the FACING pairs
//
// THE REPORT: "they travel in different directions". MEASURED on MS `ceder-7046`'s end ring
// (`tools/ring-facing-probe.mjs`): it is an ALAMO RING - boys outside at radius 3.45, girls inside at
// 2.93, each pair FACING at 2.3 units with a side-offset of 0.01-0.05 - while the board's stored
// `couple` labels pair dancers 180 degrees apart with the SAME heading, the FASR `o` ("opposite")
// reading. `promenadeHome` groups by a pairing read at the point of use, and that read could only
// see partners standing SIDE BY SIDE with the same heading, so it found no mate here, returned null,
// and left the stored labels standing: every "couple centre" it then computed was the MIDDLE OF THE
// SET (radius 1.13, against 3.00 for the real pairs).
//
// The rotation a ring is out by comes from couple 1's anchor, which is a SNAP of that centre to one of
// the four axis points, so a meaningless centre gives a meaningless quarter turn. MEASURED: without
// the facing read, a `Promenade 1/2` from this ring ends a QUARTER TURN SHORT of home (-90 degrees);
// with it, the ring reads as half a turn out and the same call ends EXACTLY HOME. The full promenade
// is legal either way (both readings run 1 -> 2 -> 3 -> 4 counter-clockwise), which is why the figure
// census does not move - figures stay at 116 of 188.
console.log('\n== 4c. a ring reads its couples from the floor, not from the stored labels ==');
{
  const mod = JSON.parse(readFileSync(path.join(root, 'modules/zero_line/static_set/7046.json'), 'utf8'));
  const start = boardForFasrCode('L1o', (l) => templateForLetter(seq, l)).board;
  const flat = seq.flatten(mod.steps);
  const ring = seq.evaluateSequence(flat, seq.sequenceBeats(flat, start), start).board;

  // (a) THE WITNESS IS WHAT IT CLAIMS TO BE, checked before it is used, or the gate goes vacuous: four
  //     FACING pairs at the measured distance, and stored pairs that are genuinely on opposite sides.
  const phys = ring.dancers.filter((d) => !d.isGhost);
  const taken = new Set();
  const facingPairs = [];
  for (const d of phys) {
    if (taken.has(d.id)) continue;
    for (const o of phys) {
      if (o.id === d.id || taken.has(o.id) || o.gender === d.gender) continue;
      const vx = o.x - d.x;
      const vy = o.y - d.y;
      const dist = Math.hypot(vx, vy);
      const along = vx * Math.cos(d.heading) + vy * Math.sin(d.heading);
      const perp = Math.abs(-vx * Math.sin(d.heading) + vy * Math.cos(d.heading));
      if (dist < 1.4 || dist > 3.6 || along < 1.4 || perp > 1.5) continue;
      taken.add(d.id);
      taken.add(o.id);
      facingPairs.push(dist);
      break;
    }
  }
  const byStored = new Map();
  for (const d of phys) byStored.set(d.couple, [...(byStored.get(d.couple) ?? []), d]);
  const storedGaps = [...byStored.values()].filter((p) => p.length === 2).map((p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
  if (facingPairs.length !== 4) fail(`the 7046 witness is not an Alamo ring: ${facingPairs.length} facing pair(s), not 4`);
  else if (Math.max(...facingPairs) > 2.5) fail(`the 7046 witness pairs stand up to ${Math.max(...facingPairs).toFixed(2)} apart, not the measured ~2.3`);
  else if (storedGaps.length !== 4 || Math.min(...storedGaps) <= 3.0) fail(`the 7046 witness's stored labels do NOT pair dancers on opposite sides (min gap ${Math.min(...storedGaps).toFixed(2)}), so it proves nothing about the reading`);
  else ok(`the witness really is an Alamo ring: 4 pairs facing at ${Math.min(...facingPairs).toFixed(2)}-${Math.max(...facingPairs).toFixed(2)} units, stored pairs ${Math.min(...storedGaps).toFixed(1)}-${Math.max(...storedGaps).toFixed(1)} apart`);

  // (b) THE RING IS READ FROM THE FLOOR: a half promenade from a ring that is half a turn out is home.
  const half = seq.evaluateSequence(['Promenade 1/2'], PROMENADE_BEATS / 2, ring).board;
  const diff = sameBoard(half, home);
  if (diff) fail(`a "Promenade 1/2" from 7046's end ring should land exactly home (the ring is read as half a turn out): ${diff}`);
  else ok('a "Promenade 1/2" from the Alamo ring lands exactly home, because the ring is read from its pairs');
}
// A promenade that does not apply must not teleport the board home mid-replay.
{
  const box = startBoardFor(seq, corpus.alignments.find((x) => x.id === 'B2r'));
  const g = seq.applyToBoard(box.board, 'Girls U-Turn Back');
  const ev = seq.evaluateSequence(['Promenade'], PROMENADE_BEATS, g.board);
  const diff = sameBoard(ev.board, g.board);
  if (diff) fail(`a promenade that does not apply teleported the board: ${diff}`);
  else ok('a promenade that does not apply leaves the replay where it was');
  // isZero always replays from the home set, so the false-zero case is checked the
  // other way round: a board the promenade cannot finish from is not home, so a
  // sequence that reaches it must not report a zero.
  if (seq.isZero(['Promenade', 'Girls U-Turn Back'])) fail('"Promenade, Girls U-Turn Back" was reported as a zero');
  else ok('a sequence whose promenade cannot apply is not reported as a zero');
}

// ------------------------------------------------- 5. the published corpus, measured

console.log('\n== 5. every published get-out that ends in Promenade, replayed ==');
// For each published line whose LAST call is the finish, play the body and then ask
// for the finish. Two things must hold whatever the outcome: an applied finish lands
// on the literal home board (never somewhere else), and a refused one says why.
const FINISHES = ['Promenade', 'Promenade Home'];
const outcomes = { resolved: [], refused: [], stoppedBody: [] };
for (const a of corpus.alignments) {
  const start = startBoardFor(seq, a);
  if (!start.board) continue;
  for (const key of ['getoutLines', 'plusLines']) {
    for (const line of a[key] ?? []) {
      const decoded = decodeLine(line);
      if (decoded.undecoded !== undefined || !decoded.calls.length) continue;
      const calls = decoded.calls.map((c) => engineNameFor(c.name));
      if (!FINISHES.includes(calls[calls.length - 1])) continue;
      let board = start.board, bodyRan = true;
      for (const call of calls.slice(0, -1)) {
        const r = seq.applyToBoard(board, call);
        if (!r.legal) { bodyRan = false; break; }
        board = r.board;
      }
      if (!bodyRan) { outcomes.stoppedBody.push({ id: a.id, line }); continue; }
      const r = seq.applyToBoard(board, calls[calls.length - 1]);
      if (!r.legal) { outcomes.refused.push({ id: a.id, line, reason: r.reason }); continue; }
      const diff = sameBoard(r.board, home);
      if (diff) { fail(`${a.id} "${line.trim()}": the finish landed somewhere other than home: ${diff}`); continue; }
      outcomes.resolved.push({ id: a.id, line });
    }
  }
}
const total = outcomes.resolved.length + outcomes.refused.length + outcomes.stoppedBody.length;
console.log(`  ${total} published lines end in a promenade finish`);
console.log(`      ${outcomes.resolved.length} promenade home (the finish applies)`);
console.log(`      ${outcomes.refused.length} body ran but the finish does not apply here`);
console.log(`      ${outcomes.stoppedBody.length} stop earlier in the body (not this workstream)`);
console.log('  the refusals, by reason — these are bodies that reach a state a promenade');
console.log('  cannot finish from, i.e. either our own body bugs or a real open question:');
const byReason = new Map();
for (const r of outcomes.refused) {
  const key = /not standing as a couple/.test(r.reason) ? 'partners not together (broken body)'
    : /out of sequence/.test(r.reason) ? 'couples out of sequence'
      : /not spread one per side/.test(r.reason) ? 'couples not one per side'
        : `other: ${r.reason}`;
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`        ${String(n).padStart(3)}  ${k}`);
for (const r of outcomes.refused) console.log(`        [${r.id}] ${r.line.trim().slice(0, 52)}`);
if (outcomes.refused.some((r) => !r.reason)) fail('a refusal came back with no reason');
// The floor is the measured result of this work: 12 of the 21 lines whose body runs to
// the finish. It may only go up — a fall means the promenade rule or a body call
// regressed, and a rise means a body call was fixed (update this number deliberately).
if (outcomes.resolved.length < 12) {
  fail(`only ${outcomes.resolved.length} published promenade get-outs resolve; 12 did when this gate was written`);
}

// --------------------------------------------------------------------------------------------
// THE DANCER ARRAY ORDER IS THE RENDERER'S BINDING, so a promenade must not re-order the set.
//
// `SequencerUI.renderBoard` builds its pose list in `board.dancers` order and hands pose `i` to
// dancer view `i`, and `applyToBoard` re-bases with `board.dancers.map(...)`, so every other path
// carries the incoming order through. `promenadeHome` returned a fresh `makeSquaredSet()`, whose
// order is 1..8 - so appending a `Promenade` to a module scrambled the whole set on the ONE frame
// drawn from that stored board (the sequence's last frame) while every dancer in it was already
// standing home. Reported: "if I apply a Promenade to the end ... the Dancers switch position in the
// final static square ... they flip to setup arrangement for Static Square on the last frame".
console.log('\n== Promenade keeps the dancers in the order they danced in ==');
const orderOf = (b) => b.dancers.map((d) => d.id).join(',');

// (1) the rule itself: a rotated ARRAY is not a rotated SET.
{
  const home = seq.startBoard();
  const scrambled = { dancers: [...home.dancers.slice(3), ...home.dancers.slice(0, 3)] };
  const r = promenadeHome(scrambled);
  if (!r.legal) fail(`promenadeHome refused a squared set whose dancers are merely LISTED in another order: ${r.reason}`);
  else {
    if (orderOf(r.board) !== orderOf(scrambled)) fail(`promenadeHome re-ordered the dancers: ${orderOf(scrambled)} -> ${orderOf(r.board)}`);
    else ok(`promenadeHome keeps the array order it was given (${orderOf(scrambled)})`);
    const diff = sameBoard(r.board, home);
    if (diff) fail(`and it must still land everyone home: ${diff}`);
    else ok('and it still lands every dancer on its own home spot');
  }
}

// (2) the sequence: appending a promenade to a real module must not re-order on the last frame.
{
  const mod = JSON.parse(readFileSync(path.join(root, 'modules/zero_line/static_set/7046.json'), 'utf8'));
  const start = boardForFasrCode('L1o', (l) => templateForLetter(seq, l)).board;
  const flat = seq.flatten([...mod.steps, 'Promenade']);
  const beats = seq.sequenceBeats(flat, start);
  const pre = seq.evaluateSequence(flat, beats - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, beats, start).board;
  if (!start || beats <= 0) fail('the witness sequence (7046 + Promenade from L1o) plays no beats at all');
  else {
    if (orderOf(pre) !== orderOf(end)) fail(`the LAST frame re-orders the dancers: ${orderOf(pre)} -> ${orderOf(end)}`);
    else ok(`the last frame keeps the order the sequence danced in (${orderOf(end)})`);
    const byId = new Map(end.dancers.map((d) => [d.id, d]));
    let maxMove = 0;
    for (const d of pre.dancers) {
      const e = byId.get(d.id);
      if (e) maxMove = Math.max(maxMove, Math.hypot(e.x - d.x, e.y - d.y));
    }
    if (maxMove > 1e-3) fail(`the last frame also MOVES a dancer by ${maxMove.toFixed(4)} - the promenade is over by then`);
    else ok(`and moves nobody on that frame (worst ${maxMove.toFixed(6)})`);
    seq.setBoard(start);
    for (const h of flat) seq.applyStep(h);
    if (orderOf(seq.board) !== orderOf(end)) fail(`the live replay ends in a different order (${orderOf(seq.board)}) from the walk (${orderOf(end)})`);
    else ok('the live replay and the walk agree on the order');
  }
}

console.log('\n=================');
console.log(failures === 0 ? 'PROMENADE: all gates passed.' : `PROMENADE: ${failures} gate(s) failed.`);
if (failures) process.exitCode = 1;
