// WHICH SPOT EACH DANCER TAKES WHEN THE SHAPE IS RIGHT BUT THE ARRANGEMENT IS NOT - the "Place Formation" button.
//
// Asked for as: "Rename the 'Place End' button to 'Place Setup'. Add another Button that does 'Place Formation'. This will
// only assign the position and rotation to the nearest dancers as their last position and rotation. It will only work if
// the dancers are already quite close. This is appropriate for 'Heads Wheel round and make an arch, Sides dive thru' from
// 'Promenade 2'. It ends in a 'Two-Faced lines LH' formation rotated by 45 deg, but the setup is in a different order, so
// it doesn't match cleanly when applied using 'Place Setup'. But it would work as a Formation."
//
// THE RULE IS IMPORTED, NOT MIRRORED (§5): it lives in `poc/src/end-snap.ts`, which is DOM-free and imports nothing, so
// this probe loads it through node's type stripping and measures the rule the panel runs.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. the rule on hand-made boards: exact spots pair to themselves; a REVERSED arrangement still pairs (that is the
//      whole point) and comes out reversed; a dancer past the tolerance refuses and the sentence NAMES it; a size
//      mismatch refuses; and the tie-break is the indices, so two renders cannot disagree;
//   2. THE WITNESS, built from the corpus: its end board and `Two-Faced Lines LH` turned 45 degrees. The numbers are the
//      claim - worst distance, heading, genders - and the pairing it produces is the reversed one the setup button cannot
//      express. Its twin `Two-Faced Lines RH` fits at the SAME distance and disagrees on every gender, which is why those
//      numbers are reported rather than gated;
//   3. the negative controls stated as rules: pairing BY INDEX (the plausible wrong answer, and the one that motivated the
//      feature) lands dancers up to 1.8 units out; gating on GENDER would refuse the witness's own call under the twin
//      variant and cannot tell the two variants apart by distance at all; and a nearest-per-dancer rule WITHOUT the
//      one-dancer-per-spot constraint puts two dancers on one spot on the witness (measured below), which a formation
//      cannot do;
//   4. the reach on the corpus's own ms level: how many calls the NAMER cannot name yet a formation would take within the
//      tolerance at one of the eight turns - so the button's territory is a count, not a story;
//   5. the panel wiring: both buttons exist with their new names, the formation button is disabled until a target is
//      chosen, and its handler calls the imported rule with the TURNED poses and applies the answer through the engine's
//      own placement.
//
// Run: node poc/tools/end-place-formation-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC, '..');
const { END_SNAP_TOL, snapToNearestSpots } = await import(pathToFileURL(path.join(POC, 'src', 'end-snap.ts')).href);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const DEG = Math.PI / 180;
const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};

const formationsOf = (n) => {
  const pairs = engine.parseFormations(fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8'));
  const out = [];
  for (const [name, ds] of pairs) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length === n) out.push({ name, poses });
  }
  return out;
};

// ---------------------------------------------------------------- 1. the rule on hand-made boards
console.log('\n== 1. nearest first, one dancer per spot, refused beyond the tolerance ==');
{
  const spots = [
    { x: -2, y: 3, heading: 0 }, { x: -2, y: 1, heading: 0 },
    { x: -2, y: -1, heading: Math.PI }, { x: -2, y: -3, heading: Math.PI },
    { x: 2, y: -3, heading: 0 }, { x: 2, y: -1, heading: 0 },
    { x: 2, y: 1, heading: Math.PI }, { x: 2, y: 3, heading: Math.PI },
  ];
  const exact = snapToNearestSpots(spots, spots);
  check('pairing' in exact && exact.worst === 0 && exact.pairing.join(',') === '0,1,2,3,4,5,6,7',
    'dancers standing exactly on the spots pair to themselves, with no distance at all');
  // THE REVERSED ARRANGEMENT: same eight spots, the dancers in the opposite order along each line. This is the shape of
  // the reported case, and the reason the button exists.
  const reversed = [spots[3], spots[2], spots[1], spots[0], spots[7], spots[6], spots[5], spots[4]];
  const r = snapToNearestSpots(reversed, spots);
  check('pairing' in r && r.pairing.join(',') === '3,2,1,0,7,6,5,4' && r.worst < 1e-12,
    `a REVERSED arrangement pairs reversed, not by index (${'pairing' in r ? r.pairing.join(',') : r.refused})`);
  const nudged = reversed.map((p, i) => (i === 0 ? { ...p, x: p.x + 0.4 } : p));
  const n1 = snapToNearestSpots(nudged, spots);
  check('pairing' in n1 && Math.abs(n1.worst - 0.4) < 1e-9,
    `a dancer 0.40 off its spot still pairs, and the worst distance says so (${'pairing' in n1 ? n1.worst.toFixed(2) : n1.refused})`);
  const far = reversed.map((p, i) => (i === 2 ? { ...p, x: p.x + END_SNAP_TOL + 0.05 } : p));
  const f1 = snapToNearestSpots(far, spots);
  check('refused' in f1 && /dancer 3/.test(f1.refused) && /nearest spot/.test(f1.refused),
    `a dancer past the tolerance refuses, and the sentence NAMES it and its nearest spot (${'refused' in f1 ? f1.refused : 'accepted'})`);
  const short = snapToNearestSpots(reversed.slice(0, 4), spots);
  check('refused' in short && /4 dancers/.test(short.refused) && /8 spots/.test(short.refused),
    `a size mismatch is refused with both counts (${'refused' in short ? short.refused : 'accepted'})`);
  // THE TIE-BREAK: two dancers equidistant from the same spot, one other spot free. The lower dancer index takes it, so
  // the answer cannot change between two renders of the same panel.
  const tie = snapToNearestSpots(
    [{ x: 0, y: 0, heading: 0 }, { x: 0, y: 0, heading: 0 }],
    [{ x: 0, y: 0.1, heading: 0 }, { x: 0, y: -0.1, heading: 0 }],
  );
  check('pairing' in tie && tie.pairing.join(',') === '0,1',
    `equidistant dancers pair by index, deterministically (${'pairing' in tie ? tie.pairing.join(',') : tie.refused})`);
  // NEGATIVE CONTROL, the plausible wrong rule: pair each dancer with its own nearest spot and do not check that two
  // dancers picked the same one. MEASURED on the witness below (two dancers on one spot); here on a board built to show
  // it in the smallest possible case.
  const greedyNaive = (dancers, spots) => dancers.map((d) => {
    let best = 0, bd = Infinity;
    spots.forEach((s, j) => { const dd = Math.hypot(d.x - s.x, d.y - s.y); if (dd < bd) { bd = dd; best = j; } });
    return best;
  });
  const sameSpot = [{ x: 0, y: 0, heading: 0 }, { x: 0, y: 0, heading: 0 }];
  const twoSpots = [{ x: 0, y: 0.1, heading: 0 }, { x: 0, y: -0.1, heading: 0 }];
  const naive = greedyNaive(sameSpot, twoSpots);
  check(new Set(naive).size === 1 && 'pairing' in tie && new Set(tie.pairing).size === 2,
    `NEGATIVE CONTROL: the unconstrained "each dancer's nearest" answer puts BOTH dancers on spot 1 (${naive.join(',')}), which no formation allows - the rule returns a permutation`);
}

// ---------------------------------------------------------------- 2. the witness
console.log('\n== 2. the reported call: "Heads Wheel Around and make an Arch, Sides Dive Thru" from "Promenade 2" ==');
let witness = null;
{
  const pairs = engine.parseFormations(fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8'));
  const moves = engine.parseMoves(fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8'));
  const tams = engine.parseCallXml(fs.readFileSync(path.join(assets, 'ms', 'dive_thru.xml'), 'utf8'));
  const tam = tams.find((t) => (t.title ?? '').startsWith('Heads Wheel Around and make an Arch'));
  check(tam !== undefined, 'the tam resolves by TITLE, not by index (trap 7)');
  const call = engine.buildCall(tam, pairs, moves, true);
  const n = call.dancers.length;
  const beats = engine.instanceBeats(call);
  const board = call.dancers.map((d) => {
    const p = engine.poseFor(d, beats);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  const list = formationsOf(n);
  const lh = list.find((f) => f.name === 'Two-Faced Lines LH');
  const rh = list.find((f) => f.name === 'Two-Faced Lines RH');
  check(lh !== undefined && lh.poses.length === n, `"Two-Faced Lines LH" is one of the ${n}-dancer formations`);
  const turned = engine.rotateFormation(lh.poses, 45 * DEG);
  const snap = snapToNearestSpots(board, turned);
  witness = snap;
  console.log(`    snap: ${JSON.stringify('pairing' in snap ? snap : snap)}`);
  check('pairing' in snap, `the board IS that formation turned 45 degrees, within the tolerance (${'pairing' in snap ? snap.worst.toFixed(4) : snap.refused})`);
  if ('pairing' in snap) {
    check(Math.abs(snap.worst - 0.3575) < 0.002, `worst pair 0.3575 units (${snap.worst.toFixed(4)}) - seven times the NAMING margin, which is why the row says Unknown Setup`);
    check(snap.pairing.join(',') === '2,3,1,0,6,7,5,4',
      `and it is the REVERSED order within each line, which is the correspondence the setup button cannot express (${snap.pairing.join(',')})`);
    check(snap.worstHeading < 1 * DEG, `the heading agrees to ${(snap.worstHeading / DEG).toFixed(2)} degrees, so the rotation is the caller's 45 and not a guess`);
    check(snap.genderMisses === 0, `and the genders agree at 8 of 8 spots (${snap.genderMisses} misses)`);
  }
  check(engine.endFormationMatch(call, list) === null,
    'the NAMER refuses the same board, so the End setup row says "Unknown Setup" and this button is the way out');
  // THE TWIN: the same eight spots, the other arrangement. Distance cannot tell them apart - only the report can.
  const rhSnap = snapToNearestSpots(board, engine.rotateFormation(rh.poses, 45 * DEG));
  check('pairing' in rhSnap && Math.abs(rhSnap.worst - (snap.worst ?? 0)) < 0.002,
    `NEGATIVE CONTROL: "Two-Faced Lines RH" fits at the SAME distance (${'pairing' in rhSnap ? rhSnap.worst.toFixed(4) : rhSnap.refused}) - so a distance gate alone cannot choose between the variants`);
  check('pairing' in rhSnap && rhSnap.genderMisses === 8 && rhSnap.worstHeading > 3.1,
    `...and disagrees on all eight genders and ~180 degrees of heading (${'pairing' in rhSnap ? `${rhSnap.genderMisses} misses, ${(rhSnap.worstHeading / DEG).toFixed(2)}deg` : rhSnap.refused}), which is what the report is for`);
  // AND THE RULE THE FEATURE REPLACES: pairing by index. MEASURED on the same board.
  const byIndex = board.map((_, i) => i).reduce((w, i) => Math.max(w, Math.hypot(board[i].x - turned[i].x, board[i].y - turned[i].y)), 0);
  check(byIndex > 1.7, `NEGATIVE CONTROL: index-for-index puts a dancer ${byIndex.toFixed(2)} units from its spot, so "same order" is not an answer`);
}

// ---------------------------------------------------------------- 3. the reach on the corpus
console.log('\n== 3. how many calls the NAMER cannot name, a formation would take ==');
{
  const pairs = engine.parseFormations(fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8'));
  const moves = engine.parseMoves(fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8'));
  const list8 = formationsOf(8);
  const files = filesOf('ms');
  let calls = 0, unnamed = 0, snapped = 0, built = 0;
  const t0 = Date.now();
  for (const file of files) {
    const tams = engine.parseCallXml(fs.readFileSync(path.join(assets, 'ms', file), 'utf8'));
    for (const tam of tams) {
      let call;
      try {
        call = engine.buildCall(tam, pairs, moves, true);
      } catch {
        continue;
      }
      calls++;
      if (call.dancers.length !== 8) continue;
      built++;
      const board = call.dancers.map((d) => {
        const p = engine.poseFor(d, engine.instanceBeats(call));
        return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
      });
      if (engine.endFormationMatch(call, list8) !== null) continue;
      unnamed++;
      let found = null;
      for (const f of list8) {
        for (let step = 0; step < 8; step++) {
          const poses = step === 0 ? f.poses : engine.rotateFormation(f.poses, step * 45 * DEG);
          const s = snapToNearestSpots(board, poses);
          if ('pairing' in s) { found = { name: f.name, deg: step * 45, s }; break; }
        }
        if (found) break;
      }
      if (found) {
        snapped++;
        if (snapped <= 3) console.log(`    e.g. "${(tam.title ?? '').trim()}" -> ${found.name} @ ${found.deg}deg, worst ${found.s.worst.toFixed(2)}`);
      }
    }
  }
  console.log(`    ${calls} ms tams built (${built} at eight dancers); ${unnamed} that the namer refuses; ${snapped} of those a formation would take`);
  check(built > 200, `the sweep measured ${built} eight-dancer calls, so it is not a sample of nothing`);
  check(snapped > 0 && snapped <= unnamed, `and ${snapped} of the ${unnamed} unnamed ends are within the tolerance of a named formation (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------------------------------------------------------------- 4. the panel wiring
console.log('\n== 4. the two buttons ==');
{
  const html = read('index.html');
  const ui = read('src/editor-ui.ts');
  check(/id="edPlaceSetup"[^>]*>Place setup</.test(html), 'the old button is now "Place setup"');
  check(/id="edPlaceFormation"[^>]*>Place formation</.test(html), 'and "Place formation" is a second button beside it');
  check(/this\.placeSetupBtn\.addEventListener\('click', \(\) => this\.doPlaceSetup\(\)\);/.test(ui) &&
    /this\.placeFormationBtn\.addEventListener\('click', \(\) => this\.doPlaceFormation\(\)\);/.test(ui),
    'each button has its own handler, named for the operation');
  check(/snapToNearestSpots\(/.test(ui) && /import \{ END_SNAP_TOL, snapToNearestSpots \} from '\.\/end-snap';/.test(ui),
    'the panel calls the imported rule rather than re-deriving the pairing');
  check(/const poses = this\.endTargetPoses\(\);/.test(ui) && /snapToNearestSpots\(board, poses\)/.test(ui),
    'and gives it the TURNED target poses, so the rotation the caller set is the one written');
  check(/out = placeDancerEnd\(out, i, poses\[snap\.pairing\[i\]\]\);/.test(ui),
    'the answer is applied through the engine\'s own placement - position AND rotation, path left alone');
  // THE DISABLED STATE, which is where the two buttons DIFFER: nothing to place disables both, but "cannot pair" is about
  // the SETUP's arrangement and the formation placement does not use it - so the second button is the way out there.
  const body = ui.slice(ui.indexOf('private renderEndTarget('), ui.indexOf('private renderEndPairing('));
  check(/this\.placeSetupBtn\.disabled = true;[\s\S]{0,120}?this\.placeFormationBtn\.disabled = true;/.test(body),
    'with no end setup chosen both buttons are disabled, because there is nothing to place onto');
  check(/cannot pair[\s\S]{0,1200}?this\.placeSetupBtn\.disabled = true;[\s\S]{0,120}?this\.placeFormationBtn\.disabled = false;/.test(body),
    'and when the SETUP cannot be paired at all, Place formation stays ENABLED - it does not use that pairing, so it is the way out');
  check(/this\.placeSetupBtn\.disabled = false;[\s\S]{0,80}?this\.placeFormationBtn\.disabled = false;/.test(body),
    'with a pairing both are enabled');
  // THE TOLERANCE IS A COPY IN THE HINT, so the sentence and the rule must agree - the drift would be silent and the
  // hint is the only place a caller reads the number.
  check(html.includes(`${END_SNAP_TOL.toFixed(2)} board units`),
    `the hint quotes the tolerance the rule uses (${END_SNAP_TOL.toFixed(2)} board units)`);
  check(!/Place end</.test(html) && !/doPlaceEnd\b/.test(ui),
    'the old name is gone from the markup and the methods, not left as a second convention');
  // THE ACTIONS ARE ON THEIR OWN LINE. Asked for as: "Move the folowing 'End Setup' buttons onto the next line: 'Export
  // <formation>', 'Place Setup', 'Place Formation', 'Connect End'. This is because the list of end setups is so compressed
  // that the current selection is unreadable." Rows are measured by SPLITTING the markup on the row element, so the check
  // is about which row a control is in rather than about whitespace or attribute order.
  const rows = html.split('<div class="row">');
  const rowOf = (id) => rows.findIndex((chunk) => chunk.includes(`id="${id}"`));
  const picker = rowOf('edEndFormation');
  check(picker > 0 && rows[picker].includes('id="edEndNearFilter"') && rows[picker].includes('id="edEndSpin"'),
    'the End setup picker keeps the near filter and the turn control on ITS line - the turn is the picker\'s own readout');
  check(picker > 0 && ['edExportEndFormation', 'edPlaceSetup', 'edPlaceFormation', 'edConnectEnd'].every((id) => rowOf(id) === picker + 1),
    `and its four actions are on the NEXT line, so the picker has the row to itself (row ${picker} carries the picker, row ${picker + 1} the actions)`);
  check(picker > 0 && !['edExportEndFormation', 'edPlaceSetup', 'edPlaceFormation', 'edConnectEnd'].some((id) => rows[picker].includes(`id="${id}"`)),
    'none of them is left behind on the picker\'s line, which is the compression the change removed');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
