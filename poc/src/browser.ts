// CallBrowser: the browse mode of the app. Owns the shared dancer views +
// hand connectors, the level/call/setup selects and mirror checkbox, and the
// legend. Loads a call and renders its animation each frame (driven by the
// Player's playhead). The editor reuses this as its `preview` callback.

import * as THREE from 'three';

import { allPoses, sampleTrail, computeHandholds, assignHomeIdentity } from 'dancing-squared-engine';
import type { HeadingMode, HoldMode, CallBundle, Pose } from 'dancing-squared-engine';
import { availableCalls, loadCall } from './data';
import type { CallInfo } from './data';
import { DancerView, buildHandConnectors } from './scene';
import type { Stage } from './scene';
import { Player } from './player';

export class CallBrowser {
  private stage: Stage;
  private player: Player;

  private levelSelect = el<HTMLSelectElement>('levelSelect');
  private callSelect = el<HTMLSelectElement>('callSelect');
  private tamSelect = el<HTMLSelectElement>('tamSelect');
  private mirrorCheck = el<HTMLInputElement>('mirror');
  private facingSelect = el<HTMLSelectElement>('facing');
  private scrub = el<HTMLInputElement>('scrub');
  private beatReadout = el<HTMLSpanElement>('beatReadout');
  private partLabel = el<HTMLSpanElement>('partLabel');
  private legend = el<HTMLDivElement>('legend');

  private catalog: CallInfo[] = availableCalls();
  views: DancerView[] = [];
  connectors: ReturnType<typeof buildHandConnectors>;
  availableLevels: string[] = [];

  constructor(stage: Stage, player: Player) {
    this.stage = stage;
    this.player = player;
    this.connectors = buildHandConnectors(stage.scene);
    this.availableLevels = Array.from(new Set(this.catalog.map((c) => c.level)));
    this.populateLevels();
    this.populateCalls();
    this.refreshSetups();
    this.loadCurrent();
  }

  private populateLevels() {
    this.levelSelect.add(new Option('All levels', ''));
    for (const lv of this.availableLevels) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
  }

  private currentLevel(): string {
    return this.levelSelect.value;
  }

  private populateCalls(keepFile?: string) {
    const level = this.currentLevel();
    const calls = level ? this.catalog.filter((c) => c.level === level) : this.catalog;
    this.callSelect.innerHTML = '';
    let lastLevel = '';
    for (const c of calls) {
      if (level === '') {
        if (c.level !== lastLevel) {
          const g = document.createElement('optgroup');
          g.label = c.level.toUpperCase();
          this.callSelect.add(g);
          lastLevel = c.level;
        }
        this.callSelect.add(new Option(c.title, c.id));
      } else {
        this.callSelect.add(new Option(c.title, c.id));
      }
    }
    if (keepFile && calls.some((c) => c.id === keepFile)) this.callSelect.value = keepFile;
  }

  private refreshSetups() {
    const c = this.catalog.find((x) => x.id === this.callSelect.value);
    this.tamSelect.innerHTML = '';
    if (c) c.setups.forEach((s, i) => this.tamSelect.add(new Option(s.label, String(i))));
  }

  /** Load the selected call into the browser (also used as the editor preview). */
  showCall(call: CallBundle | null) {
    for (const v of this.views) {
      this.stage.scene.remove(v.group);
      this.stage.scene.remove(v.trail);
    }
    this.views = [];
    if (!call) {
      this.legend.innerHTML = '<i>no call</i>';
      return;
    }
    const dancers = assignHomeIdentity(call.dancers);
    this.views = dancers.map((d) => new DancerView(d, d.couple ?? 0));
    for (let i = 0; i < this.views.length; i++) {
      this.stage.scene.add(this.views[i].group);
      this.stage.scene.add(this.views[i].trail);
      this.views[i].setTrail(sampleTrail(dancers[i], 80));
    }
    if (call.taminator) this.legend.innerHTML = `<b>${call.title}</b> — ${call.taminator}`;
    else this.legend.innerHTML = `<b>${call.title}</b><br>from ${call.from || '(default setup)'}`;
    this.player.setCall(call);
    this.updateScrub(call);
  }

  /** Alias for `showCall` used as the editor's preview callback. */
  preview(call: CallBundle | null) {
    this.showCall(call);
  }

  private loadCurrent() {
    const id = this.callSelect.value;
    const tamIndex = parseInt(this.tamSelect.value, 10);
    try {
      this.showCall(loadCall(id, tamIndex, this.mirrorCheck.checked));
    } catch (err) {
      this.showCall(null);
      this.legend.innerHTML = `<b>${id}</b><br><span style="color:#ff7a7a">failed to load: ${(err as Error).message}</span>`;
    }
  }

  onLevelChange() {
    const prev = this.callSelect.value;
    this.populateCalls(prev);
    this.refreshSetups();
    this.loadCurrent();
  }
  onCallChange() {
    this.refreshSetups();
    this.loadCurrent();
  }
  onSetupChange() {
    this.loadCurrent();
  }
  onMirrorChange() {
    this.loadCurrent();
  }

  /** Show/hide the dancer views + connectors (used by mode switching). */
  setVisible(v: boolean) {
    for (const dv of this.views) {
      dv.group.visible = v;
      dv.trail.visible = v;
    }
    this.connectors.group.visible = v;
  }

  // ---------------------------------------------------------------- rendering

  private computeGrips(poses: Pose[], call: CallBundle, beat: number) {
    const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
    const lines: [number, number][] = [];
    const staticHold = beat <= 0 || beat >= call.beats;
    const mode: HoldMode = staticHold ? 'static' : 'active';
    const holds = computeHandholds(poses, mode);
    for (const h of holds) {
      const mx = (poses[h.i].x + poses[h.j].x) / 2;
      const my = (poses[h.i].y + poses[h.j].y) / 2;
      const hold = new THREE.Vector3(mx, 1.0, -my);
      if (h.hi === 'left') targets[h.i].left = hold.clone();
      else targets[h.i].right = hold.clone();
      if (h.hj === 'left') targets[h.j].left = hold.clone();
      else targets[h.j].right = hold.clone();
      lines.push([h.i, h.j]);
    }
    return { targets, lines };
  }

  private updateScrub(call: CallBundle) {
    const f = (this.player.beat + call.leadin) / call.totalBeats;
    this.scrub.value = String(f * 100);
  }

  /** Render the current frame: pose the views, draw hand holds, update readouts. */
  render(beat: number, call: CallBundle) {
    const t = beat;
    const facingMode = this.facingSelect.value as HeadingMode;
    const poses = allPoses(call, t, facingMode);
    const { targets, lines } = this.computeGrips(poses, call, beat);
    const walkPhase = ((t + 1000) % 2) / 2;
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].update(poses[i], targets[i], { phase: walkPhase });
    }
    this.connectors.set(lines, poses);

    const parts = call.parts ? call.parts.split(';') : [];
    let acc = 0;
    let idx = -1;
    for (let k = 0; k < parts.length; k++) {
      acc += parseFloat(parts[k]);
      if (t >= acc) idx = k + 1;
    }
    this.partLabel.textContent = idx >= 0 ? `part ${idx + 1}/${parts.length}` : '';
    this.beatReadout.textContent = `${(t + call.leadin).toFixed(2)} / ${call.totalBeats.toFixed(2)} b`;
    this.updateScrub(call);
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
