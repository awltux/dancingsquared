// Reading what a request's query string carries, in one place.
//
// WHY THIS IS NOT IN EACH HANDLER. `level` appears in three endpoints, and a second parser is a second answer to
// "is 007 a level" — the same argument as one store and one Progress row parser. `dayParam` is here for the
// mirror reason: a DATE has to be a real day (`isUtcDay` round-trips it, so `2026-02-30` is refused rather than
// hashed into a challenge nobody can find again), and that rule is the Daily's, imported rather than restated.
import { isUtcDay } from 'dancing-squared-game';

/**
 * A level number from a query string, or null when it is not one.
 *
 * STRICTER THAN `Number()`, deliberately: `Number('')` is 0, `Number(' 1 ')` is 1 and `Number('0x10')` is 16, so
 * a lax parse would accept three shapes no client sends and hide a bug in one that does. Digits only, and at
 * least one of them.
 */
export function levelParam(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
}

/** A UTC day from a query string, or null when it is not a real day. */
export function dayParam(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  return isUtcDay(raw) ? raw : null;
}
