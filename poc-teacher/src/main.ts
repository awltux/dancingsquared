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
  rollUntaughtForward,
  studentKnowledge,
  teachCall,
  unteachCall,
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
import { buildClassFromProgramme, defaultProgramme, parseProgramme, serializeProgramme } from './programme';
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

// ---------------------------------------------------------------- seed

const CURRICULUM = [
  'Circle Left',
  'Forward and Back',
  'Allemande Left',
  'Courtesy Turn',
  'Flutterwheel',
  'Ladies Chain',
  'Right and Left Thru',
  'Sides Face, Grand Square',
  'Sides Face, Grand Spin',
  'Heads Promenade 1/2',
  'Right and Left Grand',
  'Pass Thru',
  'Square Thru',
  'Swing Thru',
  'Grand Square',
].filter((t) => findCall(t));

const mkRefs = (arr: string[]) => arr.map(toRef);

function seedClasses(): ClassInstance[] {
  const mk = (
    id: string,
    name: string,
    level: string,
    students: string[],
    s1: string[],
    s2: string[],
    s3: string[],
    attendance: Record<string, boolean>[],
  ): ClassInstance => ({
    id,
    name,
    level,
    students: students.map((n, i) => ({ id: String(i + 1), name: n })),
    sessions: [
      { id: `${id}-s1`, name: 'Session 1', level, planned: mkRefs(s1), taught: [], attendance: attendance[0], problems: [{ title: s1[2], setupIdx: 0, priority: 3, note: 'hard from the sides' }] },
      { id: `${id}-s2`, name: 'Session 2', level, planned: mkRefs(s2), taught: [], attendance: attendance[1], problems: [] },
      { id: `${id}-s3`, name: 'Session 3', level, planned: mkRefs(s3), taught: [], attendance: attendance[2], problems: [] },
    ],
  });

  return [
    mk('c1', 'Beginner Mainstream', 'ms',
      ['Alice', 'Bob', 'Carol', 'David'],
      CURRICULUM.slice(0, 6), CURRICULUM.slice(6, 11), CURRICULUM.slice(11, 15),
      [{ 1: true, 2: true, 3: false, 4: true }, { 1: true, 2: false, 3: true, 4: true }, {}]),
    mk('c2', 'Tuesday Evening', 'plus',
      ['Ed', 'Fay', 'Gus', 'Hal'],
      CURRICULUM.slice(0, 6), CURRICULUM.slice(6, 11), CURRICULUM.slice(11, 15),
      [{ 1: true, 2: true, 3: true, 4: false }, { 1: false, 2: true, 3: true, 4: true }, {}]),
  ];
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
function effectiveCallProb(id: string, title: string, currentSet: Set<string>): number {
  const ov = callProbs[id]?.[title];
  if (ov != null) return ov;
  return currentSet.has(title) ? tipConfigGlobal.currentProb : tipConfigGlobal.prevProb;
}

// Programmes: the default course structures (built-in + imported).
let programmes: Programme[] = loadProgrammes();
let notice = '';

function loadProgrammes(): Programme[] {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Programme[];
      if (Array.isArray(p) && p.length) return p;
    }
  } catch {
    /* fall through to default */
  }
  return [defaultProgramme()];
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
const savedModules: Record<string, { name: string; titles: string[] }[]> = {};

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
  if (sessionKey && sessionKey !== lastSessionKey) notice = '';
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
    <div class="screen">${content}</div>
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
        <button class="card tap" data-nav="#/class/${c.id}">
          <div class="card-main">${esc(c.name)}</div>
          <div class="card-sub">${c.level.toUpperCase()} · ${c.students.length} students · ${c.sessions.length} sessions</div>
        </button>`).join('')}
      <button class="card tap primary-card" data-nav="#/new">
        <div class="card-main">＋ New course</div>
        <div class="card-sub">Pick a programme of sessions to start a new class</div>
      </button>
      <button class="card tap dashed" data-nav="#/programmes">
        <div class="card-main">⇅ Programmes</div>
        <div class="card-sub">Import / export the default course of sessions</div>
      </button>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
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
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${c.sessions.map((s, i) => `
        <div class="card session-card ${s.completed ? 'done' : ''}">
          <button class="session-main tap" data-nav="#/class/${id}/session/${i}">
            <div class="card-main">${esc(s.name)} ${s.completed ? '<span class="done-badge">✓</span>' : ''}</div>
            <div class="card-sub">Taught ${s.taught.length} of ${s.planned.length} calls</div>
            <div class="progress"><span style="width:${s.planned.length ? (s.taught.length / s.planned.length) * 100 : 0}%"></span></div>
          </button>
          <label class="complete-check"><input type="checkbox" data-completed="${id}:${i}" ${s.completed ? 'checked' : ''} /></label>
        </div>`).join('')}
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
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      <h2 class="section-title">Taught this session</h2>
      <div class="chips">${s.taught.length ? s.taught.map((r, ti) => sessionCallChip(r, `data-unteach="${id}:${i}:${ti}"`, '✓', id, i, s)).join('') : '<span class="muted">Nothing taught yet — tap a planned call below to teach it</span>'}</div>

      <h2 class="section-title">Planned</h2>
      <div class="chips">${s.planned.length ? s.planned.map((r, pi) => sessionCallChip(r, `data-teach="${id}:${i}:${pi}"`, '', id, i, s)).join('') : '<span class="muted">No plan</span>'}</div>
      <div class="row two" style="margin-top:12px">
        <button class="big" data-act="roll" data-id="${id}" data-i="${i}">Move plan → next</button>
        <button class="big" data-act="pull" data-id="${id}" data-i="${i}">Pull 1 from next</button>
      </div>
      <p class="hint">Tap a call under Planned to teach it (it moves up to Taught). Tap a taught call to move it back.</p>

      <h2 class="section-title">Taught in previous sessions</h2>
      ${renderPrevTaught(c, i)}

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
        <input id="addStudent" type="text" placeholder="New dancer's name" />
        <button class="big primary" data-addstudent data-id="${id}">Add</button>
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

// Per-call probability sliders, grouped by the session each call was taught in.
// Each call is shown in the same chip style as the session page (name + position
// + star to prioritise) with its probability slider underneath. Each slider
// starts at the effective probability (override or the global current/prev
// default from Tip settings).
function renderCallProbs(id: string, c: ClassInstance, sIdx: number, avail: Set<string>): string {
  const currentSet = new Set(c.sessions[sIdx].taught.map((r) => r.title));
  const seen = new Set<string>();
  let out = '';
  for (let si = 0; si <= sIdx; si++) {
    const s = c.sessions[si];
    const list = s.taught.filter((r) => avail.has(r.title) && !seen.has(r.title));
    for (const r of list) seen.add(r.title);
    if (!list.length) continue;
    out += `<h3>${esc(s.name)}</h3>`;
    out += list
      .map((r) => {
        const pct = Math.round(effectiveCallProb(id, r.title, currentSet) * 100);
        const on = s.problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
        return `<div class="callprob-item">
          <span class="chip wrap ${on ? 'warn' : ''}"><span class="chip-main">${callLabel(r)}</span><button class="star ${on ? 'on' : ''}" data-star="${id}::${si}::${r.title}::${r.setupIdx}" title="Prioritise this call">${on ? '★' : '☆'}</button></span>
          <div class="callprob-slider">
            <span class="cpval">${pct}%</span>
            <input type="range" class="callprob" data-callprob="${id}::${r.title}" min="0" max="100" step="5" value="${pct}" />
          </div>
        </div>`;
      })
      .join('');
  }
  return out || '<span class="muted">No taught calls to tune yet.</span>';
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

// Distinct calls taught in sessions before index `i`, as chips.
function renderPrevTaught(c: ClassInstance, i: number): string {
  if (i <= 0 || c.sessions.length === 0) {
    return '<span class="muted">No previous sessions yet</span>';
  }
  // Highlight using the CURRENT session's prioritised call-setups — the same
  // source as the planned list — so a prioritised call shows the same style here
  // as it does in Planned.
  const warnKeys = new Set((c.sessions[i]?.problems ?? []).map((p) => `${p.title}#${p.setupIdx}`));
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const sess of c.sessions.slice(0, i)) {
    for (const r of sess.taught) {
      if (seen.has(r.title)) continue;
      seen.add(r.title);
      chips.push(chip(r, warnKeys));
    }
  }
  return chips.length
    ? `<div class="chips">${chips.join('')}</div>`
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

      <h2 class="section-title">Call probabilities</h2>
      ${renderCallProbs(id, c, sIdx, avail)}

      ${tips.length ? tips.map((t, ti) => renderTip(id, t, ti, ts)).join('') : '<p class="hint">No tips yet — tap "Generate tips".</p>'}

      <h2 class="section-title">Saved modules</h2>
      <div class="chips">${savedModules[id]?.length ? savedModules[id].map((m) => `<span class="chip">${esc(m.name)}</span>`).join('') : '<span class="muted">None saved yet</span>'}</div>
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
        </div>
        <div class="row two">
          <input id="modName" type="text" placeholder="Module name" />
          <button class="big primary" data-savemod="${id}:${ti}">Save module</button>
        </div>` : '<p class="hint">Tap a call to see what can go before / after it.</p>'}
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
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
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
      const note = (root.querySelector('#probNote') as HTMLTextAreaElement).value;
      const pri = +(root.querySelector('#probPriority') as HTMLInputElement).value;
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

  root.querySelectorAll<HTMLElement>('[data-addstudent]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const input = root.querySelector('#addStudent') as HTMLInputElement;
      if (!input.value.trim()) {
        input.classList.add('invalid');
        return;
      }
      input.classList.remove('invalid');
      addStudent(cls(id)!, input.value);
      input.value = '';
      save();
      render();
    }));
  root.querySelectorAll<HTMLElement>('[data-rename]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, sid] = b.dataset.rename!.split(':');
      const c = cls(id)!;
      const st = c.students.find((s) => s.id === sid);
      const name = window.prompt('Rename dancer', st?.name ?? '');
      if (name != null) {
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

  root.querySelectorAll<HTMLElement>('[data-act="roll"]').forEach((b) =>
    b.addEventListener('click', () => { rollUntaughtForward(cls(b.dataset.id!)!, +b.dataset.i!); save(); render(); }));

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
      c.sessions[+i].completed = cb.checked;
      // On completion: move any planned calls forward, and carry taught
      // call-positions that were missed (as priorities) into the next session.
      let moved = 0;
      let carried = 0;
      if (cb.checked) {
        const res = completeSession(c, +i);
        moved = res.movedPlanned;
        carried = res.carried;
      }
      save();
      notice = cb.checked
        ? carried || moved
          ? `Session completed — ${moved} planned call(s) moved on, ${carried} missed/prioritised call(s) carried.`
          : 'Session completed.'
        : 'Session marked not complete.';
      render();
    }));

  root.querySelectorAll<HTMLElement>('[data-act="createcourse"]').forEach((b) =>
    b.addEventListener('click', () => {
      const nameEl = root.querySelector('#newName') as HTMLInputElement;
      const progEl = root.querySelector('#newProg') as HTMLSelectElement;
      const errName = root.querySelector('#err-name') as HTMLElement;
      const errProg = root.querySelector('#err-prog') as HTMLElement;

      const name = nameEl.value.trim();
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

      const students = (root.querySelector('#newStudents') as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean);
      const id = 'c' + Date.now().toString(36);
      classes.push(buildClassFromProgramme(id, name, p, students, toRefOrNull));
      save();
      navigate(`#/class/${id}`);
    }));

  root.querySelectorAll<HTMLElement>('[data-export]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = programmes[+b.dataset.export!];
      const text = serializeProgramme(p);
      const doCopy = () => { notice = `Copied "${p.name}" to clipboard.`; render(); };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(doCopy, () => { notice = 'Could not copy — see console.'; render(); });
      } else {
        notice = 'Clipboard unavailable on this device.';
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

  root.querySelectorAll<HTMLElement>('[data-import]').forEach((b) =>
    b.addEventListener('click', () => {
      const ta = root.querySelector('#importText') as HTMLTextAreaElement;
      const text = ta.value;
      if (!text.trim()) {
        ta.classList.add('invalid');
        notice = 'Nothing to import — paste a programme or choose a file first.';
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
        notice = 'No file was chosen.';
        render();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => importProgrammeText(String(reader.result ?? ''));
      reader.readAsText(f);
    }));

  root.querySelectorAll<HTMLElement>('[data-act="gentips"]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const c = cls(id)!;
      const sIdx = b.dataset.session != null ? Math.min(+b.dataset.session, c.sessions.length - 1) : c.sessions.length - 1;
      const avail = availableTitles(c, sIdx);
      // A Sequencer registered with ONLY the class's known calls, so generated
      // tips (and their getouts home) use only calls the class has been taught.
      const availSeq = makeSequencer(movesXml, formationsXml, catalog.filter((x) => avail.has(x.title)));
      const currentSet = new Set(c.sessions[sIdx].taught.map((r) => r.title));
      tipsByClass[id] = generateTips(availSeq, avail, priorityWeights(c, sIdx), {
        minLen: 3,
        maxLen: 5,
        count: 3,
        getoutMax: 5,
        config: tipConfigGlobal,
        current: currentSet,
        callProb: (t) => effectiveCallProb(id, t, currentSet),
      }).map((titles, i) => ({ name: `Tip ${i + 1}`, sourceSessionId: c.sessions[sIdx].id, titles }));
      tipsState[id] = { selectedTip: tipsByClass[id].length ? 0 : -1, selectedIdx: -1 };
      render();
    }));

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
      const v = (sel: string) => +(root.querySelector(sel) as HTMLInputElement).value / 100;
      tipConfigGlobal = {
        repeatProb: v('#cfgRepeat'),
        priorityProb: v('#cfgPriority'),
        currentProb: v('#cfgCurrent'),
        prevProb: v('#cfgPrev'),
      };
      saveTipConfig();
      notice = 'Tip settings saved.';
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
      (callProbs[cid] ??= {})[title] = +el.value / 100;
      saveCallProbs();
    });
  });

  root.querySelectorAll<HTMLElement>('[data-savemod]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, ti] = b.dataset.savemod!.split(':');
      const name = (root.querySelector('#modName') as HTMLInputElement).value.trim() || 'Practice tip';
      (savedModules[id] ??= []).push({ name, titles: [...tipsByClass[id][+ti].titles] });
      render();
    }));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function importProgrammeText(text: string): void {
  const p = parseProgramme(text);
  if (!p) {
    notice = 'That is not a valid programme. Export one first and paste its text.';
    render();
    return;
  }
  const existing = programmes.some((x) => x.name === p.name);
  if (existing) programmes = programmes.map((x) => (x.name === p.name ? p : x));
  else programmes.push(p);
  saveProgrammes();
  notice = `Imported "${p.name}" (${p.sessions.length} sessions). It is now a New course option.`;
  render();
}

render();
