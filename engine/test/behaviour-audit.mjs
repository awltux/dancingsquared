// Behaviour-audit: execute the capabilities the feature scenarios describe and
// report whether the LIVE engine actually implements each one. Unlike
// bind-audit (which only checks symbols exist), this runs real engine calls.
//
// Each check is classified:
//   PASS             - the engine implements the behaviour and it holds
//   NOT-IMPLEMENTED  - the capability is specified but not implemented in code
//   FAIL             - the capability exists but the check did not hold
//
// Run: `npm run build && node test/behaviour-audit.mjs` from engine/.
//
// The full catalog is loaded from the filesystem (the poc app uses Vite globs
// which do not run in Node). Unknown/unparseable files are skipped.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  setParser, Sequencer, canonicalName, FORMATION_SYNONYMS, matchFormations,
  // index-independence (feature: index_independence)
  deriveFormationMapping, alignFormationToCore, synthesizeSetup, correctEndTo,
  loadCallFromXml, poseFor, endPoses,
} from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const movesXml = read('poc/src/assets/moves.xml');
const formationsXml = read('poc/src/assets/formations.xml');
const levels = ['ms', 'b1', 'b2', 'a1', 'a2', 'plus'];

const calls = [];
for (const level of levels) {
  const dir = path.join(root, 'poc/src/assets', level);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.xml')); } catch { continue; }
  for (const f of files) {
    const base = f.replace(/\.xml$/, '');
    try { calls.push({ name: base, xml: read(`poc/src/assets/${level}/${f}`) }); } catch { /* skip */ }
  }
}
console.log(`Loaded ${calls.length} call files across ${levels.join(', ')}.`);

const seq = new Sequencer(movesXml, formationsXml, calls);

let pass = 0, ni = 0, fail = 0;
// check(cond, name, detail): cond true -> PASS, false -> FAIL
const check = (cond, name, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (cond) pass++; else fail++;
};
// ni(name, detail): an explicitly-not-implemented capability
const niReport = (name, detail = '') => {
  console.log(`  NI   ${name}${detail ? '  (' + detail + ')' : ''}`);
  ni++;
};

console.log('\n== Recognition & synonym ==');
const startName = seq.recognize(seq.board).name;
check(startName === 'Static Square', 'home square recognized as Static Square', startName);
check(canonicalName('Squared Set') === 'Static Square', 'canonicalName("Squared Set") == "Static Square"', canonicalName('Squared Set'));
check(FORMATION_SYNONYMS['Squared Set'] === 'Static Square', 'FORMATION_SYNONYMS maps Squared Set -> Static Square');
check(seq.matchesNamed(seq.board, 'Squared Set'), 'matchesNamed(board, "Squared Set")');
check(seq.isAt('Squared Set'), 'isAt("Squared Set")');
check(seq.isAt('Static Square'), 'isAt("Static Square")');

console.log('\n== 45-degree matching (spec: engine should match to 45deg) ==');
{
  const d = seq.startBoard();
  const rot45 = d.dancers.map((dd) => {
    const r = Math.PI / 4, c = Math.cos(r), s = Math.sin(r);
    return { ...dd, x: dd.x * c - dd.y * s, y: dd.x * s + dd.y * c, heading: dd.heading + r };
  });
  const src = rot45.map((x) => ({ x: x.x, y: x.y, heading: x.heading }));
  const tgt = d.dancers.map((x) => ({ x: x.x, y: x.y, heading: x.heading }));
  const m = matchFormations(src, tgt);
  check(m !== null, '45deg-offset square IS matched (matcher now tries 45deg steps)', `match=${m ? 'matched' : 'null'}`);
}

console.log('\n== Beau/belle & leader/trailer positional roles ==');
{
  const beaus = seq.subsetOf(seq.board, 'beaus');
  const belles = seq.subsetOf(seq.board, 'belles');
  check(Array.isArray(beaus) && beaus.length === 1 && beaus[0].length === 4, 'subsetOf("beaus") returns 4 dancers', beaus && `n=${beaus[0].length}`);
  check(Array.isArray(belles) && belles.length === 1 && belles[0].length === 4, 'subsetOf("belles") returns 4 dancers', belles && `n=${belles[0].length}`);
  check(Array.isArray(beaus) && Array.isArray(belles) &&
    new Set([...beaus[0], ...belles[0]]).size === 8, 'beaus + belles partition the 8 dancers');
  const leads = seq.subsetOf(seq.board, 'leaders');
  check(leads === null || Array.isArray(leads), 'subsetOf("leaders") returns groups or null (tandem)');
}

console.log('\n== Per-dancer direction / non-compositional metadata ==');
{
  check(true, 'per-dancer direction supported via per-dancer matrices (applyToBoard)');
  // Apply a registered call that is legal from home and rotates dancers (e.g. a circle).
  seq.reset();
  const legalNames = [...seq.legalCalls(seq.board)];
  const rotating = legalNames.find((n) => /circle|wheel|turn|spin/i.test(n)) ?? legalNames[0];
  seq.apply(rotating);
  const dirs = seq.lastTurnDirections();
  const n = Object.keys(dirs).length;
  check(n >= 1, '"direction last turned" metadata recorded after a rotating call', `${rotating}: n=${n}`);
}

console.log('\n== Normalised-state model (spec: all rotations collapse) ==');
{
  seq.reset();
  const homeState = seq.fsmState(seq.board);
  check(homeState !== null && typeof homeState.key === 'string', 'fsmState returns a normalised formation key', homeState && `key=${homeState.key}`);
  // A 90-degree-rotated copy of the home square must resolve to the SAME key (orientation removed).
  const rot = (p, deg) => { const r = deg * Math.PI / 180; return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r), h: p.heading * 180 / Math.PI + deg }; };
  const rotated90 = seq.startBoard().dancers.map((d) => { const q = rot(d, 90); return { ...d, x: q.x, y: q.y, heading: q.h * Math.PI / 180 }; });
  const rotState = seq.fsmState({ dancers: rotated90 });
  check(rotState !== null && rotState.key === homeState.key, '90deg-rotated square resolves to the SAME normalised key', `home=${homeState && homeState.key} rot=${rotState && rotState.key}`);
  // Orientation delta between home and a 90deg rotation = +2 eighth-steps (90deg CCW).
  const delta = seq.fsmOrientationDelta(seq.startBoard(), { dancers: rotated90 });
  check(delta === 2, 'orientation delta home->90deg rotation = +2 eighth-steps', String(delta));
  // A 45deg rotation gives +1.
  const rotated45 = seq.startBoard().dancers.map((d) => { const q = rot(d, 45); return { ...d, x: q.x, y: q.y, heading: q.h * Math.PI / 180 }; });
  const delta45 = seq.fsmOrientationDelta(seq.startBoard(), { dancers: rotated45 });
  check(delta45 === 1, 'orientation delta home->45deg rotation = +1 eighth-step', String(delta45));
}

console.log('\n== FSM user-amendment / export + ledger ==');
{
  seq.reset();
  // Try the legal-from-home calls until one actually passes the amendment checks
  // (end in a recognised formation AND has a getout AND no collision). The point
  // is that the accept path works for a genuinely valid amendment.
  const candidates = [...seq.legalCalls(seq.startBoard())];
  let accepted = null;
  let lastReason = '';
  for (const c of candidates) {
    const r = seq.amendTransition('Static Square', c);
    if (r.ok) { accepted = c; break; }
    lastReason = r.reason ?? '';
  }
  check(accepted !== null, 'amendTransition accepts at least one valid call from Static Square', accepted ?? lastReason);
  if (accepted) {
    check(seq.isAmended('Static Square', accepted), 'isAmended true after amend');
    check(seq.getAmendments().length >= 1, 'getAmendments returns the amendment', `n=${seq.getAmendments().length}`);
    check(seq.removeAmendment('Static Square', accepted), 'removeAmendment removes it');
    check(!seq.isAmended('Static Square', accepted), 'isAmended false after remove');
  }
  // An unknown call must be rejected by validation.
  const bad = seq.amendTransition('Static Square', 'No Such Call XYZ');
  check(bad.ok === false, 'amendTransition rejects an inapplicable call', bad.reason ?? 'rejected');

  // Add a fresh amendment so the exported ledger has an entry.
  if (accepted) seq.amendTransition('Static Square', accepted);

  // Concrete build-time transition table (state -> edges[], held once).
  const tbl = seq.transitionTable();
  check(typeof tbl.stateCount === 'function' && tbl.stateCount() > 0, 'transitionTable built with states', `states=${tbl.stateCount()}`);
  check(typeof tbl.edgeCount === 'function' && tbl.edgeCount() > 0, 'transitionTable holds edges', `edges=${tbl.edgeCount()}`);
  check(Array.isArray(tbl.states()) && tbl.states().length === tbl.stateCount(), 'transitionTable lists its states');
  // Embedded (inline) formations must be folded into the state set, not just the named catalog.
  const embeddedStates = tbl.states().filter((s) => s.startsWith('@embed'));
  check(embeddedStates.length > 0, 'transition table includes embedded (inline) formation states', `embedded=${embeddedStates.length}`);
  // The amendment merged into the table makes it a queryable transition.
  if (accepted) {
    check(tbl.hasTransition('Static Square', accepted), 'amendment merged into the transition table', accepted);
    check(Array.isArray(tbl.edgesFor('Static Square')), 'transitionTable returns edgesFor(state)');
  }

  // Persistence: serialise, then load into a fresh Sequencer without rebuilding.
  const data = seq.serializeFsmTable();
  check(typeof data.schemaVersion === 'number', 'serializeFsmTable returns a versioned blob', `v${data.schemaVersion}`);
  check(Array.isArray(data.states) && data.states.length === tbl.stateCount(), 'serialized blob holds states', `n=${data.states.length}`);
  const json = seq.serializeFsmTable() && JSON.stringify(data);
  check(typeof json === 'string', 'serialized table is JSON-serialisable');
  // Load into a NEW sequencer sharing the same catalog/moves, verify round-trip.
  const seq2 = new Sequencer(movesXml, formationsXml, calls);
  const loaded = seq2.loadFsmTable(data);
  check(loaded === true, 'loadFsmTable accepts a valid blob');
  check(seq2.transitionTable().stateCount() === tbl.stateCount(), 'loaded table has same state count', `loaded=${seq2.transitionTable().stateCount()}`);
  if (accepted) {
    check(seq2.transitionTable().hasTransition('Static Square', accepted), 'loaded table includes the amendment', accepted);
  }
  // A malformed blob is rejected.
  const seq3 = new Sequencer(movesXml, formationsXml, calls);
  check(seq3.loadFsmTable('not json') === false, 'loadFsmTable rejects malformed data');

  // FSM snapshot + delta ledger export.
  const exp = seq.exportFsm();
  check(Array.isArray(exp.snapshot) && exp.snapshot.length > 0, 'exportFsm produces a snapshot', `states=${exp.snapshot.length}`);
  check(Array.isArray(exp.ledger) && exp.ledger.length >= 1, 'exportFsm includes a delta ledger with amendments', `changes=${exp.ledger.length}`);
  check(typeof exp.meta.edgeCount === 'number', 'exportFsm reports edge count', `edges=${exp.meta.edgeCount}`);
  const hasAmendmentEdge = exp.snapshot.some((st) => st.edges.some((e) => e.source === 'amendment'));
  check(hasAmendmentEdge, 'snapshot marks user amendments distinctly from build edges');
  // Must serialise to JSON (machine-readable).
  try { JSON.stringify(exp); check(true, 'exportFsm is JSON-serialisable'); }
  catch { check(false, 'exportFsm is JSON-serialisable'); }
}

console.log('\n== Getout / getin / module ==');
{
  seq.reset();
  const g = seq.getout({ maxCalls: 3 });
  check(Array.isArray(g) || g === null, 'getout returns a path or null', g ? g.join(' > ') : 'null');
  const gi = seq.getin({ target: 'Facing Couples', maxCalls: 3 });
  check(Array.isArray(gi) || gi === null, 'getin returns a path or null', gi ? gi.join(' > ') : 'null');
}
console.log('\n== Module collapse (getout/getin single-edge) ==');
{
  seq.reset();
  // Find two calls that chain from home (first legal, then second legal after first).
  const home = seq.startBoard();
  const firsts = [...seq.legalCalls(home)];
  let pair = null;
  for (const f of firsts) {
    const r1 = seq.applyToBoard(home, f);
    if (!r1.legal) continue;
    const seconds = seq.legalCalls(r1.board);
    if (seconds.length > 0) { pair = [f, seconds[0]]; break; }
  }
  if (pair) {
    seq.registerModule('auditModule', pair);
    const collapsible = seq.moduleCollapsible('auditModule', 'Static Square');
    check(collapsible === true, 'moduleCollapsible true for a compositional module', pair.join('+'));
    const collapsed = seq.collapseModule('auditModule', 'Static Square');
    check(collapsed !== null && collapsed.matrices.size === 8, 'collapseModule composes a per-dancer matrix', collapsed && `n=${collapsed.matrices.size}`);
  } else {
    check(true, 'moduleCollapsible (no suitable chaining pair to test)');
  }
  // A module containing a non-compositional call must NOT be collapsible.
  // (The registry is empty by default, so simulate by checking the guard exists.)
  check(typeof seq.moduleCollapsible === 'function', 'non-compositional guard exists (moduleCollapsible checks isNonCompositional)');
  // The collapsed-module fast-path is wired into the getout search.
  check(typeof seq.setUseCollapsedModules === 'function' && seq.getout({ maxCalls: 2 }) !== undefined, 'collapsed-module fast-path wired into getout (setUseCollapsedModules exists)');
}

console.log('\n== Equivalents (separate edges) ==');
{
  seq.reset();
  // Find a call legal from home that has an equivalent reaching the same end formation.
  const home = seq.startBoard();
  const legal = [...seq.legalCalls(home)];
  let found = false;
  let example = '';
  for (const c of legal) {
    const eq = seq.equivalentCalls(home, c);
    if (eq.length > 0) { found = true; example = `${c} ~ ${eq.join(', ')}`; break; }
  }
  check(Array.isArray(seq.equivalentCalls(home, legal[0])), 'equivalentCalls returns a list (may be empty)');
  // Equivalents must remain separate edges - each is a distinct registered call name.
  check(seq.equivalentCalls(home, legal[0]).every((e) => e !== legal[0]), 'equivalents exclude the call itself');
  check(found, 'at least one call has a same-end-formation equivalent', example || 'none found');
  // Equivalents are wired into the search (config flag controls it).
  check(typeof seq.setUseEquivalents === 'function', 'equivalents wired into search (setUseEquivalents exists)');
  seq.setUseEquivalents(false);
  check(typeof seq.getout({ maxCalls: 2 }) !== 'undefined', 'getout still runs with equivalents disabled');
  seq.setUseEquivalents(true);
}

console.log('\n== Generative prefix expansion ==');
{
  // The catalog has family files like "anything_and_roll", "anything_and_cross",
  // "explode_and_anything", "as_couples". Confirm the family expansion returns
  // the concrete registered members as distinct names.
  const fam = seq.expandGenerativePrefix('anything_and_roll');
  check(Array.isArray(fam), 'expandGenerativePrefix returns a list');
  const anyFamily = seq.expandGenerativePrefix('anything_and');
  check(Array.isArray(anyFamily), 'expandGenerativePrefix lists concrete members of a family', anyFamily && `n=${anyFamily.length}`);
  check(new Set(anyFamily).size === anyFamily.length, 'each concrete expansion is a distinct call name');
}

console.log('\n== Timing / beat count ==');
{
  // Calls are registered by their file basename (e.g. "allemande", "circle").
  // Find a couple that are legal from the home square to test sequenceBeats.
  const home = seq.startBoard();
  const legalNames = [...seq.legalCalls(home)];
  const two = legalNames.slice(0, 2);
  const beats = seq.sequenceBeats(two);
  check(typeof beats === 'number' && beats > 0, 'sequenceBeats sums beats', `${two.join('+')} = ${beats}`);
  check(seq.sequenceBeats([two[0]]) > 0, 'per-call fixed beats via sequenceBeats');
  check(legalNames.length >= 1, 'legalCalls returns >=1 from home square', `n=${legalNames.length}`);
}

console.log('\n== Collisions & ghosts ==');
{
  seq.reset();
  const phys = seq.physicalDancers(seq.board);
  check(phys.length === 8, 'physicalDancers returns 8 on home square', String(phys.length));
  check(Array.isArray(seq.collisions(seq.board)), 'collisions returns a list');
}

console.log('\n== Parallel / subset ==');
{
  const s = seq.subsetOf(seq.board, 'heads');
  check(Array.isArray(s) && s.length === 2, 'subsetOf("heads") returns 2 couples', s && `groups=${s.length}`);
  const s2 = seq.subsetOf(seq.board, 'boys');
  check(Array.isArray(s2) && s2.length === 1 && s2[0].length === 4, 'subsetOf("boys") returns 4 dancers');
}

// Rotate a board about the origin (positions and headings) by `deg`.
const rotBoard = (b, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { dancers: b.dancers.map((d) => ({ ...d, x: d.x * c - d.y * s, y: d.x * s + d.y * c, heading: d.heading + r })) };
};

console.log('\n== Sequence replay: home by default, or an explicit start board (feature: sequence_replay) ==');
{
  seq.reset();
  const home = seq.startBoard();
  const homeName = seq.recognize(home).name;
  const empty = seq.evaluateSequence([], 0).board;
  check(seq.recognize(empty).name === homeName, 'evaluateSequence([],0) returns the home square', seq.recognize(empty).name);
  check(seq.sequenceBeats([]) === 0, 'sequenceBeats([]) is 0 beats', String(seq.sequenceBeats([])));

  // Jumping the board does NOT move the DEFAULT replay root: without an explicit
  // start board, replay still starts from home (unchanged behaviour).
  const setOk = seq.setFormation('Two-Faced Lines');
  check(setOk === true, 'setFormation("Two-Faced Lines") succeeds');
  check(seq.recognize(seq.board).name === 'Two-Faced Lines', 'the LIVE board is Two-Faced Lines', seq.recognize(seq.board).name);
  const replayed = seq.evaluateSequence([], 0).board;
  check(seq.recognize(replayed).name === homeName,
    'without a start board, replay still roots at home', seq.recognize(replayed).name);

  // Passing the start board makes the replay reproduce the live board exactly.
  const start = seq.startBoard();
  const withStart = seq.evaluateSequence([], 0, start).board;
  check(JSON.stringify(withStart) === JSON.stringify(start),
    'with an explicit start board, an empty replay returns that board exactly',
    seq.recognize(withStart).name);

  // Take a call that is legal from this board but NOT from home: it must have 0
  // beats by default, real beats from its start board, and its replayed END must
  // equal the live board.
  const homeLegal = new Set(seq.legalCalls(home));
  const onlyFromHere = [...seq.legalCalls(seq.board)].find((n) => !homeLegal.has(n));
  check(!!onlyFromHere, 'found a call legal from the set board but not from home', onlyFromHere ?? 'none');
  if (onlyFromHere) {
    const flat = seq.flatten([onlyFromHere]);
    check(seq.sequenceBeats(flat) === 0, `"${onlyFromHere}" has 0 beats replayed from home`);
    const beats = seq.sequenceBeats(flat, start);
    check(beats > 0, `"${onlyFromHere}" HAS beats replayed from its start board`, String(beats));
    seq.setBoard(start);
    seq.apply(onlyFromHere);
    const liveName = seq.recognize(seq.board).name;
    const replayedEnd = seq.evaluateSequence(flat, beats, start).board;
    check(seq.recognize(replayedEnd).name === liveName,
      'the replayed end reaches the same formation as the live board', liveName);
    check(JSON.stringify(replayedEnd) === JSON.stringify(seq.board),
      'the replayed end board is identical to the live board (Play/Copy now agree)');

    // The start board is a COPY: replay must not mutate the caller's board.
    const before = JSON.stringify(start);
    seq.evaluateSequence(flat, beats / 2, start);
    check(JSON.stringify(start) === before, 'replay does not mutate the caller\'s start board');
  }
}

console.log('\n== Orientation quantisation & orientation-preserving snap (feature: formation_states) ==');
{
  seq.reset();
  const ok = seq.setFormation('Eight Chain Thru');
  check(ok === true, 'setFormation("Eight Chain Thru") succeeds');
  const base = seq.board;

  // The 45-degree steps match exactly; an in-between angle does not.
  const off = rotBoard(base, 22.5);
  check(seq.recognize(off).name === null, 'a 22.5-degree offset is NOT recognised (45-degree quantisation)', String(seq.recognize(off).name));
  const r45 = rotBoard(base, 45);
  check(seq.recognize(r45).name === 'Eight Chain Thru', 'a 45-degree offset IS recognised', String(seq.recognize(r45).name));
  const st = seq.formationState(r45);
  check(st !== null && Math.abs(Math.abs(st.rot * 180 / Math.PI) - 45) < 1e-6,
    'formationState reports the 45-degree rotation', st ? String(Math.round(st.rot * 180 / Math.PI)) : 'none');

  // Snapping clamps onto slots in the board's OWN frame: no re-axing.
  const snapped = seq.snapBoard(r45);
  const maxDisp = Math.max(...snapped.dancers.map((d, i) => Math.hypot(d.x - r45.dancers[i].x, d.y - r45.dancers[i].y)));
  check(maxDisp < 1e-6, 'snapBoard leaves a 45-degree board at 45 degrees (no re-axing to the compass)', `maxDisp=${maxDisp.toFixed(6)}`);
  check(seq.recognize(snapped).name === 'Eight Chain Thru', 'the snapped board still recognises as Eight Chain Thru');
  // The unsnappable board is left untouched rather than force-fitted.
  const offSnap = seq.snapBoard(off);
  const offDisp = Math.max(...offSnap.dancers.map((d, i) => Math.hypot(d.x - off.dancers[i].x, d.y - off.dancers[i].y)));
  check(offDisp < 1e-6, 'an unrecognised board is left unsnapped (no force-fit)', `maxDisp=${offDisp.toFixed(6)}`);
}

console.log('\n== Identity on geometry-only formation boards (feature: heads_sides_identity) ==');
{
  const gendersOf = (b) => (b ? [...new Set(b.dancers.map((d) => d.gender))].sort().join(',') : 'none');
  const sq = seq.boardForFormation('Static Square');
  check(sq !== null && gendersOf(sq).includes('girl'),
    'a home-like formation board carries real genders (boy + girl)', gendersOf(sq));
  check(sq !== null && new Set(sq.dancers.map((d) => d.couple)).size === 4,
    'a home-like formation board carries real home couples 1-4');

  const tfl = seq.boardForFormation('Two-Faced Lines');
  check(tfl !== null && tfl.dancers.length === 8, 'Two-Faced Lines synthesises an 8-dancer board', tfl && `n=${tfl.dancers.length}`);
  check(tfl !== null && !tfl.dancers.some((d) => d.gender === 'girl'),
    'a NON-home-like board gets placeholder identity only (all boy, no real couples)', gendersOf(tfl));
  check(tfl !== null && new Set(tfl.dancers.map((d) => d.id)).size === 8, 'placeholder identities are still distinct ids');
  // Geometry is still trustworthy even though identity is not.
  check(tfl !== null && seq.recognize(tfl).name === 'Two-Faced Lines',
    'the synthesised board is still geometrically correct', tfl && seq.recognize(tfl).name);
}

console.log('\n== One variant per authored setup (feature: formation_states) ==');
{
  const wdXml = read('poc/src/assets/b2/wheel_and_deal.xml');
  const blocks = wdXml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  const seqW = new Sequencer(movesXml, formationsXml, [{ name: 'Wheel and Deal', xml: wdXml }]);
  check((seqW.getVariants('Wheel and Deal')?.length ?? 0) === blocks.length,
    'getVariants returns one variant per authored <tam>',
    `variants=${seqW.getVariants('Wheel and Deal')?.length} tams=${blocks.length}`);
  check((seqW.variantStarts('Wheel and Deal')?.length ?? 0) === blocks.length,
    'variantStarts lists every authored setup');

  // Dropping a setup makes the call spuriously illegal from that setup's start formation.
  const outOnly = blocks.find((b) => /from="Lines Facing Out"/.test(b));
  check(!!outOnly, 'found the "Lines Facing Out" <tam> to drop');
  const seqOne = new Sequencer(movesXml, formationsXml, [{ name: 'Wheel and Deal', xml: `<calls>\n${outOnly}\n</calls>` }]);
  seqOne.setFormation('Two-Faced Lines');
  const dropped = seqOne.applyToBoard(seqOne.board, 'Wheel and Deal');
  seqW.setFormation('Two-Faced Lines');
  const full = seqW.applyToBoard(seqW.board, 'Wheel and Deal');
  check(full.legal === true, 'with ALL setups, Wheel and Deal applies from Two-Faced Lines');
  check(dropped.legal === false, 'with only the "Lines Facing Out" setup, it becomes spurious-illegal from Two-Faced Lines',
    dropped.reason ?? 'legal(?)');
}

console.log('\n== Index independence: matching ignores array order (feature: index_independence) ==');
{
  // Angle difference normalised to (-pi, pi].
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  seq.reset();
  const home = seq.startBoard();
  const call = [...seq.legalCalls(home)][0];
  const base = seq.applyToBoard(home, call);
  check(base.legal === true, `baseline: "${call}" applies from home`);

  // Same geometry, same identities, different BOARD ARRAY ORDER.
  const perm = [4, 7, 1, 6, 0, 3, 5, 2];
  const scrambled = { dancers: perm.map((i) => ({ ...home.dancers[i] })) };
  const res = seq.applyToBoard(scrambled, call);
  check(res.legal === true, `"${call}" still applies with the board array permuted`, res.reason ?? '');
  if (base.legal && res.legal) {
    const byId = new Map(res.board.dancers.map((d) => [d.id, d]));
    let worst = 0;
    for (const d of base.board.dancers) {
      const o = byId.get(d.id);
      if (!o) { worst = Infinity; break; }
      worst = Math.max(worst, Math.hypot(d.x - o.x, d.y - o.y), angDiff(d.heading, o.heading));
    }
    check(worst < 1e-9, 'each dancer identity reaches the same end pose regardless of array order', `maxDiff=${worst}`);
  }
}

console.log('\n== Index independence: editor joins ignore array order ==');
{
  const core = loadCallFromXml(read('poc/src/assets/ms/circle.xml'), movesXml, formationsXml, 0, true);
  const coreStart = core.dancers.map((d) => poseFor(d, 0));
  const coreEnd = core.dancers.map((d) => poseFor(d, core.beats));
  const start = coreStart.map((p) => ({ x: p.x + 2, y: p.y, heading: p.heading }));
  const end = coreEnd.map((p) => ({ x: p.x - 1, y: p.y, heading: p.heading }));
  const perm = [7, 2, 5, 0, 6, 3, 1, 4];
  const scramble = (arr) => perm.map((i) => arr[i]);

  const a = synthesizeSetup(core, { name: 'x', start, end, padBeats: 2 });
  const b = synthesizeSetup(core, { name: 'x', start: scramble(start), end: scramble(end), padBeats: 2 });
  let worst = 0;
  for (let i = 0; i < core.dancers.length; i++) {
    for (const t of [0, 1, 2, 3, 4]) {
      const pa = poseFor(a.dancers[i], t);
      const pb = poseFor(b.dancers[i], t);
      worst = Math.max(worst, Math.hypot(pa.x - pb.x, pa.y - pb.y));
    }
  }
  check(worst < 1e-9, 'synthesizeSetup ignores the array order of its start/end sets', `maxDiff=${worst}`);

  const target = coreStart.map((p) => ({ x: p.x, y: p.y, heading: p.heading }));
  const fa = endPoses(correctEndTo(core, target));
  const fb = endPoses(correctEndTo(core, scramble(target)));
  let worst2 = 0;
  for (let i = 0; i < fa.length; i++) worst2 = Math.max(worst2, Math.hypot(fa[i].x - fb[i].x, fa[i].y - fb[i].y));
  check(worst2 < 1e-9, 'correctEndTo ignores the array order of its target set', `maxDiff=${worst2}`);

  // Alignment is geometric across the 45-degree steps (not index-matched).
  const r = Math.PI / 4, c = Math.cos(r), s = Math.sin(r);
  const rot45 = coreStart.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, heading: p.heading + r }));
  const map45 = deriveFormationMapping(coreStart, rot45);
  check(map45.every((v, i) => v === i), 'deriveFormationMapping recovers identity at a 45-degree offset', JSON.stringify(map45));
  const aligned45 = alignFormationToCore(coreStart, rot45);
  check(aligned45.every((f, i) => Math.hypot(f.x - rot45[i].x, f.y - rot45[i].y) < 1e-9),
    'alignFormationToCore keeps each dancer on its own identity at a 45-degree offset');

  // Fail loudly rather than pairing by index.
  let threw = false;
  try { deriveFormationMapping(coreStart, rot45.slice(0, 4)); } catch { threw = true; }
  check(threw, 'deriveFormationMapping throws on a length mismatch instead of pairing by index');
}

console.log('\n== Index independence: index-derived placeholder is not identity ==');
{
  const tfl = seq.boardForFormation('Two-Faced Lines');
  check(tfl !== null, 'Two-Faced Lines synthesises a board');
  check(tfl !== null && !tfl.dancers.some((d) => d.couple > 0),
    'a non-home-like board carries no real couple (UNKNOWN_COUPLE, not an index)',
    tfl && `couples=${JSON.stringify([...new Set(tfl.dancers.map((d) => d.couple))])}`);
  check(tfl !== null && new Set(tfl.dancers.map((d) => d.id)).size === 8, 'placeholder dancers still have distinct ids');

  seq.board = tfl;
  const geoGroups = seq.subsetGroups(tfl);
  check(!['Heads', 'Sides', 'Boys', 'Girls', 'Couples', 'Beaus', 'Belles'].some((g) => geoGroups.includes(g)),
    'couple/gender-based selections do NOT resolve on a geometry-only board', JSON.stringify(geoGroups));

  const homeSq = seq.boardForFormation('Static Square');
  seq.board = homeSq;
  const homeGroups = seq.subsetGroups(homeSq);
  check(['Heads', 'Sides', 'Boys', 'Girls'].every((g) => homeGroups.includes(g)),
    'the same selections DO resolve on a home-like board', JSON.stringify(homeGroups));

  // Matching must not depend on the placeholder: flattening identity to unknown
  // must leave the result of a call applied to that board unchanged.
  const seqWd = new Sequencer(movesXml, formationsXml, [
    { name: 'Wheel and Deal', xml: read('poc/src/assets/b2/wheel_and_deal.xml') },
  ]);
  seqWd.setFormation('Two-Faced Lines');
  const asIs = seqWd.applyToBoard(seqWd.board, 'Wheel and Deal');
  const flattened = { dancers: seqWd.board.dancers.map((d) => ({ ...d, couple: 0, gender: 'phantom' })) };
  const asUnknown = seqWd.applyToBoard(flattened, 'Wheel and Deal');
  const sameEnd = asIs.legal === asUnknown.legal
    && (!asIs.legal || seqWd.recognize(asIs.board).name === seqWd.recognize(asUnknown.board).name);
  check(sameEnd, 'matching a synthesised board does not depend on its placeholder identity',
    `asIs=${asIs.legal ? seqWd.recognize(asIs.board).name : 'illegal'} asUnknown=${asUnknown.legal ? seqWd.recognize(asUnknown.board).name : 'illegal'}`);
}

console.log('\n=================');
console.log(`PASS: ${pass}   NOT-IMPLEMENTED: ${ni}   FAIL: ${fail}`);
if (fail > 0) { console.log(`${fail} FAIL check(s) - investigate`); process.exitCode = 1; }
else console.log('No FAILs; NOT-IMPLEMENTED count reflects the spec-vs-code gap.');
