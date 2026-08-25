// Converter: ingests taminations XML (moves.xml, formations.xml, per-call XML)
// and emits normalized runtime bundles. Depends only on DOMParser and receives
// XML as strings, so it is renderer/bundler agnostic.
//
// In the browser DOMParser is global. In Node, call `setParser` with
// @xmldom/xmldom's DOMParser (as the test does).

import type { BezierData, CallBundle, DancerSpec, Gender, Hands, Seg } from './types.js';

// ----------------------------------------------------------------- DOMParser

let ParserCtor: typeof DOMParser | null = typeof DOMParser !== 'undefined' ? DOMParser : null;

/** Provide a DOMParser implementation (e.g. @xmldom/xmldom in Node). */
export function setParser(c: typeof DOMParser): void {
  ParserCtor = c;
}

function parseXML(xml: string): Document {
  if (!ParserCtor) {
    throw new Error(
      'DOMParser is unavailable. In the browser it is global; in Node call setParser() with @xmldom/xmldom\'s DOMParser.',
    );
  }
  return new ParserCtor().parseFromString(xml, 'application/xml');
}

// ----------------------------------------------------------------- XML helpers

function num(el: Element, attr: string): number {
  const v = el.getAttribute(attr);
  if (v == null) throw new Error(`Missing attribute ${attr}`);
  return parseFloat(v);
}

function numOpt(el: Element, attr: string): number | null {
  const v = el.getAttribute(attr);
  return v == null ? null : parseFloat(v);
}

// Portable child lookup (works in browser DOMParser and @xmldom/xmldom).
function byTag(el: Element | Document, tag: string): Element[] {
  return Array.from(el.getElementsByTagName(tag));
}

function mapHands(s: string | null): Hands {
  switch ((s ?? 'none').toLowerCase()) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'both':
      return 'both';
    case 'gripleft':
      return 'gripleft';
    case 'gripright':
      return 'gripright';
    case 'gripboth':
      return 'gripboth';
    default:
      return 'none';
  }
}

// ----------------------------------------------------------------- Path items

interface Mods {
  beats?: number;
  hands?: string;
  scaleX?: number;
  scaleY?: number;
  reflect?: number;
  offsetX?: number;
  offsetY?: number;
}

type PathItem = { kind: 'movement'; seg: Seg } | { kind: 'move'; select: string; mods: Mods };

function segFromMovement(e: Element): Seg {
  const translate: BezierData = {
    cx1: num(e, 'cx1'),
    cy1: num(e, 'cy1'),
    cx2: num(e, 'cx2'),
    cy2: num(e, 'cy2'),
    x2: num(e, 'x2'),
    y2: num(e, 'y2'),
  };
  let rotate: BezierData | null = null;
  if (e.hasAttribute('cx3')) {
    // Rotation bezier: (0,0), (cx3, 0), (cx4, cy4), (x4, y4). cy3 is always 0.
    rotate = {
      cx1: num(e, 'cx3'),
      cy1: 0,
      cx2: numOpt(e, 'cx4') ?? 0,
      cy2: numOpt(e, 'cy4') ?? 0,
      x2: numOpt(e, 'x4') ?? 0,
      y2: numOpt(e, 'y4') ?? 0,
    };
  }
  return { beats: num(e, 'beats'), hands: mapHands(e.getAttribute('hands')), translate, rotate };
}

function parsePathChildren(parent: Element): PathItem[] {
  const items: PathItem[] = [];
  for (const c of Array.from(parent.children)) {
    if (c.tagName === 'movement') {
      items.push({ kind: 'movement', seg: segFromMovement(c) });
    } else if (c.tagName === 'move') {
      items.push({
        kind: 'move',
        select: c.getAttribute('select')!,
        mods: {
          beats: numOpt(c, 'beats') ?? undefined,
          hands: c.getAttribute('hands') ?? undefined,
          scaleX: numOpt(c, 'scaleX') ?? undefined,
          scaleY: numOpt(c, 'scaleY') ?? undefined,
          reflect: numOpt(c, 'reflect') ?? undefined,
          offsetX: numOpt(c, 'offsetX') ?? undefined,
          offsetY: numOpt(c, 'offsetY') ?? undefined,
        },
      });
    }
  }
  return items;
}

// ----------------------------------------------------------------- geometry ops

function cloneSeg(s: Seg): Seg {
  return {
    beats: s.beats,
    hands: s.hands,
    translate: { ...s.translate },
    rotate: s.rotate ? { ...s.rotate } : null,
  };
}

function scaleBezier(b: BezierData, x: number, y: number): BezierData {
  return { cx1: b.cx1 * x, cy1: b.cy1 * y, cx2: b.cx2 * x, cy2: b.cy2 * y, x2: b.x2 * x, y2: b.y2 * y };
}

function skewBezier(b: BezierData, ox: number, oy: number): BezierData {
  return { ...b, cx2: b.cx2 + ox, cy2: b.cy2 + oy, x2: b.x2 + ox, y2: b.y2 + oy };
}

function swapLR(h: Hands): Hands {
  switch (h) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'gripleft':
      return 'gripright';
    case 'gripright':
      return 'gripleft';
    default:
      return h;
  }
}

// ----------------------------------------------------------------- moves registry

function parseMovesImpl(xmlText: string): Map<string, PathItem[]> {
  const doc = parseXML(xmlText);
  const map = new Map<string, PathItem[]>();
  for (const p of byTag(doc, 'path')) {
    const name = p.getAttribute('name');
    if (name) map.set(name, parsePathChildren(p));
  }
  return map;
}

// Resolve a path definition into concrete segments, expanding <move> refs.
function resolvePath(
  def: PathItem[],
  registry: Map<string, PathItem[]>,
  stack: string[],
): Seg[] {
  const out: Seg[] = [];
  for (const item of def) {
    if (item.kind === 'movement') {
      out.push(cloneSeg(item.seg));
      continue;
    }
    if (stack.includes(item.select)) {
      throw new Error(`Move cycle detected: ${[...stack, item.select].join(' > ')}`);
    }
    const baseDef = registry.get(item.select);
    if (!baseDef) throw new Error(`Unknown move reference: ${item.select}`);
    const base = resolvePath(baseDef, registry, [...stack, item.select]);
    const m = item.mods;
    const sx = m.scaleX ?? 1;
    const sy = (m.scaleY ?? 1) * (m.reflect === -1 ? -1 : 1);
    const flip = sy < 0;
    const total = base.reduce((s, seg) => s + seg.beats, 0);
    const beatFactor = m.beats != null ? m.beats / (total || 1) : 1;
    for (const seg of base) {
      const s = cloneSeg(seg);
      if (m.beats != null) s.beats *= beatFactor;
      if (sx !== 1 || sy !== 1) {
        s.translate = scaleBezier(s.translate, sx, sy);
        if (s.rotate) s.rotate = scaleBezier(s.rotate, sx, sy);
      }
      if (flip) s.hands = swapLR(s.hands);
      if (m.hands) s.hands = mapHands(m.hands);
      if (m.offsetX || m.offsetY) s.translate = skewBezier(s.translate, m.offsetX ?? 0, m.offsetY ?? 0);
      out.push(s);
    }
  }
  return out;
}

// ----------------------------------------------------------------- formations

type DancerBase = { gender: Gender; x: number; y: number; angleDeg: number };

function parseFormationsImpl(xmlText: string): Map<string, DancerBase[]> {
  const doc = parseXML(xmlText);
  const map = new Map<string, DancerBase[]>();
  for (const f of byTag(doc, 'formation')) {
    const name = f.getAttribute('name');
    if (!name) continue;
    const dancers = byTag(f, 'dancer').map((d) => ({
      gender: (d.getAttribute('gender') ?? 'boy') as Gender,
      x: num(d, 'x'),
      y: num(d, 'y'),
      angleDeg: num(d, 'angle'),
    }));
    map.set(name, dancers);
  }
  return map;
}

// ----------------------------------------------------------------- calls

interface TamRaw {
  title: string;
  from: string;
  parts: string;
  taminator: string;
  formationAttr: string | null;
  dancers: DancerBase[];
  paths: PathItem[][];
  // sequencer="gender-specific" marks calls whose arrangement only works when
  // the board's boy/girl placement matches the setup's gender slots.
  genderSpecific?: boolean;
}

function parseCallXmlImpl(xmlText: string): TamRaw[] {
  const doc = parseXML(xmlText);
  const tams: TamRaw[] = [];
  for (const tam of byTag(doc, 'tam')) {
    const inline = byTag(tam, 'formation')[0];
    let dancers: DancerBase[] = [];
    if (inline) {
      dancers = byTag(inline, 'dancer').map((d) => ({
        gender: (d.getAttribute('gender') ?? 'boy') as Gender,
        x: num(d, 'x'),
        y: num(d, 'y'),
        angleDeg: num(d, 'angle'),
      }));
    }
    const paths = byTag(tam, 'path').map((p) => parsePathChildren(p));
    const taminatorEl = byTag(tam, 'taminator')[0];
    tams.push({
      title: tam.getAttribute('title') ?? '',
      from: tam.getAttribute('from') ?? '',
      parts: tam.getAttribute('parts') ?? '',
      taminator: taminatorEl ? taminatorEl.textContent?.trim() ?? '' : '',
      formationAttr: tam.getAttribute('formation'),
      dancers,
      paths,
      genderSpecific: tam.getAttribute('sequencer') === 'gender-specific',
    });
  }
  return tams;
}

// Build the full square when a call is authored for only one half of the set.
// The duplicate half is the base rotated 180 degrees about the origin.
// Mirroring is auto-applied only when it is unambiguous: it is skipped when a
// dancer's 180-degree partner already exists in the formation (e.g. a full
// Squared Set or an on-axis wave/column).
const MIRROR_EPS = 0.01;

function mirrorToFull(dancers: DancerSpec[]): DancerSpec[] {
  for (const d of dancers) {
    for (const e of dancers) {
      if (d === e) continue;
      if (Math.abs(-d.x - e.x) < MIRROR_EPS && Math.abs(-d.y - e.y) < MIRROR_EPS) return dancers;
    }
  }
  return [...dancers, ...dancers.map((d) => ({ ...d, mirror: true }))];
}

function buildCallImpl(
  tam: TamRaw,
  formations: Map<string, DancerBase[]>,
  moves: Map<string, PathItem[]>,
  mirror = true,
): CallBundle {
  // Resolve formation (inline wins over named attribute).
  let dancers = tam.dancers;
  if (dancers.length === 0 && tam.formationAttr) {
    dancers = (formations.get(tam.formationAttr) ?? []).map((d) => ({ ...d }));
  }
  if (dancers.length === 0) throw new Error(`No formation for ${tam.title}`);

  // Resolve each path into segments.
  const resolvedPaths = tam.paths.map((p) => resolvePath(p, moves, []));
  if (resolvedPaths.length === 0) throw new Error(`No paths for ${tam.title}`);

  // Align paths to dancers (1:1, or 1 path per dancer-pair).
  const withPath: DancerSpec[] = [];
  for (let i = 0; i < dancers.length; i++) {
    let path: Seg[];
    if (resolvedPaths.length === dancers.length) {
      path = resolvedPaths[i];
    } else if (resolvedPaths.length * 2 === dancers.length) {
      path = resolvedPaths[Math.floor(i / 2)];
    } else {
      throw new Error(
        `Path count mismatch for ${tam.title}: ${resolvedPaths.length} paths vs ${dancers.length} dancers`,
      );
    }
    withPath.push({ ...dancers[i], path });
  }

  const beats = withPath.reduce((m, d) => {
    const sum = d.path.reduce((s, seg) => s + seg.beats, 0);
    return Math.max(m, sum);
  }, 0);
  const leadin = 2;
  const leadout = 2;

  const dancers2 = mirror ? mirrorToFull(withPath) : withPath;

  return {
    title: tam.title,
    from: tam.from,
    parts: tam.parts,
    taminator: tam.taminator,
    dancers: dancers2,
    beats,
    leadin,
    leadout,
    totalBeats: leadin + beats + leadout,
    genderSpecific: tam.genderSpecific,
  };
}

// --------------------------------------------------------------- public API

export function parseMoves(xmlText: string): Map<string, PathItem[]> {
  return parseMovesImpl(xmlText);
}

export function parseFormations(xmlText: string): Map<string, DancerBase[]> {
  return parseFormationsImpl(xmlText);
}

export function parseCallXml(xmlText: string): TamRaw[] {
  return parseCallXmlImpl(xmlText);
}

export function buildCall(
  tam: TamRaw,
  formations: Map<string, DancerBase[]>,
  moves: Map<string, PathItem[]>,
  mirror = true,
): CallBundle {
  return buildCallImpl(tam, formations, moves, mirror);
}

export interface CallMeta {
  title: string;
  setups: { label: string; from: string }[];
}

export function callMeta(xmlText: string): CallMeta {
  const tams = parseCallXmlImpl(xmlText);
  return {
    title: tams[0]?.title ?? '',
    // Prefer the human `from` label; fall back to the named `formation` when it
    // is empty (e.g. a tam authored as formation="T-Bone URLU" with no from), so
    // every setup is still identified. Embedded-formation tams always carry a
    // `from`, so this fallback only affects the attribute case.
    setups: tams.map((t) => ({ label: t.from || t.formationAttr || '(default)', from: t.from })),
  };
}

export function loadCallFromXml(
  callXml: string,
  movesXml: string,
  formationsXml: string,
  tamIndex = 0,
  mirror = true,
): CallBundle {
  const moves = parseMovesImpl(movesXml);
  const formations = parseFormationsImpl(formationsXml);
  const tams = parseCallXmlImpl(callXml);
  const tam = tams[tamIndex] ?? tams[0];
  if (!tam) throw new Error('No <tam> in call XML');
  return buildCallImpl(tam, formations, moves, mirror);
}

/** Build every <tam> variant of a call (each is a start formation + paths). */
export function buildCallVariants(
  callXml: string,
  movesXml: string,
  formationsXml: string,
  mirror = true,
): CallBundle[] {
  const moves = parseMovesImpl(movesXml);
  const formations = parseFormationsImpl(formationsXml);
  const tams = parseCallXmlImpl(callXml);
  return tams.map((tam) => buildCallImpl(tam, formations, moves, mirror));
}
