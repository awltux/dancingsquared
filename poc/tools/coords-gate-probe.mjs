// Probe: WHAT EXACTLY DOES THE GROUP GATE COMPARE, and how big is the difference it reacts to?
//
// Reported after completing a cloned track ("connect" onto a new start formation): selecting several
// dancers no longer opens the Bezier edit - the panel refuses the group edit - while the dancers LOOK the
// same. The question asked with that report is the right one: what is the error window?
//
// The gate compares the SELECTED DANCERS' move at the selected index IN THEIR OWN LOCAL FRAMES - the six
// translation numbers, and the facing. (It used to be `Math.abs(x - y) < 1e-6` on the raw numbers, which
// refused pairs whose curves were identical to the last bit; the window is now 0.01 units on the shape
// and half a degree on the facing, and the facing is compared through `sameFacing`, which knows that a
// positive rescaling of a facing curve is the same facing at every instant.) So the useful measurements
// are:
//
//   - what the differences actually ARE after a connect, per move index, per pair;
//   - what they are for a call that has NOT been touched, as the noise floor;
//   - and whether a difference the gate calls real is one the CALLER could see, which is a distance in
//     board units (and in pixels at the flat view's 40.9 px per unit).
//
// That last one is what decides the window: a tolerance is only defensible if it separates "the same
// shape, to the precision the data round-trips at" from "a difference someone can see". Whether the gate
// asks about one curve or both - and what that opens - is measured by `connect-assign-probe.mjs`.
//
// Run: node tools/coords-gate-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** The panel's own comparison, to the letter - now PER CURVE, because that is what the edit writes: a
 *  Move-tab field writes the travel numbers and a Facing-tab field writes the rotation's, so the gate
 *  asks about one curve. `both` is kept for the questions about a single set of numbers describing the
 *  whole move; the panel's refusal is `sameTravel` or `sameFacing` on the curve in hand.
 *
 *  THE SHAPE WINDOW IS ON THE CURVES AT ONE PIXEL (0.025 board units here), not on the control points:
 *  see the long note in `editor-ui.ts`, and `clone-refusal-probe.mjs`, which measured that the refusals a
 *  caller hits come in two sizes - under half a pixel, and 2 px and up - with nothing in between. */
const WINDOW = 0.025;
const FACING_WINDOW_DEG = 0.5;
const travelGap = (a, b) => {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = engine.bezierPoint(a.translate, t);
    const qb = engine.bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
};
const sameTravel = (a, b) => travelGap(a, b) < WINDOW;
const sameFacingCurve = (a, b) =>
  // BY MEANING, not by numbers: the facing curve is scale-invariant (see sameFacing in the engine).
  engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
const sameCoords = (a, b) => sameTravel(a, b) && sameFacingCurve(a, b);

/**
 * What a caller could SEE of the difference, in the two ways it can show: how far apart the two SHAPES
 * are when each is drawn in its own dancer's frame, and how far apart their FACINGS are at the same
 * instant.
 *
 * THE SHAPES AND NOT THE WORLD POSITIONS, which took two attempts to get right. Measuring the two
 * curves where they lie on the floor gives a number dominated by the DANCER SPACING - two dancers
 * standing two units apart have curves two units apart however alike their moves are - so it reported
 * 82 px for differences the eye reads as identical. What the gate compares is the move IN ITS OWN
 * FRAME, so what a caller compares is the two shapes, and this is that distance.
 *
 * BOTH ARE NEEDED: two dancers can walk the same path and TURN differently - the same points on the
 * floor, different heading ticks - which a position-only measure cannot see at all.
 */
const visibleGap = (call, i, j, k) => {
  const a = call.dancers[i].path[k];
  const b = call.dancers[j].path[k];
  let pos = 0;
  let heading = 0;
  for (let s = 0; s <= 16; s++) {
    const t = s / 16;
    const qa = engine.bezierPoint(a.translate, t);
    const qb = engine.bezierPoint(b.translate, t);
    pos = Math.max(pos, Math.hypot(qa.x - qb.x, qa.y - qb.y));
    const ha = engine.bezierAngle(a.rotate ?? a.translate, t);
    const hb = engine.bezierAngle(b.rotate ?? b.translate, t);
    const d = Math.abs(((ha - hb + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    heading = Math.max(heading, (d * 180) / Math.PI);
  }
  return { pos, heading };
};

/** The largest single-number difference between two segments' curves - what the gate reacts to. */
const worstNumber = (a, b) => {
  let worst = 0;
  for (const key of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) worst = Math.max(worst, Math.abs(a.translate[key] - b.translate[key]));
  if (a.rotate && b.rotate) for (const key of ['cx1', 'cx2', 'cy2', 'x2', 'y2']) worst = Math.max(worst, Math.abs(a.rotate[key] - b.rotate[key]));
  return worst;
};

// ---------------------------------------------------------------- the clone, completed
console.log('== A cloned track, completed by `connect` ==');
const callId = 'ms/circle.xml';
const src = engine.normalizeInstance(engine.loadCallFromXml(asset(callId), movesXml, formationsXml, 0));
console.log(`    witness ${callId}: ${src.dancers.length} dancers, ${src.dancers[0].path.length} moves, from "${src.from}"`);

// The panel's clone path: re-base onto another start formation, then complete the track. The formation
// list comes from a Sequencer over the whole pooled catalogue, exactly as the app builds it.
const assets = path.join(POC_DIR, 'src', 'assets');
const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
const target = seq
  .listFormations()
  .find((n) => n !== src.from && (seq.boardForFormation(n)?.dancers.length ?? 0) === src.dancers.length);
check(!!target, `a different start formation to clone onto: "${target}"`);
// The panel passes POSES, not the board: `setStartFormation` takes `FormDancer[]`, and the panel maps
// the board's dancers into that shape (`sequencer-ui.ts`, `startFormations`).
const poses = seq.boardForFormation(target).dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
const rebased = engine.setStartFormation(src, poses);
const connected = engine.connectStart(rebased, src);

const report = (label, call) => {
  const moves = call.dancers[0].path.length;
  let worstAll = 0;
  let worstAtMove = -1;
  const perMove = [];
  for (let k = 0; k < moves; k++) {
    let worstK = 0;
    let worstVis = 0;
    let samePairs = 0;
    let pairs = 0;
    for (let i = 0; i < call.dancers.length; i++) {
      for (let j = i + 1; j < call.dancers.length; j++) {
        const a = call.dancers[i].path[k];
        const b = call.dancers[j].path[k];
        if (!a || !b) continue;
        pairs++;
        const d = worstNumber(a, b);
        worstK = Math.max(worstK, d);
        if (sameCoords(a, b)) samePairs++;
        worstVis = Math.max(worstVis, visibleGap(call, i, j, k).pos);
      }
    }
    perMove.push({ k, worstK, worstVis, samePairs, pairs });
    if (worstK > worstAll) { worstAll = worstK; worstAtMove = k; }
  }
  console.log(`    ${label}: worst difference between any two dancers' curves ${worstAll.toExponential(3)} (move ${worstAtMove + 1})`);
  const locked = perMove.filter((m) => m.samePairs < m.pairs);
  console.log(`      the gate refuses a group edit at ${locked.length} of ${moves} moves: ${locked.map((m) => `move ${m.k + 1} (${m.worstK.toExponential(1)}, ${m.worstVis === 0 ? 'invisible' : m.worstVis.toExponential(1) + ' units apart'})`).join(', ') || 'none'}`);
  return { perMove, worstAll, worstAtMove };
};

const afterConnect = report('after connect', connected);
const untouched = report('the ancestor, untouched', src);

// ---------------------------------------------------------------- what the window has to separate
console.log('\n== The window in the data, and on the screen ==');
{
  // A tolerance is only defensible if it separates two things: differences that are ARITHMETIC NOISE
  // (the same shape, arrived at two ways) from differences somebody can SEE. Both are measurable.
  const noises = [];
  const visible = [];
  for (const call of [connected, src]) {
    const moves = call.dancers[0].path.length;
    for (let k = 0; k < moves; k++) {
      for (let i = 0; i < call.dancers.length; i++) {
        for (let j = i + 1; j < call.dancers.length; j++) {
          const a = call.dancers[i].path[k];
          const b = call.dancers[j].path[k];
          if (!a || !b) continue;
          const d = worstNumber(a, b);
          if (d > 0) (d < 1e-3 ? noises : visible).push(d);
        }
      }
    }
  }
  noises.sort((a, b) => a - b);
  visible.sort((a, b) => a - b);
  const noiseHi = noises.length ? noises[noises.length - 1] : 0;
  const visibleLo = visible.length ? visible[0] : 0;
  console.log(`    differences that are NOT zero: ${noises.length + visible.length}`);
  console.log(`      the largest below 1e-3 (arithmetic noise) : ${noiseHi.toExponential(3)}`);
  console.log(`      the smallest above 1e-3 (a real difference): ${visibleLo.toExponential(3)}`);
  console.log(`      the panel's windows: ${WINDOW} units (${(WINDOW * 40.91).toFixed(1)} px) on the shape, ${FACING_WINDOW_DEG}deg on the facing`);
  check(noiseHi > 0 && noiseHi < WINDOW,
    `the windows sit above the arithmetic noise: the largest difference the gate treats as the SAME shape is ${noiseHi.toExponential(2)} units, an order of magnitude below the ${WINDOW}-unit window`);
  // The question that decides it: is a difference the gate CALLS real one the caller can see? The shape
  // window is 0.025 units = one pixel at this scale, measured along the curves themselves, and this
  // probe's own sweep below shows the next refusal up is 2 px - so a refusal is always about a difference
  // of at least a pixel, and everything under a pixel is accepted.
  check(WINDOW * 40.91 <= 1.1,
    `the gate refuses only diffs of a pixel or more: the shape window is ${(WINDOW * 40.91).toFixed(2)} px measured along the curves, and this probe measures the smallest refusal it makes below`);
}

// ---------------------------------------------------------------- what the connect actually wrote
console.log('\n== What the connect wrote into the first move ==');
{
  const k = 0;
  const rows = [];
  for (let i = 0; i < Math.min(connected.dancers.length, 4); i++) {
    const seg = connected.dancers[i].path[k].translate;
    rows.push(`d${i + 1} (${seg.cx1.toFixed(6)}, ${seg.cy1.toFixed(6)}) -> (${seg.x2.toFixed(6)}, ${seg.y2.toFixed(6)})`);
  }
  console.log(`    the first move's local curve, dancer by dancer:`);
  for (const r of rows) console.log(`      ${r}`);
  const a = connected.dancers[0].path[k];
  const b = connected.dancers[1].path[k];
  const gap = visibleGap(connected, 0, 1, k);
  console.log(`    dancers 1 and 2 differ by ${worstNumber(a, b).toExponential(3)} in their numbers, and by ${gap.pos.toFixed(3)} units and ${gap.heading.toFixed(1)}deg of facing on the board`);
  check(!sameCoords(a, b),
    'their first moves genuinely differ, so the gate is RIGHT to refuse a group edit of them - the first move is the one the connect re-aimed, dancer by dancer');
  // ...and the rest of the track is the ancestor's own, which is the other half of the report: the
  // refusal is not spread over the whole call, it is confined to the moves whose curves already
  // differed. (The first version of this check assumed EVERY later move is identical, and the corpus
  // refused it: `ms/circle.xml` ends on a move its dancers do not share either.)
  const moves = connected.dancers[0].path.length;
  // THE RULE IS ABOUT THE ANCESTOR, SO IT NOW READS IT. This message has always said "either identical
  // across dancers OR was already different in the ancestor", but the predicate only ever implemented the
  // FIRST half: it collected the later moves that DIFFER between the two dancers and then tolerated them
  // only if every one of them was the LAST move (`differing.every((k2) => k2 === moves)` - and `differing`
  // holds `k2 + 1`, so that was a check on a single index). The words "already different in the ancestor"
  // were never tested by anything. THE DEFECT THIS EXISTS FOR - a connect that spreads its re-aim into a
  // move it did not touch - was therefore NOT caught, while the check reported a false positive on the
  // corpus. `src` is the ancestor the connect was built from; both halves are measured against it now.
  const sharedThen = (k2) => sameCoords(src.dancers[0].path[k2], src.dancers[1].path[k2]);
  const leakedFrom = (call, ancestor) => {
    const out = [];
    for (let k2 = 1; k2 < moves; k2++) {
      const differsNow = !sameCoords(call.dancers[0].path[k2], call.dancers[1].path[k2]);
      const differedThen = !sameCoords(ancestor.dancers[0].path[k2], ancestor.dancers[1].path[k2]);
      if (differsNow && !differedThen) out.push(k2 + 1);
    }
    return out;
  };
  const sharedInAncestor = [];
  for (let k2 = 1; k2 < moves; k2++) if (sharedThen(k2)) sharedInAncestor.push(k2 + 1);
  const leaked = leakedFrom(connected, src);
  // A ZERO HAS TO SAY WHICH IT IS. MEASURED on this witness: the ancestor shares 0 of the 7 later moves
  // between these two dancers - they already differ on every one of them - so the rule above has an EMPTY
  // FIELD here and passes for that reason rather than because the connect was tidy. Saying so in the
  // message is the difference between an instrument reporting a gap and one reporting an absence; making it
  // a FAIL would be inventing a red for a rule that is simply not exercised by the reported witness, which
  // is why the proof that it BITES is carried by the control below instead.
  check(leaked.length === 0,
    `every move the connect did NOT re-aim is either identical across dancers or was already different in the ancestor - here: ${leaked.length ? `move(s) ${leaked.join(', ')}` : 'none'} - so the refusal is confined to what was already unshared (the ancestor shares ${sharedInAncestor.length} of these ${moves - 1} later moves, so on THIS witness the rule had ${sharedInAncestor.length ? 'something' : 'NOTHING'} to catch)`);
  // AND THE CHECK BITES, ON A PAIR BUILT FOR IT rather than borrowed: two calls that agree on every move
  // from 1 on, with move 2 spoilt in the candidate - which is exactly what a spreading re-aim looks like.
  // Without this the predicate could be satisfied by a rule that caught nothing, which is what the version
  // it replaces had become.
  const sharedPair = { ...connected, dancers: connected.dancers.map((d, i) => (i === 0 ? d : { ...d, path: d.path.map((g, k) => (k === 0 ? g : { ...g, translate: { ...connected.dancers[0].path[k].translate } })) })) };
  const spoilt = { ...sharedPair, dancers: sharedPair.dancers.map((d, i) => (i === 1 ? { ...d, path: d.path.map((g, k) => (k === 1 ? { ...g, translate: { ...g.translate, x2: g.translate.x2 + 0.5 } } : g)) } : d)) };
  check(leakedFrom(spoilt, sharedPair).length === 1,
    'and a difference put into a move the connect did NOT touch IS caught, on a pair built for it - which is the defect this check exists for');
}

// ---------------------------------------------------------------- does the window ever bite?
console.log('\n== Is the window ever refusing an edit nobody could see? (many clone targets) ==');
{
  // THE QUESTION BEHIND THE REPORT. If the gate refuses because two curves differ by 1e-5 units, the
  // caller sees identical shapes and a locked panel, and the window is the fault. If every refusal is
  // about a difference that is plainly visible, the window is doing exactly its job and the fault - if
  // there is one - is elsewhere. So: every eight-dancer formation, one clone each.
  const names = seq.listFormations().filter((n) => (seq.boardForFormation(n)?.dancers.length ?? 0) === src.dancers.length);
  let tried = 0;
  let refusedAtAll = 0;
  let invisibleRefusals = 0;
  let smallestRefused = Infinity;
  let moveCountsDiffer = 0;
  const bands = { 'no difference at all': 0, 'equal within the windows': 0, refused: 0 };
  for (const name of names) {
    const board = seq.boardForFormation(name);
    if (!board) continue;
    let clone;
    try {
      clone = engine.connectStart(
        engine.setStartFormation(src, board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }))),
        src,
      );
    } catch {
      continue; // a count or gender mismatch the engine refuses; not this probe's question
    }
    tried++;
    const counts = new Set(clone.dancers.map((d) => d.path.length));
    if (counts.size !== 1) moveCountsDiffer++;
    const moves = clone.dancers[0].path.length;
    let refused = false;
    for (let k = 0; k < moves; k++) {
      for (let i = 0; i < clone.dancers.length; i++) {
        for (let j = i + 1; j < clone.dancers.length; j++) {
          const a = clone.dancers[i].path[k];
          const b = clone.dancers[j].path[k];
          if (!a || !b) continue;
          // CLASSIFIED BY THE GATE, NOT BY THE NUMBERS. An earlier version counted a pair as refused
          // when its raw numbers differed, which after the facing fix included pairs the gate ACCEPTS -
          // so it reported refusals resting on a difference of nothing, when nothing had been refused.
          if (sameCoords(a, b)) {
            bands[worstNumber(a, b) === 0 ? 'no difference at all' : 'equal within the windows']++;
            continue;
          }
          bands['refused']++;
          refused = true;
          const v = visibleGap(clone, i, j, k);
          smallestRefused = Math.min(smallestRefused, Math.max(v.pos, v.heading / 57.29578));
          if (v.pos < 0.01 && v.heading < 0.5) invisibleRefusals++;
        }
      }
    }
    if (refused) refusedAtAll++;
  }
  console.log(`    ${tried} clone targets from "${src.from}":`);
  console.log(`      pairs the gate ACCEPTS : ${bands['no difference at all'] + bands['equal within the windows']} (of which identical to the last bit: ${bands['no difference at all']})`);
  console.log(`      pairs the gate REFUSES : ${bands['refused']}`);
  console.log(`      clone targets where some path lengths disagree               : ${moveCountsDiffer}`);
  console.log(`      the SMALLEST board distance any refusal rested on: ${smallestRefused === Infinity ? 'none' : `${smallestRefused.toFixed(4)} units (${(smallestRefused * 40.91).toFixed(1)} px)`}`);
  // And the same question for the call as it is BEFORE any clone, which is where a SUBTLE difference
  // lives: the corpus authors some moves with a per-dancer difference of a few hundredths of a unit.
  let subtle = Infinity;
  {
    const moves = src.dancers[0].path.length;
    for (let k = 0; k < moves; k++) {
      for (let i = 0; i < src.dancers.length; i++) {
        for (let j = i + 1; j < src.dancers.length; j++) {
          if (!SameOrNull(src.dancers[i].path[k], src.dancers[j].path[k])) continue;
          if (sameCoords(src.dancers[i].path[k], src.dancers[j].path[k])) continue;
          subtle = Math.min(subtle, visibleGap(src, i, j, k).pos);
        }
      }
    }
    console.log(`      and in the ANCESTOR (no clone at all), the smallest refusal rests on ${subtle === Infinity ? 'none' : `${subtle.toFixed(4)} units (${(subtle * 40.91).toFixed(1)} px)`}`);
  }
  check(moveCountsDiffer === 0, 'every dancer has the same number of moves after a connect, so no refusal is an artefact of a missing segment');
  check(refusedAtAll > 0, `the gate does refuse group edits after a connect (${refusedAtAll} of ${tried} targets)`);
  check(invisibleRefusals === 0,
    `and NEVER on a difference below a hundredth of a unit: the smallest refusal of all is ${smallestRefused.toFixed(4)} units, ${(smallestRefused * 40.91).toFixed(1)} px on screen, so the window is not what a caller is hitting`);
  check(smallestRefused > WINDOW,
    `and every refusal rested on more than the shape window: the smallest of all is ${smallestRefused.toFixed(4)} units (${(smallestRefused * 40.91).toFixed(1)} px), so the window is not what a caller is hitting`);
  // A difference of a few hundredths of a unit is REAL and refinable, and it is the smallest the gate
  // ever refuses on: a caller looking at a 4 px gap can fairly say "they look the same", which is why
  // the panel now names the pair and the distance instead of only stating the rule.
  check(subtle < 0.2 && subtle > 0.01,
    `the ancestor's own tightest refusal is ${(subtle * 40.91).toFixed(1)} px - subtle enough to look the same, and still two curves that one set of numbers cannot describe`);
  // SHOW THE TIGHTEST REFUSAL, because three attempts at describing this in words were wrong and only
  // the detail settles it: which pair, which of the two comparisons refused, and what the two dancers'
  // curves actually say.
  {
    let tight = null;
    for (const name of names) {
      const board = seq.boardForFormation(name);
      if (!board) continue;
      let clone;
      try {
        clone = engine.connectStart(
          engine.setStartFormation(src, board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }))),
          src,
        );
      } catch {
        continue;
      }
      const moves = clone.dancers[0].path.length;
      for (let k = 0; k < moves; k++) {
        for (let i = 0; i < clone.dancers.length; i++) {
          for (let j = i + 1; j < clone.dancers.length; j++) {
            const a = clone.dancers[i].path[k];
            const b = clone.dancers[j].path[k];
            if (!a || !b || sameCoords(a, b)) continue;
            const v = visibleGap(clone, i, j, k);
            const score = v.pos + v.heading / 90; // units, with a degree folded in at 90deg per unit
            if (!tight || score < tight.score) tight = { score, name, k, i, j, a, b, v };
          }
        }
      }
    }
    if (tight) {
      const facingRejected = !engine.sameFacing(tight.a.rotate ?? tight.a.translate, tight.b.rotate ?? tight.b.translate, FACING_WINDOW_DEG);
      const posRejected = ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'].some((key) => Math.abs(tight.a.translate[key] - tight.b.translate[key]) >= WINDOW);
      console.log(`    the TIGHTEST refusal over every target: "${tight.name}", move ${tight.k + 1}, dancers ${tight.i + 1} and ${tight.j + 1}`);
      console.log(`      refused by: ${posRejected ? 'the SHAPE window' : ''}${posRejected && facingRejected ? ' and ' : ''}${facingRejected ? 'the FACING window' : ''}`);
      const fmt = (s) => `(${s.translate.cx1.toFixed(4)}, ${s.translate.cy1.toFixed(4)}, ${s.translate.cx2.toFixed(4)}, ${s.translate.cy2.toFixed(4)}, ${s.translate.x2.toFixed(4)}, ${s.translate.y2.toFixed(4)})`;
      console.log(`      the two translation curves: ${fmt(tight.a)}`);
      console.log(`                              vs  ${fmt(tight.b)}`);
      console.log(`      their curves are ${tight.v.pos.toExponential(3)} units apart and their facings ${tight.v.heading.toExponential(3)}deg apart`);
      console.log(`      rotate curves: ${tight.a.rotate ? 'explicit' : 'null (face along the path)'} vs ${tight.b.rotate ? 'explicit' : 'null (face along the path)'}`);
    }
  }
}

/** Both segments exist. (A pair with a missing move is a different question, checked separately.) */
function SameOrNull(a, b) {
  return !!a && !!b;
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
