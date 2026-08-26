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
import { buildClassFromProgramme, parseProgramme, serializeProgramme } from './programme';
import type { Programme } from './programme';
import { TeacherStore } from './store';
import { Tour } from './tour';
import { Preview } from './preview';
import { View, type ProbModal } from './view';
import { esc, sanitizeText, clampNum } from './util';
import { suggestModuleName, sameSequence } from './names';
import { serializeModules, parseModules } from './modules';

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
  wire();
}


// Modal state for prioritising a call-setup: null = closed.
let probModal: ProbModal | null = null;

// ---------------------------------------------------------------- 2D preview

// A top-down 2D preview of a module/tip (see preview.ts).
const preview = new Preview(seq, root, render);



// ---------------------------------------------------------------- events

function wire(): void {
  // Persist the open/closed state of collapsible sections so a re-render (e.g.
  // toggling a student's attendance) doesn't snap a collapsed list back open,
  // and it's remembered across navigation and reloads.
  root.querySelectorAll<HTMLDetailsElement>('details[data-dkey]').forEach((el) => {
    const k = el.dataset.dkey!;
    el.addEventListener('toggle', () => {
      store.detailsState.set(k, el.open);
      store.saveDetailsState();
    });
  });

  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.nav!);
    }));

  // ---- tour ----
  tour.wire(root);

  root.querySelectorAll<HTMLElement>('[data-att]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!, i = +b.dataset.i!, sid = b.dataset.att!;
      session(id, i)!.attendance[sid] = !session(id, i)!.attendance[sid];
      store.saveClasses();
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
        store.saveClasses();
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
        store.saveClasses();
      }
      probModal = null;
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-closeprob]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('overlay')) { probModal = null; render(); }
    }));

  // ---- 2D preview ----
  preview.wire(root);

  root.querySelectorAll<HTMLElement>('[data-delclass]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.delclass!;
      const c = store.classes.find((x) => x.id === id);
      if (c && window.confirm(`Delete class "${c.name}"?`)) {
        store.classes = store.classes.filter((x) => x.id !== id);
        store.saveClasses();
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
    store.saveClasses();
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
  root.querySelectorAll<HTMLElement>('[data-renameclass]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.renameclass!;
      const c = cls(id);
      if (!c) return;
      const name = sanitizeText(window.prompt('Rename class', c.name) ?? '', 60);
      if (name) {
        c.name = name;
        // Keep saved modules in sync so their "created class" label follows the class.
        const mods = store.savedModules[id];
        if (mods) for (const m of mods) m.createdClass = name;
        store.saveClasses();
        store.saveSavedModules();
        render();
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
        store.saveClasses();
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
        store.saveClasses();
        render();
      }
    }));

  root.querySelectorAll<HTMLElement>('[data-moveall]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't toggle the <details> section
      const [id, i] = b.dataset.moveall!.split(':');
      teachAll(cls(id)!, +i);
      store.saveClasses();
      render();
      // Feedback highlight on the (re-created) button so the action is visible.
      const btn = root.querySelector<HTMLElement>(`[data-moveall="${id}:${i}"]`);
      if (btn) {
        btn.classList.add('flash');
        window.setTimeout(() => btn.classList.remove('flash'), 1500);
      }
    }));

  root.querySelectorAll<HTMLElement>('[data-teach]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, pi] = b.dataset.teach!.split(':');
      teachCall(cls(id)!, +i, +pi);
      store.saveClasses();
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-unteach]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, ti] = b.dataset.unteach!.split(':');
      unteachCall(cls(id)!, +i, +ti);
      store.saveClasses();
      render();
    }));
  // Move a call taught in a previous session into the current session's plan.
  root.querySelectorAll<HTMLElement>('[data-moveplanned]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, i, title, setupIdx] = b.dataset.moveplanned!.split('::');
      const c = cls(id);
      if (!c) return;
      const s = c.sessions[+i];
      if (!s) return;
      const si = +setupIdx;
      if (s.planned.some((p) => p.title === title && p.setupIdx === si)) return;
      const prev = c.sessions.slice(0, +i).flatMap((sess) => sess.taught).find((r) => r.title === title && r.setupIdx === si);
      const ref = prev ?? toRefOrNull(title) ?? { title, level: c.level, setupIdx: si, setup: '' };
      s.planned.push(ref);
      store.saveClasses();
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-act="pull"]').forEach((b) =>
    b.addEventListener('click', () => { pullForward(cls(b.dataset.id!)!, +b.dataset.i!, 1); store.saveClasses(); render(); }));
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
      store.saveClasses();
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
      const p = store.programmes[pi];

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
      store.classes.push(buildClassFromProgramme(id, name, p, students, toRefOrNull));
      store.saveClasses();
      navigate(`#/class/${id}`);
    }));

  root.querySelectorAll<HTMLElement>('[data-export]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = store.programmes[+b.dataset.export!];
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
      const p = store.programmes[+b.dataset.download!];
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
      const list = store.savedModules[id] ?? [];
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
    const avail = availableTitles(c, sIdx);
    if (avail.size < MIN_TAUGHT_CALLS) {
      setNotice(`Not enough taught calls to generate tips — teach at least ${MIN_TAUGHT_CALLS} calls first.`, true);
      render();
      return;
    }
    const done = () => {
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.textContent = 'Generate tips';
    };
    btn.disabled = true;
    btn.classList.add('busy');
    btn.innerHTML = '<span class="spinner"></span>Generating…';

    const calls = catalog.filter((x) => avail.has(x.title)).map((x) => ({ title: x.title, xml: x.xml }));
    const prioritised = new Set(c.sessions[sIdx].problems.map((p) => p.title));
    const familyMap: Record<string, string> = {};
    for (const x of catalog) familyMap[x.title] = x.family;


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
          config: store.tipConfig,
          current: currentSet,
          callProb: (t) => store.effectiveCallProb(id, t, currentSet, prioritised),
          family: (t) => familyMap[t] ?? '',
          onProgress: (attempts, made) => {
            btn.innerHTML = `<span class="spinner"></span>Searching ${attempts}/${totalAttempts} · ${made}/3 tips`;
            return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          },
        });

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
      store.tipConfig = {
        repeatProb: v('#cfgRepeat'),
        priorityProb: v('#cfgPriority'),
        currentProb: v('#cfgCurrent'),
        prevProb: v('#cfgPrev'),
      };
      store.saveTipConfig();
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
      const val = el.previousElementSibling as HTMLElement | null;
      if (val) val.textContent = `${el.value}%`;
    });
    el.addEventListener('change', () => {
      const [cid, title] = el.dataset.callprob!.split('::');
      (store.callProbs[cid] ??= {})[title] = clampNum(+el.value, 0, 100) / 100;
      store.saveCallProbs();
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
      const modules = (store.savedModules[id] ??= []);
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
      const defaultName = suggestModuleName(t.titles, familyOf) || `Saved tip ${modules.length + 1}`;
      const name = sanitizeText(window.prompt(`Name this module — suggested: "${defaultName}"`, defaultName) ?? '', 60) || defaultName;
      modules.push({
        name,
        titles: [...t.titles],
        createdAt: Date.now(),
        createdClass: c.name,
        createdSession: c.sessions[sIdx]?.name ?? '',
      });
      store.saveSavedModules();
      setNotice(`Saved "${name}" to modules.`);
      render();
    }));

  // View / hide a saved module's calls.
  root.querySelectorAll<HTMLElement>('[data-modview]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.modview!.split(':');
      const m = store.savedModules[id]?.[+mi];
      if (m) m.expanded = !m.expanded;
      store.saveSavedModules();
      render();
    }));

  // Rename a saved module.
  root.querySelectorAll<HTMLElement>('[data-renamemod]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.renamemod!.split(':');
      const m = store.savedModules[id]?.[+mi];
      if (!m) return;
      const name = window.prompt('Rename module', m.name);
      if (name != null) {
        m.name = sanitizeText(name) || m.name;
        store.saveSavedModules();
        render();
      }
    }));

  // Delete a saved module.
  root.querySelectorAll<HTMLElement>('[data-delmod]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, mi] = b.dataset.delmod!.split(':');
      const m = store.savedModules[id]?.[+mi];
      if (m && window.confirm(`Delete module "${m.name}"?`)) {
        store.savedModules[id].splice(+mi, 1);
        store.saveSavedModules();
        render();
      }
    }));
}

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
