// P16 ANALYSIS TOOL, step 2: split the "catalogue tam has no setup for this board"
// failures into the two things that actually need different work.
//
// setup-coverage.mjs answered "is the size/scale right?" and left 34 cases as
// ARRANGEMENT - same size, same scale, different shape. But "different shape" hides the
// question the phase actually has to answer before authoring a single setup:
//
//   SETUP GAP   the board is a legitimate formation and the call SHOULD apply to it -
//               the call's authored setups just do not cover this arrangement.
//   BODY ERROR  the board is not a formation the engine can even name, or the dancers are
//               not arranged the way the call's own definition requires. Authoring a
//               setup for it would enshrine a bug in the preceding call, and the call
//               failing is a SYMPTOM, not the fault.
//
// Three measurements separate them:
//
//   1. DECOMPOSITION. matchFormations folds position and facing into one number
//      (facing counts 0.5 per radian, match.ts:105). Re-running the match with all
//      headings zeroed finds the best POSITIONAL alignment on its own; the facings are then
//      scored under that same mapping. If the positions overlay a setup and only the
//      facings differ, the failure is not an arrangement gap at all.
//
//   2. RECOGNITION. knownFormation/recognize on the board itself. An unnamed board is a
//      board whose arrangement the engine does not believe in.
//
//   3. PREFIX SCAN, which is the one that actually decides it. Every call before the
//      failing one was LEGAL - the engine accepted it. But `legal` only means a setup
//      matched and a body ran; it does NOT mean the body produced the arrangement the call
//      actually calls for. So the chain is replayed and every intermediate board is named.
//      The FIRST call whose output board the engine cannot name is the suspect: everything
//      after it is operating on an arrangement that does not exist, and the setup the
//      census wants authored would enshrine it.
//
// The board's own facing table is printed for every case, because "should this call apply
// here" is a question only the call's CALLERLAB definition can answer, and that definition
// is about which way the dancers face.
//
//   node test/tools/setup-split.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { splitSelection } from '../../dist/sequencer/selection.js';
import { Grouping } from '../../dist/sequencer/grouping.js';
import { matchFormations } from '../../dist/sequencer/match.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { ALL8_FIGURE_START } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const grouping = new Grouping(seq.applicator ?? null);
const data = loadAll8Figures();

const phys = (b) => b.dancers.filter((d) => !d.isGhost);
const spread = (pts) => {
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
};
const angDiff = (a, b) => {
  let d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
};
/** Compass character for a heading (0 = +X = east, ccw positive). */
const faceChar = (h) => 'N NE E SE S SW W NW'.split(' ')[Math.round((((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];

const toMatchable = (d, zeroHeading = false) => ({ x: d.x, y: d.y, heading: zeroHeading ? 0 : d.heading, gender: d.gender, couple: d.couple });

// Every failing case, with the whole call chain so the board can be judged in context.
const cases = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let b = seq.boardForFormation(ALL8_FIGURE_START);
  const boards = [{ call: '(start)', board: b, formation: seq.knownFormation(b) }];
  for (let i = 0; i < calls.length; i++) {
    const r = seq.applyToBoard(b, calls[i]);
    if (!r.legal) {
      if (/No setup in this call matches/.test(r.reason ?? '')) cases.push({ fig: f.id, idx: i, call: calls[i], board: b, chain: calls.slice(0, i), boards });
      break;
    }
    b = r.board;
    boards.push({ call: calls[i], board: b, formation: seq.knownFormation(b) });
  }
}

// The prefix scan: the first call in the chain whose OUTPUT board the engine cannot name.
// `(start)` is included, so a chain that is already unnamed going in says so.
const firstUnnamed = (boards) => boards.find((x) => !x.formation) ?? null;

const rows = [];
for (const c of cases) {
  const sel = splitSelection(c.call);
  const variants = seq.variantStarts(sel.call);
  const boardPts = phys(c.board);
  const ids = sel.selection ? grouping.resolveSelection(c.board, sel.selection) : null;
  const groupPts = ids ? boardPts.filter((d) => ids.includes(d.id)) : null;
  const target = groupPts && groupPts.length >= 2 ? groupPts : boardPts;
  const n = target.length;
  const sameSize = variants.filter((v) => v.length === n);

  // The board is judged as a formation in its own right first.
  const known = seq.knownFormation(c.board);
  const rec = seq.recognize(c.board);

  let bestPos = null; // the best POSITIONAL overlay of a same-size setup, facings ignored
  for (const v of sameSize) {
    const src0 = target.map((d) => toMatchable(d, true));
    const tgt0 = v.map((d) => toMatchable(d, true));
    // Headings are zeroed on BOTH sides, so the match is purely positional and the
    // reported error is the total positional offset (match.ts:105 collapses to distance).
    const m0 = matchFormations(src0, tgt0, 1e3);
    if (!m0) continue;
    const posErr = m0.error / n;
    // Score the REAL facings under that positional mapping.
    const faces = target.map((d, i) => angDiff(d.heading, v[m0.mapping[i]].heading + m0.rot + (m0.reflect ? Math.PI : 0)));
    const faceMean = faces.reduce((a, b) => a + b, 0) / n;
    const faceMax = Math.max(...faces);
    const cand = { variant: v, posErr, faceMean, faceMax, wrong: faces.filter((f) => f > 0.2).length, reflect: m0.reflect };
    if (!bestPos || cand.posErr < bestPos.posErr) bestPos = cand;
  }

  let verdict, detail;
  if (sameSize.length === 0 || !bestPos) {
    verdict = 'NO-POSITIONAL-MATCH';
    detail = 'no same-size setup overlays the board positionally at all (a different shape)';
  } else if (bestPos.posErr <= 0.15 && bestPos.wrong > 0) {
    verdict = 'FACING';
    detail = `positions overlay a setup (mean offset ${bestPos.posErr.toFixed(2)}) but ${bestPos.wrong}/${n} face the wrong way (max ${((bestPos.faceMax * 180) / Math.PI).toFixed(0)} deg)`;
  } else if (bestPos.posErr <= 0.15) {
    verdict = 'EXACT';
    detail = `positions AND facings overlay a setup (mean offset ${bestPos.posErr.toFixed(2)}) - the match is being rejected elsewhere`;
  } else {
    verdict = 'SHAPE';
    detail = `nearest same-size setup is ${bestPos.posErr.toFixed(2)} off per dancer positionally`;
  }
  rows.push({ ...c, target, n, verdict, detail, known, rec: rec.name, bestPos, suspect: firstUnnamed(c.boards) });
}

// === the split that decides the phase =====================================================
// A case is a SETUP GAP only when every board on the way to it - the start board, every
// intermediate result, and the board the failing call faces - is an arrangement the engine
// can name. Anything else is a BODY ERROR first: the call to author a setup for is not the
// failing one, it is the one that landed the dancers in an arrangement that does not exist.
const gaps = rows.filter((r) => !r.suspect);
const broken = rows.filter((r) => r.suspect);

console.log(`=== ${rows.length} figures stop with "no setup in this call matches the current formation" ===`);
const byV = new Map();
for (const r of rows) byV.set(r.verdict, (byV.get(r.verdict) ?? 0) + 1);
console.log('  ' + [...byV.entries()].sort((a, b) => b[1] - a[1]).map(([v, k]) => `${v} ${k}`).join('   '));

console.log('\n=== THE SPLIT (prefix scan: is every board on the way here a NAMED formation?) ===');
console.log(`  SETUP GAP   ${String(gaps.length).padStart(3)}  the arrangement is real; the call has no setup for it`);
console.log(`  BODY ERROR  ${String(broken.length).padStart(3)}  the board is already an arrangement the engine cannot name`);
console.log('\n  the first unnamed board in each broken chain, which is the call to look at:');
const bySuspect = new Map();
for (const r of broken) bySuspect.set(r.suspect.call, (bySuspect.get(r.suspect.call) ?? 0) + 1);
for (const [k, n] of [...bySuspect.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  after ${k}`);

console.log('\n=== the SETUP GAP cases (these are the ones a setup can fix) ===');
for (const r of gaps) console.log(`  ${r.fig}  ${r.call.padEnd(24)} ${r.verdict.padEnd(20)} ${r.known.padEnd(22)} ${r.detail}`);

console.log('\n=== the BODY ERROR cases ===');
for (const r of broken) {
  const k = r.boards.indexOf(r.suspect);
  console.log(`  ${r.fig}  ${r.call.padEnd(22)} stops after ${r.chain.join(' | ') || '(start)'}`);
  console.log(`      broken at ${k}: "${r.suspect.call}" -> ${r.suspect.formation ?? '(unnamed)'}   (failing call faces ${fmtBoard(r.suspect.board)})`);
}

console.log('\n=== per case: the named formation after every call in the chain ===');
for (const r of rows) {
  console.log(`\n${r.fig}  ${r.call}   [${r.verdict}]  -> ${r.suspect ? 'BODY ERROR' : 'SETUP GAP'}`);
  for (const b of r.boards) console.log(`    ${b.formation ? '  ' : '!!'} ${b.call.padEnd(24)} ${b.formation ?? '(unnamed)'}`);
  console.log(`  ${r.detail}`);
  console.log(`  board:     ${fmtBoard(r.suspect?.board ?? r.board)}`);
}

function fmtBoard(b) {
  return phys(b).map((d) => `${d.id}${d.gender === 'boy' ? 'B' : 'G'}@(${d.x.toFixed(1)},${d.y.toFixed(1)})${faceChar(d.heading)}`).join(' ');
}
