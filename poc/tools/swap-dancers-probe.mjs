// Probe: SWITCHING TWO DANCERS - the `⇄` button over the tick column, and the engine call behind it.
//
// Asked for: "Add a small button above the dancer select column that is normally greyed out and disabled unless
// two dancers are selected. With two dancers selected, the button will switch the selected dancers. Use a button
// icon something like a double ended arrow to indicate switch or swap."
//
// The question in that is not the button, it is WHAT moves - and the answer is decided by how a path is stored:
// a path is authored in the dancer's OWN frame (`types.ts`: +X is the dancer's initial facing and P0 is its own
// origin). So the version that leaves a coherent board is the whole ENTRY trading places - start pose, path,
// gender, mirror flag - and this probe measures that rather than asserting it:
//
//   1. the swap exchanges the two entries field for field, and touches nobody else;
//   2. THE BOARD IS UNCHANGED AS A PICTURE: the multiset of world tracks is identical before and after, so what
//      the caller sees is the same dance with two numbers swapped rather than two re-framed paths;
//   3. it is an involution and commutative, it leaves the beat clock alone, swapping a dancer with itself is the
//      identity, and an index outside the set is refused out loud;
//   4. SHOWN TO FAIL: swapping the PATHS ALONE - the obvious cheaper edit - does NOT keep the board, because each
//      path is then re-framed by the other dancer's start pose. That is the measurement behind the doc comment,
//      and without it "swap the whole entry" would be a preference rather than a finding.
//
// Run: node tools/swap-dancers-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
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

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// THE CALLS: every ms-level setup that builds, exactly as the panel loads them.
const calls = [];
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  try {
    const call = engine.normalizeInstance(engine.loadCallFromXml(asset(path.join('ms', f)), movesXml, formationsXml, 0));
    if (call.dancers.length === 8) calls.push({ file: f, call });
  } catch {
    /* not a call setup */
  }
}
console.log('== What is being swept ==');
console.log(`    ${calls.length} calls in the ms level`);
const pairsFor = (call) => {
  const out = [];
  for (let a = 0; a < call.dancers.length; a++) for (let b = a + 1; b < call.dancers.length; b++) out.push([a, b]);
  return out;
};

/** The whole dancer entry, as a comparable string - every field a swap could move. */
const entry = (d) => JSON.stringify({
  gender: d.gender, x: d.x, y: d.y, angleDeg: d.angleDeg, mirror: !!d.mirror,
  path: d.path.map((s) => [s.x1, s.y1, s.cx1, s.cy1, s.cx2, s.cy2, s.x2, s.y2, s.beats, s.hands, s.rotate ?? null]),
});

/**
 * WHERE EVERY DANCER IS, sampled along the whole call - the world path, not the stored one.
 *
 * This is the board: `poseFor` composes the dancer's start pose with its own local chain, which is exactly the
 * step a paths-only swap leaves half-done. Returns the samples ROUNDED, because two ways of reaching the same
 * pose can differ in the last ulp and the claim here is about the picture, not about float bits.
 */
const tracks = (call) => {
  const beats = engine.instanceBeats(call);
  const out = [];
  for (let i = 0; i < call.dancers.length; i++) {
    const d = call.dancers[i];
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const p = engine.poseFor(d, (beats * k) / 40);
      pts.push(`${p.x.toFixed(6)},${p.y.toFixed(6)},${((p.heading * 180) / Math.PI).toFixed(4)}`);
    }
    out.push(`${d.gender}|${pts.join(';')}`);
  }
  return out;
};
/** The board as a SET of tracks: relabelled, not moved. */
const trackSet = (call) => [...tracks(call)].sort().join('\n');

// ---------------------------------------------------------------- 1. what the swap exchanges
console.log('\n== 1. the two entries trade places, and nobody else moves ==');
{
  let checked = 0;
  let badPair = 0;
  let badOther = 0;
  for (const { call } of calls) {
    for (const [a, b] of pairsFor(call)) {
      const next = engine.swapDancers(call, a, b);
      checked++;
      if (entry(next.dancers[a]) !== entry(call.dancers[b]) || entry(next.dancers[b]) !== entry(call.dancers[a])) badPair++;
      for (let j = 0; j < call.dancers.length; j++) {
        if (j === a || j === b) continue;
        if (entry(next.dancers[j]) !== entry(call.dancers[j])) badOther++;
      }
    }
  }
  check(badPair === 0, `entry a holds exactly what entry b held (and the reverse) at all ${checked} pairs over ${calls.length} calls`);
  check(badOther === 0, 'and every dancer NOT in the pair is byte-for-byte what it was');
  check(checked === calls.length * 28, `the sweep is EVERY pair of every call that builds: ${checked} pairs = ${calls.length} x 28`);
}

// ---------------------------------------------------------------- 2. the board as a picture
console.log('\n== 2. the BOARD is a relabelling, not a redrawing ==');
{
  let sameSet = 0;
  let total = 0;
  let genderMovesWithTrack = 0;
  for (const { call } of calls) {
    const before = trackSet(call);
    for (const [a, b] of pairsFor(call)) {
      const next = engine.swapDancers(call, a, b);
      total++;
      if (trackSet(next) === before) sameSet++;
      // The gender is part of the entry, so it must arrive at the other index WITH the track.
      if (next.dancers[a].gender === call.dancers[b].gender && next.dancers[b].gender === call.dancers[a].gender) genderMovesWithTrack++;
    }
  }
  check(sameSet === total, `the multiset of world tracks is IDENTICAL before and after at all ${total} pairs - the same dance with two numbers swapped`);
  check(genderMovesWithTrack === total, 'and the genders travel with the tracks they belong to, so the call\'s arrangement reads the same');
}

// ---------------------------------------------------------------- 3. the algebra, and the refusal
console.log('\n== 3. the algebra it has to have ==');
{
  let involution = 0;
  let commutes = 0;
  let beatsKept = 0;
  let total = 0;
  for (const { call } of calls) {
    const beforeBeats = engine.instanceBeats(call);
    for (const [a, b] of pairsFor(call)) {
      total++;
      const back = engine.swapDancers(engine.swapDancers(call, a, b), a, b);
      if (call.dancers.every((d, j) => entry(d) === entry(back.dancers[j]))) involution++;
      const ab = engine.swapDancers(call, a, b);
      const ba = engine.swapDancers(call, b, a);
      if (ab.dancers.every((d, j) => entry(d) === entry(ba.dancers[j]))) commutes++;
      if (engine.instanceBeats(ab) === beforeBeats) beatsKept++;
    }
  }
  check(involution === total, `swapping the same two back restores the call exactly, at all ${total} pairs`);
  check(commutes === total, 'the order the two are named in does not matter - `swapDancers(call, a, b) === swapDancers(call, b, a)`');
  check(beatsKept === total, 'and the beat clock is untouched, the multiset of paths being the same');

  const { call } = calls[0];
  const self = engine.swapDancers(call, 0, 0);
  check(call.dancers.every((d, j) => entry(d) === entry(self.dancers[j])),
    'swapping a dancer with itself is the identity - answered rather than refused, since asking for nothing is not an error');
  const throws = (fn) => { try { fn(); return null; } catch (e) { return String(e.message ?? e); } };
  const low = throws(() => engine.swapDancers(call, -1, 2));
  const high = throws(() => engine.swapDancers(call, 0, 8));
  const frac = throws(() => engine.swapDancers(call, 0, 1.5));
  check(!!low && /out of range/.test(low) && /instance has 8/.test(low),
    `an index outside the set is refused out loud rather than silently doing nothing: "${low}"`);
  check(!!high && !!frac, 'and so is one past the end, and one that is not a whole number');
}

// ---------------------------------------------------------------- 4. SHOWN TO FAIL: paths alone
//
// THE CHEAPER EDIT THE FIX COULD HAVE BEEN, and the reason it is not. Copying the two PATHS onto each other's
// dancer is one `setDancerPath` per side, it is the operation the paperclip already performs, and it is WRONG
// here for a reason that only shows up in world coordinates: a path is stored in the dancer's own frame, so
// handing it to a dancer standing somewhere else re-frames every move into a frame it was not authored in. Each
// path then departs from a pose it does not start at.
console.log('\n== 4. the negative control: swapping the PATHS ALONE does not keep the board ==');
{
  let tested = 0;
  let broken = 0;
  let worst = 0;
  for (const { call } of calls) {
    const before = trackSet(call);
    for (const [a, b] of pairsFor(call)) {
      let next = engine.setDancerPath(call, a, call.dancers[b].path);
      next = engine.setDancerPath(next, b, call.dancers[a].path);
      tested++;
      const after = trackSet(next);
      if (after !== before) {
        broken++;
        // How far the picture moves, on the first sample that disagrees.
        const t0 = tracks(call);
        const t1 = tracks(next);
        for (let i = 0; i < t0.length; i++) {
          if (t0[i] === t1[i]) continue;
          const p0 = t0[i].split('|')[1].split(';').map((s) => s.split(',').map(Number));
          const p1 = t1[i].split('|')[1].split(';').map((s) => s.split(',').map(Number));
          for (let k = 0; k < p0.length; k++) worst = Math.max(worst, Math.hypot(p0[k][0] - p1[k][0], p0[k][1] - p1[k][1]));
        }
      }
    }
  }
  console.log(`    paths-only swap at ${tested} pairs: ${broken} of them draw a DIFFERENT board (worst dancer moves ${worst.toFixed(3)} units)`);
  check(broken > tested * 0.5,
    'swapping only the paths redraws the board at most pairs, which is exactly why the start pose moves with the path');
  check(worst > 0.1,
    `and it is not a rounding difference: the worst pose moves ${worst.toFixed(3)} units, which is visible on the floor`);
}

// ---------------------------------------------------------------- 5. the panel wiring
console.log('\n== 5. the button, read from the panel and the stylesheet ==');
{
  const read = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8');
  const src = read('src/editor-ui.ts');
  const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, ' ');

  check(/private swapDancersBtn\(\): HTMLButtonElement \{/.test(src), 'the panel builds the button in one function');
  check(/r1\.firstElementChild\?\.appendChild\(this\.swapDancersBtn\(\)\);/.test(src),
    'and puts it in the FIRST cell of the header\'s top row - the one directly over the tick column, which is where it was asked for');
  check(/btn\.disabled = !ready;/.test(src) && /const ready = pair\.length === 2;/.test(src),
    'it is DISABLED unless exactly two dancers are ticked - greyed out rather than hidden, which is what was asked for');
  check(/'⇄'/.test(src), 'the icon is the double-ended arrow that was asked for');
  check(/swapDancers\(this\.instance, a, b\), 'swap'/.test(src),
    'and the press is one engine call, so the panel does not restate which fields move');
  check(/if \(!this\.instance \|\| pair\.length !== 2\) return;/.test(src),
    'with the same two-dancer rule re-checked at the action, so the button is not the only guard');
  check(/dancer \$\{a \+ 1\} and dancer \$\{b \+ 1\} switched/.test(src), 'and the status line names the two dancers it switched');
  check(/#editorPanel \.ed-table \.ed-swap \{/.test(css) && /width: 18px; height: 16px/.test(css),
    'the stylesheet sizes it as the small icon button it is, at the panel\'s own specificity');
  check(!/#editorPanel \.ed-table \.ed-swap:disabled/.test(css) && /#editorPanel button:disabled \{ opacity: 0\.4; cursor: not-allowed; \}/.test(css),
    'and the disabled look is the panel\'s ONE rule for a disabled button rather than a second one here');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
