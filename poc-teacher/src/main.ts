// Teachers Session Tracker — PoC UI (PRD item 15).
// Loads the Mainstream catalog (from the sibling poc's assets), seeds a class
// with sessions/students, and lets the teacher plan sessions, track attendance
// and problem call-setups, and auto-generate / edit practice tips as modules.

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

// ---------------------------------------------------------------- seed class

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

const studentNames = ['Alice', 'Bob', 'Carol', 'David'];
function seedClass(): ClassInstance {
  const mkRefs = (arr: string[]) => arr.map(toRef);
  const s1 = CURRICULUM.slice(0, 6);
  const s2 = CURRICULUM.slice(6, 11);
  const s3 = CURRICULUM.slice(11, 15);
  const cls: ClassInstance = {
    id: 'c1',
    name: 'Beginner Mainstream',
    level: 'ms',
    students: studentNames.map((name, i) => ({ id: String(i + 1), name })),
    sessions: [
      {
        id: 's1', name: 'Session 1', level: 'ms',
        planned: mkRefs(s1), taught: mkRefs(s1.slice(0, 5)),
        attendance: { '1': true, '2': true, '3': false, '4': true },
        problems: [{ title: s1[2], setupIdx: 0, priority: 3, note: 'sides struggle' }],
      },
      {
        id: 's2', name: 'Session 2', level: 'ms',
        planned: mkRefs(s2), taught: mkRefs(s2),
        attendance: { '1': true, '2': false, '3': true, '4': true },
        problems: [],
      },
      {
        id: 's3', name: 'Session 3', level: 'ms',
        planned: mkRefs(s3), taught: [],
        attendance: {}, problems: [],
      },
    ],
  };
  return cls;
}

// ---------------------------------------------------------------- state

let cls: ClassInstance = seedClass();
let selectedSession = 0;
let tips: Tip[] = [];
let selectedTip = -1;
let selectedIdx = -1;
const savedModules: { name: string; titles: string[]; sessionId: string }[] = [];

const main = document.getElementById('main') as HTMLElement;
const session = (): SessionPlan => cls.sessions[selectedSession];
const available = (): Set<string> => availableTitles(cls, selectedSession);
const priority = (): Map<string, number> => priorityWeights(cls, selectedSession);

// ---------------------------------------------------------------- rendering

function render(): void {
  main.innerHTML = `
    <div class="layout">
      <div>
        <div class="panel">
          <h2>Class</h2>
          <div class="row"><b>${escapeHtml(cls.name)}</b><span class="muted">${cls.level.toUpperCase()}</span></div>
          <div class="muted">${cls.students.length} students</div>
        </div>
        <div class="panel">
          <h2>Sessions</h2>
          ${cls.sessions.map((s, i) => `
            <div class="session ${i === selectedSession ? 'active' : ''}" data-sel="${i}">
              <div class="name">${escapeHtml(s.name)}</div>
              <div class="meta">taught ${s.taught.length}/${s.planned.length} · ${Object.keys(s.attendance).length} marked</div>
            </div>`).join('')}
        </div>
        <div class="panel">
          <h2>Students — knowledge</h2>
          ${renderKnowledge()}
        </div>
      </div>
      <div>
        ${renderSession()}
        ${renderTips()}
      </div>
    </div>`;
  wire();
}

function renderKnowledge(): string {
  return cls.students.map((st) => {
    const k = studentKnowledge(cls, st.id);
    const missed = k.missed.length ? `<span class="tag prio">missed ${k.missed.length}</span>` : '';
    return `<div class="row"><b style="width:70px">${escapeHtml(st.name)}</b>
      <span class="muted">knows ${k.known.length} · </span>${missed}
      <span class="muted">${k.missed.slice(0, 3).join(', ')}${k.missed.length > 3 ? '…' : ''}</span></div>`;
  }).join('');
}

function renderSession(): string {
  const s = session();
  const probs = new Set(s.problems.map((p) => p.title));
  return `
    <div class="panel">
      <h2>${escapeHtml(s.name)}</h2>
      <div class="row">
        <button class="primary" data-act="roll">Roll untaught → next session</button>
        <button data-act="pull">Pull 1 from next session</button>
      </div>
      <h3>Planned (${s.planned.length})</h3>
      <div>${s.planned.map((r) => callChip(r, probs)).join('')}</div>
      <h3>Taught (${s.taught.length})</h3>
      <div>${s.taught.length ? s.taught.map((r) => callChip(r, probs)).join('') : '<span class="muted">none yet</span>'}</div>
      <h3>Attendance</h3>
      <div class="att">
        ${cls.students.map((st) => `
          <label><input type="checkbox" data-att="${st.id}" ${s.attendance[st.id] ? 'checked' : ''} /> ${escapeHtml(st.name)}</label>`).join('')}
      </div>
      <h3>Prioritised call-setups</h3>
      <div>${s.problems.length ? s.problems.map((p) => `${escapeHtml(p.title)} <span class="tag prio">pri ${p.priority}</span>`).join(', ') : '<span class="muted">none</span>'}</div>
    </div>`;
}

function callChip(r: CallRef, probs: Set<string>): string {
  return `<span class="call ${probs.has(r.title) ? 'problem' : ''}">${escapeHtml(r.title)} <span class="muted">(${escapeHtml(r.setup)})</span></span>`;
}

function renderTips(): string {
  const s = session();
  const avail = available();
  const pri = priority();
  return `
    <div class="panel">
      <h2>Practice tips</h2>
      <div class="row">
        <span class="muted">available calls: ${avail.size} · prioritised:</span>
        ${[...pri.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => `<span class="call problem">${escapeHtml(n)}</span>`).join('')}
      </div>
      <div class="row">
        <button class="primary" data-act="gentips">Auto-generate 3 tips</button>
        <button data-act="cleartips">Clear</button>
      </div>
      ${tips.map((t, ti) => renderTip(t, ti)).join('')}
      <h3>Saved modules</h3>
      <div class="muted">${savedModules.length ? savedModules.map((m) => `<b>${escapeHtml(m.name)}:</b> ${m.titles.join(' · ')}`).join('<br>') : 'none yet — select a call in a tip to edit, then Save module.'}</div>
    </div>`;
}

function renderTip(t: Tip, ti: number): string {
  const selCall = ti === selectedTip ? t.titles[selectedIdx] : null;
  const fits = selectedIdx >= 0 && selCall ? fitsAround(seq, available(), t.titles, selectedIdx) : null;
  return `
    <div class="tip">
      <div class="tipname">Tip ${ti + 1} · ${t.titles.length} calls ${t.sourceSessionId ? `· from ${escapeHtml(t.sourceSessionId)}` : ''}
        <button class="danger" data-rmtip="${ti}" style="float:right">✕</button></div>
      <div>${t.titles.map((c, ci) => `
        <span class="call ${ci === selectedIdx && ti === selectedTip ? 'sel' : ''}" data-selcall="${ti}:${ci}">${escapeHtml(c)}</span>`).join('')}</div>
      ${fits ? `
        <div class="fits" style="margin-top:6px">
          <div><b>before / replace</b>: ${fits.before.map((c) => `<button data-before="${c}">${escapeHtml(c)}</button>`).join(' ') || '—'}</div>
          <div><b>after</b>: ${fits.after.map((c) => `<button data-after="${c}">${escapeHtml(c)}</button>`).join(' ') || '—'}</div>
        </div>
        <div class="row" style="margin-top:6px">
          <input id="modName" type="text" placeholder="Module name" />
          <button class="primary" data-savemod="${ti}">Save module</button>
        </div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- events

function wire(): void {
  main.querySelectorAll<HTMLElement>('[data-sel]').forEach((el) =>
    el.addEventListener('click', () => { selectedSession = +el.dataset.sel!; selectedIdx = -1; tips = []; render(); }));

  main.querySelectorAll('[data-att]').forEach((cb) =>
    cb.addEventListener('change', (e) => {
      session().attendance[(e.target as HTMLInputElement).dataset.att!] = (e.target as HTMLInputElement).checked;
      render();
    }));

  const act = (fn: () => void) => () => { fn(); selectedIdx = -1; render(); };
  main.querySelector('[data-act="roll"]')?.addEventListener('click', act(() => rollUntaughtForward(cls, selectedSession)));
  main.querySelector('[data-act="pull"]')?.addEventListener('click', act(() => pullForward(cls, selectedSession, 1)));
  main.querySelector('[data-act="gentips"]')?.addEventListener('click', () => {
    tips = generateTips(seq, available(), priority(), { minLen: 3, maxLen: 6, count: 3 }).map((titles, i) => ({
      name: `Tip ${i + 1}`, sourceSessionId: session().id, titles,
    }));
    selectedTip = tips.length ? 0 : -1;
    selectedIdx = -1;
    render();
  });
  main.querySelector('[data-act="cleartips"]')?.addEventListener('click', () => { tips = []; selectedTip = -1; selectedIdx = -1; render(); });

  main.querySelectorAll('[data-rmtip]').forEach((b) =>
    b.addEventListener('click', () => { tips.splice(+b.getAttribute('data-rmtip')!, 1); selectedTip = -1; selectedIdx = -1; render(); }));

  main.querySelectorAll('[data-selcall]').forEach((b) =>
    b.addEventListener('click', () => {
      const [ti, ci] = b.getAttribute('data-selcall')!.split(':').map(Number);
      selectedTip = ti;
      selectedIdx = ci;
      render();
    }));

  main.querySelectorAll('[data-before]').forEach((b) =>
    b.addEventListener('click', () => {
      const title = b.getAttribute('data-before')!;
      tips[selectedTip].titles = insertInto(tips[selectedTip].titles, selectedIdx, title);
      render();
    }));
  main.querySelectorAll('[data-after]').forEach((b) =>
    b.addEventListener('click', () => {
      const title = b.getAttribute('data-after')!;
      tips[selectedTip].titles = insertInto(tips[selectedTip].titles, selectedIdx + 1, title);
      render();
    }));

  main.querySelectorAll('[data-savemod]').forEach((b) =>
    b.addEventListener('click', () => {
      const name = (main.querySelector('#modName') as HTMLInputElement).value.trim() || 'Unnamed tip';
      savedModules.push({ name, titles: [...tips[+b.getAttribute('data-savemod')!].titles], sessionId: session().id });
      render();
    }));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

render();
