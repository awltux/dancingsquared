// Browser data layer: discovers every per-level call XML via Vite `?raw` glob,
// plus b1/b2/ssd level aliases from calls.xml, and exposes the level-grouped
// catalog + loader. Keeps convert.ts bundler agnostic.
//
// Many files bundle several distinct calls (e.g. circle.xml contains "Circle
// Left", "Circle Right", "Circle Four Left 1/4", ...). Each distinct <tam>
// title is exposed as its own call, so secondary calls aren't hidden under the
// file's first title.
//
// The catalog state lives in a single `Catalog` instance; the module-level
// functions are thin facades kept for backward compatibility with the app's
// controllers (main.ts, sequencer-ui.ts, editor-ui.ts, browser.ts).

import {
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  poseFor,
  rigidFit,
  alignFormationToCore,
  correctEndTo,
  synthesizeSetup,
  callToXml,
} from 'dancing-squared-engine';
import type { CallBundle, FormDancer } from 'dancing-squared-engine';

import movesXml from './assets/moves.xml?raw';
import formationsXml from './assets/formations.xml?raw';
import callsXml from './assets/src/calls.xml?raw';

// Each per-level call XML is kept as its OWN async-loadable chunk (not inlined
// into the main bundle). loadCatalog() fetches them all and reports real
// download + parse progress.
const levelLoaders = import.meta.glob<string>('./assets/*/*.xml', {
  query: '?raw',
  import: 'default',
});

export interface CallInfo {
  id: string; // unique key shown in the UI (e.g. "b1/circle::Circle Right")
  level: string; // display level ("b1" | "ms" | ...)
  file: string; // asset file actually loaded (e.g. "b1/circle")
  title: string; // the specific call's <tam> title
  setups: { label: string; from: string }[];
  tamIndices: number[]; // indices into the file's <tam> list for this title
  isAlias?: boolean; // true for b1/b2/ssd level aliases
}

// A user-authored call edit (from the call editor). `applied` means it is
// currently overriding the live call-position database.
export interface CallEdit {
  kind: 'fix' | 'create';
  callId: string;
  setupIdx: number;
  postCallId: string;
  postSetupIdx: number;
  preCallId?: string;
  preSetupIdx?: number;
  name: string;
  padBeats: number;
  applied?: boolean;
}

export interface ClosureCandidate {
  id: string;
  level: string;
  title: string;
  spreadDeg: number; // spread of per-dancer heading residuals (degrees)
  posErr: number; // round-trip position error
}

const normDeg = (a: number) => {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

/** Browser call catalog: owns the level-grouped catalog, the call XML map, and
 * edit-override persistence. A single shared instance is created at module load. */
export class Catalog {
  private readonly levelOrder = ['b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
  // Bump whenever the bundled call data changes: applied edit override flags
  // are cleared so the live catalog returns to the shipped version.
  private readonly dataVersion = '5';
  private readonly editsKey = 'dsSetups';
  private readonly versionKey = 'dsDataVersion';

  private readonly movesMap = parseMoves(movesXml);
  private readonly formationsMap = parseFormations(formationsXml);
  private fullCatalog: CallInfo[] = [];
  private levelXml = new Map<string, string>();
  private loadPromise: Promise<void> | null = null;

  /** Raw moves/formations XML strings (for the sequencer). */
  readonly movesXmlText = movesXml;
  readonly formationsXmlText = formationsXml;

  private byLevelThenTitle(a: CallInfo, b: CallInfo): number {
    const l = this.levelOrder.indexOf(a.level) - this.levelOrder.indexOf(b.level);
    return l !== 0 ? l : a.title.localeCompare(b.title);
  }

  private parseCatalogFile(xml: string, path: string): CallInfo[] {
    const m = /\.\/assets\/([^/]+)\/([^/]+)\.xml$/.exec(path);
    if (!m) return [];
    const level = m[1];
    const base = m[2];
    const file = `${level}/${base}`;
    let tams;
    try {
      tams = parseCallXml(xml);
    } catch {
      return [];
    }
    if (tams.length === 0) return [];
    const byTitle = new Map<string, number[]>();
    tams.forEach((t, i) => {
      const key = t.title || file;
      const arr = byTitle.get(key) ?? [];
      arr.push(i);
      byTitle.set(key, arr);
    });
    const out: CallInfo[] = [];
    for (const [title, indices] of byTitle) {
      out.push({
        id: `${file}::${title}`,
        level,
        file,
        title,
        setups: indices.map((i) => ({ label: tams[i].from || '(default)', from: tams[i].from })),
        tamIndices: indices,
      });
    }
    return out;
  }

  private buildAliases(catalog: CallInfo[], xmlMap: Map<string, string>): CallInfo[] {
    const aliases: CallInfo[] = [];
    const doc = new DOMParser().parseFromString(callsXml, 'application/xml');
    for (const call of Array.from(doc.getElementsByTagName('call'))) {
      const link = call.getAttribute('link') || '';
      const m = /^(b1|b2|ssd)\/([^?]+)/.exec(link);
      if (!m) continue;
      const level = m[1];
      const base = m[2];
      if (xmlMap.has(`./assets/${level}/${base}.xml`)) continue;
      for (const found of catalog.filter((c) => c.file.split('/')[1] === base)) {
        const id = `${level}/${base}::${found.title}`;
        if (aliases.some((a) => a.id === id)) continue;
        aliases.push({
          id,
          level,
          file: found.file,
          title: found.title,
          setups: found.setups,
          tamIndices: found.tamIndices,
          isAlias: true,
        });
      }
    }
    aliases.sort((a, b) => this.byLevelThenTitle(a, b));
    return aliases;
  }

  /** Load the catalog over the network with real progress. Idempotent. */
  loadCatalog(onProgress?: (phase: 'download' | 'parse', frac: number) => void): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const paths = Object.keys(levelLoaders).sort();
        const xmlMap = new Map<string, string>();
        const POOL = 6;
        const total = paths.length;
        let next = 0;
        let done = 0;
        const worker = async () => {
          while (next < total) {
            const p = paths[next++];
            try {
              xmlMap.set(p, await levelLoaders[p]());
            } catch {
              // Skip a file that failed to load.
            }
            done++;
            onProgress?.('download', done / total);
          }
        };
        await Promise.all(Array.from({ length: Math.min(POOL, total) }, () => worker()));
        const catalog: CallInfo[] = [];
        for (const [path, xml] of xmlMap) {
          catalog.push(...this.parseCatalogFile(xml, path));
        }
        catalog.sort((a, b) => this.byLevelThenTitle(a, b));
        const aliases = this.buildAliases(catalog, xmlMap);
        this.levelXml = xmlMap;
        this.fullCatalog = [...catalog, ...aliases].sort((a, b) => this.byLevelThenTitle(a, b));
        onProgress?.('parse', 1);
      })();
    }
    return this.loadPromise;
  }

  availableCalls(): CallInfo[] {
    return this.fullCatalog;
  }

  availableLevels(): string[] {
    return this.levelOrder.filter((lv) => this.fullCatalog.some((c) => c.level === lv));
  }

  // ---- edits ----

  loadEdits(): CallEdit[] {
    let list: CallEdit[] = [];
    try {
      list = JSON.parse(storageGet(this.editsKey) || '[]') as CallEdit[];
    } catch {
      list = [];
    }
    if (storageGet(this.versionKey) !== this.dataVersion) {
      for (const e of list) e.applied = false;
      storageSet(this.versionKey, this.dataVersion);
      this.persistEdits(list);
    }
    return list;
  }

  persistEdits(list: CallEdit[]) {
    storageSet(this.editsKey, JSON.stringify(list));
  }

  appliedEdits(): CallEdit[] {
    return this.loadEdits().filter((e) => e.applied);
  }

  /** Mark an edit as overriding the live DB (or remove that override). */
  setApplied(edit: CallEdit, on: boolean) {
    const list = this.loadEdits();
    const found = list.find((e) => e.name === edit.name && e.kind === edit.kind && e.callId === edit.callId && e.setupIdx === edit.setupIdx);
    if (found) {
      found.applied = on;
      this.persistEdits(list);
    }
  }

  /** Effective setup labels for a call, including any applied CREATE positions. */
  effectiveSetups(callId: string): { label: string; from: string }[] {
    const entry = this.fullCatalog.find((c) => c.id === callId);
    const base = entry ? [...entry.setups] : [];
    for (const e of this.appliedEdits()) {
      if (e.kind === 'create' && e.callId === callId) base.push({ label: e.name, from: e.name });
    }
    return base;
  }

  // ---- call loading ----

  private loadCallBase(id: string, tamIndex: number, mirror = true): CallBundle {
    const entry = this.fullCatalog.find((c) => c.id === id);
    if (!entry) throw new Error(`Unknown call: ${id}`);
    const xml = this.levelXml.get(`./assets/${entry.file}.xml`);
    if (xml == null) throw new Error(`Missing XML for ${entry.file}`);
    const tams = parseCallXml(xml);
    const fileIdx = entry.tamIndices[tamIndex] ?? entry.tamIndices[0];
    const tam = tams[fileIdx];
    if (!tam) throw new Error(`No setup for ${entry.title}`);
    return buildCall(tam, this.formationsMap, this.movesMap, mirror);
  }

  private callStart(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private callEnd(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, c.beats);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private alignToSetup(c: CallBundle, formation: FormDancer[]): FormDancer[] {
    return alignFormationToCore(this.callStart(c), formation);
  }
  private rebuildFix(edit: CallEdit): CallBundle {
    const editSetup = this.loadCallBase(edit.callId, edit.setupIdx, true);
    const post = this.loadCallBase(edit.postCallId, edit.postSetupIdx, true);
    const target = this.alignToSetup(editSetup, this.callStart(post));
    return correctEndTo(editSetup, target);
  }
  private rebuildCreate(edit: CallEdit): CallBundle {
    const core = this.loadCallBase(edit.callId, edit.setupIdx, true);
    const pre = this.loadCallBase(edit.preCallId!, edit.preSetupIdx ?? 0, true);
    const post = this.loadCallBase(edit.postCallId, edit.postSetupIdx, true);
    const start = this.alignToSetup(core, this.callEnd(pre));
    const end = this.alignToSetup(core, this.callStart(post));
    return synthesizeSetup(core, { name: edit.name, start, end, padBeats: edit.padBeats });
  }

  /** Rebuild an edit's call bundle from its SHIP definitions (no override recursion). */
  rebuildEdit(edit: CallEdit): CallBundle {
    return edit.kind === 'fix' ? this.rebuildFix(edit) : this.rebuildCreate(edit);
  }

  /** Load a call setup, honoring applied edit overrides (fix replaces, create appends). */
  loadCall(id: string, tamIndex: number, mirror = true): CallBundle {
    const entry = this.fullCatalog.find((c) => c.id === id);
    if (!entry) throw new Error(`Unknown call: ${id}`);
    const edits = this.appliedEdits().filter((e) => e.callId === id);
    const creates = edits.filter((e) => e.kind === 'create');
    const shippedCount = entry.setups.length;
    if (tamIndex < shippedCount) {
      const fix = edits.find((e) => e.kind === 'fix' && e.setupIdx === tamIndex);
      if (fix) return this.rebuildFix(fix);
      return this.loadCallBase(id, tamIndex, mirror);
    }
    const create = creates[tamIndex - shippedCount];
    if (create) return this.rebuildCreate(create);
    return this.loadCallBase(id, Math.max(0, shippedCount - 1), mirror);
  }

  // ---- closure scan ----

  /** Scan the catalog for calls that don't "close cleanly". */
  closureScan(): ClosureCandidate[] {
    const out: ClosureCandidate[] = [];
    for (const c of this.fullCatalog) {
      if (c.isAlias) continue;
      let call: CallBundle;
      try {
        call = this.loadCallBase(c.id, 0, true);
      } catch {
        continue;
      }
      const start = call.dancers.map((d) => {
        const p = poseFor(d, 0);
        return { x: p.x, y: p.y, heading: p.heading };
      });
      const end = call.dancers.map((d) => {
        const p = poseFor(d, call.beats);
        return { x: p.x, y: p.y, heading: p.heading };
      });
      const fit = rigidFit(start, end);
      if (fit.error > 2.0) continue;
      const resid = end.map((e, i) => normDeg((e.heading - start[i].heading) * 180 / Math.PI));
      const spread = Math.max(...resid) - Math.min(...resid);
      if (spread > 20 && spread < 80) {
        out.push({ id: c.id, level: c.level, title: c.title, spreadDeg: +spread.toFixed(1), posErr: +fit.error.toFixed(2) });
      }
    }
    out.sort((a, b) => b.spreadDeg - a.spreadDeg);
    return out;
  }

  // ---- sequencer registration ----

  private tamFromCall(call: CallBundle): string | null {
    const m = callToXml(call).match(/<tam\b[\s\S]*?<\/tam>/s);
    return m ? m[0] : null;
  }
  private registrationXml(entry: CallInfo): string | null {
    const xml = this.levelXml.get(`./assets/${entry.file}.xml`);
    if (xml == null) return null;
    const blocks = xml.match(/<tam\b[\s\S]*?<\/tam>/g) || [];
    const edits = this.appliedEdits().filter((e) => e.callId === entry.id);
    const out: string[] = [];
    for (let si = 0; si < entry.tamIndices.length; si++) {
      const fileIdx = entry.tamIndices[si];
      const fix = edits.find((e) => e.kind === 'fix' && e.setupIdx === si);
      if (fix) {
        const t = this.tamFromCall(this.rebuildEdit(fix));
        if (t) out.push(t);
      } else if (blocks[fileIdx]) {
        out.push(blocks[fileIdx]);
      }
    }
    for (const e of edits) {
      if (e.kind === 'create') {
        const t = this.tamFromCall(this.rebuildEdit(e));
        if (t) out.push(t);
      }
    }
    if (out.length === 0) return null;
    return '<calls>\n' + out.join('\n') + '\n</calls>';
  }

  /** The real (non-alias) call XMLs for a level, keyed by display title. */
  levelCalls(level: string): { name: string; xml: string }[] {
    const out: { name: string; xml: string }[] = [];
    for (const c of this.fullCatalog) {
      if (c.level !== level || c.isAlias) continue;
      const xml = this.registrationXml(c);
      if (xml != null) out.push({ name: c.title, xml });
    }
    return out;
  }

  /** All call XMLs for a level, INCLUDING alias levels, deduplicated by title. */
  sequencerCalls(level: string): { name: string; xml: string }[] {
    const seen = new Set<string>();
    const out: { name: string; xml: string }[] = [];
    for (const c of this.fullCatalog) {
      if (c.level !== level) continue;
      if (seen.has(c.title)) continue;
      seen.add(c.title);
      const xml = this.registrationXml(c);
      if (xml != null) out.push({ name: c.title, xml });
    }
    return out;
  }

  /** Calls available to a sequencer for `level` and all earlier levels. */
  sequencerCallsUpTo(level: string): { name: string; xml: string }[] {
    const idx = this.levelOrder.indexOf(level);
    const maxIdx = idx >= 0 ? idx : this.levelOrder.length - 1;
    const order: string[] = [];
    const best = new Map<string, { xml: string }>();
    for (let k = 0; k <= maxIdx; k++) {
      const lv = this.levelOrder[k];
      for (const c of this.fullCatalog) {
        if (c.level !== lv) continue;
        const xml = this.registrationXml(c);
        if (xml == null) continue;
        if (!best.has(c.title)) order.push(c.title);
        best.set(c.title, { xml });
      }
    }
    return order.map((title) => ({ name: title, xml: best.get(title)!.xml }));
  }
}

// ---------------------------------------------------------------- shared instance + facades

const catalog = new Catalog();

export async function loadCatalog(onProgress?: (phase: 'download' | 'parse', frac: number) => void): Promise<void> {
  return catalog.loadCatalog(onProgress);
}
export function availableCalls(): CallInfo[] {
  return catalog.availableCalls();
}
export function availableLevels(): string[] {
  return catalog.availableLevels();
}
export function loadEdits(): CallEdit[] {
  return catalog.loadEdits();
}
export function persistEdits(list: CallEdit[]) {
  catalog.persistEdits(list);
}
export function appliedEdits(): CallEdit[] {
  return catalog.appliedEdits();
}
export function setApplied(edit: CallEdit, on: boolean) {
  catalog.setApplied(edit, on);
}
export function effectiveSetups(callId: string): { label: string; from: string }[] {
  return catalog.effectiveSetups(callId);
}
export function rebuildEdit(edit: CallEdit): CallBundle {
  return catalog.rebuildEdit(edit);
}
export function loadCall(id: string, tamIndex: number, mirror = true): CallBundle {
  return catalog.loadCall(id, tamIndex, mirror);
}
export function closureScan(): ClosureCandidate[] {
  return catalog.closureScan();
}
export function levelCalls(level: string): { name: string; xml: string }[] {
  return catalog.levelCalls(level);
}
export function sequencerCalls(level: string): { name: string; xml: string }[] {
  return catalog.sequencerCalls(level);
}
export function sequencerCallsUpTo(level: string): { name: string; xml: string }[] {
  return catalog.sequencerCallsUpTo(level);
}
export const movesXmlText = movesXml;
export const formationsXmlText = formationsXml;
