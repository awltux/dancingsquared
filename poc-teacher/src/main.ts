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
} from './teacher';
import type { CallRef, ClassInstance, SessionPlan, Tip } from './teacher';

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
      { id: `${id}-s1`, name: 'Session 1', level, planned: mkRefs(s1), taught: mkRefs(s1.slice(0, Math.max(1, s1.length - 1))), attendance: attendance[0], problems: [{ title: s1[2], setupIdx: 0, priority: 3, note: 'hard from the sides' }] },
      { id: `${id}-s2`, name: 'Session 2', level, planned: mkRefs(s2), taught: mkRefs(s2), attendance: attendance[1], problems: [] },
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
let classes: ClassInstance[] = load();
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

function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
  else render();
}
window.addEventListener('hashchange', render);

interface Route {
  page: 'home' | 'class' | 'session' | 'students' | 'tips' | 'student';
  id?: string;
  i?: number;
  sid?: string;
}

function parseRoute(): Route {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'class' || parts.length < 2) return { page: 'home' };
  const id = parts[1];
  if (parts[2] === 'session' && parts[3] != null) return { page: 'session', id, i: +parts[3] };
  if (parts[2] === 'students') return { page: 'students', id };
  if (parts[2] === 'student' && parts[3] != null) return { page: 'student', id, sid: parts[3] };
  if (parts[2] === 'tips') return { page: 'tips', id };
  return { page: 'class', id };
}

// ---------------------------------------------------------------- render

function render(): void {
  const route = parseRoute();
  let content = '';
  let tab: 'home' | 'sessions' | 'students' | 'tips' = 'home';

  if (route.page === 'home') content = homePage();
  else if (route.page === 'class') { tab = 'sessions'; content = sessionsPage(route.id!); }
  else if (route.page === 'session') { tab = 'sessions'; content = sessionPage(route.id!, route.i!); }
  else if (route.page === 'students') { tab = 'students'; content = studentsPage(route.id!); }
  else if (route.page === 'student') { tab = 'students'; content = studentPage(route.id!, route.sid!); }
  else if (route.page === 'tips') { tab = 'tips'; content = tipsPage(route.id!); }

  const sub = route.page === 'session' || route.page === 'student';
  root.innerHTML = `
    <div class="screen">${content}</div>
    ${sub ? '' : bottomNav(route.page === 'home' ? null : route.id, tab)}
  `;
  wire();
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
      <button class="card tap dashed" data-nav="#/class/${classes[0].id}">
        <div class="card-main">＋ Start a new class</div>
        <div class="card-sub">Sample a new class for now</div>
      </button>
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
      ${c.sessions.map((s, i) => `
        <button class="card tap" data-nav="#/class/${id}/session/${i}">
          <div class="card-main">${esc(s.name)}</div>
          <div class="card-sub">Taught ${s.taught.length} of ${s.planned.length} calls</div>
          <div class="progress"><span style="width:${s.planned.length ? (s.taught.length / s.planned.length) * 100 : 0}%"></span></div>
        </button>`).join('')}
      <p class="hint">Tap a session to take the register and plan the practice.</p>
    </div>`;
}

function sessionPage(id: string, i: number): string {
  const c = cls(id);
  const s = session(id, i);
  if (!c || !s) return notFound();
  const probs = new Set(s.problems.map((p) => p.title));
  return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>${esc(s.name)}</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="row two">
        <button class="big" data-act="roll" data-id="${id}" data-i="${i}">Move untaught → next</button>
        <button class="big" data-act="pull" data-id="${id}" data-i="${i}">Pull 1 from next</button>
      </div>

      <h2 class="section-title">Taught this session</h2>
      <div class="chips">${s.taught.length ? s.taught.map((r) => chip(r, probs)).join('') : '<span class="muted">Nothing taught yet</span>'}</div>

      <h2 class="section-title">Planned</h2>
      <div class="chips">${s.planned.length ? s.planned.map((r) => chip(r)).join('') : '<span class="muted">No plan</span>'}</div>

      <h2 class="section-title">Who was here?</h2>
      <div class="attend">
        ${c.students.map((st) => `
          <button class="attender ${s.attendance[st.id] ? 'on' : ''}" data-att="${st.id}" data-id="${id}" data-i="${i}">
            <span class="tick">${s.attendance[st.id] ? '✓' : ''}</span>
            <span>${esc(st.name)}</span>
          </button>`).join('')}
      </div>
      <p class="hint">Tap a name to mark them present/absent. Absent dancers miss the taught calls.</p>

      <h2 class="section-title">Prioritised practice</h2>
      <div class="chips">${s.problems.length ? s.problems.map((p) => `<span class="chip warn">${esc(p.title)} · pri ${p.priority}</span>`).join('') : '<span class="muted">No problem call-setups yet</span>'}</div>

      <button class="big primary" data-nav="#/class/${id}/tips">Make practice tips →</button>
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
      ${c.students.map((st) => {
        const k = studentKnowledge(c, st.id);
        return `
        <button class="card tap" data-nav="#/class/${id}/student/${st.id}">
          <div class="card-main">${esc(st.name)}</div>
          <div class="card-sub">Knows ${k.known.length} call${k.known.length === 1 ? '' : 's'} ${k.missed.length ? `· missed ${k.missed.length}` : ''}</div>
        </button>`;
      }).join('')}
    </div>`;
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

function tipsPage(id: string): string {
  const c = cls(id);
  if (!c) return notFound();
  const sIdx = c.sessions.length - 1;
  const avail = availableTitles(c, sIdx);
  const pri = priorityWeights(c, sIdx);
  const tips = tipsByClass[id] ?? [];
  const ts = tipsState[id] ?? { selectedTip: -1, selectedIdx: -1 };
  return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>Practice tips</h1><p class="sub">${esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="card">
        <div class="card-main">Auto-make 3 tips</div>
        <div class="card-sub">Uses only calls taught so far, prioritising the highlighted ones.</div>
        <button class="big primary" data-act="gentips" data-id="${id}">Generate tips</button>
      </div>
      ${pri.size ? `<div class="row two"><span class="muted">Prioritised:</span> ${[...pri.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => `<span class="chip warn">${esc(n)}</span>`).join('')}</div>` : ''}

      ${tips.length ? tips.map((t, ti) => renderTip(id, t, ti, ts)).join('') : '<p class="hint">No tips yet — tap "Generate tips".</p>'}

      <h2 class="section-title">Saved modules</h2>
      <div class="chips">${savedModules[id]?.length ? savedModules[id].map((m) => `<span class="chip">${esc(m.name)}</span>`).join('') : '<span class="muted">None saved yet</span>'}</div>
    </div>`;
}

function renderTip(id: string, t: Tip, ti: number, ts: { selectedTip: number; selectedIdx: number }): string {
  const selected = ts.selectedTip === ti;
  const selCall = selected ? t.titles[ts.selectedIdx] : null;
  const fits = selected && selCall != null ? fitsAround(seq, availableTitles(cls(id)!, 0), t.titles, ts.selectedIdx) : null;
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

function chip(r: CallRef, warn = new Set<string>()): string {
  const w = warn.has(r.title);
  return `<span class="chip ${w ? 'warn' : ''}">${esc(r.title)}${r.setup ? ` <span class="dim">(${esc(r.setup)})</span>` : ''}</span>`;
}

function notFound(): string {
  return `<div class="content"><h2>Class not found</h2><button class="big" data-nav="#/">Home</button></div>`;
}

function bottomNav(classId: string | null | undefined, active: 'home' | 'sessions' | 'students' | 'tips'): string {
  const item = (label: string, key: string, href: string) =>
    `<a href="${href}" class="nav-item ${active === key ? 'active' : ''}"><span class="nav-ico">${ico(key)}</span><span>${label}</span></a>`;
  const base = classId ? `#/class/${classId}` : '#/';
  return `<nav class="bottombar">
    ${item('Home', 'home', '#/')}
    ${item('Sessions', 'sessions', base)}
    ${item('Students', 'students', classId ? `${base}/students` : '#/')}
    ${item('Tips', 'tips', classId ? `${base}/tips` : '#/')}
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

  root.querySelectorAll<HTMLElement>('[data-act="roll"]').forEach((b) =>
    b.addEventListener('click', () => { rollUntaughtForward(cls(b.dataset.id!)!, +b.dataset.i!); save(); render(); }));
  root.querySelectorAll<HTMLElement>('[data-act="pull"]').forEach((b) =>
    b.addEventListener('click', () => { pullForward(cls(b.dataset.id!)!, +b.dataset.i!, 1); save(); render(); }));

  root.querySelectorAll<HTMLElement>('[data-act="gentips"]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const c = cls(id)!;
      const sIdx = c.sessions.length - 1;
      tipsByClass[id] = generateTips(seq, availableTitles(c, sIdx), priorityWeights(c, sIdx), { minLen: 3, maxLen: 6, count: 3 })
        .map((titles, i) => ({ name: `Tip ${i + 1}`, sourceSessionId: c.sessions[sIdx].id, titles }));
      tipsState[id] = { selectedTip: tipsByClass[id].length ? 0 : -1, selectedIdx: -1 };
      render();
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

render();
