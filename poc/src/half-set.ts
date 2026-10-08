// THE CORPUS'S HALF-SET RULE, in one pure module so that it can be MEASURED.
//
// A named formation is authored as HALF the set it represents: "2 dancers in xml is displayed as 4
// dancers, 4 dancers in xml is displayed as 8 dancers" (`engine/src/sequencer/library.ts`, `toWholeSet`).
// So the played shape is the written dancers plus the same dancers rotated 180 degrees about the origin,
// which keeps their genders - unless the written shape ALREADY contains its own antipodes, in which case
// it is the whole set however few it lists.
//
// WHY IT IS ITS OWN MODULE RATHER THAN A HELPER INSIDE `tam-xml.ts`. The exporter's "is this name the shape
// the call starts from" comparison needs this rule, and `tam-xml.ts` cannot be imported by anything but the
// bundler: it pulls `./assets/formations.xml?raw`, a Vite query, and node refuses it. A rule that cannot be
// imported can only be MIRRORED by a probe, which is one edit away from a probe that measures a copy of the
// rule - so the rule lives here, with no imports but a type, and `poc/tools/formation-shape-probe.mjs`
// imports it. `grid-magnet.ts` and `board-transform.ts` are the same trade made the same way.
//
// MEASURED over `formations.xml` (`poc/tools/formation-size-probe.mjs`): **no entry of any size is already
// whole** - all 274 complete by rotation - so the antipode check below is inert on today's data and is here
// because the rule is the engine's, not because a case needs it.

import type { FormDancer } from 'dancing-squared-engine';

/** The written dancers plus their 180-degree rotation, or the input unchanged when it is already whole. */
export function completeHalfSet(poses: FormDancer[]): FormDancer[] {
  const mirror = poses.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender }));
  const merged = poses.concat(mirror);
  // COINCIDENT POINTS MEAN IT WAS ALREADY WHOLE, and doubling would stack two dancers on one spot.
  const stacked = merged.some((a, i) => merged.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < 0.01));
  return stacked ? poses : merged;
}
