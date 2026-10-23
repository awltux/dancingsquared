// THE ROTATION SET, AND WHICH ALIGNMENT IT PICKS WHEN SEVERAL WOULD DO.
//
// `match.ts` tries EIGHT rotations (`ROTS`: the quarter turns AND the diagonals) and, for each, direct and
// reflected, and keeps the best by summed error. The diagonals are there for setups that are genuinely
// rotated relative to the square (diamonds, the 45-degree waves); the risk this harness exists to rule out
// is a DIAGONAL alignment winning for a SQUARE-LATTICE board, where the correspondence would put a corner
// where a side belongs and the motion would be applied to the wrong dancers.
//
// THE MECHANISM, read from `matchEqualLength` (match.ts): the error is a SUM over dancers with a floor of 0
// for an exact congruence; a strictly lower error wins; on a tie a DIRECT reading beats a reflected one, and
// a later candidate can only win a tie on a HIGHER identity score. `ROTS` begins at 0 and `identityScore`
// can only rise by matching more couples, which a rotation moves AWAY from home. So a diagonal can win only
// by fitting STRICTLY BETTER than every axis alignment -- which is exactly the case where the setup really
// is diagonal.
//
// THAT ARGUMENT IS WHY THE CHECKS BELOW ARE SHAPED THE WAY THEY ARE: an argument is not a measurement
// (AGENTS.md 4.1), and the last time a rotation instrument was written here it passed its own control in
// two opposite directions. So this harness pins the ARGUMENT'S PREMISES, each with a control that would
// fail if the premise were false:
//
//   1. an already-aligned shape is never re-oriented      -- and (2) proves rotation is not simply ignored,
//   2. a rotated target IS reported as a non-zero rot     -- the anti-tautology control for (1) and (3),
//   3. a board with its headings stripped still ties to 0 -- the 8-fold POSITIONAL case, where a square's
//      dancers sit at 45-degree spacing and nothing but the tie-break keeps the diagonal out,
//   4. a diagonal rotation IS reachable when it is the only fit -- so (3) is a statement about ties, not
//      about the diagonal entries being dead,
//   5. a shape symmetric under reflection is matched DIRECT -- the same tie rule one axis over.
//
// Run: node test/rotation-tiebreak.mjs   (engine must be built; reads assets/ at the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, matchFormations } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';
setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const DEG = 180 / Math.PI;
// THE CORPUS IS AT THE REPO ROOT, AND THIS HARNESS IS RUN FROM `engine/` BY THE SUITE. A bare
// 'assets/...' resolves against the working directory, which is `engine/` under `verify-suite.mjs` and the
// repo root when the file is run by hand -- so it worked standalone and failed in the gate. Anchor it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), []);
const names = seq.listFormations();
const board = (name) => seq.boardForFormation(name);
const matchable = (d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple });

/** `source` is the board; `target` is the authored shape. The same shape both sides = "does it re-orient itself". */
const align = (source, target, maxError) => matchFormations(source.map(matchable), target.map(matchable), maxError, false);

/** Rotate a set about its own centroid, headings included -- a rotated set is a set whose dancers have turned. */
function rotated(dancers, rad) {
  const cx = dancers.reduce((s, d) => s + d.x, 0) / dancers.length;
  const cy = dancers.reduce((s, d) => s + d.y, 0) / dancers.length;
  const norm = (a) => {
    let x = a % (2 * Math.PI);
    if (x > Math.PI) x -= 2 * Math.PI;
    if (x <= -Math.PI) x += 2 * Math.PI;
    return x;
  };
  return dancers.map((d) => {
    const x = d.x - cx;
    const y = d.y - cy;
    return { ...d, x: Math.cos(rad) * x - Math.sin(rad) * y, y: Math.sin(rad) * x + Math.cos(rad) * y, heading: norm(d.heading + rad) };
  });
}

// TWO TOLERANCES, because the accept test compares a SUMMED error and the caller's budget varies: the
// outcome must not depend on which budget is used.
const TOLERANCES = [1.2, 6.0];

console.log(`== 1. an already-aligned shape is never re-oriented (${names.length} unique shapes) ==`);
for (const tol of TOLERANCES) {
  let reoriented = 0;
  let reflected = 0;
  let unmatcheable = 0;
  const examples = [];
  for (const name of names) {
    const b = board(name);
    if (!b || b.dancers.length !== 8) continue;
    const m = align(b.dancers, b.dancers, tol);
    if (!m) {
      unmatcheable++;
      continue;
    }
    if (Math.abs(m.rot) > 1e-9) {
      reoriented++;
      if (examples.length < 5) examples.push(`${name}: rot ${Math.round(m.rot * DEG)}`);
    }
    if (m.reflect) reflected++;
  }
  check(unmatcheable === 0, `every shape matches itself at maxError ${tol} (${unmatcheable} did not)`);
  check(reoriented === 0, `and none of them is RE-ORIENTED, so no diagonal or quarter turn is chosen for an aligned board (${reoriented} were${examples.length ? ': ' + examples.join('; ') : ''})`);
  check(reflected === 0, `nor is any of them read as a REFLECTION (${reflected})`);
}

console.log('\n== 2. CONTROL: rotation is solved, not ignored ==');
{
  // If `rot` were always 0 this harness would pass for the wrong reason. Rotate the TARGET by a quarter
  // turn and the matcher must report the opposite rotation to overlay it.
  const sq = board('Static Square');
  const target = rotated(sq.dancers, Math.PI / 2);
  const m = align(sq.dancers, target, 6.0);
  check(m !== null, 'a quarter-turned square still matches');
  check(m !== null && Math.abs(Math.abs(m.rot) - Math.PI / 2) < 1e-6, `and the matcher reports the quarter turn it used (${m ? Math.round(m.rot * DEG) : '-'} deg)`);
  check(m !== null && m.error < 1e-6, `at zero error (${m ? m.error.toExponential(1) : '-'})`);
}

console.log('\n== 3. the 8-fold POSITIONAL case: headings are what keep the diagonal out ==');
{
  // A squared set's eight dancers sit at 45-degree spacing, so its POSITIONS alone are invariant under the
  // diagonals. With no headings to break the symmetry, a 45-degree alignment fits positions exactly, and the
  // ONLY thing that stops it being chosen is the tie-break: error 0 cannot be beaten, and ROTS starts at 0.
  const sq = board('Static Square');
  const flat = sq.dancers.map((d) => ({ ...d, heading: 0 }));
  const m = align(flat, flat, 6.0);
  check(m !== null, 'a heading-stripped square still matches itself');
  check(m !== null && Math.abs(m.rot) < 1e-9, `and the alignment chosen is 0 deg, not one of the diagonals (${m ? Math.round(m.rot * DEG) : '-'} deg)`);
  check(m !== null && m.reflect === false, 'and direct, not reflected');
  // THE DIAGONAL REALLY IS A TIE HERE, or the check above would be vacuous -- a diagonal that simply did
  // not fit would leave nothing for the tie-break to decide. Turning the flat square by 45 degrees leaves
  // its POSITIONS unchanged (eight dancers at 45-degree spacing) and the matcher undoes the turn in the
  // target's headings, so it matches exactly; the only reason 0 still wins is that it is examined first.
  const turned = align(flat, rotated(flat, Math.PI / 4), 6.0);
  check(turned !== null && turned.error < 1e-9, `NEGATIVE CONTROL: the diagonal fits exactly too (error ${turned ? turned.error.toExponential(1) : '-'}), so the winner is the tie-break and not a failed fit`);
}

console.log('\n== 4. CONTROL: a diagonal IS reachable when it is the only fit ==');
{
  // Rotate the target by 45 degrees: no axis alignment can overlay it, so the matcher must use a diagonal.
  // This is what makes check 3 a statement about ties rather than about the diagonal entries being dead.
  const sq = board('Static Square');
  const target = rotated(sq.dancers, Math.PI / 4);
  const m = align(sq.dancers, target, 6.0);
  check(m !== null, 'a 45-degree-rotated square still matches');
  check(m !== null && Math.abs(Math.abs(m.rot) - Math.PI / 4) < 1e-6, `and a diagonal rotation is reported (${m ? Math.round(m.rot * DEG) : '-'} deg)`);
}

console.log('\n== 5. a reflection-symmetric shape is still read DIRECT ==');
{
  // Static Square is symmetric under reflection, so (rot 0, reflect true) is exact as well. The tie rule
  // must still prefer the direct reading -- the same rule `matcher.ts` measured on `Left Swing Thru`.
  const sq = board('Static Square');
  const mirrored = sq.dancers.map((d) => ({ ...d, x: -d.x, heading: Math.PI - d.heading }));
  const m = align(mirrored, sq.dancers, 6.0);
  check(m !== null, 'a mirrored square matches');
  check(m !== null && m.reflect === false, `and it is read DIRECT at zero error (reflect ${m ? m.reflect : '-'}, error ${m ? m.error.toExponential(1) : '-'})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
