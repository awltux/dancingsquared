// Sequencer headless test. Run after `npm run build` (tsc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, buildCallVariants, boardAtBeat, formationToXml, parseFormations, parseCallXml, parseMoves, buildCall, normalizeInstance, faceInOutStates } from '../dist/index.js';
import { roleUniformMotions, segsEqual } from '../dist/sequencer/matcher.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

// Extract just the <tam> blocks whose title matches, so a call with several
// setups (e.g. Heads/Sides Pass Thru) doesn't pollute a name's variant list.
const filterTam = (p, title) => {
  const xml = read(p);
  const blocks = xml.match(/<tam\b[\s\S]*?<\/tam>/g) || [];
  const kept = blocks.filter((b) => new RegExp(`title="${title}"`).test(b));
  return '<calls>\n' + kept.join('\n') + '\n</calls>';
};

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
// Used by the witness chains below: report a refusal as a FAILED check instead of throwing, so a
// broken premise shows up as a named failure rather than a stack trace.
const fail = (msg) => {
  console.log('  FAIL ' + msg);
  failures++;
};

const movesXml = read('../../assets/moves.xml');
const formationsXml = read('../../assets/formations.xml');
const ms = (name) => read(`../../assets/ms/${name}.xml`);

const seq = new Sequencer(movesXml, formationsXml, [
  { name: 'Allemande Left', xml: ms('allemande') },
  { name: 'Swing Thru', xml: ms('swing_thru') },
  { name: 'Promenade', xml: ms('promenade') },
  { name: 'Circle Left', xml: ms('circle') },
  { name: 'Heads Spin the Top', xml: ms('spin_the_top') },
  { name: 'Double Pass Thru', xml: ms('double_pass_thru') },
  { name: 'Heads Pass Thru', xml: filterTam('../../assets/ms/pass_thru.xml', 'Heads Pass Thru') },
]);

console.log('== Sequencer: start ==');
check(seq.board.dancers.length === 8, 'starts with 8 dancers');
check(['Squared Set', 'Static Square'].includes(seq.recognize(seq.board).name), `start recognized as a squared set: ${seq.recognize(seq.board).name}`);

console.log('== Sequencer: legalNext from Squared Set ==');
const legal = seq.legalNext();
check(legal.includes('Allemande Left'), `legalNext includes Allemande Left: [${legal.join(', ')}]`);

console.log('== Sequencer: apply a legal call (Allemande Left) ==');
const startBoard = seq.startBoard();
const step = seq.apply('Allemande Left');
check(step.legal === true, 'Allemande Left is legal from Squared Set');
const changed = step.board.dancers.filter((d, i) => {
  const s = startBoard.dancers[i];
  return Math.hypot(d.x - s.x, d.y - s.y) > 0.01 || Math.abs(d.heading - s.heading) > 0.01;
}).length;
check(changed >= 4, `dancers changed (position or facing): ${changed}`);

console.log('== Sequencer: illegal call (Swing Thru from Squared Set) ==');
seq.reset();
const step2r = seq.apply('Swing Thru');
check(step2r.legal === false, 'Swing Thru is NOT legal from Squared Set');

console.log('== Sequencer: identity + FASR ==');
const fasr = seq.fasr();
check(fasr.arrangement.includes('4 couples'), `arrangement: ${fasr.arrangement}`);
check(Object.keys(fasr.relationship).length === 8, 'FASR relationships for all 8 dancers');
const p1 = fasr.relationship[1];
check(p1.partner != null && p1.corner != null, `dancer 1: partner=${p1.partner} corner=${p1.corner}`);

console.log('== Sequencer: getout (bounded) ==');
seq.reset();
const g = seq.getout({ maxCalls: 2 });
check(Array.isArray(g) || g === null, `getout returns a path or null: ${g ? g.join(' > ') : 'null'}`);

console.log('== Sequencer: re-base must not rotate the set (Circle Left -> Allemande Left) ==');
seq.reset();
const cr = seq.apply('Circle Left');
const al = seq.apply('Allemande Left');
// Dancer identities stay with the dancers; the couples must keep their home
// orientation (couple 3 north, couple 1 south) rather than flipping 180 deg
// because the matcher chose an arbitrary rotation of the symmetric squared set.
const byId = Object.fromEntries(al.board.dancers.map((d) => [d.id, d]));
const c3north = byId[1].y > 0 && byId[2].y > 0;
const c1south = byId[5].y < 0 && byId[6].y < 0;
const c2east = byId[3].x > 0 && byId[4].x > 0;
const c4west = byId[7].x < 0 && byId[8].x < 0;
check(cr.legal, 'Circle Left legal from home');
check(al.legal, 'Allemande Left legal after Circle Left');
check(c3north && c1south && c2east && c4west, `re-base keeps home couple orientation (c3 north=${c3north}, c1 south=${c1south}, c2 east=${c2east}, c4 west=${c4west})`);

console.log('== Sequencer: re-base must not rotate the set (Heads Spin the Top -> Double Pass Thru) ==');
seq.reset();
const hst = seq.apply('Heads Spin the Top');
const dpt = seq.apply('Double Pass Thru');
// After Heads Spin the Top the set is a Quarter Tag facing either N-S
// (headings ~+/-90) or E-W (headings ~0/180) depending on the authored setup.
// Re-basing onto Double Pass Thru's canonical setup must PRESERVE that facing,
// not spin the set 90 deg (a N-S set must stay N-S, an E-W set must stay E-W).
check(hst.legal, 'Heads Spin the Top legal from home');
check(dpt.legal, 'Double Pass Thru legal after Heads Spin the Top');
const facingMode = (b) => {
  const degs = b.dancers.map((d) => {
    const deg = (d.heading * 180) / Math.PI;
    return ((deg % 360) + 360) % 360; // normalize to [0,360)
  });
  // all headings must be within 30 deg of the 0/180 axis (E-W) or the 90/270
  // axis (N-S). Compute which axis each heading is on, then require a single axis.
  const offAxis = (a) => Math.min(a % 180, 180 - (a % 180));
  const modes = degs.map((a) => (offAxis(a) < 30 ? 0 : offAxis(a - 90) < 30 ? 90 : -1));
  return modes.every((m) => m === modes[0]) && modes[0] !== -1 ? modes[0] : -1;
};
const hstMode = facingMode(hst.board);
check(hstMode === 90 || hstMode === 0, `Heads Spin the Top ends in a coherent NS/EW facing (mode=${hstMode})`);
const dptMode = facingMode(dpt.board);
check(dptMode === hstMode, `re-base keeps the set facing (${hstMode === 90 ? 'N-S' : 'E-W'}, no 90deg flip): ${dpt.board.dancers.map((d) => (d.heading * 180 / Math.PI).toFixed(0)).join(', ')}`);

console.log('== Sequencer: Heads calls act on HOME heads after the set rotates ==');
seq.reset();
// Rotate the home square 90deg CCW (positions + headings), keeping identities,
// so the original heads are no longer at the N/S slots. A "Heads X" call must
// still target those original heads, not whoever now stands at N/S.
const rotP = (x, y, hDeg, deg) => { const r = deg * Math.PI / 180; return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r), h: hDeg + deg }; };
const rotated = seq.startBoard().dancers.map((d) => {
  const p = rotP(d.x, d.y, d.heading * 180 / Math.PI, 90);
  return { ...d, x: Math.round(p.x), y: Math.round(p.y), heading: p.h * Math.PI / 180 };
});
const rHPT = seq.applyToBoard({ dancers: rotated }, 'Heads Pass Thru');
const startR = Object.fromEntries(rotated.map((d) => [d.id, d]));
const movedIds = rHPT.board.dancers.filter((d) => Math.hypot(d.x - startR[d.id].x, d.y - startR[d.id].y) > 0.01)
  .map((d) => d.id).sort((a, b) => a - b);
const expectedHeads = rotated.filter((d) => d.couple % 2 === 1).map((d) => d.id).sort((a, b) => a - b);
check(JSON.stringify(movedIds) === JSON.stringify(expectedHeads),
  `Heads Pass Thru on a rotated square moves the ORIGINAL heads (moved=[${movedIds}], expect=[${expectedHeads}])`);

console.log('== Sequencer: a REFLECTED match must mirror the MOTION, not just the position ==');
// `applyWholeBoard` expresses each dancer's displacement in that dancer's own frame and turns it
// back out by their heading. That is a rotation, and it was applied even when the variant->board
// transform was a REFLECTION - so the motion kept its unmirrored handedness and went the wrong way
// round. The lateral component is the giveaway: a `Hinge` is a pivot about the joined hands, so each
// mini-wave must END 2 apart (one step round), not spread. This call is a good witness because the
// matcher reaches the board through a REFLECTION (`Left-Hand Waves` onto a right-hand wave at error
// 0.000), every dancer has a lateral component, and the wrong answer is loud: the pairs went from 2
// to 4.47 apart and the board stopped being a formation at all.
const hingeSeq = new Sequencer(movesXml, formationsXml, [{ name: 'Single Hinge', xml: ms('hinge') }]);
const waveBoard = hingeSeq.boardForFormation('Ocean Waves');
const hingeMatch = hingeSeq.matcher.findMatchingVariant(waveBoard, 'Single Hinge', 1.5);
check(!!hingeMatch && hingeMatch.reflect === true,
  `the witness is a REFLECTED match (from="${hingeMatch?.variant.from}", reflect=${hingeMatch?.reflect}) - if this stops being true the gate below is vacuous`);
const hinge = hingeSeq.applyToBoard(waveBoard, 'Single Hinge');
check(hinge.legal === true, 'Single Hinge is legal on an Ocean Waves board');
check(hingeSeq.knownFormation(hinge.board) !== null,
  `the result is still a formation: ${hingeSeq.knownFormation(hinge.board) ?? '(unnamed)'}`);
// A pivot moves each dancer round their joined hands, so the set may ROTATE but it must not GROW.
// Its greatest pairwise distance is the sharpest form of that: 7.21 before the call, 7.21 after,
// and 8.94 / 10.00 when the motion is not mirrored (each mini-wave's two dancers are pushed apart
// along the unmirrored diagonal instead of round the handhold). The pairing that the call acts
// within cannot be read off the geometry - in a wave, POSITION-adjacent dancers are also 2 apart -
// so the extent is the invariant used here, and `knownFormation` above is the second half.
const extent = (b) => {
  let m = 0;
  for (let i = 0; i < b.dancers.length; i++)
    for (let j = i + 1; j < b.dancers.length; j++)
      m = Math.max(m, Math.hypot(b.dancers[i].x - b.dancers[j].x, b.dancers[i].y - b.dancers[j].y));
  return m;
};
check(Math.abs(extent(hinge.board) - extent(waveBoard)) < 0.01,
  `the pivot rotates the set without growing it (extent ${extent(waveBoard).toFixed(2)} -> ${extent(hinge.board).toFixed(2)})`);

console.log('== Sequencer: a sequence that cannot be played says WHERE it stops ==');
// `evaluateSequence` returns the board BEFORE a step it cannot walk, and `sequenceBeats` charges a
// catalogue step 0 beats and moves on - so a sequence whose LAST call cannot be played reports a total
// that excludes that call and an end board that is that call's START board, with nothing saying why.
// A POC report ("the last frame jumps the board back to the previous formation") is this: ceder-7046
// replayed from home has `Right and Left Grand` refused on the T-Bone its chain reaches, so it plays
// 33.5 beats and ends on that T-Bone, while from its own `Zero Line` start the same call applies and
// it plays 35 and ends on the ring. `sequenceStop` is the missing half of that contract.
{
  const home = seq.boardForFormation('Static Square');
  const flat = ['Circle Left', 'Swing Thru'];
  const beats = seq.sequenceBeats(flat, home);
  const stop = seq.sequenceStop(flat, home);
  const end = seq.evaluateSequence(flat, beats, home).board;
  const same = (a, b) => a.dancers.length === b.dancers.length && a.dancers.every((d) => {
    const o = b.dancers.find((x) => x.id === d.id);
    return o && Math.abs(o.x - d.x) < 1e-9 && Math.abs(o.y - d.y) < 1e-9 && Math.abs(o.heading - d.heading) < 1e-9;
  });
  check(stop !== null && stop.index === 1 && stop.call === 'Swing Thru',
    `a call that cannot be danced is reported: ${stop ? `index ${stop.index}, "${stop.call}"` : 'no stop reported'}`);
  check(stop !== null && same(stop.board, end),
    'the board it reports is the board the animation actually ends on (that call\'s own start board)');
  check(seq.sequenceStop(['Circle Left'], home) === null,
    'a sequence that plays all the way reports NO stop');
}

console.log('== Sequencer: Face In / Face Out is a QUARTER TURN, not "point at the centre" ==');
// CALLERLAB, verbatim: "Face In: Each individual turns in place 90 degrees, turning toward the center
// of the set." / "Face Out: ... turning away from the center of the set."
//
// The engine used to aim each dancer at the centre's EXACT bearing instead, which is not a quarter
// turn and puts a dancer on a diagonal wherever its position is not axis-aligned with the centre.
// MEASURED on `figm92`: from a Completed Double Pass Thru, `Tag the Line, Face In` produced headings
// of -108/-135/-45 degrees, the set came off the 90-degree grid, and the `Star Thru` after it
// collapsed two dancers to 0.32 apart. The two properties below are what a pivot must have, and the
// second one is what caught it: the headings stay on the grid.
{
  const QUARTER = Math.PI / 2;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const onGrid = (h) => Math.abs(h - Math.round(h / QUARTER) * QUARTER) < 1e-6;
  const cdpd = seq.boardForFormation('Completed Double Pass Thru');
  check(!!cdpd, 'the witness board exists: a Completed Double Pass Thru');
  for (const [call, toward] of [['Face In', true], ['Face Out', false]]) {
    const r = seq.applyToBoard(cdpd, call);
    check(r.legal === true, `${call} is legal on the witness board`);
    const cx = r.board.dancers.reduce((s, d) => s + d.x, 0) / r.board.dancers.length;
    const cy = r.board.dancers.reduce((s, d) => s + d.y, 0) / r.board.dancers.length;
    let grid = 0, quarter = 0, sense = 0;
    for (const before of cdpd.dancers) {
      const after = r.board.dancers.find((d) => d.id === before.id);
      if (onGrid(after.heading)) grid++;
      const turn = norm(after.heading - before.heading);
      if (Math.abs(Math.abs(turn) - QUARTER) < 1e-6) quarter++;
      // the sense: the signed angle from the old facing to the centre must match the turn's sign
      const toCentre = norm(Math.atan2(cy - before.y, cx - before.x) - before.heading);
      if (Math.sign(turn) === Math.sign(toward ? toCentre : -toCentre)) sense++;
    }
    const n = cdpd.dancers.length;
    check(grid === n, `${call} leaves every heading on the 90-degree grid (${grid}/${n})`);
    check(quarter === n, `${call} is a quarter turn for every dancer (${quarter}/${n})`);
    check(sense === n, `${call} turns ${toward ? 'toward' : 'away from'} the centre for every dancer (${sense}/${n})`);
  }
  // ...and the SHAPE it lands on, which is CALLERLAB's own worked note: "From General Lines, Tag the
  // Line, Face In (or Face Out) ends in Facing Lines (or Lines Back-to-Back)." Stated the way that
  // does not depend on which axis the template happens to be drawn on: after `Face In` every dancer
  // faces INWARD (its facing has a positive component toward the set centre) and after `Face Out`
  // every dancer faces outward.
  for (const [call, toward] of [['Face In', true], ['Face Out', false]]) {
    const r = seq.applyToBoard(cdpd, call);
    const cx = r.board.dancers.reduce((s, d) => s + d.x, 0) / r.board.dancers.length;
    const cy = r.board.dancers.reduce((s, d) => s + d.y, 0) / r.board.dancers.length;
    const facingInward = r.board.dancers.filter((d) => {
      const inward = Math.hypot(cx - d.x, cy - d.y);
      if (inward < 1e-9) return true;
      const dot = Math.cos(d.heading) * ((cx - d.x) / inward) + Math.sin(d.heading) * ((cy - d.y) / inward);
      return toward ? dot > 0 : dot < 0;
    }).length;
    const n = r.board.dancers.length;
    check(facingInward === n, `${call} leaves every dancer facing ${toward ? 'inward' : 'outward'} (${facingInward}/${n}) — Facing Lines / Lines Back-to-Back`);
  }
  // AND THE TURN STOPS AT THE FIRST 90-DEGREE FACING IT CROSSES. Asked for as: "turn 90 deg towards the
  // origin ... but stop turning if they reach adjacent to the axis before they turn 90 deg ... this
  // refinement is for dancers not starting from square, e.g. after a `dosado your corner`."
  //
  // The order of these two checks is the point, and the SECOND is the negative control for the first: the
  // plausible wrong implementation is a `>=` on "have I reached a grid facing", which stops EVERY dancer
  // where it stands and turns `Face In` on a squared set into a call that does nothing.
  {
    const D = Math.PI / 180;
    const isGrid = (h) => Math.abs(h / QUARTER - Math.round(h / QUARTER)) < 1e-6;
    const turned = (from, to) => ((to - from) / D + 540) % 360 - 180;
    // A synthetic two-dancer set so the centre is the origin and the start facing is the only variable.
    const pair = (heading) => [
      { id: 1, x: 3, y: 1, heading },
      { id: 2, x: -3, y: -1, heading: 0 },
    ];
    const OFF_GRID = [
      [30 * D, 90 * D], [200 * D, 180 * D], [350 * D, 270 * D],
    ];
    let capped = 0, gridEnd = 0;
    for (const [from, want] of OFF_GRID) {
      const [end] = faceInOutStates(pair(from), true);
      if (Math.abs(norm(end.heading - want)) < 1e-9) capped++;
      if (isGrid(end.heading)) gridEnd++;
      check(Math.abs(turned(from, end.heading)) <= 90 + 1e-9,
        `an off-grid facing (${(from / D).toFixed(0)}°) turns at most a quarter — measured ${turned(from, end.heading).toFixed(1)}°`);
    }
    check(capped === OFF_GRID.length, `every off-grid facing stops at the first 90° direction in its sweep (${capped}/${OFF_GRID.length})`);
    check(gridEnd === OFF_GRID.length, `and every one of them ends grid-aligned (${gridEnd}/${OFF_GRID.length})`);
    // THE NEGATIVE CONTROL, stated as the PROPERTY and not as a copy of the rule: a grid dancer's sweep
    // contains no OTHER grid facing, so it takes a full quarter turn. A `>=` in `firstGridFacing` would
    // stop it where it stands, and this is the one check that catches that - the three above it only look
    // at off-grid starts, and the boards further up are unchanged by either implementation.
    let fullQuarter = 0;
    for (const h of [0, QUARTER, Math.PI, -QUARTER]) {
      const [end] = faceInOutStates(pair(h), true);
      if (Math.abs(Math.abs(turned(h, end.heading)) - 90) < 1e-9) fullQuarter++;
    }
    check(fullQuarter === 4, `a dancer already ON the grid still turns a FULL quarter, not a stop where it stands (${fullQuarter}/4)`);

    // AND A FACING A RESIDUE OFF THE GRID IS TREATED AS ON IT. That band was EMPTY here: `OFF_GRID` above
    // starts at 30 degrees, so nothing tested the 0-to-15 range the corpus actually authors - which is how
    // `Heads Circle Four Left Full` followed by `Heads Face In` came to turn every head by a hundredth of a
    // degree and nothing else (reported as "only the Girls face in", on the variant that leaves 0.54 and
    // 0.69 degrees). The corpus DOES NOT CLOSE ON THE GRID EXACTLY: a census of every authored heading the
    // engine registers - 80452 headings over 2209 titles, each tam's own start and end - finds 78265 exactly
    // on the grid, then 869 in [0,1), 147 in [1,2), 20 in [2,3), 12 in [3,4), one at 6.521, and NOTHING
    // again until 15.876. The list below is that residue population, worst last.
    {
      const D = Math.PI / 180;
      const isGrid = (h) => Math.abs(h / QUARTER - Math.round(h / QUARTER)) < 1e-6;
      const turned = (from, to) => ((to - from) / D + 540) % 360 - 180;
      const pair = (heading) => [
        { id: 1, x: 3, y: 1, heading },
        { id: 2, x: -3, y: -1, heading: 0 },
      ];
      const RESIDUE = [0.01, 0.54, 0.69, 0.94, 1.998, 2.564, 3.502, 6.521];
      let full = 0, aligned = 0;
      for (const r of RESIDUE) {
        const [end] = faceInOutStates(pair(r * D), true);
        // A QUARTER TURN FROM THE GRID IT SNAPPED TO, so the heading change is 90 plus or minus the residue
        // it started with (90.01 at one end, 96.5 at the other). The assertion is therefore "a real quarter,
        // not the residue" - which is exactly the distinction the defect turned on: with the band at zero
        // these dancers turn by the residue itself, 0.01 to 6.5 degrees, and this check is what separates
        // that from a quarter turn.
        if (Math.abs(turned(r * D, end.heading)) > 89) full++;
        if (isGrid(end.heading)) aligned++;
      }
      check(full === RESIDUE.length, `a facing a residue off the grid still turns a FULL quarter (${full}/${RESIDUE.length}) - the cap must not fire at the start of its own sweep`);
      check(aligned === RESIDUE.length, `and every one of them lands grid-aligned (${aligned}/${RESIDUE.length}), so the residue does not survive into the board`);

      // THE CONTROL SIZES THE BAND FROM ABOVE, and it is the smallest DELIBERATE off-grid facing the corpus
      // authors: `Single File Promenade` at 15.876 degrees. The band must not reach it, or its own cap is
      // skipped and it turns PAST a quarter - which is the `<= 90` assertion the loop above this block makes
      // for every off-grid start, and the reason the band is 10 degrees rather than "anything under 45".
      const DELIBERATE = 15.876;
      const [end] = faceInOutStates(pair(DELIBERATE * D), true);
      const t = turned(DELIBERATE * D, end.heading);
      check(Math.abs(t) <= 90 + 1e-9, `the smallest DELIBERATE off-grid facing the corpus authors (${DELIBERATE}°) still turns at most a quarter (measured ${t.toFixed(3)}°) - the band does not reach it`);
      check(Math.abs(t + DELIBERATE) < 1e-6, `and it still stops at the first grid facing in its sweep, at 0° (measured ${t.toFixed(3)}°)`);
    }
  }
}

console.log('== Sequencer: a SCOPED catalogue call falls back to its generic reading ==');
// "Heads Pass Thru" is BOTH a selection prefix and a catalogue title, so it takes the whole-board
// path on the reasoning that the catalogue's own scoped tam knows best. It does - when it covers the
// board. The shipped scoped tams are authored for a SQUARED SET (heads pass thru, sides wait), so on
// any other arrangement the whole-board reading fails and the call used to be refused even though
// the generic reading is perfectly well defined: gather the named four and apply the BASE call.
// MEASURED in the census's EXACT bucket - the five cases where a same-size setup overlays the
// board's positions AND facings at error 0.000 and the call is still refused - `figm174 Heads Pass
// Thru` and `figm224 Sides Pass Thru`, both from a Double Pass Thru.
const scopedSeq = new Sequencer(movesXml, formationsXml, callsByTitle(path.resolve(__dirname, '../../assets')));
const dptBoard = scopedSeq.applyToBoard(scopedSeq.boardForFormation('Static Square'), 'Heads Star Thru');
check(dptBoard.legal && scopedSeq.knownFormation(dptBoard.board) === 'Double Pass Thru',
  `the witness board is a Double Pass Thru: ${scopedSeq.knownFormation(dptBoard.board) ?? '(unnamed)'}`);
const scopedWhole = scopedSeq.matcher.findMatchingVariant(dptBoard.board, 'Heads Pass Thru', 1.5);
check(scopedWhole === null,
  'the scoped tam alone does NOT cover that board (so the gate below is about the fallback)');
const hpt = scopedSeq.applyToBoard(dptBoard.board, 'Heads Pass Thru');
check(hpt.legal === true, `Heads Pass Thru is legal through the generic reading: ${hpt.reason ?? 'ok'}`);
const beforeH = Object.fromEntries(dptBoard.board.dancers.map((d) => [d.id, d]));
const movedH = hpt.board.dancers.filter((d) => Math.hypot(d.x - beforeH[d.id].x, d.y - beforeH[d.id].y) > 0.01).map((d) => d.id).sort((a, b) => a - b);
const headsH = dptBoard.board.dancers.filter((d) => d.couple % 2 === 1).map((d) => d.id).sort((a, b) => a - b);
check(JSON.stringify(movedH) === JSON.stringify(headsH),
  `only the named four move (moved=[${movedH}], heads=[${headsH}])`);

console.log('== Sequencer: Fold is DERIVED, so it folds the dancers the CALL names ==');
// `Fold`/`Cross Fold` were the last of the "catalogue has only a DEMONSTRATION" family after Run and
// Trade. `ms/fold.xml` marks both `Boys Fold` tams and both `Girls Fold` tams `sequencer="no"`
// because Taminations implements the call in code, and the engine matches `sequencer="no"` variants
// on purpose (filtering them was measured as a change for the worse) - so a demonstration was being
// matched as an ordinary setup. That is a DESIGNATION-BLIND match, and the measurement is loud:
//
//   `Boys Fold` from this wave matched `from="Ocean Waves"` at error 0.000 with reflect=true and
//   folded dancers 2, 4, 6 and 8 - on this board, the four GIRLS - pushing them 4 to 6 units and
//   leaving the board unnamed.
//
// The witness is figm30's own board, replayed rather than hardcoded, so the gate exercises the
// arrangement the corpus actually produced.
{
  let wb = scopedSeq.boardForFormation('Static Square');
  const chain = ['Heads Promenade 1/2', 'Heads Pass the Ocean', 'Extend', 'Swing Thru', 'Boys Run', '1/2 Tag', 'Scoot Back'];
  let chainOk = true;
  for (const c of chain) {
    const r = scopedSeq.applyToBoard(wb, c);
    if (!r.legal) { chainOk = false; console.log(`        witness chain broke at ${c}: ${r.reason}`); break; }
    wb = r.board;
  }
  check(chainOk && scopedSeq.knownFormation(wb) === 'Ocean Waves',
    `the witness board is the Ocean Waves board figm30 folds on (${scopedSeq.knownFormation(wb) ?? '(unnamed)'})`);

  const beforeF = Object.fromEntries(wb.dancers.map((d) => [d.id, d]));
  const f = scopedSeq.applyToBoard(wb, 'Boys Fold');
  check(f.legal === true, `Boys Fold is legal on it: ${f.reason ?? 'ok'}`);
  const movedF = f.board.dancers.filter((d) => Math.hypot(d.x - beforeF[d.id].x, d.y - beforeF[d.id].y) > 0.01)
    .map((d) => d.id).sort((a, b) => a - b);
  const boysF = wb.dancers.filter((d) => d.gender === 'boy').map((d) => d.id).sort((a, b) => a - b);
  check(JSON.stringify(movedF) === JSON.stringify(boysF),
    `Boys Fold moves the four BOYS and nobody else (moved=[${movedF}], boys=[${boysF}]) - the catalogue's demo moved [2,4,6,8], the four girls here`);
  // The fold is "1.5 forward and `dist` toward the dancer folded in front of, facing back": on this
  // wave the adjacent dancer is 2 away, so every folder ends hypot(1.5, 2) = 2.5 from its start and
  // 180 degrees round. The heading half is what distinguishes a fold from a sidestep.
  const foldDists = movedF.map((id) => Math.hypot(f.board.dancers.find((d) => d.id === id).x - beforeF[id].x, f.board.dancers.find((d) => d.id === id).y - beforeF[id].y));
  const worstDist = Math.max(...foldDists.map((v) => Math.abs(v - Math.hypot(1.5, 2))));
  check(worstDist < 1e-6,
    `every folder moves 1.5 forward and 2 toward the dancer beside it (worst error ${worstDist.toFixed(4)}, max ${Math.max(...foldDists).toFixed(4)})`);
  const worstTurn = Math.max(...movedF.map((id) => {
    const d = f.board.dancers.find((x) => x.id === id);
    let dh = (d.heading - beforeF[id].heading) * 180 / Math.PI % 360;
    if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    return Math.abs(Math.abs(dh) - 180);
  }));
  check(worstTurn < 1e-6, `every folder ends facing back the way it came (worst departure from 180 deg: ${worstTurn.toFixed(4)})`);
  // A fold must not put two dancers on one spot - the demo's large displacements are how the
  // collision this class of bug produces would show up.
  let minPair = Infinity;
  for (let i = 0; i < f.board.dancers.length; i++)
    for (let j = i + 1; j < f.board.dancers.length; j++)
      minPair = Math.min(minPair, Math.hypot(f.board.dancers[i].x - f.board.dancers[j].x, f.board.dancers[i].y - f.board.dancers[j].y));
  check(minPair > 1.0, `no two dancers collide after the fold (closest pair ${minPair.toFixed(3)})`);

  // `Fold` on its own names no group - CALLERLAB's command examples are all designated and
  // `Everyone Fold` is documented as a GIMMICK - so the bare name must refuse rather than guess.
  const bareFold = scopedSeq.applyToBoard(wb, 'Fold');
  check(bareFold.legal === false && /no whole-set reading/.test(bareFold.reason ?? ''),
    `bare Fold refuses with its own reason: ${bareFold.reason ?? 'IT WAS LEGAL'}`);

  // CROSS FOLD is the same rule with the SECOND dancer on the side, so on a line of four the lateral
  // displacement is two positions (4) where Fold's is one (2). That ratio is the whole distinction
  // between the two calls, so it is asserted rather than assumed.
  const lines = scopedSeq.boardForFormation('Normal Lines');
  const lat = (startBoardIn, endBoard, id) => {
    const s = startBoardIn.dancers.find((d) => d.id === id);
    const e = endBoard.dancers.find((d) => d.id === id);
    return -((e.x - s.x) * Math.sin(s.heading)) + ((e.y - s.y) * Math.cos(s.heading));
  };
  const eFold = scopedSeq.applyToBoard(lines, 'Ends Fold');
  const eCross = scopedSeq.applyToBoard(lines, 'Ends Cross Fold');
  check(eFold.legal && eCross.legal, `Ends Fold and Ends Cross Fold are both legal from Normal Lines (${eFold.reason ?? 'ok'} / ${eCross.reason ?? 'ok'})`);
  const endsMoved = (r) => r.board.dancers.filter((d) => Math.hypot(d.x - lines.dancers.find((s) => s.id === d.id).x, d.y - lines.dancers.find((s) => s.id === d.id).y) > 0.01).map((d) => d.id);
  const lit = (r) => Math.max(...endsMoved(r).map((id) => Math.abs(lat(lines, r.board, id))));
  check(Math.abs(lit(eFold) - 2) < 1e-6 && Math.abs(lit(eCross) - 4) < 1e-6,
    `Fold goes around ONE dancer position and Cross Fold passes one and takes the next (lateral ${lit(eFold).toFixed(2)} vs ${lit(eCross).toFixed(2)})`);
}

console.log('== Sequencer: leaders / trailers are a PARITY per dancer, not a pairing ==');
// The previous rule bucketed dancers by heading axis (0 or 180 only), sorted each bucket by X, and
// emitted sorted[i] for EVERY i - so four dancers in one bucket produced THREE leaders, and a
// tandem travelling north/south could not be seen at all. MEASURED on `Leaders Trade` from a
// Completed Double Pass Thru: the engine designated SIX dancers ([2,3,4,5,7,8]) where the call has
// four ([1,4,5,8]) and refused with "no other designated dancer is beside (-1.0,1.0)", naming the
// wrong dancer. Four published figures stop on that call. The replacement is the reference's own
// per-dancer count (`call_context.dart` `analyze()`): leader when the dancers directly ahead are
// EVEN in number and those directly behind are ODD, trailer when that is reversed.
{
  const cdpt = scopedSeq.boardForFormation('Completed Double Pass Thru');
  const groups = scopedSeq.subsetOf(cdpt, 'leaders');
  const leaders = groups ? groups.flat().sort((a, b) => a - b) : [];
  check(leaders.length === 4,
    `a Completed Double Pass Thru has FOUR leaders, not ${leaders.length} ([${leaders.join(',')}])`);
  const lt = scopedSeq.applyToBoard(cdpt, 'Leaders Trade');
  check(lt.legal === true, `Leaders Trade is legal from a Completed Double Pass Thru: ${lt.reason ?? 'ok'}`);
  const beforeL = Object.fromEntries(cdpt.dancers.map((d) => [d.id, d]));
  const movedL = lt.board.dancers.filter((d) => Math.hypot(d.x - beforeL[d.id].x, d.y - beforeL[d.id].y) > 0.01)
    .map((d) => d.id).sort((a, b) => a - b);
  check(JSON.stringify(movedL) === JSON.stringify(leaders),
    `only the designated leaders move (moved=[${movedL}], leaders=[${leaders}])`);
  check(scopedSeq.knownFormation(lt.board) !== null,
    `the board is still a formation after the trade: ${scopedSeq.knownFormation(lt.board) ?? '(unnamed)'}`);

  // The old rule sorted by X, so it could only ever see a tandem that ran along X. Rotating the same
  // board a quarter turn keeps every relation that matters and changes only the axis, which is
  // exactly what the old rule got wrong - so this witness is the regression, not a variation.
  const rot90 = { dancers: cdpt.dancers.map((d) => { const p = rotP(d.x, d.y, d.heading * 180 / Math.PI, 90); return { ...d, x: p.x, y: p.y, heading: p.h * Math.PI / 180 }; }) };
  const rotGroups = scopedSeq.subsetOf(rot90, 'leaders');
  const rotLeaders = rotGroups ? rotGroups.flat().sort((a, b) => a - b) : [];
  const rotLt = scopedSeq.applyToBoard(rot90, 'Leaders Trade');
  check(rotLeaders.length === 4 && rotLt.legal === true,
    `the same board rotated a quarter turn still names four leaders and is still tradeable (leaders=[${rotLeaders.join(',')}], ${rotLt.reason ?? 'ok'})`);
}

console.log('== Sequencer: Sweep a Quarter acts PER BOX and reads the direction per box ==');
// CALLERLAB: "Starting formation: Facing Couples ONLY ... Circle Right or Left 1/4, except that each
// Couple does not join hands with the Couple they are facing. The circling direction continues the
// motion that completed the previous call." So this is not a whole-board transform and not a
// selection either - it is one rotation per facing-couple BOX - and the three witnesses below pin the
// three ways it can go wrong: a box rotated the wrong way, a box with no consensus direction being
// approximated anyway, and a board that is not boxes at all being forced into some.
{
  const box = (dir) => ({
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -1, y: 1, heading: 0, lastTurnDir: dir },
      { id: 2, couple: 1, gender: 'girl', x: -1, y: -1, heading: 0, lastTurnDir: dir },
      { id: 3, couple: 2, gender: 'boy', x: 1, y: -1, heading: Math.PI, lastTurnDir: dir },
      { id: 4, couple: 2, gender: 'girl', x: 1, y: 1, heading: Math.PI, lastTurnDir: dir },
    ],
  });

  for (const [dir, deg] of [['left', 90], ['right', -90]]) {
    const start = box(dir);
    const r = scopedSeq.applyToBoard(start, 'Sweep 1/4');
    check(r.legal === true, `Sweep 1/4 is legal on a facing-couple box after a ${dir} turn: ${r.reason ?? 'ok'}`);
    const turn = (deg * Math.PI) / 180;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const worst = Math.max(...start.dancers.map((d) => {
      const e = r.board.dancers.find((x) => x.id === d.id);
      // The box is centred at the origin, so the expectation is a plain rotation of (x, y).
      const ex = d.x * c - d.y * s;
      const ey = d.x * s + d.y * c;
      let dh = ((e.heading - d.heading) * 180) / Math.PI % 360;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      return Math.max(Math.hypot(e.x - ex, e.y - ey), Math.abs(dh - deg) / 90);
    }));
    check(worst < 1e-9,
      `the whole box rotates ${deg} degrees about its own centre, positions and facings together (worst error ${worst.toExponential(1)})`);
  }

  // A mixed box is REFUSED, not approximated - and that is not hypothetical: measured on the corpus,
  // `figm18`'s box after `Flutterwheel` is 3 left / 1 right, and CALLERLAB's own comment says why (a
  // Flutterwheel turns the two dancers of a couple in opposite senses about the COUPLE's centre).
  const mixed = box('left');
  mixed.dancers[2].lastTurnDir = 'right';
  const m = scopedSeq.applyToBoard(mixed, 'Sweep 1/4');
  check(m.legal === false && /must be the same/.test(m.reason ?? ''),
    `a box whose dancers disagree is REFUSED with its own reason: ${m.reason ?? 'IT WAS LEGAL'}`);
  const none = box(undefined);
  const n = scopedSeq.applyToBoard(none, 'Sweep 1/4');
  check(n.legal === false && /not every dancer in this box has one/.test(n.reason ?? ''),
    `a box with no remembered turn is refused too: ${n.reason ?? 'IT WAS LEGAL'}`);

  // And a board that is not facing-couple boxes at all is refused rather than forced: four dancers
  // all facing the SAME way is a tandem, which is not the call's starting formation.
  const tandem = {
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -1, y: 1, heading: 0, lastTurnDir: 'left' },
      { id: 2, couple: 1, gender: 'girl', x: -3, y: 1, heading: 0, lastTurnDir: 'left' },
      { id: 3, couple: 2, gender: 'boy', x: 1, y: 1, heading: 0, lastTurnDir: 'left' },
      { id: 4, couple: 2, gender: 'girl', x: 3, y: 1, heading: 0, lastTurnDir: 'left' },
    ],
  };
  const t = scopedSeq.applyToBoard(tandem, 'Sweep 1/4');
  check(t.legal === false && /divide into facing-couple boxes/.test(t.reason ?? ''),
    `a board that is not facing couples is refused, not forced: ${t.reason ?? 'IT WAS LEGAL'}`);
}

console.log('== Sequencer: Box the Gnat ends in the SAME box at every authored separation ==');
// The separation-6 authoring in `ms/box_the_gnat.xml` was EXTRAPOLATED - `x2 = separation / 2 + 1`,
// pinned by the separation-3 and 4 authorings - and the figure count cannot see whether an
// extrapolated motion ends where the definition says ("Ending formation: Facing Dancers"). This can:
// the tam exists at separations 2, 3, 4 and 6, the three older ones are shipped and validated, so a
// new separation is correct exactly when it lands on the SAME end pose they do. Measured before this
// gate existed: all four end at `(+-1, +-1)` with each couple's facing reversed, exactly.
{
  const gnatBox = (s) => ({
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -s / 2, y: 1, heading: 0 },
      { id: 2, couple: 1, gender: 'girl', x: -s / 2, y: -1, heading: 0 },
      { id: 3, couple: 2, gender: 'boy', x: s / 2, y: -1, heading: Math.PI },
      { id: 4, couple: 2, gender: 'girl', x: s / 2, y: 1, heading: Math.PI },
    ],
  });
  const ends = [2, 3, 4, 6].map((s) => {
    const r = scopedSeq.applyToBoard(gnatBox(s), 'Box the Gnat');
    check(r.legal === true, `Box the Gnat is legal on a facing-couple box ${s} apart: ${r.reason ?? 'ok'}`);
    return r.legal ? r.board.dancers.slice().sort((a, b) => a.id - b.id) : null;
  });
  const shape = (ds) => JSON.stringify(ds.map((d) => [d.x.toFixed(2), d.y.toFixed(2), d.heading.toFixed(2)]));
  const allSame = ends.every((e) => e && shape(e) === shape(ends[0]));
  check(allSame,
    `every separation ends in the SAME box (2 apart: ${shape(ends[0])})`);
  // ...and that box is the one the definition names: Facing Dancers, with each couple's facing
  // reversed by the twirl, which is what "the woman turns 360 degrees under his arm" does.
  const [a, b] = [ends[0][0], ends[0][1]];
  check(a.heading === Math.PI && b.heading === Math.PI,
    `the couples end facing the way they came from (headings ${a.heading.toFixed(2)}, ${b.heading.toFixed(2)})`);
}

console.log('== Sequencer: Touch a Quarter ends in the 2x2 right-hand box the definition names ==');
// PHASE A (PLAN.md) HEAD FIX. CALLERLAB: "Touch a Quarter - Starting formation: Facing Dancers only.
// Dance action: In one smooth motion, Step to a Wave and Turn 1/4 by the Right. Ending formation:
// Right-Hand Mini-Wave", plus "When called from Facing Couples, the four dancers do not make a Wave
// midway through Touch a Quarter." The authored facing-couples tams put a stray `scaleY` on ONE of
// their two moves (`Extend Left scaleY=".5"` on one path, `Hinge Right scaleY=".5"` on the other),
// which leaves a residual lateral 0.5 and ends the call in a 2-wide, 3-tall rectangle instead of the
// box. Measured before the fix, at the three authored separations: separation 6 and 3 both ended
// `(+-1, +-1.5)`, and the separation-4 b2 demonstration `(+-1, +-2)`. The net lateral must CANCEL -
// the step to the wave dodges one unit sideways and the hinge brings it back - so neither move may
// be scaled.
{
  const facingCouples = (s) => ({
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -s / 2, y: 1, heading: 0 },
      { id: 2, couple: 1, gender: 'girl', x: -s / 2, y: -1, heading: 0 },
      { id: 3, couple: 2, gender: 'boy', x: s / 2, y: -1, heading: Math.PI },
      { id: 4, couple: 2, gender: 'girl', x: s / 2, y: 1, heading: Math.PI },
    ],
  });
  const shape = (ds) => JSON.stringify(ds.map((d) => [d.x.toFixed(2), d.y.toFixed(2), d.heading.toFixed(2)]));
  const ends = [3, 6].map((s) => {
    const r = scopedSeq.applyToBoard(facingCouples(s), 'Touch a Quarter');
    check(r.legal === true, `Touch a Quarter is legal on facing couples ${s} apart: ${r.reason ?? 'ok'}`);
    return r.legal ? r.board.dancers.slice().sort((a, b) => a.id - b.id) : null;
  });
  check(ends.every((e) => e && shape(e) === shape(ends[0])),
    `separation 3 and 6 end in the SAME pose (3 apart: ${shape(ends[0])})`);
  if (ends[0]) {
    const spots = ends[0].map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`);
    check(new Set(spots).size === 4 && spots.every((s) => /^-?1\.00,-?1\.00$/.test(s)),
      `the four end on the four DISTINCT spots of a 2x2 box (${spots.join(' ')})`);
    // A right-hand box: two right-hand mini-waves, so the paired dancers (1,4) and (2,3) here face
    // OPPOSITE ways, each having turned the same sense ("Turn 1/4 by the Right" is per dancer).
    const byId = new Map(ends[0].map((d) => [d.id, d]));
    const opposite = (a, b) => Math.abs(Math.abs(ends[0].find((d) => d.id === a).heading - byId.get(b).heading) - Math.PI) < 1e-6;
    check(opposite(1, 4) && opposite(2, 3),
      `each mini-wave faces opposite ways (${[1, 2, 3, 4].map((id) => byId.get(id).heading.toFixed(2)).join(' ')})`);
    check([1, 2, 3, 4].every((id) => {
      const before = facingCouples(3).dancers.find((d) => d.id === id);
      return Math.abs(byId.get(id).heading - before.heading + Math.PI / 2) < 1e-6;
    }), 'every dancer turned exactly 1/4 to the RIGHT');
    let min = Infinity;
    for (let i = 0; i < ends[0].length; i++)
      for (let j = i + 1; j < ends[0].length; j++)
        min = Math.min(min, Math.hypot(ends[0][i].x - ends[0][j].x, ends[0][i].y - ends[0][j].y));
    check(min > 0.25, `no two dancers collide (closest pair ${min.toFixed(3)})`);
  }

  // CALLERLAB's OWN WORKED CASE, from the Squared Set Convention: "The active dancers move forward
  // into the center of the set and execute the call. If they end facing the same walls as the
  // inactive dancers, they will remain in the center (for example, 'Heads Square Thru 4', 'Heads
  // Star Thru', 'Heads Touch a Quarter')." The heads of a Static Square are six apart, so this is
  // also the case the seam-6 authoring exists for.
  const sq = scopedSeq.boardForFormation('Static Square');
  const heads = scopedSeq.applyToBoard(sq, 'Heads Touch a Quarter');
  check(heads.legal === true, `Heads Touch a Quarter is legal from a Static Square: ${heads.reason ?? 'ok'}`);
  if (heads.legal) {
    const at = (id) => heads.board.dancers.find((d) => d.id === id);
    const headIds = [1, 2, 5, 6];
    const centres = headIds.every((id) => Math.abs(Math.abs(at(id).x) - 1) < 1e-6 && Math.abs(Math.abs(at(id).y) - 1) < 1e-6);
    check(centres, 'the four heads end on the centre 2x2 box (+-1, +-1)');
    // ... facing the walls the SIDES face (east/west), which is what "remains in the centre" means.
    check(headIds.every((id) => Math.abs(Math.sin(at(id).heading)) < 1e-6),
      'the heads end facing east/west, the same walls the inactive sides face');
    check(headIds.every((id) => Math.abs(Math.cos(at(id).heading)) > 0.99),
      'the heads face along the east/west axis (cos heading +-1)');
    const sides = [3, 4, 7, 8];
    check(sides.every((id) => {
      const before = sq.dancers.find((d) => d.id === id);
      return Math.hypot(at(id).x - before.x, at(id).y - before.y) < 1e-6 && at(id).heading === before.heading;
    }), 'the inactive sides do not move');
  }
}

console.log('== Sequencer: a Sweep whose boxes would COLLIDE is refused, not forced ==');
// A box 2 wide and 4 tall rotating 90 degrees about its own centre becomes 4 wide and 2 tall, so two
// boxes standing side by side along the rotation axis end up on the SAME two spots. `boxGroups`
// cannot see this (each box is fine on its own) and only the whole board can, so the call carries a
// postcondition. This gate exists because the trap was walked into: unblocking the tiling of a
// Normal Lines board by reading CALLERLAB's temporary couple number let the Sweep apply and produced
// four dancers on two spots. The witness below TILES cleanly (each stored couple sits inside one box),
// so it can only be caught by the collision check itself.
{
  const S = -Math.PI / 2;
  const N = Math.PI / 2;
  const boxes = {
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -3, y: 2, heading: S, lastTurnDir: 'left' },
      { id: 2, couple: 1, gender: 'girl', x: -1, y: 2, heading: S, lastTurnDir: 'left' },
      { id: 3, couple: 2, gender: 'boy', x: 1, y: 2, heading: S, lastTurnDir: 'left' },
      { id: 4, couple: 2, gender: 'girl', x: 3, y: 2, heading: S, lastTurnDir: 'left' },
      { id: 5, couple: 3, gender: 'boy', x: -3, y: -2, heading: N, lastTurnDir: 'left' },
      { id: 6, couple: 3, gender: 'girl', x: -1, y: -2, heading: N, lastTurnDir: 'left' },
      { id: 7, couple: 4, gender: 'boy', x: 1, y: -2, heading: N, lastTurnDir: 'left' },
      { id: 8, couple: 4, gender: 'girl', x: 3, y: -2, heading: N, lastTurnDir: 'left' },
    ],
  };
  const r = scopedSeq.applyToBoard(boxes, 'Sweep 1/4');
  check(r.legal === false && /rotate a quarter about its own centre/.test(r.reason ?? ''),
    `Sweep 1/4 refuses a board whose two boxes would land on the same spots: ${r.legal ? 'APPLIED' : r.reason}`);
  // ...and the SAME geometry with the boxes far enough apart is legal, so the check is not just
  // refusing every lines board. Each box is still 2 wide and 4 tall; the two boxes are 6 apart
  // instead of touching, so the sweeps land on (-6,±1)/(-2,±1) and (2,±1)/(6,±1).
  const wide = {
    dancers: boxes.dancers.map((d) => {
      const bx = d.x < 0 ? -1 : 1;
      const near = Math.abs(d.x) === 1; // inner edge of its box
      const x = bx * (near ? 3 : 5);
      return { ...d, x };
    }),
  };
  const rw = scopedSeq.applyToBoard(wide, 'Sweep 1/4');
  check(rw.legal === true, `Sweep 1/4 applies when the boxes are 6 apart: ${rw.reason ?? 'ok'}`);
}

console.log('== Sequencer: Rollaway swaps each couple, at every authored separation ==');
// The separation-2 authoring in `ms/sashay.xml` was ADDED because the corpus reaches `Rollaway` from
// boards whose couples stand two apart (an Eight Chain Thru, a Quarter Tag) while the only
// `Facing Couples` authoring placed them four apart — four figures and a get-out line refused with
// "no setup in this call matches". A Rollaway is a per-couple HALF SASHAY, so the displacement is the
// couple's own width (2) and the same paths must give the SAME end pose at either separation. This
// asserts exactly that, which the figure count cannot see.
{
  const facingCouples = (s) => ({
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -s / 2, y: 1, heading: 0 },
      { id: 2, couple: 1, gender: 'girl', x: -s / 2, y: -1, heading: 0 },
      { id: 3, couple: 2, gender: 'boy', x: s / 2, y: -1, heading: Math.PI },
      { id: 4, couple: 2, gender: 'girl', x: s / 2, y: 1, heading: Math.PI },
    ],
  });
  for (const s of [2, 4]) {
    const b = facingCouples(s);
    const r = scopedSeq.applyToBoard(b, 'Rollaway');
    check(r.legal === true, `Rollaway is legal on facing couples ${s} apart: ${r.reason ?? 'ok'}`);
    if (!r.legal) continue;
    const before = new Map(b.dancers.map((d) => [d.id, d]));
    const after = new Map(r.board.dancers.map((d) => [d.id, d]));
    const swapped = (a, bId) =>
      Math.abs(after.get(a).x - before.get(bId).x) < 1e-6 && Math.abs(after.get(a).y - before.get(bId).y) < 1e-6;
    check(swapped(1, 2) && swapped(2, 1), `${s} apart: couple 1's two dancers exchange places exactly`);
    check(swapped(3, 4) && swapped(4, 3), `${s} apart: couple 2's two dancers exchange places exactly`);
    check([1, 2, 3, 4].every((id) =>
      Math.abs(Math.atan2(
        Math.sin(after.get(id).heading - before.get(id).heading),
        Math.cos(after.get(id).heading - before.get(id).heading),
      )) < 1e-6),
    `${s} apart: every dancer keeps its own facing (${[1, 2, 3, 4].map((id) => `${after.get(id).heading.toFixed(9)}/${before.get(id).heading.toFixed(9)}`).join(' ')})`);
  }
}

console.log('== Sequencer: Do Sa Do is formation-independent, because its authored motion is the identity ==');
// MEASURED on the authored tams: from `Normal Lines` and from an `Eight Chain Thru`, worst position
// change 0.000 and worst heading change 0.00 degrees. So the call is a no-op in the net model and the
// authored setups were only ever limiting WHICH boards it could be reached from - the census's three
// `Do Sa Do` stops are all "no setup matches". The derived rule reproduces the identity exactly and
// extends it; the precondition is the call's own starting formation (Facing Dancers).
{
  const worst = (before, after) => {
    const b = new Map(before.dancers.map((d) => [d.id, d]));
    let pos = 0;
    let ang = 0;
    for (const d of after.dancers) {
      const o = b.get(d.id);
      pos = Math.max(pos, Math.hypot(d.x - o.x, d.y - o.y));
      ang = Math.max(ang, Math.abs(Math.atan2(Math.sin(d.heading - o.heading), Math.cos(d.heading - o.heading))));
    }
    return { pos, ang };
  };
  const lines = scopedSeq.boardForFormation('Normal Lines');
  const r1 = scopedSeq.applyToBoard(lines, 'Do Sa Do');
  check(r1.legal === true, `Do Sa Do is legal from Normal Lines: ${r1.reason ?? 'ok'}`);
  if (r1.legal) {
    const w = worst(lines, r1.board);
    check(w.pos < 1e-9 && w.ang < 1e-9,
      `...and every dancer ends on its own spot facing its own way (${w.pos.toFixed(6)}, ${w.ang.toFixed(6)} rad)`);
  }
  // THE WITNESS THAT MOTIVATED THE DERIVATION: the allemande pose (four facing pairs at the four
  // sides of the set), reached by replaying figm203's chain. NO authored setup covers it.
  let b = scopedSeq.startBoard();
  let chainOk = true;
  for (const call of ['Four Ladies Chain', 'Rollaway', 'Circle Left', 'Allemande Left']) {
    const r = scopedSeq.applyToBoard(b, call);
    if (!r.legal) {
      chainOk = false;
      fail(`Do Sa Do witness chain: "${call}" refused: ${r.reason}`);
      break;
    }
    b = r.board;
  }
  if (chainOk) {
    const r2 = scopedSeq.applyToBoard(b, 'Do Sa Do');
    check(r2.legal === true, `Do Sa Do is legal on the allemande pose every authored setup misses: ${r2.reason ?? 'ok'}`);
    if (r2.legal) {
      const w = worst(b, r2.board);
      check(w.pos < 1e-9 && w.ang < 1e-9, `...and is the identity there too (${w.pos.toFixed(6)}, ${w.ang.toFixed(6)})`);
    }
  }
  // ...and the precondition is the call's STARTING FORMATION, not a formality: a tandem has someone
  // in front but that dancer faces away, so the call is refused. WHICH reason comes back depends on
  // `catalogueFallback`: when the derived rule declines, the authored tams are consulted and their
  // "no setup matches" is the message that surfaces. Either way the call is not danced.
  const tandem = {
    dancers: [
      { id: 1, couple: 1, gender: 'boy', x: -1, y: 1, heading: -Math.PI / 2 },
      { id: 2, couple: 1, gender: 'girl', x: -1, y: -1, heading: -Math.PI / 2 },
    ],
  };
  const r3 = scopedSeq.applyToBoard(tandem, 'Do Sa Do');
  check(r3.legal === false,
    `a tandem is refused (the derived rule declines and the catalogue has no setup): ${r3.legal ? 'APPLIED' : r3.reason}`);
}

console.log('== Sequencer: Allemande Left is legal from its OWN end pose (CALLERLAB\'s own pattern) ==');
// CALLERLAB's command example is literally "Allemande Left Your Corner; Dosado Your Partner;
// Allemande Left Your Corner" (Mainstream definitions, "Allemande Left / Allemande Right"), and Case
// 2's listed starting formations include a Trade By - so a call that cannot follow ITSELF in its own
// documented pattern was missing a setup, not refusing wrongly. MEASURED before the pose tam
// existed: every `Allemande Left` variant returned NULL on that pose even at tolerance 100 with
// gender required, and three census figures stopped there.
//
// The pose arrives in TWO gender arrangements and BOTH must work, because callers run the pattern
// after the couples have progressed: six of the eight slots swap gender after `Four Ladies Chain`.
{
  const al1 = scopedSeq.applyToBoard(scopedSeq.startBoard(), 'Allemande Left');
  check(al1.legal === true, `Allemande Left is legal from a Static Square: ${al1.reason ?? 'ok'}`);
  if (al1.legal) {
    const al2 = scopedSeq.applyToBoard(al1.board, 'Allemande Left');
    check(al2.legal === true, `...and legal again from its OWN end pose: ${al2.reason ?? 'ok'}`);
    // WHAT THE ROUND TRIP HAS TO BE, and the first two answers were both wrong. "The pair returns to
    // the square" was tried and REFUTED: `Weave the Ring` - the call the corpus puts next - carries
    // the POSE as its own authored setup (measured: its dancer angles are the pose's, boys a quarter
    // towards promenade direction and girls the other way, NOT the square's inward facings). And the
    // pose tam's first version applied the square's paths again, turning everyone another quarter
    // onto a board the engine names `Static Facing Out`, which matched nothing.
    // CALLERLAB's own words settle it: "While the dance action of Allemande Left might not cause the
    // dancers to end in precisely this formation, the next call should be given AS IF this were the
    // ending formation" - the ending formation of ANY Allemande Left is the Right and Left Grand
    // Circle, so one called FROM that circle starts and finishes there. The pose tam is therefore a
    // NO-OP, and the property to gate is the one the corpus actually needs.
    if (al2.legal) {
      const before = new Map(al1.board.dancers.map((d) => [d.id, d]));
      const worst = Math.max(...al2.board.dancers.map((d) => {
        const o = before.get(d.id);
        return Math.max(Math.hypot(d.x - o.x, d.y - o.y), Math.abs(Math.atan2(
          Math.sin(d.heading - o.heading), Math.cos(d.heading - o.heading))));
      }));
      check(worst < 1e-6,
        `...and leaves the ring as it found it, because the ring IS the ending formation (worst departure ${worst.toFixed(6)})`);
      const weave = scopedSeq.applyToBoard(al2.board, 'Weave the Ring');
      check(weave.legal === true,
        `...and Weave the Ring - the call the corpus puts next - is legal there: ${weave.reason ?? 'ok'}`);
    }
  }
  // The progressed arrangement, reached by replaying figm167's chain.
  let b = scopedSeq.startBoard();
  let ok = true;
  for (const call of ['Four Ladies Chain', 'Rollaway', 'Circle Left', 'Allemande Left', 'Do Sa Do']) {
    const r = scopedSeq.applyToBoard(b, call);
    if (!r.legal) {
      ok = false;
      fail(`Allemande Left pose (progressed): "${call}" refused: ${r.reason}`);
      break;
    }
    b = r.board;
  }
  if (ok) {
    const r = scopedSeq.applyToBoard(b, 'Allemande Left');
    check(r.legal === true, `...and from the PROGRESSED pose too, where six of the eight slots hold the other gender: ${r.reason ?? 'ok'}`);
    if (r.legal) {
      const weave = scopedSeq.applyToBoard(r.board, 'Weave the Ring');
      check(weave.legal === true, `...and "Weave the Ring" follows it on the progressed board too: ${weave.reason ?? 'ok'}`);
    }
  }
}

console.log('\n== Sequencer: a gender-specific tam\'s path is a ROLE motion, not a slot\'s ==');
// `Heads Rollaway` half-sashays the head couples, so every dancer still faces an opposite-gender
// dancer and `Star Thru` is legal from there - CALLERLAB's own words are "Starting formation -
// facing dancers (man and woman)", which the half-sashayed square satisfies. Slot-wise gender
// matching refused it anyway, because the catalogue's `Static Square` setup pins a boy to the
// south-WEST slot and the rollaway puts him south-EAST. MEASURED: four census figures stopped on
// exactly this (`figm#102`, `figm#185`, `figm#186`, `figm#15`), all with a setup that overlays the
// board at error 0.000 once the gender constraint is off.
{
  // The CALLERLAB outcome a Star Thru must produce: the two dancers end side by side facing the
  // SAME direction with the woman on the man's RIGHT - which is the engine's own canonical result
  // (checked below), so this is the engine's authored convention, not an outside guess.
  //
  // Asserted PER BOY rather than by pairing dancers up, because the pairing is ambiguous: in
  // `Double Pass Thru` a dancer has same-heading neighbours two away in TWO directions, so a greedy
  // "find my partner" check picks a different partner than the engine did and reports a false
  // failure (measured). "The spot two to my right is a girl" needs no pairing at all.
  const allCouplesRight = (label, board) => {
    const boys = board.dancers.filter((d) => d.gender === 'boy');
    check(boys.length === 4, `${label}: the set still holds four boys (${boys.length})`);
    let ok = 0;
    for (const b of boys) {
      const spot = { x: b.x + 2 * Math.sin(b.heading), y: b.y - 2 * Math.cos(b.heading) };
      const mate = board.dancers.find((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < 0.05);
      if (mate && mate.gender === 'girl') ok++;
      else fail(`${label}: the dancer two to the right of boy id${b.id} is ${mate ? mate.gender : 'nobody'}`);
    }
    check(ok === 4, `${label}: the woman is on the man's right in all four couples (${ok}/4)`);
  };

  // THE CONTROL: the canonical arrangement is untouched by the role reading, because the role
  // reading is only tried after the slot-wise reading fails.
  const square = scopedSeq.startBoard();
  const plain = scopedSeq.applyToBoard(square, 'Star Thru');
  check(plain.legal === true, `Star Thru from a plain Static Square still applies: ${plain.reason ?? 'ok'}`);
  if (plain.legal) {
    check(scopedSeq.knownFormation(plain.board) === 'Double Pass Thru',
      `...and is still the canonical Double Pass Thru result: ${scopedSeq.knownFormation(plain.board)}`);
    allCouplesRight('canonical Star Thru', plain.board);
  }

  // THE WITNESS.
  const rolled = scopedSeq.applyToBoard(square, 'Heads Rollaway');
  check(rolled.legal === true, `Heads Rollaway applies: ${rolled.reason ?? 'ok'}`);
  if (rolled.legal) {
    check(scopedSeq.knownFormation(rolled.board) === 'Static Square',
      `...and leaves the set a Static Square: ${scopedSeq.knownFormation(rolled.board)}`);
    const st = scopedSeq.applyToBoard(rolled.board, 'Star Thru');
    check(st.legal === true, `Star Thru from the half-sashayed square is LEGAL (CALLERLAB: facing man and woman): ${st.reason ?? 'ok'}`);
    if (st.legal) {
      allCouplesRight('half-sashayed Star Thru', st.board);
      // The heads swap partners across the set, so the result is the Eight Chain Thru, not a
      // Double Pass Thru - a DIFFERENT but equally correct outcome, and the proof that the role
      // reading moved the dancers by ROLE rather than merely relaxing the gate.
      check(scopedSeq.knownFormation(st.board) === 'Eight Chain Thru',
        `...and the heads have swapped partners into an Eight Chain Thru: ${scopedSeq.knownFormation(st.board)}`);
      const on = scopedSeq.applyToBoard(st.board, 'Swing Your Partner');
      check(on.legal === true, `...from which the rest of figm#185 continues (Swing Your Partner): ${on.reason ?? 'ok'}`);
    }
  }

  // THE PRECONDITION IS THE CATALOGUE'S OWN DATA. `roleUniformMotions` returns a table only when
  // every slot of a given (gender, active) role performs an IDENTICAL local motion; 145 of the 287
  // gender-specific variants qualify. Both sides are pinned so a future tam that breaks the
  // assumption without a gate cannot silently widen the reading.
  const uniform = roleUniformMotions(scopedSeq.getVariants('Star Thru').find((v) => v.from === 'Static Square'));
  check(uniform !== null, 'Star Thru <Static Square> is role-uniform (data-enabled for the reading)');
  if (uniform) {
    check(uniform.has('boy|active') && uniform.has('girl|active')
      && uniform.has('boy|stand') && uniform.has('girl|stand'),
      `...with all four roles present: [${[...uniform.keys()].join(', ')}]`);
    check(!segsEqual(uniform.get('boy|active'), uniform.get('girl|active')),
      '...and the two ACTIVE roles are genuinely different motions (a boy and a girl do not do the same thing)');
  }
  const notUniform = scopedSeq.getVariants('Twist the Line').find((v) => v.from === 'Normal Lines');
  check(roleUniformMotions(notUniform) === null,
    'Twist the Line <Normal Lines> is NOT role-uniform, so the reading stays off for it');
  // A same-gender square must still be refused: the reading adds a ROLE, never a relaxation of
  // the call's gender structure.
  const sameSex = { dancers: square.dancers.map((d) => (d.couple === 1 || d.couple === 3 ? { ...d, gender: 'girl' } : { ...d, gender: 'boy' })) };
  const refused = scopedSeq.applyToBoard(sameSex, 'Star Thru');
  check(refused.legal === false, `a board with same-gender couples is still refused: ${refused.legal ? 'APPLIED' : refused.reason}`);
}

console.log('\n== Sequencer: CALLERLAB\'s implicit adjustment after a Fold, and its SCOPE ==');
// CALLERLAB, on Fold: "Fold can create formations that are very unusual at Mainstream. In such
// situations, callers generally use implicit adjustments to normalize the formation... Double Pass
// Thru implicitly tells dancers that they should be in the starting formation for that call (facing
// Tandems). The Double Pass Thru is danced as if the Tandems were facing, ending normally. This type
// of implicit adjustment is generally accepted at Mainstream, particularly following Fold or Cross
// Fold." The engine's matcher insists the board already IS the setup, so seven published chains
// stopped on the call right after a Fold. MEASURED: six of the seven (the seventh is `Yellow Rock`,
// a Plus call the catalogue does not have).
//
// The permission is the SCOPE, so that is what the gates below pin: the board a Fold leaves carries
// it, no other board does, the same call on the same board WITHOUT it must still refuse, and the
// adjustment must still leave a body.
{
  const replay = (calls) => {
    let b = scopedSeq.startBoard();
    for (const c of calls) {
      const r = scopedSeq.applyToBoard(b, c);
      if (!r.legal) return { ok: false, call: c, reason: r.reason, board: b };
      b = r.board;
    }
    return { ok: true, board: b };
  };
  // figm89's chain up to and including the Fold.
  const toFold = replay(['Heads Right and Left Thru', 'Heads Square Thru 4', 'Swing Thru', 'Boys Run',
    'Couples Circulate', '1/2 Tag', 'Scoot Back', 'Boys Fold']);
  check(toFold.ok, `the figm89 chain reaches the Fold: ${toFold.ok ? 'ok' : `${toFold.call}: ${toFold.reason}`}`);
  if (toFold.ok) {
    const foldBoard = toFold.board;
    check(foldBoard.adjustToNextSetup === true,
      'the board a Fold leaves CARRIES the implicit adjustment owed to the next call');
    check(scopedSeq.knownFormation(foldBoard) === null,
      `...and is unnamed, which is why the adjustment is owed at all: ${scopedSeq.knownFormation(foldBoard)}`);

    // THE SCOPE. The same board WITHOUT the permission must refuse the same call - that is the whole
    // difference the change makes, and it is why the adjustment cannot reach any other board.
    const bare = { dancers: foldBoard.dancers.map((d) => ({ ...d })) };
    const stripped = scopedSeq.applyToBoard(bare, 'Girls Turn Thru');
    check(stripped.legal === false,
      `the same call on the same board WITHOUT the permission still refuses: ${stripped.legal ? 'APPLIED' : stripped.reason}`);
    const adjusted = scopedSeq.applyToBoard(foldBoard, 'Girls Turn Thru');
    check(adjusted.legal === true,
      `...and with it, the call is danced from its own starting formation: ${adjusted.reason ?? 'ok'}`);
    if (adjusted.legal) {
      check(!adjusted.board.adjustToNextSetup,
        '...and the permission is SPENT, so it can only ever authorize the single call after a Fold');
      const rest = replay(['Heads Right and Left Thru', 'Heads Square Thru 4', 'Swing Thru', 'Boys Run',
        'Couples Circulate', '1/2 Tag', 'Scoot Back', 'Boys Fold', 'Girls Turn Thru', 'Swing Your Partner', 'Promenade']);
      check(rest.ok, `...and the rest of figm89 then runs (Swing Your Partner, Promenade): ${rest.ok ? 'ok' : `${rest.call}: ${rest.reason}`}`);
    }
  }

  // AND IT MUST LEAVE A BODY. figm83's post-Fold board stands 4.0 away from `Ladies Chain`'s setup, and
  // normalizing onto it put two dancers on one spot - `facing-audit.mjs` re-classified that figure from
  // `coverage?` to COLLISION, i.e. the adjustment laundered a body error. The guard refuses instead.
  const f83 = replay(['Heads Promenade Full', 'Sides Square Thru 4', 'Touch 1/4', 'Scoot Back', 'Boys Fold']);
  check(f83.ok, `the figm83 chain reaches its Fold: ${f83.ok ? 'ok' : `${f83.call}: ${f83.reason}`}`);
  if (f83.ok && f83.board.adjustToNextSetup) {
    const chain = scopedSeq.applyToBoard(f83.board, 'Ladies Chain');
    check(chain.legal === false,
      `...and the adjustment DECLINES it rather than leave two dancers on one spot: ${chain.legal ? 'APPLIED (a laundered collision)' : chain.reason}`);
  }
}

console.log('\n== Sequencer: `Promenade 1/2` is the ring HALF WAY round, not home ==');
// All8 writes `Pr1/2` ("Promenade Half Way Around") and the designator supplies who, so the corpus
// reaches it as `All Promenade 1/2` - figm86's FIRST call, which then runs end-to-end from the
// rotated square - and, seventy times over, as `Heads Promenade 1/2`, which is a CATALOGUE title.
// The gates below pin the end state that makes this the call rather than a home snap, and pin that
// registering it did NOT shadow those seventy.
//
// *** FOUR GATES IN THIS FILE ARE NOW RED BY DESIGN, NOT BY REGRESSION. *** `Promenade`, `Promenade Home`
// and `Promenade 1/2` used to be geometry-derived coded moves, and this file measured the end state that
// derivation produced. The derivation was REMOVED so the family can be hand-authored from tams instead, so:
//   * the three checks below that pin "a half turn, not home" now measure the AUTHORED
//     `Promenade 1/2` tams in `ms/promenade.xml`, whose travel is its own authoring rather than the
//     derived ring sweep these numbers were written against (lines ~1031, ~1037 and the two rotation
//     checks just above them);
//   * `figm86`, `figm89` and `figm17` each END in a bare `Promenade`, which is now an unknown call until
//     those tams are authored - so the three chain checks report `Unknown call: Promenade`.
// They are left failing rather than re-pinned: the numbers have to be re-measured against the HAND-AUTHORED
// tams, and pinning them now would freeze the state before that authoring exists. The subject of each is
// still the right one; only its expected value is owed.
{
  const square = scopedSeq.startBoard();
  const half = scopedSeq.applyToBoard(square, 'Promenade 1/2');
  check(half.legal === true, `Promenade 1/2 is legal from a Static Square: ${half.reason ?? 'ok'}`);
  if (half.legal) {
    check(scopedSeq.knownFormation(half.board) === 'Static Square',
      `...and leaves a squared set: ${scopedSeq.knownFormation(half.board)}`);
    // HOME puts couple 1 SOUTH, couple 2 EAST, couple 3 NORTH, couple 4 WEST (the ring order the
    // promenade's own sequence test uses, counter-clockwise). Half way round is the OPPOSITE side for
    // every couple - which is the whole difference between this call and a promenade HOME.
    const side = (couple) => {
      const ds = half.board.dancers.filter((d) => d.couple === couple);
      const mx = ds.reduce((s, d) => s + d.x, 0) / ds.length;
      const my = ds.reduce((s, d) => s + d.y, 0) / ds.length;
      return Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'east' : 'west') : (my > 0 ? 'north' : 'south');
    };
    check(side(1) === 'north', `couple 1 ends on the NORTH side, opposite its home side (${side(1)})`);
    check(side(2) === 'west', `couple 2 ends on the WEST side (${side(2)})`);
    check(side(3) === 'south', `couple 3 ends on the SOUTH side (${side(3)})`);
    check(side(4) === 'east', `couple 4 ends on the EAST side (${side(4)})`);
    // A RIGID rotation, not a re-stacking: every pairwise distance is preserved and every dancer's
    // heading turns by the SAME amount. Home is the control, so this compares two real boards.
    // (A squared-set dancer does NOT face the set's centre point - it faces along its own side - so the
    // property to assert is the rigid one, not "faces the middle", which home itself fails.)
    const sig = (b) => b.dancers
      .flatMap((a, i) => b.dancers.slice(i + 1).map((c) => Math.hypot(a.x - c.x, a.y - c.y).toFixed(6)))
      .sort().join(',');
    check(sig(half.board) === sig(square),
      '...and every pairwise distance is unchanged (a rotation of the set, not a new arrangement)');
    const turns = half.board.dancers.map((d) => {
      const o = square.dancers.find((x) => x.id === d.id);
      return Math.atan2(Math.sin(d.heading - o.heading), Math.cos(d.heading - o.heading));
    });
    const turn = turns[0];
    check(turns.every((t) => Math.abs(t - turn) < 1e-6),
      `...and every dancer turns by the same angle (${((turn * 180) / Math.PI).toFixed(1)} degrees)`);
    check(Math.abs(Math.abs(turn) - Math.PI) < 1e-6,
      '...which is exactly half a turn, as a half promenade is');

    // NOT SHADOWED. `Heads Promenade 1/2` must keep the catalogue's reading (which moves only the
    // heads), not become a four-dancer half promenade - the selection path returns null for a partial
    // selection with a precondition, and this is the gate that says so.
    const heads = scopedSeq.applyToBoard(square, 'Heads Promenade 1/2');
    check(heads.legal === true, `Heads Promenade 1/2 still applies: ${heads.reason ?? 'ok'}`);
    if (heads.legal) {
      const moved = square.dancers.filter((d) => {
        const o = heads.board.dancers.find((x) => x.id === d.id);
        return Math.hypot(o.x - d.x, o.y - d.y) > 1e-6;
      }).length;
      check(moved === 4 || moved === 8,
        `...and moves only the four heads (or all eight), not a subset of another size: ${moved} moved`);
    }
    // THE WITNESS: the rest of figm86 from this board.
    let b = half.board;
    let ok = true;
    for (const call of ['Heads Lead Right', 'Circle to a Line', 'Pass Thru', 'Tag the Line',
      'Cloverleaf', 'Centers Turn Thru', 'Pass Thru', 'Swing Your Partner', 'Promenade']) {
      const r = scopedSeq.applyToBoard(b, call);
      if (!r.legal) { fail(`figm86 after the half promenade: "${call}" refused: ${r.reason}`); ok = false; break; }
      b = r.board;
    }
    if (ok) check(scopedSeq.knownFormation(b) === 'Static Square',
      `...and the rest of figm86 runs to a resolved square: ${scopedSeq.knownFormation(b)}`);
  }
  // `Promenade` itself is unaffected: it still ends HOME (couple 1 south).
  const home = scopedSeq.applyToBoard(square, 'Promenade');
  const c1 = home.legal ? home.board.dancers.filter((d) => d.couple === 1) : [];
  check(home.legal && c1.length === 2 && c1.reduce((s, d) => s + d.y, 0) < 0,
    'plain Promenade still ends with couple 1 on its HOME (south) side');
}

console.log('\n== Sequencer: a MULTIPLE of a catalogue call, and the guard that keeps it narrow ==');
// All8's own key (abbrlist.htm, read in round 19) defines `Cir2` as "{designated} Circulate 2 spots
// (Circulate Twice)", and CALLERLAB's Circulate Family says "Fractions are proper and occasionally
// used with calls in the Circulate family". Circulate is catalogue TAMS here, not a rule, so "twice"
// can only be the engine's own reading of the base call applied twice - which is what makes
// `Girls Circulate 2` work in figm17 (115 -> 116 figures).
{
  const replay = (calls) => {
    let b = scopedSeq.startBoard();
    for (const c of calls) {
      const r = scopedSeq.applyToBoard(b, c);
      if (!r.legal) return { ok: false, call: c, reason: r.reason, board: b };
      b = r.board;
    }
    return { ok: true, board: b };
  };
  // FIGM17'S OWN CHAIN STOPS AT A SILENT NO-OP IT USED TO CARRY, and that is now RECORDED rather than walked
  // around. `Heads Lead Right` has no catalogue title, and from the board `Heads Promenade 1/2` leaves, the
  // whole-formation fallback's tiling holds the SIDES (`7+8 | 3+4`) and none of the selected heads - so the
  // merge kept every head exactly where it stood and the call came back LEGAL with the board UNCHANGED. The
  // step was a no-op and the chain "reached the wave" by skipping it; `CallApplicator.applySelected` refuses
  // that now (TODO.md P0.3), so the figure stops here until the heads' own `Lead Right` reading exists. The
  // ENGINE GAP is that reading, not this check.
  const before = replay(['Heads Promenade 1/2', 'Heads Lead Right']);
  check(!before.ok && before.call === 'Heads Lead Right' && /left exactly where they stand/.test(before.reason ?? ''),
    `figm17 stops where it used to no-op instead of carrying the step: ${before.ok ? 'the chain applied' : before.reason}`);
  // THE MULTIPLE IS MEASURED ON THE CANONICAL WAVE, so the feature keeps its coverage whether or not the
  // figure's own chain can be walked - the property below is about the reading, not about figm17.
  {
    const wave = scopedSeq.boardForFormation('Ocean Waves');
    check(!!wave, 'the canonical Ocean Waves board is in the library');
    const once = scopedSeq.applyToBoard(wave, 'Girls Circulate');
    const twice = once.legal ? scopedSeq.applyToBoard(once.board, 'Girls Circulate') : { legal: false };
    const multiple = scopedSeq.applyToBoard(wave, 'Girls Circulate 2');
    check(multiple.legal === true, `Girls Circulate 2 applies: ${multiple.reason ?? 'ok'}`);
    check(twice.legal && multiple.legal,
      '...and the base call itself applies twice, which is what the multiple is composed from');
    if (twice.legal && multiple.legal) {
      const worst = Math.max(...multiple.board.dancers.map((d) => {
        const o = twice.board.dancers.find((x) => x.id === d.id);
        return Math.max(Math.hypot(d.x - o.x, d.y - o.y), Math.abs(Math.atan2(
          Math.sin(d.heading - o.heading), Math.cos(d.heading - o.heading))));
      }));
      check(worst < 1e-9,
        `...and lands exactly where two applications of the base call land (worst departure ${worst.toFixed(9)})`);
    }
    // THE GUARD: it must NOT hijack a real title that happens to end in " 2". Asserted on the
    // strongest available case - from a Static Square the catalogue's own `Square Thru 2` applies
    // while the BARE `Square Thru` does not, so if the multiple branch had taken it the call could
    // not have been danced at all. That is why this is asserted from a Static Square and not from the
    // wave above, where neither reading applies and the assertion would silently skip.
    const square = scopedSeq.startBoard();
    const st2 = scopedSeq.applyToBoard(square, 'Square Thru 2');
    const bare = scopedSeq.applyToBoard(square, 'Square Thru');
    check(st2.legal === true,
      `a registered "… 2" title keeps its OWN authoring: Square Thru 2 applies from a Static Square: ${st2.reason ?? 'ok'}`);
    check(bare.legal === false,
      `...while bare Square Thru does NOT there, which is what would have made the multiple branch fail instead: ${bare.legal ? 'APPLIED' : bare.reason}`);
    // THE WITNESS: the rest of figm17, from the multiple the reading produced.
    let b = multiple.legal ? multiple.board : wave;
    let ok = true;
    for (const call of ['Turn Thru', 'Allemande Left', 'Promenade']) {
      const r = scopedSeq.applyToBoard(b, call);
      if (!r.legal) { fail(`figm17 after the multiple: "${call}" refused: ${r.reason}`); ok = false; break; }
      b = r.board;
    }
    if (ok) check(scopedSeq.knownFormation(b) === 'Static Square',
      `...and the rest of figm17 runs to a resolved square: ${scopedSeq.knownFormation(b)}`);
  }
}

console.log('\n== Sequencer: `Fan the Top` is DERIVED, and the two canonical boards pin it ==');
// CALLERLAB's definition (shipped by the reference at assets/plus/fan_the_top.md): "The centers of the
// line or wave turn three quarters (270 degrees) while the outside dancers move forward in a quarter
// circle. The ending formation is at right angles to the starting formation. Centers remain centers and
// ends remain ends."
//
// BEFORE the derived rule the engine read the catalogue's DEMONSTRATION tams as setups and MEASURED
// wrong from BOTH canonical boards: from `Ocean Waves` it collapsed two waves into ONE LINE OF EIGHT
// at half spacing (positions x = -0.5, -1.5, -2.5, -3.5 ... all at y = 0), and from `Tidal Wave` it
// produced Ocean Waves. Neither is a formation the call can end in.
//
// The rule is checked by its two observable PROPERTIES rather than by coordinates, because those are
// what the definition actually states and they are what a wrong sign breaks.
{
  const wave = scopedSeq.boardForFormation('Ocean Waves');
  const before = scopedSeq.knownFormation(wave);
  check(before === 'Ocean Waves', `the canonical board starts as Ocean Waves: ${before}`);
  const r = scopedSeq.applyToBoard(wave, 'Fan the Top');
  check(r.legal === true, `Fan the Top applies to the canonical Ocean Waves: ${r.reason ?? 'ok'}`);
  if (r.legal) {
    // (a) the ending formation is at right angles AND is still an Ocean Wave - not one flat line.
    const ends = scopedSeq.knownFormation(r.board);
    check(ends === 'Ocean Waves',
      `...and the ending formation is still an Ocean Waves (at right angles), not a collapsed line: ${ends}`);
    // "one line of eight at half spacing" was the OLD failure; assert the two rows are separated.
    const ys = [...new Set(r.board.dancers.map((d) => d.y.toFixed(2)))].sort((a, b) => Number(a) - Number(b));
    check(ys.length === 2 && Number(ys[1]) - Number(ys[0]) > 3,
      `...so the dancers stand in TWO rows, not one: rows at y = ${ys.join(', ')}`);
    // (b) centres remain centres and ends remain ends. On the canonical board the centres of the two
    // waves are ids 2,3 (wave at x=-2) and 6,7 (wave at x=+2), so whichever row each lands in, those
    // four must be the MIDDLE two and never the outer two.
    const centreIds = new Set([2, 3, 6, 7]);
    const xs = (row) => r.board.dancers.filter((d) => Math.abs(d.y - row) < 0.01)
      .slice().sort((a, b) => a.x - b.x).map((d) => d.id);
    for (const row of ys.map(Number)) {
      const line = xs(row);
      const middles = [line[1], line[2]];
      check(middles.every((id) => centreIds.has(id)),
        `...centres stay centres: row y=${row} has middle two #${middles.join(',#')}, which must be centres`);
      check(!centreIds.has(line[0]) && !centreIds.has(line[3]),
        `...ends stay ends: row y=${row} ends are #${line[0]}, #${line[3]}, which must not be centres`);
    }
  }
}

// ---------------------------------------------------------------------------
// The END FORMATION of a call instance, and labelling one the library cannot name.
//
// The browse view holds a call BUNDLE (one authored <tam>) and every read the engine offers takes
// a BOARD, so `boardAtBeat` is what makes "what formation does this finish in" askable at all.
// Where the answer is nothing, the user can name the shape - and a user-defined formation has to
// be recognisable AT ONCE, which is what makes the cache clearing in `registerFormation` part of
// the feature rather than a detail.
// ---------------------------------------------------------------------------
console.log('\n== the end formation of a call instance, and user-defined formations ==');
{
  // A witness found by MEASUREMENT rather than by name: any EIGHT-dancer variant of MS
  // `Allemande Left` whose end board the library cannot name. Naming one by hand would break the
  // day the corpus learns it, and naming a 4-dancer one would be useless - see the note below.
  const variants = buildCallVariants(ms('allemande'), movesXml, formationsXml, true);
  const witness = variants.find((v) => v.dancers.length === 8 && seq.knownFormation(boardAtBeat(v, v.beats)) === null);
  if (!witness) {
    fail('no unnameable EIGHT-dancer end board in ms/allemande.xml - the premise of this section is gone');
  } else {
    const board = boardAtBeat(witness, witness.beats);
    const shaped = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    check(board.dancers.length === 8, `witness: "${witness.title}" from ${witness.from} ends on ${board.dancers.length} dancers`);
    // READ IT ONCE BEFORE REGISTERING, so the cache is primed with the null. A registration that
    // did not clear the cache would still answer "null" below and the label would never appear on
    // the board the user was looking at.
    check(seq.knownFormation(board) === null, 'the end board has no name in the library');
    check(seq.recognize(board).name === null, 'and no curated label either');
    check(seq.listUserFormations().length === 0, 'nothing is user-defined yet');

    const before = seq.listFormations().length;
    seq.registerFormation('Probe End Shape', shaped);
    check(seq.knownFormation(board) === 'Probe End Shape', 'after registering a name, the SAME board reads as that name (so the match cache was cleared)');
    check(seq.isUserFormation('Probe End Shape'), 'and the formation is TAGGED as user-defined');
    check(seq.listUserFormations().includes('Probe End Shape'), 'it appears in the user-defined list');
    check(seq.listFormations().length === before + 1, `a NEW shape adds one formation to the library (${before} -> ${seq.listFormations().length})`);

    // Registering a shape the corpus already carries must add the NAME and not a second copy of
    // the geometry - the constructor's dedupe, applied to the user path too.
    const dup = seq.listFormations().length;
    seq.registerFormation('Probe End Shape Twice', shaped);
    check(seq.listFormations().length === dup, `registering the SAME geometry again adds the name without a second shape (${dup})`);
    check(seq.knownFormation(board) === 'Probe End Shape', 'and the original name still wins for that board');

    // A board that was ALREADY named must keep its name: a user-defined formation is an addition
    // to the library, not an override of it.
    const circle = buildCallVariants(ms('circle'), movesXml, formationsXml, true)[0];
    const cEnd = boardAtBeat(circle, circle.beats);
    const cName = seq.knownFormation(cEnd);
    check(cName !== null, `control: another call's end is already named (${cName})`);
    check(seq.knownFormation(cEnd) === cName, 'and it is unchanged by the registration');

    // NO LEAKAGE: a fresh sequencer over the same corpus does not know the label. A user-defined
    // formation lives in a session (or in local storage), not in the shipped catalogue.
    const fresh = new Sequencer(movesXml, formationsXml, [{ name: 'Allemande Left', xml: ms('allemande') }]);
    check(fresh.knownFormation(board) === null, 'a fresh sequencer over the same corpus does NOT know the label');
    check(fresh.listUserFormations().length === 0, 'and reports no user-defined formations');

    // THE CORPUS FORMAT, round-tripped: this is how a labelled shape gets into formations.xml.
    const xml = formationToXml('Probe End Shape', shaped);
    const parsed = parseFormations(`<formations>${xml}</formations>`).get('Probe End Shape');
    check(!!parsed && parsed.length === 8, `formationToXml -> parseFormations returns ${parsed ? parsed.length : 0} dancers`);
    let worst = 0;
    for (let i = 0; i < parsed.length; i++) {
      worst = Math.max(worst, Math.hypot(parsed[i].x - shaped[i].x, parsed[i].y - shaped[i].y));
    }
    check(worst < 1e-12, `and the geometry round-trips (worst offset ${worst.toExponential(2)})`);

    // AND IT BECOMES AN FSM STATE, which is the OTHER half of closing the dead end and the half the
    // LEVEL SCOPE (Stage 0b) could have broken silently. `buildFsmTable` now takes its named half from
    // `library.referencedFormations()` - the formations the registered calls declare - so a labelled
    // shape is in scope only because `referencedFormationNames()` also carries `userFormations`. The
    // first cut did not, and this check is what caught it: the label appeared in `knownFormation` and
    // in `listFormations`, and the FSM still had no state for the board.
    {
      const states = seq.transitionTable().states();
      check(states.includes('Probe End Shape'),
        states.includes('Probe End Shape')
          ? `a labelled formation is an FSM state (${states.length} states)`
          : `a labelled formation is NOT an FSM state (${states.length} states, e.g. ${states.slice(0, 4).join(', ')})`);
      check(seq.library.referencedFormationNames().has('Probe End Shape'),
        'a labelled formation is IN the state vocabulary, because a person declared it (not only the call set)');
      // The scope still excludes what nobody declared: the corpus is bigger than either source.
      const corpusOnly = seq.library.getUniqueFormations().map((f) => f.name)
        .filter((n) => !seq.library.referencedFormationNames().has(n));
      check(corpusOnly.length > 0,
        `${corpusOnly.length} corpus formations are still out of scope - the user label did not widen the scope to the whole corpus`);
    }

    // THE SIZE RULE, measured rather than asserted: a formation is matched only against a board of
    // the SAME dancer count (`bestFormationMatch` skips the rest), and the library holds
    // eight-dancer geometries only - the constructor MIRRORS a four-dancer entry to eight. So a
    // half-set end board cannot be named, and labelling one would not help.
    const four = buildCallVariants(ms('allemande'), movesXml, formationsXml, true).find((v) => v.dancers.length === 4);
    if (four) {
      const b4 = boardAtBeat(four, four.beats);
      check(b4.dancers.length === 4 && seq.knownFormation(b4) === null, `a ${b4.dancers.length}-dancer end board cannot be named even after registering formations (the library holds eight-dancer geometries)`);
    } else {
      fail('expected a 4-dancer variant of Allemande Left as the size-rule control');
    }
  }
}

// ---------------------------------------------------------------------------
// A CALLER'S HALF-SET FORMATION IS A WHOLE SET, and registering one has to keep it
//
// Asked for, after a report that loading a user-defined formation left the call "not named": "remember
// formations are only half the set of dancers it represents."
//
// THE CORPUS AUTHORS A NAMED FORMATION AS THE FOUR DANCERS OF A HALF-GROUP, and the library mirrors those to
// eight at construction so that an eight-dancer board can be matched against them. `registerFormation` did NOT,
// so a caller's four-dancer shape was filed at a size nothing is ever matched at - and the geometry dedupe then
// discarded it outright, because `matchFormations` SUBSET-matches an eight-dancer source against a four-dancer
// target. MEASURED against the real library: the caller's shape matched `Circle`, nothing was added, and
// `knownFormation` answered `null` for the board it came from.
console.log('\n== a registered half-set formation names a whole-set board ==');
{
  const tams = parseCallXml(read('../../assets/ms/circle.xml'));
  const tam = tams.find((t) => /^circle$/i.test((t.formationAttr ?? '').trim()));
  check(!!tam, 'ms/circle.xml carries a tam whose formation the corpus authors as a half-group');
  if (tam) {
    const moves = parseMoves(movesXml);
    const forms = parseFormations(formationsXml);
    const full = normalizeInstance(buildCall(tam, forms, moves, true));
    const half = normalizeInstance(buildCall(tam, forms, moves, false));
    const b8 = boardAtBeat(full, full.beats);
    const b4 = boardAtBeat(half, half.beats);
    check(b4.dancers.length === 4 && b8.dancers.length === 8,
      `and it reads as ${b4.dancers.length} or ${b8.dancers.length} dancers depending on the mirror, so the two sizes are the same call`);
    const shape4 = b4.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    const fresh = () => new Sequencer(movesXml, formationsXml, []);
    // THE 8-DANCER BOARD IS NAMED BY THE CALLER'S NAME, which is the whole point: it was not named at all while
    // the registration kept the shape at four.
    const a = fresh();
    const before = a.knownFormation(b8);
    check(before !== null, `an eight-dancer board is named by the corpus as "${before}" before anything is registered`);
    const b = fresh();
    b.registerFormation('Caller Shape', shape4);
    // A FRESH LIBRARY AND THE EIGHT-DANCER BOARD ASKED FIRST: the match cache is keyed on the board, and asking
    // a shared instance for both sizes lets one answer for the other (measured - it reported the four-dancer
    // board as named, which is not true of a fresh library).
    check(b.knownFormation(b8) === 'Caller Shape',
      `registering the FOUR-dancer shape names the EIGHT-dancer board "${b.knownFormation(b8)}" - it used to be discarded by the geometry dedupe`);
    // AND A HALF-SET BOARD IS STILL NOT NAMED, which is the library's own rule rather than a defect: a board is
    // matched only against formations of its own size, and this library holds whole sets. Recorded so the next
    // reader does not mistake it for the bug that was just fixed.
    check(fresh().knownFormation(b4) === null,
      'and a four-dancer BOARD is still not named: the library holds whole sets, so a half-set board has nothing of its own size to match');
  }
}
// ---------------------------------------------------------------------------
//  A 4-DANCER CALL APPLIED TWICE WHOSE TURN IS A FULL ONE STILL ANIMATES
// ---------------------------------------------------------------------------
//
// Reported: "in sequencer, set Normal Lines and select Circle Four Left Full. This should be a 4 dancer call
// applied twice to the set. It looks like it's applied, but the dancers dont move when I scrub across the 8
// beats it's reserved."
//
// IT APPLIED PERFECTLY AND ANIMATED NOTHING, and the two are not contradictory: a FULL circle ends exactly
// where it began, so the apply's result board IS the board it started from. The animator's "a dancer the call
// did not move does not move" pin tested exactly that - `appliedPose == startPose` - which cannot tell a
// dancer the call never TOUCHED from a dancer the call RETURNS HOME. Every dancer in a full-turn call is the
// second, so the pin overwrote the per-group path animation for all eight and the step stood still while the
// timeline kept its beats. The pin now asks the apply which dancers it touched (the union of
// `ApplyResult.parallel.groups`), so a group that matched is never pinned.
console.log('\n== a 4-dancer call applied twice whose turn is a FULL one still animates ==');
{
  const s = new Sequencer(movesXml, formationsXml, callsByTitle(path.resolve(__dirname, '../../assets')));
  const lines = s.boardForSetup('Normal Lines');
  check(!!lines, 'the start board "Normal Lines" is in the library');
  const flat = ['Circle Four Left Full'];
  const beats = s.sequenceBeats(flat, lines);
  check(beats > 0, `the call is charged its beats rather than 0 (${beats})`);

  // The APPLY, which has to stay legal and has to tile into two groups of four - that half was never wrong.
  const res = s.applicator.applyToBoard(lines, 'Circle Four Left Full');
  check(res.legal && !!res.parallel && res.parallel.groups.length === 2,
    `it applies legally as ${res.parallel ? res.parallel.groups.map((g) => g.length).join(' + ') : 'no groups'} - the 4-dancer call is applied to the set twice`);

  // THE END REALLY IS HOME, which is why the old predicate was satisfied by every dancer at once.
  const endBoard = s.evaluateSequence(flat, beats, lines).board;
  const home = Math.max(...endBoard.dancers.map((d, i) => Math.hypot(d.x - lines.dancers[i].x, d.y - lines.dancers[i].y)));
  check(home < 1e-6,
    `and it finishes where it began (worst ${home.toExponential(1)} units) - which is exactly why "the applied pose equals the start" could not be the test`);

  // THE ANIMATION, which is the thing that was broken: a full turn is still a journey.
  let worst = 0;
  for (let b = 0; b <= beats; b += 0.25) {
    const bb = s.evaluateSequence(flat, b, lines).board;
    bb.dancers.forEach((d, i) => {
      worst = Math.max(worst, Math.hypot(d.x - lines.dancers[i].x, d.y - lines.dancers[i].y));
    });
  }
  check(worst > 0.5,
    `AND THE DANCERS MOVE the whole way round (worst ${worst.toFixed(3)} units off their own start), so the 8 beats it reserves are not a standstill`);
}

console.log('\n=================');
if (failures === 0) console.log('SEQUENCER TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
