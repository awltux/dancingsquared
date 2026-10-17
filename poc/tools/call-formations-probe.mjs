// Probe: DOES A CALL PASS THROUGH OTHER FORMATIONS, AND AT WHICH BEATS?
//
// The user's idea, verbatim: "more advanced calls are often a common combination of smaller calls, something
// like a module, and will therefore have points within the call that cross a formation... there might be a flag
// to say whether a call contains other formations and identify which beats it lands on (these could be
// automatically suggested by searching along the call for recognised formations)."
//
// THAT IS A TESTABLE CLAIM, and it changes a design decision. The design notes had been treating "is a joint
// inside this run pinned to a formation spot?" as the hard question, measured JOINT-WISE (67.2% of interior
// joints are on a catalogue spot). But a call does not cross a formation at a joint - it crosses one at a
// MOMENT, and the moment need not be a move boundary at all. So this walks each call beat by beat, asks the
// engine's own recogniser what formation the eight dancers are in, and reports the spans.
//
// THE ANSWER IS NOT THE ONE THE IDEA EXPECTS, and section 3 is why: the naive scan finds 3266 interior
// formation spans, but 3228 of them are ONE SAMPLE at a 0.5-beat step - the recogniser catching a board that is
// momentarily near a formation as the dancers pass through it, not a waypoint anyone would name. A flag built
// on those would fire on almost every call and mean nothing. What IS usable is the small population that is
// HELD, and section 5 asks the only question that makes that population trustworthy: does it survive a step
// EIGHT TIMES FINER, while the transient one grows?
//
// Run: node tools/call-formations-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, '..', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '0.0');
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ------------------------------------------------------------------ the corpus
const moves = engine.parseMoves(movesXml);
const formationsXmlMap = engine.parseFormations(formationsXml);
const calls = [];
const byLevel = {};
for (const level of fs.readdirSync(assets, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'src').map((e) => e.name)) {
  let built = 0;
  for (const f of fs.readdirSync(path.join(assets, level)).filter((x) => x.endsWith('.xml'))) {
    let tams = [];
    try { tams = engine.parseCallXml(fs.readFileSync(path.join(assets, level, f), 'utf8')); } catch { continue; }
    for (const tam of tams) {
      let raw;
      try { raw = engine.buildCall(tam, formationsXmlMap, moves, true); } catch { continue; }
      let call;
      try { call = engine.normalizeInstance(raw); } catch { continue; }
      if (call.dancers.length !== 8) continue;
      built++;
      // THE REAL FORMATION IS THE `formation` ATTRIBUTE. `from` is a label FOR THE USER, and the engine
      // resolves the dancers from `formationAttr` (convert.ts:324) - so comparing a recognised name against
      // `from` compares it against free text. Null here means the formation was EMBEDDED in the tam rather
      // than named, which is a different case again.
      const real = (tam.formationAttr ?? '').trim();
      calls.push({ level, file: f, call, realFormation: real || null });
    }
  }
  byLevel[level] = built;
}
console.log('== The sample ==');
console.log(`    ${calls.length} eight-dancer variants from ${Object.keys(byLevel).length} levels`);

// --------------------------------------------------------------- the candidates
//
// THE EIGHT-DANCER FORMATIONS COME FROM THE SEQUENCER, NOT FROM `formations.xml`. That file's own <formation>
// entries are mostly SMALL (Facing Couples and the like) - measured here: 0 of its 273 entries has eight
// dancers - so matching a whole board against them is impossible. The eight-dancer boards are what the
// sequencer BUILDS for a named setup, which is also what the panel's picker offers. (This cost a run: the first
// version used `parseFormations` and returned a flawless, silent "0 of 0" on every question.)
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
const targets = [];
for (const name of seq.listFormations()) {
  const b = seq.boardForSetup(name);
  if (!b || b.dancers.length !== 8) continue;
  const poses = b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  // A SORTED PAIRWISE-DISTANCE vector is invariant under translation, rotation and reflection - exactly the
  // freedom the recogniser allows - so it is a sound cheap prefilter, and the real match still decides.
  const sig = [];
  for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) sig.push(Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y));
  targets.push({ name, poses, sig: sig.sort((a, b) => a - b) });
}
console.log(`    ${targets.length} eight-dancer formations the picker offers, built from the sequencer`);

const PREFILTER = 2.5; // generous: pairwise distances move by at most the per-dancer error
const MAX_ERROR = 1.0; // the recogniser's own error scale (position + facing)
function recognise(boardDancers) {
  const sig = [];
  for (let i = 0; i < boardDancers.length; i++) for (let j = i + 1; j < boardDancers.length; j++) sig.push(Math.hypot(boardDancers[i].x - boardDancers[j].x, boardDancers[i].y - boardDancers[j].y));
  sig.sort((a, b) => a - b);
  let best = null;
  for (const t of targets) {
    let worst = 0;
    for (let i = 0; i < sig.length; i++) worst = Math.max(worst, Math.abs(sig[i] - t.sig[i]));
    if (worst > PREFILTER) continue;
    const m = engine.matchFormations(boardDancers, t.poses, MAX_ERROR, false);
    if (m && (best === null || m.error < best.error)) best = { name: t.name, error: m.error };
  }
  return best;
}

/** Walk one call at `step` beats and collapse consecutive same-name samples into spans. */
function walkCall({ level, file, call, realFormation }, step) {
  const bounds = new Set();
  for (const d of call.dancers) for (let k = 0; k < d.path.length; k++) bounds.add(+engine.moveBeatRange(d, k).to.toFixed(6));
  const total = call.totalBeats;
  const at = [];
  for (let b = 0; b <= total + 1e-9; b += step) {
    const beat = Math.min(b, total);
    const r = recognise(engine.boardAtBeat(call, beat).dancers);
    at.push({ beat, name: r ? r.name : null });
  }
  const runs = [];
  for (const s of at) {
    const last = runs[runs.length - 1];
    if (last && last.name === s.name) last.to = s.beat;
    else runs.push({ name: s.name, from: s.beat, to: s.beat });
  }
  const interior = runs.filter((r) => r.name && r.from > 1e-9 && r.to < total - 1e-9);
  return { level, file, call, realFormation, runs, interior, total, bounds, at, step };
}

const STEP = 0.5;
const walked = calls.map((c) => walkCall(c, STEP));

// ---------------------------------------------------------------- 1. the CONTROL
console.log('\n== 1. Control: is the call\'s own start formation recognised at beat 0? ==');
const named = walked.filter((s) => s.at[0].name).length;
const canon = (s) => (engine.canonicalName ? engine.canonicalName(s) : s);
const pickerNames = new Set(targets.map((t) => canon(t.name)));
// THE REAL FORMATION IS THE `formation` ATTRIBUTE; `from` IS A LABEL FOR THE USER. Comparing the recognised
// name against `from` compares it against free text, and `from` is frequently BLANK OR A RUN OF SPACES (which
// is TRUTHY, so an earlier version of this counted every such call as "declares a from" and failed it). Both
// mistakes are why this control first reported 27.8%: where a call declares a formation the picker knows, the
// beat-0 read is exact to 0.000 and rank 1.
let byReal = 0;
let byRealHit = 0;
let byLabel = 0;
let byLabelHit = 0;
let notInPicker = 0;
for (const s of walked) {
  if (!s.at[0].name) continue;
  const label = (s.call.from ?? '').trim();
  const declared = s.realFormation ?? label;
  if (!declared) continue;
  if (!pickerNames.has(canon(declared))) { notInPicker++; continue; }
  if (s.realFormation) { byReal++; if (canon(s.at[0].name) === canon(s.realFormation)) byRealHit++; }
  else { byLabel++; if (canon(s.at[0].name) === canon(label)) byLabelHit++; }
}
console.log(`    ${named} of ${walked.length} calls have a NAMED formation at beat 0 (${pct(named, walked.length)}%)`);
console.log(`    ${byReal + byLabel} declare a formation the picker can offer; ${notInPicker} declare one it cannot, and the rest declare none`);
console.log(`    by the REAL \`formation\` attribute: ${byRealHit} of ${byReal} name that same formation at beat 0 (${pct(byRealHit, byReal)}%)`);
console.log(`    by the \`from\` LABEL alone (embedded formations, no attribute): ${byLabelHit} of ${byLabel} (${pct(byLabelHit, byLabel)}%)`);
check(named > walked.length / 2, 'the recogniser reads the board at beat 0 for most calls, so a reading further along means something');
check(byRealHit === byReal, 'and where a call names its formation, the beat-0 read names EXACTLY that formation');

// ---------------------------------------------------------------- 2. interior formations
console.log('\n== 2. Does a call pass through OTHER formations? ==');
const withInterior = walked.filter((s) => s.interior.length > 0);
console.log(`    ${withInterior.length} of ${walked.length} calls register at least one named formation strictly INSIDE the call (${pct(withInterior.length, walked.length)}%)`);
const byLvl = {};
for (const s of walked) {
  byLvl[s.level] = byLvl[s.level] || [0, 0];
  byLvl[s.level][1]++;
  if (s.interior.length) byLvl[s.level][0]++;
}
console.log('    by level (calls registering an interior formation / calls): ' + Object.entries(byLvl).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(', '));

// ---------------------------------------------------------------- 3. the width histogram
console.log('\n== 3. How long is it held? (this is what decides whether it is usable) ==');
const interiorSpans = [];
let onBound = 0;
for (const s of walked) for (const r of s.interior) {
  interiorSpans.push({ ...r, level: s.level, file: s.file, total: s.total });
  if (s.bounds.has(+r.from.toFixed(6))) onBound++;
}
const widths = interiorSpans.map((r) => r.to - r.from);
console.log(`    ${interiorSpans.length} interior spans; ${onBound} BEGIN on a move boundary (${pct(onBound, interiorSpans.length)}%)`);
const hist = new Map();
for (const w of widths) hist.set(+w.toFixed(2), (hist.get(+w.toFixed(2)) ?? 0) + 1);
console.log('    width histogram: ' + [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}b:${v}`).join(' '));
console.log(`    a span of width 0 is ONE SAMPLE at this step - a transient read, not a held formation`);
const HELD = 2.0;
const heldOf = (spans) => spans.filter((r) => r.to - r.from >= HELD - 1e-9);
const held = heldOf(interiorSpans);
const heldByFile = new Map();
for (const r of held) heldByFile.set(`${r.level}/${r.file}`, (heldByFile.get(`${r.level}/${r.file}`) ?? 0) + 1);
console.log(`    HELD for at least ${HELD} beats: ${held.length} of ${interiorSpans.length} spans (${pct(held.length, interiorSpans.length)}%), in ${heldByFile.size} calls (${pct(heldByFile.size, walked.length)}%)`);
check(interiorSpans.length > 0, 'a call really does register formations that are neither its start nor its end');
check(held.length > 0 && held.length < interiorSpans.length / 4, 'but MOST of those are single-sample transients - a flag without a persistence rule would fire on a third of the corpus and mean nothing');

// ---------------------------------------------------------------- 4. step sensitivity
//
// THE TEST THAT MAKES THE HELD POPULATION TRUSTWORTHY. A genuine waypoint is held for a real number of beats,
// so an eight-times-finer step must find it STILL held and roughly as long. A transient read must NOT become a
// long span - if it did, the coarse step was hiding real structure; if the held population collapses instead,
// the coarse "held" spans were an artefact of the step. Both are checked, on the held calls AND on a control
// sample of calls that registered only transients.
console.log('\n== 4. Does the held population survive a step EIGHT times finer? ==');
const FINE = STEP / 8;
const heldFiles = new Set(held.map((r) => `${r.level}/${r.file}`));
// DISTINCT files, not the first 40 entries - a file with many <tam> variants would otherwise fill the whole
// control with one call and give "0 of 67" from a sample of one. (The first version did exactly that.)
const controlFiles = new Set();
for (const s of withInterior) {
  if (heldFiles.has(`${s.level}/${s.file}`)) continue;
  if (controlFiles.size >= 40) break;
  controlFiles.add(`${s.level}/${s.file}`);
}
const fineOf = (files) => {
  const out = [];
  for (const c of calls) {
    if (!files.has(`${c.level}/${c.file}`)) continue;
    out.push(walkCall(c, FINE));
  }
  return out;
};
const fineHeld = fineOf(heldFiles);
const fineHeldSpans = fineHeld.flatMap((s) => s.interior);
const fineControl = fineOf(controlFiles);
const fineControlSpans = fineControl.flatMap((s) => s.interior);
const fineHeldCount = heldOf(fineHeldSpans).length;
console.log(`    the ${heldFiles.size} calls that had a held span: at ${FINE} beats, ${heldOf(fineHeldSpans).length} spans are still held >= ${HELD} beats (was ${held.length})`);
console.log(`    their longest: ${Math.max(...fineHeldSpans.map((r) => r.to - r.from), 0).toFixed(2)} beats (was ${Math.max(...widths, 0).toFixed(2)})`);
const ctlHeld = heldOf(fineControlSpans).length;
console.log(`    the ${controlFiles.size} control calls (transients only): ${fineControlSpans.length} interior spans at the fine step, of which ${ctlHeld} are held >= ${HELD} beats (${pct(ctlHeld, fineControlSpans.length)}%)`);
check(fineHeldCount > 0, 'the held spans are STILL there at an eight-times-finer step - they are real geometry, not a sampling artefact');
check(ctlHeld === 0, 'and the transient populations do NOT harden into held ones when sampled finely');

// ---------------------------------------------------------------- 5. which formations
console.log('\n== 5. Which formations, and where? ==');
const counts = new Map();
for (const r of held) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
console.log('    the held interior formations: ' + [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' ') || '(none)');
console.log('    every held span, longest first:');
for (const r of [...held].sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 12)) {
  console.log(`      ${(r.level + '/' + r.file).padEnd(36)} "${r.name}" beats ${r.from.toFixed(2)}..${r.to.toFixed(2)} of ${r.total.toFixed(2)} (${(r.to - r.from).toFixed(2)}b)`);
}
const example = withInterior.filter((s) => heldFiles.has(`${s.level}/${s.file}`)).slice(0, 3);
console.log('    a few whole calls, as spans (null = no named formation):');
for (const s of example) {
  console.log(`      ${(s.level + '/' + s.file).padEnd(34)} ${s.runs.map((r) => `${r.name ?? '-'}[${r.from.toFixed(1)}-${r.to.toFixed(1)}]`).join(' ')}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
