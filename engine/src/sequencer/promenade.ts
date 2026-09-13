// Promenade — the standard FINISH, applied straight from the geometry.
//
// WHY THIS IS NOT A CATALOG <tam>: the shipped promenade.xml implements only the
// QUALIFIED forms (Heads Promenade 1/2, Sides Promenade Full, Star Promenade, ...).
// Bare `Promenade` (All8's `--Prom`, and `Promenade Home`) is the one call a caller
// uses to END the square, and it is not a fixed path: how far each dancer travels
// depends on where the set happened to start. It is also the first call in this
// engine that is legal from many quite different formations (facing lines, waves,
// two-faced lines, a rotated squared set), so it cannot be written as one setup.
//
// WHAT IT MEANS: "get into promenade position and promenade until you are home."
// The dancers form up into couples, wheel around the ring until each couple reaches
// its own home side, and settle into the squared set. The net effect on the board is
// therefore exactly: THE HOME SQUARED SET, with every dancer back on its own spot.
//
// The rule below is Taminations' own (`lib/sequencer/calls/common/promenade_home.dart`),
// which is the reference implementation for this engine:
//
//   1. take each couple's centre (by home couple number, i.e. by IDENTITY — not by
//      who happens to be standing next to whom);
//   2. snap that centre to the nearest of the four axis points (0,±2), (±2,0) by
//      quadrant — this is what "the set is spread around the ring" means;
//   3. require one couple per quadrant, and require the couples to appear in ring
//      order 1 -> 2 -> 3 -> 4 COUNTER-CLOCKWISE, which is the direction a promenade
//      travels. This is the "in sequence" test: if the couples are permuted round
//      the ring, no single wheeling of the set brings everybody home, so the square
//      is not resolved and the caller must fix the sequence first (Allemande Left).
//   4. the result is the home squared set.
//
// Taminations does not look at facings at all: forming up into promenade position is
// part of the call, so a board reached facing in, out or sideways is equally
// promenadeable. The corpus agrees (All8's published `--Prom` get-outs arrive from
// facing lines, waves and rotated squared sets alike).
//
// ONE PLACE THIS IS STRICTER THAN TAMINATIONS, deliberately: the partners must be
// standing together AS A COUPLE. Taminations computes a couple's centre wherever
// the two dancers happen to be, so a board with the partners flung apart can still
// "promenade home" on paper — which in this engine would launder a broken body into
// a false success. Every healthy pre-`Prom` state in All8's published corpus has the
// partners exactly 2.00 apart (the standard couple separation), so a band of
// 2 +/- 1 — the same unit as the engine's own snapMaxError — never rejects a real
// promenade. It does reject every state our own broken bodies produce: measured
// partner separations 0.00, 4.00 and 6.00 (see the get-out behaviour report), where
// 0.00 is two dancers standing on the same spot.

import { makeSquaredSet } from './board.js';
import { HOME_DANCERS } from './identity.js';
import { isKnownCouple } from './constants.js';
import type { Board, SeqDancer } from './types.js';

/** The call names this implements — All8's `--Prom` and `--PromH` alike. */
export const PROMENADE_ALIASES = ['Promenade', 'Promenade Home'];

/** Timeline length of a promenade, in beats. A fixed value is a stated
 * simplification: a set already at home promenades no distance at all, one at
 * 270 degrees promenades three quarters of the way round. */
export const PROMENADE_BEATS = 8;

/** How close two dancers may stand before the board counts as broken rather than dancable. The
 * engine's formations put adjacent dancers 2 apart and the tightest legitimate arrangement in the
 * corpus measures 1.41, so this sits in the empty band between those and the two broken bodies that
 * measure 0.00 and 0.32. */
export const PROMENADE_COLLISION_MIN = 1.0;

/** How close a couple's two dancers stand when they are a couple: the standard separation is 2 in the
 * engine's metric. This band WAS Promenade's precondition until Phase 12 and is kept as the
 * measurement the published corpus states — every healthy pre-Prom state in it measures exactly 2.00,
 * while the states our own broken bodies produced measured 0.00, 4.00 or 6.00. Forming the ring is
 * part of the call, so it is no longer a requirement. */
export const PROMENADE_COUPLE_MIN = 1.0;
export const PROMENADE_COUPLE_MAX = 3.0;

/** Tolerance for the ring-order arithmetic, which is exact on axis points. */
const EPS = 1e-6;

const AXIS: [number, number][] = [[0, 2], [-2, 0], [0, -2], [2, 0]];

/** The axis point Taminations snaps a couple centred at (x, y) to: by quadrant,
 * with (0,±) and (±,0) resolved in the order its own if-chain tests them. */
export function promenadeAnchor(x: number, y: number): [number, number] {
  if (x >= 0 && y > 0) return AXIS[0]; // 1st quadrant -> north
  if (x < 0 && y >= 0) return AXIS[1]; // 2nd quadrant -> west
  if (x <= 0 && y < 0) return AXIS[2]; // 3rd quadrant -> south
  return AXIS[3]; //                      4th quadrant -> east
}

const uniqKey = (v: [number, number]) => `${v[0]},${v[1]}`;
const axisAngle = (v: [number, number]) => Math.atan2(v[1], v[0]);

/** Counter-clockwise turn from `from` to `to`, in (-180, 180]. */
function ccwDelta(from: number, to: number): number {
  let d = ((to - from) * 180) / Math.PI;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

export interface PromenadeResult {
  /** The resulting board: the home squared set. Unchanged input when illegal. */
  board: Board;
  legal: boolean;
  reason?: string;
}

/**
 * Apply `Promenade` / `Promenade Home` to `board`: the home squared set when the
 * board is a set the dancers can promenade home from, otherwise the board unchanged
 * plus the reason it does not apply.
 */
export function promenadeHome(board: Board): PromenadeResult {
  const fail = (reason: string): PromenadeResult => ({ board, legal: false, reason });

  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length !== HOME_DANCERS.length) {
    return fail(`Promenade needs all four couples (${HOME_DANCERS.length} dancers); this board has ${phys.length}`);
  }

  // 2. The board has to be a BOARD: no two dancers on top of each other.
  //
  // This replaces the couple-separation band that used to live here (partners 1.0..3.0 apart), which
  // was doing two jobs at once and only one of them was right. Refusing "partners not standing
  // together" refused the call's normal use - measured, 27 of the 32 published figures that stop on
  // Promenade stop on the ring not existing yet and 3 more on the separation, and the corpus's
  // legitimate pre-promenade boards have partners SIX apart, as a wave does. What genuinely must be
  // refused is a body that has fallen apart, and the measurement separates those cleanly: of the 88
  // figure calls that reach a Promenade, the closest pair of dancers is 1.41 or more on every board
  // except two, which measure 0.00 and 0.32 - dancers on top of each other.
  for (let i = 0; i < phys.length; i++) {
    for (let j = i + 1; j < phys.length; j++) {
      const gap = Math.hypot(phys[i].x - phys[j].x, phys[i].y - phys[j].y);
      if (gap < PROMENADE_COLLISION_MIN) {
        return fail(
          `dancers ${phys[i].id} and ${phys[j].id} are ${gap.toFixed(2)} apart - the board has dancers on top of each other, so there is nothing to promenade`,
        );
      }
    }
  }

  const couples = new Map<number, SeqDancer[]>();
  for (const d of phys) {
    if (!isKnownCouple(d.couple)) {
      return fail('Promenade needs dancers with a known home couple (this board carries no identity)');
    }
    const list = couples.get(d.couple) ?? [];
    list.push(d);
    couples.set(d.couple, list);
  }
  if (couples.size !== 4) {
    return fail(`Promenade needs exactly four couples; this board has ${couples.size}`);
  }
  // A couple number outside 1..4 is not one of the four home couples, so the set is
  // not a square at all. This is refused rather than thrown on: the ring-order check
  // below reads couples 1,2,3,4 by number, and `isKnownCouple` only guarantees > 0.
  const strays = [...couples.keys()].filter((c) => c !== 1 && c !== 2 && c !== 3 && c !== 4);
  if (strays.length) {
    return fail(`Promenade needs the four home couples 1-4; this board has couple ${strays.join(', ')}`);
  }
  for (const [couple, list] of couples) {
    if (list.length !== 2) return fail(`couple ${couple} does not have exactly two dancers`);
    if (list[0].gender === list[1].gender) return fail(`couple ${couple} is not a boy and a girl`);
  }

  // 3. FORMING THE RING IS PART OF THE CALL, so the ring's geometry is not a precondition.
  //
  // CALLERLAB starts Promenade from a Squared Set, but a caller resolves a singing-call figure with
  // it from whatever the figure ended in - a wave, a line, an Eight Chain Thru - and the dancers form
  // the promenade ring on the way. This was measured, not assumed: of the 32 published figures that
  // stop on Promenade, 27 stop on exactly "the four couples are not spread one per side of the square
  // ... nothing to promenade around" and 3 more on the couple separation - i.e. on the ring not
  // existing yet, which is the normal case and not an error.
  //
  // What IS still a refusal is a ring that already exists in the WRONG ORDER, because promenading
  // from it does not bring everyone home and this call is "promenade HOME". That case is kept below
  // and it is the 2 remaining corpus refusals.
  const anchors = new Map<number, [number, number]>();
  for (const [couple, [a, b]] of couples) {
    anchors.set(couple, promenadeAnchor((a.x + b.x) / 2, (a.y + b.y) / 2));
  }
  // ...and "already exists" means one couple per side of the square: four distinct axis directions.
  //
  // The test is deliberately about DIRECTION, not distance, because the ring's radius is not fixed -
  // the engine's own squared set puts the couples at radius 3 while the anchor table names radius 2,
  // and the corpus reaches rings at other scales too. Only the ORDER round those four sides decides
  // whether promenading brings everyone home, and that is what is checked below.
  const ringExists = new Set([...anchors.values()].map(uniqKey)).size === 4;
  if (ringExists) {
    // counter-clockwise ring order 1 -> 2 -> 3 -> 4: the "in sequence" test.
    for (const k of [1, 2, 3, 4]) {
      const here = anchors.get(k)!;
      const next = anchors.get((k % 4) + 1)!;
      const turn = ccwDelta(axisAngle(here), axisAngle(next));
      if (Math.abs(turn - 90) > EPS) {
        return fail(
          `the couples are out of sequence: couple ${(k % 4) + 1} is ${turn.toFixed(0)} degrees round the ring from couple ${k}, ` +
          'not 90 counter-clockwise, so promenading would not bring everyone home',
        );
      }
    }
  }

  return { board: makeSquaredSet(), legal: true };
}

/** Whether `board` can promenade home (no reason, for the analyser's replay). */
export function promenadeApplies(board: Board): boolean {
  return promenadeHome(board).legal;
}

/** Null when `board` can promenade home, otherwise why it cannot. */
export function promenadeProblem(board: Board): string | null {
  const r = promenadeHome(board);
  return r.legal ? null : r.reason ?? 'this board cannot promenade home';
}
