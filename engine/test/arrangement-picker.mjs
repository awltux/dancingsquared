// THE ARRANGEMENT PICKER. What the editor's Start/End setup lists offer, and why it is not the library's
// formation list.
//
// WHY THIS IS A POC-SIDE HARNESS LIVING IN `engine/test`. The list is built by
// `poc/src/tam-xml.ts`'s `corpusFormationsOfSize`, from `poc/src/assets/formations.xml`. It is NOT
// `Sequencer.listFormations()`: that is the ENGINE's formation library, keyed on GEOMETRY UP TO
// CONGRUENCE, and it is deliberately left alone - `shape-census.mjs` pins its 134 names and all-eight
// invariant and four other harnesses walk it. Filling a PICKER from a matching key was the bug: two
// boards reachable from one another by a rotation are the same SHAPE and different ARRANGEMENTS, and a
// caller choosing a start is choosing the second thing.
//
// MEASURED, and the report that prompted this: `Columns`, `Columns LH`, `Column RH GBGB` and
// `Column LH GBGB` all stand on the same four spots. `Columns` and `Column RH GBGB` are identical spot
// for spot; `Columns LH` is the 180-degree rotation of them (every dancer at the antipode, facing the
// other way); `Column LH GBGB` is `Columns LH` with the genders swapped. The engine's matcher reports
// `reflect: true`, `rotation: NaN` on these half-set boards and accepts a reflection as a match, so
// keyed on it the picker offered ONE entry where there are three distinct arrangements.
//
// THE KEY IS POSITIONAL - same spot, same heading, same gender - and the counts below are what that
// keeps. The reimplementation here is deliberate, like `shape-census`'s: a harness that calls the
// function it is checking cannot catch the function changing.

import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { DEG, Sequencer, parseFormations, setParser, setStartFormation, loadCallFromXml, normalizeInstance } from '../dist/index.js';

setParser(DOMParser);

const root = new URL('../../poc/src/assets/', import.meta.url);
const asset = (p) => readFileSync(new URL(p, root), 'utf8');
const formationsXml = asset('formations.xml');
const movesXml = asset('moves.xml');

const all = parseFormations(formationsXml);

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) { console.log(`  FAIL ${what}${detail ? ` - ${detail}` : ''}`); failures++; }
  else console.log(`  ok   ${what}`);
};

/**
 * The corpus's HALF-SET rule, which `poc/src/tam-xml.ts` applies before measuring a formation: a named
 * formation is authored as half the set it stands for, so the played shape is the written dancers plus
 * the same dancers rotated 180 degrees about the origin, keeping their genders.
 */
function completeHalfSet(poses) {
  const mirror = poses.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender }));
  const merged = poses.concat(mirror);
  const stacked = merged.some((a, i) => merged.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < 0.01));
  return stacked ? poses : merged;
}

/** The arrangement key: the rounded (x, y, heading, gender) of every spot, as an order-independent set. */
function keyOf(poses) {
  return poses
    .map((p) => {
      const deg = ((p.heading / DEG) % 360 + 360) % 360;
      return `${p.x.toFixed(2)},${p.y.toFixed(2)},${deg.toFixed(2)},${p.gender ?? 'phantom'}`;
    })
    .sort();
}
const sameArrangement = (a, b) => {
  if (a.length !== b.length) return false;
  const ka = keyOf(a), kb = keyOf(b);
  return ka.every((k, i) => k === kb[i]);
};

/** Every distinct arrangement of `size` dancers, first name in name order per arrangement. */
function arrangementsOfSize(size) {
  const out = [];
  for (const [name, ds] of all) {
    const poses = completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length === size) out.push({ name, poses });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const kept = [];
  for (const f of out) if (!kept.some((k) => sameArrangement(k.poses, f.poses))) kept.push(f);
  return kept;
}

console.log('arrangement-picker: the composition of the Start/End setup lists\n');

// ---------------------------------------------------------------- 1. the counts, and the shape of them
console.log('1. what the list holds, per size');
const EXPECT = { 2: 6, 4: 48, 6: 1, 8: 201, 16: 0 };
const bySize = new Map();
for (const size of [2, 4, 6, 8, 16]) {
  const kept = arrangementsOfSize(size);
  bySize.set(size, kept);
  check(kept.length === EXPECT[size], `${size} dancers -> ${EXPECT[size]} arrangements`, `got ${kept.length}`);
}

// THE ONE PROPERTY THE PICKERS DEPEND ON. `poc/src/editor-ui.ts` rebases onto `formation.poses` and
// refuses an end whose count differs (`doEndFormation`), so a list entry of the wrong size is a picker
// whose every choice is refused - which is the bug `corpusFormationsOfSize` was written to fix.
console.log('\n2. every entry has exactly the requested number of dancers');
for (const [size, kept] of bySize) {
  const wrong = kept.filter((f) => f.poses.length !== size);
  check(wrong.length === 0, `${size} dancers: no wrong-count entry`, wrong.map((f) => `${f.name}=${f.poses.length}`).join(', '));
}

console.log('\n3. no name is offered at two sizes, and no size lists a name twice');
const seen = new Map();
const crossSize = [];
for (const [size, kept] of bySize) {
  if (new Set(kept.map((f) => f.name)).size !== kept.length) check(false, `${size} dancers: names unique`);
  else check(true, `${size} dancers: names unique`);
  for (const f of kept) {
    if (seen.has(f.name)) crossSize.push(`${f.name} at ${seen.get(f.name)} and ${size}`);
    seen.set(f.name, size);
  }
}
check(crossSize.length === 0, 'no arrangement is offered at two sizes', crossSize.join(', '));

// ---------------------------------------------------------------- 4. the reported case, exactly
console.log('\n4. the four names that started this - three arrangements, not one');
const size8 = bySize.get(8);
const offered = new Set(size8.map((f) => f.name));
for (const n of ['Columns LH', 'Column RH GBGB', 'Column LH GBGB']) check(offered.has(n), `${n} is offered`);
// `Columns` is the same board as `Column RH GBGB` under two names, and `Column RH GBGB` wins in name
// order, so the picker keeps one row and it is that one.
check(!offered.has('Columns'), 'Columns is folded (same board as Column RH GBGB)');

const posesOf = (name) => {
  const ds = all.get(name);
  return ds ? completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }))) : null;
};
// `parseFormations` is keyed by name including case, and the corpus spells these with a lower-case `l`
// in "3 and 1 lines" - so a direct `get` is what this needs, and `null` means the name moved.
const p = (n) => posesOf(n);
check(p('Columns') !== null && p('Column RH GBGB') !== null, 'the corpus still carries both Columns spellings');
if (p('Columns') && p('Column RH GBGB')) {
  check(sameArrangement(p('Columns'), p('Column RH GBGB')), 'Columns == Column RH GBGB, spot for spot');
}
if (p('Columns') && p('Columns LH')) {
  // THE POINT. `Columns LH` stands on the same spots as `Columns` and is still a different board,
  // because each dancer is at the antipode of the other's spot facing the other way.
  const a = p('Columns'), b = p('Columns LH');
  const sameSpots = new Set(a.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`));
  const sameSpotSet =
    b.every((q) => sameSpots.has(`${q.x.toFixed(2)},${q.y.toFixed(2)}`)) &&
    sameSpots.size === new Set(b.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`)).size;
  const headingShift = Math.abs(((b[0].heading - a[0].heading) / DEG + 360) % 360 - 180);
  check(sameSpotSet, 'Columns and Columns LH stand on the same spots');
  check(headingShift < 0.001, 'Columns LH is Columns rotated 180 degrees', `heading delta ${headingShift}`);
  check(!sameArrangement(a, b), 'and they are nevertheless DIFFERENT arrangements');
}
if (p('Columns LH') && p('Column LH GBGB')) {
  check(!sameArrangement(p('Columns LH'), p('Column LH GBGB')), 'Columns LH != Column LH GBGB (genders differ)');
}

// ---------------------------------------------------------------- 5. the rotational families it keeps
console.log('\n5. rotations the congruence key folded, now kept as separate arrangements');
// Measured: each of these is a 180-degree rotation of its partner, and the old key kept only one.
for (const [a, b] of [
  ['Tidal 3 and 1 Line #1', 'Tidal 3 and 1 Line #5'],
  ['Tidal 3 and 1 Line #2', 'Tidal 3 and 1 Line #6'],
  ['Tidal Wave', 'Tidal Wave LH BGGB'],
  ['Stars RH', 'Stars LH'],
]) {
  if (!offered.has(a) || !offered.has(b)) { check(false, `${a} and ${b} both offered`, `${a}=${offered.has(a)} ${b}=${offered.has(b)}`); continue; }
  check(true, `${a} and ${b} both offered`);
}

// ---------------------------------------------------------------- 6. the library's names are covered
console.log('\n6. every name the ENGINE library knows is represented, bar the exact-duplicate spellings');
const { readdirSync } = await import('node:fs');
const msDir = new URL('ms/', root);
const calls = readdirSync(msDir)
  .filter((f) => f.endsWith('.xml'))
  .map((f) => ({ name: f.replace(/\.xml$/, ''), xml: readFileSync(new URL(f, msDir), 'utf8') }));
const seq = new Sequencer(movesXml, formationsXml, calls);
const libNames = seq.listFormations();
check(libNames.length === 134, 'the library still holds 134 names', `got ${libNames.length}`);

// Only folds, no omissions: each library name is either offered or shares a board with one that is.
const boards = new Map();
for (const f of size8) for (const k of keyOf(f.poses)) if (!boards.has(k)) boards.set(k, f.name);
const unrepresented = libNames.filter((n) => {
  if (offered.has(n)) return false;
  const bp = seq.boardForFormation(n);
  if (!bp) return true;
  const poses = bp.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  const kb = keyOf(poses);
  return !size8.some((f) => {
    const kf = keyOf(f.poses);
    return kf.length === kb.length && kf.every((k, i) => k === kb[i]);
  });
});
check(unrepresented.length === 0, 'every library name is offered or folded onto an identical board', unrepresented.join(', '));

// ---------------------------------------------------------------- 7. the editor accepts every entry
console.log('\n7. setStartFormation accepts every offered 8-dancer entry');
const bundle = normalizeInstance(loadCallFromXml(calls[0].xml, movesXml, formationsXml));
let threw = 0;
for (const f of size8) {
  try {
    const r = setStartFormation(bundle, f.poses);
    if (!r || r.dancers.length !== 8) threw++;
  } catch {
    threw++;
  }
}
check(threw === 0, `all ${size8.length} offered entries rebase the start`, `${threw} failed`);

console.log(`\narrangement-picker: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
