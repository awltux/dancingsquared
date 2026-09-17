// CallBrowser: the browse mode of the app. Owns the shared dancer views +
// hand connectors, the level/call/setup selects and mirror checkbox, and the
// legend. Loads a call and renders its animation each frame (driven by the
// Player's playhead). The editor reuses this as its `preview` callback.

import * as THREE from 'three';

import { allPoses, sampleTrail, computeHandholds, assignHomeIdentity } from 'dancing-squared-engine';
import type { HeadingMode, HoldMode, CallBundle, CallStep, Pose } from 'dancing-squared-engine';
import { availableCalls, loadCall } from './data';
import type { CallInfo } from './data';
import { modulesUsing, startsAwayFromHome } from './modules';
import { DancerView, buildHandConnectors } from './scene';
import type { Stage } from './scene';
import { Player } from './player';

/** What the browse view needs from the rest of the app. */
export interface BrowserHost {
  /** Open the SEQUENCE view with `steps` loaded, the playhead at the first step playing `atCall`,
   * and `startFormation` naming where the corpus says the module begins when that is not home (so
   * the sequence view can say its replay is an approximation). */
  openSequence(steps: (string | CallStep)[], atCall: string, startFormation?: string): void;
}

/** How many "used by" entries the browse panel lists before summarising the rest. */
const USES_SHOWN = 20;

export class CallBrowser {
  private stage: Stage;
  private player: Player;
  private host: BrowserHost;

  private levelSelect = el<HTMLSelectElement>('levelSelect');
  private callSelect = el<HTMLSelectElement>('callSelect');
  private tamSelect = el<HTMLSelectElement>('tamSelect');
  private mirrorCheck = el<HTMLInputElement>('mirror');
  private facingSelect = el<HTMLSelectElement>('facing');
  private scrub = el<HTMLInputElement>('scrub');
  private beatReadout = el<HTMLSpanElement>('beatReadout');
  private partLabel = el<HTMLSpanElement>('partLabel');
  private legend = el<HTMLDivElement>('legend');
  private usesEl = el<HTMLDivElement>('browseUses');

  private catalog: CallInfo[] = availableCalls();
  views: DancerView[] = [];
  connectors: ReturnType<typeof buildHandConnectors>;
  availableLevels: string[] = [];

  constructor(stage: Stage, player: Player, host: BrowserHost) {
    this.stage = stage;
    this.player = player;
    this.host = host;
    this.connectors = buildHandConnectors(stage.scene);
    this.availableLevels = Array.from(new Set(this.catalog.map((c) => c.level)));
    this.populateLevels();
    this.populateCalls();
    this.refreshSetups();
    this.renderUses();
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
    this.renderUses();
    this.loadCurrent();
  }
  onCallChange() {
    this.refreshSetups();
    this.renderUses();
    this.loadCurrent();
  }

  /**
   * The named sequences that USE the selected call, each with an "open" button.
   *
   * A call on its own says little about how it is danced - what you want next is the published
   * sequences it appears in, and a way into them. The list comes from `modulesUsing`, which reads
   * the SAME ceder corpus and saved modules the sequencer registers; the button hands the sequence
   * to the sequence view whole and parks the playhead where this call starts.
   */
  private renderUses() {
    const c = this.catalog.find((x) => x.id === this.callSelect.value);
    if (!c) {
      this.usesEl.innerHTML = '';
      return;
    }
    const uses = modulesUsing(c.title);
    if (uses.length === 0) {
      this.usesEl.innerHTML = `<i>no module uses ${esc(c.title)}</i>`;
      return;
    }
    // The ceder corpus is ~1650 modules, so a common call matches a great many. Show the first
    // handful and say how many were held back rather than flooding the panel.
    const shown = uses.slice(0, USES_SHOWN);
    this.usesEl.innerHTML =
      `<div class="small"><b>Used by ${uses.length} module${uses.length === 1 ? '' : 's'}:</b></div>` +
      shown.map((u, i) => {
        // Say where the module START is when it is not the home square. The sequence view replays
        // every module from home, so 168 of the 294 corpus modules are danced from a board they were
        // not written for - which is the whole difference between "this sequence is broken" and "this
        // sequence starts elsewhere". One word here saves that investigation.
        const away = startsAwayFromHome(u.seq);
        const where = away ? `, from ${esc(u.seq.startFormation ?? '')}` : '';
        return `<div class="row"><button data-use="${i}" title="Open the sequence view at this call">open</button>` +
          `<span class="part">${esc(u.seq.name)} <i>(call ${u.index + 1} of ${u.seq.steps.length}${u.seq.source === 'saved' ? ', saved' : ''}${where})</i></span></div>`;
      }).join('') +
      (uses.length > shown.length ? `<div class="small"><i>… and ${uses.length - shown.length} more</i></div>` : '');
    if (shown.some((u) => startsAwayFromHome(u.seq))) {
      this.usesEl.innerHTML +=
        `<div class="small"><i>"from X" marks a module the corpus wrote for a formation other than ` +
        `home. The sequence view starts those from the formation itself, in the arrangement the corpus ` +
        `means - and REFUSES the ones whose arrangement this engine cannot build, rather than replaying ` +
        `them from the wrong board.</i></div>`;
    }
    for (const btn of this.usesEl.querySelectorAll<HTMLButtonElement>('button[data-use]')) {
      btn.addEventListener('click', () => {
        const u = shown[Number(btn.dataset.use)];
        if (u) this.host.openSequence(u.seq.steps, c.title, u.seq.startFormation);
      });
    }
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

/** Escape text that goes into innerHTML. Module names are DATA (the ceder corpus and whatever the
 * caller typed when saving), so a name containing `<` must not become markup. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}
