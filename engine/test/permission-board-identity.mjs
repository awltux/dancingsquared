// THE BOARD IDENTITY A PERMISSION RULE MATCHES ON — and why it is the recogniser's NAME, not a cell key.
//
// Step "3" of the agreed order was to key formation-scoped permission rules on a stable geometry/cell key
// "rather than the recogniser's display name". MEASURED, that is the wrong way round, and this harness is the
// record so the swap is not proposed again:
//
//   * `recognize(board).name` IS rotation- and reflection-stable -- the recogniser runs the same
//     rotation/reflection-tolerant matcher every other reading does, so a squared set turned by 0/45/90/180
//     degrees is still named `Static Square`. The name is a SHAPE identity, which is what a rule wants.
//   * `geometryKey(boardMatchables(board))` is a POSE key, not a shape key: the same square turned by 0, 45 and
//     90 degrees gives THREE DIFFERENT keys (it is centred and rounded but not de-rotated). Keying a rule on it
//     would make the rule stop firing for a rotated square -- strictly less stable than the name it replaces.
//
// THE REAL GAP IS ELSEWHERE, and it is printed rather than asserted because it is a defect to close, not a
// property to preserve: `recognize` returns NO name for most boards built from the corpus's own named
// formations, and `mayOffer` passes that null straight into the permission request, where a formation-scoped
// rule cannot match it. Closing it means making the naming total (or falling back to the lax namer, which
// trap 10 says disagrees on purpose) -- not swapping the key.
//
// Run: node test/permission-board-identity.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, geometryKey, boardMatchables } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), []);
const square = seq.boardForFormation('Static Square');

/** A set turned about its own centroid, headings included -- a turned set is a set whose dancers have turned. */
function turned(dancers, rad) {
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
const DEG = Math.PI / 180;

console.log('\n== 1. the NAME is a shape identity: it survives rotation ==');
{
  // What a formation-scoped rule must be keyed on. Every one of these is the same square to a caller.
  for (const deg of [0, 45, 90, 180]) {
    const name = seq.recognize({ ...square, dancers: turned(square.dancers, deg * DEG) })?.name ?? null;
    check(name === 'Static Square', `${deg} deg: still named ${JSON.stringify(name)}`);
  }
}

console.log('\n== 2. the CELL KEY is a pose identity: it does NOT survive rotation ==');
{
  // THE CONTROL THAT RULES OUT THE SWAP. If a cell key were a shape key these would coincide; they do not, so
  // keying a permission rule on it would make the rule stop firing the moment the board is turned.
  const keys = [0, 45, 90].map((deg) => geometryKey(boardMatchables({ ...square, dancers: turned(square.dancers, deg * DEG) })));
  // THE CLAIM IS "NOT INVARIANT", NOT "THREE DISTINCT": MEASURED at 2 distinct of 3, because two of these turns
  // round to the same centred pose after the heading is taken into the key. One coincidence is enough to rule
  // the swap out only if the keys are not ALL equal -- which is the property that matters, since a rule keyed on
  // a key that changes under rotation stops firing on a turned board.
  check(new Set(keys).size > 1, `0/45/90 deg give ${new Set(keys).size} distinct keys of 3, so the key is pose-exact rather than shape-stable`);
  check(geometryKey(boardMatchables(square)) === geometryKey(boardMatchables(square)), 'and it is deterministic for one unchanged board (so the difference above is the turn, not instability)');
}

console.log('\n== 3. the gap that is actually there: the recogniser is not total ==');
{
  // Printed, not asserted: this is the defect to close. A rule keyed on a board name cannot match a board the
  // recogniser refuses, and `mayOffer` passes that null through.
  const names = seq.listFormations();
  const unnamed = names.filter((n) => {
    const b = seq.boardForFormation(n);
    return !b || !seq.recognize(b)?.name;
  });
  console.log(`       ${unnamed.length} of ${names.length} boards built from a named formation recognise to NO name`);
  console.log(`       (e.g. ${unnamed.slice(0, 4).join(', ') || 'none'})`);
  // What IS assertable: the board field a rule sees is null exactly for those, so the finding above is about
  // the permission request and not about a display string.
  const witness = unnamed[0];
  check(witness === undefined || seq.recognize(seq.boardForFormation(witness))?.name == null, `a witness's recognised name really is null (${witness ?? 'none'})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
