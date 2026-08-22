// Browser data layer: discovers every per-level call XML via Vite `?raw` glob,
// plus b1/b2/ssd level aliases from calls.xml, and exposes the level-grouped
// catalog + loader. Keeps convert.ts bundler agnostic.
//
// Many files bundle several distinct calls (e.g. circle.xml contains "Circle
// Left", "Circle Right", "Circle Four Left 1/4", ...). Each distinct <tam>
// title is exposed as its own call, so secondary calls aren't hidden under the
// file's first title.
//
// EDIT OVERRIDES: user-authored call edits (see CallEdit) can be "applied to
// the live call-position database". Applied edits are stored with an `applied`
// flag that is RESET whenever the data version changes (an app update), so the
// live catalog reverts to the shipped version while the local edit definitions
// are preserved for re-applying.

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

// All level call files: ./assets/<level>/<call>.xml  (root moves/formations are
// deliberately excluded by the `*/*` pattern).
const levelFiles = import.meta.glob<string>('./assets/*/*.xml', {
  query: '?raw',
  import: 'default',
  eager: true,
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

// b1/b2/ssd (Basic 1/2, Standard Square Dance) come before Mainstream.
const LEVEL_ORDER = ['b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];

// Bump this whenever the bundled call data changes: applied edit override flags
// are cleared so the live catalog returns to the shipped version.
const DATA_VERSION = '1';

// Parse the shared moves/formations once.
const movesMap = parseMoves(movesXml);
const formationsMap = parseFormations(formationsXml);

// Build the catalog: one entry per distinct <tam> title within a file.
const catalog: CallInfo[] = [];
for (const [path, xml] of Object.entries(levelFiles)) {
  const m = /\.\/assets\/([^/]+)\/([^/]+)\.xml$/.exec(path);
  if (!m) continue;
  const level = m[1];
  const base = m[2];
  const file = `${level}/${base}`;
  let tams;
  try {
    tams = parseCallXml(xml);
  } catch {
    continue;
  }
  if (tams.length === 0) continue; // skip non-call files (no <tam>)

  const byTitle = new Map<string, number[]>();
  tams.forEach((t, i) => {
    const key = t.title || file;
    const arr = byTitle.get(key) ?? [];
    arr.push(i);
    byTitle.set(key, arr);
  });
  for (const [title, indices] of byTitle) {
    catalog.push({
      id: `${file}::${title}`,
      level,
      file,
      title,
      setups: indices.map((i) => ({ label: tams[i].from || '(default)', from: tams[i].from })),
      tamIndices: indices,
    });
  }
}
catalog.sort(byLevelThenTitle);

function byLevelThenTitle(a: CallInfo, b: CallInfo): number {
  const l = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
  return l !== 0 ? l : a.title.localeCompare(b.title);
}

// b1/b2/ssd: real b1/b2 animation files are bundled; ssd has no directory in the
// data and is the same as ms, so it is added as a level alias that loads the
// shared ms/plus file for the matching call basename. Aliases carry over every
// distinct title in the target file.
function buildBasicAliases(): CallInfo[] {
  const aliases: CallInfo[] = [];
  const doc = new DOMParser().parseFromString(callsXml, 'application/xml');
  for (const call of Array.from(doc.getElementsByTagName('call'))) {
    const link = call.getAttribute('link') || '';
    const m = /^(b1|b2|ssd)\/([^?]+)/.exec(link);
    if (!m) continue;
    const level = m[1];
    const base = m[2];
    if (levelFiles[`./assets/${level}/${base}.xml`] != null) continue; // real file bundled
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
  aliases.sort(byLevelThenTitle);
  return aliases;
}

const basicAliases = buildBasicAliases();

// Full catalog: real per-level files + the b1/b2/ssd aliases.
const fullCatalog: CallInfo[] = [...catalog, ...basicAliases].sort(byLevelThenTitle);

export function availableCalls(): CallInfo[] {
  return fullCatalog;
}

export function availableLevels(): string[] {
  return LEVEL_ORDER.filter((lv) => fullCatalog.some((c) => c.level === lv));
}

// ------------------------------------------------------------ call loading
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

// ------------------------------------------------------------------ edits

const EDITS_KEY = 'dsSetups';
const VERSION_KEY = 'dsDataVersion';

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

export function loadEdits(): CallEdit[] {
  let list: CallEdit[] = [];
  try {
    list = JSON.parse(storageGet(EDITS_KEY) || '[]') as CallEdit[];
  } catch {
    list = [];
  }
  // On an app/data update the override flags reset (local edits themselves persist).
  if (storageGet(VERSION_KEY) !== DATA_VERSION) {
    for (const e of list) e.applied = false;
    storageSet(VERSION_KEY, DATA_VERSION);
    persistEdits(list);
  }
  return list;
}
export function persistEdits(list: CallEdit[]) {
  storageSet(EDITS_KEY, JSON.stringify(list));
}
export function appliedEdits(): CallEdit[] {
  return loadEdits().filter((e) => e.applied);
}
/** Mark an edit as overriding the live DB (or remove that override). */
export function setApplied(edit: CallEdit, on: boolean) {
  const list = loadEdits();
  const found = list.find((e) => e.name === edit.name && e.kind === edit.kind && e.callId === edit.callId && e.setupIdx === edit.setupIdx);
  if (found) {
    found.applied = on;
    persistEdits(list);
  }
}
/** Effective setup labels for a call, including any applied CREATE positions. */
export function effectiveSetups(callId: string): { label: string; from: string }[] {
  const entry = fullCatalog.find((c) => c.id === callId);
  const base = entry ? [...entry.setups] : [];
  for (const e of appliedEdits()) {
    if (e.kind === 'create' && e.callId === callId) base.push({ label: e.name, from: e.name });
  }
  return base;
}

// Ship-based loader (ignores edit overrides).
function loadCallBase(id: string, tamIndex: number, mirror = true): CallBundle {
  const entry = fullCatalog.find((c) => c.id === id);
  if (!entry) throw new Error(`Unknown call: ${id}`);
  const xml = levelFiles[`./assets/${entry.file}.xml`];
  if (xml == null) throw new Error(`Missing XML for ${entry.file}`);
  const tams = parseCallXml(xml);
  const fileIdx = entry.tamIndices[tamIndex] ?? entry.tamIndices[0];
  const tam = tams[fileIdx];
  if (!tam) throw new Error(`No setup for ${entry.title}`);
  return buildCall(tam, formationsMap, movesMap, mirror);
}

// ---- rebuild helpers (operate on SHIP versions to avoid recursion) ----
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
function alignToSetup(c: CallBundle, formation: FormDancer[]): FormDancer[] {
  return alignFormationToCore(callStart(c), formation);
}
function rebuildFix(edit: CallEdit): CallBundle {
  const editSetup = loadCallBase(edit.callId, edit.setupIdx, true);
  const post = loadCallBase(edit.postCallId, edit.postSetupIdx, true);
  const target = alignToSetup(editSetup, callStart(post));
  return correctEndTo(editSetup, target);
}
function rebuildCreate(edit: CallEdit): CallBundle {
  const core = loadCallBase(edit.callId, edit.setupIdx, true);
  const pre = loadCallBase(edit.preCallId!, edit.preSetupIdx ?? 0, true);
  const post = loadCallBase(edit.postCallId, edit.postSetupIdx, true);
  const start = alignToSetup(core, callEnd(pre));
  const end = alignToSetup(core, callStart(post));
  return synthesizeSetup(core, { name: edit.name, start, end, padBeats: edit.padBeats });
}
/** Rebuild an edit's call bundle from its SHIP definitions (no override recursion). */
export function rebuildEdit(edit: CallEdit): CallBundle {
  return edit.kind === 'fix' ? rebuildFix(edit) : rebuildCreate(edit);
}

/** Load a call setup, honoring applied edit overrides (fix replaces, create appends). */
export function loadCall(id: string, tamIndex: number, mirror = true): CallBundle {
  const entry = fullCatalog.find((c) => c.id === id);
  if (!entry) throw new Error(`Unknown call: ${id}`);
  const edits = appliedEdits().filter((e) => e.callId === id);
  const creates = edits.filter((e) => e.kind === 'create');
  const shippedCount = entry.setups.length;
  if (tamIndex < shippedCount) {
    const fix = edits.find((e) => e.kind === 'fix' && e.setupIdx === tamIndex);
    if (fix) return rebuildFix(fix);
    return loadCallBase(id, tamIndex, mirror);
  }
  const create = creates[tamIndex - shippedCount];
  if (create) return rebuildCreate(create);
  return loadCallBase(id, Math.max(0, shippedCount - 1), mirror);
}

/** Raw moves/formations XML strings (for the sequencer). */
export const movesXmlText = movesXml;
export const formationsXmlText = formationsXml;

// ------------------------------------------------------------------ closure scan

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

/**
 * Scan the catalog for calls that don't "close cleanly": their end SHAPE matches
 * their start (a round-trip call that should return dancers home), but the
 * dancers' headings rotate incoherently (some +44deg, some 0deg), leaving the set
 * misaligned. Returns candidates sorted by how suspicious the spread is.
 */
export function closureScan(): ClosureCandidate[] {
  const out: ClosureCandidate[] = [];
  for (const c of fullCatalog) {
    if (c.isAlias) continue; // aliases duplicate real data
    let call: CallBundle;
    try {
      call = loadCallBase(c.id, 0, true);
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
    if (fit.error > 2.0) continue; // end shape differs -> legitimately different formation
    const resid = end.map((e, i) => normDeg((e.heading - start[i].heading) * 180 / Math.PI));
    const spread = Math.max(...resid) - Math.min(...resid);
    // Suspicious = incoherent (not a clean 90deg designed difference).
    if (spread > 20 && spread < 80) {
      out.push({ id: c.id, level: c.level, title: c.title, spreadDeg: +spread.toFixed(1), posErr: +fit.error.toFixed(2) });
    }
  }
  out.sort((a, b) => b.spreadDeg - a.spreadDeg);
  return out;
}

// Build the XML a sequencer should register for a call title, HONORING applied
// edits: a `fix` replaces that setup's <tam>, a `create` appends a new <tam>.
function tamFromCall(call: CallBundle): string | null {
  const m = callToXml(call).match(/<tam\b[\s\S]*?<\/tam>/s);
  return m ? m[0] : null;
}
function registrationXml(entry: CallInfo): string | null {
  const xml = levelFiles[`./assets/${entry.file}.xml`];
  if (xml == null) return null;
  const blocks = xml.match(/<tam\b[\s\S]*?<\/tam>/g) || [];
  const edits = appliedEdits().filter((e) => e.callId === entry.id);
  const out: string[] = [];
  for (let si = 0; si < entry.tamIndices.length; si++) {
    const fileIdx = entry.tamIndices[si];
    const fix = edits.find((e) => e.kind === 'fix' && e.setupIdx === si);
    if (fix) {
      const t = tamFromCall(rebuildEdit(fix));
      if (t) out.push(t);
    } else if (blocks[fileIdx]) {
      out.push(blocks[fileIdx]);
    }
  }
  for (const e of edits) {
    if (e.kind === 'create') {
      const t = tamFromCall(rebuildEdit(e));
      if (t) out.push(t);
    }
  }
  if (out.length === 0) return null;
  return '<calls>\n' + out.join('\n') + '\n</calls>';
}

/** The real (non-alias) call XMLs for a level, keyed by display title. */
export function levelCalls(level: string): { name: string; xml: string }[] {
  const out: { name: string; xml: string }[] = [];
  for (const c of fullCatalog) {
    if (c.level !== level || c.isAlias) continue;
    const xml = registrationXml(c);
    if (xml != null) out.push({ name: c.title, xml });
  }
  return out;
}

/** All call XMLs for a level, INCLUDING alias levels (e.g. ssd -> ms/plus),
 * deduplicated by title. Used by the sequencer so alias levels are usable. */
export function sequencerCalls(level: string): { name: string; xml: string }[] {
  const seen = new Set<string>();
  const out: { name: string; xml: string }[] = [];
  for (const c of fullCatalog) {
    if (c.level !== level) continue;
    if (seen.has(c.title)) continue;
    seen.add(c.title);
    const xml = registrationXml(c);
    if (xml != null) out.push({ name: c.title, xml });
  }
  return out;
}

/** Calls available to a sequencer for `level`: the union of that level AND all
 * earlier levels (levels build on each other — e.g. B2 includes B1, MS includes
 * B1/B2/SSD), deduplicated by title. Unlike browse, where only the calls
 * specific to the selected level are shown. */
export function sequencerCallsUpTo(level: string): { name: string; xml: string }[] {
  const idx = LEVEL_ORDER.indexOf(level);
  const maxIdx = idx >= 0 ? idx : LEVEL_ORDER.length - 1;
  const seen = new Set<string>();
  const out: { name: string; xml: string }[] = [];
  for (let k = 0; k <= maxIdx; k++) {
    const lv = LEVEL_ORDER[k];
    for (const c of fullCatalog) {
      if (c.level !== lv) continue;
      if (seen.has(c.title)) continue;
      seen.add(c.title);
      const xml = registrationXml(c);
      if (xml != null) out.push({ name: c.title, xml });
    }
  }
  return out;
}
