// Teachers Session Tracker — mobile-first PoC UI (PRD item 15).
// A set of inter-related, hash-routed pages (Home → Sessions → Session detail,
// Students, Tips) with a large bottom navigation, built to be easy to read and
// tap on a phone for an older user.

import movesXml from '../../poc/src/assets/moves.xml?raw';
import formationsXml from '../../poc/src/assets/formations.xml?raw';

import { buildCatalog, makeSequencer } from './catalog';
import type { CatalogCall } from './catalog';
import {
  availableTitles,
  fitsAround,
  generateTips,
  insertInto,
  priorityWeights,
  pullForward,
  removeAt,
  replaceAt,
  studentKnowledge,
  teachCall,
  unteachCall,
  teachAll,
  addStudent,
  removeStudent,
  renameStudent,
  setProblem,
  rollMissedCallsForward,
  rollPrioritisedForward,
  archivedNote,
  completeSession,
} from './teacher';
import type { CallRef, ClassInstance, SessionPlan, Tip, TipConfig } from './teacher';
import { DEFAULT_TIP_CONFIG } from './teacher';
import { buildClassFromProgramme, ssdProgramme, parseProgramme, serializeProgramme } from './programme';
import type { Programme } from './programme';

// ---------------------------------------------------------------- catalog

const msFiles = import.meta.glob<string>('../../poc/src/assets/ms/*.xml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const catalog: CatalogCall[] = buildCatalog(msFiles);
const seq = makeSequencer(movesXml, formationsXml, catalog);

const findCall = (title: string): CatalogCall | undefined => catalog.find((c) => c.title === title);
const familyOf = (title: string): string => findCall(title)?.family ?? 'Other';
const toRef = (title: string): CallRef => {
  const c = findCall(title)!;
  return { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label };
};

// ------------------------------------------------------- creative module names

// Creative name generator for saved modules. The generated name is influenced by
// the calls actually in the tip (its dominant call family becomes the theme), so
// it feels relevant, while a seeded word bank keeps it varied and playful. The
// same tip always suggests the same name; the user can edit it in the prompt.
const MOD_FLAIR = [
  'Grand', 'Golden', 'Do-Sa', 'Right and Left', 'Swinging', 'Spinning', 'Twirling',
  'Smooth', 'Snappy', 'Weaving', 'Sliding', 'Rolling', 'Sassy', 'Jolly', 'Fancy',
  'Rambling',
];
const MOD_NOUN = [
  'Allemande', 'Promenade', 'Dosado', 'Swing', 'Star', 'Chain', 'Corner', 'Wheel',
  'Recycle', 'Weave', 'Circulate', 'Trade', 'Split', 'Bend', 'Slide', 'Roll', 'Tag',
  'Honor', 'Gypsy', 'Sashay',
];
// name = [flair] [theme] [noun] combinations, chosen per-tip for variety.
const MOD_STYLES: ((theme: string, flair: string, noun: string) => string)[] = [
  (t: string, f: string) => `${f} ${t}`,
  (t: string, _f: string, n: string) => `${t} ${n}`,
  (_t: string, f: string, n: string) => `The ${f} ${n}`,
  (t: string, f: string, n: string) => `${f} ${t} ${n}`,
  (t: string, f: string) => `${t} by ${f}`,
];

/** A short theme word drawn from a tip's most common call family. */
function tipTheme(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const fam = familyOf(t);
    if (fam && fam !== 'Other') counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let theme = '';
  let best = 0;
  for (const [f, n] of counts) if (n > best) { best = n; theme = f; }
  const core = theme.replace(/\s*Family$/i, '').trim(); // "Circle Family" -> "Circle"
  if (core) return core;
  // fall back to the first call (minus common fragments) for a theme word.
  const first = titles[0] ?? '';
  return first.replace(/^(Heads|Sides|All 4 Couples)\s*/i, '').trim() || 'Square';
}

/** Suggest a creative module name from the tip's calls (stable per tip).
 * The name is built from a pool of square-dance figure words that actually
 * appear in the tip's calls plus the dominant call family (deduplicated), so it
 * reflects the calls rather than being purely random. */
function suggestModuleName(titles: string[]): string {
  const theme = tipTheme(titles);
  // Pool of distinct words drawn from the tip's calls + its family. Drop a short
  // word when a longer pool entry starts with it (e.g. "Slide" vs "Slide Thru",
  // "Scoot" vs "Scoot Back") so names aren't redundant.
  const rawPool = [...new Set([theme, ...extractFigureWords(titles)])];
  const pool = rawPool.filter((w) => !rawPool.some((o) => o !== w && o.startsWith(w + ' ')));
  let seed = 0;
  for (const ch of titles.join('>')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const styleIdx = seed % 4;
  if (pool.length >= 2) {
    // Two distinct parts, drawn from the tip's actual words/family.
    const a = pool[seed % pool.length];
    const b = pool[(seed + 1) % pool.length];
    switch (styleIdx) {
      case 0: return `${a} ${b}`;
      case 1: return `The ${a} ${b}`;
      case 2: return `${a} & ${b}`;
      default: return `${b} ${a}`;
    }
  }
  // Only a single distinctive word — pair it with a square-dance flair/noun.
  const single = pool[0];
  const flair = MOD_FLAIR[seed % MOD_FLAIR.length];
  const noun = MOD_NOUN[(seed >>> 3) % MOD_NOUN.length];
  const style = MOD_STYLES[styleIdx];
  return style(single, flair, noun);
}

// Distinct square-dance figure words worth surfacing in a module name, e.g. the
// "Grand" of "Right and Left Grand" or the "Allemande" of "Allemande Left".
const FIGURE_WORDS = [
  'Allemande', 'Circle', 'Grand', 'Swing', 'Star', 'Chain', 'Promenade', 'Wheel',
  'Weave', 'Dosado', 'Corner', 'Turn', 'Pass', 'Thru', 'Bend', 'Split', 'Trade',
  'Circulate', 'Fold', 'Tag', 'Recycle', 'Forward', 'Back', 'Sashay', 'Sweep',
  'Scoot', 'Cast', 'Hinge', 'Extend', 'Run', 'Roll', 'Slide',
];

/** Square-dance figure words found in the tip's call titles, in order of first
 * appearance, deduplicated. */
function extractFigureWords(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    for (const word of t.split(/[\s/,]+/)) {
      if (!word) continue;
      const match = FIGURE_WORDS.find((w) => w.toLowerCase() === word.toLowerCase());
      if (match && !seen.has(match)) {
        seen.add(match);
        out.push(match);
      }
    }
  }
  return out;
}

/** Whether two call sequences are identical (same calls, same order). */
function sameSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Null-safe resolver for building courses from imported programmes (drops calls
// that aren't in the loaded catalog instead of throwing).
const toRefOrNull = (title: string): CallRef | null => {
  const c = findCall(title);
  return c ? { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label } : null;
};

// ---------------------------------------------------------------- seed

// No example classes are pre-seeded; new installs start with an empty class list.
function seedClasses(): ClassInstance[] {
  return [];
}

// ---------------------------------------------------------------- state + persistence

const STORE_KEY = 'dsTeacherData';
const PROG_KEY = 'dsTeacherProgrammes';
const CFG_KEY = 'dsTeacherTipConfig';
let classes: ClassInstance[] = load();

// Global tip-generation configuration (repeat + priority probabilities).
let tipConfigGlobal: TipConfig = loadTipConfig();
function loadTipConfig(): TipConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return { ...DEFAULT_TIP_CONFIG, ...(JSON.parse(raw) as TipConfig) };
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_TIP_CONFIG };
}
function saveTipConfig(): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(tipConfigGlobal));
  } catch {
    /* ignore */
  }
}

// Per-class, per-call probability overrides (title -> 0..1). A call with no
// override uses the global default (currentProb for this-session calls, prevProb
// otherwise).
const CALLPROB_KEY = 'dsTeacherCallProbs';
let callProbs: Record<string, Record<string, number>> = loadCallProbs();
function loadCallProbs(): Record<string, Record<string, number>> {
  try {
    const raw = localStorage.getItem(CALLPROB_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Record<string, number>>;
  } catch {
    /* fall through */
  }
  return {};
}
function saveCallProbs(): void {
  try {
    localStorage.setItem(CALLPROB_KEY, JSON.stringify(callProbs));
  } catch {
    /* ignore */
  }
}
function effectiveCallProb(id: string, title: string, currentSet: Set<string>, prioritised?: Set<string>): number {
  const ov = callProbs[id]?.[title];
  if (ov != null) return ov;
  const base = currentSet.has(title) ? tipConfigGlobal.currentProb : tipConfigGlobal.prevProb;
  // Prioritised (starred) call-setups default to a higher probability, capped at 100%.
  if (prioritised && prioritised.has(title)) return Math.min(1, base + 0.25);
  return base;
}

// Programmes: the default course structures (built-in + imported).
let programmes: Programme[] = loadProgrammes();
let notice = '';
let noticeWarn = false;

// Persisted open/closed state of collapsible <details> sections, keyed by a
// stable id. A re-render (e.g. toggling a student's attendance) re-creates the
// DOM, so without this a section the user collapsed would snap back open.
const detailsState = new Map<string, boolean>();
/** The `open` attribute for a <details> whose state is persisted by `key`,
 * defaulting to `def` the first time. */
function detailsOpenAttr(key: string, def: boolean): string {
  const v = detailsState.get(key);
  return (v === undefined ? def : v) ? ' open' : '';
}

/** Set the transient action notice; pass `warn: true` for a prominent warning
 * (e.g. "already saved" feedback) rendered in the warning colours. */
function setNotice(text: string, warn = false): void {
  notice = text;
  noticeWarn = warn;
}

function loadProgrammes(): Programme[] {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Programme[];
      if (Array.isArray(p) && p.length) return p;
    }
  } catch {
    /* fall through to defaults */
  }
  return [ssdProgramme()];
}
function saveProgrammes(): void {
  try {
    localStorage.setItem(PROG_KEY, JSON.stringify(programmes));
  } catch {
    /* storage may be unavailable */
  }
}
const tipsByClass: Record<string, Tip[]> = {};
const tipsState: Record<string, { selectedTip: number; selectedIdx: number }> = {};

// A saved practice tip/module, with metadata on when and where it was created.
interface SavedModule {
  name: string;
  titles: string[];
  createdAt: number;
  createdClass: string;
  createdSession: string;
  expanded?: boolean;
}
const MODULES_KEY = 'dsTeacherSavedModules';
let savedModules: Record<string, SavedModule[]> = loadSavedModules();
function loadSavedModules(): Record<string, SavedModule[]> {
  try {
    const raw = localStorage.getItem(MODULES_KEY);
    if (raw) return JSON.parse(raw) as Record<string, SavedModule[]>;
  } catch {
    /* fall through */
  }
  return {};
}
function saveSavedModules(): void {
  try {
    localStorage.setItem(MODULES_KEY, JSON.stringify(savedModules));
  } catch {
    /* ignore */
  }
}

/** Serialize a class's saved modules for export/sharing. */
function serializeModules(modules: SavedModule[]): string {
  return JSON.stringify(
    {
      app: 'dancing-squared-teacher',
      kind: 'modules',
      version: 1,
      modules: modules.map((m) => ({ name: m.name, titles: m.titles })),
    },
    null,
    2,
  );
}

/** Parse exported module JSON; returns the valid modules or null if it isn't a
 * module export. Invalid entries are skipped. */
function parseModules(text: string): SavedModule[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const arr =
    data && typeof data === 'object' && Array.isArray((data as { modules?: unknown }).modules)
      ? (data as { modules: unknown[] }).modules
      : Array.isArray(data)
        ? data
        : null;
  if (!arr) return null;
  const out: SavedModule[] = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    const o = m as { name?: unknown; titles?: unknown };
    if (typeof o.name !== 'string' || !Array.isArray(o.titles)) continue;
    const titles = o.titles.filter((t): t is string => typeof t === 'string');
    if (!titles.length) continue;
    out.push({ name: sanitizeText(o.name, 60), titles, createdAt: Date.now(), createdClass: '', createdSession: '' });
  }
  return out.length ? out : null;
}

/** Add parsed modules to a class's saved list, skipping duplicates. */
function importModulesText(id: string, text: string): void {
  const parsed = parseModules(text);
  if (!parsed) {
    setNotice('That is not valid module JSON. Export modules first and paste their text.');
    render();
    return;
  }
  const list = (savedModules[id] ??= []);
  let added = 0;
  for (const m of parsed) {
    if (list.some((x) => sameSequence(x.titles, m.titles))) continue;
    list.push(m);
    added++;
  }
  saveSavedModules();
  setNotice(
    added
      ? `Imported ${added} module(s).${parsed.length - added ? ` ${parsed.length - added} skipped as duplicates.` : ''}`
      : 'No new modules imported — they were all duplicates.',
  );
  render();
}

function load(): ClassInstance[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ClassInstance[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  return seedClasses();
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(classes));
  } catch {
    /* storage may be unavailable */
  }
}

const cls = (id: string): ClassInstance | undefined => classes.find((c) => c.id === id);
const session = (id: string, i: number): SessionPlan | undefined => cls(id)?.sessions[i];

// ---------------------------------------------------------------- routing

const root = document.getElementById('app') as HTMLElement;
let lastSessionKey = ''; // (classId|sessionIdx) of the last rendered session page

// Register a service worker so the app can be reloaded even when the network is
// down (the app shell is cached after the first online load; data already lives
// in localStorage).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline-first caching is optional */
    });
  });
}

// Reload-safe update check: the build injects the git commit into index.html.
// If the deployed page advertises a different commit than the one we're running,
// a newer version is available — reload to pick it up. Only runs when online.
const APP_VERSION = __GIT_COMMIT__;
async function checkForUpdate(): Promise<void> {
  try {
    const html = await fetch('./index.html', { cache: 'no-store' }).then((r) => r.text());
    const m = html.match(/name="app-version" content="([^"]+)"/);
    if (m && m[1] && m[1] !== APP_VERSION) location.reload();
  } catch {
    /* offline — keep the current version */
  }
}
setInterval(checkForUpdate, 60000);
window.addEventListener('focus', checkForUpdate);

function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
  else render();
}
window.addEventListener('hashchange', render);

interface Route {
  page: 'home' | 'class' | 'session' | 'students' | 'tips' | 'student' | 'new' | 'programmes' | 'tipssettings';
  id?: string;
  i?: number;
  sid?: string;
  fromSession?: number;
}

function parseRoute(): Route {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'new') return { page: 'new' };
  if (parts[0] === 'programmes') return { page: 'programmes' };
  if (parts[0] === 'tips' && parts[1] === 'settings') return { page: 'tipssettings' };
  if (parts[0] !== 'class' || parts.length < 2) return { page: 'home' };
  const id = parts[1];
  if (parts[2] === 'session' && parts[3] != null) return { page: 'session', id, i: +parts[3] };
  if (parts[2] === 'students') return { page: 'students', id };
  if (parts[2] === 'student' && parts[3] != null) return { page: 'student', id, sid: parts[3] };
  if (parts[2] === 'tips' && parts[3] === 'settings') return { page: 'tipssettings' };
  if (parts[2] === 'tips' && parts[3] != null) return { page: 'tips', id, fromSession: +parts[3] };
  if (parts[2] === 'tips') return { page: 'tips', id };
  return { page: 'class', id };
}

// ---------------------------------------------------------------- render

function render(): void {
  const route = parseRoute();
  // A completion/action notice belongs to the session it was triggered on; clear
  // it when moving to a different session so it doesn't bleed over.
  const sessionKey = route.page === 'session' ? `${route.id}|${route.i}` : '';
  if (sessionKey && sessionKey !== lastSessionKey) setNotice('');
  lastSessionKey = sessionKey;
  let content = '';
  let tab: 'home' | 'sessions' | 'students' | 'tips' = 'home';

  if (route.page === 'home') content = homePage();
  else if (route.page === 'class') { tab = 'sessions'; content = sessionsPage(route.id!); }
  else if (route.page === 'session') { tab = 'sessions'; content = sessionPage(route.id!, route.i!); }
  else if (route.page === 'students') { tab = 'students'; content = studentsPage(route.id!); }
  else if (route.page === 'student') { tab = 'students'; content = studentPage(route.id!, route.sid!); }
  else if (route.page === 'tips') { tab = 'tips'; content = tipsPage(route.id!, route.fromSession); }
  else if (route.page === 'tipssettings') { tab = 'tips'; content = tipSettingsPage(); }
  else if (route.page === 'new') content = newCoursePage();
  else if (route.page === 'programmes') content = programmesPage();

  const sub = route.page === 'session' || route.page === 'student' || route.page === 'new' || route.page === 'programmes' || route.page === 'tipssettings';
  root.innerHTML = `
    <div class="screen">${content}${route.page === 'home' ? `<footer class="version" title="git commit ${__GIT_COMMIT__}">build ${__GIT_COMMIT_SHORT__}</footer>` : ''}</div>
    ${sub ? '' : bottomNav(route.page === 'home' ? null : route.id, tab)}
    ${probModal ? renderModal(probModal) : ''}
  `;
  wire();
}

function renderModal(m: ProbModal): string {
  const p = m.existing?.priority ?? 3;
  const note = m.existing?.note ?? m.archivedNote ?? '';
  return `
    <div class="overlay" data-closeprob>
      <div class="modal">
        <h2>Prioritise</h2>
        <p class="modal-call">${callLabel({ title: m.title, level: '', setupIdx: m.setupIdx, setup: '' })}</p>
        <label class="field">Notes
          <textarea id="probNote" rows="3" placeholder="What do they struggle with?">${esc(note)}</textarea>
        </label>
        <label class="field">Priority
          <input id="probPriority" type="range" min="1" max="5" step="1" value="${p}" />
          <span class="row"><span class="muted">1 = low, 5 = high</span><b id="probPriorityVal">${p}</b></span>
        </label>
        <div class="row two">
          <button class="big primary" data-probsave>Save</button>
          <button class="big" data-probcancel>Cancel</button>
        </div>
        ${m.existing ? `<button class="big danger" data-probremove>Remove prioritisation</button>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- pages

function homePage(): string {
  return `
    <header class="appbar">
      <h1>Teacher</h1>
      <p class="sub">Square dance class planner</p>
    </header>
    <div class="content">
      <h2 class="section-title">Your classes</h2>
      ${classes.map((c) => `
        <div class="card session-card">
          <button class="session-main tap" data-nav="#/class/${c.id}">
            <div class="card-main">${esc(c.name)}</div>
            <div class="card-sub">${c.level.toUpperCase()} · ${c.students.length} students · ${c.sessions.length} sessions</div>
          </button>
          <button class="delete-btn" data-delclass="${c.id}" title="Delete class">✕</button>
        </div>`).join('')}
      <button class="card tap primary-card" data-nav="#/new">
        <div class="card-main">＋ New course</div>
        <div class="card-sub">Pick a programme of sessions to start a new class</div>
      </button>
      <button class="card tap dashed" data-nav="#/programmes">
        <div class="card-main">⇅ Programmes</div>
        <div class="card-sub">Import / export the default course of sessions</div>
      </button>
      ${notice ? `<p class="notice${noticeWarn ? ' warn' : ''}">${esc(notice)}</p>` : ''}
      <p class="hint">Tap a class to open its sessions.</p>
    </div>`;
}

function sessionsPage(id: string): string {
  const c = cls(id);
  if (!c) return notFound();
  return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>${esc(c.name)}</h1><p class="sub">${c.level.toUpperCase()}</p></div>
    </header>
    <div class="content">
      ${notice ? `<p class="notice${noticeWarn ? ' warn' : ''}">${esc(notice)}</p>` : ''}
      ${c.sessions.map((s, i) => {
        // For a completed session use the captured (pre-copy) counts; otherwise
        // taught + planned. The total is the sum of taught and planned calls.
        const taughtN = s.capturedTaught?.length ?? s.taught.length;
        const totalN = taughtN + (s.capturedPlanned?.length ?? s.planned.length);
        const pct = totalN ? Math.round((taughtN / totalN) * 100) : 0;
        return `
        <div class="card session-card ${s.completed ? 'done' : ''}">
          <button class="session-main tap" data-nav="#/class/${id}/session/${i}">
            <div class="card-main">${esc(s.name)} ${s.completed ? '<span class="done-badge">✓</span>' : ''}</div>
            <div class="card-sub">Taught ${taughtN} of ${totalN} calls</div>
            <div class="progress"><span style="width:${pct}%"></span></div>
          </button>
          <label class="complete-check"><input type="checkbox" data-completed="${id}:${i}" ${s.completed ? 'checked' : ''} /></label>
        </div>`;
      }).join('')}
      <p class="hint">Tap a session to take the register and plan the practice.</p>
    </div>`;
}

function sessionPage(id: string, i: number): string {
  const c = cls(id);
  const s = session(id, i);
  if (!c || !s) return notFound();
  return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>${esc(s.name)}</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      ${notice ? `<p class="notice${noticeWarn ? ' warn' : ''}">${esc(notice)}</p>` : ''}
      ${s.capturedAt ? `<p class="muted">Completed — captured taught ${s.capturedTaught?.length ?? 0} of ${(s.capturedTaught?.length ?? 0) + (s.capturedPlanned?.length ?? 0)} calls (taught + planned) at the time of completion.</p>` : ''}
      <details class="collapsible" data-dkey="s:${id}:${i}:taught"${detailsOpenAttr(`s:${id}:${i}:taught`, true)}>
        <summary>Taught this session</summary>
        ${s.taught.length ? renderGrouped(s.taught, (r, ti) => sessionCallChip(r, `data-unteach="${id}:${i}:${ti}"`, '✓', id, i, s)) : '<span class="muted">Nothing taught yet — tap a planned call below to teach it</span>'}
      </details>

      <details class="collapsible" data-dkey="s:${id}:${i}:planned"${detailsOpenAttr(`s:${id}:${i}:planned`, true)}>
        <summary>Planned <button class="small-btn" data-moveall="${id}:${i}">Move all → taught</button></summary>
        ${s.planned.length ? renderGrouped(s.planned, (r, pi) => sessionCallChip(r, `data-teach="${id}:${i}:${pi}"`, '', id, i, s)) : '<span class="muted">No plan</span>'}
        <button class="big" data-act="pull" data-id="${id}" data-i="${i}" style="margin-top:12px">Pull 1 from next</button>
        <p class="hint">Tap a call under Planned to teach it (it moves up to Taught). Tap a taught call to move it back.</p>
      </details>

      <details class="collapsible" data-dkey="s:${id}:${i}:prev"${detailsOpenAttr(`s:${id}:${i}:prev`, false)}>
        <summary>Taught in previous sessions</summary>
        ${renderPrevTaught(c, i)}
      </details>

      <h2 class="section-title">Who was here?</h2>
      <div class="attend">
        ${c.students.map((st) => `
          <button class="attender ${s.attendance[st.id] ? 'on' : ''}" data-att="${st.id}" data-id="${id}" data-i="${i}">
            <span class="tick">${s.attendance[st.id] ? '✓' : ''}</span>
            <span>${esc(st.name)}</span>
          </button>`).join('')}
      </div>
      <p class="hint">Tap a name to mark them present/absent. Absent dancers miss the taught calls.</p>

      <button class="big primary" data-nav="#/class/${id}/tips/${i}">Make practice tips →</button>

      <details class="collapsible" style="margin-top:16px" data-dkey="s:${id}:${i}:mods"${detailsOpenAttr(`s:${id}:${i}:mods`, false)}>
        <summary>Saved modules</summary>
        ${savedModules[id]?.length ? savedModules[id].map((m, mi) => renderModule(id, m, mi)).join('') : '<p class="hint">No saved modules yet — save a tip from the Practice tips page.</p>'}
        <div class="row two" style="margin-top:10px">
          <button class="big" data-modexport="${id}">Export</button>
          <button class="big" data-modimporttoggle="${id}">Import</button>
        </div>
        <span class="mod-export-msg" data-modexportmsg="${id}"></span>
        <div id="modImportBox" hidden style="margin-top:10px">
          <textarea id="modImportText" rows="3" placeholder="Paste exported module JSON here…"></textarea>
          <div class="row two" style="margin-top:8px">
            <label class="big filebtn">Choose file<input type="file" id="modImportFile" data-modid="${id}" accept=".json,application/json" hidden /></label>
            <button class="big primary" data-modimport="${id}">Import</button>
          </div>
        </div>
      </details>
    </div>`;
}

function studentsPage(id: string): string {
  const c = cls(id);
  if (!c) return notFound();
  return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>Students</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="row two addstudent-row">
        <input id="addStudent" type="text" placeholder="New dancer's name" data-id="${id}" />
        <button class="big primary" type="button" data-addstudent data-id="${id}">Add</button>
      </div>
      ${c.students.length ? c.students.map((st) => {
        const k = studentKnowledge(c, st.id);
        return `
        <div class="card">
          <button class="card-main tap" data-nav="#/class/${id}/student/${st.id}" style="width:100%;text-align:left;background:none;border:none;padding:0;min-height:auto">${esc(st.name)}</button>
          <div class="card-sub">Knows ${k.known.length} call${k.known.length === 1 ? '' : 's'} ${k.missed.length ? `· missed ${k.missed.length}` : ''}</div>
          <div class="card-sub">Completed: ${renderStudentAttendance(c, st.id)}</div>
          <div class="row two" style="margin-top:10px">
            <button class="big" data-rename="${id}:${st.id}">Rename</button>
            <button class="big danger" data-remove="${id}:${st.id}">Remove</button>
          </div>
        </div>`;
      }).join('') : '<p class="hint">No dancers yet — add the first one above.</p>'}
    </div>`;
}

// Per-call probability sliders, grouped by call family (tamination title). Each
// call is shown in the same chip style as the session page (name + position +
// star to prioritise) with its probability slider underneath. Each slider starts
// at the effective probability (override or the global current/prev default from
// Tip settings). Calls taught in any session up to the current one are included.
function renderCallProbs(id: string, c: ClassInstance, sIdx: number, avail: Set<string>): string {
  const currentSet = new Set(c.sessions[sIdx].taught.map((r) => r.title));
  const prioritised = new Set(c.sessions[sIdx].problems.map((p) => p.title));
  // Collect each distinct taught call (in teach order across sessions) once.
  const seen = new Set<string>();
  const refs: CallRef[] = [];
  for (let si = 0; si <= sIdx; si++) {
    for (const r of c.sessions[si].taught) {
      if (avail.has(r.title) && !seen.has(r.title)) {
        seen.add(r.title);
        refs.push(r);
      }
    }
  }
  if (!refs.length) return '<span class="muted">No taught calls to tune yet.</span>';

  const item = (r: CallRef) => {
    const pct = Math.round(effectiveCallProb(id, r.title, currentSet, prioritised) * 100);
    const si = c.sessions.findIndex((s) => s.taught.some((t) => t.title === r.title && t.setupIdx === r.setupIdx));
    const on = si >= 0 && c.sessions[si].problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
    return `<div class="callprob-item">
      <span class="chip wrap ${on ? 'warn' : ''}"><span class="chip-main">${callLabel(r)}</span><button class="star ${on ? 'on' : ''}" data-star="${id}::${si}::${r.title}::${r.setupIdx}" title="Prioritise this call">${on ? '★' : '☆'}</button></span>
      <div class="callprob-slider">
        <span class="cpval">${pct}%</span>
        <input type="range" class="callprob" data-callprob="${id}::${r.title}" min="0" max="100" step="5" value="${pct}" />
      </div>
    </div>`;
  };

  // Group the items under sub-headings by their call family.
  const groups = new Map<string, CallRef[]>();
  for (const r of refs) {
    const fam = familyOf(r.title);
    const arr = groups.get(fam) ?? [];
    arr.push(r);
    groups.set(fam, arr);
  }
  let out = '';
  for (const [fam, list] of groups) {
    out += `<h3 class="family-head">${esc(fam)}</h3>${list.map(item).join('')}`;
  }
  return out;
}

// Attendance for a student across completed sessions, as small present/missed chips.
function renderStudentAttendance(c: ClassInstance, studentId: string): string {
  const done = c.sessions.map((s, i) => ({ i, s })).filter((x) => x.s.completed);
  if (!done.length) return '<span class="muted">no completed sessions</span>';
  return done
    .map(({ i, s }) => {
      const present = !!s.attendance[studentId];
      return `<span class="chip ${present ? 'present' : 'missed'}">S${i + 1} ${present ? '✓' : '✗'}</span>`;
    })
    .join('');
}

// Group call chips under sub-headings by their call family (tamination title).
function renderGrouped(calls: CallRef[], render: (r: CallRef, index: number) => string): string {
  const groups = new Map<string, { r: CallRef; idx: number }[]>();
  calls.forEach((r, idx) => {
    const fam = familyOf(r.title);
    const arr = groups.get(fam) ?? [];
    arr.push({ r, idx });
    groups.set(fam, arr);
  });
  let out = '';
  for (const [fam, list] of groups) {
    out += `<h3 class="family-head">${esc(fam)}</h3><div class="chips">${list.map(({ r, idx }) => render(r, idx)).join('')}</div>`;
  }
  return out;
}

// Distinct calls taught in sessions before index `i`, as chips grouped by family.
function renderPrevTaught(c: ClassInstance, i: number): string {
  if (i <= 0 || c.sessions.length === 0) {
    return '<span class="muted">No previous sessions yet</span>';
  }
  // Highlight using the CURRENT session's prioritised call-setups — the same
  // source as the planned list — so a prioritised call shows the same style here
  // as it does in Planned.
  const warnKeys = new Set((c.sessions[i]?.problems ?? []).map((p) => `${p.title}#${p.setupIdx}`));
  const seen = new Set<string>();
  const unique: CallRef[] = [];
  for (const sess of c.sessions.slice(0, i)) {
    for (const r of sess.taught) {
      if (seen.has(r.title)) continue;
      seen.add(r.title);
      unique.push(r);
    }
  }
  return unique.length
    ? renderGrouped(unique, (r) => chip(r, warnKeys))
    : '<span class="muted">Nothing was taught in previous sessions</span>';
}

function studentPage(id: string, sid: string): string {
  const c = cls(id);
  const st = c?.students.find((s) => s.id === sid);
  if (!c || !st) return notFound();
  const k = studentKnowledge(c, sid);
  return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}/students">‹</button>
      <div><h1>${esc(st.name)}</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      <h2 class="section-title">Knows (${k.known.length})</h2>
      <div class="chips">${k.known.length ? k.known.map((t) => chip({ title: t, level: '', setupIdx: 0, setup: '' })).join('') : '<span class="muted">No calls yet</span>'}</div>
      ${k.missed.length ? `
        <h2 class="section-title">Missed — needs re-teaching</h2>
        <div class="chips">${k.missed.map((t) => chip({ title: t, level: '', setupIdx: 0, setup: '' }, new Set(k.missed))).join('')}</div>
        <p class="hint">These were taught on a session ${st.name} was absent from.</p>` : ''}
    </div>`;
}

function tipsPage(id: string, fromSession?: number): string {
  const c = cls(id);
  if (!c) return notFound();
  // The "current" session is the one this page was launched from (or the last).
  const sIdx = fromSession != null ? Math.min(fromSession, c.sessions.length - 1) : c.sessions.length - 1;
  const avail = availableTitles(c, sIdx);
  const tips = tipsByClass[id] ?? [];
  const ts = tipsState[id] ?? { selectedTip: -1, selectedIdx: -1 };
  // Return to the session this page was launched from, else the sessions list.
  const back = fromSession != null ? `#/class/${id}/session/${fromSession}` : `#/class/${id}`;
  return `
    <header class="appbar">
      <button class="back" data-nav="${back}">‹</button>
      <div><h1>Practice tips</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="card">
        <div class="card-main">Auto-make 3 tips</div>
        <div class="card-sub">Each tip starts and finishes in the squared set, uses only calls taught so far, and prioritises the highlighted ones.</div>
        <button class="big primary" data-act="gentips" data-id="${id}" data-session="${sIdx}">Generate tips</button>
      </div>

      <details class="collapsible">
        <summary>Call probabilities</summary>
        ${renderCallProbs(id, c, sIdx, avail)}
      </details>

      ${tips.length ? tips.map((t, ti) => renderTip(id, t, ti, ts)).join('') : '<p class="hint">No tips yet — tap "Generate tips".</p>'}

      <h2 class="section-title">Saved modules</h2>
      ${(savedModules[id]?.length ? savedModules[id].map((m, mi) => renderModule(id, m, mi)).join('') : '<p class="hint">None saved yet — tap "Save tip" on a generated tip to keep it.</p>')}
    </div>`;
}

function renderModule(id: string, m: SavedModule, mi: number): string {
  const when = new Date(m.createdAt).toLocaleString();
  const where = [m.createdClass, m.createdSession].filter(Boolean).join(' · ');
  return `
    <div class="card">
      <div class="card-title-row">
        <button class="card-title tap" data-modview="${id}:${mi}">${esc(m.name)}</button>
        <button class="icon-btn danger" data-delmod="${id}:${mi}" title="Delete">✕</button>
      </div>
      <div class="card-sub">${where ? `${esc(where)} · ` : ''}${esc(when)}</div>
      ${m.expanded ? `<div class="chips" style="margin-top:8px">${m.titles.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="row two" style="margin-top:10px">
        <button class="big" data-renamemod="${id}:${mi}">Rename</button>
        <button class="big" data-modview="${id}:${mi}">${m.expanded ? 'Hide' : 'View'}</button>
      </div>
    </div>`;
}

function renderTip(id: string, t: Tip, ti: number, ts: { selectedTip: number; selectedIdx: number }): string {
  const c = cls(id)!;
  const sIdx = Math.max(0, c.sessions.length - 1);
  const selected = ts.selectedTip === ti;
  const selCall = selected ? t.titles[ts.selectedIdx] : null;
  const fits = selected && selCall != null ? fitsAround(seq, availableTitles(c, sIdx), t.titles, ts.selectedIdx) : null;
  return `
    <div class="tip">
      <div class="tip-head">
        <span class="tip-name">Tip ${ti + 1} · ${t.titles.length} calls</span>
        <button class="icon-btn danger" data-rmtip="${id}:${ti}">✕</button>
      </div>
      <div class="chips">${t.titles.map((c, ci) => `
        <button class="chip tap ${selected && ci === ts.selectedIdx ? 'sel' : ''}" data-selcall="${id}:${ti}:${ci}">${esc(c)}</button>`).join('')}</div>
      ${fits ? `
        <div class="fits">
          <div><b>Add before / replace</b>: ${fits.before.length ? fits.before.map((c) => `<button class="chip tap" data-before="${id}:${ti}:${c}">${esc(c)}</button>`).join('') : '<span class="muted">—</span>'}</div>
          <div><b>Add after</b>: ${fits.after.length ? fits.after.map((c) => `<button class="chip tap" data-after="${id}:${ti}:${c}">${esc(c)}</button>`).join('') : '<span class="muted">—</span>'}</div>
        </div>` : '<p class="hint">Tap a call to see what can go before / after it.</p>'}
      <div style="margin-top:8px">
        <button class="big primary" data-savetip="${id}:${ti}">Save tip</button>
        <span class="save-err" data-saveerr="${id}:${ti}"></span>
      </div>
    </div>`;
}

function tipSettingsPage(): string {
  const cfg = tipConfigGlobal;
  const pct = (v: number) => Math.round(v * 100);
  return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>Tip settings</h1><p class="sub">General</p></div>
    </header>
    <div class="content">
      <label class="field">Repeat calls
        <input id="cfgRepeat" type="range" min="0" max="100" step="5" value="${pct(cfg.repeatProb)}" />
        <div class="row"><span class="muted">How likely a call already in a tip may be repeated.</span><b id="cfgRepeatVal">${pct(cfg.repeatProb)}%</b></div>
      </label>
      <label class="field">Use priority calls
        <input id="cfgPriority" type="range" min="0" max="100" step="5" value="${pct(cfg.priorityProb)}" />
        <div class="row"><span class="muted">How often a prioritised (current/problem) call is preferred.</span><b id="cfgPriorityVal">${pct(cfg.priorityProb)}%</b></div>
      </label>
      <label class="field">Use calls taught this session
        <input id="cfgCurrent" type="range" min="0" max="100" step="5" value="${pct(cfg.currentProb)}" />
        <div class="row"><span class="muted">How often newly-taught calls are preferred.</span><b id="cfgCurrentVal">${pct(cfg.currentProb)}%</b></div>
      </label>
      <label class="field">Use previously taught calls
        <input id="cfgPrev" type="range" min="0" max="100" step="5" value="${pct(cfg.prevProb)}" />
        <div class="row"><span class="muted">How often calls from earlier sessions are preferred.</span><b id="cfgPrevVal">${pct(cfg.prevProb)}%</b></div>
      </label>
      <button class="big primary" data-savecfg>Save settings</button>
      <p class="hint">0% = never, 100% = always. These apply next time you Generate tips.</p>
    </div>`;
}

function newCoursePage(): string {
  return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>New course</h1><p class="sub">Start from a programme</p></div>
    </header>
    <div class="content">
      <label class="field">Course name <span class="req">*</span>
        <input id="newName" type="text" placeholder="e.g. Monday Beginners" />
        <span class="err" id="err-name"></span>
      </label>
      <label class="field">Programme (sessions &amp; calls)
        <select id="newProg">
          ${programmes.length ? programmes.map((p, i) => `<option value="${i}">${esc(p.name)} · ${p.level.toUpperCase()} · ${p.sessions.length} sessions</option>`).join('') : '<option value="-1">No programmes — add one first</option>'}
        </select>
        <span class="err" id="err-prog"></span>
      </label>
      <label class="field">Students (comma separated, optional)
        <input id="newStudents" type="text" placeholder="e.g. Alice, Bob, Carol" />
      </label>
      <button class="big primary" data-act="createcourse">Create course</button>
      <p class="hint">The course starts with each session's planned calls from the programme. Nothing is taught yet.</p>
    </div>`;
}

function programmesPage(): string {
  return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>Programmes</h1><p class="sub">Import / export the default course</p></div>
    </header>
    <div class="content">
      <h2 class="section-title">Your programmes</h2>
      ${programmes.map((p, i) => `
        <div class="card">
          <div class="card-main">${esc(p.name)}</div>
          <div class="card-sub">${p.level.toUpperCase()} · ${p.sessions.length} sessions</div>
          <div class="row two" style="margin-top:10px">
            <button class="big" data-export="${i}">Copy</button>
            <button class="big" data-download="${i}">Download</button>
          </div>
        </div>`).join('')}
      <h2 class="section-title">Import a programme</h2>
      <textarea id="importText" rows="5" placeholder="Paste a programme JSON here…"></textarea>
      <div class="row two" style="margin-top:8px">
        <label class="big filebtn">Choose file<input type="file" id="importFile" accept=".json,application/json" hidden /></label>
        <button class="big primary" data-import="text">Import</button>
      </div>
      ${notice ? `<p class="notice${noticeWarn ? ' warn' : ''}">${esc(notice)}</p>` : ''}
      <p class="hint">A programme is a list of sessions, each with the calls assigned to it. Export one to share it, then import it on another device.</p>
    </div>`;
}

// Modal state for prioritising a call-setup: null = closed.
interface ProbModal {
  id: string;
  i: number;
  title: string;
  setupIdx: number;
  existing?: { priority: number; note?: string };
  archivedNote?: string; // note kept from a previous prioritisation, for re-prioritising
}
let probModal: ProbModal | null = null;

// A session call chip: the tappable call (teach/unteach) plus a star that opens
// the prioritisation dialog.
function sessionCallChip(r: CallRef, action: string, prefix: string, id: string, i: number, s: SessionPlan): string {
  const on = s.problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
  const tip = prefix === '✓' ? 'Tap to move back to planned' : 'Tap to teach this call';
  return `<span class="chip wrap ${on ? 'warn' : ''}"><button class="chip-main" ${action} title="${tip}">${prefix ? `${prefix} ` : ''}${callLabel(r)}</button><button class="star ${on ? 'on' : ''}" data-star="${id}::${i}::${r.title}::${r.setupIdx}" title="Prioritise this call">${on ? '★' : '☆'}</button></span>`;
}

// Render a call with its name (bold) and position (dimmer) clearly separated.
function callLabel(r: CallRef): string {
  return `<span class="cl-name">${esc(r.title)}</span>${r.setup ? `<span class="cl-pos">from ${esc(r.setup)}</span>` : ''}`;
}

function chip(r: CallRef, warn = new Set<string>()): string {
  // Matches by title or by exact call-position (title#setupIdx).
  const w = warn.has(r.title) || warn.has(`${r.title}#${r.setupIdx}`);
  return `<span class="chip ${w ? 'warn' : ''}">${callLabel(r)}</span>`;
}

function notFound(): string {
  return `<div class="content"><h2>Class not found</h2><button class="big" data-nav="#/">Home</button></div>`;
}

function bottomNav(classId: string | null | undefined, active: 'home' | 'sessions' | 'students' | 'tips'): string {
  const hasClass = !!classId;
  const base = classId ? `#/class/${classId}` : '#/';
  const item = (label: string, key: string, href: string, disabled = false) =>
    `<a href="${disabled ? undefined : href}" class="nav-item ${active === key ? 'active' : ''} ${disabled ? 'disabled' : ''}" ${disabled ? 'aria-disabled="true"' : ''}>
      <span class="nav-ico">${ico(key)}</span><span>${label}</span></a>`;
  return `<nav class="bottombar">
    ${item('Home', 'home', '#/')}
    ${item('Sessions', 'sessions', base)}
    ${item('Students', 'students', hasClass ? `${base}/students` : '#/', !hasClass)}
    ${item('Tips', 'tips', hasClass ? `${base}/tips` : '#/tips/settings')}
  </nav>`;
}

function ico(key: string): string {
  return { home: '⌂', sessions: '▤', students: '👤', tips: '✦' }[key] ?? '·';
}

// ---------------------------------------------------------------- events

function wire(): void {
  // Persist the open/closed state of collapsible sections so a re-render (e.g.
  // toggling a student's attendance) doesn't snap a collapsed list back open.
  root.querySelectorAll<HTMLDetailsElement>('details[data-dkey]').forEach((el) => {
    const k = el.dataset.dkey!;
    el.addEventListener('toggle', () => detailsState.set(k, el.open));
  });

  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.nav!);
    }));

  root.querySelectorAll<HTMLElement>('[data-att]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!, i = +b.dataset.i!, sid = b.dataset.att!;
      session(id, i)!.attendance[sid] = !session(id, i)!.attendance[sid];
      save();
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-star]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, title, setupIdx] = b.dataset.star!.split('::');
      const c = cls(id)!;
      const existing = c.sessions[+i].problems.find((p) => p.title === title && p.setupIdx === +setupIdx);
      // Prefill the note from the current priority, else from an archived note.
      const archived = archivedNote(c, +i, title, +setupIdx);
      probModal = {
        id,
        i: +i,
        title,
        setupIdx: +setupIdx,
        existing: existing ? { priority: existing.priority, note: existing.note } : undefined,
        archivedNote: archived,
      };
      render();
    }));
  root.querySelectorAll<HTMLInputElement>('#probPriority').forEach((el) => {
    el.addEventListener('input', () => { (root.querySelector('#probPriorityVal') as HTMLElement).textContent = el.value; });
  });
  root.querySelectorAll<HTMLElement>('[data-probsave]').forEach((b) =>
    b.addEventListener('click', () => {
      const note = sanitizeText((root.querySelector('#probNote') as HTMLTextAreaElement).value, 500);
      const pri = clampNum(+(root.querySelector('#probPriority') as HTMLInputElement).value, 1, 5);
      if (probModal) {
        setProblem(cls(probModal.id)!, probModal.i, probModal.title, probModal.setupIdx, pri, note, true);
        save();
      }
      probModal = null;
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-probcancel]').forEach((b) =>
    b.addEventListener('click', () => { probModal = null; render(); }));
  root.querySelectorAll<HTMLElement>('[data-probremove]').forEach((b) =>
    b.addEventListener('click', () => {
      if (probModal) {
        setProblem(cls(probModal.id)!, probModal.i, probModal.title, probModal.setupIdx, 3, '', false);
        save();
      }
      probModal = null;
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-closeprob]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('overlay')) { probModal = null; render(); }
    }));

  root.querySelectorAll<HTMLElement>('[data-delclass]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.delclass!;
      const c = classes.find((x) => x.id === id);
      if (c && window.confirm(`Delete class "${c.name}"?`)) {
        classes = classes.filter((x) => x.id !== id);
        save();
        render();
      }
    }));

  const doAddStudent = (id: string): void => {
    const input = root.querySelector('#addStudent') as HTMLInputElement;
    const name = sanitizeText(input.value);
    if (!name) {
      input.classList.add('invalid');
      return;
    }
    input.classList.remove('invalid');
    addStudent(cls(id)!, name);
    input.value = '';
    save();
    render();
  };
  root.querySelectorAll<HTMLElement>('[data-addstudent]').forEach((b) =>
    b.addEventListener('click', () => doAddStudent(b.dataset.id!)));
  // Pressing Enter in the name field should add the dancer, not submit/reload.
  root.querySelectorAll<HTMLInputElement>('#addStudent').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAddStudent(el.dataset.id!);
      }
    }));
  root.querySelectorAll<HTMLElement>('[data-rename]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, sid] = b.dataset.rename!.split(':');
      const c = cls(id)!;
      const st = c.students.find((s) => s.id === sid);
      const name = sanitizeText(window.prompt('Rename dancer', st?.name ?? '') ?? '');
      if (name) {
        renameStudent(c, sid, name);
        save();
        render();
      }
    }));
  root.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, sid] = b.dataset.remove!.split(':');
      const c = cls(id)!;
      const st = c.students.find((s) => s.id === sid);
      if (window.confirm(`Remove ${st?.name ?? 'this dancer'} from the class?`)) {
        removeStudent(c, sid);
        save();
        render();
      }
    }));

  root.querySelectorAll<HTMLElement>('[data-moveall]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't toggle the <details> section
      const [id, i] = b.dataset.moveall!.split(':');
      teachAll(cls(id)!, +i);
      save();
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-teach]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, pi] = b.dataset.teach!.split(':');
      teachCall(cls(id)!, +i, +pi);
      save();
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-unteach]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, ti] = b.dataset.unteach!.split(':');
      unteachCall(cls(id)!, +i, +ti);
      save();
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-act="pull"]').forEach((b) =>
    b.addEventListener('click', () => { pullForward(cls(b.dataset.id!)!, +b.dataset.i!, 1); save(); render(); }));
  root.querySelectorAll<HTMLInputElement>('[data-completed]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const [id, i] = cb.dataset.completed!.split(':');
      const c = cls(id)!;
      const s = c.sessions[+i];
      s.completed = cb.checked;
      // On completion: move any planned calls forward, and carry taught
      // call-positions that were missed (as priorities) into the next session.
      // completeSession snapshots the taught/planned counts before moving the plan.
      let moved = 0;
      let carried = 0;
      if (cb.checked) {
        const res = completeSession(c, +i);
        moved = res.movedPlanned;
        carried = res.carried;
      }
      save();
      setNotice(
        cb.checked
          ? carried || moved
            ? `Session completed — ${moved} planned call(s) moved on, ${carried} missed/prioritised call(s) carried.`
            : 'Session completed.'
          : 'Session marked not complete.',
      );
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-act="createcourse"]').forEach((b) =>
    b.addEventListener('click', () => {
      const nameEl = root.querySelector('#newName') as HTMLInputElement;
      const progEl = root.querySelector('#newProg') as HTMLSelectElement;
      const errName = root.querySelector('#err-name') as HTMLElement;
      const errProg = root.querySelector('#err-prog') as HTMLElement;

      const name = sanitizeText(nameEl.value);
      const pi = +progEl.value;
      const p = programmes[pi];

      let ok = true;
      if (!name) {
        errName.textContent = 'Please give the course a name.';
        nameEl.classList.add('invalid');
        ok = false;
      } else {
        errName.textContent = '';
        nameEl.classList.remove('invalid');
      }
      if (!p) {
        errProg.textContent = 'Pick a programme, or add one under Programmes first.';
        progEl.classList.add('invalid');
        ok = false;
      } else {
        errProg.textContent = '';
        progEl.classList.remove('invalid');
      }
      if (!ok) return;

      const students = (root.querySelector('#newStudents') as HTMLInputElement).value.split(',').map((s) => sanitizeText(s)).filter(Boolean);
      const id = 'c' + Date.now().toString(36);
      classes.push(buildClassFromProgramme(id, name, p, students, toRefOrNull));
      save();
      navigate(`#/class/${id}`);
    }));

  root.querySelectorAll<HTMLElement>('[data-export]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = programmes[+b.dataset.export!];
      const text = serializeProgramme(p);
      const doCopy = () => { setNotice(`Copied "${p.name}" to clipboard.`); render(); };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(doCopy, () => { setNotice('Could not copy — see console.'); render(); });
      } else {
        setNotice('Clipboard unavailable on this device.');
        render();
      }
    }));

  root.querySelectorAll<HTMLElement>('[data-download]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = programmes[+b.dataset.download!];
      const blob = new Blob([serializeProgramme(p)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${p.name.replace(/\W+/g, '-').toLowerCase()}-programme.json`;
      a.click();
      URL.revokeObjectURL(url);
    }));

  // ---- saved-modules import / export ----
  root.querySelectorAll<HTMLElement>('[data-modexport]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.modexport!;
      const list = savedModules[id] ?? [];
      const msg = root.querySelector<HTMLElement>(`[data-modexportmsg="${id}"]`);
      const show = (text: string) => { if (msg) { msg.textContent = text; msg.classList.add('show'); } };
      if (!list.length) { show('No saved modules to export.'); return; }
      const text = serializeModules(list);
      const doCopy = () => show(`Copied ${list.length} module(s) to clipboard.`);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(doCopy, () => show('Could not copy — see console.'));
      } else {
        show('Clipboard unavailable on this device.');
      }
    }));

  root.querySelectorAll<HTMLElement>('[data-modimporttoggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const box = root.querySelector('#modImportBox') as HTMLElement | null;
      if (box) box.hidden = !box.hidden;
    }));

  root.querySelectorAll<HTMLElement>('[data-modimport]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.modimport!;
      const ta = root.querySelector('#modImportText') as HTMLTextAreaElement;
      const text = ta.value;
      if (!text.trim()) {
        ta.classList.add('invalid');
        setNotice('Nothing to import — paste module JSON or choose a file first.');
        render();
        return;
      }
      ta.classList.remove('invalid');
      importModulesText(id, text);
    }));

  root.querySelectorAll<HTMLInputElement>('#modImportFile').forEach((file) =>
    file.addEventListener('change', () => {
      const id = file.dataset.modid!;
      const f = file.files?.[0];
      if (!f) { setNotice('No file was chosen.'); render(); return; }
      const reader = new FileReader();
      reader.onload = () => importModulesText(id, String(reader.result ?? ''));
      reader.readAsText(f);
    }));

  root.querySelectorAll<HTMLElement>('[data-import]').forEach((b) =>
    b.addEventListener('click', () => {
      const ta = root.querySelector('#importText') as HTMLTextAreaElement;
      const text = ta.value;
      if (!text.trim()) {
        ta.classList.add('invalid');
        setNotice('Nothing to import — paste a programme or choose a file first.');
        render();
        return;
      }
      ta.classList.remove('invalid');
      importProgrammeText(text);
    }));

  root.querySelectorAll<HTMLInputElement>('#importFile').forEach((file) =>
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) {
        setNotice('No file was chosen.');
        render();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => importProgrammeText(String(reader.result ?? ''));
      reader.readAsText(f);
    }));

  root.querySelectorAll<HTMLButtonElement>('[data-act="gentips"]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const c = cls(id)!;
      const sIdx = b.dataset.session != null ? Math.min(+b.dataset.session, c.sessions.length - 1) : c.sessions.length - 1;
      generateTipsInBackground(b, id, c, sIdx);
    }));

  // Generate tips synchronously on the main thread (no worker). It yields to the
  // event loop between attempts so the button can repaint its progress, but the
  // search itself is a simple direct call — far more reliable than round-tripping
  // results through a worker, and it uses the page's own (working) DOMParser.
  function generateTipsInBackground(btn: HTMLButtonElement, id: string, c: ClassInstance, sIdx: number): void {
    const done = () => {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.textContent = 'Generate tips';
    };
    btn.disabled = true;
    btn.classList.add('busy');
    btn.innerHTML = '<span class="spinner"></span>Generating…';

    const avail = availableTitles(c, sIdx);
    const calls = catalog.filter((x) => avail.has(x.title)).map((x) => ({ title: x.title, xml: x.xml }));
    const prioritised = new Set(c.sessions[sIdx].problems.map((p) => p.title));
    const familyMap: Record<string, string> = {};
    for (const x of catalog) familyMap[x.title] = x.family;
    console.log('[gentips] starting for class', id, 'session', sIdx, 'avail=', avail.size, 'calls=', calls.length, 'current=', c.sessions[sIdx].taught.length);

    // Register a Sequencer with ONLY the class's known calls so tips and their
    // getouts home use only calls the class has been taught.
    const availSeq = makeSequencer(movesXml, formationsXml, calls);
    const currentSet = new Set(c.sessions[sIdx].taught.map((r) => r.title));
    const priority = priorityWeights(c, sIdx);
    const totalAttempts = 3 * 8;

    (async () => {
      try {
        const tips = await generateTips(availSeq, avail, priority, {
          minLen: 3,
          maxLen: 5,
          count: 3,
          getoutMax: 5,
          config: tipConfigGlobal,
          current: currentSet,
          callProb: (t) => effectiveCallProb(id, t, currentSet, prioritised),
          family: (t) => familyMap[t] ?? '',
          onProgress: (attempts, made) => {
            btn.innerHTML = `<span class="spinner"></span>Searching ${attempts}/${totalAttempts} · ${made}/3 tips`;
            return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          },
        });
        console.log('[gentips] generated', tips.length, 'tips');
        tipsByClass[id] = tips.map((titles, i) => ({
          name: `Tip ${i + 1}`,
          sourceSessionId: c.sessions[sIdx].id,
          titles,
        }));
        tipsState[id] = { selectedTip: tipsByClass[id].length ? 0 : -1, selectedIdx: -1 };
        done();
        render();
      } catch (err) {
        console.error('[gentips] error generating tips:', err);
        done();
        setNotice('Tip generation failed.');
        render();
      }
    })();
  }

  // Tip settings page: live readout + save.
  root.querySelectorAll<HTMLInputElement>('#cfgRepeat').forEach((el) => {
    el.addEventListener('input', () => { (root.querySelector('#cfgRepeatVal') as HTMLElement).textContent = `${el.value}%`; });
  });
  const wireSlider = (id: string, valId: string) => {
    root.querySelectorAll<HTMLInputElement>(`#${id}`).forEach((el) => {
      el.addEventListener('input', () => { (root.querySelector(`#${valId}`) as HTMLElement).textContent = `${el.value}%`; });
    });
  };
  wireSlider('cfgPriority', 'cfgPriorityVal');
  wireSlider('cfgCurrent', 'cfgCurrentVal');
  wireSlider('cfgPrev', 'cfgPrevVal');
  root.querySelectorAll<HTMLElement>('[data-savecfg]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = (sel: string) => clampNum(+(root.querySelector(sel) as HTMLInputElement).value, 0, 100) / 100;
      tipConfigGlobal = {
        repeatProb: v('#cfgRepeat'),
        priorityProb: v('#cfgPriority'),
        currentProb: v('#cfgCurrent'),
        prevProb: v('#cfgPrev'),
      };
      saveTipConfig();
      setNotice('Tip settings saved.');
      navigate('#/');
    }));

  root.querySelectorAll<HTMLElement>('[data-rmtip]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti] = b.dataset.rmtip!.split(':');
      tipsByClass[id].splice(+ti, 1);
      tipsState[id] = { selectedTip: -1, selectedIdx: -1 };
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-selcall]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti, ci] = b.dataset.selcall!.split(':').map(Number);
      tipsState[id] = { selectedTip: ti, selectedIdx: ci };
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-before]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti, title] = b.dataset.before!.split(':');
      const st = tipsState[id];
      tipsByClass[id][+ti].titles = insertInto(tipsByClass[id][+ti].titles, st.selectedIdx, title);
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-after]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti, title] = b.dataset.after!.split(':');
      const st = tipsState[id];
      tipsByClass[id][+ti].titles = insertInto(tipsByClass[id][+ti].titles, st.selectedIdx + 1, title);
      render();
    }));

  root.querySelectorAll<HTMLInputElement>('input.callprob').forEach((el) => {
    el.addEventListener('input', () => {
      const val = el.nextElementSibling as HTMLElement | null;
      if (val) val.textContent = `${el.value}%`;
    });
    el.addEventListener('change', () => {
      const [cid, title] = el.dataset.callprob!.split('::');
      (callProbs[cid] ??= {})[title] = clampNum(+el.value, 0, 100) / 100;
      saveCallProbs();
    });
  });

  // Save a generated tip to the saved modules list, with when/where metadata.
  root.querySelectorAll<HTMLElement>('[data-savetip]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti] = b.dataset.savetip!.split(':');
      const c = cls(id)!;
      const t = tipsByClass[id][+ti];
      // Avoid duplicates: if the exact call sequence is already saved, don't save
      // it again — just point the user at the existing module.
      const modules = (savedModules[id] ??= []);
      const seq = t.titles;
      const dup = modules.findIndex((m) => sameSequence(m.titles, seq));
      if (dup >= 0) {
        // Show an inline error next to THIS Save tip button and flash a red outline
        // around it for ~2s (no re-render, so the outline persists).
        const err = root.querySelector<HTMLElement>(`[data-saveerr="${id}:${ti}"]`);
        if (err) {
          err.textContent = 'Already saved — a module with this exact sequence exists.';
          err.classList.add('show');
        }
        b.classList.add('dup');
        window.setTimeout(() => {
          b.classList.remove('dup');
          if (err) {
            err.classList.remove('show');
            err.textContent = '';
          }
        }, 2000);
        return;
      }
      // The session the tip was generated for (its sourceSessionId), not the last one.
      const sIdx = Math.max(0, c.sessions.findIndex((s) => s.id === t.sourceSessionId));
      // Suggest a creative name from the tip's calls; fall back to a plain count.
      const defaultName = suggestModuleName(t.titles) || `Saved tip ${modules.length + 1}`;
      const name = sanitizeText(window.prompt(`Name this module — suggested: "${defaultName}"`, defaultName) ?? '', 60) || defaultName;
      modules.push({
        name,
        titles: [...t.titles],
        createdAt: Date.now(),
        createdClass: c.name,
        createdSession: c.sessions[sIdx]?.name ?? '',
      });
      saveSavedModules();
      setNotice(`Saved "${name}" to modules.`);
      render();
    }));

  // View / hide a saved module's calls.
  root.querySelectorAll<HTMLElement>('[data-modview]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.modview!.split(':');
      const m = savedModules[id]?.[+mi];
      if (m) m.expanded = !m.expanded;
      saveSavedModules();
      render();
    }));

  // Rename a saved module.
  root.querySelectorAll<HTMLElement>('[data-renamemod]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.renamemod!.split(':');
      const m = savedModules[id]?.[+mi];
      if (!m) return;
      const name = window.prompt('Rename module', m.name);
      if (name != null) {
        m.name = sanitizeText(name) || m.name;
        saveSavedModules();
        render();
      }
    }));

  // Delete a saved module.
  root.querySelectorAll<HTMLElement>('[data-delmod]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.delmod!.split(':');
      const m = savedModules[id]?.[+mi];
      if (m && window.confirm(`Delete module "${m.name}"?`)) {
        savedModules[id].splice(+mi, 1);
        saveSavedModules();
        render();
      }
    }));
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trim and sanitize user-entered text: strip HTML tags, markup/control chars and
 * cap length, so nothing dangerous can be stored even if an `esc` is missed. */
function sanitizeText(s: string, maxLen = 80): string {
  return s
    .replace(/<[^>]*>/g, '') // strip any HTML tags
    .replace(/[<>'`]/g, '') // drop markup / attribute-breaking chars
    .replace(/[\u0000-\u001f\u007f]/g, '') // strip control chars
    .trim()
    .slice(0, maxLen);
}

/** Clamp a numeric input to a sensible range. */
function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function importProgrammeText(text: string): void {
  const p = parseProgramme(text);
  if (!p) {
    setNotice('That is not a valid programme. Export one first and paste its text.');
    render();
    return;
  }
  const existing = programmes.some((x) => x.name === p.name);
  if (existing) programmes = programmes.map((x) => (x.name === p.name ? p : x));
  else programmes.push(p);
  saveProgrammes();
  setNotice(`Imported "${p.name}" (${p.sessions.length} sessions). It is now a New course option.`);
  render();
}

render();
