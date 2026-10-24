// THE EXPORT PRECISION: the one place a number and a facing become the text of a `<tam>` or a `<formation>`.
//
// WHY THIS IS ITS OWN MODULE. The four-decimal rule was written three times, in two of the engine's largest modules
// and in the POC panel: `convert.ts`'s local `r`, `editor.ts`'s `rf`, and `poc/src/editor-ui.ts`'s `show` - the last
// justified by a comment saying it rounds "the way the engine's XML export does". Three copies with no export between
// them is a rule no probe could import, so the two engine copies could only be measured through a whole export round
// trip and the panel's copy was measured by nothing at all (AGENTS.md 5, "import the rule; never mirror it"). The
// `1e4` literal now appears once in `engine/src` and once in `poc/src`, and the second is an import of the first.
//
// WHY THE ROUNDING IS FOUR DECIMALS, and this is the measurement the two-decimal version failed. Two decimals is the
// asset files' own house style, and it is NOT enough for the editor's round trip: a path is a CHAIN of segments, each
// exporting its rotation Bezier to the nearest 0.01, so the heading error accumulates along the chain and the final
// pose is out by the distance travelled since. MEASURED on `ms/circle.xml` edited to 10.5 beats: the end pose came
// back 0.0672 units out - 13 times the rounding of any single coordinate - which is a dancer standing visibly off its
// spot. At four decimals the same path is out by 0.0008, and `engine/test/editor.mjs` pins both numbers.
//
// WHY TWO FUNCTIONS AND NOT ONE. A GEOMETRY HAS ONE SPELLING AND A FACING HAS TWO, so the canonicalisation is a
// separate rule rather than an option on the rounding: `-90` and `270` are the same facing, and a caller that wrote
// the raw number would dirty a file on a handle being dropped back where it started. `formationToXml` still writes its
// angles through `exportNumber` - the corpus authors 15 negative angles and a formation export must reproduce the
// geometry it was given - and only a DANCER's `angle` goes through `exportAngleDeg`. Unifying the two would rewrite
// those 15 authorings, which is a corpus change, not a formatting one.

/**
 * A number as the corpus writes it: four decimals, trailing zeros dropped.
 *
 * NOT A NORMALISER AND NOT AN ANGLE WRITER. `exportNumber(-90)` is `'-90'`; use `exportAngleDeg` where the value is a
 * facing, and see the header for why the two are not merged.
 */
export function exportNumber(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toString();
}

/**
 * The angle a dancer is WRITTEN with, canonical in `[0, 360)`.
 *
 * A FACING HAS TWO SPELLINGS AND A GEOMETRY HAS ONE, so the exported text must not depend on which code path built the
 * bundle. `angleDeg` is authored, or derived from a pose, and the two disagree; MEASURED (witness `ms/alamo_style.xml`,
 * dancer 0, move 3): `requireDancer` normalises a half-set bundle through `normalizeInstance`, which re-derives each
 * mirrored dancer's start heading from `poseFor` - so a no-op edit exported `angle="270"` as `angle="-90"`, the SAME
 * facing, on two lines that have nothing to do with the move that was edited. Two of the 64 exported lines differed and
 * the file was dirtied by a handle being dropped back where it started (`poc/tools/facing-handle-probe.mjs`).
 *
 * The obvious fix - stop `normalizeInstance` re-deriving the angle - is rejected: it is the one function that rewrites a
 * bundle in full-set coordinates, its output is pinned to one ulp by `editor.mjs`, and a mirrored dancer's `angleDeg`
 * is its BASE angle, which is not the full-set facing at all. Canonicalising the WRITTEN value fixes every path at
 * once, including the 15 negative angles the corpus authors (`angle="-90"` and friends): those re-save as their
 * positive equivalents, same facing, and the round trip's heading agreement is unchanged because it is measured
 * through `poseFor`, not through text.
 */
export function exportAngleDeg(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360;
  // 359.9999999999999 is 360 to within the export's own precision, and writing `360` would be out of range for a
  // reader that expects a half-open interval.
  return exportNumber(wrapped >= 360 - 5e-5 ? 0 : wrapped);
}
