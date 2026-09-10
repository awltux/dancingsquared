// FASR analysis: Formation, Arrangement, Sequence, Relationship.
//
//  - Formation:  the recognized setup name (passed in from recognition).
//  - Arrangement: gender/role distribution.
//  - Sequence:    in/out of sequence (the cyclic order of the 4 home couples
//                 around the set).
//  - Relationship: partner + corner for each dancer.

import type { Board, Fasr } from './types.js';
import { makeSquaredSet } from './board.js';
import { isKnownCouple } from './constants.js';

const angDiff = (a: number, b: number) => {
  let d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
};

export function analyzeFasr(board: Board, formationName: string | null): Fasr {
  const dancers = board.dancers;

  // ---- Arrangement ----
  const boys = dancers.filter((d) => d.gender === 'boy').length;
  const girls = dancers.filter((d) => d.gender === 'girl').length;
  const couples = new Set(dancers.filter((d) => isKnownCouple(d.couple)).map((d) => d.couple)).size;
  const arrangement = `${dancers.length} dancers (${boys} boys, ${girls} girls), ${couples} couple${couples === 1 ? '' : 's'}`;

  // ---- Relationship ----
  const center = { x: dancers.reduce((s, d) => s + d.x, 0) / dancers.length, y: dancers.reduce((s, d) => s + d.y, 0) / dancers.length };
  const angleOf = (d: { x: number; y: number }) => Math.atan2(d.y - center.y, d.x - center.x);

  const relationship: Fasr['relationship'] = {};
  for (const d of dancers) {
    // A partner is a dancer in the same REAL home couple; UNKNOWN_COUPLE is not
    // a couple, so a geometry-only board reports no partner relationship.
    const partner = isKnownCouple(d.couple)
      ? dancers.find((o) => o.couple === d.couple && o.id !== d.id) ?? null
      : null;
    // Corner: for a squared set, a boy's corner is the girl in the next couple
    // counterclockwise (~+45deg); a girl's corner is the boy ~-45deg. Pick the
    // opposite-gender non-partner whose angle is closest to that offset.
    const targetAngle = d.gender === 'boy' ? angleOf(d) + Math.PI / 4 : angleOf(d) - Math.PI / 4;
    let corner: typeof partner = null;
    let best = Infinity;
    for (const o of dancers) {
      if (o.gender === d.gender || o.id === d.id || (partner && o.id === partner.id)) continue;
      const diff = Math.abs(angDiff(targetAngle, angleOf(o)));
      if (diff < best) {
        best = diff;
        corner = o;
      }
    }
    relationship[d.id] = { partner: partner ? partner.id : null, corner: corner ? corner.id : null };
  }

  // ---- Sequence ----
  // Order the 4 home couples by angular position around the set. In sequence =
  // the couple numbers go 1,2,3,4 cyclically (counterclockwise); out of
  // sequence = the reverse.
  let sequence: Fasr['sequence'] = 'unknown';
  const coupleAngles = new Map<number, number>();
  for (const d of dancers) {
    if (d.gender === 'boy' && isKnownCouple(d.couple)) coupleAngles.set(d.couple, angleOf(d));
  }
  if (coupleAngles.size === 4) {
    const order = [...coupleAngles.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    // Check cyclic 1,2,3,4 (in) or 1,4,3,2 (out).
    const inSeq = order.some((_, i) => [order[i], order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4]].join() === '1,2,3,4');
    const outSeq = order.some((_, i) => [order[i], order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4]].join() === '1,4,3,2');
    sequence = inSeq ? 'in' : outSeq ? 'out' : 'unknown';
  }

  return { formation: formationName, arrangement, sequence, relationship };
}

/** A canonical key of a board's FASR (sequence + relationships). */
export function fasrKey(board: Board): string {
  const f = analyzeFasr(board, null);
  return `${f.sequence}|${JSON.stringify(f.relationship)}`;
}

/** The FASR key of the fresh home squared set. */
export function homeFasrKey(): string {
  return fasrKey(makeSquaredSet());
}
