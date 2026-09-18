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
//
// THREE KINDS, and the third is a different shape from the other two:
//   'fix'      retarget one setup's last move to a post-call's start
//   'create'   synthesize a NEW setup between a pre-call's end and a post-call's start
//   'instance' an EDITED `<tam>` in full - start formation and its arrangement, end
//              formation, and the moves - carried as the exported XML itself, because a
//              whole instance is exactly what `callToXml` is for and re-deriving it from a
//              handful of fields would be a second, weaker representation of the same thing.
export interface CallEdit {
  kind: 'fix' | 'create' | 'instance';
  callId: string;
  setupIdx: number;
  postCallId?: string;
  postSetupIdx?: number;
  preCallId?: string;
  preSetupIdx?: number;
  name: string;
  padBeats: number;
  applied?: boolean;
  /** kind 'instance': the edited instance as taminations `<tam>` XML - expanded and
   *  full-set, exactly as `callToXml` emitted it. */
  xml?: string;
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
  private readonly levelOrder = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
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
    const post = this.loadCallBase(edit.postCallId!, edit.postSetupIdx ?? 0, true);
    const target = this.alignToSetup(editSetup, this.callStart(post));
    return correctEndTo(editSetup, target);
  }
  private rebuildCreate(edit: CallEdit): CallBundle {
    const core = this.loadCallBase(edit.callId, edit.setupIdx, true);
    const pre = this.loadCallBase(edit.preCallId!, edit.preSetupIdx ?? 0, true);
    const post = this.loadCallBase(edit.postCallId!, edit.postSetupIdx ?? 0, true);
    const start = this.alignToSetup(core, this.callEnd(pre));
    const end = this.alignToSetup(core, this.callStart(post));
    return synthesizeSetup(core, { name: edit.name, start, end, padBeats: edit.padBeats });
  }
  /**
   * Rebuild an EDITED INSTANCE from the `<tam>` XML it was saved as.
   *
   * `mirror: false`, ALWAYS, and that is not a preference. An exported instance is explicit
   * about all eight dancers, and the engine's mirror rule is geometric - it duplicates a
   * formation only while SOME 180-degree partner exists - so reading an edited formation
   * with no origin-opposite pair back with `mirror: true` returns SIXTEEN dancers.
   * `engine/test/editor.mjs` pins that measurement, and the whole reason the editor's export
   * is full-set is so that this path is unambiguous.
   */
  private rebuildInstance(edit: CallEdit): CallBundle {
    const xml = edit.xml;
    if (!xml) throw new Error(`instance edit "${edit.name}" carries no XML`);
    const tam = parseCallXml('<calls>\n' + xml + '\n</calls>')[0];
    if (!tam) throw new Error(`instance edit "${edit.name}" has no <tam>`);
    return buildCall(tam, this.formationsMap, this.movesMap, false);
  }

  /** Rebuild an edit's call bundle from its SHIP definitions (no override recursion). */
  rebuildEdit(edit: CallEdit): CallBundle {
    if (edit.kind === 'instance') return this.rebuildInstance(edit);
    return edit.kind === 'fix' ? this.rebuildFix(edit) : this.rebuildCreate(edit);
  }

  /** Load a call setup, honoring applied edit overrides (fix and instance replace, create appends). */
  loadCall(id: string, tamIndex: number, mirror = true): CallBundle {
    const entry = this.fullCatalog.find((c) => c.id === id);
    if (!entry) throw new Error(`Unknown call: ${id}`);
    const edits = this.appliedEdits().filter((e) => e.callId === id);
    const creates = edits.filter((e) => e.kind === 'create');
    const shippedCount = entry.setups.length;
    if (tamIndex < shippedCount) {
      const repl = edits.find((e) => (e.kind === 'fix' || e.kind === 'instance') && e.setupIdx === tamIndex);
      if (repl) return repl.kind === 'instance' ? this.rebuildInstance(repl) : this.rebuildFix(repl);
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
      const repl = edits.find((e) => (e.kind === 'fix' || e.kind === 'instance') && e.setupIdx === si);
      if (repl) {
        // An applied INSTANCE already IS a `<tam>`, carrying its own `sequencer` and
        // `actives` declarations, so it is registered verbatim rather than re-serialized.
        const t = repl.kind === 'instance' ? repl.xml ?? null : this.tamFromCall(this.rebuildEdit(repl));
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

  /** Calls available to a sequencer for `level` and all earlier levels.
   *
   * POOLED, HIGHEST LEVEL FIRST - and both halves are load-bearing, the same way
   * `engine/test/lib/engine-calls.mjs` `callsByTitle` documents.
   *
   * A title defined at several levels is several AUTHORINGS of the same call, and the
   * matcher resolves an equal error by registration order (`FormationMatcher.findMatchingVariant`:
   * only a strict improvement, or a non-reflected match over a reflected one, changes the
   * winner). Walking the levels ascending therefore handed every tie to the LOWEST level, and
   * `Circle Left` is the case that proves it wrong: `b1/circle.xml` authors `Forward .59` + 8x
   * `cl` and stops, so the dancer never steps back out of the circle, while `ms/circle.xml`
   * authors the round trip. Measured on All8's 188 published figures, ordering the pool this
   * way is 90 figures instead of 88, with no loss.
   *
   * Keeping only the highest level that defines a title - what this method used to do by
   * overwriting - is worse still: higher levels ADD setups rather than replace them
   * (`c1/circulate.xml` adds `Thar` and `Wrong Way Thar` and does not carry Mainstream's wave
   * setups), so it dropped 39 of the 188. */
  sequencerCallsUpTo(level: string): { name: string; xml: string }[] {
    const idx = this.levelOrder.indexOf(level);
    const maxIdx = idx >= 0 ? idx : this.levelOrder.length - 1;
    const order: string[] = [];
    const parts = new Map<string, string[]>();
    const files = new Map<string, Set<string>>();
    for (let k = maxIdx; k >= 0; k--) {
      const lv = this.levelOrder[k];
      for (const c of this.fullCatalog) {
        if (c.level !== lv) continue;
        // An ALIAS entry points at the same file as the real one, so contributing both would
        // register the identical tam twice. Keep the first (highest-level) contribution.
        const seen = files.get(c.title) ?? new Set<string>();
        if (seen.has(c.file)) continue;
        const xml = this.registrationXml(c);
        if (xml == null) continue;
        seen.add(c.file);
        files.set(c.title, seen);
        if (!parts.has(c.title)) {
          parts.set(c.title, []);
          order.push(c.title);
        }
        parts.get(c.title)!.push(xml.replace(/^\s*<calls>\s*/, '').replace(/\s*<\/calls>\s*$/, ''));
      }
    }
    return order.map((title) => ({ name: title, xml: `<calls>\n${parts.get(title)!.join('\n')}\n</calls>` }));
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
