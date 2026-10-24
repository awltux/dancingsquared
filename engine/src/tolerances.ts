// THE ENGINE'S TWO CROSS-CUTTING TOLERANCES: one for arithmetic that SHOULD be exact, one for the XML round trip.
//
// WHY THIS MODULE EXISTS. R8 counted what the tree still spells bare (`engine/test/tolerances.mjs`): the engine already
// names ~40 constants, and what the count hid was the tolerance literals written INLINE - `1e-9` in ten files, `1e-6`
// in eleven, `1e-3` in twelve - where the SAME role was named in one module (`ARC_EPS` privately in `editor.ts`,
// `NO_RADIUS` in the POC) and bare in the next. A number that decides a rule gets one name; these are the two that
// belong to no single module because geometry, the sequencer and the apps all need them.
//
// WHAT IS NOT HERE, and why the split is the design rather than a way-station:
//
//   * `SAME_BOARD_TOL` (1e-6) stays in `sequencer/constants.ts`, because it is a SEQUENCER fact: "did the set arrive at
//     the goal", where the two boards were computed by the same calls. It is a matching tolerance, and this file's
//     `EXACT_TOL` must never be substituted for it - the difference is the whole reason that constant's header exists.
//   * The TIE epsilons (`TIE_EPS`, `MATCH_TIE_EPS`, `REFLECT_TIE_EPS`, `CHOICE_TIE_EPS`) stay their own constants in
//     their own modules. They answer "are these two errors equal enough to tie", which is a comparison between two
//     measurements rather than a statement that one of them is zero. Merging them into `EXACT_TOL` would be the wrong
//     consolidation even where the value coincides.
//   * The rule-specific tolerances (`ARC_TOL`, `ARC_ANGLE_TOL`, `BODY_OVERLAP_EPS`, `END_BOARD_TOL`, `CELL_ROUND`,
//     `MIRROR_EPS`, `GRID_SNAP_EPS`, `RUN_FIT_MAX_DEV`, `solver`'s matrix-identity check) stay where they are: each is
//     one module's rule with its own measurement in its header.
//
// THE REJECTED ALTERNATIVE, recorded so it is not retried: ONE `EPSILON` for the whole engine. It reads tidy and it is
// wrong twice - it invites a matching tolerance to be used where exactness is the point (or the reverse), and it makes
// the tie rules look like a special case of zero. The three families are different QUESTIONS; two of them happen to
// share a value.

/**
 * THE TOLERANCE OF ARITHMETIC THAT SHOULD BE EXACT: 1e-9.
 *
 * It covers three shapes of the same question, and the unification is deliberate rather than incidental:
 *
 *   - "is this ZERO" - a radius, a chord, a determinant, a handle length that must be positive to mean anything
 *     (`r > EXACT_TOL`, `Math.abs(det) < EXACT_TOL`);
 *   - "are these the SAME" - two poses, two facing curves, compared after being computed by the same operations
 *     (`Math.abs(pose.x - target.x) <= EXACT_TOL`), where the correct answer is bit-exact and this is the residue of
 *     double arithmetic;
 *   - "INCLUDE THE ENDPOINT" - a sampling loop that must reach `total` exactly (`t <= total + EXACT_TOL`), so the last
 *     sample is not dropped by the accumulator's last bit.
 *
 * It is NOT a matching tolerance: `SAME_BOARD_TOL` (1e-6) and `DEFAULT_MATCH_MAX` (1.5) answer "is this the same
 * board / is this call legal", which are tolerant by design. The distinction is the one `constants.ts` spells out for
 * `SAME_BOARD_TOL` - a tolerance here is the difference between a correct answer and a wrong one that happens to be
 * near, so the only reason any tolerance exists at all is that floating-point arithmetic cannot be trusted to land on
 * the same bit twice.
 *
 * WHERE IT IS SCALED, IT IS SCALED IN PLACE: two comparisons are RELATIVE (`arcIsCircle` and the grid-facing check in
 * `moves.ts` compare against `EXACT_TOL * Math.max(1, ...)`), because the quantity being compared has a magnitude and a
 * tiny value at a small scale is not the same as a tiny value at a large one. Those sites keep the multiplication and
 * say why.
 */
export const EXACT_TOL = 1e-9;

/**
 * THE XML ROUND TRIP'S TOLERANCE: 1e-3.
 *
 * A call is written to XML by `callToXml` at FOUR decimals, so a value that was exactly something comes back within
 * 5e-5 of it, and a chain of segments accumulates that along its length. 1e-3 is 20x the single-coordinate rounding and
 * still far below the corpus's own spacing, which is why it is the number that answers "are these the same POSES when
 * one of them has been through a file".
 *
 * It is used by `startsFromFormation` (does this call start from these poses), by `halfSetReport` (is the second half
 * the first rotated), and by the reorder tool's `compareGeometry` - and by the POC's `formation-xml.ts` and the book's
 * `make-virtual.mjs`, which each carried their own copy with a comment saying it was "the same 1e-3" as
 * `startsFromFormation`'s. A comment that says "the same number as that other file" IS the defect: nothing keeps them
 * the same. Exported so the copies import instead.
 *
 * NOT `ARC_TOL`, although both are 1e-3: that one asks whether a curve's COORDINATES are a quarter arc - a question
 * about the asset files' four decimals, with its own measurement in `editor.ts`. Two rules, one value, and neither may
 * be substituted for the other.
 */
export const XML_ROUND_TRIP_TOL = 1e-3;
