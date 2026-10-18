// Browser data layer: discovers every per-level call XML via Vite `?raw` glob,
// plus `ssd` level aliases from calls.xml, and exposes the level-grouped
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
  alignFormationToCore,
  correctEndTo,
  synthesizeSetup,
  // The Setup label's precedence, and the file's FAMILY, are both owned by the engine so the catalog built
  // here and `callMeta` cannot drift apart.
  setupLabel,
  parseTaminationTitle,
  // The single source for the programme order. See `permissions.ts` for why the engine owns it.
  PERMISSION_LEVELS,
} from 'dancing-squared-engine';
import type { CallBundle, FormDancer } from 'dancing-squared-engine';

import movesXml from '@corpus/moves.xml?raw';
import formationsXml from '@corpus/formations.xml?raw';
import callsXml from '@corpus/src/calls.xml?raw';
// How a call is written as a `<tam>`: with an embedded start formation, or naming one the corpus carries.
import { callTamXml } from './tam-xml';
// The glob's own key -> the corpus-relative `level/base` identity this module stores in `CallInfo.file`.
import { corpusFileOf } from './corpus-key';

// Each per-level call XML is kept as its OWN async-loadable chunk (not inlined
// into the main bundle). loadCatalog() fetches them all and reports real
// download + parse progress. The `@corpus` alias is the repository's ONE corpus (`assets/` at the root, named in
// `vite.corpus.ts`), which this app used to hold under `poc/src/assets/`.
const levelLoaders = import.meta.glob<string>('@corpus/*/*.xml', {
  query: '?raw',
  import: 'default',
});

export interface CallInfo {
  id: string; // unique key shown in the UI (e.g. "ms/circle::Circle Right")
  level: string; // display level ("ms" | "plus" | ...)
  file: string; // asset file actually loaded (e.g. "ms/circle")
  title: string; // the specific call's <tam> title
  /** The `<tamination title>` of the file this call lives in - the FAMILY. `Export All` groups tams under it. */
  family: string | null;
  setups: { label: string; from: string }[];
  tamIndices: number[]; // indices into the file's <tam> list for this title
  isAlias?: boolean; // true for the synthesized `ssd` level aliases
}

// A user-authored call edit (from the call editor). `applied` means it is
// currently overriding the live call-position database.
//
// FOUR KINDS, and the difference between the last two is where the result GOES:
//   'fix'      retarget one setup's last move to a post-call's start - REPLACES that setup
//   'create'   synthesize a NEW setup between a pre-call's end and a post-call's start - ADDS one
//   'instance' an EDITED `<tam>` in full: start formation and its arrangement, end formation,
//              and the moves - carried as the exported XML itself - REPLACES that setup
//   'clone'    the same edited instance, but re-based onto a different START setup - ADDS one,
//              because a clone is a new setup of the call rather than a correction to an old one
export interface CallEdit {
  kind: 'fix' | 'create' | 'instance' | 'clone';
  callId: string;
  setupIdx: number;
  postCallId?: string;
  postSetupIdx?: number;
  preCallId?: string;
  preSetupIdx?: number;
  name: string;
  padBeats: number;
  applied?: boolean;
  /** kind 'instance' / 'clone': the edited instance as taminations `<tam>` XML - expanded and
   *  full-set, exactly as `callToXml` emitted it. */
  xml?: string;
}

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
  // THE ENGINE OWNS THE LEVEL ORDER, so the selector here and the permission layer's override order
  // cannot drift. `ssd` is listed even though it has no asset directory: it is a synthesized alias
  // level, ordered between Basic and Mainstream by `calls.xml`.
  private readonly levelOrder: readonly string[] = PERMISSION_LEVELS;
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

  private parseCatalogFile(xml: string, file: string): CallInfo[] {
    // THE FILE'S NAME IS `level/base`, WHICH IS `CallInfo.file` - see `corpus-key.ts` for why the glob's own
    // key is not used as an identity (it was `./assets/ms/circle.xml`, then `../assets/ms/circle.xml`, and every
    // lookup went on asking for the first one). Every key this is called with came from `corpusFileOf`, whose
    // two segments `poc/tools/corpus-key-probe.mjs` measures for every file in the corpus, so there is no guard
    // here for a name without a level.
    const level = file.slice(0, file.indexOf('/'));
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
    // THE FAMILY, once per file: the `<tamination title>` every call in this file is filed under, so an export
    // can group its tams the way the corpus does and be pasted back where it came from. IT READS `levelXml`, so
    // `loadCatalog` fills that map BEFORE this walk - it used to be assigned after, which made this read the
    // empty map every time and filed every exported block under nothing.
    const family = parseTaminationTitle(this.levelXml.get(file) ?? '');
    for (const [title, indices] of byTitle) {
      out.push({
        id: `${file}::${title}`,
        level,
        file,
        title,
        family,
        // THE FORMATION, NOT THE `from` LABEL - this is the list the Setup dropdown shows, and it is built HERE
        // rather than through `callMeta` (this walk needs the tam INDICES as well as the labels, so it reads
        // the file itself). `setupLabel` is the one place that decides the precedence, so the two reads agree.
        setups: indices.map((i) => ({ label: setupLabel(tams[i].formationAttr, tams[i].from), from: tams[i].from })),
        tamIndices: indices,
      });
    }
    return out;
  }

  /**
   * Synthesize the `ssd` level from `calls.xml`'s own links.
   *
   * WHY ONLY `ssd`. `ssd` is the one level the corpus carries no directory for: it is a VIEW of calls
   * that are authored under `ms`/`plus`/`a1`, and `calls.xml` says which basename each of its entries
   * comes from. `b1` and `b2` used to be synthesized here the same way; both directories were removed
   * when the Basic levels were retired in favour of `ms` 2026, and their `calls.xml` links are upstream
   * history that must no longer conjure the levels back. Measured before dropping them: every `b1`/`b2`
   * basename resolves at `ms`/`plus`/`a1`, so nothing is lost - and the four calls that existed ONLY
   * under `b1`/`b2` were migrated into `ms/` first.
   */
  private buildAliases(catalog: CallInfo[], xmlMap: Map<string, string>): CallInfo[] {
    const aliases: CallInfo[] = [];
    const doc = new DOMParser().parseFromString(callsXml, 'application/xml');
    for (const call of Array.from(doc.getElementsByTagName('call'))) {
      const link = call.getAttribute('link') || '';
      const m = /^(ssd)\/([^?]+)/.exec(link);
      if (!m) continue;
      const level = m[1];
      const base = m[2];
      if (xmlMap.has(`${level}/${base}`)) continue;
      for (const found of catalog.filter((c) => c.file.split('/')[1] === base)) {
        const id = `${level}/${base}::${found.title}`;
        if (aliases.some((a) => a.id === id)) continue;
        aliases.push({
          id,
          level,
          file: found.file,
          title: found.title,
          family: found.family,
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
            // THE KEY IS THE FILE'S CORPUS NAME, not the glob's path: see `corpus-key.ts`.
            const file = corpusFileOf(p);
            if (file) {
              try {
                xmlMap.set(file, await levelLoaders[p]());
              } catch {
                // Skip a file that failed to load.
              }
            }
            done++;
            onProgress?.('download', done / total);
          }
        };
        await Promise.all(Array.from({ length: Math.min(POOL, total) }, () => worker()));
        // THE MAP IS PUBLISHED BEFORE THE WALK, because `parseCatalogFile` reads the file's FAMILY out of it (the
        // `<tamination title>` an export files a block under). It was assigned AFTER the walk until this fix -
        // `0d76cbd^` did the same, so this is not a regression the corpus move introduced - which left that read
        // on an empty map and every call's `family` empty, so an export had nothing to file a block under.
        this.levelXml = xmlMap;
        const catalog: CallInfo[] = [];
        for (const [file, xml] of xmlMap) {
          catalog.push(...this.parseCatalogFile(xml, file));
        }
        catalog.sort((a, b) => this.byLevelThenTitle(a, b));
        const aliases = this.buildAliases(catalog, xmlMap);
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

  /** Effective setup labels for a call, including any applied CREATE positions and CLONES. */
  effectiveSetups(callId: string): { label: string; from: string }[] {
    const entry = this.fullCatalog.find((c) => c.id === callId);
    const base = entry ? [...entry.setups] : [];
    for (const e of this.appliedEdits()) {
      if ((e.kind === 'create' || e.kind === 'clone') && e.callId === callId) base.push({ label: e.name, from: e.name });
    }
    return base;
  }

  // ---- call loading ----

  private loadCallBase(id: string, tamIndex: number, mirror = true): CallBundle {
    const entry = this.fullCatalog.find((c) => c.id === id);
    if (!entry) throw new Error(`Unknown call: ${id}`);
    const xml = this.levelXml.get(entry.file);
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
   * THE DECLARATION DECIDES THE SIZE, and that is the change the `asymmetric` selector forced. This
   * used to pass `mirror: false` unconditionally, because the editor's export was ALWAYS a whole set
   * and the engine's completion rule was geometric - it duplicates a formation only while SOME
   * 180-degree partner exists - so reading a whole set with no origin-opposite pair back with
   * `mirror: true` returned SIXTEEN dancers. `engine/test/editor.mjs` pinned that.
   *
   * `mirror` is now the caller's PERMISSION to complete, and whether the completion happens is the
   * tam's own `asymmetric` declaration: `buildCallImpl` completes only when `mirror && symmetry === 2`.
   * So passing `true` is safe for a whole-set export (it declares `asymmetric="true"`, symmetry 1, and
   * the guard refuses) and NECESSARY for a half-set one, which is four dancers in the text and eight in
   * the call. Passing `false` here would now read a half-set export back as four dancers and silently
   * break the edit.
   */
  private rebuildInstance(edit: CallEdit): CallBundle {
    const xml = edit.xml;
    if (!xml) throw new Error(`instance edit "${edit.name}" carries no XML`);
    const tam = parseCallXml('<calls>\n' + xml + '\n</calls>')[0];
    if (!tam) throw new Error(`instance edit "${edit.name}" has no <tam>`);
    return buildCall(tam, this.formationsMap, this.movesMap, true);
  }

  /** Rebuild an edit's call bundle from its SHIP definitions (no override recursion). */
  rebuildEdit(edit: CallEdit): CallBundle {
    if (edit.kind === 'instance' || edit.kind === 'clone') return this.rebuildInstance(edit);
    return edit.kind === 'fix' ? this.rebuildFix(edit) : this.rebuildCreate(edit);
  }

  /** Load a call setup, honoring applied edit overrides (fix and instance replace, create and
   *  clone append). */
  loadCall(id: string, tamIndex: number, mirror = true): CallBundle {
    const entry = this.fullCatalog.find((c) => c.id === id);
    if (!entry) throw new Error(`Unknown call: ${id}`);
    const edits = this.appliedEdits().filter((e) => e.callId === id);
    // APPENDED in the order `effectiveSetups` lists them, or the index a caller got from the
    // Setup select would name a different setup here.
    const appended = edits.filter((e) => e.kind === 'create' || e.kind === 'clone');
    const shippedCount = entry.setups.length;
    if (tamIndex < shippedCount) {
      const repl = edits.find((e) => (e.kind === 'fix' || e.kind === 'instance') && e.setupIdx === tamIndex);
      if (repl) return repl.kind === 'instance' ? this.rebuildInstance(repl) : this.rebuildFix(repl);
      return this.loadCallBase(id, tamIndex, mirror);
    }
    const added = appended[tamIndex - shippedCount];
    if (added) return added.kind === 'clone' ? this.rebuildInstance(added) : this.rebuildCreate(added);
    return this.loadCallBase(id, Math.max(0, shippedCount - 1), mirror);
  }

  // ---- sequencer registration ----

  private tamFromCall(call: CallBundle): string | null {
    const m = callTamXml(call).match(/<tam\b[\s\S]*?<\/tam>/s);
    return m ? m[0] : null;
  }
  private registrationXml(entry: CallInfo): string | null {
    const xml = this.levelXml.get(entry.file);
    if (xml == null) return null;
    // COMMENTS OUT, BEFORE INDEXING. `entry.tamIndices` is computed by `parseCatalogFile` with a DOM
    // walk, which does NOT return a `<tam>` inside `<!-- -->`; this regex reads the RAW TEXT and does.
    // So the moment a tam ahead of a title is commented out the two lists drift by one and this hands
    // the library the WRONG tam for the title - reported as the sequencer using "Facing Dancers Far"
    // for `Single Circle Left Full` from a board that is plain `Facing Dancers`. Stripping the comments
    // first makes these `blocks` the same list, in the same order, that the indices were built against.
    const blocks = xml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
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
      // A CLONE is registered the same way, but as its own setup - which is what it is.
      if (e.kind === 'create') {
        const t = this.tamFromCall(this.rebuildEdit(e));
        if (t) out.push(t);
      } else if (e.kind === 'clone' && e.xml) {
        out.push(e.xml);
      }
    }
    if (out.length === 0) return null;
    return '<calls>\n' + out.join('\n') + '\n</calls>';
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
export function sequencerCallsUpTo(level: string): { name: string; xml: string }[] {
  return catalog.sequencerCallsUpTo(level);
}
export const movesXmlText = movesXml;
export const formationsXmlText = formationsXml;
