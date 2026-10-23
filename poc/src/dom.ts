// The DOM helpers every panel needs, in ONE place.
//
// `el` and `esc` were each declared in four modules - `main`, `browser`, `sequencer-ui`, `editor-ui` (and `esc`
// again in `fsm-view`) - as byte-identical copies. Four copies of a one-line cast is not a maintenance burden in
// itself; what it costs is the INVARIANT: `esc` is the rule that authored data (a call's `from` label, a
// user-defined formation's name, a module name) cannot become markup in an `innerHTML`, and a rule that exists
// five times is a rule that holds in four places the first time one copy is adjusted. The copies had already
// drifted in form (one arrow and four declarations, with the comment on only two of them).
//
// NOTHING HERE TOUCHES THE DOM AT IMPORT TIME: `el` reads `document` when it is CALLED, so `fsm-view.ts` - which
// renders a document rather than living in one - can import `esc` without gaining a dependency on a live page.

/** The element with `id`, typed as the caller says it is. A missing id is a bug in the caller, not a runtime
 *  case to handle: `null as T` fails at the first property read rather than silently doing nothing. */
export function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/**
 * THE HTML ESCAPE RULE — `&`, `<`, `>`, `"` and `'` — and the ONE implementation of it in this tree.
 *
 * `>` is included where `textContent` would not need it and where a browser tolerates it raw, because the
 * cost is invisible and the alternative is reasoning per call site about whether the value lands in an
 * attribute. `'` is included for the same reason: every attribute this app writes is double-quoted TODAY,
 * and a single-quoted one is one edit away.
 *
 * NOT THE SAME RULE AS THE ENGINE'S `esc` (`engine/src/convert.ts`), deliberately: that one writes XML with
 * double-quoted attributes and escapes only `& < "`. Two targets, two rules — `poc/tools/escape-probe.mjs`
 * pins both character sets and the fact that they differ, so "unify them" cannot happen by accident.
 *
 * IT IS IMPORTED, NOT COPIED, BY THE TEACHER (`poc-teacher/src/util.ts` re-exports it) and the book's tools
 * carry the same rule in `book/tools/lib/escape.mjs`; `book/assets/player.js` is the one copy that has to
 * stay separate because it ships to the browser.
 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}
