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

console.log('\n=================');
if (failures === 0) console.log('EDITOR TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
