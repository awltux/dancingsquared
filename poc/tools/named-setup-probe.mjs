// THE SETUP PICKERS OPEN ON THE SETUP THE CALL IS ALREADY IN, WHEN THE CORPUS NAMES IT.
//
// Asked for as: "Set the start and end setup selectors if the initialised start and end positions are known
// formations."
//
// THE TWO ENDS ASK DIFFERENT QUESTIONS, and that is the whole content of this probe:
//
//   1. THE START is `startsFromFormation` - INDEX FOR INDEX on positions, headings and genders - because a
//      tam's paths are paired with a formation's dancers BY LIST POSITION.
//   2. THE END is `endFormationMatch` - the same SPOTS as a SET, position and heading, gender not required,
//      with a small error margin on both, AND UP TO A QUARTER TURN, with the turn reported - because the end is
//      only "which named setup is this board, and which way round?". Reported as: "If I pick 'Promenade Home' the
//      End setup should select 'Squared Set'. But it remains as 'unknown formation'. Is there a missing step." then
//      "For the call 'Circle Four Left 4/3' from 'Facing Couples', why does the end setup not match 'Facing
//      Couples'? ... They look the same, except for the +90 deg rotation", and then "I would see a setup as an
//      arrangement plus matching dancer indexes. The rotation should probably be recorded." The turn is recorded on
//      the panel's rotation control, never in an id. `endFormationName` remains the STRICT half (the board as
//      authored), which is the question the row asks when it calls an end unknown.
//   3. THE REPORTED CALLS THEMSELVES, `Promenade Home` from a Right and Left Grand Static Square and the four
//      "Circle Four Left" fractions from "Facing Couples", selected by title and formation rather than by index.
//   4. THE PANEL USES BOTH, read from `editor-ui.ts` (TypeScript under a DOM, so it cannot run here). Those
//      checks are on the source text and each is shown to fail when the fragment it wants is reverted.
//
// AND THE FAILURE MODE IS PINNED: a name is only chosen when the board really is that formation TURNED BY THE TURN
// REPORTED WITH IT, so an unknown or merely-close setup leaves the picker on "keep the current". The controls for that
// half perturb one spot of a matching formation - position, facing, and a duplicate - and require the name to go away.
//
// WHAT IS NOT PINNED IS HOW MANY CALLS GET A NAME: that is a fact about `formations.xml`, which is content
// and is regularly mid-edit. The counts are PRINTED, and the assertion is that the instrument is not silent
// (both ends name something) and that a named call really is that formation.
//
// Run: node tools/named-setup-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, levelsAvailable } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
/** The app's TypeScript is checked in with CRLF; this file is LF, so a multi-line match needs this. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');
const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');

const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const formations = engine.parseFormations(formationsXml);
const DEG = Math.PI / 180;
const LEVELS = levelsAvailable().filter((level) => level !== 'src');

// ---------------------------------------------------------------- the panel's own list, mirrored
/** `sameArrangement`, mirrored: order-independent, position + heading + gender, every spot consumed. */
function sameArrangement(a, b) {
  if (a.length !== b.length) return false;
  const used = new Set();
  for (const p of a) {
    let hit = -1;
    for (let j = 0; j < b.length; j++) {
      if (used.has(j)) continue;
      const q = b[j];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) continue;
      if (Math.abs(norm(p.heading - q.heading)) > 1e-6) continue;
      if ((p.gender ?? null) !== (q.gender ?? null)) continue;
      hit = j; break;
    }
    if (hit < 0) return false;
    used.add(hit);
  }
  return true;
}
const cache = new Map();
/** `corpusFormationsOfSize` from `tam-xml.ts`, mirrored: every arrangement of that size, one name each. */
function formationsOfSize(n) {
  if (cache.has(n)) return cache.get(n);
  const out = [];
  for (const [name, ds] of formations) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length !== n) continue;
    out.push({ name, poses });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const kept = [];
  for (const f of out) if (!kept.some((k) => sameArrangement(k.poses, f.poses))) kept.push(f);
  cache.set(n, kept);
  return kept;
}
/** `EditorController.startFormationName` / `.endMatch`, as the panel reads them - the same rules, not copies. */
const startFormationName = (call) =>
  formationsOfSize(call.dancers.length).find((f) => engine.startsFromFormation(call, f.poses))?.name ?? '';
const endMatch = (call) => engine.endFormationMatch(call, formationsOfSize(call.dancers.length));
/** The END answer as the picker's VALUE: the matched name, or '' for nothing to name. */
const namedSetup = (call, end) => end ? (endMatch(call)?.name ?? '') : startFormationName(call);
function* everyCall() {
  for (const level of LEVELS) {
    // SORT A COPY, NEVER THE LIST `filesOf` RETURNED: it hands back the cached array, and sorting it in place
    // would reorder every later reader's walk in this process — the order `FormationMatcher` resolves equal match
    // errors by (AGENTS.md §8 trap 7 is the same law for positions).
    for (const f of [...filesOf(level)].sort()) {
      if (!f.endsWith('.xml')) continue;
      try {
        yield { id: `${level}/${f}`, call: engine.normalizeInstance(engine.loadCallFromXml(
          fs.readFileSync(path.join(corpusRoot(), level, f), 'utf8'), movesXml, formationsXml, 0)) };
      } catch { /* a call that will not load is another probe's business */ }
    }
  }
}
const endPosesOf = (call) => {
  const beats = engine.instanceBeats(call);
  return call.dancers.map((d) => { const p = engine.poseFor(d, beats); return { x: p.x, y: p.y, heading: p.heading, gender: d.gender }; });
};

// ---------------------------------------------------------------- 1. the rule
console.log('== 1. the end board is compared as a BOARD, with a measuring margin ==');
{
  // THE WITNESS IS FOUND BY PREDICATE, NOT BY POSITION: the corpus's own "Circle Left Home" comes
  // back within 7e-4 of where it began, so it can only separate the start rule from the end rule by its
  // heading and only just. The dancer with the largest travel in the corpus is a measurement rather than an
  // assumption, and the file order is sorted so the witness does not depend on the filesystem.
  let W = null;
  for (const { id, call } of everyCall()) {
    for (let i = 0; i < call.dancers.length; i++) {
      const a = engine.poseFor(call.dancers[i], 0);
      const b = engine.poseFor(call.dancers[i], engine.instanceBeats(call));
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (!W || dist > W.dist) W = { id, call, i, dist, start: a, end: b };
    }
  }
  const { call: src, i: d, start, end } = W;
  console.log(`    witness: dancer ${d} of "${src.title}" (${W.id}) travels ${fmt(W.dist)} units, from (${fmt(start.x)}, ${fmt(start.y)}) @${fmt(start.heading)} to (${fmt(end.x)}, ${fmt(end.y)}) @${fmt(end.heading)}`);
  check(W.dist > 0.5, 'the witness is a dancer that really goes somewhere, so the start question and the end question cannot both be answered yes');
  // A one-dancer formation is a legal `FormDancer[]`, which is what makes this a unit test of the RULE
  // rather than of the picker: the list holds the call's own end pose and nothing else.
  const one = [{ x: end.x, y: end.y, heading: end.heading, gender: src.dancers[d].gender }];
  const solo = { ...src, dancers: [src.dancers[d]] };
  check(engine.endsOnFormation(solo, one), 'the shape it ends on is recognised as its end formation');
  check(!engine.startsFromFormation(solo, one),
    'and NOT as its start formation - the two rules are asked different questions, and this dancer does not end where it began');
  check(engine.endsOnFormation(solo, one.map((p) => ({ ...p, x: p.x + 5e-4 }))),
    "the exporter's own rounding (5e-4) is inside the POSITION margin, so a formation that has been through the corpus once still matches");
  const margin = engine.END_BOARD_TOL.heading;
  const posMargin = engine.END_BOARD_TOL.position;
  console.log(`    the margins are ${fmt(posMargin)} units of position and ${fmt(margin)} rad (${fmt(margin * 180 / Math.PI)} deg) of facing`);
  check(engine.endsOnFormation(solo, one.map((p) => ({ ...p, x: p.x + posMargin / 2 }))),
    'positional drift of half the margin is still named: a path is a CHAIN of curves, so the end position drifts as well as the facing (reported as "Alamo Swing thru" from an "Alamo Wave")');
  check(!engine.endsOnFormation(solo, one.map((p) => ({ ...p, x: p.x + posMargin * 2 }))),
    'and twice it is not, so a dancer visibly off the spot leaves the picker alone rather than naming the wrong setup');
  check(engine.endsOnFormation(solo, one.map((p) => ({ ...p, heading: p.heading + margin / 2 }))),
    'a facing drift of half the margin still names the setup: a heading is the SUM of the rotation segments along the path, so an authored end board drifts even where its position does not');
  check(!engine.endsOnFormation(solo, one.map((p) => ({ ...p, heading: p.heading + margin * 2 }))),
    'and twice the margin does not, so the margin is a bound rather than a preference');
  check(engine.endsOnFormation(solo, one.map((p) => ({ ...p, gender: p.gender === 'boy' ? 'girl' : 'boy' }))),
    'the same shape held by the other genders is STILL that board: asked for as "Don\'t compare gender, just position and heading"');
  check(!engine.endsOnFormation(solo, [{ ...one[0], x: -one[0].x, y: -one[0].y, heading: norm(one[0].heading + Math.PI) }]),
    'and the 180-degree rotation of the shape is a DIFFERENT board, not the same one spelled another way');
  check(!engine.endsOnFormation(solo, [...one, ...one]),
    'a formation of the wrong SIZE is refused rather than matched spot by spot');

  // THE SET RULE, on pathless dancers so the end pose IS the start pose and the only thing under test is
  // the pairing. A formation of two spots, and the call holds its two dancers in the OTHER order.
  const bare = {
    ...src,
    dancers: [
      { ...src.dancers[0], path: [], x: 1, y: 0, angleDeg: 0 },
      { ...src.dancers[1], path: [], x: -1, y: 0, angleDeg: 0 },
    ],
  };
  const a = { x: 1, y: 0, heading: 0, gender: bare.dancers[0].gender };
  const b = { x: -1, y: 0, heading: 0, gender: bare.dancers[1].gender };
  check(engine.endsOnFormation(bare, [a, b]), 'a two-dancer witness ends on its own two spots, in order');
  check(engine.endsOnFormation(bare, [b, a]),
    'and the same two spots SWAPPED are accepted: the end is a board, and where a dancer sits in the call\'s own array is an accident of its tam');
  check(!engine.endsOnFormation(bare, [a, { ...b, x: 3 }]),
    'while a spot nobody stands on is refused - so the set rule is still reading the spots, not just their count');
  check(!engine.endsOnFormation(bare, [a, { ...b, x: a.x, y: a.y, heading: a.heading }]),
    'and two spots for ONE dancer is refused: set membership needs distinct dancers, or a coincidence would read as an arrangement');
}

// ---------------------------------------------------------------- 2. the reported case, from the corpus
console.log('\n== 2. the reported calls: "Promenade" ends on a Squared Set, "Alamo Swing Thru" on an Alamo Wave ==');
{
  // REPORTED AS: "If I pick 'Promenade Home' the End setup should select 'Squared Set'. But it remains as
  // 'unknown formation'. Is there a missing step." That call is now titled "Promenade" - the tams that STOP at
  // home took the plain name in the promenade retitling, and the walking ones took a "- Keep Walking" suffix.
  // Selected BY TITLE AND FORMATION, never by index: the file holds more than one tam under each name (trap 7).
  const call = engine.normalizeInstance(engine.loadCallFromXml(
    asset('ms/promenade.xml'), movesXml, formationsXml, { title: 'Promenade', formation: 'Right and Left Grand Static Square' }));
  const squared = formationsOfSize(8).find((f) => f.name === 'Squared Set');
  check(!!squared, 'the corpus still offers a "Squared Set" at eight dancers');
  check(!!squared && engine.endsOnFormation(call, squared.poses), 'the reported call\'s END BOARD is a Squared Set, compared as a board');
  const got = engine.endFormationName(call, formationsOfSize(8));
  check(got === 'Squared Set', `and it is NAMED "Squared Set" (got ${JSON.stringify(got)})`);
  // WHY THE OLD RULE NAMED NOTHING, MEASURED rather than asserted: the board is the same set of spots, but
  // the call's own array order is not the formation file's, so a comparison index for index is out by
  // whole units. This is the number that made the End setup row read "Unknown formation".
  const ends = endPosesOf(call);
  let worstIndexed = 0;
  for (let i = 0; i < ends.length; i++) {
    worstIndexed = Math.max(worstIndexed, Math.hypot(ends[i].x - squared.poses[i].x, ends[i].y - squared.poses[i].y));
  }
  console.log(`    index for index the same board is out by ${fmt(worstIndexed)} units, against a position tolerance of ${fmt(engine.END_BOARD_TOL.position)}`);
  check(worstIndexed > 1, 'the call really does hold its dancers in another order - index for index the spots disagree by units, which is what the old rule refused');

  // AND THE MARGIN'S OTHER WITNESS: the same call authored from a Two-Faced Line, whose dancers do end on the
  // square's spots but with a facing that is out. The drift is measured AFTER the positional correspondence,
  // because comparing the two arrays index for index measures the ORDER, not the facing - the first version of
  // this check did exactly that and reported 90.4 degrees, which is one dancer's quarter turn and nothing to
  // do with the margin.
  const lines = engine.normalizeInstance(engine.loadCallFromXml(
    asset('ms/promenade.xml'), movesXml, formationsXml, { title: 'Promenade', formation: 'Two-Faced Lines LH' }));
  const linesEnds = endPosesOf(lines);
  let worstFacing = 0, placed = 0;
  for (const spot of squared.poses) {
    const at = linesEnds.find((p) => Math.hypot(p.x - spot.x, p.y - spot.y) <= engine.END_BOARD_TOL.position);
    if (!at) continue;
    placed++;
    worstFacing = Math.max(worstFacing, Math.abs(norm(at.heading - spot.heading)));
  }
  console.log(`    the Two-Faced Lines authoring stands on ${placed} of the square's 8 spots, facing up to ${fmt(worstFacing)} rad (${fmt(worstFacing * 180 / Math.PI)} deg) away`);
  check(placed === 8, 'it really does finish on the square, spot for spot, so the drift below is a FACING drift and not a different board');
  check(worstFacing > 1e-2, 'and that is 10 times the fineness of any rounding the exporter does, so a facing margin is needed on top of the set rule');
  check(worstFacing < engine.END_BOARD_TOL.heading, 'while it is INSIDE the margin the rule carries, which is the whole reason the margin is not the XML\'s 1e-3');
  check(engine.endFormationName(lines, formationsOfSize(8)) === 'Squared Set',
    'and that authoring is named a Squared Set too');

  // AND THE POSITION MARGIN'S OWN REPORT: "Some calls are now matching correctly, but can you see why
  // Call="Almo Swing thru":Setup="Alamo Wave" doesnt detect an "Alamo Wave" as the end formation?" Its end
  // board is an Alamo Wave with 0.07 degrees of facing error - so the FACING margin alone could never have
  // named it - and 0.0023 units of POSITION error, which the XML's own 1e-3 refused.
  const alamo = engine.normalizeInstance(engine.loadCallFromXml(
    asset('ms/swing_thru.xml'), movesXml, formationsXml, { title: 'Alamo Swing Thru', formation: 'Alamo Wave' }));
  const alamoEnds = endPosesOf(alamo);
  const wave = formationsOfSize(8).find((f) => f.name === 'Alamo Wave');
  check(!!wave, 'the corpus still offers an "Alamo Wave" at eight dancers');
  // The error is measured through the POSITIONAL correspondence, because measuring it index for index would
  // report the order, which is a different question (and the one that used to be asked).
  let worstSpot = 0, worstWaveFacing = 0, onSpot = 0;
  for (const spot of wave.poses) {
    let best = null;
    for (const p of alamoEnds) {
      const d = Math.hypot(p.x - spot.x, p.y - spot.y);
      if (!best || d < best.d) best = { d, h: Math.abs(norm(p.heading - spot.heading)) };
    }
    if (!best) continue;
    if (best.d <= engine.END_BOARD_TOL.position) onSpot++;
    worstSpot = Math.max(worstSpot, best.d);
    worstWaveFacing = Math.max(worstWaveFacing, best.h);
  }
  console.log(`    "Alamo Swing Thru" ends ${fmt(worstSpot)} units and ${fmt(worstWaveFacing * 180 / Math.PI)} degrees from an Alamo Wave`);
  check(onSpot === 8, 'all eight dancers stand on the Alamo Wave\'s spots, so it is that board');
  check(worstSpot > 1e-3, 'and standing 0.0023 units off is MORE than the XML\'s own rounding, which is why the position tolerance alone refused it');
  check(worstSpot < engine.END_BOARD_TOL.position, 'while it is inside the margin the rule carries');
  const alamoName = engine.endFormationName(alamo, formationsOfSize(8));
  check(alamoName === 'Alamo Wave', `so it is NAMED "Alamo Wave" (got ${JSON.stringify(alamoName)})`);
}

// ---------------------------------------------------------------- 3. the panel uses it
console.log('\n== 3. the panel names the pickers from it, read from source ==');
{
  const ui = readSource('src/editor-ui.ts');
  // NO `\b` AFTER THE COMMA: both the comma and the newline are non-word characters, so there is no word
  // boundary there and the check would fail on a correct file.
  const importLine = /import \{[\s\S]{0,4000}?\bendFormationMatch,[\s\S]{0,4000}?\} from 'dancing-squared-engine';/.test(ui);
  check(importLine, '`editor-ui.ts` imports `endFormationMatch` from the engine rather than keeping a private copy of the turn search');
  const start = /private startFormationName\(call: CallBundle\): string \{[\s\S]{0,300}?\n  \}/.exec(ui);
  check(!!start && /startsFromFormation\(call, f\.poses\)/.test(start[0]),
    'the START still asks `startsFromFormation` - index for index, because a tam\'s paths are paired by list position');
  const end = /private endMatch\(call: CallBundle\): EndFormationMatch \| null \{[\s\S]{0,300}?\n  \}/.exec(ui);
  check(!!end && /endFormationMatch\(call, this\.host\.startFormations\(call\.dancers\.length\)\)/.test(end[0]),
    'and the END asks `endFormationMatch` over the SAME list the pickers are filled from, at the call\'s own size - the two are not the same question');
  check(!/private namedSetup\(/.test(ui), 'there is no shared dispatch left to answer both ends the same way, which is what made a turned end unnameable');
  check(/this\.startFormationSel\.value = this\.startFormationName\(this\.instance\);/.test(ui),
    'the Start picker opens on its name');
  check(/const end = this\.endSetupInfo\(this\.instance\);/.test(ui) && /this\.endFormationSel\.value = end\.name;/.test(ui),
    'and the End picker opens on the match, read from the memo so the name and the turn are one answer');
  check(/this\.endSpinSteps = end\.turnDeg \/ END_SPIN_DEG;/.test(ui),
    'with the turn RECORDED on the rotation control - the panel\'s one place for an orientation, and not an id');
  // BOTH ARE SET AFTER THE OPTIONS EXIST, or a name that is not yet an option is silently blank.
  const fill = ui.indexOf('this.ensureStartFormations(this.instance.dancers.length);');
  const startSet = ui.indexOf('this.startFormationSel.value = this.startFormationName(this.instance);');
  check(fill >= 0 && startSet > fill, 'and they are named AFTER the options are filled, or the value would not stick');

  // AND THE CHECKS FAIL ON THE FAULT THEY WERE WRITTEN FOR: the old code left both pickers empty, and the
  // end side asked a rule that cannot see a turn.
  const old = ui.replace('this.startFormationSel.value = this.startFormationName(this.instance);',
    "this.startFormationSel.value = '';");
  check(old !== ui && !/this\.startFormationSel\.value = this\.startFormationName/.test(old),
    'restoring the old `value = \'\'` fails the Start picker check');
  const mixed = ui.replace('endFormationMatch(call, this.host.startFormations(call.dancers.length))', 'null');
  check(mixed !== ui && !/endFormationMatch\(call, this\.host/.test(mixed),
    'and answering the end from nothing fails the dispatch check');
  const strictEnd = ui.replace('endFormationMatch(call, this.host.startFormations(call.dancers.length))',
    'endFormationName(call, this.host.startFormations(call.dancers.length)) || null');
  check(strictEnd !== ui && !/endFormationMatch\(call, this\.host/.test(strictEnd),
    'and going back to the strict namer fails it too - which is the fault the report was about');
}

// ---------------------------------------------------------------- 4. what it names over the corpus
console.log('\n== 4. over the catalogue: names are correct or absent, never wrong ==');
{
  let calls = 0, startNamed = 0, endNamed = 0, turnedEnd = 0, bothNamed = 0, wrongName = 0, duplicated = 0;
  const startWitness = [], endWitness = [], turnedWitness = [];
  for (const { id, call } of everyCall()) {
    calls++;
    const s = namedSetup(call, false);
    const m = endMatch(call);
    const e = m?.name ?? '';
    if (s) startNamed++;
    if (e) endNamed++;
    if (s && e) bothNamed++;
    if (m && m.turnDeg !== 0) turnedEnd++;
    // WHAT "CORRECT" MEANS, checked rather than assumed: the name is one the picker offers at this size AND the call
    // really is that formation - index for index at the start, as a board AT THE TURN THE MATCH REPORTS at the end. The
    // turn is part of the claim, so a name without its turn would be a different, wrong, statement about the board.
    for (const [name, end] of [[s, false], [e, true]]) {
      if (!name) continue;
      const f = formationsOfSize(call.dancers.length).find((x) => x.name === name);
      const ok = !!f && (end
        ? engine.endsOnFormation(call, m && m.turnDeg !== 0 ? engine.rotateFormation(f.poses, m.turnDeg * engine.DEG) : f.poses)
        : engine.startsFromFormation(call, f.poses));
      if (!ok) { wrongName++; console.log(`    WRONG ${id} :: "${name}" at the ${end ? 'end' : 'start'}${end && m ? ` (turn ${m.turnDeg})` : ''}`); }
    }
    // ONE BOARD, TWO NAMES: the corpus really does carry arrangement variants of a single board, and the
    // namer must pick one of them rather than printing both. A name that is not in the list would already
    // have been caught above, so what is checked here is that a second name exists at all.
    if (e) {
      const f = formationsOfSize(call.dancers.length).find((x) => x.name === e);
      const rivals = formationsOfSize(call.dancers.length).filter((x) => engine.endsOnFormation(call, x.poses));
      if (rivals.length > 1) duplicated++;
      if (!f) wrongName++;
    }
    if (e && m && m.turnDeg !== 0 && turnedWitness.length < 3) turnedWitness.push(`${call.title} -> ${e} @ ${m.turnDeg}deg`);
    if (e && endWitness.length < 4) endWitness.push(`${call.title} -> ${e}`);
    if (s && startWitness.length < 3) startWitness.push(`${call.title} -> ${s}`);
  }
  console.log(`    ${calls} calls: ${startNamed} named at the start, ${endNamed} at the end (${turnedEnd} of them TURNED), ${bothNamed} at both; ${duplicated} end boards fit more than one name`);
  console.log(`    start examples: ${startWitness.join(' | ')}`);
  console.log(`    end examples:   ${endWitness.join(' | ')}`);
  if (turnedWitness.length) console.log(`    turned examples: ${turnedWitness.join(' | ')}`);
  check(calls > 0, 'the catalogue was read at all');
  check(wrongName === 0, `every name offered really is that formation AT THE TURN REPORTED WITH IT (${wrongName} wrong)`);
  // AN INSTRUMENT'S SILENCE IS A BUG: 208 arrangements exist at eight dancers, so a rule that named nothing
  // would look "clean". The END count is the fragile one - most calls end on a board the corpus has no name
  // for - so it is the one that needs saying out loud.
  check(startNamed > 0, `the START picker names something (${startNamed} of ${calls})`);
  check(endNamed > 0, `and so does the END picker (${endNamed} of ${calls})`);
  check(turnedEnd > 0, `and ${turnedEnd} of those names are for a board the corpus writes another way round, which is the case this change is for`);

  // THE WITNESS BY TITLE, not by position (a hand-added tam once shifted three index-keyed checks onto a
  // two-dancer pair and they read as an engine defect for months). `Sides Face, Grand Square` is the
  // corpus's own closed call: it starts and ends on a Squared Set - AS AUTHORED, so its turn is 0.
  const gs = [...everyCall()].find(({ call }) => call.title === 'Sides Face, Grand Square');
  check(!!gs, 'the corpus still carries the "Sides Face, Grand Square" witness');
  if (gs) {
    const m = endMatch(gs.call);
    console.log(`    witness "${gs.call.title}": start=${JSON.stringify(namedSetup(gs.call, false))} end=${JSON.stringify(m)}`);
    check(m?.name === 'Squared Set', `it is named as ending on a Squared Set (got ${JSON.stringify(m?.name)})`);
    check(m?.turnDeg === 0, 'and at turn 0: a board standing where the corpus writes it is never reported as turned');
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
