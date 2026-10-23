// THE ARM TURN FAMILY HAS BOTH HANDS, AND THE RIGHT ONE IS THE MIRROR OF THE LEFT.
//
// Asked as: "Is there a 'Right/Left arm turn' in the system, or is it overlooked." It was half overlooked: the
// published index (`assets/src/calls.xml`) has always carried `Arm Turns`, `Left Arm Turn` and
// **`Right Arm Turn`**, and CALLERLAB's Mainstream definitions group them as `Arm Turn Family / a. Right/Left
// Arm Turn` (starting formations Facing Dancers and Mini-Wave, the distance given as a fraction by the caller) -
// but the corpus authored only the LEFT hand plus the partner forms. MEASURED before this probe existed: the
// engine's whole arm-turn vocabulary was `Left Arm Turn 3/4`, `Centers Arm Turn 3/4` and the two
// `Turn Partner by the Right/Left` tams, so a caller asking for a right arm turn from a right-hand wave got
// nothing at all.
//
// THE RULE THIS PINS. A right arm turn is the MIRROR of a left arm turn: the formation mirrored
// (`Ocean Waves RH GBGB` for `Ocean Waves LH BGBG`), the move mirrored (`Cast Right` for `Cast Left`), and the
// turn the same size the other way. So the check is the mirror relation itself, on the completed boards, and it
// is why the pair cannot drift apart: retitle or re-author either side and one of these fails.
//
// AND THE FRACTION IS MEASURED, not read off the title: every dancer's heading changes by 90 degrees for
// `Right Arm Turn 3/4` and by -90 for the left one, which is 270 degrees the other way - so "3/4" is a claim
// this probe checks rather than a name it trusts. The sign is also the effective NEGATIVE CONTROL for the hand:
// a probe that ignored which arm was used would pass both, and this one fails if the two ever agree.
//
// Run: node tools/arm-turn-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const read = (rel) => fs.readFileSync(path.join(corpusRoot(), rel), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');
const armTurnsXml = read('ms/arm_turns.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
};
const DEG = 180 / Math.PI;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
const fmt = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
/** A FACING IS A DIRECTION, SO +180 AND -180 ARE THE SAME ONE: fold the sign before comparing, or a mirror
 *  comparison fails on an angle that landed a float on the other side of pi (the same signed-zero class of
 *  defect as the formation-order digest's `mm()`, `066de4e`). */
const dir = (h) => {
  const d = Math.round(norm(h) * DEG);
  return (d === -180 ? 180 : d);
};

const callOf = (title) => {
  const call = engine.normalizeInstance(engine.loadCallFromXml(armTurnsXml, movesXml, formationsXml, { title }));
  const beats = engine.instanceBeats(call);
  return {
    title,
    formation: call.formation,
    dancers: call.dancers.length,
    start: call.dancers.map((d) => engine.poseFor(d, 0)),
    end: call.dancers.map((d) => engine.poseFor(d, beats)),
  };
};
const setOf = (poses, withGender) => poses
  .map((p) => `${fmt(p.x)},${fmt(p.y)},${dir(p.heading)}${withGender ? ',' + (p.gender ?? '?') : ''}`)
  .sort()
  .join(' | ');
const mirrorOf = (poses) => poses.map((p) => ({ x: -p.x, y: p.y, heading: norm(Math.PI - p.heading), gender: p.gender }));
const headingChanges = (call) => call.start.map((p, i) => dir(norm(call.end[i].heading - p.heading)));

// ---------------------------------------------------------------- 1. the call exists, and both hands do
console.log('== 1. the corpus authors BOTH hands (this is what was missing) ==');
let left = null;
let right = null;
{
  // THE SUBJECT IS PROVED, NOT ASSUMED (AGENTS.md §11.2.2): a missing title is its own failure, not a crash.
  const titles = [...armTurnsXml.matchAll(/<tam\b[^>]*?\btitle="([^"]+)"/g)].map((m) => m[1]);
  check(titles.includes('Right Arm Turn 3/4'), `ms/arm_turns.xml carries "Right Arm Turn 3/4" (it carries ${titles.length} tams)`);
  check(titles.includes('Left Arm Turn 3/4'), 'and still carries "Left Arm Turn 3/4", so the pair is authored together');
  try { left = callOf('Left Arm Turn 3/4'); } catch (e) { check(false, `"Left Arm Turn 3/4" builds: ${e.message}`); }
  try { right = callOf('Right Arm Turn 3/4'); } catch (e) { check(false, `"Right Arm Turn 3/4" builds: ${e.message}`); }
  if (left && right) {
    check(left.dancers === 8 && right.dancers === 8, `both build an eight-dancer board (${left.dancers} and ${right.dancers})`);
    console.log(`    left from ${JSON.stringify(left.formation)}, right from ${JSON.stringify(right.formation)}`);
  }
  // AND THE INDEX NAMES IT, which is the half that was already true and must stay so.
  const index = read('src/calls.xml');
  check(/title="Right Arm Turn"/.test(index) && /title="Left Arm Turn"/.test(index),
    'the published index still names "Right Arm Turn" and "Left Arm Turn" - the gap was the corpus, not the catalogue');
}

// ---------------------------------------------------------------- 2. the right one turns the other way
console.log('\n== 2. the fraction is 3/4, measured per dancer, in the hand the name says ==');
if (left && right) {
  const l = headingChanges(left);
  const r = headingChanges(right);
  check(l.every((d) => d === -90), `every dancer in "Left Arm Turn 3/4" turns 270 degrees one way (heading change ${[...new Set(l)].join(', ')} deg)`);
  check(r.every((d) => d === 90), `and every dancer in "Right Arm Turn 3/4" turns 270 the other way (heading change ${[...new Set(r)].join(', ')} deg)`);
  // THE SIGN IS THE CONTROL FOR THE HAND: if a change ever made both hands turn the same way, section 2 would be
  // green on one check and red on the other, which a hand-blind probe could not manage.
  check(new Set(l).size === 1 && new Set(r).size === 1 && l[0] === -r[0],
    'the two hands turn equal and OPPOSITE, so neither can be the other by accident');
}

// ---------------------------------------------------------------- 3. it is the MIRROR of the left call
console.log('\n== 3. the right call IS the mirror of the left call ==');
if (left && right) {
  check(setOf(right.start, true) === setOf(mirrorOf(left.start), true),
    'their START boards are mirror images, dancer for dancer, genders included');
  check(setOf(right.end, true) === setOf(mirrorOf(left.end), true),
    'and so are their END boards - the pairing is the relation, not a coincidence of two authorings');
  // THE NEGATIVE CONTROL: the same comparison against the UNMIRRORED left board must fail, or the check above
  // would pass for two calls that are merely both waves.
  check(setOf(right.end, true) !== setOf(left.end, true),
    'NEGATIVE CONTROL: the right end board is NOT the left end board, so the check is measuring the mirror and not just "both are waves"');
}

// ---------------------------------------------------------------- 4. the partner forms are still there
console.log('\n== 4. the partner arm turns the callers actually say are untouched ==');
{
  for (const title of ['Turn Partner by the Right', 'Turn Partner by the Left']) {
    let call = null;
    try { call = callOf(title); } catch (e) { /* reported below */ }
    check(!!call && call.dancers === 8, `"${title}" still builds an eight-dancer board`);
    if (call) {
      const changes = new Set(headingChanges(call));
      console.log(`    ${title}: from ${JSON.stringify(call.formation)}, heading change ${[...changes].join(', ')} deg`);
    }
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
