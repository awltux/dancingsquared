// PICK UP WHERE YOU LEFT OFF.
//
// During development the page reloads constantly, and every reload puts the app back on its defaults -
// so the same tab, level, call and setup get re-chosen every single time. The catalogue parse is a few
// seconds that nothing can avoid; re-navigating afterwards is the part that actually eats the day.
//
// WHAT IS REMEMBERED IS A SHORT, NAMED LIST, deliberately, and not every control on the page. A blanket
// "remember every input" would also restore the transient things - a half-typed coordinate, a selected
// run, a move index - and those are EDITS rather than navigation. Silently bringing back an edit nobody
// asked to keep is worse than losing it, so the list below is navigation and display only.
//
// EVERY RESTORE IS BEST-EFFORT, and that is the whole point rather than a nicety: the reason a reload is
// worth surviving is that the data underneath is being edited, so a remembered call or setup may simply
// not exist any more. A value the control cannot represent is DROPPED SILENTLY - the app opens on its
// own default instead - because a stale fragment of yesterday's session is not something to interrupt
// the caller about.
//
// ADDRESSED BY ELEMENT ID, because that is the name the rest of the app already uses for these controls
// (`el<HTMLSelectElement>('edCall')`), and an id is what survives a reorder of the DOM.
const KEY = 'dsq-remember-ui';

/**
 * THE ORDER IS A DEPENDENCY ORDER, not a preference. Each list is filled from the choice above it: the
 * call list is narrowed by the level, and a setup list belongs to a call. Restoring a call before its
 * level would set a value against the wrong list and then have the level's change handler rebuild the
 * options and discard it.
 */
export const REMEMBER_ORDER: readonly string[] = [
  // The browse view: level narrows the call list, the call fills the setup list.
  'levelSelect',
  'callSelect',
  'tamSelect',
  // The sequencer.
  'seqLevel',
  'seqCallSelect',
  'seqFormation',
  // The editor: its own level, then the call, then the setup. `edSetup` is filled by the call.
  'edLevel',
  'edCall',
  'edSetup',
  // The board itself - a display choice, but one that is re-made on every reload otherwise.
  'edView2d',
  'edHideDancers',
  // THE FLOOR GRID, which belongs to the board rather than to any panel: it is drawn on every board, so it
  // is restored with the other display choices and NOT with the editor's two, which are released whenever
  // another panel is on screen. `main.ts` is its one owner.
  'gridMode',
  // The tab LAST: switching tabs is what shows and hides the panels, and every list above belongs to a
  // panel that has to exist first.
  'modeSelect',
];

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // A STORE THAT HAS BEEN EDITED BY HAND, or written by an older build, must not throw on every page
    // load. Anything that is not a flat object of strings is treated as empty.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // Private mode, a locked-down profile, or corrupt JSON: the app works exactly as it did before.
    return {};
  }
}

function save(id: string, value: string): void {
  try {
    const all = read();
    if (all[id] === value) return;
    all[id] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused. Remembering is a convenience; nothing else depends on it.
  }
}

/**
 * WHAT CAN BE REMEMBERED: an input, a select, or a BUTTON.
 *
 * A BUTTON IS IN THE LIST because some of these controls are state-driven rather than value-driven - the
 * floor grid is one of two references with no "off", so it is a button whose label IS the state. Its
 * `value` carries that state and is kept in step by whichever setter owns it, which is why the generic
 * branch below works for it unchanged; the `change` event the restore dispatches is what its own handler
 * listens for.
 */
type Remembered = HTMLInputElement | HTMLSelectElement | HTMLButtonElement;

/** The value a control should come up with, or null when nothing usable was stored. */
function storedValue(el: Remembered): string | null {
  const saved = read()[el.id];
  if (saved === undefined) return null;
  if (el instanceof HTMLSelectElement) {
    // AN OPTION THAT IS GONE IS NOT A VALUE. The list is rebuilt from the catalogue, which is exactly
    // what changes between sessions, so the saved entry is checked against what this control can
    // actually hold before it is used.
    return [...el.options].some((o) => o.value === saved) ? saved : null;
  }
  return saved;
}

/** Start remembering a control: one listener per element, idempotent. */
export function remember(id: string): void {
  const el = document.getElementById(id) as Remembered | null;
  if (!el || el.dataset.remembered === 'yes') return;
  el.dataset.remembered = 'yes';
  el.addEventListener('change', () => {
    save(id, el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value);
  });
}

/**
 * Put a remembered value back, and TELL THE APP IT CHANGED.
 *
 * The `change` event is not a flourish: these controls do their work in their own change handlers -
 * setting `edCall.value` alone loads nothing - so a restore that skipped the event would leave every
 * dropdown naming one call while the board showed another.
 *
 * Returns whether anything was restored, so a caller can tell "resumed your session" from "nothing to do".
 */
export function restore(id: string): boolean {
  const el = document.getElementById(id) as Remembered | null;
  if (!el) return false;
  const saved = storedValue(el);
  if (saved === null) return false;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const want = saved === 'true';
    if (el.checked === want) return false;
    el.checked = want;
  } else {
    if (el.value === saved) return false;
    el.value = saved;
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Remember everything in {@link REMEMBER_ORDER} and restore it in that order, once, at startup.
 * Returns the ids that were actually resumed - the rest had nothing stored, or nothing that still exists.
 */
export function rememberLastSession(ids: readonly string[] = REMEMBER_ORDER): string[] {
  for (const id of ids) remember(id);
  const resumed: string[] = [];
  for (const id of ids) if (restore(id)) resumed.push(id);
  return resumed;
}
