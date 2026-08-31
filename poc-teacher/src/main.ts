// Teachers Session Tracker — mobile-first PoC UI (PRD item 15).
// A set of inter-related, hash-routed pages (Home → Sessions → Session detail,
// Students, Tips) with a large bottom navigation, built to be easy to read and
// tap on a phone for an older user.

import movesXml from '../../poc/src/assets/moves.xml?raw';
import formationsXml from '../../poc/src/assets/formations.xml?raw';

import { buildCatalog, makeSequencer } from './catalog';
import type { CatalogCall } from './catalog';
import type { FsmTableData } from 'dancing-squared-engine';
import type { CallRef, ClassInstance, SessionPlan, Tip, TipConfig } from './teacher';
import { parseProgramme } from './programme';
import type { Programme } from './programme';
import { TeacherStore } from './store';
import { Tour } from './tour';
import { Preview } from './preview';
import { Controller } from './controller';
import { View, type ProbModal } from './view';
import { esc } from './util';
import { suggestModuleName, sameSequence } from './names';
import { parseModules } from './modules';

// ---------------------------------------------------------------- catalog

const msFiles = import.meta.glob<string>('../../poc/src/assets/ms/*.xml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const catalog: CatalogCall[] = buildCatalog(msFiles);
const seq = makeSequencer(movesXml, formationsXml, catalog);

// The FSM transition table is PRECOMPUTED at build time (scripts/build-fsm-table.mjs,
// run as part of `npm run build`) and shipped as a static asset. The app just
// loads it — it never builds the table at runtime.
import fsmTableBlob from './assets/fsm-table.json';
if (seq.loadFsmTable(fsmTableBlob.table as FsmTableData)) {
  console.log(`[fsm] loaded precomputed transition table (${seq.transitionTable().stateCount()} states, ${seq.transitionTable().edgeCount()} edges)`);
} else {
  console.warn('[fsm] precomputed transition table failed to load — will be built on demand.');
}

const findCall = (title: string): CatalogCall | undefined => catalog.find((c) => c.title === title);
const familyOf = (title: string): string => findCall(title)?.family ?? 'Other';
const toRef = (title: string): CallRef => {
  const c = findCall(title)!;
  return { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label };
};

// Null-safe resolver for building courses from imported programmes (drops calls
// that aren't in the loaded catalog instead of throwing).
const toRefOrNull = (title: string): CallRef | null => {
  const c = findCall(title);
  return c ? { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label } : null;
};

// ---------------------------------------------------------------- state + persistence

// Persistent app data (classes, programmes, tip config, saved modules, etc.)
// lives in a TeacherStore; only transient UI state stays here.
const store = new TeacherStore();
let notice = '';
let noticeWarn = false;

/** Set the transient action notice; pass `warn: true` for a prominent warning
 * (e.g. "already saved" feedback) rendered in the warning colours. */
function setNotice(text: string, warn = false): void {
  notice = text;
  noticeWarn = warn;
}

// ---------------------------------------------------------------- tour overlay

// A short guided tour shown the first time the app opens (and replayable via a
// "Replay the tour" button on the home page).
const tour = new Tour(esc);
tour.attachRender(render);

const tipsByClass: Record<string, Tip[]> = {};
const tipsState: Record<string, { selectedTip: number; selectedIdx: number }> = {};

// Generating tips needs enough distinct taught calls to build varied, closable
// tips; below this the generator can't meaningfully produce three.
const MIN_TAUGHT_CALLS = 4;

/** Add parsed modules to a class's saved list, skipping duplicates. */
function importModulesText(id: string, text: string): void {
  const parsed = parseModules(text);
  if (!parsed) {
    setNotice('That is not valid module JSON. Export modules first and paste their text.');
    render();
    return;
  }
  const list = (store.savedModules[id] ??= []);
  let added = 0;
  for (const m of parsed) {
    if (list.some((x) => sameSequence(x.titles, m.titles))) continue;
    list.push(m);
    added++;
  }
  store.saveSavedModules();
  setNotice(
    added
      ? `Imported ${added} module(s).${parsed.length - added ? ` ${parsed.length - added} skipped as duplicates.` : ''}`
      : 'No new modules imported — they were all duplicates.',
  );
  render();
}

const cls = (id: string): ClassInstance | undefined => store.classes.find((c) => c.id === id);
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

// Page-rendering layer (see view.ts).
const view = new View({
  store,
  seq,
  esc,
  familyOf,
  cls,
  session,
  notice: () => notice,
  noticeWarn: () => noticeWarn,
  tipsByClass: () => tipsByClass,
  tipsState: () => tipsState,
});

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

  if (route.page === 'home') content = view.homePage();
  else if (route.page === 'class') { tab = 'sessions'; content = view.sessionsPage(route.id!); }
  else if (route.page === 'session') { tab = 'sessions'; content = view.sessionPage(route.id!, route.i!); }
  else if (route.page === 'students') { tab = 'students'; content = view.studentsPage(route.id!); }
  else if (route.page === 'student') { tab = 'students'; content = view.studentPage(route.id!, route.sid!); }
  else if (route.page === 'tips') { tab = 'tips'; content = view.tipsPage(route.id!, route.fromSession); }
  else if (route.page === 'tipssettings') { tab = 'tips'; content = view.tipSettingsPage(); }
  else if (route.page === 'new') content = view.newCoursePage();
  else if (route.page === 'programmes') content = view.programmesPage();

  // The footer navigation is shown on every page; the class id is null on
  // pages with no class context (home, new course, programmes, tip settings),
  // where the Sessions/Students/Tips items fall back to the home/settings routes.
  const classId = route.page === 'home' ? null : (route.id ?? null);
  root.innerHTML = `
    <div id="loadingBar" class="loading-bar">
      <div class="loading-inner">
        <div class="loading-track"><span></span></div>
        <div class="loading-text">Loading…</div>
      </div>
    </div>
    <div class="screen">${content}${route.page === 'home' ? `<footer class="version" title="git commit ${__GIT_COMMIT__}">build ${__GIT_COMMIT_SHORT__}</footer>` : ''}</div>
    ${view.bottomNav(classId, tab)}
    ${probModal ? view.renderModal(probModal) : ''}
    ${preview.active ? preview.overlay() : ''}
    ${tour.overlay()}
  `;
  controller.wire();
}


// Modal state for prioritising a call-setup: null = closed.
let probModal: ProbModal | null = null;

// ---------------------------------------------------------------- 2D preview

// A top-down 2D preview of a module/tip (see preview.ts).
const preview = new Preview(seq, root, render);

// DOM event wiring (see controller.ts).
const controller = new Controller({
  store,
  tour,
  preview,
  root,
  catalog,
  movesXml,
  formationsXml,
  minTaughtCalls: MIN_TAUGHT_CALLS,
  cls,
  session,
  navigate,
  render,
  setNotice,
  familyOf,
  toRefOrNull,
  suggestModuleName,
  sameSequence,
  importModulesText,
  importProgrammeText,
  getProbModal: () => probModal,
  setProbModal: (m) => { probModal = m; },
  getTipsByClass: () => tipsByClass,
  getTipsState: () => tipsState,
});

// ---------------------------------------------------------------- events


function importProgrammeText(text: string): void {
  const p = parseProgramme(text);
  if (!p) {
    setNotice('That is not a valid programme. Export one first and paste its text.');
    render();
    return;
  }
  const existing = store.programmes.some((x) => x.name === p.name);
  if (existing) store.programmes = store.programmes.map((x) => (x.name === p.name ? p : x));
  else store.programmes.push(p);
  store.saveProgrammes();
  setNotice(`Imported "${p.name}" (${p.sessions.length} sessions). It is now a New course option.`);
  render();
}

render();
tour.maybeStart();
