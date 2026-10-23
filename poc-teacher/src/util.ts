// Small, pure text/number helpers shared across the app and view.

// THE HTML ESCAPER IS IMPORTED, NOT COPIED.
//
// This module carried its own five-character `esc` — a SECOND implementation of the rule `poc/src/dom.ts`
// states — with 30 call sites (`view.ts` 28 via the injected `d.esc`, `tour.ts` 2). Two implementations of one
// security rule is the defect: a reviewer reading "escaped" had to know WHICH one. There is one definition now,
// in the app that owns the invariant (`poc/src/dom.ts`, whose rule is the five-character union), and this
// re-export keeps the teacher's import path.
//
// THE CONSOLIDATION FOUND A HOLE IN THE TEACHER, which is the point of having one rule: `preview.ts` was the
// one `innerHTML` site that interpolated a caller-derived string (`sequenceInfo().name`, i.e. a call name from
// an imported programme) with no escaping at all — it did not even import this. It is escaped now, so the
// invariant holds by the rule rather than by the matcher happening to refuse a hostile name.
//
// The cross-package import is the same shape `poc-teacher/vite.config.ts` already uses for `../vite.corpus.ts`,
// and `poc/src/dom.ts` touches no DOM at import time (its own header says so).
export { esc } from '../../poc/src/dom.ts';

/** Trim and sanitize user-entered text: strip HTML tags, markup/control chars and
 * cap length, so nothing dangerous can be stored even if an `esc` is missed. */
export function sanitizeText(s: string, maxLen = 80): string {
  return s
    .replace(/<[^>]*>/g, '') // strip any HTML tags
    .replace(/[<>'`]/g, '') // drop markup / attribute-breaking chars
    .replace(/[\u0000-\u001f\u007f]/g, '') // strip control chars
    .trim()
    .slice(0, maxLen);
}

/** Clamp a numeric input to a sensible range. */
export function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}
