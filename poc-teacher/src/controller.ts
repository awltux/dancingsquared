// Controller: wires the teacher app's DOM events (the former `wire()` function
// in main.ts). It receives a small deps object; the shared mutable UI state
// (notice, tips, the prioritise modal) is read/written through getters/setters
// supplied by the host so it stays in sync with render()/View.

import {
  setProblem,
  addStudent,
  removeStudent,
  renameStudent,
  teachAll,
  teachCall,
  unteachCall,
  pullForward,
  completeSession,
  availableTitles,
  priorityWeights,
  generateTips,
  insertInto,
  archivedNote,
} from './teacher';
import type { CallRef, ClassInstance, SessionPlan, Tip } from './teacher';
import type { ProbModal } from './view';
import type { TeacherStore } from './store';
import type { Tour } from './tour';
import type { Preview } from './preview';
import type { CatalogCall } from './catalog';
import { makeSequencer } from './catalog';
import { buildClassFromProgramme, serializeProgramme } from './programme';
import { serializeModules } from './modules';
import { sanitizeText, clampNum } from './util';

export interface ControllerDeps {
  store: TeacherStore;
  tour: Tour;
  preview: Preview;
  root: HTMLElement;
  catalog: CatalogCall[];
  movesXml: string;
  formationsXml: string;
  minTaughtCalls: number;
  cls: (id: string) => ClassInstance | undefined;
  session: (id: string, i: number) => SessionPlan | undefined;
  navigate: (hash: string) => void;
  render: () => void;
  setNotice: (text: string, warn?: boolean) => void;
  familyOf: (title: string) => string;
  toRefOrNull: (title: string) => CallRef | null;
  suggestModuleName: (titles: string[], familyOf: (t: string) => string) => string;
  sameSequence: (a: string[], b: string[]) => boolean;
  importModulesText: (id: string, text: string) => void;
  importProgrammeText: (text: string) => void;
  getProbModal: () => ProbModal | null;
  setProbModal: (m: ProbModal | null) => void;
  getTipsByClass: () => Record<string, Tip[]>;
  getTipsState: () => Record<string, { selectedTip: number; selectedIdx: number }>;
}

export class Controller {
  constructor(private readonly d: ControllerDeps) {}

  /** Bind the app's DOM event handlers (called after each render). */
  wire(): void {
    const d = this.d;
    const root = d.root;

    root.querySelectorAll<HTMLDetailsElement>('details[data-dkey]').forEach((el) => {
      const k = el.dataset.dkey!;
      el.addEventListener('toggle', () => {
        d.store.detailsState.set(k, el.open);
        d.store.saveDetailsState();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        d.navigate(el.dataset.nav!);
      }));

    // ---- tour ----
    d.tour.wire(root);

    root.querySelectorAll<HTMLElement>('[data-att]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id!, i = +b.dataset.i!, sid = b.dataset.att!;
        d.session(id, i)!.attendance[sid] = !d.session(id, i)!.attendance[sid];
        d.store.saveClasses();
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-star]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, i, title, setupIdx] = b.dataset.star!.split('::');
        const c = d.cls(id)!;
        const existing = c.sessions[+i].problems.find((p) => p.title === title && p.setupIdx === +setupIdx);
        const archived = archivedNote(c, +i, title, +setupIdx);
        d.setProbModal({
          id,
          i: +i,
          title,
          setupIdx: +setupIdx,
          existing: existing ? { priority: existing.priority, note: existing.note } : undefined,
          archivedNote: archived,
        });
        d.render();
      }));
    root.querySelectorAll<HTMLInputElement>('#probPriority').forEach((el) => {
      el.addEventListener('input', () => { (root.querySelector('#probPriorityVal') as HTMLElement).textContent = el.value; });
    });
    root.querySelectorAll<HTMLElement>('[data-probsave]').forEach((b) =>
      b.addEventListener('click', () => {
        const note = sanitizeText((root.querySelector('#probNote') as HTMLTextAreaElement).value, 500);
        const pri = clampNum(+(root.querySelector('#probPriority') as HTMLInputElement).value, 1, 5);
        const m = d.getProbModal();
        if (m) {
          setProblem(d.cls(m.id)!, m.i, m.title, m.setupIdx, pri, note, true);
          d.store.saveClasses();
        }
        d.setProbModal(null);
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-probcancel]').forEach((b) =>
      b.addEventListener('click', () => { d.setProbModal(null); d.render(); }));
    root.querySelectorAll<HTMLElement>('[data-probremove]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = d.getProbModal();
        if (m) {
          setProblem(d.cls(m.id)!, m.i, m.title, m.setupIdx, 3, '', false);
          d.store.saveClasses();
        }
        d.setProbModal(null);
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-closeprob]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('overlay')) { d.setProbModal(null); d.render(); }
      }));

    // ---- 2D preview ----
    d.preview.wire(root);

    root.querySelectorAll<HTMLElement>('[data-delclass]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.delclass!;
        const c = d.store.classes.find((x) => x.id === id);
        if (c && window.confirm(`Delete class "${c.name}"?`)) {
          d.store.classes = d.store.classes.filter((x) => x.id !== id);
          d.store.saveClasses();
          d.render();
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
      addStudent(d.cls(id)!, name);
      input.value = '';
      d.store.saveClasses();
      d.render();
    };
    root.querySelectorAll<HTMLElement>('[data-addstudent]').forEach((b) =>
      b.addEventListener('click', () => doAddStudent(b.dataset.id!)));
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
        const c = d.cls(id);
        if (!c) return;
        const name = sanitizeText(window.prompt('Rename class', c.name) ?? '', 60);
        if (name) {
          c.name = name;
          const mods = d.store.savedModules[id];
          if (mods) for (const m of mods) m.createdClass = name;
          d.store.saveClasses();
          d.store.saveSavedModules();
          d.render();
        }
      }));

    root.querySelectorAll<HTMLElement>('[data-rename]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, sid] = b.dataset.rename!.split(':');
        const c = d.cls(id)!;
        const st = c.students.find((s) => s.id === sid);
        const name = sanitizeText(window.prompt('Rename dancer', st?.name ?? '') ?? '');
        if (name) {
          renameStudent(c, sid, name);
          d.store.saveClasses();
          d.render();
        }
      }));
    root.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, sid] = b.dataset.remove!.split(':');
        const c = d.cls(id)!;
        const st = c.students.find((s) => s.id === sid);
        if (window.confirm(`Remove ${st?.name ?? 'this dancer'} from the class?`)) {
          removeStudent(c, sid);
          d.store.saveClasses();
          d.render();
        }
      }));

    root.querySelectorAll<HTMLElement>('[data-moveall]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const [id, i] = b.dataset.moveall!.split(':');
        teachAll(d.cls(id)!, +i);
        d.store.saveClasses();
        d.render();
        const btn = root.querySelector<HTMLElement>(`[data-moveall="${id}:${i}"]`);
        if (btn) {
          btn.classList.add('flash');
          window.setTimeout(() => btn.classList.remove('flash'), 1500);
        }
      }));

    root.querySelectorAll<HTMLElement>('[data-teach]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, i, pi] = b.dataset.teach!.split(':');
        teachCall(d.cls(id)!, +i, +pi);
        d.store.saveClasses();
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-unteach]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, i, ti] = b.dataset.unteach!.split(':');
        unteachCall(d.cls(id)!, +i, +ti);
        d.store.saveClasses();
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-moveplanned]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, i, title, setupIdx] = b.dataset.moveplanned!.split('::');
        const c = d.cls(id);
        if (!c) return;
        const s = c.sessions[+i];
        if (!s) return;
        const si = +setupIdx;
        if (s.planned.some((p) => p.title === title && p.setupIdx === si)) return;
        const prev = c.sessions.slice(0, +i).flatMap((sess) => sess.taught).find((r) => r.title === title && r.setupIdx === si);
        const ref = prev ?? d.toRefOrNull(title) ?? { title, level: c.level, setupIdx: si, setup: '' };
        s.planned.push(ref);
        d.store.saveClasses();
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-act="pull"]').forEach((b) =>
      b.addEventListener('click', () => { pullForward(d.cls(b.dataset.id!)!, +b.dataset.i!, 1); d.store.saveClasses(); d.render(); }));
    root.querySelectorAll<HTMLInputElement>('[data-completed]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const [id, i] = cb.dataset.completed!.split(':');
        const c = d.cls(id)!;
        const s = c.sessions[+i];
        s.completed = cb.checked;
        let moved = 0;
        let carried = 0;
        if (cb.checked) {
          const res = completeSession(c, +i);
          moved = res.movedPlanned;
          carried = res.carried;
        }
        d.store.saveClasses();
        d.setNotice(
          cb.checked
            ? carried || moved
              ? `Session completed — ${moved} planned call(s) moved on, ${carried} missed/prioritised call(s) carried.`
              : 'Session completed.'
            : 'Session marked not complete.',
        );
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-act="createcourse"]').forEach((b) =>
      b.addEventListener('click', () => {
        const nameEl = root.querySelector('#newName') as HTMLInputElement;
        const progEl = root.querySelector('#newProg') as HTMLSelectElement;
        const errName = root.querySelector('#err-name') as HTMLElement;
        const errProg = root.querySelector('#err-prog') as HTMLElement;
        const name = sanitizeText(nameEl.value);
        const pi = +progEl.value;
        const p = d.store.programmes[pi];
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
        d.store.classes.push(buildClassFromProgramme(id, name, p, students, d.toRefOrNull));
        d.store.saveClasses();
        d.navigate(`#/class/${id}`);
      }));

    root.querySelectorAll<HTMLElement>('[data-export]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = d.store.programmes[+b.dataset.export!];
        const text = serializeProgramme(p);
        const doCopy = () => { d.setNotice(`Copied "${p.name}" to clipboard.`); d.render(); };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(doCopy, () => { d.setNotice('Could not copy — see console.'); d.render(); });
        } else {
          d.setNotice('Clipboard unavailable on this device.');
          d.render();
        }
      }));

    root.querySelectorAll<HTMLElement>('[data-download]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = d.store.programmes[+b.dataset.download!];
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
        const list = d.store.savedModules[id] ?? [];
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
          d.setNotice('Nothing to import — paste module JSON or choose a file first.');
          d.render();
          return;
        }
        ta.classList.remove('invalid');
        d.importModulesText(id, text);
      }));

    root.querySelectorAll<HTMLInputElement>('#modImportFile').forEach((file) =>
      file.addEventListener('change', () => {
        const id = file.dataset.modid!;
        const f = file.files?.[0];
        if (!f) { d.setNotice('No file was chosen.'); d.render(); return; }
        const reader = new FileReader();
        reader.onload = () => d.importModulesText(id, String(reader.result ?? ''));
        reader.readAsText(f);
      }));

    root.querySelectorAll<HTMLElement>('[data-import]').forEach((b) =>
      b.addEventListener('click', () => {
        const ta = root.querySelector('#importText') as HTMLTextAreaElement;
        const text = ta.value;
        if (!text.trim()) {
          ta.classList.add('invalid');
          d.setNotice('Nothing to import — paste a programme or choose a file first.');
          d.render();
          return;
        }
        ta.classList.remove('invalid');
        d.importProgrammeText(text);
      }));

    root.querySelectorAll<HTMLInputElement>('#importFile').forEach((file) =>
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (!f) {
          d.setNotice('No file was chosen.');
          d.render();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => d.importProgrammeText(String(reader.result ?? ''));
        reader.readAsText(f);
      }));

    root.querySelectorAll<HTMLButtonElement>('[data-act="gentips"]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id!;
        const c = d.cls(id)!;
        const sIdx = b.dataset.session != null ? Math.min(+b.dataset.session, c.sessions.length - 1) : c.sessions.length - 1;
        this.generateTipsInBackground(b, id, c, sIdx);
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
        const v = (sel: string) => clampNum(+(root.querySelector(sel) as HTMLInputElement).value, 0, 100) / 100;
        d.store.tipConfig = {
          repeatProb: v('#cfgRepeat'),
          priorityProb: v('#cfgPriority'),
          currentProb: v('#cfgCurrent'),
          prevProb: v('#cfgPrev'),
        };
        d.store.saveTipConfig();
        d.setNotice('Tip settings saved.');
        d.navigate('#/');
      }));

    root.querySelectorAll<HTMLElement>('[data-rmtip]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, ti] = b.dataset.rmtip!.split(':');
        d.getTipsByClass()[id].splice(+ti, 1);
        d.getTipsState()[id] = { selectedTip: -1, selectedIdx: -1 };
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-selcall]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, ti, ci] = b.dataset.selcall!.split(':').map(Number);
        d.getTipsState()[id] = { selectedTip: ti, selectedIdx: ci };
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-before]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, ti, title] = b.dataset.before!.split(':');
        const st = d.getTipsState()[id];
        d.getTipsByClass()[id][+ti].titles = insertInto(d.getTipsByClass()[id][+ti].titles, st.selectedIdx, title);
        d.render();
      }));
    root.querySelectorAll<HTMLElement>('[data-after]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, ti, title] = b.dataset.after!.split(':');
        const st = d.getTipsState()[id];
        d.getTipsByClass()[id][+ti].titles = insertInto(d.getTipsByClass()[id][+ti].titles, st.selectedIdx + 1, title);
        d.render();
      }));

    root.querySelectorAll<HTMLInputElement>('input.callprob').forEach((el) => {
      el.addEventListener('input', () => {
        const val = el.previousElementSibling as HTMLElement | null;
        if (val) val.textContent = `${el.value}%`;
      });
      el.addEventListener('change', () => {
        const [cid, title] = el.dataset.callprob!.split('::');
        (d.store.callProbs[cid] ??= {})[title] = clampNum(+el.value, 0, 100) / 100;
        d.store.saveCallProbs();
      });
    });

    // Save a generated tip to the saved modules list.
    root.querySelectorAll<HTMLElement>('[data-savetip]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, ti] = b.dataset.savetip!.split(':');
        const c = d.cls(id)!;
        const t = d.getTipsByClass()[id][+ti];
        const modules = (d.store.savedModules[id] ??= []);
        const seq = t.titles;
        const dup = modules.findIndex((m) => d.sameSequence(m.titles, seq));
        if (dup >= 0) {
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
        const sIdx = Math.max(0, c.sessions.findIndex((s) => s.id === t.sourceSessionId));
        const defaultName = d.suggestModuleName(t.titles, d.familyOf) || `Saved tip ${modules.length + 1}`;
        const name = sanitizeText(window.prompt(`Name this module — suggested: "${defaultName}"`, defaultName) ?? '', 60) || defaultName;
        modules.push({
          name,
          titles: [...t.titles],
          createdAt: Date.now(),
          createdClass: c.name,
          createdSession: c.sessions[sIdx]?.name ?? '',
        });
        d.store.saveSavedModules();
        d.setNotice(`Saved "${name}" to modules.`);
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-modview]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, mi] = b.dataset.modview!.split(':');
        const m = d.store.savedModules[id]?.[+mi];
        if (m) m.expanded = !m.expanded;
        d.store.saveSavedModules();
        d.render();
      }));

    root.querySelectorAll<HTMLElement>('[data-renamemod]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, mi] = b.dataset.renamemod!.split(':');
        const m = d.store.savedModules[id]?.[+mi];
        if (!m) return;
        const name = window.prompt('Rename module', m.name);
        if (name != null) {
          m.name = sanitizeText(name) || m.name;
          d.store.saveSavedModules();
          d.render();
        }
      }));

    root.querySelectorAll<HTMLElement>('[data-delmod]').forEach((b) =>
      b.addEventListener('click', () => {
        const [id, mi] = b.dataset.delmod!.split(':');
        const m = d.store.savedModules[id]?.[+mi];
        if (m && window.confirm(`Delete module "${m.name}"?`)) {
          d.store.savedModules[id].splice(+mi, 1);
          d.store.saveSavedModules();
          d.render();
        }
      }));
  }

  // Generate tips synchronously on the main thread (no worker).
  private generateTipsInBackground(btn: HTMLButtonElement, id: string, c: ClassInstance, sIdx: number): void {
    const d = this.d;
    const avail = availableTitles(c, sIdx);
    if (avail.size < d.minTaughtCalls) {
      d.setNotice(`Not enough taught calls to generate tips — teach at least ${d.minTaughtCalls} calls first.`, true);
      d.render();
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

    const calls = d.catalog.filter((x) => avail.has(x.title)).map((x) => ({ title: x.title, xml: x.xml }));
    const prioritised = new Set(c.sessions[sIdx].problems.map((p) => p.title));
    const familyMap: Record<string, string> = {};
    for (const x of d.catalog) familyMap[x.title] = x.family;

    const availSeq = makeSequencer(d.movesXml, d.formationsXml, calls);
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
          getoutBudget: 200,
          config: d.store.tipConfig,
          current: currentSet,
          callProb: (t) => d.store.effectiveCallProb(id, t, currentSet, prioritised),
          family: (t) => familyMap[t] ?? '',
          onProgress: (attempts, made) => {
            btn.innerHTML = `<span class="spinner"></span>Searching ${attempts}/${totalAttempts} · ${made}/3 tips`;
            return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          },
        });

        d.getTipsByClass()[id] = tips.map((titles, i) => ({
          name: `Tip ${i + 1}`,
          sourceSessionId: c.sessions[sIdx].id,
          titles,
        }));
        d.getTipsState()[id] = { selectedTip: d.getTipsByClass()[id].length ? 0 : -1, selectedIdx: -1 };
        done();
        if (tips.length === 0) {
          d.setNotice('Couldn\'t make any tips from the calls taught so far — the set can\'t get back to the squared set. Teach a few more calls (a circle, a promenade, or Allemande Left) and try again.', true);
        }
        d.render();
      } catch (err) {
        console.error('[gentips] error generating tips:', err);
        done();
        d.setNotice('Tip generation failed.');
        d.render();
      }
    })();
  }
}
