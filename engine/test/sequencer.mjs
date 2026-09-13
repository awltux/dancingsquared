// Sequencer headless test. Run after `npm run build` (tsc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer } from '../dist/index.js';
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

const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');
const ms = (name) => read(`../../poc/src/assets/ms/${name}.xml`);

const seq = new Sequencer(movesXml, formationsXml, [
  { name: 'Allemande Left', xml: ms('allemande') },
  { name: 'Swing Thru', xml: ms('swing_thru') },
  { name: 'Promenade', xml: ms('promenade') },
  { name: 'Circle Left', xml: ms('circle') },
  { name: 'Heads Spin the Top', xml: ms('spin_the_top') },
  { name: 'Double Pass Thru', xml: ms('double_pass_thru') },
  { name: 'Heads Pass Thru', xml: filterTam('../../poc/src/assets/b1/pass_thru.xml', 'Heads Pass Thru') },
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

console.log('== Sequencer: a SCOPED catalogue call falls back to its generic reading ==');
// "Heads Pass Thru" is BOTH a selection prefix and a catalogue title, so it takes the whole-board
// path on the reasoning that the catalogue's own scoped tam knows best. It does - when it covers the
// board. The shipped scoped tams are authored for a SQUARED SET (heads pass thru, sides wait), so on
// any other arrangement the whole-board reading fails and the call used to be refused even though
// the generic reading is perfectly well defined: gather the named four and apply the BASE call.
// MEASURED in the census's EXACT bucket - the five cases where a same-size setup overlays the
// board's positions AND facings at error 0.000 and the call is still refused - `figm174 Heads Pass
// Thru` and `figm224 Sides Pass Thru`, both from a Double Pass Thru.
const scopedSeq = new Sequencer(movesXml, formationsXml, callsByTitle(path.resolve(__dirname, '../../poc/src/assets')));
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
// The separation-2 authoring in `b1/sashay.xml` was ADDED because the corpus reaches `Rollaway` from
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
    // ...AND IT RETURNS TO THE BOARD IT STARTED FROM, which is what the documented pattern needs:
    // "Allemande Left Your Corner; Dosado Your Partner; Allemande Left Your Corner" is followed in
    // the corpus by `Weave the Ring`, and that call's own authored setup IS the Static Square. The
    // first version of this tam applied the Static Square's paths to the pose and turned every dancer
    // another quarter - it ended on a board the engine names `Static Facing Out`, so the pattern
    // danced on tilted instead of coming back. Measured here rather than assumed.
    if (al2.legal) {
      const before = new Map(scopedSeq.startBoard().dancers.map((d) => [d.id, d]));
      const worst = Math.max(...al2.board.dancers.map((d) => {
        const o = before.get(d.id);
        return Math.max(Math.hypot(d.x - o.x, d.y - o.y), Math.abs(Math.atan2(
          Math.sin(d.heading - o.heading), Math.cos(d.heading - o.heading))));
      }));
      check(worst < 1e-6,
        `...and the pair of Allemande Lefts returns every dancer to where it started (worst departure ${worst.toFixed(6)})`);
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
  }
}

console.log('\n=================');
if (failures === 0) console.log('SEQUENCER TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
