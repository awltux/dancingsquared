// Small, pure text/number helpers shared across the app and view.

/** HTML-escape a string for safe interpolation into markup. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
