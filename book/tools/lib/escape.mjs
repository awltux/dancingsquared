// THE BOOK'S TWO ESCAPE RULES, IN ONE PLACE — one per TARGET, and the difference is deliberate.
//
// There were four copies of these in this package before (`build-site.mjs` and `lib/markdown.mjs` each had the
// HTML one, `lib/app.mjs` had the XML one for the sitemap) plus a fifth in the browser script
// (`assets/player.js`). They had drifted: the sitemap escaped `'` as `&apos;` where nothing else did, so the
// same `'` in two generated files was two different strings.
//
// WHY TWO RULES AND NOT ONE. The targets genuinely differ:
//   * HTML (`escapeHtml`): `& < > " '`. Everything here is interpolated into `innerHTML` — attributes included,
//     and an attribute may be single-quoted — so the union is the only safe set. `'` becomes `&#39;` rather than
//     `&apos;`, which is not an HTML 4 named reference and `&#39;` always is.
//   * XML (`escapeXml`): `& < " `. The one XML this package writes is the sitemap, whose `<loc>` text is a URL
//     and whose attributes are double-quoted; XML requires only `&` and `<` in text, `>` is legal raw, and `'`
//     needs escaping only in a single-quoted attribute. THIS IS THE SAME SET `engine/src/convert.ts`'s `esc`
//     uses, and deliberately so — it is the same target.
// `poc/tools/escape-probe.mjs` pins both sets, imports this module, and checks that they DIFFER, so "unify the
// escapers" cannot be done by accident.
//
// THE ONE COPY THAT CANNOT IMPORT THIS IS `book/assets/player.js`: it is copied verbatim into the published
// site (`build-site.mjs`'s `cpSync`) and runs in a browser with no bundler, so it carries its own `esc`. The
// probe reads that file's source and requires the same five-character class, which is the only way a gate can
// see it.

/** Escape text interpolated into HTML: `& < > " '`. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Escape text interpolated into XML (the sitemap): `& < "`. Same set as the engine's `esc`. */
export function escapeXml(s) {
  return String(s).replace(/[&<"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;' })[c]);
}
