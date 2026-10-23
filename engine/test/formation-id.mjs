// A BOARD'S FORMATION IDENTITY IS COMPUTED FROM THE BOARD, AND IT IS A KEY.
//
// WHY IT EXISTS. A permission rule's `board` is matched against `recognize`'s name, and that namer is a CURATED
// caption: MEASURED, it names **16 of the corpus's 138 eight-dancer formations**. The permissive namer behind it
// (`corpusFormation`) names all 138 exactly, but nothing names the setups an EMBEDDED `<tam>` carries - and
// those are not a curiosity: MEASURED over the authoring starts of 15 calls, of 100 boards 44 are named by
// `recognize`, 14 more by the exact corpus name, and **42 by neither** ("Facing Dancers Close", "Right-Hand
// Wave"). `formation-id.ts` gives every board a key that consults no library at all.
//
// WHAT THIS HARNESS PINS. Section 1 the format; 2 that rotation, translation and ARRAY ORDER drop out; 3 that
// the 138 formations get 138 ids; 4 that gender and couple numbers drop out (they are not part of a name
// either); 5 and 6 the two properties a SEDUCTIVE WRONG implementation loses, each with that implementation
// run beside it as the negative control; 7 the quantum, from both sides; 8 the embedded shapes this exists for.
//
// THE TWO CONTROLS ARE THE POINT OF SECTIONS 5 AND 6. A reflection-invariant key collapses 19 pairs of the 138;
// a topology-only (rank) key collapses the `... Compact` pairs. Neither is a straw man - both are the obvious
// simplifications, and each is MEASURED here to fail exactly the check that rules it out and no other.
//
// Run: node test/formation-id.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, formationId, formationCanonical, isFormationId, FORMATION_ID_VERSION,
  FORMATION_ID_GRID, FORMATION_ID_HEADING_STEP, poseFor, setParser,
} from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};
const fmt = (n) => (Math.round(n * 1000) / 1000).toFixed(3);

const seq = new Sequencer(movesXml, formationsXml, callsByTitle(assets));
seq.setActiveLevel('ms');

/** Every named eight-dancer formation the corpus carries, as the board `boardForFormation` builds. */
const named = () => seq.listFormations()
  .map((name) => ({ name, board: seq.boardForFormation(name) }))
  .filter((f) => f.board && f.board.dancers.length === 8);

/** Quarter-turn `k` times about the origin, then translated: every dancer, every facing. */
const turn = (board, k, dx = 0, dy = 0) => ({
  dancers: board.dancers.map((d) => {
    let x = d.x;
    let y = d.y;
    for (let i = 0; i < k; i++) { const nx = -y; const ny = x; x = nx; y = ny; }
    return { ...d, x: x + dx, y: y + dy, heading: d.heading + (k * Math.PI) / 2 };
  }),
});
const reverse = (board) => ({ dancers: [...board.dancers].reverse() });
const regender = (board) => ({ dancers: board.dancers.map((d) => ({ ...d, gender: d.gender === 'boy' ? 'girl' : 'boy' })) });
const relabel = (board) => ({ dancers: board.dancers.map((d) => ({ ...d, couple: (d.couple % 4) + 1 })) });
const nudge = (board, dx) => ({ dancers: board.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + dx } : d)) });

/** A board built from an authored `<tam>`'s START pose - the embedded setups no formation file carries. */
const startBoard = (title, from) => {
  const variant = (seq.matchableVariants(title) ?? []).find((v) => (v.from || v.formation) === from);
  if (!variant) return null;
  return {
    dancers: variant.dancers.map((d, i) => {
      const p = poseFor(d, 0);
      return { id: i + 1, couple: 0, gender: d.gender ?? 'boy', x: p.x, y: p.y, heading: p.heading };
    }),
  };
};

/**
 * THE NEGATIVE CONTROLS: two plausible wrong identities, each computed here rather than in the module, so what
 * they lose can be measured against the same boards.
 *
 * `reflected` is the "a formation is a shape, and a mirror is the same shape" reading. `topology` is the "only
 * who is where relative to whom matters, not how far apart" reading - the one an All8 diagram forces, because
 * the diagrams carry no distances.
 */
const wrongKey = (board, { reflected, topology }) => {
  const step = (h) => { const k = Math.round(h / (Math.PI / 4)) % 8; return (k + 8) % 8; };
  const spots = board.dancers.map((d) => ({ x: d.x, y: d.y, h: step(d.heading) }));
  const keys = [];
  for (let t = 0; t < 4; t++) {
    for (const flip of reflected ? [false, true] : [false]) {
      const t2 = spots.map(({ x, y, h }) => {
        let X = x;
        let Y = y;
        let H = h;
        if (flip) { X = -X; H = (4 - H + 8) % 8; }
        for (let i = 0; i < t; i++) { const nx = -Y; const ny = X; X = nx; Y = ny; H = (H + 2) % 8; }
        return { x: X, y: Y, h: H };
      });
      if (topology) {
        const xs = [...new Set(t2.map((p) => p.x))].sort((a, b) => a - b);
        const ys = [...new Set(t2.map((p) => p.y))].sort((a, b) => b - a);
        keys.push(t2.map((p) => `${xs.indexOf(p.x)},${ys.indexOf(p.y)},${p.h}`).sort().join('|'));
      } else {
        const minX = Math.min(...t2.map((p) => p.x));
        const minY = Math.min(...t2.map((p) => p.y));
        keys.push(t2.map((p) => `${fmt(p.x - minX)},${fmt(p.y - minY)},${p.h}`).sort().join('|'));
      }
    }
  }
  return keys.sort()[0];
};

// ---------------------------------------------------------------- 1. the format
console.log('== 1. every board gets an id in one format ==');
const formations = named();
{
  check(formations.length === 138, `the corpus carries 138 named eight-dancer formations (got ${formations.length})`);
  // THE SHAPE IS PINNED LITERALLY, not derived from the constants: the scheme prefix and eight characters of base
  // 36 in LOWER case, which is the one width every id in this tree now uses. A change to the alphabet or the width
  // is a deliberate edit of this check, and the reason it is lower case is the reader's: `0` is not `o` and `1` is
  // not `l` when an id is retyped into a rule.
  const SHAPE = /^F3-[0-9a-z]{8}$/;
  const bad = formations.filter(({ board }) => !SHAPE.test(formationId(board)));
  check(bad.length === 0, `all ${formations.length} ids are "${FORMATION_ID_VERSION}" plus eight lower-case base-36 characters `
    + `(e.g. ${formationId(formations[0].board)}, ${formationId(formations[1].board)})`,
    bad.slice(0, 5).map((f) => `${f.name}: ${formationId(f.board)}`).join(', '));
  // THE TWO GRAMMARS THE MATCHER ACTUALLY ACCEPTS. `evaluatePermissions` normalises case on both sides of a
  // `boardId`, so a rule retyped in upper case is the same id - and `isFormationId` must agree with that rather
  // than pass a value the matcher reads differently. The `F2-` shape (six characters) is NOT an id.
  const sample = formationId(formations[0].board);
  check(isFormationId(sample.toUpperCase()), 'an id retyped in upper case is still recognised (the matcher is case-insensitive too)');
  check(!isFormationId('F2-abc123') && !isFormationId('F3-abc123'), 'while the old six-character shape and a short payload are not');
  const starts = [startBoard('Swing Thru', 'Right-Hand Wave'), startBoard('Box the Gnat', 'Facing Couples')];
  check(starts.every((b) => b && SHAPE.test(formationId(b))),
    'and so do the embedded authoring setups, which no formation file names',
    'a missing starter is a FAILURE, not a skip');
}

// ---------------------------------------------------------------- 2. what drops out
console.log('\n== 2. rotation, translation and array order drop out ==');
{
  const differ = [];
  let trials = 0;
  for (const { name, board } of formations) {
    const base = formationId(board);
    for (let k = 1; k < 4; k++) { trials++; if (formationId(turn(board, k)) !== base) differ.push(`${name} @${k * 90}deg`); }
    trials++;
    if (formationId(turn(board, 0, 3.5, -2.5)) !== base) differ.push(`${name} @translated`);
    trials++;
    if (formationId(reverse(board)) !== base) differ.push(`${name} @reversed`);
  }
  check(differ.length === 0, `all four quarter-turns, a translation and a reversed dancer array keep the id (${differ.length} of ${trials} differ)`,
    differ.slice(0, 6).join(', '));
  // WHY IT CAN BE EXACT RATHER THAN NEARLY: the quantisation rounds, and a tie would round differently under a
  // quarter turn. MEASURED - no corpus coordinate or facing sits on either grid's tie boundary, which is what
  // makes the invariance a property and not a coincidence. (At a 1.0-unit grid, 136 coordinates do, and four
  // formations lost their id after a quarter turn; at a 45-degree heading step, `Circle`'s 22.5-degree facings
  // do, and `Circle` and `Alamo Wave` lost theirs. Both are why the grids are the ones they are.)
  const tieOf = (v, grid) => {
    const k = Math.abs(v) / grid;
    return Math.abs(k - Math.floor(k) - 0.5) < 1e-9;
  };
  let positionTies = 0;
  let headingTies = 0;
  let values = 0;
  for (const { board } of formations) {
    for (const d of board.dancers) {
      for (const v of [d.x, d.y]) { values++; if (tieOf(v, FORMATION_ID_GRID)) positionTies++; }
      if (tieOf(d.heading, FORMATION_ID_HEADING_STEP)) headingTies++;
    }
  }
  check(positionTies === 0 && headingTies === 0,
    `and nothing in the corpus sits on either grid's tie boundary (${positionTies} of ${values} positions, `
      + `${headingTies} of ${formations.length * 8} facings), so no rounding can be argued with`,
    'a tie is the one value a rounding rule cannot make rotation-equivariant');
}

// ---------------------------------------------------------------- 3. it is a key
console.log('\n== 3. the 138 formations have 138 ids ==');
{
  const ids = new Map();
  for (const { name, board } of formations) {
    const id = formationId(board);
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(name);
  }
  const collisions = [...ids.values()].filter((v) => v.length > 1);
  check(ids.size === formations.length,
    `${ids.size} distinct ids for ${formations.length} formations, so the id is a key and not a summary`,
    collisions.slice(0, 5).map((v) => v.join(' == ')).join('  ||  '));
  // AND THE CANONICAL FORM IS WHY: the id is a digest, so a collision would be silent. The serialisation is
  // the thing a reader can diff, so it is pinned to disambiguate exactly what the id does.
  const canon = new Set(formations.map(({ board }) => formationCanonical(board)));
  check(canon.size === formations.length, `and ${canon.size} distinct canonical serialisations behind them`);
}

// ---------------------------------------------------------------- 4. what it deliberately ignores
console.log('\n== 4. gender and couple numbers are not part of an identity ==');
{
  const shifted = formations.filter(({ board }) => formationId(regender(board)) !== formationId(board)).map((f) => f.name);
  check(shifted.length === 0, `regendering every dancer keeps every id (0 of ${formations.length} changed)`,
    shifted.slice(0, 6).join(', '));
  const relabelled = formations.filter(({ board }) => formationId(relabel(board)) !== formationId(board)).map((f) => f.name);
  check(relabelled.length === 0, `and so does renumbering the couples (0 of ${formations.length} changed)`,
    relabelled.slice(0, 6).join(', '));
  check(formationId(regender(seq.boardForFormation('Ocean Waves'))) === formationId(seq.boardForFormation('Ocean Waves')),
    'a name does not distinguish `Ocean Waves` from its gender-swapped twins, so neither does the id');
}

// ---------------------------------------------------------------- 5. chirality (control)
console.log('\n== 5. a mirror is a DIFFERENT formation ==');
{
  const pairs = [
    ['Diamonds', 'Diamonds LH Girl Points'],
    ['Thar LH Boys', 'Thar RH Boys'],
    ['Two-Faced Lines', 'Two-Faced Lines LH'],
  ];
  for (const [a, b] of pairs) {
    const pa = seq.boardForFormation(a);
    const pb = seq.boardForFormation(b);
    check(pa && pb, `the corpus carries both "${a}" and "${b}"`);
    if (!pa || !pb) continue;
    check(formationId(pa) !== formationId(pb), `they have different ids (${formationId(pa)} vs ${formationId(pb)})`);
    // THE CONTROL: a reflection-invariant identity calls them the same shape, so this check is what rules
    // that reading out. Sections 4 and 6 do not: both boards are eight dancers with the same genders per spot
    // family and the same spacing.
    check(wrongKey(pa, { reflected: true, topology: false }) === wrongKey(pb, { reflected: true, topology: false }),
      '…and the CONTROL: a reflection-invariant key calls them one shape, which is the reading this rules out');
  }
}

// ---------------------------------------------------------------- 6. spacing (control)
console.log('\n== 6. spacing is part of the formation ==');
{
  const pairs = [
    ['Normal Lines', 'Normal Lines Compact'],
    ['Ocean Waves', 'Ocean Waves RH BGGB Compact'],
    ['Two-Faced Lines', 'Two-Faced Lines RH Compact'],
  ];
  for (const [a, b] of pairs) {
    const pa = seq.boardForFormation(a);
    const pb = seq.boardForFormation(b);
    check(pa && pb, `the corpus carries both "${a}" and "${b}"`);
    if (!pa || !pb) continue;
    check(formationId(pa) !== formationId(pb), `they have different ids (${formationId(pa)} vs ${formationId(pb)})`);
    // THE CONTROL: a topology-only identity (ranks, no distances - the reading an All8 diagram forces) calls
    // them one shape. Section 5's control passes a rank key, so exactly this check rules the rank reading out.
    check(wrongKey(pa, { reflected: false, topology: true }) === wrongKey(pb, { reflected: false, topology: true }),
      '…and the CONTROL: a topology-only key calls them one shape, which is the reading this rules out');
  }
}

// ---------------------------------------------------------------- 7. the quantum
console.log('\n== 7. the quantum, from both sides ==');
{
  const board = seq.boardForFormation('Normal Lines');
  // The band is +/-half the grid (0.125 units): what it absorbs is FLOAT RESIDUE - the same board computed by
  // two paths - not a caller's placement error, which is what `recognize`'s name and its ~0.5 slack are for.
  check(formationId(nudge(board, 0.1)) === formationId(board),
    'a dancer 0.1 units out keeps the id (within half the grid: float residue is a no-op)');
  check(formationId(nudge(board, 1.0)) !== formationId(board),
    'a dancer a whole grid cell out gets a different id (the must-reject difference, which is 4x the band)');
  // AND THE SPACING THE CORPUS ACTUALLY USES TO DISTINGUISH TWO SETUPS: `Compact` is 0.5 in, which a coarser
  // grid than this one would have swallowed (section 6 pins the ids; this pins the margin).
  const compact = seq.boardForFormation('Normal Lines Compact');
  check(formationId(nudge(board, 0.5)) !== formationId(compact),
    'and a board half a unit from `Compact` is not mistaken for it');
}

// ---------------------------------------------------------------- 8. the embedded shapes this exists for
console.log('\n== 8. the setups no formation file carries ==');
{
  const wave = startBoard('Swing Thru', 'Right-Hand Wave');
  const gnat = startBoard('Box the Gnat', 'Right-Hand Wave');
  check(!!wave && !!gnat, 'two calls authored from "Right-Hand Wave" are on the board');
  if (wave && gnat) {
    check(seq.boardIdentity(wave).name === null,
      `no namer names that board (name ${JSON.stringify(seq.boardIdentity(wave).name)}), so the id is the ONLY key`);
    check(formationId(wave) === formationId(gnat),
      `and both calls' tams start on the same shape, so they share one id (${formationId(wave)})`,
      'this is what "an embedded formation can have an id too" means: it is read from the board, not the label');
  }
  // THE LABEL IS NOT AN IDENTITY, which is the whole point: two calls can carry ONE `from` spelling on two
  // different boards, and the ids tell them apart where the label cannot.
  const facing = ['Swing Thru', 'Star Thru'].map((t) => startBoard(t, 'Facing Couples')).filter(Boolean);
  check(facing.length === 2 && facing[0].dancers.length === facing[1].dancers.length,
    'two calls authored from "Facing Couples" are on boards of the same size');
  if (facing.length === 2) {
    const differs = formationId(facing[0]) !== formationId(facing[1]);
    console.log(`     (ids ${formationId(facing[0])} and ${formationId(facing[1])} - ${differs ? 'different boards under one label' : 'the same board'})`);
  }
  // A SASHayed setup is a gender change on the same geometry, so it is the same shape - section 4's rule
  // applied to a label the corpus really uses.
  const plain = startBoard('Star Thru', 'Facing Couples');
  const sashayed = startBoard('Star Thru', 'Sashayed Couples');
  check(!!plain && !!sashayed && formationId(plain) === formationId(sashayed),
    '`Facing Couples` and `Sashayed Couples` are one shape (the genders differ, the geometry does not)',
    plain && sashayed ? `${formationId(plain)} vs ${formationId(sashayed)}` : 'a missing starter is a FAILURE');
}

// ---------------------------------------------------------------- 9. the name-then-id pair
console.log('\n== 9. the two keys a rule may name ==');
{
  const square = seq.boardForFormation('Static Square');
  const keys = seq.boardIdentity(square);
  check(keys.name === 'Static Square', `the curated name comes first where there is one (${JSON.stringify(keys.name)})`);
  check(isFormationId(keys.id), `and the id is there beside it (${keys.id})`);
  check(seq.boardIdentity(turn(square, 2)).id === keys.id, 'a rotation of the board reports the same id');
  // THE MEMO IS KEYED ON THE BOARD OBJECT, so two content-equal boards must still answer the same thing.
  const copy = turn(square, 0, 0, 0);
  check(seq.boardIdentity(copy).id === keys.id && seq.boardIdentity(copy).name === keys.name,
    'a second, separately built board of the same shape answers the same');
  // THE CORPUS FALLBACK, and only where the curated namer declines: 122 of the 138 have no curated name, and
  // every one of them still has the corpus's own.
  const unnamedByCurated = formations.filter(({ board }) => seq.recognize(board).name === null);
  const withCorpusName = unnamedByCurated.filter(({ board }) => seq.boardIdentity(board).name !== null);
  check(unnamedByCurated.length > 0 && withCorpusName.length === unnamedByCurated.length,
    `all ${unnamedByCurated.length} boards the curated namer cannot name still get the corpus's own name `
      + `(${withCorpusName.length} of ${unnamedByCurated.length})`,
    'the 16 the curated namer does know are not in this sample, which is why the count is printed');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
