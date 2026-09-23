// The squared set, as the engine's own formation library writes it, carrying the manual's numbers.
//
// SHARED BY TWO TOOLS. `make-positions.mjs` draws the annotated position diagrams as SVG and
// `make-formations.mjs` draws the small formation diagrams as PNG; both need the same eight dancers
// with the same couple and dancer numbers, and deriving that twice is how two pictures of the same
// thing end up disagreeing. Nothing here is hand-typed: the geometry is the library's, and the
// manual's rules are asserted against it rather than assumed.
import { readAsset, loadEngine } from './load.mjs';

/**
 * Complete a written half-set the way the engine does: add the 180-degree rotation about the origin
 * unless the written dancers already include their own antipodes.
 *
 * THE LIBRARY WRITES HALF A SET. That is the documented rule (`square-dancing.md` §7.1.1): a
 * formation writes the dancers plus the same dancers turned 180 degrees about the origin, unless it
 * already contains both halves. `Squared Set` is written as four dancers, so each figure is completed
 * here by the same rotation the engine uses -- measured by looking for an antipode, not assumed.
 */
export function completeSet(written) {
  const hasAntipode = written.every((d) => written.some((o) => o !== d && Math.abs(o.x + d.x) < 0.05 && Math.abs(o.y + d.y) < 0.05));
  if (hasAntipode) return { dancers: written.map((d) => ({ ...d })), mirrored: false };
  const mirrored = written.map((d) => ({
    gender: d.gender,
    x: -d.x,
    y: -d.y,
    angleDeg: ((d.angleDeg ?? 0) + 180) % 360,
  }));
  return { dancers: [...written, ...mirrored], mirrored: true };
}

/** Which side of the square a position stands on. */
export function sideOf(x, y) {
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 'north' : 'south';
  return x > 0 ? 'east' : 'west';
}

/**
 * The squared set, as couples carrying the manual's numbers.
 *
 * The side-to-number map is the manual's rule with the caller at the south -- "the Couple whose back
 * is to the caller is Couple #1, the Couple to their right is Couple #2, and so on" -- so the
 * numbering runs south, east, north, west. The Boy of each couple is derived from the couple's own
 * facing and then checked against the library's gender.
 */
export function couples() {
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const written = lib.get('Squared Set');
  if (!written || !written.length) throw new Error('formations.xml has no "Squared Set"');

  const { dancers } = completeSet(written);
  if (dancers.length !== 8) throw new Error(`Squared Set has ${dancers.length} dancers, expected 8`);

  const NUMBER_OF_SIDE = { south: 1, east: 2, north: 3, west: 4 };
  const grouped = new Map();
  for (const d of dancers) {
    const side = sideOf(d.x, d.y);
    if (!grouped.has(side)) grouped.set(side, []);
    grouped.get(side).push({ ...d, side });
  }
  if (grouped.size !== 4) throw new Error(`found ${grouped.size} sides, expected 4`);

  const out = [];
  for (const [side, pair] of grouped) {
    if (pair.length !== 2) throw new Error(`${side} has ${pair.length} dancers, expected 2`);
    const couple = NUMBER_OF_SIDE[side];
    const [a, b] = pair;
    if (a.angleDeg !== b.angleDeg) throw new Error(`${side}: the couple does not share a facing`);

    // LEFT of the couple's facing. Board +y is north, so a heading h faces (cos h, sin h) and left is
    // that turned a quarter turn anticlockwise, (-sin h, cos h).
    const h = ((a.angleDeg ?? 0) * Math.PI) / 180;
    const left = { x: -Math.sin(h), y: Math.cos(h) };
    const score = (d) => (d.x - a.x) * left.x + (d.y - a.y) * left.y;
    const boy = score(a) > score(b) ? a : b;
    const girl = boy === a ? b : a;

    // The rule and the data must agree, or the picture would be drawing a fiction.
    if (boy.gender !== 'boy' || girl.gender !== 'girl') {
      throw new Error(
        `${side}: the dancer on the couple's left is recorded as ${boy.gender}, not a Boy — ` +
          'the "Boy on the left" rule and the formation library disagree',
      );
    }
    const number = (d) => (couple - 1) * 2 + (d === boy ? 1 : 2);
    out.push({
      couple,
      side,
      facing: a.angleDeg,
      boy: { ...boy, couple, number: number(boy) },
      girl: { ...girl, couple, number: number(girl) },
    });
  }
  out.sort((a, b) => a.couple - b.couple);
  return out;
}

/** The eight dancers of the squared set, each carrying `couple` (1-4) and `number` (1-8). */
export function squaredSetDancers() {
  return couples().flatMap((c) => [c.boy, c.girl]);
}
