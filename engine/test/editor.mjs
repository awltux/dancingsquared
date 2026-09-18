// Call-editor headless test: synthesize a missing setup by padding core moves,
// verify the geometry (positions + headings at pad boundaries), and round-trip
// the exported <tam> XML through buildCall.
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setParser,
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  loadCallFromXml,
  poseFor,
  dancerBeats,
  rigidFit,
  alignFormationToCore,
  synthesizeSetup,
  synthesizeSetupChain,
  setupToXml,
  callToXml,
  endPoses,
  closureDiscrepancy,
  correctEndTo,
  // The call-INSTANCE editor: read an instance as a table, edit its start formation and
  // arrangement, its end formation and its moves, and round-trip it through `<tam>` XML.
  normalizeInstance,
  instanceTable,
  instanceBeats,
  moveBeatRange,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  setMove,
  addMove,
  removeMove,
  sampleTrail,
  sampleTrailRange,
  DEG,
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

// The one footgun the export carries, pinned rather than discovered later: the ENGINE's
// own mirror rule is geometric ("mirror the half set unless a 180-degree partner already
// exists"), so an 8-dancer instance whose edited formation has no origin-opposite pair is
// DOUBLED when it is read back with mirror=true. The editor's own path is mirror=false,
// which is why the round trip above is exact; anything that writes an edited tam into the
// assets must know which of the two it is asking for.
console.log('\n== the mirror-on-reparse footgun (14c) ==');
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

console.log('\n=================');
if (failures === 0) console.log('EDITOR TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
