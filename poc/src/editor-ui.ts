// Call editor UI.
//
// Two distinct features:
//   1. FIX CLOSURE — correct an existing call setup so it ends at the start
//      position of a chosen POST call setup (the target). Appends corrective
//      moves when the end is misaligned.
//   2. CREATE POSITION — synthesize a NEW position for a call from the END of a
//      PRE call setup (new start) to the START of a POST call setup (new end),
//      through the edit call's chosen core setup, with a new position name.
//
// Targets (pre/post positions) are mapped to the edit call's dancer identities
// by aligning to the edit call's START, tolerating a whole-set rotation.

import {
  alignFormationToCore,
  synthesizeSetup,
  correctEndTo,
  callToXml,
  poseFor,
  endPoses,
  rigidFit,
} from 'dancing-squared-engine';
import type { CallBundle, FormDancer, Gender, Hands } from 'dancing-squared-engine';

import {
  availableCalls,
  loadCall,
  loadEdits,
  persistEdits,
  setApplied,
  effectiveSetups,
  rebuildEdit,
} from './data';
import type { CallEdit } from './data';
import type { Stage } from './scene';

export interface EditorUI {
  setActive(a: boolean): void;
}

// Warning threshold for a "large" closure correction.
const HEADING_WARN = 0.35; // rad (~20deg)
const POS_WARN = 2.0; // units

export function initEditor(stage: Stage, preview: (call: CallBundle) => void): EditorUI {
  const modeSel = document.getElementById('edMode') as HTMLSelectElement;
  const editCallSel = document.getElementById('edCall') as HTMLSelectElement;
  const editSetupSel = document.getElementById('edSetup') as HTMLSelectElement;
  const postCallSel = document.getElementById('edPostCall') as HTMLSelectElement;
  const postSetupSel = document.getElementById('edPostSetup') as HTMLSelectElement;
  const showTargetBtn = document.getElementById('edShowTarget') as HTMLButtonElement;
  const fixPanel = document.getElementById('edFixPanel') as HTMLDivElement;
  const showEndBtn = document.getElementById('edShowEnd') as HTMLButtonElement;
  const fixBtn = document.getElementById('edFix') as HTMLButtonElement;
  const fixInfoEl = document.getElementById('edFixInfo') as HTMLSpanElement;
  const createPanel = document.getElementById('edCreatePanel') as HTMLDivElement;
  const preCallSel = document.getElementById('edPreCall') as HTMLSelectElement;
  const preSetupSel = document.getElementById('edPreSetup') as HTMLSelectElement;
  const showStartBtn = document.getElementById('edShowStart') as HTMLButtonElement;
  const nameInput = document.getElementById('edName') as HTMLInputElement;
  const padInput = document.getElementById('edPadBeats') as HTMLInputElement;
  const createBtn = document.getElementById('edCreate') as HTMLButtonElement;
  const saveBtn = document.getElementById('edSave') as HTMLButtonElement;
  const exportBtn = document.getElementById('edExport') as HTMLButtonElement;
  const statusEl = document.getElementById('edStatus') as HTMLSpanElement;
  const savedEl = document.getElementById('edSaved') as HTMLDivElement;
  const xmlEl = document.getElementById('edXml') as HTMLTextAreaElement;

  const catalog = availableCalls();
  let saved: CallEdit[] = loadEdits();

  for (const c of catalog) {
    const label = `${c.level.toUpperCase()} · ${c.title}`;
    editCallSel.add(new Option(label, c.id));
    postCallSel.add(new Option(label, c.id));
    preCallSel.add(new Option(label, c.id));
  }

  // ---- current state ----
  let editSetup: CallBundle | null = null; // the edit call's selected setup (core / the setup to fix)
  let postStart: FormDancer[] | null = null; // POST call setup start -> target end
  let preEnd: FormDancer[] | null = null; // PRE call setup end -> new start
  let generated: CallBundle | null = null;
  let generatedName = '';

  function callStart(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  function callEnd(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, c.beats);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  // Map a target formation onto the edit setup's dancer identities (align to its
  // START, tolerating a whole-set rotation).
  function alignToSetup(c: CallBundle, formation: FormDancer[]): FormDancer[] {
    return alignFormationToCore(callStart(c), formation);
  }

  function staticCall(name: string, form: FormDancer[]): CallBundle {
    const dancers = form.map((f) => ({
      gender: (f.gender ?? 'boy') as Gender,
      x: f.x,
      y: f.y,
      angleDeg: (f.heading * 180) / Math.PI,
      path: [{ beats: 1, hands: 'both' as Hands, translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null }],
    }));
    return { title: name, from: name, parts: '', taminator: '', dancers, beats: 1, leadin: 0, leadout: 0, totalBeats: 1 };
  }

  function fillSetupSelect(sel: HTMLSelectElement, callId: string) {
    sel.innerHTML = '';
    effectiveSetups(callId).forEach((s, i) => sel.add(new Option(s.label, String(i))));
  }

  function loadEditSetup() {
    const id = editCallSel.value;
    const tam = parseInt(editSetupSel.value || '0', 10);
    try {
      editSetup = loadCall(id, tam, true);
      preview(staticCall(`edit setup start — ${editSetup.title}`, callStart(editSetup)));
      refreshFixInfo();
    } catch (err) {
      editSetup = null;
      statusEl.textContent = `edit call failed: ${(err as Error).message}`;
    }
    renderSaved();
  }

  function loadPost() {
    try {
      const c = loadCall(postCallSel.value, parseInt(postSetupSel.value || '0', 10), true);
      postStart = callStart(c);
      statusEl.textContent = `post start — ${c.title}`;
    } catch (err) {
      postStart = null;
      statusEl.textContent = `post call failed: ${(err as Error).message}`;
    }
    refreshFixInfo();
  }

  function loadPre() {
    try {
      const c = loadCall(preCallSel.value, parseInt(preSetupSel.value || '0', 10), true);
      preEnd = callEnd(c);
      statusEl.textContent = `pre end — ${c.title}`;
    } catch (err) {
      preEnd = null;
      statusEl.textContent = `pre call failed: ${(err as Error).message}`;
    }
  }

  // Show the closure discrepancy between the edit setup's end and the target,
  // measured at the FORMATION level (rigid fit, allowing a whole-set rotation)
  // so it isn't inflated by the call's own movement between its start and end.
  // Formation-level discrepancy between the edit setup's end and the post-call
  // start: position distance (rigid fit) + best heading residual over the four
  // whole-set rotations. Measured at the FORMATION level so a call's own
  // start->end movement and symmetric-rotation ambiguity don't inflate it.
  function fixDiscrepancy(): { posErr: number; maxHead: number } {
    const editEnd = endPoses(editSetup!);
    const fit = rigidFit(editEnd.map((p) => ({ x: p.x, y: p.y })), postStart!.map((p) => ({ x: p.x, y: p.y })));
    let maxHead = Infinity;
    const ROTS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const rot of ROTS) {
      let m = 0;
      for (let i = 0; i < Math.min(editEnd.length, postStart!.length); i++) {
        let d = editEnd[i].heading - postStart![i].heading - rot;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d <= -Math.PI) d += 2 * Math.PI;
        m = Math.max(m, Math.abs(d));
      }
      if (m < maxHead) maxHead = m;
    }
    return { posErr: fit.error, maxHead };
  }

  // Show the closure discrepancy between the edit setup's end and the target.
  function refreshFixInfo() {
    if (!editSetup || !postStart) {
      fixInfoEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = fixDiscrepancy();
    fixInfoEl.textContent =
      `end formation ${posErr.toFixed(2)} apart from post-call start (rigid fit)` +
      (maxHead > 0.1 ? `, headings up to ${(maxHead * 180 / Math.PI).toFixed(0)}° apart` : '');
  }

  function applyMode() {
    const create = modeSel.value === 'create';
    fixPanel.hidden = create;
    createPanel.hidden = !create;
    renderSaved();
    refreshFixInfo();
  }

  // ---- feature 1: fix closure ----
  fixBtn.addEventListener('click', () => {
    if (!editSetup || !postStart) {
      statusEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = fixDiscrepancy();
    if (posErr > POS_WARN || maxHead > HEADING_WARN) {
      const size = `heading ${(maxHead * 180 / Math.PI).toFixed(0)}°, pos ${posErr.toFixed(1)}`;
      if (!window.confirm(`Correction is large (${size}) — this may not be a simple closure misalignment. Proceed?`)) return;
    }
    const target = alignToSetup(editSetup, postStart);
    const fixed = correctEndTo(editSetup, target);
    generated = fixed;
    generatedName = `${editSetup.title} (fixed)`;
    preview(fixed);
    fixInfoEl.textContent =
      `corrected: end formation now ${posErr.toFixed(2)} apart from post-call start` +
      (maxHead > 0.1 ? `, headings ${(maxHead * 180 / Math.PI).toFixed(0)}° apart` : '');
    statusEl.textContent = '✓ fixed closure';
  });

  // ---- feature 2: create position ----
  createBtn.addEventListener('click', () => {
    if (!editSetup || !preEnd || !postStart) {
      statusEl.textContent = 'pick an edit call+setup, a pre call+setup, and a post call+setup';
      return;
    }
    const name = nameInput.value.trim() || `${preCallSel.value} → ${postCallSel.value}`;
    const beats = parseFloat(padInput.value) || 2;
    const start = alignToSetup(editSetup, preEnd);
    const end = alignToSetup(editSetup, postStart);
    try {
      const created = synthesizeSetup(editSetup, { name, start, end, padBeats: beats });
      generated = created;
      generatedName = name;
      preview(created);
      statusEl.textContent = `✓ created "${name}" (${created.beats} beats)`;
    } catch (err) {
      statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  });

  showTargetBtn.addEventListener('click', () => {
    if (!postStart) return;
    const name = postCallSel.selectedOptions[0]?.textContent ?? postCallSel.value;
    preview(staticCall(`post start — ${name}`, postStart));
  });
  showEndBtn.addEventListener('click', () => {
    if (!editSetup) return;
    const name = editCallSel.selectedOptions[0]?.textContent ?? editCallSel.value;
    preview(staticCall(`edit end — ${name}`, callEnd(editSetup)));
  });
  showStartBtn.addEventListener('click', () => {
    if (!preEnd) return;
    const name = preCallSel.selectedOptions[0]?.textContent ?? preCallSel.value;
    preview(staticCall(`pre end — ${name}`, preEnd));
  });

  // ---- save / export ----
  function currentSpec(): CallEdit | null {
    const id = editCallSel.value;
    if (!id) return null;
    const isCreate = modeSel.value === 'create';
    const base: CallEdit = {
      kind: isCreate ? 'create' : 'fix',
      callId: id,
      setupIdx: parseInt(editSetupSel.value || '0', 10),
      postCallId: postCallSel.value,
      postSetupIdx: parseInt(postSetupSel.value || '0', 10),
      name: generatedName || nameInput.value.trim() || `${id} → ${postCallSel.value}`,
      padBeats: isCreate ? (parseFloat(padInput.value) || 2) : 1, // beats can't change for a fix
    };
    if (base.kind === 'create') {
      base.preCallId = preCallSel.value;
      base.preSetupIdx = parseInt(preSetupSel.value || '0', 10);
    }
    return base;
  }

  saveBtn.addEventListener('click', () => {
    const spec = currentSpec();
    if (!spec) return;
    saved = saved.filter((s) => !(s.kind === spec.kind && s.callId === spec.callId && s.setupIdx === spec.setupIdx && s.name === spec.name));
    saved.push(spec);
    persistEdits(saved);
    renderSaved();
    statusEl.textContent = `saved "${spec.name}"`;
  });

  exportBtn.addEventListener('click', () => {
    try {
      const call = generated ?? (() => {
        const spec = currentSpec();
        if (!spec) return null;
        return rebuildEdit(spec);
      })();
      if (!call) {
        statusEl.textContent = 'nothing to export yet';
        return;
      }
      const xml = callToXml(call, generatedName || call.from || call.title);
      xmlEl.value = '<calls>\n' + xml + '\n</calls>';
      void navigator.clipboard?.writeText(xmlEl.value);
      statusEl.textContent = 'exported <tam> XML (copied)';
    } catch (err) {
      statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  });

  function renderSaved() {
    savedEl.innerHTML = '';
    if (saved.length === 0) {
      savedEl.innerHTML = '<i>no saved editor results</i>';
      return;
    }
    for (const s of saved) {
      const row = document.createElement('div');
      row.className = 'setup' + (s.applied ? ' applied' : '');
      const label = document.createElement('b');
      label.textContent = `${s.kind === 'fix' ? 'fix' : 'create'} · ${s.name}${s.applied ? ' ✔' : ''}`;
      row.appendChild(label);
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'preview';
      loadBtn.addEventListener('click', () => {
        try {
          preview(rebuildEdit(s));
          statusEl.textContent = `✓ ${s.name}`;
        } catch (err) {
          statusEl.textContent = `✗ ${(err as Error).message}`;
        }
      });
      const applyBtn = document.createElement('button');
      applyBtn.textContent = s.applied ? 'unapply' : 'apply to live';
      applyBtn.addEventListener('click', () => {
        const wasApplied = !!s.applied;
        setApplied(s, !wasApplied);
        saved = loadEdits();
        renderSaved();
        statusEl.textContent = wasApplied ? `removed "${s.name}" from live catalog` : `✓ "${s.name}" applied to live catalog`;
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', () => {
        saved = saved.filter((x) => x !== s);
        persistEdits(saved);
        renderSaved();
      });
      row.appendChild(loadBtn);
      row.appendChild(applyBtn);
      row.appendChild(delBtn);
      savedEl.appendChild(row);
    }
  }

  // ---- wiring ----
  modeSel.addEventListener('change', applyMode);
  editCallSel.addEventListener('change', () => {
    fillSetupSelect(editSetupSel, editCallSel.value);
    loadEditSetup();
  });
  editSetupSel.addEventListener('change', loadEditSetup);
  postCallSel.addEventListener('change', () => {
    fillSetupSelect(postSetupSel, postCallSel.value);
    loadPost();
  });
  postSetupSel.addEventListener('change', loadPost);
  preCallSel.addEventListener('change', () => {
    fillSetupSelect(preSetupSel, preCallSel.value);
    loadPre();
  });
  preSetupSel.addEventListener('change', loadPre);

  fillSetupSelect(editSetupSel, editCallSel.value);
  fillSetupSelect(postSetupSel, postCallSel.value);
  fillSetupSelect(preSetupSel, preCallSel.value);
  loadEditSetup();
  loadPost();
  loadPre();
  applyMode();

  return {
    setActive(a: boolean) {
      if (a) renderSaved();
    },
  };
}
