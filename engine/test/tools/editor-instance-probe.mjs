// Probe: what does the call-instance editor actually see?
//
// Prints, for a full-set call (ms/circle.xml) and a half-set one (b1/circle.xml):
//   - the instance table (start/end pose, derived couple/id, beats, move count)
//   - whether `normalizeInstance` is EXACT (poses identical at 0, mid, beats)
//   - what `setDancerStart` / `setDancerEnd` / `setMove` do to the end pose and beats
//   - whether `callToXml` round-trips a `sequencer="no"` tam
//
// Usage: node engine/test/tools/editor-instance-probe.mjs
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
  instanceTable,
  instanceBeats,
  normalizeInstance,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  setMove,
  addMove,
  removeMove,
  callToXml,
} from '../../dist/index.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('../../../poc/src/assets/moves.xml');
const formationsXml = read('../../../poc/src/assets/formations.xml');
const moves = parseMoves(movesXml);
const formations = parseFormations(formationsXml);

const f = (n, d = 3) => (typeof n === 'number' ? n.toFixed(d) : String(n));
const deg = (r) => f((r * 180) / Math.PI, 1);

function dump(label, call) {
  console.log(`\n== ${label}: ${call.title} (from ${call.from}) ==`);
  console.log(`   dancers=${call.dancers.length} mirrored=${call.dancers.filter((d) => d.mirror).length} beats=${call.beats} maxPath=${f(instanceBeats(call))}`);
  for (const r of instanceTable(call)) {
    console.log(
      `   #${r.index + 1} ${r.gender.padEnd(6)} couple=${String(r.couple).padStart(4)} id=${String(r.id).padStart(4)}` +
        ` start(${f(r.start.x, 2)},${f(r.start.y, 2)} @${deg(r.start.heading)}°)` +
        ` end(${f(r.end.x, 2)},${f(r.end.y, 2)} @${deg(r.end.heading)}°)` +
        ` beats=${f(r.beats)} moves=${r.moves.length}`,
    );
  }
}

// ---- 1. exactness of normalizeInstance ----
function poseGap(a, b, t) {
  let worst = 0;
  for (let i = 0; i < a.dancers.length; i++) {
    const p = poseFor(a.dancers[i], t);
    const q = poseFor(b.dancers[i], t);
    worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y), Math.abs(p.heading - q.heading));
  }
  return worst;
}

// The "half set" witness was `b1/circle.xml`, removed with the Basic levels; `ms/circle.xml` carries
// asymmetric tams of its own (the `Single Circle Left/Right …` family), so the case stays reachable.
for (const [label, file] of [['full set', '../../../poc/src/assets/ms/circle.xml'], ['half set', '../../../poc/src/assets/ms/circle.xml'], ['sashay', '../../../poc/src/assets/ms/sashay.xml']]) {
  const call = loadCallFromXml(read(file), movesXml, formationsXml, 0, true);
  dump(label, call);
  const norm = normalizeInstance(call);
  const mid = call.beats / 2;
  console.log(
    `   normalizeInstance gaps: t=0 ${f(poseGap(call, norm, 0), 12)}  mid ${f(poseGap(call, norm, mid), 12)}  end ${f(poseGap(call, norm, call.beats), 12)}` +
      `  idempotent=${poseGap(norm, normalizeInstance(norm), mid) === 0}  mirrored-after=${normalizeInstance(norm).dancers.filter((d) => d.mirror).length}`,
  );
}

// ---- 2. mutators ----
const circle = loadCallFromXml(read('../../../poc/src/assets/ms/circle.xml'), movesXml, formationsXml, 0, true);
const base = instanceTable(circle);
const baseEnd = base.map((r) => r.end);
const baseBeats = circle.beats;

const moved = setDancerStart(circle, 0, { x: base[0].start.x + 2, y: base[0].start.y - 1, heading: base[0].start.heading });
const rowMoved = instanceTable(moved)[0];
console.log(
  `\n== setDancerStart(#1, +2,-1) ==\n   start moved (${f(rowMoved.start.x, 2)},${f(rowMoved.start.y, 2)})` +
    ` end delta (${f(rowMoved.end.x - baseEnd[0].x, 2)},${f(rowMoved.end.y - baseEnd[0].y, 2)}) [expect (2,-1)]` +
    ` beats ${moved.beats} (was ${baseBeats})`,
);
const rot = setDancerStart(circle, 0, { ...base[0].start, heading: base[0].start.heading + Math.PI / 2 });
const rowRot = instanceTable(rot)[0];
const dx = baseEnd[0].x - base[0].start.x;
const dy = baseEnd[0].y - base[0].start.y;
const rx = rowRot.end.x - rowRot.start.x;
const ry = rowRot.end.y - rowRot.start.y;
console.log(`   start +90°: end start-relative (${f(dx, 2)},${f(dy, 2)}) -> (${f(rx, 2)},${f(ry, 2)}) [expect (-dy,dx)=(${f(-dy, 2)},${f(dx, 2)})]`);

const reaim = setDancerEnd(circle, 3, { x: 0, y: 0, heading: 0 });
const rowReaim = instanceTable(reaim)[3];
console.log(`\n== setDancerEnd(#4, origin, 0°) ==\n   end (${f(rowReaim.end.x, 4)},${f(rowReaim.end.y, 4)} @${deg(rowReaim.end.heading)}°) beats ${reaim.beats} (was ${baseBeats})`);
let untouched = true;
for (const r of instanceTable(reaim)) if (r.index !== 3 && (Math.abs(r.end.x - baseEnd[r.index].x) > 1e-9 || Math.abs(r.end.y - baseEnd[r.index].y) > 1e-9)) untouched = false;
console.log(`   every other dancer's end unchanged: ${untouched}; moves unchanged count: ${instanceTable(reaim)[3].moves.length === base[3].moves.length}`);

// retime: stretch one dancer's longest move
const longest = base.reduce((m, r, i) => (r.beats > base[m].beats ? i : m), 0);
const stretched = setMove(circle, longest, 0, { ...base[longest].moves[0], beats: base[longest].moves[0].beats + 2 });
console.log(
  `\n== setMove(#${longest + 1}, move 0, +2 beats) ==\n   call beats ${stretched.beats} (was ${baseBeats}); maxPath ${f(instanceBeats(stretched))}`,
);
const grown = addMove(circle, 0, { beats: 1, hands: 'none', translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null });
console.log(`   addMove(#1, 1 beat zero-travel): move count ${instanceTable(grown)[0].moves.length} beats ${grown.beats}`);
const shrunk = removeMove(circle, 0, 0);
console.log(`   removeMove(#1, 0): move count ${instanceTable(shrunk)[0].moves.length} beats ${shrunk.beats}`);

// gender = arrangement
const swapped = setDancerGender(circle, 0, 'girl');
console.log(`   setDancerGender(#1, girl): couple read ${instanceTable(swapped)[0].couple} (was ${base[0].couple})`);

// ---- 3. XML fidelity ----
const noTam = parseCallXml(read('../../../poc/src/assets/a1/ends_bend.xml')).find((t) => t.sequencerMode === 'no');
if (noTam) {
  const b = buildCall(noTam, formations, moves, true);
  const xml = callToXml(b);
  const back = buildCall(parseCallXml(xml)[0], formations, moves, false);
  console.log(
    `\n== XML fidelity ==\n   ${noTam.title}: seq ${noTam.sequencerMode} -> xml has sequencer=${/<tam [^>]*sequencer="([^"]*)"/.exec(xml)?.[1]} -> reparse ${back.sequencerMode} forSequencer=${back.forSequencer}`,
  );
}
const tamator = parseCallXml(read('../../../poc/src/assets/a1/cast_a_shadow.xml')).find((t) => t.taminator);
if (tamator) {
  const b = buildCall(tamator, formations, moves, true);
  const back = buildCall(parseCallXml(callToXml(b))[0], formations, moves, false);
  console.log(`   ${tamator.title}: taminator ${JSON.stringify(tamator.taminator.slice(0, 30))} -> reparse ${JSON.stringify(back.taminator.slice(0, 30))}`);
}
