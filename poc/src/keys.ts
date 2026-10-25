// THE KEYBOARD: one table of shortcuts, one listener, and the policy in ONE place.
//
// WHY A SYSTEM RATHER THAN A LISTENER PER SHORTCUT. Every global `keydown` handler re-implements the same
// four decisions - is a modifier held, is the caller typing into a field, is this an auto-repeat, does this
// panel own the key right now - and each one gets them slightly differently. That is not hypothetical here:
// the Ctrl+Z undo and the W grid toggle were written a day apart and disagreed about `e.target` versus
// `document.activeElement`, and neither had a way to say "only while my panel is on screen". One table means
// a new shortcut is a LINE, and the four decisions are made once, for all of them.
//
// WHY NOT A LIBRARY (mousetrap, hotkeys-js, tinykeys). The policy above is the whole of what this app needs,
// and it is the part a library cannot decide for you: which elements count as "typing", what an unspecified
// modifier means, whether a held key repeats. What a library WOULD add is a dependency to a package whose
// only runtime dependency is `three`, and a matcher that cannot be driven without a DOM - while this module
// is pure enough that `poc/tools/keys-probe.mjs` installs it on a FAKE target and dispatches synthetic
// events through it. If the table ever outgrows this, the shape to keep is `matchKey`/`dispatchKey`.
//
// THE RULE THAT MAKES A BARE KEY SAFE: A MODIFIER THAT IS NOT MENTIONED IS A MODIFIER THAT MUST NOT BE
// HELD. So `{ key: 'w' }` fires on `w` and never on Cmd+W, and `{ key: 'z', mod: true }` fires on Ctrl+Z or
// Cmd+Z and never on a bare `z`. Getting this wrong is how a shortcut steals a browser chord or a typed
// letter, and it is not expressible as an afterthought.
//
// CTRL AND CMD ARE ONE FLAG, `mod`, because they are one meaning - "the key that means undo on this
// platform" - which is exactly how the two hand-written handlers treated them (`e.ctrlKey || e.metaKey`).
// A chord that wants Ctrl and specifically NOT Cmd has no use in this app, and pretending to support one
// would be a second thing to get wrong.

/** The part of a KeyboardEvent this module reads. A real one satisfies it; a probe builds a plain object. */
interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  /** The focused element, which a keydown targets. Read only to tell a field from the page. */
  target: unknown;
  preventDefault(): void;
}

/** One shortcut. */
export interface KeyBinding {
  /** A stable name, for a duplicate check and for a future help list. Never shown to the caller. */
  id: string;
  /**
   * The key: a single character (`'g'`, `'z'`, `' '`) or a named key (`'Escape'`, `'ArrowLeft'`).
   * Matched CASE-INSENSITIVELY, so `'g'` fires for both `g` and `G` with no Shift required.
   */
  key: string;
  /** The platform command key: Ctrl on Windows and Linux, Cmd on macOS. */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  /**
   * WHETHER THIS SHORTCUT OWNS THE KEY RIGHT NOW, for a panel-scoped binding. The undo binding is only live
   * while the editor is the panel on screen; without this the table would need a second listener per panel,
   * which is the thing it exists to avoid.
   */
  when?: () => boolean;
  /**
   * Fire while the caller is typing into a field. FALSE BY DEFAULT, and that default is the point: a text or
   * number input has its own undo, and a bare letter that acts on the board while somebody types `g` into
   * the call filter is worse than no shortcut at all. A binding that wants the keystroke anyway - an Escape
   * that closes a dialog - says so.
   */
  whileTyping?: boolean;
  /** Fire on auto-repeat. FALSE BY DEFAULT, so holding a key down toggles once rather than flickering. */
  repeat?: boolean;
  run: () => void;
}

/** The listener surface this module needs. `document` satisfies it; a probe passes a stub. */
type KeyTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/** Letters and named keys are compared the same way, so one lowercase pass covers both. */
export function normaliseKey(key: string): string {
  return key.toLowerCase();
}

/**
 * The `<input>` types the caller TYPES into - the allowlist behind `isTypingTarget` below.
 *
 * AN ALLOWLIST RATHER THAN A LIST OF THE EXCEPTIONS, because the rule is "the caller is typing", and the
 * exceptions are the interesting set: `range`, `checkbox`, `radio`, `button`, `file` and `color` have no text
 * to type into. `number`, `date` and `time` are ON the list: their arrow keys edit the value, so a binding
 * must not steal them.
 */
const TEXT_ENTRY_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
]);

/**
 * Whether a focused element is one the caller is TYPING into - the check every global handler needs and each
 * one writes differently. `select` counts: a bare letter jumps between its options, so stealing it there is
 * exactly as bad as stealing it from a text box.
 *
 * A SCRUB BAR IS NOT A FIELD. `edScrub`, `seqScrub` and `#scrub` are `<input type="range">`, and reading only
 * `tagName` made every one of them a field: a click on the slider killed W, A/F, S, E, G/B and Ctrl+Z for as
 * long as it held focus, which is the defect this type check fixes (`keys-probe.mjs` fires a bare `g` at a
 * range and at a text input and requires the two to differ). Checkboxes had the same bug for the same
 * reason. An input whose `type` is absent reads back as `'text'` in the DOM, and a probe object that omits it
 * is a text field too, so the fallback is that same string rather than a special case.
 */
export function isTypingTarget(el: unknown): boolean {
  const t = el as { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined;
  const tag = t?.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || t?.isContentEditable === true) return true;
  if (tag !== 'input') return false;
  return TEXT_ENTRY_TYPES.has((t?.type ?? 'text').toLowerCase());
}

/**
 * Whether THIS EVENT is THIS BINDING. The whole policy, in one predicate, so a probe can ask about a
 * keystroke without a DOM - and so every shortcut in the app answers the four questions the same way.
 */
export function matchKey(ev: KeyEventLike, binding: KeyBinding): boolean {
  if (normaliseKey(ev.key) !== normaliseKey(binding.key)) return false;
  // MODIFIERS MUST MATCH EXACTLY, in both directions: an unmentioned modifier must not be held (see the
  // module note), and a mentioned one must be.
  if ((ev.ctrlKey || ev.metaKey) !== !!binding.mod) return false;
  if (ev.altKey !== !!binding.alt) return false;
  if (ev.shiftKey !== !!binding.shift) return false;
  // THE ENVIRONMENT CHECKS COME LAST, because they are the expensive ones and because a binding that is not
  // even about this key should not have its `when` evaluated.
  if (!binding.whileTyping && isTypingTarget(ev.target)) return false;
  if (!binding.repeat && ev.repeat) return false;
  if (binding.when && !binding.when()) return false;
  return true;
}

/**
 * Run the FIRST binding that matches, and say which it was - or null.
 *
 * FIRST MATCH WINS, and the default is called off exactly when something ran: a key that no shortcut owns
 * keeps whatever the browser does with it. Order is therefore part of the table's meaning, which is why the
 * table lives in one place where that can be read.
 */
export function dispatchKey(ev: KeyEventLike, bindings: readonly KeyBinding[]): KeyBinding | null {
  for (const b of bindings) {
    if (!matchKey(ev, b)) continue;
    ev.preventDefault();
    b.run();
    return b;
  }
  return null;
}

/**
 * Put ONE `keydown` listener on `target` for a table of bindings, and return the way to take it off.
 *
 * ONE LISTENER FOR THE WHOLE TABLE is the point of the system: the table is read on every keystroke, so a
 * binding added later is live without touching the listener, and a panel-scoped binding says so with `when`
 * rather than by owning a listener of its own.
 *
 * The table is validated HERE rather than trusted: two bindings with one `id` are a copy-paste that silently
 * shadows one of them, and an empty `key` is a binding that can never fire.
 */
export function installKeys(bindings: readonly KeyBinding[], target: KeyTarget = document): () => void {
  const seen = new Set<string>();
  for (const b of bindings) {
    if (!b.id) throw new Error('keyboard: a binding needs an id');
    if (seen.has(b.id)) throw new Error(`keyboard: two bindings share the id "${b.id}", so one would shadow the other`);
    seen.add(b.id);
    if (!b.key) throw new Error(`keyboard: binding "${b.id}" has no key`);
  }
  const listener = (e: Event) => {
    dispatchKey(e as unknown as KeyEventLike, bindings);
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
