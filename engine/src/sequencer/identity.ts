// Home-square identity stamping. Identity (which couple / which dancer id) is
// fixed from the opening squared set at the start of the dance and never
// changes, regardless of where a call moves the dancers.

import { DEG } from '../core.js';
import { matchFormations, type Matchable } from './match.js';
import type { DancerSpec } from '../types.js';

export const normAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export interface HomeDancer {
  id: number;
  couple: number;
  gender: 'boy' | 'girl';
  x: number;
  y: number;
  heading: number; // radians
}

/** The home squared-set dancers (dancer id -> its home pose). */
export const HOME_DANCERS: HomeDancer[] = [
  { id: 1, couple: 3, gender: 'boy', x: 1, y: 3, heading: 270 * DEG }, // couple 3 north, facing south (center)
  { id: 2, couple: 3, gender: 'girl', x: -1, y: 3, heading: 270 * DEG },
  { id: 3, couple: 2, gender: 'boy', x: 3, y: -1, heading: 180 * DEG }, // couple 2 east, facing west (center)
  { id: 4, couple: 2, gender: 'girl', x: 3, y: 1, heading: 180 * DEG },
  { id: 5, couple: 1, gender: 'boy', x: -1, y: -3, heading: 90 * DEG }, // couple 1 south (nearest viewer), facing north
  { id: 6, couple: 1, gender: 'girl', x: 1, y: -3, heading: 90 * DEG },
  { id: 7, couple: 4, gender: 'boy', x: -3, y: 1, heading: 0 }, // couple 4 west, facing east (center)
  { id: 8, couple: 4, gender: 'girl', x: -3, y: -1, heading: 0 },
];

const HOME_MATCHABLES: Matchable[] = HOME_DANCERS.map((d) => ({
  x: d.x,
  y: d.y,
  heading: d.heading,
}));

/**
 * Stamp each dancer of a full-set call with its home-square identity (id +
 * couple) by matching the call's start formation to the home squared set up to
 * rotation/reflection. Callers then colour by `couple` (a stable property of
 * the dancer) instead of re-deriving identity from position or array index each
 * call.
 *
 * Mirrored (half-set) dancers use their full-set position for matching. When the
 * call's setup isn't an 8-dancer home square (e.g. a smaller group or a phantom
 * setup), no identity can be assigned and the dancers are returned un-stamped.
 */
export function assignHomeIdentity(dancers: DancerSpec[]): DancerSpec[] {
  if (dancers.length !== HOME_MATCHABLES.length) return dancers;
  const full = dancers.map((d): Matchable => {
    if (d.mirror) return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI) };
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG };
  });
  const m = matchFormations(full, HOME_MATCHABLES);
  if (!m) return dancers;
  return dancers.map((d, i) => {
    const h = HOME_DANCERS[m.mapping[i]];
    return { ...d, id: h.id, couple: h.couple };
  });
}
