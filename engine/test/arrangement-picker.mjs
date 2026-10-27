// THE ARRANGEMENT PICKER. What the editor's Start/End setup lists offer, and why it is not the library's
// formation list.
//
// WHY THIS IS A POC-SIDE HARNESS LIVING IN `engine/test`. The list is built by
// `poc/src/tam-xml.ts`'s `corpusFormationsOfSize`, from `assets/formations.xml`. It is NOT
// `Sequencer.listFormations()`: that is the ENGINE's formation library, keyed on GEOMETRY UP TO
// CONGRUENCE, and it is deliberately left alone - `shape-census.mjs` pins its 134 names and all-eight
// invariant and four other harnesses walk it. Filling a PICKER from a matching key was the bug: two
// boards reachable from one another by a rotation are the same SHAPE and different ARRANGEMENTS, and a
// caller choosing a start is choosing the second thing.
//
// MEASURED, and the report that prompted this: `Columns`, `Column RH GBGB`, `Columns LH BGBG` and
// `Column LH GBGB` all stand on the same eight spots (the corpus writes the half set and the picker
// completes it), and they are FOUR different arrangements, because the key below carries heading AND
// gender: no two are equal under it, and none is another's gender swap. The engine's matcher reports
// `reflect: true`, `rotation: NaN` on these half-set boards and accepts a reflection as a match, so
// keyed on it the picker offered ONE entry where the corpus names four.
//
// AND THE NAMES ARE NOT THE LIBRARY'S, which is how section 4 went wrong before: it asked for
// `Columns LH`, a name this corpus has never carried, so that check was red for ever and the two
// witnesses beneath it silently skipped (AGENTS.md §11.2.2).
//
// THE KEY IS POSITIONAL - same spot, same heading, same gender - and the counts below are what that
// keeps. The reimplementation here is deliberate, like `shape-census`'s: a harness that calls the
// function it is checking cannot catch the function changing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { DEG, Sequencer, completedFormation, parseFormations, setParser, setStartFormation, loadCallFromXml, normalizeInstance } from '../dist/index.js';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

setParser(DOMParser);

const asset = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8');
const formationsXml = asset('formations.xml');
const movesXml = asset('moves.xml');

const all = parseFormations(formationsXml);

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) { console.log(`  FAIL ${what}${detail ? ` - ${detail}` : ''}`); failures++; }
  else console.log(`  ok   ${what}`);
};

/**
 * The corpus's HALF-SET rule is the ENGINE's `completedFormation`, imported rather than copied: this harness used to
 * spell it out here, and so did `poc/src/half-set.ts` and `poc/src/tam-xml.ts`. It is PREPARATION rather than the
 * judge - what is under test is the arrangement key below - so importing it measures the picker against the shape the
 * app actually stands up, which is the rule the engine owns.
 */

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
    const poses = completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
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
//
// RE-PINNED, DIRECTION WIDER. The corpus gained twelve named formations since these counts were pinned
// (`7cbb693`): 280 formations there, 292 here, and NOTHING was removed (measured). The growth reaches
// exactly these pins, by size - four 2-dancer (`Adjacent Dancers`, `Close`, `Compact`, `Far`), one
// 4-dancer (`Corner Dancers Far`) and seven 8-dancer (the two `Right and Left Grand`/`Wrong Way Grand`
// static squares and circles, `Four Dancer Star Promenade` and its Wrong Way, `Alamo Wave Inverted`):
// 2 -> 10, 4 -> 49, 8 -> 209.
//
// THE EIGHT-DANCER PIN WAS ALREADY ONE BEHIND ITS OWN COMMIT, and that part is NOT attributed: run
// against `7cbb693`'s own corpus, this file counts 202 where the pin said 201, so the check has been
// red since the commit that added it. The widening is therefore 201 -> 209, not six additions.
const EXPECT = { 2: 10, 4: 49, 6: 1, 8: 209, 16: 0 };
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
console.log('\n4. the four "Columns" names that started this - four arrangements on one set of spots');
//
// MEASURED AND RE-PINNED. The corpus names four formations on those eight spots and the key says they
// are four arrangements, so ALL FOUR are offered - a fold here would mean the key had stopped carrying
// gender, which is the bug this harness exists for.
//
// THE NAMES ARE THE CONTROL. `Columns LH` is not a formation name; the corpus spells the left-hand
// family `Columns LH BGBG` and `Column LH GBGB`. Until this list named only real ones, `p('Columns LH')`
// was `undefined` forever - red for the offered check and silent for the two blocks beneath it.
const size8 = bySize.get(8);
const COLUMNS = ['Columns', 'Column RH GBGB', 'Columns LH BGBG', 'Column LH GBGB'];
const posesOf = (name) => {
  const ds = all.get(name);
  return ds ? completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }))) : null;
};
// `parseFormations` is keyed by name including case, and the corpus spells these with a lower-case `l`
// in "3 and 1 lines" - so a direct `get` is what this needs, and `null` means the name moved.
const p = (n) => posesOf(n);
const unresolved = COLUMNS.filter((n) => p(n) === null);
check(unresolved.length === 0, 'all four Columns names resolve to a formation', unresolved.join(', '));

const offered = new Set(size8.map((f) => f.name));
for (const n of COLUMNS) check(offered.has(n), `${n} is offered`);

const spotSet = (poses) => new Set(poses.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`));
const spotsOf = COLUMNS.map((n) => (p(n) ? spotSet(p(n)) : new Set()));
const [reference] = spotsOf;
const sameSpots =
  reference.size > 0 && spotsOf.every((s) => s.size === reference.size && [...s].every((k) => reference.has(k)));
check(sameSpots, 'all four stand on the same eight spots', spotsOf.map((s) => s.size).join(', '));
check(reference.size === 8, 'and that set is eight spots, not four', `${reference.size}`);

// THE POINT. Four names, four arrangements: the positional key must not fold any pair.
const pairs = [];
for (let i = 0; i < COLUMNS.length; i++) {
  for (let j = i + 1; j < COLUMNS.length; j++) pairs.push([COLUMNS[i], COLUMNS[j]]);
}
for (const [a, b] of pairs) {
  if (!p(a) || !p(b)) {
    check(false, `${a} != ${b} (a name did not resolve)`);
    continue;
  }
  check(!sameArrangement(p(a), p(b)), `${a} != ${b}`);
}

// ---------------------------------------------------------------- 5. the rotational families it keeps
console.log('\n5. rotations the congruence key folded, now kept as separate arrangements');
// These four pairs are the SECOND half of the reported defect, and the reason the picker may not be
// built from the library's congruence key: each pair stands on one set of spots, a half turn apart, and
// the old key offered only one of each. That claim is MEASURED here rather than stated in a title -
// "both are offered" alone would pass on any two names and prove nothing about the folding.
const isHalfTurnApart = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  const at = new Map(b.map((q) => [`${q.x.toFixed(2)},${q.y.toFixed(2)}`, q]));
  return a.every((q) => {
    const m = at.get(`${q.x.toFixed(2)},${q.y.toFixed(2)}`);
    if (!m) return false;
    return Math.abs((((m.heading - q.heading) / DEG + 360) % 360) - 180) < 0.01;
  });
};
for (const [a, b] of [
  ['Tidal 3 and 1 Line #1', 'Tidal 3 and 1 Line #5'],
  ['Tidal 3 and 1 Line #2', 'Tidal 3 and 1 Line #6'],
  ['Tidal Wave', 'Tidal Wave LH BGGB'],
  ['Stars RH', 'Stars LH'],
]) {
  if (!offered.has(a) || !offered.has(b)) {
    check(false, `${a} and ${b} both offered`, `${a}=${offered.has(a)} ${b}=${offered.has(b)}`);
    continue;
  }
  check(true, `${a} and ${b} both offered`);
  check(isHalfTurnApart(p(a), p(b)), `${a} and ${b} stand on one set of spots, a half turn apart`);
  check(!sameArrangement(p(a), p(b)), `${a} and ${b} are nevertheless different arrangements`);
}

// ---------------------------------------------------------------- 6. the library's names are covered
console.log('\n6. every name the ENGINE library knows is represented, bar the exact-duplicate spellings');
const msDir = path.join(corpusRoot(), 'ms');
const calls = filesOf('ms')
  .filter((f) => f.endsWith('.xml'))
  .map((f) => ({ name: f.replace(/\.xml$/, ''), xml: readFileSync(path.join(msDir, f), 'utf8') }));
const seq = new Sequencer(movesXml, formationsXml, calls);
const libNames = seq.listFormations();
// RE-PINNED WITH THE COUNTS ABOVE, SAME WIDENING AND SAME COMMIT. `listFormations()` derives its names
// from the corpus's formations, so the twelve additions moved it too: 134 -> 138, nothing removed. The
// four new names are `Four Dancer Star Promenade`, `Right and Left Grand Circle`, `Right and Left Grand
// Static Square` and `Wrong Way Four Dancer Star Promenade` (measured against `7cbb693`'s corpus; the
// other eight additions were already known to the library under another name or size).
check(libNames.length === 138, 'the library still holds 138 names', `got ${libNames.length}`);

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
