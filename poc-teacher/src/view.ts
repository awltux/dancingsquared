// View: renders the app's pages as HTML strings. Given the store and a small set
// of dependencies (catalog helpers, current transient UI state), each method
// returns the markup for one page or a reusable fragment. It performs no DOM
// mutation and binds no events — that is the controller's job.

import type { Sequencer } from 'dancing-squared-engine';
import type { TeacherStore } from './store';
import { availableTitles, fitsAround, studentKnowledge } from './teacher';
import type { CallRef, ClassInstance, SessionPlan, Tip } from './teacher';
import type { SavedModule } from './store';

/** State for the "prioritise a call" modal (null = closed). */
export interface ProbModal {
  id: string;
  i: number;
  title: string;
  setupIdx: number;
  existing?: { priority: number; note?: string };
  archivedNote?: string; // note kept from a previous prioritisation, for re-prioritising
}

export interface ViewDeps {
  store: TeacherStore;
  seq: Sequencer;
  esc: (s: string) => string;
  familyOf: (title: string) => string;
  cls: (id: string) => ClassInstance | undefined;
  session: (id: string, i: number) => SessionPlan | undefined;
  notice: () => string;
  noticeWarn: () => boolean;
  tipsByClass: () => Record<string, Tip[]>;
  tipsState: () => Record<string, { selectedTip: number; selectedIdx: number }>;
}

export class View {
  constructor(private readonly d: ViewDeps) {}

  renderModal(m: ProbModal): string {
    const p = m.existing?.priority ?? 3;
    const note = m.existing?.note ?? m.archivedNote ?? '';
    return `
    <div class="overlay" data-closeprob>
      <div class="modal">
        <h2>Prioritise</h2>
        <p class="modal-call">${this.callLabel({ title: m.title, level: '', setupIdx: m.setupIdx, setup: '' })}</p>
        <label class="field">Notes
          <textarea id="probNote" rows="3" aria-label="Problem note" placeholder="What do they struggle with?">${this.d.esc(note)}</textarea>
        </label>
        <label class="field">Priority
          <input id="probPriority" type="range" min="1" max="5" step="1" value="${p}" />
          <span class="row"><span class="muted">1 = low, 5 = high</span><b id="probPriorityVal">${p}</b></span>
        </label>
        <div class="row two">
          <button class="big primary" data-probsave>Save</button>
          <button class="big" data-probcancel>Cancel</button>
        </div>
        ${m.existing ? `<button class="big danger" data-probremove style="margin-top:12px">Remove prioritisation</button>` : ''}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- pages

  homePage(): string {
    return `
    <header class="appbar">
      <h1>SQD Teacher</h1>
      <p class="sub">Square dance class planner</p>
    </header>
    <div class="content">
      <h2 class="section-title">Your classes</h2>
      ${this.d.store.classes.map((c) => `
        <div class="card session-card">
          <button class="session-main tap" data-nav="#/class/${c.id}">
            <div class="card-main">${this.d.esc(c.name)}</div>
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
      <button class="card tap dashed" data-tour>
        <div class="card-main">❔ Replay the tour</div>
        <div class="card-sub">See a quick guide to the app</div>
      </button>
      ${this.d.notice() ? `<p class="notice${this.d.noticeWarn() ? ' warn' : ''}">${this.d.esc(this.d.notice())}</p>` : ''}
      <p class="hint">Tap a class to open its sessions.</p>
    </div>`;
  }

  sessionsPage(id: string): string {
    const c = this.d.cls(id);
    if (!c) return this.notFound();
    return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>${this.d.esc(c.name)}</h1><p class="sub">${c.level.toUpperCase()}</p></div>
      <button class="icon-btn" data-renameclass="${id}" title="Rename class">✎</button>
    </header>
    <div class="content">
      ${this.d.notice() ? `<p class="notice${this.d.noticeWarn() ? ' warn' : ''}">${this.d.esc(this.d.notice())}</p>` : ''}
      ${c.sessions.map((s, i) => {
        const taughtN = s.capturedTaught?.length ?? s.taught.length;
        const totalN = taughtN + (s.capturedPlanned?.length ?? s.planned.length);
        const pct = totalN ? Math.round((taughtN / totalN) * 100) : 0;
        return `
        <div class="card session-card ${s.completed ? 'done' : ''}">
          <button class="session-main tap" data-nav="#/class/${id}/session/${i}">
            <div class="card-main">${this.d.esc(s.name)} ${s.completed ? '<span class="done-badge">✓</span>' : ''}</div>
            <div class="card-sub">Taught ${taughtN} of ${totalN} calls</div>
            <div class="progress"><span style="width:${pct}%"></span></div>
          </button>
          <label class="complete-check"><input type="checkbox" data-completed="${id}:${i}" ${s.completed ? 'checked' : ''} /></label>
        </div>`;
      }).join('')}
      <p class="hint">Tap a session to take the register and plan the practice.</p>
    </div>`;
  }

  sessionPage(id: string, i: number): string {
    const c = this.d.cls(id);
    const s = this.d.session(id, i);
    if (!c || !s) return this.notFound();
    return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>${this.d.esc(s.name)}</h1><p class="sub">${this.d.esc(c.name)}</p></div>
    </header>
    <div class="content">
      ${this.d.notice() ? `<p class="notice${this.d.noticeWarn() ? ' warn' : ''}">${this.d.esc(this.d.notice())}</p>` : ''}
      ${s.capturedAt ? `<p class="muted">Completed — captured taught ${s.capturedTaught?.length ?? 0} of ${(s.capturedTaught?.length ?? 0) + (s.capturedPlanned?.length ?? 0)} calls (taught + planned) at the time of completion.</p>` : ''}
      <details class="collapsible" data-dkey="s:${id}:${i}:taught"${this.d.store.detailsOpenAttr(`s:${id}:${i}:taught`, true)}>
        <summary>Taught this session</summary>
        ${s.taught.length ? this.renderGrouped(s.taught, (r, ti) => this.sessionCallChip(r, `data-unteach="${id}:${i}:${ti}"`, '✓', id, i, s), `s:${id}:${i}:taught`) : '<span class="muted">Nothing taught yet — tap a planned call below to teach it</span>'}
      </details>

      <details class="collapsible" data-dkey="s:${id}:${i}:planned"${this.d.store.detailsOpenAttr(`s:${id}:${i}:planned`, true)}>
        <summary>Planned <button class="small-btn" data-moveall="${id}:${i}">Move all → taught</button></summary>
        ${s.planned.length ? this.renderGrouped(s.planned, (r, pi) => this.sessionCallChip(r, `data-teach="${id}:${i}:${pi}"`, '', id, i, s), `s:${id}:${i}:planned`) : '<span class="muted">No plan</span>'}
        <button class="big" data-act="pull" data-id="${id}" data-i="${i}" style="margin-top:12px">Pull 1 from next</button>
        <p class="hint">Tap a call under Planned to teach it (it moves up to Taught). Tap a taught call to move it back.</p>
      </details>

      <details class="collapsible" data-dkey="s:${id}:${i}:prev"${this.d.store.detailsOpenAttr(`s:${id}:${i}:prev`, false)}>
        <summary>Taught in previous sessions</summary>
        ${this.renderPrevTaught(c, i)}
      </details>

      <h2 class="section-title">Who was here?</h2>
      <div class="attend">
        ${c.students.map((st) => `
          <button class="attender ${s.attendance[st.id] ? 'on' : ''}" data-att="${st.id}" data-id="${id}" data-i="${i}">
            <span class="tick">${s.attendance[st.id] ? '✓' : ''}</span>
            <span>${this.d.esc(st.name)}</span>
          </button>`).join('')}
      </div>
      <p class="hint">Tap a name to mark them present/absent. Absent dancers miss the taught calls.</p>

      <button class="big primary" data-nav="#/class/${id}/tips/${i}">Make practice tips →</button>

      <details class="collapsible" style="margin-top:16px" data-dkey="s:${id}:${i}:mods"${this.d.store.detailsOpenAttr(`s:${id}:${i}:mods`, false)}>
        <summary>Saved modules</summary>
        ${this.d.store.savedModules[id]?.length ? this.d.store.savedModules[id].map((m, mi) => this.renderModule(id, m, mi)).join('') : '<p class="hint">No saved modules yet — save a tip from the Practice tips page.</p>'}
        <div class="row two" style="margin-top:10px">
          <button class="big" data-modexport="${id}">Export</button>
          <button class="big" data-modimporttoggle="${id}">Import</button>
        </div>
        <span class="mod-export-msg" data-modexportmsg="${id}"></span>
        <div id="modImportBox" hidden style="margin-top:10px">
          <textarea id="modImportText" rows="3" aria-label="Module JSON" placeholder="Paste exported module JSON here…"></textarea>
          <div class="row two" style="margin-top:8px">
            <label class="big filebtn">Choose file<input type="file" id="modImportFile" data-modid="${id}" accept=".json,application/json" hidden /></label>
            <button class="big primary" data-modimport="${id}">Import</button>
          </div>
        </div>
      </details>
    </div>`;
  }

  studentsPage(id: string): string {
    const c = this.d.cls(id);
    if (!c) return this.notFound();
    return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}">‹</button>
      <div><h1>Students</h1><p class="sub">${this.d.esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="row two addstudent-row">
        <input id="addStudent" type="text" aria-label="New dancer's name" placeholder="New dancer's name" data-id="${id}" />
        <button class="big primary" type="button" data-addstudent data-id="${id}">Add</button>
      </div>
      ${c.students.length ? c.students.map((st) => {
        const k = studentKnowledge(c, st.id);
        return `
        <div class="card">
          <button class="card-main tap" data-nav="#/class/${id}/student/${st.id}" style="width:100%;text-align:left;background:none;border:none;padding:0;min-height:auto">${this.d.esc(st.name)}</button>
          <div class="card-sub">Knows ${k.known.length} call${k.known.length === 1 ? '' : 's'} ${k.missed.length ? `· missed ${k.missed.length}` : ''}</div>
          <div class="card-sub">Completed: ${this.renderStudentAttendance(c, st.id)}</div>
          <div class="row two" style="margin-top:10px">
            <button class="big" data-rename="${id}:${st.id}">Rename</button>
            <button class="big danger" data-remove="${id}:${st.id}">Remove</button>
          </div>
        </div>`;
      }).join('') : '<p class="hint">No dancers yet — add the first one above.</p>'}
    </div>`;
  }

  studentPage(id: string, sid: string): string {
    const c = this.d.cls(id);
    const st = c?.students.find((s) => s.id === sid);
    if (!c || !st) return this.notFound();
    const k = studentKnowledge(c, sid);
    return `
    <header class="appbar">
      <button class="back" data-nav="#/class/${id}/students">‹</button>
      <div><h1>${this.d.esc(st.name)}</h1><p class="sub">${this.d.esc(c.name)}</p></div>
    </header>
    <div class="content">
      <h2 class="section-title">Knows (${k.known.length})</h2>
      <div class="chips">${k.known.length ? k.known.map((t) => this.chip({ title: t, level: '', setupIdx: 0, setup: '' })).join('') : '<span class="muted">No calls yet</span>'}</div>
      ${k.missed.length ? `
        <h2 class="section-title">Missed — needs re-teaching</h2>
        <div class="chips">${k.missed.map((t) => this.chip({ title: t, level: '', setupIdx: 0, setup: '' }, new Set(k.missed))).join('')}</div>
        <p class="hint">These were taught on a session ${this.d.esc(st.name)} was absent from.</p>` : ''}
    </div>`;
  }

  tipsPage(id: string, fromSession?: number): string {
    const c = this.d.cls(id);
    if (!c) return this.notFound();
    const sIdx = fromSession != null ? Math.min(fromSession, c.sessions.length - 1) : c.sessions.length - 1;
    const avail = availableTitles(c, sIdx);
    const tips = this.d.tipsByClass()[id] ?? [];
    const ts = this.d.tipsState()[id] ?? { selectedTip: -1, selectedIdx: -1 };
    const back = fromSession != null ? `#/class/${id}/session/${fromSession}` : `#/class/${id}`;
    return `
    <header class="appbar">
      <button class="back" data-nav="${back}">‹</button>
      <div><h1>Practice tips</h1><p class="sub">${this.d.esc(c.name)}</p></div>
    </header>
    <div class="content">
      <div class="card">
        <div class="card-main">Auto-make 3 tips</div>
        <div class="card-sub">Each tip starts and finishes in the squared set, uses only calls taught so far, and prioritises the highlighted ones.</div>
        <button class="big primary" data-act="gentips" data-id="${id}" data-session="${sIdx}">Generate tips</button>
      </div>

      <details class="collapsible">
        <summary>Call probabilities</summary>
        ${this.renderCallProbs(id, c, sIdx, avail)}
      </details>

      ${tips.length ? tips.map((t, ti) => this.renderTip(id, t, ti, ts)).join('') : '<p class="hint">No tips yet — tap "Generate tips".</p>'}

      <h2 class="section-title">Saved modules</h2>
      ${(this.d.store.savedModules[id]?.length ? this.d.store.savedModules[id].map((m, mi) => this.renderModule(id, m, mi)).join('') : '<p class="hint">None saved yet — tap "Save tip" on a generated tip to keep it.</p>')}
    </div>`;
  }

  tipSettingsPage(): string {
    const cfg = this.d.store.tipConfig;
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

  newCoursePage(): string {
    return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>New course</h1><p class="sub">Start from a programme</p></div>
    </header>
    <div class="content">
      <label class="field">Course name <span class="req">*</span>
        <input id="newName" type="text" aria-label="Course name" placeholder="e.g. Monday Beginners" />
        <span class="err" id="err-name"></span>
      </label>
      <label class="field">Programme (sessions &amp; calls)
        <select id="newProg">
          ${this.d.store.programmes.length ? this.d.store.programmes.map((p, i) => `<option value="${i}">${this.d.esc(p.name)} · ${p.level.toUpperCase()} · ${p.sessions.length} sessions</option>`).join('') : '<option value="-1">No programmes — add one first</option>'}
        </select>
        <span class="err" id="err-prog"></span>
      </label>
      <label class="field">Students (comma separated, optional)
        <input id="newStudents" type="text" aria-label="Student names" placeholder="e.g. Alice, Bob, Carol" />
      </label>
      <button class="big primary" data-act="createcourse">Create course</button>
      <p class="hint">The course starts with each session's planned calls from the programme. Nothing is taught yet.</p>
    </div>`;
  }

  programmesPage(): string {
    return `
    <header class="appbar">
      <button class="back" data-nav="#/">‹</button>
      <div><h1>Programmes</h1><p class="sub">Import / export the default course</p></div>
    </header>
    <div class="content">
      <h2 class="section-title">Your programmes</h2>
      ${this.d.store.programmes.map((p, i) => `
        <div class="card">
          <div class="card-main">${this.d.esc(p.name)}</div>
          <div class="card-sub">${p.level.toUpperCase()} · ${p.sessions.length} sessions</div>
          <div class="row two" style="margin-top:10px">
            <button class="big" data-export="${i}">Copy</button>
            <button class="big" data-download="${i}">Download</button>
          </div>
        </div>`).join('')}
      <h2 class="section-title">Import a programme</h2>
      <textarea id="importText" rows="5" aria-label="Programme JSON" placeholder="Paste a programme JSON here…"></textarea>
      <div class="row two" style="margin-top:8px">
        <label class="big filebtn">Choose file<input type="file" id="importFile" accept=".json,application/json" hidden /></label>
        <button class="big primary" data-import="text">Import</button>
      </div>
      ${this.d.notice() ? `<p class="notice${this.d.noticeWarn() ? ' warn' : ''}">${this.d.esc(this.d.notice())}</p>` : ''}
      <p class="hint">A programme is a list of sessions, each with the calls assigned to it. Export one to share it, then import it on another device.</p>
    </div>`;
  }

  // ---------------------------------------------------------------- fragments

  renderCallProbs(id: string, c: ClassInstance, sIdx: number, avail: Set<string>): string {
    const currentSet = new Set(c.sessions[sIdx].taught.map((r) => r.title));
    const prioritised = new Set(c.sessions[sIdx].problems.map((p) => p.title));
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
      const pct = Math.round(this.d.store.effectiveCallProb(id, r.title, currentSet, prioritised) * 100);
      const si = c.sessions.findIndex((s) => s.taught.some((t) => t.title === r.title && t.setupIdx === r.setupIdx));
      const on = si >= 0 && c.sessions[si].problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
      return `<div class="callprob-item">
      <span class="chip wrap ${on ? 'warn' : ''}"><span class="chip-main">${this.callLabel(r)}</span><button class="star ${on ? 'on' : ''}" data-star="${id}::${si}::${r.title}::${r.setupIdx}" title="Prioritise this call">${on ? '★' : '☆'}</button></span>
      <div class="callprob-slider">
        <span class="cpval">${pct}%</span>
        <input type="range" class="callprob" data-callprob="${id}::${r.title}" min="0" max="100" step="5" value="${pct}" />
      </div>
    </div>`;
    };

    const groups = new Map<string, CallRef[]>();
    for (const r of refs) {
      const fam = this.d.familyOf(r.title);
      const arr = groups.get(fam) ?? [];
      arr.push(r);
      groups.set(fam, arr);
    }
    let out = '';
    for (const [fam, list] of groups) {
      out += `<h3 class="family-head">${this.d.esc(fam)}</h3>${list.map(item).join('')}`;
    }
    return out;
  }

  renderStudentAttendance(c: ClassInstance, studentId: string): string {
    const done = c.sessions.map((s, i) => ({ i, s })).filter((x) => x.s.completed);
    if (!done.length) return '<span class="muted">no completed sessions</span>';
    return done
      .map(({ i, s }) => {
        const present = !!s.attendance[studentId];
        return `<span class="chip ${present ? 'present' : 'missed'}">S${i + 1} ${present ? '✓' : '✗'}</span>`;
      })
      .join('');
  }

  /** Group `calls` by family and render each group under a collapsible family
   * header (minimised by default). `prefix` scopes the persisted open/closed
   * state so the same family in different sections (e.g. planned vs taught)
   * keeps independent collapse state, and stays minimised when calls move
   * between sections. */
  renderGrouped(calls: CallRef[], render: (r: CallRef, index: number) => string, prefix = 'group'): string {
    const groups = new Map<string, { r: CallRef; idx: number }[]>();
    calls.forEach((r, idx) => {
      const fam = this.d.familyOf(r.title);
      const arr = groups.get(fam) ?? [];
      arr.push({ r, idx });
      groups.set(fam, arr);
    });
    let out = '';
    for (const [fam, list] of groups) {
      const key = `${prefix}:${fam}`;
      const open = this.d.store.detailsOpenAttr(key, false);
      out += `<details class="collapsible family-group" data-dkey="${key}"${open}>`
        + `<summary>${this.d.esc(fam)} · ${list.length}</summary>`
        + `<div class="chips">${list.map(({ r, idx }) => render(r, idx)).join('')}</div>`
        + `</details>`;
    }
    return out;
  }

  renderPrevTaught(c: ClassInstance, i: number): string {
    if (i <= 0 || c.sessions.length === 0) {
      return '<span class="muted">No previous sessions yet</span>';
    }
    const s = c.sessions[i];
    const seen = new Set<string>();
    const unique: CallRef[] = [];
    for (const sess of c.sessions.slice(0, i)) {
      for (const r of sess.taught) {
        const key = `${r.title}#${r.setupIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
      }
    }
    return unique.length
      ? this.renderGrouped(unique, (r) =>
          this.sessionCallChip(r, `data-moveplanned="${c.id}::${i}::${r.title}::${r.setupIdx}"`, '+', c.id, i, s), `s:${c.id}:${i}:prev`)
      : '<span class="muted">Nothing was taught in previous sessions</span>';
  }

  renderModule(id: string, m: SavedModule, mi: number): string {
    const when = new Date(m.createdAt).toLocaleString();
    const where = [m.createdClass, m.createdSession].filter(Boolean).join(' · ');
    return `
    <div class="card">
      <div class="card-title-row">
        <button class="card-title tap" data-modview="${id}:${mi}">${this.d.esc(m.name)}</button>
        <button class="icon-btn danger" data-delmod="${id}:${mi}" title="Delete">✕</button>
      </div>
      <div class="card-sub">${where ? `${this.d.esc(where)} · ` : ''}${this.d.esc(when)}</div>
      ${m.expanded ? `<div class="chips" style="margin-top:8px">${m.titles.map((t) => `<span class="chip">${this.d.esc(t)}</span>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:10px">
        <button class="big" data-renamemod="${id}:${mi}">Rename</button>
        <button class="big" data-modview="${id}:${mi}">${m.expanded ? 'Hide' : 'View'}</button>
        <button class="big" data-preview="${this.d.esc(JSON.stringify(m.titles))}">Preview</button>
      </div>
    </div>`;
  }

  renderTip(id: string, t: Tip, ti: number, ts: { selectedTip: number; selectedIdx: number }): string {
    const c = this.d.cls(id)!;
    const sIdx = Math.max(0, c.sessions.length - 1);
    const selected = ts.selectedTip === ti;
    const selCall = selected ? t.titles[ts.selectedIdx] : null;
    const fits = selected && selCall != null ? fitsAround(this.d.seq, availableTitles(c, sIdx), t.titles, ts.selectedIdx) : null;
    return `
    <div class="tip">
      <div class="tip-head">
        <span class="tip-name">Tip ${ti + 1} · ${t.titles.length} calls</span>
        <button class="icon-btn danger" data-rmtip="${id}:${ti}">✕</button>
      </div>
      <div class="chips">${t.titles.map((c, ci) => `
        <button class="chip tap ${selected && ci === ts.selectedIdx ? 'sel' : ''}" data-selcall="${id}:${ti}:${ci}">${this.d.esc(c)}</button>`).join('')}</div>
      ${fits ? `
        <div class="fits">
          <div><b>Add before / replace</b>: ${fits.before.length ? fits.before.map((c) => `<button class="chip tap" data-before="${id}:${ti}:${c}">${this.d.esc(c)}</button>`).join('') : '<span class="muted">—</span>'}</div>
          <div><b>Add after</b>: ${fits.after.length ? fits.after.map((c) => `<button class="chip tap" data-after="${id}:${ti}:${c}">${this.d.esc(c)}</button>`).join('') : '<span class="muted">—</span>'}</div>
        </div>` : ''}
      <div style="margin-top:8px">
        <button class="big primary" data-savetip="${id}:${ti}">Save tip</button>
        <button class="big" data-preview="${this.d.esc(JSON.stringify(t.titles))}">Preview</button>
        <span class="save-err" data-saveerr="${id}:${ti}"></span>
      </div>
    </div>`;
  }

  sessionCallChip(r: CallRef, action: string, prefix: string, id: string, i: number, s: SessionPlan): string {
    const on = s.problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
    const tip = prefix === '✓' ? 'Tap to move back to planned' : prefix === '+' ? 'Tap to add to this session\'s plan' : 'Tap to teach this call';
    return `<span class="chip wrap ${on ? 'warn' : ''}"><button class="chip-main" ${action} title="${tip}">${prefix ? `${prefix} ` : ''}${this.callLabel(r)}</button><button class="star ${on ? 'on' : ''}" data-star="${id}::${i}::${r.title}::${r.setupIdx}" title="Prioritise this call">${on ? '★' : '☆'}</button></span>`;
  }

  callLabel(r: CallRef): string {
    return `<span class="cl-name">${this.d.esc(r.title)}</span>${r.setup ? `<span class="cl-pos">from ${this.d.esc(r.setup)}</span>` : ''}`;
  }

  chip(r: CallRef, warn = new Set<string>()): string {
    const w = warn.has(r.title) || warn.has(`${r.title}#${r.setupIdx}`);
    return `<span class="chip ${w ? 'warn' : ''}">${this.callLabel(r)}</span>`;
  }

  notFound(): string {
    return `<div class="content"><h2>Class not found</h2><button class="big" data-nav="#/">Home</button></div>`;
  }

  bottomNav(classId: string | null | undefined, active: 'home' | 'sessions' | 'students' | 'tips'): string {
    const hasClass = !!classId;
    const base = classId ? `#/class/${classId}` : '#/';
    const item = (label: string, key: string, href: string, disabled = false) =>
      `<a href="${disabled ? undefined : href}" class="nav-item ${active === key ? 'active' : ''} ${disabled ? 'disabled' : ''}" ${disabled ? 'aria-disabled="true"' : ''}>
      <span class="nav-ico">${this.ico(key)}</span><span>${label}</span></a>`;
    return `<nav class="bottombar">
    ${item('Home', 'home', '#/')}
    ${item('Sessions', 'sessions', base)}
    ${item('Students', 'students', hasClass ? `${base}/students` : '#/', !hasClass)}
    ${item('Tips', 'tips', hasClass ? `${base}/tips` : '#/tips/settings')}
  </nav>`;
  }

  private ico(key: string): string {
    return { home: '⌂', sessions: '▤', students: '👤', tips: '✦' }[key] ?? '·';
  }
}
