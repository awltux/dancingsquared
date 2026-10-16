// What the server REFUSED, per player (DESIGN.md 11.1, A25).
//
// WHY A COUNTER AND NOT A LOG LINE. "Record what you refuse" (AGENTS.md §6) has two halves: the run row keeps what
// was measured against what was claimed, and this keeps the REFUSALS — the ones that never reached a run row,
// because a refused submission has no run to write. The operator's signal that someone is probing is the refusal
// RATE, and a rate needs a denominator the server owns rather than a stream of text nobody reads.
//
// IT IS BOUNDED IN TWO DIRECTIONS. The code tally keeps the few most recent distinct codes (a client inventing new
// ones must not grow the item), and the per-code counts saturate at a ceiling so the row cannot become a ledger of
// one player's afternoon. The TOTAL keeps counting past the ceiling, because "how many" is the number the alarm
// uses and losing it would be losing the signal the counter exists for.
//
// THE COUNT IS BEST EFFORT, AND THE REFUSAL IS NOT. If this write fails, the client still gets its refusal: failing
// a submission because its AUDIT failed would tell a player their run was rejected for a reason they cannot act on,
// and would hand a cheater a way to make refusals expensive. `recordRefusal` returns whether it landed, and only a
// probe reads that.
import { MAX_WRITE_ATTEMPTS, type Deps } from './ports.ts';
import { abuseKey } from './keys.ts';

/** How many distinct refusal codes one player's row remembers. The rest still count toward the total. */
export const MAX_TRACKED_CODES = 8;

/** The ceiling for one code's count. Past this the code stops growing; the total does not. */
export const MAX_COUNT_PER_CODE = 1000;

export interface Abuse {
  /** Every refusal attributed to this player, including the ones whose code is no longer tallied. */
  readonly total: number;
  /** The per-code tally, most recently refused last. */
  readonly codes: readonly { readonly code: string; readonly count: number }[];
  readonly lastAtMs: number | null;
}

/** A stored row as a refusal tally, or null when it is not one this build can read. An absent row is zeroes. */
export function asAbuse(stored: { readonly value: Readonly<Record<string, unknown>> } | null): Abuse | null {
  if (!stored) return { total: 0, codes: [], lastAtMs: null };
  const value = stored.value as { total?: unknown; codes?: unknown; lastAtMs?: unknown };
  if (typeof value.total !== 'number' || !Number.isFinite(value.total) || value.total < 0) return null;
  const raw = value.codes;
  if (raw !== undefined && !Array.isArray(raw)) return null;
  const codes: { code: string; count: number }[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = item as { code?: unknown; count?: unknown };
    if (typeof entry.code !== 'string' || typeof entry.count !== 'number' || !Number.isFinite(entry.count)) return null;
    codes.push({ code: entry.code, count: entry.count });
  }
  const last = value.lastAtMs;
  if (last !== undefined && last !== null && (typeof last !== 'number' || !Number.isFinite(last))) return null;
  return { total: value.total, codes, lastAtMs: typeof last === 'number' ? last : null };
}

/** The stored form, field by field. */
export function asAbuseItem(abuse: Abuse): Record<string, unknown> {
  return { total: abuse.total, codes: abuse.codes.map((entry) => ({ code: entry.code, count: entry.count })), lastAtMs: abuse.lastAtMs };
}

/**
 * Add one refusal to a tally.
 *
 * THE TAILY IS MOST-RECENT-LAST AND CAPPED, so the code that drops off is the one nobody has refused with for
 * longest — which is the one an operator is least likely to need next, and the total still counts it.
 */
export function countRefusal(current: Abuse, code: string, nowMs: number): Abuse {
  const existing = current.codes.find((entry) => entry.code === code);
  const others = current.codes.filter((entry) => entry.code !== code);
  const bumped = { code, count: Math.min((existing?.count ?? 0) + 1, MAX_COUNT_PER_CODE) };
  const codes = [...others, bumped].slice(-MAX_TRACKED_CODES);
  return { total: current.total + 1, codes, lastAtMs: nowMs };
}

/** A refusal's code, as the API writes it, or a word for a body that is not one. */
export function refusalCode(body: unknown): string {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' && code !== '' ? code : 'unknown';
}

/**
 * Record one refusal against a player. Returns whether the count landed; a false is not a failed request.
 *
 * A CAS LOOP, like every other read-modify-write here: two refusals arriving together both hold the row, and one of
 * them must lose and re-read rather than overwrite the other's count.
 */
export async function recordRefusal(deps: Deps, playerId: string, code: string): Promise<boolean> {
  const key = abuseKey(playerId);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    const current = asAbuse(stored);
    if (!current) return false;
    if (await deps.store.put(key, asAbuseItem(countRefusal(current, code, deps.clock.nowMs())), stored?.rev ?? null)) return true;
  }
  return false;
}
