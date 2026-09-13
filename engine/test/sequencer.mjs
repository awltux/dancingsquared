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

console.log('\n=================');
if (failures === 0) console.log('SEQUENCER TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
