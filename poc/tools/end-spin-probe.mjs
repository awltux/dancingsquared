// THE END SETUP CAN BE TURNED IN 45-DEGREE STEPS, so the call finishes in the ORIENTATION the dance wants.
//
// REPORTED: "When I use the new 'Place End' some formations seem rotated compared with where I want the last
// move to terminate. Add a rotation selector before the 'Place End' button that allows the user to select 45
// degree increments and decrements for the target formation to fix this."
//
// WHY IT HAPPENS. The End setup's picker offers the corpus's formations in the orientation `formations.xml`
// writes them, and Place end moves each dancer onto that spot verbatim - so a call that finishes in a wave
// along one axis lands on a named wave along the other. The correspondence is NOT the problem and was never
// the problem: `deriveFormationMapping` already tries all eight 45-degree rotations about the origin to
// decide WHICH spot each dancer gets. What it does not do is turn the spots themselves.
//
// WHAT IS MEASURED HERE, with a negative control for each:
//
//   1. THE RULE, `rotateFormation` - positions AND facings, rigidly about the BOARD CENTRE. The control for
//      "about the board centre" is the same turn taken about the formation's own centroid, which leaves an
//      off-centre formation where it was; the control for "positions and facings" is a facings-only turn.
//   2. THE PANEL APPLIES IT IN ONE PLACE, read from `editor-ui.ts` (TypeScript under a DOM, so it cannot run
//      here). The load-bearing check is a CENSUS: `target.poses` may be read in exactly one line of the
//      file, inside `endTargetPoses`, because five consumers each applying their own turn is five chances
//      for one of them to be missed.
//   3. END TO END: a real corpus call, placed onto a real target through `placeDancerEnd`, lands exactly on
//      the turned spot at every one of the eight steps - and every pairwise distance in the formation is
//      preserved, so the control turns the board without deforming the shape.
//
// Run: node tools/end-spin-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const half = await import(pathToFileURL(path.join(POC, 'src', 'half-set.ts')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const DEG = engine.DEG;
const STEP = 45 * DEG;
const STEPS = 8;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
/** The app's TypeScript is checked in with CRLF; this file is LF, so a multi-line match needs this. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');
const asset = (p) => fs.readFileSync(path.join(POC, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const formations = engine.parseFormations(formationsXml);

/** Worst position and heading gap between two pose lists, index for index. */
function worstGap(a, b) {
  let pos = 0;
  let head = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    pos = Math.max(pos, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
    head = Math.max(head, Math.abs(norm(a[i].heading - b[i].heading)));
  }
  return { pos, head };
}
/** The worst change any pair of spots suffers in a set: 0 means the shape is rigid. */
function worstDistortion(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const was = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
      const now = Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y);
      worst = Math.max(worst, Math.abs(was - now));
    }
  }
  return worst;
}

// ------------------------------------------------------------------ 1. the rule
console.log('== 1. `rotateFormation`: a rigid turn about the BOARD CENTRE ==');
{
  // AN OFF-CENTRE WITNESS, which is what separates the origin from the formation's own centre: these two
  // spots sit at y = -3, so turning about the origin carries them ACROSS the board and turning about their
  // own centre only swaps them where they stand.
  const OFF = [
    { x: -1, y: -3, heading: 0, gender: 'boy' },
    { x: 1, y: -3, heading: 180 * DEG, gender: 'girl' },
  ];
  const turned = engine.rotateFormation(OFF, STEP);
  console.log(`    (-1,-3) at +45 degrees -> (${fmt(turned[0].x)}, ${fmt(turned[0].y)}); a spot at radius 3 moves ${fmt(Math.hypot(turned[0].x + 1, turned[0].y + 3))} units`);
  check(Math.abs(turned[0].x - (-1 * Math.cos(STEP) - -3 * Math.sin(STEP))) < 1e-15 && Math.abs(turned[0].y - (-1 * Math.sin(STEP) + -3 * Math.cos(STEP))) < 1e-15,
    'a step turns the SPOT about the origin by exactly the angle asked for');
  check(Math.abs(norm(turned[0].heading - STEP)) < 1e-15 && Math.abs(norm(turned[1].heading - (Math.PI + STEP))) < 1e-15,
    'and turns the FACING by the same angle, so the two never disagree');
  check(turned[0].gender === 'boy' && turned[1].gender === 'girl' && turned.length === OFF.length,
    'genders and length are carried: a turn is a rigid motion of the arrangement, not a new one');

  // THE NEGATIVE CONTROL FOR THE PIVOT. The centroid of these two is (0,-3); a turn about IT puts the pair
  // back where they started with the two swapped, 6 units from where the origin turn puts them.
  const centroid = { x: (OFF[0].x + OFF[1].x) / 2, y: (OFF[0].y + OFF[1].y) / 2 };
  const aboutCentre = OFF.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    return { x: centroid.x - dx, y: centroid.y - dy, heading: norm(p.heading + Math.PI), gender: p.gender };
  });
  const aboutOrigin = engine.rotateFormation(OFF, 180 * DEG);
  const apart = Math.max(worstGap(aboutOrigin, aboutCentre).pos, 0);
  console.log(`    180 degrees about the origin puts spot 1 at (${fmt(aboutOrigin[0].x)}, ${fmt(aboutOrigin[0].y)}); about the centroid it would be at (${fmt(aboutCentre[0].x)}, ${fmt(aboutCentre[0].y)}) - ${fmt(apart)} units apart`);
  check(apart > 5.9 && Math.abs(aboutOrigin[0].y - 3) < 1e-15,
    'so the pivot is the BOARD CENTRE and not the formation\'s own: the check above fails for a centroid turn');

  // THE NEGATIVE CONTROL FOR "FACINGS ONLY". Turning the headings and leaving the spots gives a different
  // board, and the difference is exactly the spots' displacement.
  const facingsOnly = OFF.map((p) => ({ x: p.x, y: p.y, heading: norm(p.heading + STEP), gender: p.gender }));
  check(worstGap(turned, facingsOnly).pos > 1 && worstGap(turned, facingsOnly).head === 0,
    'and positions are turned as well as facings: a facings-only rule moves nobody and fails the spot check');

  // EXACT WHERE IT CAN BE: the identity step, and eight steps around.
  const identity = engine.rotateFormation(OFF, 0);
  let rotate0 = 0;
  for (let i = 0; i < OFF.length; i++) rotate0 = Math.max(rotate0, Math.abs(identity[i].x - OFF[i].x), Math.abs(identity[i].y - OFF[i].y), Math.abs(identity[i].heading - OFF[i].heading));
  check(rotate0 === 0, 'the identity step is bit-for-bit inert, so a caller who never turns the control gets the engine it had');
  const full = engine.rotateFormation(OFF, STEPS * STEP);
  const around = worstGap(full, OFF);
  console.log(`    eight steps return to the start with worst position ${around.pos.toExponential(1)} and heading ${around.head.toExponential(1)}`);
  check(around.pos < 1e-12 && around.head < 1e-12, 'and eight of them close the circle');
  const two = engine.rotateFormation(engine.rotateFormation(OFF, STEP), STEP);
  check(worstGap(two, engine.rotateFormation(OFF, 2 * STEP)).pos < 1e-12, 'two steps agree with the 90-degree turn');
  check(Math.abs(norm(engine.rotateFormation(OFF, -STEP)[0].heading - (OFF[0].heading - STEP))) < 1e-15,
    'and a NEGATIVE step is the same turn the other way, which is what the two buttons are');

  // OVER THE CORPUS, so the rule is measured on authored numbers and not only on hand-picked ones.
  let corpus = 0;
  let headingsInRange = 0;
  let spots = 0;
  for (const [, ds] of formations) {
    const poses = ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
    for (let k = 0; k < STEPS; k++) {
      const r = engine.rotateFormation(poses, k * STEP);
      spots += r.length;
      if (r.every((p) => p.heading > -Math.PI && p.heading <= Math.PI + 1e-15)) headingsInRange += r.length;
      const back = engine.rotateFormation(r, -k * STEP);
      for (let i = 0; i < poses.length; i++) {
        corpus = Math.max(corpus, Math.abs(back[i].x - poses[i].x), Math.abs(back[i].y - poses[i].y), Math.abs(norm(back[i].heading - poses[i].heading)));
      }
    }
  }
  console.log(`    ${spots} spots over every authored formation turned and turned back: worst residual ${corpus.toExponential(1)}`);
  check(corpus < 1e-12, 'turning and turning back is the identity on every authored spot, so the two buttons cancel');
  check(headingsInRange === spots, `and every heading comes back in the range \`poseFor\` reports, (-pi, pi] (${headingsInRange} of ${spots})`);
}

// ------------------------------------------------------------------ 2. the panel applies it once
console.log('\n== 2. the panel applies the turn in exactly one place, read from source ==');
{
  const ui = readSource('src/editor-ui.ts');
  const html = readSource('index.html');
  const css = readSource('src/style.css');

  check(/import \{[\s\S]{0,4000}?rotateFormation,[\s\S]{0,4000}?\} from 'dancing-squared-engine';/.test(ui),
    '`editor-ui.ts` imports `rotateFormation` from the engine rather than keeping a private copy of the turn');
  check(/import \{[\s\S]{0,4000}?\bDEG,[\s\S]{0,4000}?\} from 'dancing-squared-engine';/.test(ui),
    'and `DEG` with it, which is the engine\'s own degrees-to-radians');
  const accessor = /private endTargetPoses\(\): FormDancer\[\] \| null \{[\s\S]{0,400}?\n  \}/.exec(ui);
  check(!!accessor, 'there is one accessor for the turned target');
  check(!!accessor && /this\.endSpinSteps \* END_SPIN_DEG \* DEG/.test(accessor[0]) && /rotateFormation\(target\.poses, theta\)/.test(accessor[0]),
    'and it is where the step and the engine rule meet');
  check(!!accessor && /this\.endSpinSteps === 0 \? target\.poses :/.test(accessor[0]),
    'and the identity step short-circuits, so an unturned target is the authored array itself rather than a rotated copy');
  // THE CENSUS. `target.poses` is the end target's own, UNTURNED poses. Two places may read it, and the
  // second is the whole point of the fix below: the accessor, which turns it, and `endPairing`, which must
  // NOT - a turn moves the formation's spots without renumbering them. Every other consumer goes through the
  // accessor; one left behind would show the gap readout agreeing with the board while the placement
  // disagreed with both.
  const body = (name) => {
    const m = new RegExp(`private ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n  \\}`).exec(ui);
    return m ? m[0] : null;
  };
  const rawReads = ui.split('\n').filter((l) => /target\.poses/.test(l));
  console.log(`    \`target\.poses\` is read on ${rawReads.length} line(s): ${rawReads.map((l) => l.trim()).join(' | ')}`);
  check(rawReads.length === 3, 'the end target\'s own poses are read in exactly three places: the accessor and the two in `endPairing`');
  const pairingBody = body('endPairing');
  check(!!pairingBody && /deriveFormationMapping\(start, target\.poses, true\)/.test(pairingBody),
    'AND THE PAIRING READS THE FORMATION AS AUTHORED: the correspondence is between the dancers and the formation\'s NUMBERED spots, so the turn moves the spots under it rather than renumbering them');
  const turned = [
    ['the gap readout', 'endTargetGap', /const t = poses\[pairing\[i\]\];/],
    ['Place end', 'doPlaceEnd', /out = placeDancerEnd\(out, i, poses\[pairing\[i\]\]\);/],
    ['Connect end', 'doConnectEnd', /out = setDancerEnd\(out, i, poses\[pairing\[i\]\]\);/],
    ['the pairing pickers', 'renderEndPairing', /poses\.forEach\(\(p, j\) => \{/],
  ];
  const takingTurn = turned.filter(([, name, re]) => { const b = body(name); return !!b && re.test(b) && !/target\.poses/.test(b); });
  check(takingTurn.length === turned.length,
    `and every OTHER consumer takes the turned poses (${takingTurn.map(([n]) => n).join(', ')} of ${turned.length})`);
  // ...and the faults fail the census: one consumer back on the raw poses, or the pairing on the turned ones.
  const placedRaw = ui.replace('out = placeDancerEnd(out, i, poses[pairing[i]]);', 'out = placeDancerEnd(out, i, target.poses[pairing[i]]);');
  check(placedRaw !== ui && !/out = placeDancerEnd\(out, i, poses\[pairing\[i\]\]\);/.test(placedRaw),
    'and putting `Place end` back on the raw poses fails that');
  const pairedTurned = ui.replace('deriveFormationMapping(start, target.poses, true)', 'deriveFormationMapping(start, this.endTargetPoses()!, true)');
  check(pairedTurned !== ui && !/deriveFormationMapping\(start, target\.poses, true\)/.test(pairedTurned),
    'and pairing from the TURNED target fails it too - which is the fault that made the placed headings jump');

  // THE CONTROL ITSELF.
  // The readout is itself a `<span>`, so the group is measured as the markup BETWEEN its opening tag and
  // the Place end button rather than by matching to the first `</span>` - which is the readout's own.
  const groupStart = html.indexOf('<span class="end-spin"');
  const beforePlace = html.indexOf('id="edPlaceEnd"');
  const group = groupStart >= 0 && beforePlace > groupStart ? html.slice(groupStart, beforePlace) : '';
  const inGroup = (id) => group.includes(`id="${id}"`);
  check(inGroup('edEndSpinMinus') && inGroup('edEndSpin') && inGroup('edEndSpinPlus'),
    '`index.html` carries the −/readout/+ group with its three ids');
  check(group.indexOf('id="edEndSpinMinus"') < group.indexOf('id="edEndSpin"')
    && group.indexOf('id="edEndSpin"') < group.indexOf('id="edEndSpinPlus"'),
    'in the order they read: a step down, the readout, a step up');
  check(/class="end-spin"[\s\S]{0,900}?BOARD CENTRE/.test(html),
    'and the group says in its own tooltip that the turn is about the board centre, which is not a detail the caller could guess');
  check(html.indexOf('class="end-spin"') < html.indexOf('id="edPlaceEnd"'),
    'and it sits BEFORE the Place end button, which is where it was asked for');
  check(/private endSpinMinus = el<HTMLButtonElement>\('edEndSpinMinus'\);/.test(ui) && /private endSpinPlus = el<HTMLButtonElement>\('edEndSpinPlus'\);/.test(ui)
    && /private endSpinEl = el<HTMLSpanElement>\('edEndSpin'\);/.test(ui),
    'and every one of them is resolved through `el()`, so a missing id fails at the first property read');
  check(/this\.endSpinMinus\.addEventListener\('click', \(\) => this\.bumpEndSpin\(-1\)\);/.test(ui)
    && /this\.endSpinPlus\.addEventListener\('click', \(\) => this\.bumpEndSpin\(1\)\);/.test(ui),
    'the two buttons step the target the two ways');
  const bump = /private bumpEndSpin\(by: number\) \{[\s\S]{0,800}?\n  \}/.exec(ui);
  check(!!bump && /% END_SPIN_STEPS/.test(bump[0]), 'the step wraps rather than running off the end');
  check(!!bump && !/endOverride/.test(bump[0]),
    'and the turn leaves the caller\'s own spot correspondence ALONE: a turn does not renumber the spots, so clearing it would throw that work away');
  const spin = /private renderEndSpin\(enabled: boolean\) \{[\s\S]{0,1200}?\n  \}/.exec(ui);
  check(!!spin && /this\.endSpinMinus\.disabled = !enabled;/.test(spin[0]) && /this\.endSpinPlus\.disabled = !enabled;/.test(spin[0]),
    'the buttons are disabled with nothing to turn, in the same block that disables `Connect end`');
  check(/private renderEndTarget\(\) \{[\s\S]{0,1600}?this\.renderEndSpin\(false\);[\s\S]{0,1600}?this\.renderEndSpin\(true\);/.test(ui),
    'and the render that owns the end chrome is the one that decides it, so the state cannot be set twice by two different rules');
  const resets = ui.split('\n').filter((l) => /this\.endSpinSteps = 0;/.test(l)).length;
  check(resets === 2, `a new call and a newly chosen end setup both start as authored (${resets} resets)`);
  check(/A NEW TARGET STARTS AS AUTHORED/.test(ui) && /AND UNTURNED/.test(ui),
    'and both say why: a turn belongs to the setup it was found for, so it cannot follow a different one silently');
  check(/#hud \.end-spin \{[\s\S]{0,200}?flex: 0 0 auto;/.test(css) && /\.end-spin > span \{[\s\S]{0,200}?tabular-nums/.test(css) && /min-width/.test(css),
    'the CSS keeps the three parts together and holds the readout\'s width, so the buttons do not shuffle on the step that gains a digit');
}

// ------------------------------------------------------------------ 3. end to end
console.log('\n== 3. a real call placed onto a real target lands on the TURNED spot, undeformed ==');
{
  const src = engine.normalizeInstance(engine.loadCallFromXml(asset('ms/circle.xml'), movesXml, formationsXml, 0));
  // THE TARGET IS THE CALL'S OWN END, deliberately: it is a real eight-spot arrangement, and step 0 is
  // therefore a placement the call already satisfies - so every gap measured below is the control's doing.
  const target = engine.endPoses(src);
  console.log(`    witness: "${src.title}", ${src.dancers.length} dancers, target radius ${fmt(Math.max(...target.map((p) => Math.hypot(p.x, p.y))))} units`);
  const placedAt = (step) => {
    const turned = step === 0 ? target : engine.rotateFormation(target, step * STEP);
    let out = src;
    for (let i = 0; i < src.dancers.length; i++) {
      if (out.dancers[i].path.length === 0) continue;
      out = engine.placeDancerEnd(out, i, turned[i]);
    }
    return out;
  };
  const achieved = (call) => engine.endPoses(call);
  const boards = [];
  let worstLanding = 0;
  let worstTurn = 0;
  let worstShape = 0;
  for (let step = 0; step < STEPS; step++) {
    const turned = step === 0 ? target : engine.rotateFormation(target, step * STEP);
    const got = achieved(placedAt(step));
    boards.push(got);
    worstLanding = Math.max(worstLanding, worstGap(got, turned).pos, worstGap(got, turned).head);
    if (step > 0) {
      // The turn itself, as the achieved board sees it: step 0 turned by the step angle.
      const want = engine.rotateFormation(boards[0], step * STEP);
      worstTurn = Math.max(worstTurn, worstGap(got, want).pos, worstGap(got, want).head);
    }
    worstShape = Math.max(worstShape, worstDistortion(target, got));
  }
  console.log(`    8 steps: worst landing on the turned spot ${worstLanding.toExponential(1)}, worst disagreement with the turn of the step-0 board ${worstTurn.toExponential(1)}, worst distortion of the shape ${worstShape.toExponential(1)}`);
  check(worstLanding < 1e-9, 'every dancer lands exactly on the spot the CONTROL puts it on, position and facing, at all eight steps');
  check(worstTurn < 1e-9, 'and the whole board is the step-0 board turned by the step angle - the control turns what the dancers land on');
  check(worstShape < 1e-12, 'and no pair of dancers changes its distance: the control turns the formation without deforming it');
  const distinct = boards.filter((b, i) => boards.findIndex((c) => worstGap(b, c).pos < 1e-9 && worstGap(b, c).head < 1e-9) === i).length;
  console.log(`    the eight steps give ${distinct} distinct board(s) for this witness`);
  check(distinct >= 2, 'and an instrument that cannot move anything would be silent here: the steps really do offer somewhere else to finish');
  check(worstGap(boards[0], target).pos < 1e-9 && worstGap(boards[0], target).head < 1e-9,
    'step 0 places the call on its own end, which is what "as authored" has to mean for the short-circuit above to be honest');
}

// ------------------------------------------------------------------ 4. the reported fault
console.log('\n== 4. the reported fault: the placed end MARCHES round in 45-degree steps ==');
{
  // REPORTED after the control first landed: "there looks like there is a strange folding going on with the
  // angles, or it's an indexing thing ... 0 deg -> end placed at ~67.5 deg, 45 deg -> ~22.5 deg, 90 deg ->
  // ~67.5 deg ... There seems to be no logic to this." It was an indexing thing: the correspondence was
  // being derived from the TURNED target, and that derivation searches all eight rotations and keeps the
  // first of any tie, so the turn was reshuffling which equally-good correspondence won. The fix is that
  // `endPairing` reads the formation AS AUTHORED, so the turn moves the spots under a held correspondence.
  //
  // THE CALLER'S OWN WITNESS, named the way the corpus names a tam - by title and `from`, never by list
  // position, because a hand-added tam shifts every index.
  const src = engine.normalizeInstance(engine.loadCallFromXml(asset('ms/right_and_left_grand.xml'), movesXml, formationsXml,
    { title: 'Right and Left Grand', from: 'Quarter Tag Facing' }));
  const ds = engine.parseFormations(formationsXml).get('Right and Left Grand Circle');
  const base = ds ? half.completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }))) : null;
  console.log(`    witness: "${src.title}" from "${src.from}" (${src.dancers.length} dancers) onto "Right and Left Grand Circle"`);
  check(!!base && base.length === src.dancers.length, "the corpus still offers the reported end setup at the call's own size");
  if (base) {
    const D = 0; // dancer 1 in the panel's own numbering
    const start = src.dancers.map((d) => { const p = engine.poseFor(d, 0); return { x: p.x, y: p.y, heading: p.heading }; });
    const turnedAt = (k) => (k === 0 ? base : engine.rotateFormation(base, k * STEP));
    let held = null;
    try { held = engine.deriveFormationMapping(start, base, true); } catch { /* a refusal here is another probe's business */ }
    check(!!held, 'and a correspondence between the two is derivable');
    if (held) {
      // THE PANEL'S RULE EXACTLY: the correspondence from the formation AS AUTHORED, the spot from the TURNED
      // formation. What is measured below is the end heading dancer 1 is left with.
      const placed = (pairing, k) => {
        const out = engine.placeDancerEnd(src, D, turnedAt(k)[pairing[D]]);
        return engine.poseFor(out.dancers[D], out.beats).heading;
      };
      const marched = [];
      const rederived = [];
      for (let k = 0; k < STEPS; k++) {
        marched.push([k, placed(held, k)]);
        let p = null;
        try { p = engine.deriveFormationMapping(start, turnedAt(k), true); } catch { /* refused */ }
        if (p) rederived.push([k, placed(p, k)]);
      }
      const deg = (h) => (h / DEG).toFixed(1);
      console.log(`    holding the correspondence (${held.join(',')}): dancer 1 ends at ${marched.map(([, h]) => deg(h)).join(', ')} degrees`);
      console.log(`    re-deriving it per step:                           dancer 1 ends at ${rederived.map(([, h]) => deg(h)).join(', ')} degrees`);
      // THE MARCH ITSELF: from the first step of the series, every step must advance the heading by exactly
      // one 45-degree step. `norm` is what makes 202.5 and -157.5 the same answer.
      const drift = (list) => {
        let worst = 0;
        for (const [k, h] of list) worst = Math.max(worst, Math.abs(norm(h - list[0][1] - k * STEP)));
        return worst;
      };
      const dHeld = drift(marched);
      const dRed = drift(rederived);
      console.log(`    worst departure from 45-degree marching: held ${dHeld.toExponential(1)}, re-derived ${(dRed / DEG).toFixed(1)} degrees`);
      check(dHeld < 1e-9, 'with the correspondence held, dancer 1 marches round in EXACT 45-degree steps - which is what the report expected');
      // THE NEGATIVE CONTROL, and it is the fault itself: more than half a step out, so rounding this
      // sequence to the 45-degree grid would name the wrong orientation for at least one of the eight.
      check(dRed > STEP / 2, 'and re-deriving the correspondence from each turned target does NOT march: the reported jumpiness is reproduced by exactly that fault');
    }
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
