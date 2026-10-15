// THE APPLY FAULTS, as a rule rather than a reading: which (formation, call) applications end with two
// dancers on one spot.
//
// WHY THIS MODULE EXISTS. `engine/test/tools/walkthrough-survey.mjs` measures the walk-through defect
// and its header explains the split this module now owns: a pair whose closest dancers coincide is an
// ANIMATION fault when the END board is healthy, and an APPLY fault when the END board is already
// broken. That split is a RULE - two thresholds and a classification - so it lives here, once, and the
// survey and `engine/test/tools/apply-fault-gate.mjs` both call it rather than each spelling out the
// numbers.
//
// WHAT "COINCIDENT" MEANS. Two dancers on the same spot, which no dance path does. `worst < 0.1` is the
// survey's own definition and it is deliberately absolute rather than relative: the formations stand at
// 2.00, so a tenth of a unit is unambiguously a collision and not dancers passing close.
//
// THE END BOARD IS THE DISCRIMINATOR, and `1.9` is the formation spacing with a little slack. A pair
// whose end board is healthy but whose animation passes through itself is a routing fault an animator
// can fix; a pair whose END BOARD is already broken cannot be repaired by any interpolation, which is
// why the two are counted apart. MEASURED AT `8750274`: 51 coincident pairs, of which 14 are animation
// faults and 37 are apply faults. The 2026-10-14 reading was 64 / 14 / 50, and the fall is `a476a4f`'s
// rewrite of `lead_right.xml` (`Lead Right` alone 15 -> 2) - which is why the gate's ceiling had to come
// down with it, a ceiling being unable to report a fall.
//
// THE 37 ARE NOT A WRONG-SEPARATION FAULT, WHICH WAS MEASURED RATHER THAN ASSUMED - see `matchQuality`
// and `classifyApplyFault`. Every one is a PARALLEL (or whole-board) application whose admitted match is
// GEOMETRICALLY CONGRUENT with the setup it was applied through: all 37 at the tightest tolerance tested,
// 0.01 (23 of them a direct, unreflected, gender-exact match with mean error 0.0000), and NOT ONE is
// non-congruent even at 1.5. So "refuse a wrong separation" - the fix proposed for them - refuses ZERO. The
// refusals that would bite are the ones that withdraw a permission the engine grants on purpose (mirrored
// readings, gender-blind admission, the interactive tolerance); the call's own BODY is what puts the
// dancers together.
//
// MEASURED SPLIT AT `8750274`: 23 body / 9 genderMiss / 5 mirrored / 0 loose / 0 non-congruent. The split is
// REPORTED by `apply-fault-gate.mjs` rather than pinned, because a corpus fix moves it and must not turn a
// gate red; the one thing pinned is that no fault is `noncongruent`.
//
// AND THAT IS THE BARE TITLES ONLY. `SURVEY_CALLS` names `Lead Right`, not the authoring titles the corpus
// also publishes for it - which is where most of that family's faults now sit. The gate's header carries the
// measurement (86 apply faults over 47 boards for the seven-title family, 83 of them the variants).

import { matchFormations } from '../../dist/index.js';

/** Two dancers closer than this are on top of each other rather than passing. */
export const COINCIDENT_MAX = 0.1;
/** Below this the END board itself is broken, so no animation can be blamed for the collision. */
export const APPLY_END_LIMIT = 1.9;

/** The calls the survey sweeps, in its own order: the ones the corpora actually use. */
export const SURVEY_CALLS = [
  'Right and Left Thru', 'Pass Thru', 'Trade By', 'Square Thru 3', 'Square Thru 4', 'Star Thru',
  'Slide Thru', 'Wheel and Deal', 'Swing Thru', 'Box the Gnat', 'Dosado', 'Turn Thru', 'Lead Right',
  'Circulate', 'Ferris Wheel', 'Zoom', 'Veer Left', 'Veer Right', 'Bend the Line', 'Couples Circulate',
  'Flutterwheel', 'Sweep a Quarter', 'Fold', 'Rollaway', 'Promenade', 'Allemande Left', 'Right and Left Grand',
  'Touch a Quarter', 'Scoot Back', 'Walk and Dodge', 'Chain Down the Line', 'Courtesy Turn', 'Pass the Ocean',
];

/** The closest two dancers on a board. */
export function closestPair(board) {
  const ds = board.dancers;
  let m = Infinity;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  }
  return m;
}

/**
 * Sweep every named 8-dancer formation against `calls`, sample the animation, and classify.
 *
 * `samples` and `threshold` are the survey's own knobs (`24` and `1.0`); they are parameters so a caller
 * can afford a coarser run without redefining the classification.
 */
export function sweepApplyFaults(seq, formations, calls = SURVEY_CALLS, samples = 24, threshold = 1.0) {
  const hits = [];
  let applied = 0;
  let clean = 0;
  for (const formation of formations) {
    const start = seq.boardForFormation(formation);
    if (!start) continue;
    for (const call of calls) {
      const r = seq.applyToBoard(start, call);
      if (!r.legal) continue;
      applied++;
      // Which route did it take? A whole-board match animates the authored path; otherwise the
      // parallel path runs, which is where the RLT collapse lived.
      const whole = seq.findMatchingVariant(start, call, 1.5);
      const total = seq.sequenceBeats([call], start);
      if (total <= 0) continue;
      let worst = Infinity;
      let worstBeat = 0;
      for (let k = 0; k <= samples; k++) {
        const b = (total * k) / samples;
        const c = closestPair(seq.evaluateSequence([call], b, start).board);
        if (c < worst) { worst = c; worstBeat = b; }
      }
      // The end board's own spacing is the fair floor: some formations legitimately stand closer.
      const endGap = closestPair(r.board);
      const floor = Math.min(2.0, endGap);
      if (worst < floor - 0.4 || worst < threshold) {
        hits.push({ formation, call, worst, worstBeat, total, route: whole ? 'whole' : 'PARALLEL', endGap });
      } else {
        clean++;
      }
    }
  }
  hits.sort((a, b) => a.worst - b.worst);
  const coincident = hits.filter((h) => h.worst < COINCIDENT_MAX);
  return {
    applied,
    clean,
    hits,
    coincident,
    // TWO DIFFERENT DEFECTS SHARE THIS SYMPTOM. If the END board already has coincident dancers then the
    // APPLY is broken and the animation cannot be blamed; only the pairs with a healthy destination are
    // cases where the path is the fault.
    animFault: coincident.filter((h) => h.endGap >= APPLY_END_LIMIT),
    applyFault: coincident.filter((h) => h.endGap < APPLY_END_LIMIT),
  };
}

/** The best match of `group` against `variant`'s setup, at `maxError`. */
function admission(seq, group, variant, maxError, requireGender = false) {
  return matchFormations(group, variant.dancers.map((d) => seq.library.variantMatchable(d)), maxError, requireGender);
}

/**
 * How well the group the applicator applied the call to actually IS the variant's setup.
 *
 * THIS IS THE MEASUREMENT THAT REFUTED THE MATCHING EXPLANATION for the apply faults, so it is kept as a
 * rule rather than as a one-off diagnostic: if the admitted match is congruent, then "a wrong
 * separation" is not what put the dancers together and the body is what needs the work.
 *
 * `congruentAt` is the tightest of 0.01 / 0.05 / 0.2 / 0.5 / 1.5 at which the group is congruent, or
 * null when even the loose admission is not congruent; `congruentError` is the mean error of that
 * admission; `congruentReflect` and `congruentGenderExact` say how the TIGHTEST admission was reached,
 * which matters because a reflected or gender-blind admission is a permission the engine grants on
 * purpose, not a wrong match. `worstDistanceGap` is the largest per-pair distance disagreement under
 * the loose admission, so 0 means every separation in the group is the setup's own.
 */
export function matchQuality(seq, groupDancers, variant) {
  const group = groupDancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple }));
  const tgt = variant.dancers.map((d) => seq.library.variantMatchable(d));
  let congruentAt = null;
  let tight = null;
  for (const tol of [0.01, 0.05, 0.2, 0.5, 1.5]) {
    const m = admission(seq, group, variant, tol);
    if (m) { congruentAt = tol; tight = m; break; }
  }
  const loose = tight ?? admission(seq, group, variant, 1.5);
  let worstDistanceGap = 0;
  if (loose) {
    for (let i = 0; i < group.length; i++) {
      if (loose.mapping[i] < 0) continue;
      for (let j = i + 1; j < group.length; j++) {
        if (loose.mapping[j] < 0) continue;
        const a = Math.hypot(group[i].x - group[j].x, group[i].y - group[j].y);
        const b = Math.hypot(tgt[loose.mapping[i]].x - tgt[loose.mapping[j]].x, tgt[loose.mapping[i]].y - tgt[loose.mapping[j]].y);
        worstDistanceGap = Math.max(worstDistanceGap, Math.abs(a - b));
      }
    }
  }
  return {
    congruentAt,
    congruentError: tight ? +tight.error.toFixed(4) : null,
    congruentReflect: tight ? tight.reflect : false,
    congruentGenderExact: tight ? admission(seq, group, variant, congruentAt, true) !== null : false,
    worstDistanceGap: +worstDistanceGap.toFixed(4),
  };
}

/**
 * Classify ONE apply fault: is the group the applicator used really the variant's setup, and if so, HOW
 * was it admitted?
 *
 * PER GROUP, AND THE WORST GROUP DECIDES, because a parallel application tiles the board into several
 * groups and each is matched to the variant separately. A fault counts as a BODY fault only when EVERY
 * group it tiled is a tight, unreflected, gender-exact match of the setup; anything else is reported
 * under the KIND of permission that let it through.
 *
 * `kind` is measured, not argued, and the five values are the five answers a matcher could give:
 *   - `'body'`       - congruent at 0.05 or tighter, unreflected, genders in the authored slots. NO
 *                      matching rule can refuse this: the call's own BODY is what collides them.
 *   - `'mirrored'`   - congruent, but only as the set's MIRROR. Refusing mirrors would refuse it, and
 *                      would equally refuse the reflected readings `selection.mjs` requires to remain
 *                      available - so this is a permission, not a wrong match.
 *   - `'genderMiss'` - congruent, but only with the gender requirement relaxed. Same argument: the
 *                      engine is gender-blind on purpose wherever a variant does not declare
 *                      `gender-specific`.
 *   - `'loose'`      - congruent only at the loosest admission tested (1.5), i.e. separated correctly in
 *                      SHAPE but not tightly. A tightened interactive tolerance is the only separation
 *                      rule that can bite here.
 *   - `'noncongruent'` - not congruent even at the loose 1.5 admission. THIS is a wrong separation, and
 *                      the only kind a correct separation rule could refuse. MEASURED: none.
 */
export function classifyApplyFault(seq, hit) {
  const start = seq.boardForFormation(hit.formation);
  if (!start) return null;
  const r = seq.applyToBoard(start, hit.call);
  if (!r.legal) return null;

  const variant = r.parallel ? r.parallel.variant : seq.findMatchingVariant(start, hit.call, 1.5)?.variant;
  if (!variant) return null;
  const groups = r.parallel ? r.parallel.groups : [start.dancers];
  const qualities = groups.map((g) => matchQuality(seq, g, variant));
  // The WORST group: the loosest tolerance any of them needed, and the largest disagreement seen.
  const needed = qualities.map((q) => (q.congruentAt === null ? Infinity : q.congruentAt));
  const worstTol = needed.length ? Math.max(...needed) : Infinity;
  const congruentAt = worstTol === Infinity ? null : worstTol;
  const tight = qualities.filter((q) => q.congruentAt === congruentAt);
  const kind = congruentAt === null ? 'noncongruent'
    : congruentAt > 0.05 ? 'loose'
      : tight.some((q) => q.congruentReflect) ? 'mirrored'
        : tight.some((q) => !q.congruentGenderExact) ? 'genderMiss' : 'body';
  return {
    kind,
    groups: groups.length,
    congruentAt,
    congruentError: tight.length ? Math.max(...tight.map((q) => q.congruentError)) : null,
    worstDistanceGap: +Math.max(0, ...qualities.map((q) => q.worstDistanceGap)).toFixed(4),
  };
}
