// Call-editor headless test: synthesize a missing setup by padding core moves,
// verify the geometry (positions + headings at pad boundaries), and round-trip
// the exported <tam> XML through buildCall.
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setParser,
  Sequencer,
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  loadCallFromXml,
  poseFor,
  dancerBeats,
  rigidFit,
  alignFormationToCore,
  deriveFormationMapping,
  moveCurveEnd,
  fitCircle,
  swingArcAboutStart,
  rotateCurveAboutStart,
  hasExitDirection,
  padSegment,
  synthesizeSetup,
  synthesizeSetupChain,
  setupToXml,
  callToXml,
  startsFromFormation,
  callToXmlNamed,
  endPoses,
  closureDiscrepancy,
  correctEndTo,
  // The call-INSTANCE editor: read an instance as a table, edit its start formation and
  // arrangement, its end formation and its moves, and round-trip it through `<tam>` XML.
  normalizeInstance,
  instanceTable,
  instanceBeats,
  moveBeatRange,
  setStartFormation,
  connectStart,
  endPoseError,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  setMove,
  addMove,
  removeMove,
  sampleTrail,
  sampleTrailRange,
  DEG,
  // The quarter arc: the one shape the instance editor can lock a curve to.
  bezierAngle,
  bezierPoint,
  callMeta,
  ARC_K,
  ARC_TOL,
  arcBezier,
  arcOf,
  arcIsCircle,
  arcCorner,
  arcBlocker,
  projectToArc,
  setMoveArc,
  facingProfile,
  sameFacing,
  // The RUN-level circle: lay a run of consecutive moves on one arc, keeping both ends.
  RUN_ARC_MAX,
  runCircleMoveCount,
  circleThrough,
  fitCircleRun,
  runTurn,
  setRunCircle,
  RUN_FIT_MAX_DEV,
} from '../dist/index.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;
const nearAng = (a, b, eps = 0.06) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) < eps;
};
// The engine's own angle normalization, mirrored here so an EXACTNESS check (`gap === 0`)
// can compare raw headings without borrowing a tolerance to hide behind.
const normAngleSafe = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

// Pick a full-set mainstream setup (no mirrored half). Circle Left from a
// squared set is authored for all 8 dancers.
const circleXml = read('../../poc/src/assets/ms/circle.xml');
const core = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true);
console.log(`== core: ${core.title} (${core.dancers.length} dancers, beats ${core.beats}) ==`);
check(core.dancers.length === 8, 'core loads to a full 8-dancer set');

const PAD = 2;
const coreStart = core.dancers.map((d) => poseFor(d, 0));
const coreEnd = core.dancers.map((d) => poseFor(d, core.beats));

// New start = core start rigidly shifted +2 in x; new end = core end shifted -1.
const start = coreStart.map((p) => ({ x: p.x + 2, y: p.y, heading: p.heading }));
const end = coreEnd.map((p) => ({ x: p.x - 1, y: p.y, heading: p.heading }));

const syn = synthesizeSetup(core, { name: 'from Shifted Square', start, end, padBeats: PAD });
console.log('== synthesized setup ==');
check(syn.dancers.length === 8, 'has 8 dancers');
check(syn.beats === PAD + core.beats + PAD, `beats = ${syn.beats} (expect ${PAD + core.beats + PAD})`);
check(syn.totalBeats === core.leadin + syn.beats + core.leadout, 'totalBeats = leadin + beats + leadout');
check(syn.dancers.every((d) => dancerBeats(d) === syn.beats), 'every dancer has the full padded path');

// 1. At beat 0 -> newStart.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], 0);
  check(near(p.x, start[i].x) && near(p.y, start[i].y) && nearAng(p.heading, start[i].heading), `dancer ${i + 1} starts at newStart (${p.x.toFixed(2)},${p.y.toFixed(2)} h=${(p.heading * 180 / Math.PI).toFixed(1)})`);
}

// 2. After pad-in -> coreStart.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], PAD);
  check(near(p.x, coreStart[i].x) && near(p.y, coreStart[i].y) && nearAng(p.heading, coreStart[i].heading), `dancer ${i + 1} reaches coreStart after pad-in`);
}

// 3. At end of core -> coreEnd.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], PAD + core.beats);
  check(near(p.x, coreEnd[i].x) && near(p.y, coreEnd[i].y) && nearAng(p.heading, coreEnd[i].heading), `dancer ${i + 1} reaches coreEnd before pad-out`);
}

// 4. At total path end -> newEnd.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], syn.beats);
  check(near(p.x, end[i].x) && near(p.y, end[i].y) && nearAng(p.heading, end[i].heading), `dancer ${i + 1} ends at newEnd (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
}

// 5. Mid-pad motion is a straight-line (rigid) shift for a congruent formation.
{
  const mid = poseFor(syn.dancers[0], PAD / 2);
  const expect = { x: (start[0].x + coreStart[0].x) / 2, y: (start[0].y + coreStart[0].y) / 2 };
  check(near(mid.x, expect.x) && near(mid.y, expect.y), 'mid-pad position is the midpoint (straight-line pad)');
}

// 6. XML round-trip.
console.log('== XML round-trip ==');
const xml = setupToXml(core, { name: 'from Shifted Square', start, end, padBeats: PAD });
const tams = parseCallXml('<calls>' + xml + '</calls>');
check(tams.length === 1, 'setupToXml emits one <tam>');
const rebuilt = buildCall(tams[0], parseFormations(formationsXml), parseMoves(movesXml), false);
check(rebuilt.dancers.length === 8, 'rebuilt tam has 8 dancers');
check(rebuilt.dancers.every((d) => dancerBeats(d) === syn.beats), 'rebuilt dancer beats match synthesis');
check(rebuilt.beats === syn.beats, 'rebuilt call beats match synthesis');
{
  const p = poseFor(rebuilt.dancers[0], rebuilt.beats);
  check(near(p.x, end[0].x, 0.25) && near(p.y, end[0].y, 0.25) && nearAng(p.heading, end[0].heading, 0.25), 'rebuilt call ends at newEnd');
}

// 7. alignment helper.
console.log('== alignFormationToCore ==');
{
  const formation = coreStart.map((p, i) => ({ x: p.x + 5, y: p.y - 3, heading: p.heading }));
  const aligned = alignFormationToCore(coreStart, formation);
  const fit = rigidFit(formation, coreStart);
  check(fit.error < 0.01, `rigid fit error small for congruent formation: ${fit.error.toFixed(3)}`);
  check(aligned.length === 8 && aligned.every((f, i) => near(f.x - coreStart[i].x, 5) && near(f.y - coreStart[i].y, -3)), 'aligned formation keeps identity + original frame');
}

// 7b. Rotation about the ORIGIN: a 90-degree-rotated copy must align to the same
// dancer identities (couple 1 still maps to couple 1).
{
  const cos = Math.cos(Math.PI / 2);
  const sin = Math.sin(Math.PI / 2);
  const rotated = coreStart.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos, heading: p.heading + Math.PI / 2 }));
  const aligned = alignFormationToCore(coreStart, rotated);
  let ok = true;
  for (let i = 0; i < 8; i++) {
    const ex = rotated[i].x;
    const ey = rotated[i].y;
    if (!(near(aligned[i].x, ex) && near(aligned[i].y, ey))) {
      ok = false;
      console.log(`    dancer ${i + 1}: got (${aligned[i].x.toFixed(2)},${aligned[i].y.toFixed(2)}) expect (${ex.toFixed(2)},${ey.toFixed(2)})`);
    }
  }
  check(ok, '90-degree (about-origin) rotated formation maps to matching identities');
}

// 8. Chain: concatenate two setups (use the same call twice) with a connector.
console.log('== synthesizeSetupChain ==');{
  const LEAD = 1;
  const CONN = 2;
  const s = start; // new start (pre-end), aligned
  const e = end; // new end (post-start), aligned
  const chain = synthesizeSetupChain(core, core, { name: 'chained', start: s, end: e, leadBeats: LEAD, connectorBeats: CONN });
  const total = LEAD + core.beats + CONN + core.beats + LEAD;
  check(chain.dancers.length === 8, 'chain has 8 dancers');
  check(chain.beats === total, `chain beats = ${chain.beats} (expect ${total})`);
  const b = LEAD + core.beats + CONN; // boundary into coreB
  for (let i = 0; i < 8; i++) {
    const p0 = poseFor(chain.dancers[i], 0);
    check(near(p0.x, s[i].x) && near(p0.y, s[i].y) && nearAng(p0.heading, s[i].heading), `chain dancer ${i + 1} starts at start`);
    const pA = poseFor(chain.dancers[i], LEAD + core.beats);
    check(near(pA.x, coreEnd[i].x) && near(pA.y, coreEnd[i].y), `chain dancer ${i + 1} at coreA end`);
    const pB = poseFor(chain.dancers[i], b);
    check(near(pB.x, coreStart[i].x) && near(pB.y, coreStart[i].y), `chain dancer ${i + 1} at coreB start (connector)`);
    const pE = poseFor(chain.dancers[i], total);
    check(near(pE.x, e[i].x) && near(pE.y, e[i].y) && nearAng(pE.heading, e[i].heading), `chain dancer ${i + 1} ends at end`);
  }
}

// 9. Closure fix: correct the (deliberately misaligned) Circle Left end back to
// a squared set. Uses the real circle.xml which, with its lead-ins, leaves the
// set rotated ~44deg.
console.log('== closure correction (correctEndTo) ==');
{
  const circleXml = read('../../poc/src/assets/b1/circle.xml');
  const circleLeft = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true); // Circle Left (mirrored)
  // Intended end = each dancer's OWN start pose (a full circle returns home).
  const target = circleLeft.dancers.map((d) => {
    const p = poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  // Before: the call does NOT close (girls' headings off ~44deg).
  const disc = closureDiscrepancy(circleLeft, target);
  check(disc.maxHeadingErr > 0.2, `uncorrected Circle Left has heading discrepancy ${(disc.maxHeadingErr * 180 / Math.PI).toFixed(0)}deg`);
  check(disc.maxPosErr < 1.5, `uncorrected positions near home (max ${disc.maxPosErr.toFixed(2)})`);

  const fixed = correctEndTo(circleLeft, target);
  check(fixed.dancers.length === 8, 'fixed call keeps 8 dancers');
  check(fixed.beats === circleLeft.beats, `fixed call keeps its beat count (${fixed.beats} == ${circleLeft.beats})`);
  const fin = endPoses(fixed);
  let ok = true;
  for (let i = 0; i < 8; i++) {
    if (!(near(fin[i].x, target[i].x, 0.1) && near(fin[i].y, target[i].y, 0.1) && nearAng(fin[i].heading, target[i].heading, 0.1))) ok = false;
  }
  check(ok, 'corrected call ends at each dancer\'s home spot (all 8 dancers, incl. mirrored)');
}

// 10. callToXml round-trips a MIRRORED (half-set) call: the re-parsed start
// formation must match the original (so the sequencer can register it).
console.log('== callToXml mirror round-trip ==');
{
  const circleXml = read('../../poc/src/assets/b1/circle.xml');
  const cl = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true);
  const xml = callToXml(cl, cl.title);
  const rt = buildCall(parseCallXml(xml)[0], parseFormations(formationsXml), parseMoves(movesXml), true);
  let ok = true;
  for (let i = 0; i < rt.dancers.length; i++) {
    const a = poseFor(cl.dancers[i], 0);
    const b = poseFor(rt.dancers[i], 0);
    if (!(near(a.x, b.x, 0.05) && near(a.y, b.y, 0.05))) ok = false;
  }
  check(ok, 'callToXml -> reparse preserves the start formation for a mirrored call');
}

// ---------------------------------------------------------------------------
// 11. THE CALL INSTANCE: read it as a table, in full-set coordinates.
// ---------------------------------------------------------------------------
// A `<tam>` IS an instance: a start formation, a path per dancer, and the beats around
// them. The editor's second job is to edit that instance DIRECTLY. This section pins the
// read; the sections after it pin each edit and the XML round trip.
console.log('\n== call-instance table (11) ==');
const circleMs = read('../../poc/src/assets/ms/circle.xml');
const circleB1 = read('../../poc/src/assets/b1/circle.xml');
const inst = loadCallFromXml(circleMs, movesXml, formationsXml, 0, true);
const instRows = instanceTable(inst);
check(instRows.length === 8, `instance table has one row per dancer (${instRows.length})`);
{
  let ok = true;
  for (const r of instRows) {
    const s = poseFor(inst.dancers[r.index], 0);
    const e = poseFor(inst.dancers[r.index], inst.beats);
    if (!(near(r.start.x, s.x, 1e-12) && near(r.start.y, s.y, 1e-12) && nearAng(r.start.heading, s.heading, 1e-12))) ok = false;
    if (!(near(r.end.x, e.x, 1e-12) && near(r.end.y, e.y, 1e-12) && nearAng(r.end.heading, e.heading, 1e-12))) ok = false;
    if (r.gender !== inst.dancers[r.index].gender) ok = false;
    if (r.beats !== inst.dancers[r.index].path.reduce((n, x) => n + x.beats, 0)) ok = false;
    if (r.moves.length !== inst.dancers[r.index].path.length) ok = false;
  }
  check(ok, 'every row reports its own dancer: start, end, gender, beats, move count');
}
check(instanceBeats(inst) === inst.beats, `instanceBeats == the call's beats (${instanceBeats(inst)} == ${inst.beats})`);
{
  // The derived identity is the SAME read the renderer colours by: four couples, two
  // dancers each, one boy and one girl per couple on a squared set.
  const byCouple = new Map();
  for (const r of instRows) byCouple.set(r.couple, [...(byCouple.get(r.couple) ?? []), r.gender]);
  const couples = [...byCouple.keys()].sort();
  check(
    couples.length === 4 && couples.every((c) => byCouple.get(c).length === 2 && new Set(byCouple.get(c)).size === 2),
    `derived identity is 4 couples of one boy + one girl (${couples.map((c) => `${c}:${byCouple.get(c).join('')}`).join(' ')})`,
  );
}
{
  // A 4-dancer formation that is NOT a home-like set declares no identity, and the table
  // must say null rather than invent one from array position (the §5 identity rule).
  const sashay = loadCallFromXml(read('../../poc/src/assets/ms/sashay.xml'), movesXml, formationsXml, 0, true);
  const rows = instanceTable(sashay);
  check(rows.length === 4 && rows.every((r) => r.couple === null && r.id === null), `Facing Couples declares no home identity (${rows.length} rows, all null)`);
}

// ---------------------------------------------------------------------------
// 12. `normalizeInstance` is exact algebra, and float-exact to one ulp - which is
//     what makes editing half-set tams safe. The bound is MEASURED, not asserted to
//     be zero: `cos(a + pi)` is not bit-identical to `-cos(a)`.
// ---------------------------------------------------------------------------
console.log('\n== normalizeInstance is pose-exact (12) ==');
{
  const worst = (a, b, t) => {
    let m = 0;
    for (let i = 0; i < a.dancers.length; i++) {
      const p = poseFor(a.dancers[i], t);
      const q = poseFor(b.dancers[i], t);
      m = Math.max(m, Math.hypot(p.x - q.x, p.y - q.y), Math.abs(normAngleSafe(p.heading - q.heading)));
    }
    return m;
  };
  for (const [label, xml] of [['ms/circle', circleMs], ['b1/circle', circleB1]]) {
    const call = loadCallFromXml(xml, movesXml, formationsXml, 0, true);
    const norm = normalizeInstance(call);
    const mirrored = call.dancers.filter((d) => d.mirror).length;
    let m = 0;
    for (const t of [0, call.beats / 4, call.beats / 2, (3 * call.beats) / 4, call.beats]) m = Math.max(m, worst(call, norm, t));
    // One ulp on a 3-unit coordinate is ~4.4e-16; the measured worst is a few times that.
    check(m < 1e-14, `${label}: ${mirrored} mirrored dancers -> normalization is float-exact (worst pose gap ${m.toExponential(2)} < 1e-14)`);
    check(norm.dancers.every((d) => d.mirror !== true), `${label}: no dancer is left mirrored`);
    check(worst(norm, normalizeInstance(norm), call.beats / 2) === 0, `${label}: normalization is idempotent (a no-op on its own output)`);
    check(norm.beats === call.beats && norm.dancers.length === call.dancers.length, `${label}: beats and dancer count unchanged`);
  }
}

// ---------------------------------------------------------------------------
// 13. THE EDITS: start pose (which re-frames the path), gender (the arrangement),
//     end pose (which re-aims the last move), and the moves themselves.
// ---------------------------------------------------------------------------
console.log('\n== editing the start formation (13) ==');
const row0 = instRows[0];
{
  const shifted = setDancerStart(inst, 0, { x: row0.start.x + 2, y: row0.start.y - 1, heading: row0.start.heading });
  const after = instanceTable(shifted);
  check(
    near(after[0].start.x, row0.start.x + 2, 1e-12) && near(after[0].start.y, row0.start.y - 1, 1e-12),
    `the edited start is where it was put (${after[0].start.x.toFixed(3)},${after[0].start.y.toFixed(3)})`,
  );
  // A path is authored in dancer-LOCAL coordinates, so a translated start translates the
  // whole movement: the end moves by exactly the same vector.
  check(
    near(after[0].end.x - row0.end.x, 2, 1e-12) && near(after[0].end.y - row0.end.y, -1, 1e-12),
    `the end travelled with it by exactly the start's delta (${(after[0].end.x - row0.end.x).toFixed(6)},${(after[0].end.y - row0.end.y).toFixed(6)})`,
  );
  let others = true;
  for (const r of after) if (r.index !== 0 && (Math.abs(r.end.x - instRows[r.index].end.x) > 1e-12 || Math.abs(r.end.y - instRows[r.index].end.y) > 1e-12)) others = false;
  check(others, 'no other dancer moved');
  check(shifted.beats === inst.beats, `the beat count is untouched by a pose edit (${shifted.beats})`);

  // A start-heading edit rotates the whole path about the start.
  const turned = instanceTable(setDancerStart(inst, 0, { ...row0.start, heading: row0.start.heading + Math.PI / 2 }));
  const dx = row0.end.x - row0.start.x;
  const dy = row0.end.y - row0.start.y;
  const rx = turned[0].end.x - turned[0].start.x;
  const ry = turned[0].end.y - turned[0].start.y;
  check(
    near(rx, -dy, 1e-9) && near(ry, dx, 1e-9),
    `+90° on the start rotates the path about the start: (${dx.toFixed(3)},${dy.toFixed(3)}) -> (${rx.toFixed(3)},${ry.toFixed(3)})`,
  );
}
console.log('\n== editing the ARRANGEMENT (13b) ==');
{
  const swapped = setDancerGender(inst, 0, 'girl');
  const r = instanceTable(swapped)[0];
  check(r.gender === 'girl', 'the edited dancer reads as a girl');
  check(near(r.start.x, row0.start.x, 1e-12) && near(r.end.x, row0.end.x, 1e-12), 'the arrangement edit moved nobody');
  check(nearAng(r.start.heading, row0.start.heading, 1e-12), 'the arrangement edit re-faced nobody');
  // MEASURED, and the reason `couple` is reported as a READ rather than as a field: the
  // home identity is matched on position and heading only, so flipping a dancer's gender
  // changes WHICH SPOTS ARE BOYS AND GIRLS and leaves the couple number where it was.
  check(r.couple === row0.couple, `couple is a positional read and is unchanged by gender (${r.couple})`);
  const pair = instanceTable(swapped).filter((x) => x.couple === row0.couple);
  check(pair.every((x) => x.gender === 'girl'), `couple ${row0.couple} now holds two girls - the arrangement really changed`);
}
console.log('\n== editing the end formation (13c) ==');
{
  const target = { x: 0, y: 0, heading: 0 };
  const reaimed = setDancerEnd(inst, 3, target);
  const rows = instanceTable(reaimed);
  check(
    near(rows[3].end.x, 0, 1e-12) && near(rows[3].end.y, 0, 1e-12) && nearAng(rows[3].end.heading, 0, 1e-12),
    `the dancer now ends exactly on the requested pose (${rows[3].end.x.toFixed(6)},${rows[3].end.y.toFixed(6)} @${((rows[3].end.heading * 180) / Math.PI).toFixed(3)}°)`,
  );
  check(rows[3].moves.length === instRows[3].moves.length, 'only the LAST move was re-aimed (move count unchanged)');
  check(reaimed.beats === inst.beats, `the beat count is held (${reaimed.beats} == ${inst.beats})`);
  let others = true;
  for (const r of rows) {
    if (r.index === 3) continue;
    if (Math.abs(r.end.x - instRows[r.index].end.x) > 1e-12 || Math.abs(r.end.y - instRows[r.index].end.y) > 1e-12) others = false;
  }
  check(others, 'no other dancer moved');
}

console.log('\n== editing the MOVES (13d) ==');
{
  const longest = instRows.reduce((m, r) => (r.beats > instRows[m].beats ? r.index : m), 0);
  const seg0 = instRows[longest].moves[0];
  const slowed = setMove(inst, longest, 0, { ...seg0, beats: seg0.beats + 2 });
  check(slowed.beats === inst.beats + 2, `re-timing the LONGEST dancer re-times the call (${inst.beats} -> ${slowed.beats})`);
  check(instanceBeats(slowed) === slowed.beats, 'and the call beats equal the longest path again');
  // The CONTROL needs a dancer that is not the longest, and every dancer of a real call has
  // the same path length. So build one: give dancer 1 a spare beat, then re-time dancer 2
  // without reaching it. The call must not move.
  const stretched = addMove(inst, 0, { beats: 1, hands: 'none', translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null });
  const ctlSeg = instanceTable(stretched)[1].moves[0];
  const tweak = setMove(stretched, 1, 0, { ...ctlSeg, beats: ctlSeg.beats + 0.5 });
  check(instanceBeats(stretched) === inst.beats + 1, `control setup: dancer 1 is now the longest at ${instanceBeats(stretched)} beats`);
  check(tweak.beats === inst.beats + 1, `re-timing a SHORTER dancer leaves the call beats alone (${inst.beats + 1})`);
  const grown = addMove(inst, 0, { beats: 1, hands: 'none', translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null });
  check(instanceTable(grown)[0].moves.length === instRows[0].moves.length + 1, 'addMove appends a move');
  const shrunk = removeMove(inst, 0, 0);
  check(instanceTable(shrunk)[0].moves.length === instRows[0].moves.length - 1, 'removeMove deletes a move');

  // The PAUSE rule. A real call has no pause, so make one: an authored `beats` 4 longer
  // than its longest path, then edit an unrelated move. Before the rule existed the pause
  // was destroyed (14 -> 10.5); the pause is carried as a DELTA instead.
  const paused = { ...inst, beats: inst.beats + 4, totalBeats: inst.totalBeats + 4 };
  const p0 = instanceTable(paused);
  const pauseBefore = paused.beats - instanceBeats(paused);
  const p = setMove(paused, 0, 0, { ...p0[0].moves[0], beats: p0[0].moves[0].beats + 0.5 });
  check(
    p.beats - instanceBeats(p) === pauseBefore,
    `an authored ${pauseBefore}-beat pause survives an unrelated move edit as the same delta (beats ${paused.beats} -> ${p.beats}, longest path ${instanceBeats(paused)} -> ${instanceBeats(p)})`,
  );
  check(p.beats === paused.beats + 0.5, `and the call re-timed by exactly the edit (+0.5): ${p.beats}`);
}

// ---------------------------------------------------------------------------
// 14. THE ROUND TRIP: edit an instance, export it as `<tam>` XML, re-parse it, and
//     require the same formation, the same arrangement, the same moves and the same
//     declarations back. This is the editor's done-when.
// ---------------------------------------------------------------------------
console.log('\n== instance round trip through <tam> XML (14) ==');
{
  // An edit that touches every dimension the editor can reach.
  let edited = setDancerStart(inst, 0, { x: row0.start.x + 1, y: row0.start.y + 0.5, heading: row0.start.heading + Math.PI / 4 });
  edited = setDancerGender(edited, 1, 'boy');
  edited = setDancerEnd(edited, 2, { x: 2.5, y: -0.5, heading: Math.PI });
  edited = setMove(edited, 3, 0, { ...instanceTable(edited)[3].moves[0], beats: 1.5 });
  edited = addMove(edited, 4, { beats: 0.5, hands: 'right', translate: { cx1: 0.25, cy1: 0, cx2: 0.5, cy2: 0, x2: 0.75, y2: 0 }, rotate: null });

  const xmlEdit = callToXml(edited, edited.from);
  const rt = buildCall(parseCallXml('<calls>\n' + xmlEdit + '\n</calls>')[0], parseFormations(formationsXml), parseMoves(movesXml), false);
  const a = instanceTable(edited);
  const b = instanceTable(rt);
  check(b.length === a.length, `re-parsed instance has the same dancers (${b.length})`);
  check(
    a.every((r, i) => r.gender === b[i].gender),
    `ARRANGEMENT survives: gender per dancer identical (${a.map((r) => r.gender[0]).join('')} -> ${b.map((r) => r.gender[0]).join('')})`,
  );
  let worstStart = 0;
  let worstEnd = 0;
  let worstMove = 0;
  for (let i = 0; i < a.length; i++) {
    worstStart = Math.max(worstStart, Math.hypot(a[i].start.x - b[i].start.x, a[i].start.y - b[i].start.y), Math.abs(normAngleSafe(a[i].start.heading - b[i].start.heading)));
    worstEnd = Math.max(worstEnd, Math.hypot(a[i].end.x - b[i].end.x, a[i].end.y - b[i].end.y), Math.abs(normAngleSafe(a[i].end.heading - b[i].end.heading)));
    check(a[i].moves.length === b[i].moves.length, `dancer ${i + 1}: move count survives (${a[i].moves.length})`);
    for (let k = 0; k < Math.min(a[i].moves.length, b[i].moves.length); k++) {
      worstMove = Math.max(worstMove, Math.abs(a[i].moves[k].beats - b[i].moves[k].beats));
      worstMove = Math.max(worstMove, Math.abs(a[i].moves[k].translate.x2 - b[i].moves[k].translate.x2), Math.abs(a[i].moves[k].translate.cy2 - b[i].moves[k].translate.cy2));
      if (a[i].moves[k].hands !== b[i].moves[k].hands) worstMove = Infinity;
    }
  }
  // "Identical" is bounded by the EXPORT's rounding, and the bound is pinned rather than
  // slack: at the assets' own 2 decimals the end pose came back 0.0672 units out (a path is
  // a chain, so each segment's rounded rotation Bezier accumulates), which this 0.001
  // rejects. At 4 decimals the measured worst is 0.000082 end / 0.000037 move.
  const RT = 0.001;
  check(worstStart < RT, `start formation survives (worst ${worstStart.toFixed(6)} < ${RT})`);
  check(worstEnd < RT, `end formation survives (worst ${worstEnd.toFixed(6)} < ${RT}; 2-decimal export measured 0.0672)`);
  check(worstMove < RT, `every move survives, beats and Bezier (worst ${worstMove.toFixed(6)} < ${RT})`);
  check(rt.beats === edited.beats, `the call's beats survive (${rt.beats} == ${edited.beats})`);
  check(callToXml(rt, rt.from) === xmlEdit, 'exporting the re-parsed instance is BYTE-IDENTICAL - the round trip does not drift');
}

console.log('\n== the XML keeps the declarations that change behaviour (14b) ==');
{
  // A fix or a created position is registered into the sequencer from `callToXml`, so an
  // export that dropped `sequencer` would re-open the demonstration hole the flag exists
  // to close - an edit of the `sequencer="no"` half of a call would come back matchable.
  const endsBend = parseCallXml(read('../../poc/src/assets/a1/ends_bend.xml')).find((t) => t.sequencerMode === 'no');
  check(!!endsBend, 'witness: a tam declaring sequencer="no"');
  if (endsBend) {
    const b = buildCall(endsBend, parseFormations(formationsXml), parseMoves(movesXml), true);
    check(b.forSequencer === false, 'the witness is not for the sequencer');
    const back = buildCall(parseCallXml(callToXml(b))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    check(back.sequencerMode === 'no' && back.forSequencer === false, `sequencer="no" survives the export (${back.sequencerMode}, forSequencer ${back.forSequencer})`);
  }
  const actives = parseCallXml(read('../../poc/src/assets/ms/split_the_outside_couple.xml')).find((t) => t.actives);
  check(!!actives, 'witness: a tam declaring actives');
  if (actives) {
    const b = buildCall(actives, parseFormations(formationsXml), parseMoves(movesXml), true);
    const back = buildCall(parseCallXml(callToXml(b))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    check(back.actives === actives.actives, `actives="${actives.actives}" survives the export (${back.actives})`);
  }
  const tamator = parseCallXml(read('../../poc/src/assets/a1/cast_a_shadow.xml')).find((t) => t.taminator);
  check(!!tamator, 'witness: a tam carrying a <taminator> note');
  if (tamator) {
    const b = buildCall(tamator, parseFormations(formationsXml), parseMoves(movesXml), true);
    const back = buildCall(parseCallXml(callToXml(b))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    check(back.taminator === tamator.taminator, 'the <taminator> note survives the export');
  }
}

// The facing curve's first control point has no y in the format, pinned because the editor now
// leans on it: the moves editor's facing handles put that control point on a RAIL.
console.log('\n== the facing curve cannot express its first control point\'s y (14c) ==');
{
  // PINNED BECAUSE THE EDITOR DEPENDS ON IT. The `<rotate>` element carries cx3/cx4/cy4/x4/y4 -
  // there is no cy3 - so `parsePathChildren` hardcodes `cy1: 0` and `callToXml` emits no cy1.
  // The moves editor's facing handles therefore put the first control point on a RAIL along the
  // dancer's own forward axis and write `cx1` alone. If someone later adds cy3 to the format and
  // the exporter, the rail is no longer the format's constraint but a self-imposed one, and this
  // check is what tells them so.
  //
  // Measured on a real call rather than argued: a cy1 of 0.5 turns the dancer 331deg mid-move and
  // re-parses as the authored curve exactly. The heading change at t=1 is NOT the place to measure
  // it - that is atan2 of the last derivative span, (x2 - cx2, y2 - cy2), which contains no C1.
  const witness = buildCall(parseCallXml(read('../../poc/src/assets/b1/allemande.xml'))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
  let d = -1;
  let k = -1;
  for (let i = 0; i < witness.dancers.length && d < 0; i++) {
    for (let j = 0; j < witness.dancers[i].path.length; j++) {
      if (witness.dancers[i].path[j].rotate && witness.dancers[i].path[j].beats > 0) { d = i; k = j; break; }
    }
  }
  check(d >= 0, `witness: a move with an explicit facing (dancer ${d + 1}, move ${k + 1})`);
  if (d >= 0) {
    const authored = witness.dancers[d].path[k].rotate;
    check(authored.cy1 === 0, `the parsed facing curve carries cy1 = ${authored.cy1} exactly`);
    const bent = setMove(witness, d, k, { ...witness.dancers[d].path[k], rotate: { ...authored, cy1: 0.5 } });
    const moveStart = witness.dancers[d].path.slice(0, k).reduce((s, x) => s + x.beats, 0);
    const headingAt = (c, frac) => poseFor(c.dancers[d], moveStart + frac * c.dancers[d].path[k].beats).heading;
    let worstEdit = 0;
    let worstDiscard = 0;
    const back = buildCall(parseCallXml(callToXml(bent, bent.from))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    const backBase = buildCall(parseCallXml(callToXml(witness, witness.from))[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    for (const frac of [0.25, 0.5, 0.75]) {
      worstEdit = Math.max(worstEdit, Math.abs(headingAt(bent, frac) - headingAt(witness, frac)));
      worstDiscard = Math.max(worstDiscard, Math.abs(headingAt(back, frac) - headingAt(backBase, frac)));
    }
    const deg = (r) => (r * 180) / Math.PI;
    check(deg(worstEdit) > 1, `cy1 = 0.5 really does turn the dancer mid-move (${deg(worstEdit).toFixed(1)}deg)`);
    check(deg(worstDiscard) < 1e-6,
      `and the export DISCARDS it: the re-parsed facing is the authored one (${deg(worstDiscard).toExponential(2)}deg)`);
  }
}

// The one footgun the export carries, pinned rather than discovered later: the ENGINE's
// own mirror rule is geometric ("mirror the half set unless a 180-degree partner already
// exists"), so an 8-dancer instance whose edited formation has no origin-opposite pair is
// DOUBLED when it is read back with mirror=true. The editor's own path is mirror=false,
// which is why the round trip above is exact; anything that writes an edited tam into the
// assets must know which of the two it is asking for.
console.log('\n== the mirror-on-reparse footgun (14d) ==');
{
  // A rigid move (translation, or rotation about the origin) PRESERVES every origin-opposite
  // pair, so it cannot demonstrate anything. Moving one dancer out of each pair can: the
  // engine mirrors a half set only while SOME 180-degree partner exists.
  let lopsided = inst;
  for (let i = 0; i < 4; i++) {
    const r = instanceTable(lopsided)[i];
    lopsided = setDancerStart(lopsided, i, { x: r.start.x + 2.5, y: r.start.y + 2.5, heading: r.start.heading });
  }
  const xml = callToXml(lopsided, lopsided.from);
  const tam = parseCallXml(xml)[0];
  const doubled = buildCall(tam, parseFormations(formationsXml), parseMoves(movesXml), true);
  const plain = buildCall(tam, parseFormations(formationsXml), parseMoves(movesXml), false);
  check(plain.dancers.length === 8, `mirror=false reads the edited instance back as 8 dancers (${plain.dancers.length})`);
  check(doubled.dancers.length === 16, `mirror=true DOUBLES a formation with no origin-opposite pair (${doubled.dancers.length}) - the editor must export/import with mirror=false`);
  const symmetric = buildCall(parseCallXml(callToXml(inst, inst.from))[0], parseFormations(formationsXml), parseMoves(movesXml), true);
  check(symmetric.dancers.length === 8, `a symmetric formation is not doubled (${symmetric.dancers.length})`);
}

// ---------------------------------------------------------------------------
// 15. THE MOVE'S STRETCH OF THE TRACK. The moves row of the editor drives the stage:
//     "Moves of" hides every other dancer's track, and "Move" highlights the part of
//     THIS dancer's track that the selected move is responsible for. That part is a
//     BEAT RANGE, and it is derived here rather than in the UI so it can be measured.
// ---------------------------------------------------------------------------
console.log('\n== the beat range a move owns (15) ==');
{
  // A dancer with several moves, which is every dancer of a real call.
  const d = inst.dancers[0];
  const total = dancerBeats(d);
  check(d.path.length > 2, `witness: dancer 1 has ${d.path.length} moves`);
  let cursor = 0;
  let tiles = true;
  const ranges = [];
  for (let k = 0; k < d.path.length; k++) {
    const r = moveBeatRange(d, k);
    ranges.push(r);
    if (r.from !== cursor || r.to !== r.from + d.path[k].beats) tiles = false;
    cursor = r.to;
  }
  check(tiles, `the ranges TILE the dancer's clock: ${ranges.map((r) => `[${r.from},${r.to})`).join(' ')}`);
  check(cursor === total, `the last move ends at the dancer's own path total (${cursor} == ${total})`);

  // The range brackets the move, checked against a DIFFERENT code path: `poseFor` at the
  // range's start must be the pose the dancer reaches when only the earlier moves are on
  // its path. If the cumulative sum were off by one move, or by one beat, this separates.
  let brackets = true;
  for (let k = 0; k < d.path.length; k++) {
    const r = moveBeatRange(d, k);
    const before = poseFor({ ...d, path: d.path.slice(0, k) }, r.from);
    const atFrom = poseFor(d, r.from);
    const after = poseFor({ ...d, path: d.path.slice(0, k + 1) }, r.to);
    const atTo = poseFor(d, r.to);
    if (Math.hypot(before.x - atFrom.x, before.y - atFrom.y) > 1e-12) brackets = false;
    if (Math.hypot(after.x - atTo.x, after.y - atTo.y) > 1e-12) brackets = false;
  }
  check(brackets, 'the pose at `from` is the pose BEFORE the move and the pose at `to` is the pose AFTER it (checked by truncating the path, not by re-adding beats)');

  // A move that occupies no beats collapses instead of drawing a line along the track.
  const zero = { ...d, path: [{ ...d.path[0], beats: 0 }, ...d.path.slice(1)] };
  check(moveBeatRange(zero, 0).from === moveBeatRange(zero, 0).to, 'a zero-beat move owns an empty range');

  // The distinction the doc comment makes: a PAUSE lives after the last move, so the last
  // move's `to` is the dancer's path total and NOT the call's beat count.
  const paused = { ...inst, beats: inst.beats + 4, totalBeats: inst.totalBeats + 4 };
  const lastMove = moveBeatRange(paused.dancers[0], paused.dancers[0].path.length - 1);
  check(
    lastMove.to === instanceBeats(paused) && lastMove.to !== paused.beats,
    `a pause is NOT inside the last move: it ends at ${lastMove.to} (the longest path) and the call runs to ${paused.beats}`,
  );
  let threw = false;
  try {
    moveBeatRange(d, d.path.length);
  } catch {
    threw = true;
  }
  check(threw, 'an out-of-range move index throws rather than returning a silent empty range');
}

console.log('\n== sampling one stretch of the track (15b) ==');
{
  const d = inst.dancers[0];
  const k = 1;
  const r = moveBeatRange(d, k);
  const STEPS = 48;
  const sub = sampleTrailRange(d, r.from, r.to, STEPS);
  check(sub.length === STEPS + 1, `the sub-trail has steps + 1 points (${sub.length})`);
  const p0 = poseFor(d, r.from);
  const p1 = poseFor(d, r.to);
  check(
    sub[0].x === p0.x && sub[0].y === p0.y && sub[sub.length - 1].x === p1.x && sub[sub.length - 1].y === p1.y,
    'its endpoints are EXACTLY the poses at the range ends, so the highlight sits on the trail it marks',
  );
  // It has to be a stretch OF THE DANCER'S TRACK, not a plausible curve near it: every
  // sample must lie inside the full trail's bounding box, and the stretch cannot be longer
  // than the whole track.
  const full = sampleTrail(d, 80);
  const bb = full.reduce(
    (b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y) }),
    { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity },
  );
  const arc = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  const inside = sub.every((p) => p.x >= bb.x0 - 1e-9 && p.x <= bb.x1 + 1e-9 && p.y >= bb.y0 - 1e-9 && p.y <= bb.y1 + 1e-9);
  check(inside, 'every sample lies inside the full track\'s bounding box');
  check(arc(sub) <= arc(full) + 1e-9, `the stretch is no longer than the whole track (${arc(sub).toFixed(2)} <= ${arc(full).toFixed(2)})`);
  check(arc(sub) > 0, `the selected move actually moves (arc ${arc(sub).toFixed(2)} units)`);
  // Clamping, so a caller that asks beyond the path gets the path's end and not NaN.
  const over = sampleTrailRange(d, r.from, dancerBeats(d) + 100, 8);
  const endPose = poseFor(d, dancerBeats(d));
  check(
    over.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && over[over.length - 1].x === endPose.x && over[over.length - 1].y === endPose.y,
    'a range past the end of the path clamps to the path\'s last pose',
  );
  const zero = sampleTrailRange(d, 2, 2, 8);
  check(zero.length === 9 && zero.every((p) => p.x === zero[0].x && p.y === zero[0].y), 'a zero-length range collapses to a single repeated point (so nothing degenerate is drawn)');
}

// ---------------------------------------------------------------------------
// 16. CLONING A CALL ONTO A DIFFERENT START SETUP. Re-posing the start re-frames the whole
//     local chain, so the track no longer ends where the call ends; `connectStart` re-aims
//     ONE move per dancer (the first) to put the end back exactly.
// ---------------------------------------------------------------------------
console.log('\n== re-basing onto a different START setup (16) ==');
const src = normalizeInstance(inst);
{
  // A real, different, EIGHT-dancer setup out of the assets - the same kind of thing the
  // picker offers, without needing a Sequencer in a `light`-tier harness.
  const dpt = loadCallFromXml(read('../../poc/src/assets/ms/double_pass_thru.xml'), movesXml, formationsXml, 1, true);
  const formation = dpt.dancers.map((d) => {
    const p = poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  check(formation.length === 8, `witness formation: "${dpt.from}" stands up ${formation.length} dancers`);

  const rebased = setStartFormation(src, formation);
  check(rebased.dancers.length === 8 && rebased.beats === src.beats, `the re-base keeps 8 dancers and ${src.beats} beats`);
  // Every dancer stands ON a formation spot, and the spots are used once each.
  const usedSlots = new Set();
  let worstOff = 0;
  for (const r of instanceTable(rebased)) {
    let best = -1;
    let bestD = Infinity;
    formation.forEach((p, k) => {
      const d = Math.hypot(r.start.x - p.x, r.start.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    usedSlots.add(best);
    worstOff = Math.max(worstOff, bestD);
  }
  check(worstOff === 0 && usedSlots.size === 8, `every dancer stands on a formation spot and the spots are used once each (worst offset ${worstOff})`);
  // The MOVES are untouched: the re-base re-poses, it does not re-author.
  check(
    src.dancers.every((d, i) => JSON.stringify(d.path) === JSON.stringify(rebased.dancers[i].path)),
    'every move is byte-identical to the source: the re-base re-poses and does not re-author',
  );
  // THE INVALID TRACK, MEASURED rather than asserted to exist.
  const broken = endPoseError(rebased, src);
  check(
    broken.pos > 2,
    `the track is now invalid: the ends are ${broken.pos.toFixed(2)} units and ${((broken.heading * 180) / Math.PI).toFixed(0)}deg from the call's end`,
  );

  // GENDER IS THE DANCER'S, AND SPOTS ARE PREFERRED BY IT. Give the formation declared
  // genders and require that nobody stands on a spot declared as the other gender.
  const gendered = formation.map((p, k) => ({ ...p, gender: k % 2 === 0 ? 'boy' : 'girl' }));
  const onGendered = setStartFormation(src, gendered);
  let mismatched = 0;
  for (const r of instanceTable(onGendered)) {
    const spot = gendered.find((p) => Math.hypot(p.x - r.start.x, p.y - r.start.y) < 1e-9);
    if (spot && spot.gender !== r.gender) mismatched++;
  }
  check(mismatched === 0, `4 boys + 4 girls land on the 4 boy spots + 4 girl spots (${mismatched} mismatches)`);
  // With the counts deliberately wrong the assignment must still be TOTAL, by geometry.
  const lopsided = formation.map((p, k) => ({ ...p, gender: k < 6 ? 'boy' : 'girl' }));
  const onLopsided = setStartFormation(src, lopsided);
  check(onLopsided.dancers.length === 8, 'a formation whose gender counts do not match still assigns every dancer (by geometry)');
  let threw = false;
  try {
    setStartFormation(src, formation.slice(0, 4));
  } catch {
    threw = true;
  }
  check(threw, 'a formation with the wrong NUMBER of dancers throws rather than re-basing onto gaps');
}

console.log('\n== completing the track: one move per dancer (16b) ==');
{
  const dpt = loadCallFromXml(read('../../poc/src/assets/ms/double_pass_thru.xml'), movesXml, formationsXml, 1, true);
  const formation = dpt.dancers.map((d) => {
    const p = poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  const rebased = setStartFormation(src, formation);
  const connected = connectStart(rebased, src);

  const err = endPoseError(connected, src);
  // Measured: 2.220e-15 - ONE ULP, because the re-aimed first move reaches the anchor through
  // a pad Bezier whose end heading is recovered from a TANGENT, which is not bit-identical to
  // walking the authored chain. The claim is "the end comes back", bounded and pinned.
  check(err.pos < 1e-14 && err.heading < 1e-14, `the END FORMATION comes back exactly (worst ${err.pos.toExponential(2)} units, ${err.heading.toExponential(2)} rad)`);

  // Every pose from the end of move 1 onward is the source's, because the remaining chain is
  // identical and it composes from the same anchor pose.
  let worstAfter = 0;
  for (let i = 0; i < connected.dancers.length; i++) {
    const tb = moveBeatRange(src.dancers[i], 0).to;
    for (const t of [tb, tb + 0.5, src.beats]) {
      const a = poseFor(src.dancers[i], t);
      const b = poseFor(connected.dancers[i], t);
      worstAfter = Math.max(worstAfter, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(normAngleSafe(a.heading - b.heading)));
    }
  }
  check(worstAfter < 1e-12, `every pose from the end of move 1 onward is the source's (worst ${worstAfter.toExponential(2)})`);
  // Only the FIRST move differs, and it keeps the beats and hands it had.
  let laterMovesSame = true;
  let firstKeptMeta = true;
  for (let i = 0; i < src.dancers.length; i++) {
    const a = src.dancers[i].path;
    const b = connected.dancers[i].path;
    if (a.length !== b.length) laterMovesSame = false;
    if (b[0].beats !== a[0].beats || b[0].hands !== a[0].hands) firstKeptMeta = false;
    for (let k = 1; k < Math.min(a.length, b.length); k++) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) laterMovesSame = false;
    }
  }
  check(laterMovesSame, 'EXACTLY ONE move per dancer changed, and it is the first: every later move is byte-identical');
  check(firstKeptMeta, 'the re-aimed first move keeps its own beats and hands: this re-aims a movement, it does not re-time the call');
  // The start is still the NEW formation - connecting must not drag the start back.
  check(
    instanceTable(connected).every((r) => formation.some((p) => Math.hypot(p.x - r.start.x, p.y - r.start.y) < 1e-9)),
    'connecting the track leaves the new start formation exactly where the re-base put it',
  );
  check(connected.beats === src.beats, `the beat count is still ${src.beats}`);

  // IDENTITY: a track that already reaches the anchor is left EXACTLY as authored, which is
  // what keeps this from straightening an authored first curve by accident.
  const identity = connectStart(src, src);
  check(
    src.dancers.every((d, i) => JSON.stringify(d.path) === JSON.stringify(identity.dancers[i].path)),
    'connectStart(ancestor, ancestor) is an EXACT no-op - an already-connected track is not restraightened',
  );

  // A dancer that cannot walk in is left alone and STAYS wrong - a limitation, pinned.
  {
    const noTime = { ...rebased, dancers: rebased.dancers.map((d, i) => (i === 0 ? { ...d, path: [{ ...d.path[0], beats: 0 }, ...d.path.slice(1)] } : d)) };
    const after = connectStart(noTime, src);
    const before = endPoseError(noTime, src);
    const post = endPoseError(after, src);
    check(
      post.pos === before.pos && post.pos > 3,
      `a dancer whose first move has ZERO beats cannot be connected and stays wrong (${post.pos.toFixed(2)} units, unchanged) - reported by endPoseError rather than hidden`,
    );
  }
}

console.log('\n== endPoseError is index-for-index, on purpose (16c) ==');
{
  check(endPoseError(src, src).pos === 0, 'a call against itself reports zero');
  // Swapping two dancers' ends must READ as an error. This is the whole reason this comparison
  // does not re-derive a correspondence the way `closureDiscrepancy` does: a clone and its
  // ancestor share dancer identity, so pairing dancer i with its counterpart is the question.
  const permuted = { ...src, dancers: [src.dancers[1], src.dancers[0], ...src.dancers.slice(2)] };
  check(endPoseError(permuted, src).pos > 1, `a permutation of the SAME ends reads as an error (${endPoseError(permuted, src).pos.toFixed(2)} units), not as zero`);
}

console.log('\n== the quarter arc (17) ==');
{
  // A quarter arc is the ONLY shape the panel can lock a curve to, so the family is pinned here
  // rather than in the UI: the engine owns the geometry, and this is the harness that runs in the
  // `light` tier.
  const K = ARC_K;
  const circle = (r) => arcBezier({ x: K * r, y: K * r, angle: 0 });

  // 17a. The claim that makes it an arc at all: the tangents are exactly on the axes. This is what
  // "quadrant" means, and for a FACING curve it is also what the format can express - the start
  // tangent is horizontal because cy1 IS 0, which is the attribute the XML does not have.
  let worstTangent = 0;
  for (const r of [0.25, 1, 4]) {
    const c = circle(r);
    worstTangent = Math.max(worstTangent, Math.abs(bezierAngle(c, 0)), Math.abs(bezierAngle(c, 1) - Math.PI / 2));
  }
  check(worstTangent < 1e-9, `the start tangent is EXACTLY +x and the finish tangent EXACTLY +y (worst error ${worstTangent.toExponential(2)} rad)`);
  check(circle(1).cy1 === 0, 'and the start tangent is horizontal because cy1 is 0 - the one coordinate the format has no attribute for');
  // The corner of the conic is where the two lengths put it: a quarter turn from the start point.
  check(Math.abs(bezierAngle(arcBezier({ x: 1, y: 1, angle: 0.7 }), 0) - 0.7) < 1e-12,
    'and a ROTATED arc starts along the direction it was given, so a travel curve keeps the way it sets off');

  // 17b. It is a real conic, to the accuracy a cubic can manage: the classic 2.7e-4 of the radius.
  const radialError = (r) => {
    const c = circle(r);
    let worst = 0;
    for (let i = 0; i <= 200; i++) {
      const p = bezierPoint(c, i / 200);
      const d = Math.hypot(p.x, p.y - r); // the circle is centred at (0, r)
      worst = Math.max(worst, Math.abs(d - r));
    }
    return worst / r;
  };
  const unitErr = radialError(1);
  console.log(`    worst radial error: ${unitErr.toExponential(4)} of the radius at r=1, ${radialError(4).toExponential(4)} absolute at r=4`);
  check(unitErr < 3e-4, `the cubic is the circle to ${unitErr.toExponential(2)} of the radius - the best a cubic does, and thousands of times finer than this board`);
  check(Math.abs(radialError(4) - unitErr) < 1e-12, 'and the error is exactly PROPORTIONAL to the radius, so the shape does not change with size');

  // 17c. A circle IF AND ONLY IF the two handle lengths are equal - the panel's own rule, measured.
  {
    const offCircle = arcBezier({ x: K, y: K * 0.5, angle: 0 });
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const p = bezierPoint(offCircle, i / 100);
      worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y - 1) - 1));
    }
    check(worst > 0.1, `equal handle lengths are what make it a circle: halving the finish handle pushes the curve ${worst.toFixed(3)} units off the same circle`);
    // And an ellipse is still an exact conic in its own right: (x/a)^2 + ((y-b)/b)^2 = 1.
    const a = 1.5;
    const b = 0.6;
    const e = arcBezier({ x: K * a, y: K * b, angle: 0 });
    let worstEllipse = 0;
    for (let i = 0; i <= 200; i++) {
      const p = bezierPoint(e, i / 200);
      worstEllipse = Math.max(worstEllipse, Math.abs((p.x / a) ** 2 + ((p.y - b) / b) ** 2 - 1));
    }
    check(worstEllipse < 1e-3, `and an unequal pair is the ellipse with those semi-axes, to ${worstEllipse.toExponential(2)} (a=${a}, b=${b})`);
    // A ROTATED ellipse is the same conic turned: the radial distance from its own centre is the
    // same as the unrotated one's, so the shape travels with the angle.
    const rot = arcBezier({ x: K * a, y: K * b, angle: 0.9 });
    const unrot = arcBezier({ x: K * a, y: K * b, angle: 0 });
    let worstRot = 0;
    for (let i = 0; i <= 100; i++) {
      const pr = bezierPoint(rot, i / 100);
      const pu = bezierPoint(unrot, i / 100);
      const c = Math.cos(0.9);
      const s = Math.sin(0.9);
      worstRot = Math.max(worstRot, Math.hypot(pr.x - (pu.x * c - pu.y * s), pr.y - (pu.x * s + pu.y * c)));
    }
    check(worstRot < 1e-12, `a rotated arc is the unrotated one turned by the angle (worst gap ${worstRot.toExponential(2)})`);
  }

  // 17d. Reading the family back, and the tolerance's reason.
  {
    let worst = 0;
    for (const p of [{ x: K, y: K, angle: 0 }, { x: 2, y: -1.5, angle: 0.3 }, { x: 0.25, y: 0.25, angle: -2 }, { x: 1, y: 1, angle: Math.PI / 2 }, { x: 0, y: 2, angle: 0 }]) {
      const back = arcOf(arcBezier(p));
      worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y), Math.abs(normAngleSafe(back.angle - p.angle)));
    }
    check(worst < 1e-15, `arcOf(arcBezier(p)) returns p exactly for five shapes including a degenerate one (worst ${worst.toExponential(2)})`);
    // A curve that is nearly-but-not an arc is NOT reported as one: the panel's lock must not
    // quietly round a curve into the family.
    const nearly = { ...arcBezier({ x: K, y: K, angle: 0 }), cx2: 1.5 };
    check(arcOf(nearly) === null, 'a curve that is not an arc is not read as one');
    // But the EXPORT rounds to four decimals, so an arc that has been saved and reloaded must still
    // read as an arc - which is the entire reason ARC_TOL is not zero.
    const rounded = Object.fromEntries(Object.entries(arcBezier({ x: K * 3, y: K * -2, angle: 0 })).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
    check(arcOf(rounded) !== null, 'and an arc that went through the four-decimal export still reads as an arc after it');
  }

  // 17e. THE DISABLE RULE. A quarter arc's two end tangents are perpendicular, so a curve whose
  // handles are not at a right angle CANNOT be locked into the family without turning the dancer -
  // and the panel refuses rather than doing that. This is the check the checkbox hangs on.
  {
    const perp = { cx1: 1, cy1: 0, cx2: 1, cy2: 0.4, x2: 1, y2: 1 }; // finish handle straight up
    const skew = { cx1: 1, cy1: 0, cx2: 1, cy2: 0.4, x2: 1.4, y2: 1 }; // ...and now off at an angle
    const walk = { cx1: 0.333, cy1: 0, cx2: 0.667, cy2: 0, x2: 1, y2: 0 }; // handles PARALLEL
    const uturn = { cx1: 1.333, cy1: 0, cx2: 1.333, cy2: 2, x2: 0, y2: 2 }; // handles ANTI-parallel
    check(Math.abs(Math.abs(arcCorner(perp)) - Math.PI / 2) < 1e-12, `a perpendicular pair measures a right angle (${((Math.abs(arcCorner(perp)) * 180) / Math.PI).toFixed(2)}deg)`);
    check(arcBlocker(perp, true) === null, 'so the box is ENABLED for it');
    check(arcBlocker(skew, true) === 'handles-not-perpendicular', 'a skewed pair is refused with the reason the panel shows');
    check(arcBlocker(walk, true) === 'handles-not-perpendicular', 'a straight walk has PARALLEL handles, and a straight line is not a quadrant of anything');
    check(arcBlocker(uturn, true) === 'handles-not-perpendicular', 'and a U-turn has ANTI-parallel handles: 180deg is two quadrants, not one');
    const zero = { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 };
    check(arcBlocker(zero, true) === 'no-handle-length', 'a Stand has no handle length to size an arc from, and says THAT rather than blaming the angle');
    const backwards = { cx1: -2, cy1: 0, cx2: -1, cy2: 1, x2: -1, y2: 1 };
    check(arcBlocker(backwards, false) === 'starts-backwards',
      'a facing curve whose start handle points backwards is refused rather than flipped: that would be a 180deg snap at t=0');
    check(arcBlocker(backwards, true) === null, 'while a TRAVEL curve going backwards is fine - that is what a Back move does');
    // The panel's enabled state and the projection are the same question, asked once.
    for (const b of [perp, skew, walk, uturn, zero, backwards]) {
      check((arcBlocker(b, true) === null) === (projectToArc(b, true) !== null),
        `the disable reason and the projection agree about ${arcBlocker(b, true) ?? 'this one'}`);
    }
  }

  // 17f. The projection, and how much of the corpus could take the lock at all.
  {
    const perp = { cx1: 1, cy1: 0, cx2: 1, cy2: 0.4, x2: 1, y2: 1 };
    const p = projectToArc(perp, true);
    check(Math.abs(p.x - 1) < 1e-15 && Math.abs(p.y - 0.6) < 1e-15 && p.angle === 0,
      `the projection keeps BOTH handle lengths (${p.x.toFixed(4)}, ${p.y.toFixed(4)}) and the direction, and imposes only the conic relation`);
    const asArc = arcBezier(p);
    check(Math.abs(bezierAngle(asArc, 0) - bezierAngle(perp, 0)) < 1e-12 && Math.abs(bezierAngle(asArc, 1) - bezierAngle(perp, 1)) < 1e-12,
      'so the dancer sets off and finishes facing exactly as the curve said - only the corner moved');

    // One handle of zero length borrows the other's, which is the only size the remaining hint can
    // justify; both zero is no hint at all.
    const oneZero = projectToArc({ cx1: 0.8, cy1: 0, cx2: 0.8, cy2: 0.3, x2: 0.8, y2: 0.3 }, true);
    check(oneZero !== null && arcIsCircle(oneZero), `a zero FINISH handle borrows the start handle's length and gives a circle (${oneZero && oneZero.x.toFixed(4)})`);
    check(projectToArc({ cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, true) === null, 'a Stand gives NO hint, and the projection says so rather than inventing a size');
    // Already an arc: the projection is the identity, so ticking the box twice cannot change a curve.
    const arc = arcBezier({ x: 1.2, y: -0.4, angle: 0.2 });
    const again = projectToArc(arc, true);
    check(again.x === 1.2 && again.y === -0.4 && again.angle === 0.2, 'projecting a curve that is ALREADY an arc is the identity');
  }

  // 17g. Through a real call, a real export and a real re-parse.
  {
    const seg0 = src.dancers[1].path[0];
    const asArc = setMoveArc(src, 1, 0, 'travel', { x: K, y: K, angle: 0 }); // a unit quarter circle
    const back = asArc.dancers[1].path[0].translate;
    check(arcOf(back) !== null, 'setMoveArc writes a curve the reader recognises as an arc');
    check(asArc.dancers[1].path[0].beats === seg0.beats && asArc.dancers[1].path[0].hands === seg0.hands,
      'and it does not touch the beats or the hands, which are not coordinates');
    check(asArc.dancers[0].path[0].translate.x2 === src.dancers[0].path[0].translate.x2,
      'and it changes ONE dancer: the ones not named are byte-identical');

    // The heading a facing arc delivers is a quarter turn, by construction.
    const facing = setMoveArc(src, 1, 0, 'facing', { x: 1, y: 1, angle: 0 });
    const h0 = poseFor(facing.dancers[1], moveBeatRange(facing.dancers[1], 0).from).heading;
    const h1 = poseFor(facing.dancers[1], moveBeatRange(facing.dancers[1], 0).to).heading;
    check(Math.abs(Math.abs(normAngleSafe(h1 - h0)) - Math.PI / 2) < 1e-9,
      `a facing arc turns the dancer EXACTLY a quarter turn (${((Math.abs(normAngleSafe(h1 - h0)) * 180) / Math.PI).toFixed(4)}deg)`);

    const xml = callToXml(asArc, asArc.from);
    const rt = buildCall(parseCallXml(xml)[0], parseFormations(formationsXml), parseMoves(movesXml), false);
    const rtArc = arcOf(rt.dancers[1].path[0].translate);
    check(rtArc !== null && Math.abs(rtArc.x - K) < ARC_TOL && Math.abs(rtArc.y - K) < ARC_TOL,
      `the arc survives export and re-parse (${rtArc && rtArc.x.toFixed(4)}, ${rtArc && rtArc.y.toFixed(4)} against ${K.toFixed(4)})`);
    check(callToXml(rt, rt.from) === xml, 'and exporting the re-parsed call is byte-identical, so an arc does not drift');
  }

  // 17h. How much of the corpus could take the lock, and how much of it is already an arc?
  {
    const levels = ['b1', 'ms', 'a1'];
    let curves = 0;
    let arcs = 0;
    let lockable = 0;
    const blocked = { 'no-handle-length': 0, 'handles-not-perpendicular': 0, 'starts-backwards': 0 };
    for (const lv of levels) {
      const dir = path.join(__dirname, '../../poc/src/assets', lv);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.xml')) continue;
        const x = fs.readFileSync(path.join(dir, f), 'utf8');
        if (callMeta(x).setups.length === 0) continue;
        let c;
        try {
          c = loadCallFromXml(x, movesXml, formationsXml, 0);
        } catch {
          continue;
        }
        for (const d of c.dancers) {
          for (const s of d.path) {
            for (const [kind, b] of [['travel', s.translate], ['facing', s.rotate]]) {
              if (!b) continue;
              curves++;
              if (arcOf(b)) arcs++;
              const why = arcBlocker(b, kind === 'travel');
              if (why) blocked[why]++;
              else lockable++;
            }
          }
        }
      }
    }
    console.log(`    of ${curves} authored curves in ${levels.join('/')}:`);
    console.log(`      already exact quarter arcs: ${arcs}`);
    console.log(`      could be locked to one    : ${lockable} (${((lockable / curves) * 100).toFixed(1)}%)`);
    console.log(`      blocked: ${Object.entries(blocked).map(([k, v]) => `${k} ${v} (${((v / curves) * 100).toFixed(1)}%)`).join(', ')}`);
    check(blocked['handles-not-perpendicular'] / curves > 0.2,
      `the disable rule is doing real work rather than guarding a corner case: ${((blocked['handles-not-perpendicular'] / curves) * 100).toFixed(1)}% of curves have handles that are not at a right angle`);
    check(lockable > 0, `and the lock is available for ${lockable} of them`);
    // ZERO, AND THAT TOOK A DEFINITION TO GET RIGHT: the first version of `arcOf` called the
    // degenerate all-zero member of the family an arc, and reported 138 of these curves as already
    // arcs - every one of them a `Stand`, with no shape to lock and no handle length to size
    // anything from. Pinned at zero because it is the measurement that says the checkbox is a NEW
    // shape rather than a description of the corpus; if a future corpus does carry arcs, that is a
    // fact worth looking at rather than a number to compare against a threshold.
    check(arcs === 0,
      `no authored curve in ${levels.join('/')} is a quarter arc (${arcs}), so the checkbox adds a shape rather than naming one the assets already use`);
  }
}

console.log('\n== what a facing curve MEANS, and the gate that compares it (18) ==');
{
  // The editor's group gate asks whether several dancers share a move. For the PATH that is a question
  // about the numbers, because a Bezier is a convex combination of its control points. For the FACING it
  // is not: `poseFor` reads the curve with `bezierAngle`, which is `atan2` of the derivative, so the
  // curve's meaning is SCALE-INVARIANT - and comparing the numbers refused group edits of dancers who
  // were in the same places facing the same ways. A caller reported exactly that ("they look the same").
  const base = { cx1: 0.55, cy1: 0, cx2: 1, cy2: 0.45, x2: 1, y2: 1 };
  const scaled = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * 2.5]));
  const flipped = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, -v]));
  const nudged = { ...base, cy2: 0.45 + 0.001 };

  check(sameFacing(base, scaled), 'a facing curve and a multiple of it are the SAME facing - every heading at every instant is identical');
  check(!sameFacing(base, flipped), 'but a NEGATIVE multiple is not: that turns every heading 180deg the other way');
  check(sameFacing(base, base), 'and a curve is itself');
  {
    let worst = 0;
    for (let i = 0; i <= 20; i++) worst = Math.max(worst, Math.abs(bezierAngle(base, i / 20) - bezierAngle(scaled, i / 20)));
    check(worst < 1e-12, `the two really do face identically: worst heading gap ${worst.toExponential(2)} rad over 21 instants`);
    check(Math.abs(base.cx1 - scaled.cx1) > 0.5, `while their NUMBERS differ by ${Math.abs(base.cx1 - scaled.cx1).toFixed(3)} - which is what the old comparison was reading`);
  }
  // The tolerance form, which is what the panel calls: it also samples, for curves that differ without
  // being multiples of one another.
  check(sameFacing(base, nudged, 0.5) && !sameFacing(base, nudged, 0), 'the tolerance form accepts a small difference at half a degree and rejects it at zero');
  check(sameFacing(null, null) && !sameFacing(null, base) && !sameFacing(base, null), 'two absent facings are the same; one absent and one present are not');
  check(facingProfile({ cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }) === null, 'a hold has no direction at all, and the profile says so rather than returning zeros');
  {
    // The population the defect had: facing curves that MEAN the same thing while their numbers differ.
    let pairs = 0;
    let sameByMeaning = 0;
    let sameByNumbers = 0;
    for (const d of src.dancers) {
      for (let k = 0; k < d.path.length; k++) {
        for (const e of src.dancers) {
          const a = d.path[k];
          const b = e.path[k];
          if (!a || !b || !a.rotate || !b.rotate) continue;
          pairs++;
          if (sameFacing(a.rotate, b.rotate, 0.5)) sameByMeaning++;
          if (Object.keys(a.rotate).every((key) => Math.abs(a.rotate[key] - b.rotate[key]) < 1e-6)) sameByNumbers++;
        }
      }
    }
    console.log(`    over ${pairs} ordered pairs of explicit facing curves in the witness: ${sameByMeaning} mean the same facing, ${sameByNumbers} have the same numbers`);
    check(sameByMeaning >= sameByNumbers, 'comparing by meaning accepts at least everything comparing by numbers did - it can only ever be more permissive, which is the direction of the fix');
  }
}

// ---------------------------------------------------------------------------
// 19. a move's end facing IS the frame the next move is played in
// ---------------------------------------------------------------------------
//
// Reported as a bug - "adjusting the end of the facing curve alters the direction of the rest of the
// trace" - and it is the format: a trajectory is authored in the dancer's own frame, and taminations
// composes a dancer's moves as `tx = tx * it.translate(); tx = tx * it.rotate();` per move
// (`taminations-flutter/lib/math/path.dart`, `Path.recalculate`), carrying the frame forward. Measured here
// on a real witness, so the size of the effect is PINNED rather than described: the rest of the call is
// rigidly rotated about the pose the move ends on by exactly the change in its end heading. Anyone tempted
// to "fix" the swing has to come here and delete a measurement first.
console.log('\n== a move\'s end facing is the frame the next move is played in (19) ==');
{
  const src = normalizeInstance(loadCallFromXml(circleXml, movesXml, formationsXml, 0));
  const d = 0;
  const k = src.dancers[d].path.findIndex((s, i) => s.rotate && i < src.dancers[d].path.length - 1);
  check(k >= 0, `the witness has a move with a facing curve and something after it (move ${k + 1})`);
  const path0 = src.dancers[d].path;
  const r0 = path0[k].rotate;
  const DELTA = 10 * DEG; // `DEG` here is radians per degree, the engine's own constant
  const spin = (x, y) => ({ x: x * Math.cos(DELTA) - y * Math.sin(DELTA), y: x * Math.sin(DELTA) + y * Math.cos(DELTA) });
  const c2 = spin(r0.cx2, r0.cy2);
  const p3 = spin(r0.x2, r0.y2);
  const spun = { ...r0, cx2: c2.x, cy2: c2.y, x2: p3.x, y2: p3.y };
  const q = (call, j) => poseFor(call.dancers[d], moveBeatRange(call.dancers[d], j).to);
  const edited = setMove(src, d, k, { ...path0[k], rotate: spun });

  const dh = normAngleSafe(bezierAngle(spun, 1) - bezierAngle(r0, 1));
  check(Math.abs(dh - DELTA) < 1e-12, `rotating the final span of the facing curve turns the heading the move ends on by exactly ${(dh / DEG).toFixed(2)}deg`);
  const pEnd = q(src, k);
  const pEndAfter = q(edited, k);
  check(Math.hypot(pEndAfter.x - pEnd.x, pEndAfter.y - pEnd.y) < 1e-12,
    'a facing edit writes no translation, so the position the move itself ends on is bit-identical');
  check(Math.abs(normAngleSafe(pEndAfter.heading - pEnd.heading) - dh) < 1e-12,
    `and the heading it ends on moves by the whole ${(dh / DEG).toFixed(2)}deg - which is the heading that decides the next move's frame`);

  // THE WHOLE REST OF THE CALL, pose by pose: the old pose rigidly rotated by dh about the pose the move
  // ends on. Not a shift, not a scale - a rotation about that point, which is what the composition means.
  let worstRaw = 0;
  let headingsTurned = 0;
  for (let j = k + 1; j < path0.length; j++) {
    const a = q(src, j);
    const b = q(edited, j);
    const vx = a.x - pEnd.x;
    const vy = a.y - pEnd.y;
    const want = { x: pEnd.x + vx * Math.cos(dh) - vy * Math.sin(dh), y: pEnd.y + vx * Math.sin(dh) + vy * Math.cos(dh) };
    worstRaw = Math.max(worstRaw, Math.hypot(b.x - want.x, b.y - want.y));
    if (Math.abs(normAngleSafe(b.heading - a.heading) - dh) < 1e-12) headingsTurned++;
  }
  check(worstRaw < 1e-9,
    `THE REST OF THE CALL IS RIGIDLY ROTATED about that pose by the whole ${(dh / DEG).toFixed(0)}deg (worst error ${worstRaw.toExponential(1)} units) - the format's semantics, pinned so that a change here is a decision rather than a drift`);
  check(headingsTurned === path0.length - k - 1, `every one of the ${headingsTurned} later boundary headings is turned by the same ${(dh / DEG).toFixed(0)}deg, so the dancer does the same footwork facing round`);
  const srcEnd = poseFor(src.dancers[d], src.beats);
  const endAfter = poseFor(edited.dancers[d], src.beats);
  check(Math.hypot(endAfter.x - srcEnd.x, endAfter.y - srcEnd.y) > 0.1,
    `which carries the call's end ${Math.hypot(endAfter.x - srcEnd.x, endAfter.y - srcEnd.y).toFixed(3)} units across the floor: a facing edit is a real edit, and the end formation turns with it`);

  // THE MOVES BEFORE IT, and every other dancer, are untouched: the edit is local in TIME, and it is the
  // dance's own composition - not a compensation - that carries it forward.
  let beforeTouched = 0;
  let othersTouched = 0;
  for (let j = 0; j < k; j++) {
    for (const key of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
      if (edited.dancers[d].path[j].translate[key] !== path0[j].translate[key]) beforeTouched++;
    }
  }
  for (let i = 0; i < edited.dancers.length; i++) {
    if (i === d) continue;
    for (let j = 0; j < edited.dancers[i].path.length; j++) {
      for (const key of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
        if (edited.dancers[i].path[j].translate[key] !== src.dancers[i].path[j].translate[key]) othersTouched++;
      }
    }
  }
  check(beforeTouched === 0, 'no move BEFORE the edited one changes');
  check(othersTouched === 0, 'and no other dancer is touched at all');
}

// ---------------------------------------------------------------------------
// 20. a created call can name its start formation instead of embedding it
// ---------------------------------------------------------------------------
//
// The corpus's own tams name their start with `formation="Name"` and carry no geometry; only an
// editor-authored one embedded the block, because a formation the CALLER created could not be named at
// all - `loadVariants` resolved references against `formations.xml` and nothing else. Both halves are
// tested here: the export, and the reference resolving against a REGISTERED formation.
console.log('\n== a created call can name its start formation (20) ==');
{
  const src = normalizeInstance(loadCallFromXml(circleXml, movesXml, formationsXml, 0));
  // A "created end formation": the shape a caller labels in the editor from a call's end. Taken here
  // exactly as that path takes it.
  const endShape = endPoses(src).map((p) => ({ x: p.x, y: p.y, heading: p.heading, gender: p.gender }));
  const NAME = 'Test Created End';
  // A call that starts, dancer for dancer, at that formation - which is what a created setup IS.
  const starts = { ...src, from: NAME, dancers: src.dancers.map((d, i) => ({ ...d, x: endShape[i].x, y: endShape[i].y, angleDeg: endShape[i].heading / DEG })) };

  check(startsFromFormation(starts, endShape), 'the created call starts from that formation, dancer for dancer');
  const embedded = callToXml(starts, NAME);
  const named = callToXml(starts, NAME, { formation: 'reference' });
  check(embedded.includes('<formation>') && !embedded.includes('formation="'), 'the DEFAULT is still the inline block, with no `formation` attribute: every existing caller and the round-trip gate are untouched');
  check(!named.includes('<formation>') && named.includes(`formation="${NAME}"`), `the reference form writes \`formation="${NAME}"\` and NO geometry`);
  check(named.includes(`from="${NAME}"`), 'and keeps `from` as the human label, which is what the corpus does');

  // THE REFERENCE MUST RESOLVE, which is the half that did not work before: a library TOLD about the
  // caller's formation builds a call naming it. THE FORMATION GOES IN FIRST - a call is built when it
  // is registered, so a reference to a formation registered afterwards is a failure, not a retry, and
  // that ordering is the app's responsibility too.
  const tam = `<calls>\n${named}\n</calls>`;
  const mk = () => new Sequencer(movesXml, formationsXml, []);
  const matchable = endShape.map((p) => ({ x: p.x, y: p.y, heading: p.heading, gender: p.gender }));
  const told = mk();
  told.registerFormation(NAME, matchable);
  told.register('Test', tam);
  const built = told.getVariants('Test')?.[0] ?? null;
  check(!!built, 'a library that has been TOLD about it builds the call: a reference to a caller-made formation used to fail with "No formation ..."');
  if (built) {
    let worst = 0;
    for (let i = 0; i < endShape.length; i++) {
      const p = poseFor(built.dancers[i], 0);
      worst = Math.max(worst, Math.hypot(p.x - endShape[i].x, p.y - endShape[i].y), Math.abs(normAngleSafe(p.heading - endShape[i].heading)));
    }
    check(worst < 1e-3, `and it starts at EXACTLY the named formation's poses (worst ${worst.toExponential(1)}), so the reference is faithful rather than nearly right`);
    let travelled = 0;
    for (const d of built.dancers) for (const s of d.path) travelled += Math.abs(s.translate.x2) + Math.abs(s.translate.y2);
    check(travelled > 0, 'with its paths built from the file, not left empty by a silent skip');
  }
  // THE GUARD: a name nothing knows is REPORTED, not silently turned into a call that starts nowhere.
  const alone = mk();
  alone.register('Test', tam);
  check(!alone.getVariants('Test')?.length, 'a reference to a formation the library does NOT have is not built at all');
  check(alone.registrationFailures().some((f) => /No formation/.test(f.reason)), `and the reason NAMES it: "${alone.registrationFailures()[0]?.reason ?? ''}"`);
  // THE DECISION ITSELF (`callToXmlNamed`), which is what the app calls: the name is used only when it
  // RESOLVES and when it describes the shape the call starts from.
  const resolves = () => endShape;
  const nothing = () => null;
  const permuted = () => [endShape[1], endShape[0], ...endShape.slice(2)];
  check(callToXmlNamed(starts, NAME, resolves).includes(`formation="${NAME}"`), 'the app-facing helper writes the reference when the name RESOLVES and the call starts from it');
  check(callToXmlNamed(starts, NAME, nothing).includes('<formation>'), 'and falls back to the embedded block when the name resolves to NOTHING: a reference to a formation nobody has is a call that loads nowhere');
  check(callToXmlNamed(starts, NAME, permuted).includes('<formation>'), 'and when it resolves to a formation whose dancers are in another ORDER: the paths would go to the wrong dancers');
  // AND THE CHECK THAT STOPS A WRONG REFERENCE: the same spots in another ORDER are not this
  // formation, and neither is the same shape with the genders swapped.
  const swapped = endShape.map((p, i) => (i === 0 ? { ...p, x: endShape[1].x, y: endShape[1].y, heading: endShape[1].heading } : p));
  check(!startsFromFormation(starts, swapped), 'a formation whose dancers merely occupy the same SPOTS in a different order is refused: the paths would be handed out to the wrong dancers');
  const regendered = endShape.map((p, i) => (i === 0 ? { ...p, gender: p.gender === 'boy' ? 'girl' : 'boy' } : p));
  check(!startsFromFormation(starts, regendered), 'and so is the same shape with the arrangement (genders) changed: that is a different setup');
  check(startsFromFormation(starts, endShape.map((p) => ({ ...p, x: p.x + 5e-4 }))), "while the exporter's own rounding (5e-4) is inside the tolerance, so a formation that has been through the corpus once still matches");
}

// ---------------------------------------------------------------------------
// 21. the correspondence between a call and a formation can keep the ARRANGEMENT
// ---------------------------------------------------------------------------
//
// Asked for: "Add an option to select a different end formation and Connect a last move to the new end
// point. How can the interface handle formations with different indexes to the end positions. I may
// connect the end of the dance path to the wrong formation point."
//
// `deriveFormationMapping` pairs two equal-length dancer lists by GEOMETRY and never by array order, and
// that is what makes "dancer 3 -> spot 3" not a correspondence at all. What it did NOT consider is gender,
// and a formation's genders ARE its arrangement (which spots hold a boy and which a girl): pair a dancer
// with a spot declared for the other gender and the shape comes out right while the SETUP is a different
// one. `preferGender` closes that, and it is OFF by default so every existing caller is bit-for-bit
// unchanged - which is the first thing this section measures.
console.log('\n== the correspondence can keep the formation\'s arrangement (21) ==');
{
  // REAL WITNESSES: every ms-level call's own start against its own END (a real board with real genders),
  // plus the same ends with the arrangements deliberately broken.
  const msDir = path.join(__dirname, '../../poc/src/assets/ms');
  const pairs = [];
  for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
    try {
      const call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
      if (call.dancers.length !== 8) continue;
      pairs.push({
        file: f,
        start: call.dancers.map((d) => {
          const p = poseFor(d, 0);
          return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
        }),
        end: call.dancers.map((d) => {
          const p = poseFor(d, call.beats);
          return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
        }),
      });
    } catch {
      /* not a call setup */
    }
  }
  check(pairs.length > 10, `the sweep is ${pairs.length} real (start, end) pairs from the ms level, not a hand-built witness`);

  // 1. THE FLAG OFF IS THE OLD BEHAVIOUR, EXACTLY: with the formation's genders erased the default must
  //    give the same pairing. (If genders ever leak into the unflagged path, this fails.)
  let genderLeak = 0;
  for (const { start, end } of pairs) {
    const a = deriveFormationMapping(start, end);
    const b = deriveFormationMapping(start, end.map((p) => ({ ...p, gender: undefined })));
    if (a.some((s, i) => s !== b[i])) genderLeak++;
  }
  check(genderLeak === 0, `with \`preferGender\` off the genders make no difference to the pairing (${genderLeak} of ${pairs.length} pairs changed when they were erased)`);

  // 2. WHAT THE GEOMETRY ALONE DOES, MEASURED. The arrangement matters most of the time.
  let mismatchDefault = 0;
  let spotsDefault = 0;
  let mismatchPreferred = 0;
  let identical = 0;
  for (const { start, end } of pairs) {
    const plain = deriveFormationMapping(start, end);
    const kept = deriveFormationMapping(start, end, true);
    if (plain.every((s, i) => s === i)) identical++;
    for (let i = 0; i < plain.length; i++) {
      if (end[plain[i]].gender !== start[i].gender) mismatchDefault++;
      if (end[kept[i]].gender !== start[i].gender) mismatchPreferred++;
    }
    spotsDefault += plain.filter((s, i) => end[s].gender !== start[i].gender).length > 0 ? 1 : 0;
  }
  check(mismatchDefault > 0, `the geometry alone puts somebody on the other gender's spot in ${spotsDefault} of ${pairs.length} pairs (${mismatchDefault} spots) - a real board, not a contrived one`);
  check(mismatchPreferred === 0, `and with the arrangement preferred, nobody does (${mismatchPreferred} spots) - the 4 boys and 4 girls land on the 4 boy spots and the 4 girl spots`);

  // 3. IT IS STILL THE GEOMETRY THAT DECIDES WHERE, and still never the array index.
  for (const { start, end } of pairs) {
    const kept = deriveFormationMapping(start, end, true);
    const seen = new Set(kept);
    check(seen.size === 8 && [...seen].every((s) => s >= 0 && s < 8), `every spot is used once (${pairs.length} pairs checked)`);
    break;
  }
  check(identical < pairs.length, `and array order is still not the answer: index-for-index agrees with the geometry for only ${identical} of ${pairs.length} pairs`);

  // 4. WHEN THE COUNTS DO NOT LINE UP THE ASSIGNMENT IS STILL TOTAL - and the survivors are the geometry's.
  const allBoys = pairs[0].end.map((p) => ({ ...p, gender: 'boy' }));
  const lopsided = deriveFormationMapping(pairs[0].start, allBoys, true);
  const girls = pairs[0].start.filter((p) => p.gender === 'girl').length;
  const onBoys = lopsided.filter((s, i) => allBoys[s].gender !== pairs[0].start[i].gender).length;
  check(lopsided.length === 8 && new Set(lopsided).size === 8, 'a formation of eight boys still takes every dancer, once each: the second pass is what makes the assignment total');
  check(onBoys === girls, `and exactly the ${girls} dancers who cannot be accommodated are the ones left on a mismatched spot (${onBoys})`);

  // 5. And the refusal is unchanged: a different NUMBER of dancers is a gap, not a pairing.
  let threw = false;
  try {
    deriveFormationMapping(pairs[0].start, pairs[0].end.slice(0, 4), true);
  } catch {
    threw = true;
  }
  check(threw, 'a formation with the wrong number of dancers still throws rather than pairing the rest by index');
}

// ---------------------------------------------------------------------------
// 22. moving a move's END POINT holds the direction the dancer leaves on
// ---------------------------------------------------------------------------
//
// The editor's new endpoint handle. `poseFor` composes the chain as `m = m * translateBy(p3); m =
// m * rotateBy(a)` with `a = bezierAngle(rotate ?? translate, 1)`, so `p3` is where the move ends AND,
// through the tangent at t=1 (which is `3 * (p3 - p2)`), part of the heading it ends on - which is the frame
// the NEXT move is played in. Moving `p3` alone therefore swings the rest of the track, which is a side
// effect nobody asked for; `moveCurveEnd` holds the exit handle vector so it cannot.
console.log('\n== moving an end point holds the direction the dancer leaves on (22) ==');
{
  const witness = normalizeInstance(loadCallFromXml(circleXml, movesXml, formationsXml, 0));
  const d = 0;
  const boundaries = (call, i) => call.dancers[i].path.map((_, k) => poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k).to));

  // WHICH MOVES ARE WORTH MEASURING: one with a facing curve and one without, and both must have something
  // after them (the claim is about the moves that FOLLOW).
  const withFacing = witness.dancers[d].path.findIndex((s, i) => s.rotate && i < witness.dancers[d].path.length - 2);
  const withoutFacing = witness.dancers[d].path.findIndex((s, i) => !s.rotate && i < witness.dancers[d].path.length - 2);
  check(withFacing >= 0 && withoutFacing >= 0, `the witness has both cases to measure: move ${withFacing + 1} carries a facing curve, move ${withoutFacing + 1} does not`);

  const DX = 1.25;
  const DY = -0.75;
  for (const k of [withFacing, withoutFacing]) {
    const before = witness;
    const seg = before.dancers[d].path[k];
    const held = moveCurveEnd(seg.translate, seg.translate.x2 + DX, seg.translate.y2 + DY);
    const after = setMove(before, d, k, { ...seg, translate: held });
    const what = seg.rotate ? 'with a facing curve' : 'with no facing curve (the tangent IS the heading)';

    // 1. THE END POINT IS WHERE IT WAS PUT, exactly.
    check(held.x2 === seg.translate.x2 + DX && held.y2 === seg.translate.y2 + DY, `k = ${k + 1}, ${what}: the end point is exactly where it was put`);

    // 2. AND THE DIRECTION IS HELD: the tangent at t = 1 keeps its direction, so the frame the next move
    //    starts in is not rotated. NOT bit-identical, and the reason is worth stating: the handle vector is
    //    re-derived from the stored numbers as `x2 - cx2`, so the cancellation costs one ulp of the tangent
    //    (measured below). The HEADING is what the engine reads, and it comes out identical.
    const a0 = bezierAngle(seg.translate, 1);
    const a1 = bezierAngle(held, 1);
    const dt = Math.abs(normAngleSafe(a1 - a0));
    check(dt < 1e-15, `k = ${k + 1}, ${what}: the exit tangent keeps its direction to ${dt.toExponential(1)} rad (one ulp from the subtraction that re-derives the handle), so the frame the next move starts in is not rotated`);
    const endBefore = poseFor(before.dancers[d], moveBeatRange(before.dancers[d], k).to);
    const endAfter = poseFor(after.dancers[d], moveBeatRange(after.dancers[d], k).to);
    check(Math.abs(normAngleSafe(endAfter.heading - endBefore.heading)) < 1e-15, `k = ${k + 1}: and the heading the move ends on is unchanged (${((normAngleSafe(endAfter.heading - endBefore.heading)) / DEG).toExponential(1)} deg)`);

    // 3. THE WHOLE TAIL IS THE OLD TAIL, CARRIED. Every later boundary is the pose it was, translated by
    //    exactly the distance the end point moved - same headings, same shape.
    const shift = { x: endAfter.x - endBefore.x, y: endAfter.y - endBefore.y };
    const b0 = boundaries(before, d);
    const b1 = boundaries(after, d);
    let worstPos = 0;
    let worstHead = 0;
    for (let j = k + 1; j < b0.length; j++) {
      worstPos = Math.max(worstPos, Math.hypot(b1[j].x - b0[j].x - shift.x, b1[j].y - b0[j].y - shift.y));
      worstHead = Math.max(worstHead, Math.abs(normAngleSafe(b1[j].heading - b0[j].heading)));
    }
    check(worstPos < 1e-12 && worstHead < 1e-12,
      `k = ${k + 1}: all ${b0.length - k - 1} later boundaries are the old ones carried by (${shift.x.toFixed(3)}, ${shift.y.toFixed(3)}) - worst position error ${worstPos.toExponential(1)}, worst heading error ${worstHead.toExponential(1)}`);

    // 4. THE NEGATIVE CONTROL, and it is TWO different claims depending on which heading is in charge -
    //    which is the whole reason the request mentions a facing override separately.
    const raw = setMove(before, d, k, { ...seg, translate: { ...seg.translate, x2: seg.translate.x2 + DX, y2: seg.translate.y2 + DY } });
    const da = Math.abs(normAngleSafe(bezierAngle(raw.dancers[d].path[k].translate, 1) - a0));
    let rawHead = 0;
    const rb = boundaries(raw, d);
    for (let j = k + 1; j < rb.length; j++) rawHead = Math.max(rawHead, Math.abs(normAngleSafe(rb[j].heading - b0[j].heading)));
    console.log(`      k = ${k + 1} without the hold: the exit direction turns ${(da / DEG).toFixed(2)}deg; the tail's headings move by up to ${(rawHead / DEG).toFixed(2)}deg`);
    check(da > 0.05, `k = ${k + 1}: without the hold the DIRECTION OF TRAVEL turns ${(da / DEG).toFixed(1)}deg, which is the side effect this operation exists to prevent`);
    if (seg.rotate) {
      // WITH A FACING CURVE THE TAIL IS CARRIED EITHER WAY, because the heading comes from the rotation
      // curve and the frame's translation is the end point in both cases - so what the hold protects here
      // is the direction the dancer is TRAVELLING as it leaves, which is exactly what was asked for.
      check(rawHead < 1e-12, `k = ${k + 1}: with a facing curve the tail is carried either way (${(rawHead / DEG).toExponential(1)}deg), so the hold's job there is the direction of travel, not the track`);
    } else {
      check(rawHead > 0.05, `k = ${k + 1}: and with no facing curve the tangent IS the heading, so the tail turns with it (${(rawHead / DEG).toFixed(1)}deg) - the swing the hold prevents`);
    }
  }

  // 5. A DEGENERATE EXIT STAYS DEGENERATE. `p2` moves with `p3`, so the handle vector is still the zero
  //    vector and the heading the curve reports is not invented by the drag. THIS IS NOT A CORNER CASE: the
  //    corpus count below is why the rule holds the zero vector rather than skipping it, and the first
  //    version of `moveCurveEnd` skipped it - which turned every one of these.
  const flat = { cx1: 1, cy1: 0, cx2: 3, cy2: 0, x2: 3, y2: 0 };
  const movedFlat = moveCurveEnd(flat, 4, 1);
  check(movedFlat.x2 === 4 && movedFlat.y2 === 1 && movedFlat.cx2 === 4 && movedFlat.cy2 === 1,
    'a curve whose exit handle is degenerate stays degenerate - p2 moves with p3 - so no tangent is invented');
  check(bezierAngle(movedFlat, 1) === bezierAngle(flat, 1), `and it goes on reporting the same heading (${bezierAngle(flat, 1)})`);
  // And an ordinary move is not disturbed when the end point does not move.
  const same = moveCurveEnd(flat, flat.x2, flat.y2);
  check(same.cx2 === flat.cx2 && same.cy2 === flat.cy2, 'and moving an end point to where it already is changes nothing at all');

  // THE CORPUS COUNT, so the degenerate case cannot be dismissed as rare - and so the sweep that found it is
  // pinned rather than retold.
  const msDir = path.join(__dirname, '../../poc/src/assets/ms');
  let moves = 0;
  let degenerate = 0;
  for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
    } catch {
      continue;
    }
    // THE SAME SAMPLE THE PROBE SWEEPS: whole-set calls only, so the two counts are the same number rather
    // than two numbers that look like they disagree.
    if (call.dancers.length !== 8) continue;
    for (const dancer of call.dancers) {
      dancer.path.forEach((seg, k) => {
        if (k === dancer.path.length - 1) return;
        moves++;
        if (Math.hypot(seg.translate.x2 - seg.translate.cx2, seg.translate.y2 - seg.translate.cy2) === 0) degenerate++;
      });
    }
  }
  check(degenerate > 0, `${degenerate} of the ${moves} movable moves in the ms level have a zero-length exit handle, and every one of them keeps its heading because the zero vector is held too`);
}

// ---------------------------------------------------------------------------
// 23. the CIRCLE a curve follows, and the tolerance that decides "closely"
// ---------------------------------------------------------------------------
//
// The editor's end-drag mode offers a CENTRE handle when the curve in hand is closely an arc or a circle, so
// that it can be swung about its start point. "Closely" needs a number, and `fitCircle` is where it lives: a
// cubic has no centre, so the arc condition is a FIT - the end tangents of a true arc are perpendicular to
// their radii, so the centre is where the two perpendiculars MEET (one linear solve), and any other cubic is
// measured against that circle and refused if it strays too far.
console.log('\n== the circle a curve follows, and the tolerance that decides "closely" (23) ==');
{
  // A CONSTRUCTED QUARTER ARC, and the number the engine already knows about it: the best cubic for a
  // quarter circle misses by 2.73e-4 of the radius (section 17 pins that same constant), so the fit has to
  // find that circle and report that deviation.
  const quarter = arcBezier({ x: 1, y: 1, angle: Math.PI / 4 });
  const fit = fitCircle(quarter, 1);
  check(!!fit, 'a constructed quarter arc fits a circle at all');
  check(Math.abs(fit.relDev - 2.72e-4) < 1e-5, `and the deviation is the construction's own ${fit.relDev.toExponential(2)} of the radius`);
  check(Math.abs(Math.abs(fit.sweep) - Math.PI / 2) < 1e-9, `the sweep is a quarter turn (${((Math.abs(fit.sweep) * 180) / Math.PI).toFixed(2)}deg)`);
  check(fit.r > 1 && fit.r < 3, `and the radius is ${fit.r.toFixed(4)} - a circle through the arc's own ends`);

  // AN ELLIPTICAL QUARTER IS NOT A CIRCLE, and the fit must say so: same construction, handles of different
  // lengths. This is also why `arcOf` (the quarter-arc lock) is not the same test - that one accepts the
  // ellipse, because the LOCK is about both handles keeping their directions.
  const ellipse = arcBezier({ x: 1, y: 0.5, angle: Math.PI / 4 });
  check(fitCircle(ellipse, 1)?.relDev > 0.5, `an elliptical quarter is refused (deviation ${fitCircle(ellipse, 1)?.relDev.toFixed(2)} of the radius)`);
  check(fitCircle(ellipse, 0.02) === null, 'and it is null at the tolerance the panel uses');

  // A STRAIGHT WALK HAS NO CENTRE: the two perpendiculars are parallel and never meet, which is the honest
  // answer - a line is not a circle of infinite radius.
  const straight = padSegment({ x: 0, y: 0, heading: 0 }, { x: 2, y: 0, heading: 0 }, 2).translate;
  check(fitCircle(straight, 1) === null, 'a straight walk has no centre at all (parallel perpendiculars)');
  check(fitCircle({ cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, 1) === null, 'and neither does a curve with no length');

  // THE FIT IS THE GEOMETRY, NOT A FRAME: rotate the five numbers and the centre rotates with them while
  // the radius and the deviation are untouched. A fit that depended on the dancer's heading would put the
  // handle in the wrong place for half the corpus.
  const ROT = 0.7;
  const spun = (t) => {
    const c = Math.cos(ROT);
    const s = Math.sin(ROT);
    const rot = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
    const a = rot(t.cx1, t.cy1);
    const b = rot(t.cx2, t.cy2);
    const e = rot(t.x2, t.y2);
    return { cx1: a.x, cy1: a.y, cx2: b.x, cy2: b.y, x2: e.x, y2: e.y };
  };
  const spunFit = fitCircle(spun(quarter), 1);
  check(Math.abs(spunFit.r - fit.r) < 1e-12 && Math.abs(spunFit.relDev - fit.relDev) < 1e-15, 'rotating the curve leaves the radius and the deviation identical');
  const wantCx = fit.cx * Math.cos(ROT) - fit.cy * Math.sin(ROT);
  const wantCy = fit.cx * Math.sin(ROT) + fit.cy * Math.cos(ROT);
  check(Math.hypot(spunFit.cx - wantCx, spunFit.cy - wantCy) < 1e-12, 'and rotates the centre with it, to 1e-12');

  // THE TOLERANCE IS A GATE, not a label: the quarter arc is refused by a tolerance below its own error.
  check(fitCircle(quarter, 1e-5) === null, 'the tolerance really refuses: the same arc is null at 1e-5 even though its error is only 2.72e-4');

  // AND THE DEFAULT COMES FROM THE CORPUS, with the empty band the rest of this project picks windows from.
  const msDir = path.join(__dirname, '../../poc/src/assets/ms');
  const devs = [];
  let totalCurves = 0;
  for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
    } catch {
      continue;
    }
    if (call.dancers.length !== 8) continue;
    for (const dancer of call.dancers) {
      for (const seg of dancer.path) {
        totalCurves++;
        const x = fitCircle(seg.translate, 1);
        if (x) devs.push(x.relDev);
      }
    }
  }
  const under = (t) => devs.filter((d) => d <= t).length;
  const arcs = under(0.02);
  const worstArc = Math.max(...devs.filter((d) => d <= 0.05));
  const bestStraightish = Math.min(...devs.filter((d) => d > 0.05));
  console.log(`    of the ${totalCurves} corpus travel curves, ${devs.length} have a centre at all and ${arcs} are arcs by the panel's 2% (largest deviation ${worstArc.toExponential(2)}, and the next curve along deviates ${bestStraightish.toExponential(2)})`);
  check(arcs > 50 && arcs < totalCurves / 2, `the feature applies to a real minority of the corpus (${arcs} of ${totalCurves} curves), not to everything and not to nothing`);
  check(bestStraightish > 5 * worstArc, `and 2% sits in an EMPTY BAND: the worst real arc deviates ${worstArc.toExponential(2)} and the closest curve that is not one deviates ${bestStraightish.toExponential(2)}, ${(bestStraightish / worstArc).toFixed(0)}x further out, so the exact threshold does not matter`);

  // THE FIT AGREES WITH THE CURVE'S OWN TURN, which is an independent read of the same geometry: a circular
  // arc turns by exactly its sweep. Anything else means the fitted circle is not the one the curve follows.
  let worstTurn = 0;
  for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
    } catch {
      continue;
    }
    if (call.dancers.length !== 8) continue;
    for (const dancer of call.dancers) {
      for (const seg of dancer.path) {
        const x = fitCircle(seg.translate, 0.02);
        if (!x) continue;
        const turn = normAngleSafe(bezierAngle(seg.translate, 1) - bezierAngle(seg.translate, 0));
        worstTurn = Math.max(worstTurn, Math.abs(turn - x.sweep));
      }
    }
  }
  check(worstTurn < 1e-12, `and every arc's sweep IS the turn it makes (worst disagreement ${(worstTurn / DEG).toExponential(1)}deg over the corpus)`);
}

// ---------------------------------------------------------------------------
// 24. swinging an arc about its start keeps the arc, the radius and the JOINT
// ---------------------------------------------------------------------------
//
// The caller's two corrections on this gesture: "the start control point isnt adjusted to maintain the arc
// shape" - so the swing is a RIGID rotation of the whole curve, which cannot change a radius or a shape - and
// "care must be taken to maintain the dancers direction in transition from the previous curve, including the
// facing curve" - which is the previous move's exit tangent, turned by the same angle, with its heading
// change frozen so the frame this arc is played in does not rotate (a swing in a rotated frame is a gesture
// that does nothing).
console.log('\n== swinging an arc about its start (24) ==');
{
  const msDir = path.join(__dirname, '../../poc/src/assets/ms');
  const witness = (wantFacingOnPrev) => {
    for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
      let call;
      try {
        call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
      } catch {
        continue;
      }
      if (call.dancers.length !== 8) continue;
      for (let i = 0; i < 8; i++) {
        for (let k = 1; k < call.dancers[i].path.length; k++) {
          if (!fitCircle(call.dancers[i].path[k].translate, 0.02)) continue;
          if (!!call.dancers[i].path[k - 1].rotate === wantFacingOnPrev) return { file: f, call, i, k };
        }
      }
    }
    return null;
  };
  const THETA = 0.4;
  const dir = (call, i, k, t) => {
    const p = poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k).from);
    return normAngleSafe(bezierAngle(call.dancers[i].path[k].translate, t) + p.heading);
  };
  const at = (call, i, k, end) => {
    const r = moveBeatRange(call.dancers[i], k);
    return poseFor(call.dancers[i], end ? r.to : r.from);
  };
  const jointGap = (call, i, k) => Math.abs(normAngleSafe(dir(call, i, k - 1, 1) - dir(call, i, k, 0)));

  for (const wantFacing of [true, false]) {
    const w = witness(wantFacing);
    check(!!w, `there is a witness whose previous move ${wantFacing ? 'HAS' : 'has NO'} facing curve (${w?.file} dancer ${(w?.i ?? 0) + 1} move ${(w?.k ?? 0) + 1})`);
    const { call, i, k } = w;
    const seg = call.dancers[i].path[k];
    const before = fitCircle(seg.translate, 1);
    const after = swingArcAboutStart(call, i, k, THETA);
    const swung = after.dancers[i].path[k].translate;
    const afterFit = fitCircle(swung, 1);

    // 1. THE ARC IS THE SAME ARC: a rigid motion cannot change a radius or a shape.
    check(Math.abs(afterFit.r - before.r) < 1e-12, `the radius is unchanged (${before.r.toFixed(6)} -> ${afterFit.r.toFixed(6)})`);
    check(Math.abs(afterFit.relDev - before.relDev) < 1e-15, `and so is the shape: the deviation from its own circle is identical (${afterFit.relDev.toExponential(2)})`);
    check(Math.abs(Math.abs(afterFit.sweep) - Math.abs(before.sweep)) < 1e-12, `and the sweep (${((Math.abs(before.sweep) * 180) / Math.PI).toFixed(2)}deg)`);

    // 2. THE START DOES NOT MOVE, and the end swings about it at a FIXED DISTANCE - which is what the
    //    caller asked the radius to mean.
    const s0 = at(call, i, k, false);
    const s1 = at(after, i, k, false);
    check(Math.hypot(s1.x - s0.x, s1.y - s0.y) < 1e-12 && Math.abs(normAngleSafe(s1.heading - s0.heading)) < 1e-12, 'the pose the move starts from is untouched');
    const e0 = at(call, i, k, true);
    const e1 = at(after, i, k, true);
    const r0 = Math.hypot(e0.x - s0.x, e0.y - s0.y);
    const r1 = Math.hypot(e1.x - s1.x, e1.y - s1.y);
    check(Math.abs(r1 - r0) < 1e-12, `the end keeps its distance from the start exactly (${r0.toFixed(6)} -> ${r1.toFixed(6)})`);
    // ...and it really moved, by the chord of the swing.
    const swungBy = Math.hypot(e1.x - e0.x, e1.y - e0.y);
    const chord = 2 * r0 * Math.sin(THETA / 2);
    check(Math.abs(swungBy - chord) < 1e-9, `and it moved by the chord of a ${(THETA / DEG).toFixed(1)}deg swing: ${swungBy.toFixed(4)} units (${chord.toFixed(4)} expected)`);

    // 3. THE JOINT IS EXACTLY AS SMOOTH AS IT WAS - the whole point of turning the previous exit too.
    const gapBefore = jointGap(call, i, k);
    const gapAfter = jointGap(after, i, k);
    check(Math.abs(gapAfter - gapBefore) < 1e-12, `the corner at the joint is the one it already had (${((gapBefore * 180) / Math.PI).toFixed(3)}deg -> ${((gapAfter * 180) / Math.PI).toFixed(3)}deg): the previous move's exit turned with the arc`);

    // 4. AND THE FRAME DID NOT ROTATE, or the swing would be undone. The heading at the joint is the previous
    //    move's own end heading, so it is the thing that has to stay put.
    const h0 = poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k).from).heading;
    const h1 = poseFor(after.dancers[i], moveBeatRange(after.dancers[i], k).from).heading;
    check(Math.abs(normAngleSafe(h1 - h0)) < 1e-12, `the frame the arc is played in is unmoved (${((normAngleSafe(h1 - h0)) / DEG).toExponential(1)}deg of heading), so the swing is not undone by a rotated frame`);
    check(!!after.dancers[i].path[k - 1].rotate, `and the previous move's facing is what holds it${wantFacing ? ' (it already had one, untouched)' : ' (it had none, so one is written from its ORIGINAL travel curve, which is the heading profile it already had)'}`);

    // 5. THE PREVIOUS MOVE'S PATH ONLY RE-AIMS: its start and its end are where they were.
    const p0 = poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k - 1).from);
    const p1 = poseFor(after.dancers[i], moveBeatRange(after.dancers[i], k - 1).from);
    const q0 = poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k - 1).to);
    const q1 = poseFor(after.dancers[i], moveBeatRange(after.dancers[i], k - 1).to);
    check(Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-12 && Math.hypot(q1.x - q0.x, q1.y - q0.y) < 1e-12, 'the previous move still starts and finishes where it did: only its departure direction turned');

    // AND THE NEGATIVE CONTROL: without the re-aim, the arc swings and the joint takes the whole angle.
    const swungOnly = setMove(call, i, k, { ...seg, translate: rotateCurveAboutStart(seg.translate, THETA) });
    const kinkAfter = Math.abs(normAngleSafe(dir(swungOnly, i, k - 1, 1) - dir(swungOnly, i, k, 0)));
    console.log(`    ${wantFacing ? 'facing' : 'no facing'} on the previous move: the joint goes ${((gapBefore * 180) / Math.PI).toFixed(2)}deg -> ${((kinkAfter * 180) / Math.PI).toFixed(2)}deg without the re-aim, and stays ${((gapAfter * 180) / Math.PI).toFixed(2)}deg with it`);
    check(Math.abs(kinkAfter - gapBefore) > THETA / 2, 'the negative control really kinks: a rigid swing alone turns the joint by the swing angle, which is what the previous move\'s exit is turned to prevent');
  }

  // 6. A MOVE THAT IS NOT AN ARC IS REFUSED rather than swung into something else.
  const notArc = normalizeInstance(loadCallFromXml(circleXml, movesXml, formationsXml, 0));
  let threw = false;
  try {
    swingArcAboutStart(notArc, 0, 0, 0.3);
  } catch {
    threw = true;
  }
  check(threw, 'a move whose curve is not closely a circle is refused: there is no centre to swing about');
  // ...and a zero swing is the identity, so a drag that has not moved yet writes nothing.
  const w = witness(true);
  const same = swingArcAboutStart(w.call, w.i, w.k, 0);
  let worstSame = 0;
  for (let j = 0; j < w.call.dancers.length; j++) {
    const a = poseFor(same.dancers[j], same.beats);
    const b = poseFor(w.call.dancers[j], w.call.beats);
    worstSame = Math.max(worstSame, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(normAngleSafe(a.heading - b.heading)));
  }
  check(worstSame < 1e-12, 'and a zero-angle swing leaves the whole call exactly where it was');

  // 7. A PREVIOUS MOVE WITH NO DEPARTURE DIRECTION IS LEFT ALONE, and the reason is measured rather than
  //    asserted: its exit handle has collapsed onto its endpoint, so `bezierAngle` there is `atan2(0, 0)` -
  //    a convention, not a direction - and turning a zero vector does nothing while inventing a length would
  //    deform a move authored to arrive with nothing left to travel. The swing still happens; the joint
  //    keeps the angle it had; the panel says so. 22 of the 134 arc-ish moves in the ms level are this case.
  {
    let deg = 0;
    let degWitness = null;
    for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
      let call;
      try {
        call = normalizeInstance(loadCallFromXml(read(`../../poc/src/assets/ms/${f}`), movesXml, formationsXml, 0));
      } catch {
        continue;
      }
      if (call.dancers.length !== 8) continue;
      for (let i = 0; i < 8; i++) {
        for (let k = 1; k < call.dancers[i].path.length; k++) {
          if (!fitCircle(call.dancers[i].path[k].translate, 0.02)) continue;
          if (hasExitDirection(call.dancers[i].path[k - 1].translate)) continue;
          deg++;
          if (!degWitness) degWitness = { file: f, call, i, k };
        }
      }
    }
    check(deg > 0, `${deg} of the arc-ish moves in the ms level follow a move with no departure direction, so this is a real case and not a hypothetical one`);
    const w2 = degWitness;
    const before = w2.call.dancers[w2.i].path[w2.k - 1].translate;
    const after = swingArcAboutStart(w2.call, w2.i, w2.k, 0.4);
    const prevAfter = after.dancers[w2.i].path[w2.k - 1];
    // The numbers are compared rather than stringified: a second `normalizeInstance` is exact ALGEBRA and not
    // exact bits, so the last ulp of a coordinate can move. What must not move is the geometry, and no facing
    // curve may be written at all.
    const worstPrev = Math.max(...['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'].map((key) => Math.abs(prevAfter.translate[key] - before[key])));
    // NO FACING IS *WRITTEN*: a move that already had one keeps it (that is not a write), and a move that had
    // none must still have none - which is the case this rule is about.
    check(worstPrev < 1e-12 && !!prevAfter.rotate === !!w2.call.dancers[w2.i].path[w2.k - 1].rotate,
      `the move before is UNTOUCHED - no direction invented, no facing added (worst number moved ${worstPrev.toExponential(1)}; ${w2.file} dancer ${w2.i + 1} move ${w2.k})`);
    const s0 = poseFor(w2.call.dancers[w2.i], moveBeatRange(w2.call.dancers[w2.i], w2.k).from);
    const s1 = poseFor(after.dancers[w2.i], moveBeatRange(after.dancers[w2.i], w2.k).from);
    check(Math.hypot(s1.x - s0.x, s1.y - s0.y) < 1e-12 && Math.abs(normAngleSafe(s1.heading - s0.heading)) < 1e-12,
      'and the arc still swings exactly as it does everywhere else: the start and the frame are still what they were');
  }
}

// --------------------------------------------------------------------------------
// 25. laying a RUN of moves on one circle: the ends stay, the turn is kept, the joints join
//
// The operation behind "make these moves a circle". A run of consecutive moves keeps its move count, its beats
// and its hands; only the shape between its two ends is rewritten. Five things have to hold and each is a
// separate check, because each fails on its own:
//   - the run's START does not move at all (the radius is snapped to it, so this is structural);
//   - the END moves by no more than the FIT'S OWN ERROR - the honest price of snapping a run that was nearly a
//     circle onto one exactly;
//   - the run is a circle afterwards, by two orders of magnitude;
//   - the turn is preserved AND spread in proportion to beats;
//   - everything outside the run is untouched, the facing curves survive, and the joints still join.
console.log('\n== 25. A run of moves laid on one circle ==');
{
  const msDir = path.join(__dirname, '../../poc/src/assets/ms');
  const fits = [];
  for (const f of fs.readdirSync(msDir).filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = normalizeInstance(loadCallFromXml(fs.readFileSync(path.join(msDir, f), 'utf8'), movesXml, formationsXml, 0));
    } catch { continue; }
    if (call.dancers.length !== 8) continue;
    for (let i = 0; i < 8; i++) {
      const n = call.dancers[i].path.length;
      let found = false;
      for (let len = n; len >= 3 && !found; len--) {
        for (let s = 0; s + len <= n; s++) {
          const fit = fitCircleRun(call, i, s, s + len - 1);
          if (fit) { fits.push({ file: f, call, i, s, e: s + len - 1, fit }); found = true; break; }
        }
      }
    }
  }
  check(fits.length > 10, `${fits.length} runs of three or more consecutive moves in the ms level lie on one circle - the sample is the corpus, not a witness`);

  const worst = { start: 0, heading: 0, endPast: -Infinity, refit: 0, sweep: 0, corner: 0, outside: 0, ratio: 0 };
  const refusals = [];
  let applied = 0;
  let facingKept = 0;
  let facingChecked = 0;
  for (const r of fits) {
    const d = r.call.dancers[r.i];
    const b0 = moveBeatRange(d, r.s).from;
    const b1 = moveBeatRange(d, r.e).to;
    const p0 = poseFor(d, b0);
    const p1 = poseFor(d, b1);
    let out;
    try {
      out = setRunCircle(r.call, r.i, r.s, r.e, r.fit);
    } catch (e) {
      refusals.push({ file: r.file, i: r.i, s: r.s, e: r.e, msg: e.message });
      continue;
    }
    applied++;
    const nd = out.dancers[r.i];
    const q0 = poseFor(nd, b0);
    const q1 = poseFor(nd, b1);
    worst.start = Math.max(worst.start, Math.hypot(q0.x - p0.x, q0.y - p0.y));
    worst.heading = Math.max(worst.heading, Math.abs(normAngleSafe(q0.heading - p0.heading)));
    // How far the end moved BEYOND what the fit itself was already out by.
    worst.endPast = Math.max(worst.endPast, Math.hypot(q1.x - p1.x, q1.y - p1.y) - r.fit.maxDev);
    const refit = fitCircleRun(out, r.i, r.s, r.e);
    if (!refit) { worst.refit = Infinity; } else {
      worst.refit = Math.max(worst.refit, refit.relDev);
      worst.sweep = Math.max(worst.sweep, Math.abs(refit.sweep - r.fit.sweep) * (180 / Math.PI));
    }
    // The turn each move carries, against its share of the beats.
    const totalBeats = d.path.slice(r.s, r.e + 1).reduce((a, g) => a + g.beats, 0);
    for (let k = r.s; k <= r.e; k++) {
      const seg = nd.path[k];
      const turn = Math.abs(normAngleSafe(bezierAngle(seg.translate, 1) - bezierAngle(seg.translate, 0)));
      const share = d.path[k].beats / totalBeats;
      worst.ratio = Math.max(worst.ratio, Math.abs(turn - Math.abs(r.fit.sweep) * share));
      facingChecked++;
      if (!!seg.rotate === !!d.path[k].rotate) facingKept++;
    }
    // Everything OUTSIDE the run, and the run's own timing and hands.
    for (let k = 0; k < nd.path.length; k++) {
      const a = nd.path[k];
      const b = d.path[k];
      if (k >= r.s && k <= r.e) {
        if (a.beats !== b.beats || a.hands !== b.hands) worst.outside = Infinity;
        continue;
      }
      for (const key of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
        worst.outside = Math.max(worst.outside, Math.abs(a.translate[key] - b.translate[key]));
      }
      if (!!a.rotate !== !!b.rotate) worst.outside = Infinity;
    }
    // Every joint INSIDE the run still joins.
    const dirOf = (dd, x, y) => {
      const u = poseFor(dd, x);
      const v = poseFor(dd, y);
      return Math.atan2(v.y - u.y, v.x - u.x);
    };
    for (let k = r.s + 1; k <= r.e; k++) {
      const bb = moveBeatRange(nd, k - 1).to;
      const corner = Math.abs(normAngleSafe(dirOf(nd, bb + 1e-3, bb) - dirOf(nd, bb, bb - 1e-3)));
      worst.corner = Math.max(worst.corner, Math.min(corner, 2 * Math.PI - corner) * (180 / Math.PI));
    }
  }
  check(applied > 0, `${applied} of the ${fits.length} runs were re-laid on their own circle`);
  check(worst.start < 1e-9, `the run's START does not move (worst ${worst.start.toExponential(1)} units) - the radius is snapped to it, so this is structural rather than lucky`);
  check(worst.heading < 1e-9, `and neither does the heading it sets off on (worst ${(worst.heading * (180 / Math.PI)).toExponential(1)}deg)`);
  check(worst.endPast < 1e-9, `the END moves by no more than the fit was already out by (worst excess ${worst.endPast.toExponential(1)} units)`);
  check(worst.refit < 1e-4, `and the run IS a circle afterwards: worst deviation ${worst.refit.toExponential(1)} of the radius, against a 2e-2 tolerance`);
  // The per-move turn is compared against the BEATS, and the two are the same quantity arrived at two ways (the
  // turn the curve carries, and the share of the beats it was given), so radians here are not degrees.
  check(worst.ratio < 1e-9, `the turn is spread in PROPORTION TO BEATS (worst disagreement ${worst.ratio.toExponential(1)} rad)`);
  // The tolerance is 1e-2deg because THIS READ IS SAMPLED: `fitCircleRun` sums the angle sample to sample, and
  // the run it is reading was only NEARLY a circle beforehand (up to 2% of the radius out), so the two reads
  // differ by the sampling and not by any geometry. The exact statement of "the turn is preserved" is the
  // per-move check above, where the sum of the thetas is the sweep by construction.
  check(worst.sweep < 1e-2, `the total turn is preserved (worst change ${worst.sweep.toExponential(1)}deg, which is the sampling of a run that was only nearly a circle before)`);
  check(worst.corner < 0.5, `every joint inside the run still joins (worst corner ${worst.corner.toExponential(1)}deg)`);
  check(worst.outside === 0, `everything OUTSIDE the run is bit-for-bit untouched, and the move has kept its beats and hands`);
  check(facingKept === facingChecked, `every move in every run keeps whether it had a facing curve (${facingKept} of ${facingChecked}) - the authored turn survives and "face along travel" still means that`);

  // The refusals are the user's chosen rule - refuse, and say how many moves it needs - so they are gated
  // rather than tolerated. BOTH SHAPES ARE BUILT DELIBERATELY rather than hoped for in the corpus: which run
  // happens to have uneven beats is not something a gate should depend on.
  const refusal = (fn) => {
    try { fn(); return null; } catch (e) { return e.message; }
  };
  // A sweep one move's worth too big for the run, built from the run's OWN length so it cannot depend on which
  // runs the scan happened to keep. (The first version looked for a run of exactly three moves, and the scan
  // keeps the LONGEST run per dancer, so that run usually does not exist and the check silently tested nothing.)
  const anyRun = fits[0];
  const tooBigLen = anyRun.e - anyRun.s + 1;
  const shortMsg = refusal(() => setRunCircle(anyRun.call, anyRun.i, anyRun.s, anyRun.e, { ...anyRun.fit, sweep: tooBigLen * (Math.PI / 2) + 0.2 }));
  check(!!shortMsg && new RegExp(`needs ${tooBigLen + 1} moves and the run has ${tooBigLen}`).test(shortMsg),
    `a turn too big for its run is refused with the number of moves it needs: "${shortMsg}"`);
  const wide = anyRun;
  const unevenMsg = wide
    ? refusal(() => {
      const d = wide.call.dancers[wide.i];
      const path = d.path.map((g, k) => (k >= wide.s && k <= wide.e ? { ...g, beats: k === wide.s + 1 ? 3 : 1 } : g));
      const call2 = { ...wide.call, dancers: wide.call.dancers.map((dd, j) => (j === wide.i ? { ...dd, path } : dd)) };
      setRunCircle(call2, wide.i, wide.s, wide.e, { ...wide.fit, sweep: 2 * Math.PI });
    })
    : null;
  const unevenAngle = unevenMsg ? Number((/turn ([\d.]+)deg/.exec(unevenMsg) ?? [])[1]) : NaN;
  check(!!unevenMsg && unevenAngle > 90 && unevenAngle <= 360,
    `and a turn the BEATS cannot carry in quarters is refused naming the move and a real angle, not a broken number: "${unevenMsg}"`);
  check(applied > 0, `${applied} of the ${fits.length} runs were re-laid on their own circle`);

  // The parameterisation itself: one continuous degree of freedom, one discrete one.
  const A = { x: 0, y: 0 };
  const B = { x: 2, y: 0 };
  const up = circleThrough(A, B, 2, 1);
  const down = circleThrough(A, B, 2, -1);
  check(!!up && !!down && Math.abs(up.cx - down.cx) < 1e-12 && Math.abs(up.cy + down.cy) < 1e-12,
    'the two SIDES are mirror images across the chord - the discrete degree of freedom is the side and nothing else');
  check(!!up && Math.abs(Math.hypot(A.x - up.cx, A.y - up.cy) - up.r) < 1e-12 && Math.abs(Math.hypot(B.x - up.cx, B.y - up.cy) - up.r) < 1e-12,
    'and BOTH pinned endpoints lie on it exactly, so an arc built this way cannot fail to join up');
  check(!!up && Math.abs(Math.abs(up.sweep) - 2 * Math.asin(2 / (2 * 2))) < 1e-12, 'the sweep returned is the MINOR arc, so a major one is the same circle with the other side');
  check(circleThrough(A, A, 2, 1) === null, 'COINCIDENT endpoints define no circle and return null - a full turn is a different parameterisation');
  check(circleThrough(A, B, 0.5, 1) === null, 'and neither does a radius too short to span the chord (0.5 < 2/2)');
  check(runCircleMoveCount(Math.PI / 2) === 1 && runCircleMoveCount(Math.PI / 2 + 1e-6) === 2 && runCircleMoveCount(2 * Math.PI) === 4,
    'a quarter turn needs one move, a hair over needs two, and a full circle needs four - the count the refusal message quotes');
  check(RUN_ARC_MAX === Math.PI / 2, 'and the quarter is the engine\'s stated limit, not a number buried in a comparison');
}

// --------------------------------------------------------------------------------
// 26. two arcs fit two points: which one is the run's, and when is a "circle" not one
//
// Both of these are a bug a caller found. "The Make Circle button seems to completely collapse the trace. After
// pressing all I see is a single drag point and no trace line." Two things had to be wrong at once for that,
// and each is gated here on its own.
console.log('\n== 26. The arc that is meant, and the fit that says nothing ==');
{
  // (a) THE MINOR ARC IS NOT ALWAYS THE ARC MEANT. Two points on a circle admit two arcs and the endpoints do
  // not say which; a near-closed orbit's minor arc is nothing at all.
  const circleCall = (() => {
    try {
      return normalizeInstance(loadCallFromXml(fs.readFileSync(path.join(__dirname, '../../poc/src/assets/ms/circle.xml'), 'utf8'), movesXml, formationsXml, 0));
    } catch { return null; }
  })();
  check(!!circleCall, 'ms/circle.xml - the 360deg `Circle Left` - is the witness, because it is the flagship case');
  if (circleCall) {
    const d = circleCall.dancers[0];
    const own = fitCircleRun(circleCall, 0, 1, 8);
    check(!!own && Math.abs(Math.abs(own.sweep) - 2 * Math.PI) < 0.15,
      `and it reads as ONE turn, not as a small arc (${own ? ((Math.abs(own.sweep) * 180) / Math.PI).toFixed(1) : '?'}deg)`);
    if (own) {
      const p0 = poseFor(d, moveBeatRange(d, 0).to);
      const p1 = poseFor(d, moveBeatRange(d, 8).to);
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const bare = circleThrough(p0, p1, own.r, 1);
      check(chord < 0.1 && !!bare && (Math.abs(bare.sweep) * 180) / Math.PI < 5,
        `the MINOR arc through its ends is almost nothing (${bare ? ((Math.abs(bare.sweep) * 180) / Math.PI).toFixed(2) : '?'}deg for a chord of ${chord.toFixed(3)} on a radius of ${own.r.toFixed(3)}) - which is the collapse`);
      // THE CONTRACT: the sweep is congruent to the endpoints' own base angle, so the arc passes through BOTH
      // ends, and it is the congruent value NEAREST the turn given. `normAngleSafe` is the engine's own, so a
      // sweep of 361deg and one of 1deg are the same arc and this says so.
      for (const turn of [own.sweep, 3 * Math.PI, -5 * Math.PI]) {
        const told = circleThrough(p0, p1, own.r, 1, turn);
        const congruent = Math.abs(normAngleSafe(told.sweep - bare.sweep)) < 1e-9;
        const nearest = Math.abs(told.sweep - turn) <= Math.PI + 1e-9;
        check(congruent && nearest,
          `told the run turns ${(turn * 180) / Math.PI}deg it lays the arc the ends allow and nearest that turn: ${((told.sweep * 180) / Math.PI).toFixed(1)}deg`);
      }
      check(Math.abs(circleThrough(p0, p1, own.r, 1, own.sweep).sweep) > Math.PI,
        'so a 360deg orbit gets an arc of more than half a turn rather than a sliver - which is the whole fix');
    }
    // The 3/4 turn, which is the case that shows a WRAP is needed rather than a choice between two candidates:
    // an arc that covers three quarters has ends a quarter apart, so the base sweep and the answer differ by a
    // whole turn. Asserted as the CONTRACT (congruent to the ends, nearest the turn given) rather than as an
    // equality with the fit, because which side of the chord the centre falls on is the caller's `side` and not
    // something the fit gets to overrule.
    const quarter = fitCircleRun(circleCall, 0, 2, 8);
    if (quarter) {
      const q0 = poseFor(d, moveBeatRange(d, 1).to);
      const q1 = poseFor(d, moveBeatRange(d, 8).to);
      const bare = circleThrough(q0, q1, quarter.r, 1);
      const told = circleThrough(q0, q1, quarter.r, 1, quarter.sweep);
      check(Math.abs(normAngleSafe(told.sweep - bare.sweep)) < 1e-9 && Math.abs(told.sweep - quarter.sweep) <= Math.PI + 1e-9 && Math.abs(told.sweep) > Math.PI,
        `and the ${((quarter.sweep * 180) / Math.PI).toFixed(1)}deg turn is laid as an arc past half a turn (${((told.sweep * 180) / Math.PI).toFixed(1)}deg) through the same two ends, not as the ${((bare.sweep * 180) / Math.PI).toFixed(1)}deg arc the ends alone would give`);
    }
  }
  // `runTurn` is the turn that exists when the fit does not. IT IS A PROXY AND ONLY HAS TO BE GOOD ENOUGH TO
  // PICK BETWEEN ARCS A WHOLE TURN APART, so the tolerance is loose on purpose: it is the sum of the moves'
  // own LOCAL turns, while the fit measures the turn in WORLD space, and `ms/circle.xml` differs by 7.2deg
  // over eight moves because the frames rotate as it goes.
  if (circleCall) {
    const own = fitCircleRun(circleCall, 0, 1, 8);
    const t = runTurn(circleCall, 0, 1, 8);
    check(!!own && Math.abs(normAngleSafe(t - own.sweep)) < 0.2,
      `runTurn agrees with the fit to within a few degrees, which is all a choice between arcs 360deg apart needs (${((t * 180) / Math.PI).toFixed(1)} against ${own ? ((own.sweep * 180) / Math.PI).toFixed(1) : '?'}deg)`);
  }

  // (b) AND A "CIRCLE" MUST DESCRIBE THE RUN IT WAS FITTED TO. A nearly straight run can sit inside any
  // relative tolerance on a huge enough circle, and then the radius is meaningless.
  const gs = (() => {
    try {
      return normalizeInstance(loadCallFromXml(fs.readFileSync(path.join(__dirname, '../../poc/src/assets/ms/grand_spin.xml'), 'utf8'), movesXml, formationsXml, 0));
    } catch { return null; }
  })();
  check(!!gs, 'ms/grand_spin.xml carries the witness: two moves that go STRAIGHT, which Kasa fitted as a circle of radius 28');
  if (gs) {
    const turn = runTurn(gs, 2, 21, 22);
    check(Math.abs(turn) * (180 / Math.PI) < 5,
      `the witness really is nearly straight: it turns ${(Math.abs(turn) * (180 / Math.PI)).toFixed(2)}deg`);
    check(fitCircleRun(gs, 2, 21, 22) === null,
      'and it is REFUSED - the circle that fitted it had a radius of 28 units and so said nothing about a 1.5-unit path');
    // NOT A BAN, and the count is what says so: the same call's other runs must go on reading as circles.
    let accepted = 0;
    for (let di = 0; di < 8; di++) {
      const n = gs.dancers[di].path.length;
      for (let from = 0; from < n - 1; from++) for (let to = from + 1; to < n; to++) if (fitCircleRun(gs, di, from, to)) accepted++;
    }
    check(accepted > 10, `and it is a GUARD and not a ban: ${accepted} other runs in the same call are still read as circles`);
    check(RUN_FIT_MAX_DEV === 0.05, 'and the threshold is a named constant, not a number buried in a comparison');
  }
}

console.log('\n=================');
if (failures === 0) console.log('EDITOR TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
