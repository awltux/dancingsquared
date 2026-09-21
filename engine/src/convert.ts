// Converter: ingests taminations XML (moves.xml, formations.xml, per-call XML)
// and emits normalized runtime bundles. Depends only on DOMParser and receives
// XML as strings, so it is renderer/bundler agnostic.
//
// In the browser DOMParser is global. In Node, call `setParser` with
// @xmldom/xmldom's DOMParser (as the test does).

import type { BezierData, CallBundle, DancerSpec, Gender, Hands, Seg, SequencerMode, Symmetry } from './types.js';

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
  // The `<tam sequencer="…">` attribute, parsed verbatim into one of the four values
  // Taminations defines. Reading only the `gender-specific` string (as this used to) loses
  // `no`, which marks a demonstration animation the sequencer must not match — the
  // reference implementation skips those outright (`xml_call.dart:57-59`).
  sequencerMode: SequencerMode | null;
  // The `<tam actives="…">` attribute, verbatim, or null. WHICH DANCERS THE TAM'S PATHS DESCRIBE.
  //
  // It matters because a tam carrying it is authored for a SUBSET: `Centers Split Two`
  // (`ms/split_the_outside_couple.xml`) has `actives="Centers"` and four paths against a
  // four-dancer `Eight Chain Thru` formation, which the engine then MIRRORS to eight — so the
  // centres' motion is applied to all eight and the call becomes a whole-board `Pass Thru`. The
  // attribute is read here so that the mis-registration is at least VISIBLE and pinnable; deciding
  // what to do with it at the apply path is a separate step (PLAN.md, Phase C).
  actives: string | null;
  // How many copies of the WRITTEN dancers make the set, from `<tam asymmetric="true">`: 1 = take the
  // written shape as it stands, 2 = it is half the set and the completion supplies the other half.
  // The DEFAULT is 2 because that is the corpus's authoring convention, not because the attribute is
  // usually present — it appears on 18 of the 5963 shipped tams. See `Symmetry` for the rule, the
  // reference, and the measurement: the declaration and the geometric guess agree on every shipped tam
  // but one. CARRIED, NOT YET ACTED ON: `buildCallImpl` still completes by geometry (`hasAntipode`).
  symmetry: Symmetry;
}

/** Parse the `sequencer` attribute, keeping every value Taminations defines. */
function parseSequencerMode(raw: string | null): SequencerMode | null {
  if (raw === 'perimeter' || raw === 'exact' || raw === 'gender-specific' || raw === 'no') return raw;
  // An unrecognised value is reported as absent rather than guessed at, so a new
  // attribute value in the assets surfaces as "no flag" instead of as a wrong flag.
  return null;
}

/**
 * The symmetry a `<tam>` declares: `1` for `asymmetric="true"`, `2` otherwise.
 *
 * Only the exact string `true` opts out. Taminations' own writer emits `true` and nothing else
 * (`animated_call.dart:162`), so a different spelling is a data error and is treated as absent —
 * which is the safe direction, because the default is the convention the other 5945 tams are written
 * under. The attribute is not declared on `<formation>` in `tamination.dtd`, so a `<tam>` carrying it
 * is the only place it can appear.
 */
function parseSymmetry(raw: string | null): Symmetry {
  return raw === 'true' ? 1 : 2;
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
      sequencerMode: parseSequencerMode(tam.getAttribute('sequencer')),
      actives: tam.getAttribute('actives'),
      symmetry: parseSymmetry(tam.getAttribute('asymmetric')),
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

/** Anything placed on the floor: both the formation registry's dancers and a tam's own carry these. */
type PlacedDancer = { x: number; y: number; angleDeg: number; mirror?: boolean };

/** Whether a set already CONTAINS its own 180-degree partners, and so is already whole. */
function hasAntipode(dancers: PlacedDancer[]): boolean {
  for (const d of dancers) {
    for (const e of dancers) {
      if (d === e) continue;
      if (Math.abs(-d.x - e.x) < MIRROR_EPS && Math.abs(-d.y - e.y) < MIRROR_EPS) return true;
    }
  }
  return false;
}

function mirrorToFull(dancers: DancerSpec[]): DancerSpec[] {
  if (hasAntipode(dancers)) return dancers;
  return [...dancers, ...dancers.map((d) => ({ ...d, mirror: true }))];
}

/**
 * A formation's dancers as the FULL set, with the duplicated half PLACED rather than flagged.
 *
 * `mirrorToFull` marks the duplicate half instead of moving it: the duplicate keeps the base's `(x, y)` and
 * `poseFor` negates the pose when it reads it. That is right while ONE path is replayed for both halves, and
 * wrong the moment each dancer has its OWN path - which is exactly what a full set of paths means - because the
 * negation would then be applied on top of a start that was already placed. So this puts the duplicate where
 * `poseFor` would have put it and clears the flag.
 */
function materialiseFull<T extends PlacedDancer>(dancers: T[]): T[] {
  if (hasAntipode(dancers)) return dancers; // already a whole set: nothing to place
  return [
    ...dancers.map((d) => ({ ...d, mirror: false }) as T),
    ...dancers.map((d) => ({ ...d, x: -d.x, y: -d.y, angleDeg: d.angleDeg + 180, mirror: false }) as T),
  ];
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
  // NAME the missing formation, not just the call. The old message ("No formation for Ferris
  // Wheel") said which call died but not which `from=` was wrong, and because one bad tam used to
  // take the whole call with it, that message was the only clue anyone got.
  if (dancers.length === 0) throw new Error(`No formation "${tam.formationAttr}" for ${tam.title}`);

  // Resolve each path into segments.
  const resolvedPaths = tam.paths.map((p) => resolvePath(p, moves, []));
  if (resolvedPaths.length === 0) throw new Error(`No paths for ${tam.title}`);

  // A FULL SET OF PATHS AGAINST A HALF SET OF DANCERS - and this is what an EDITOR-AUTHORED call looks like
  // whenever its `from` names a formation that authors less than a whole set. The corpus pairs N paths with N
  // dancers, or with 2N dancers when one path is replayed for a pair; a CREATED or EDITED call is always
  // full-set, so `formation="Circle"` - which authors FOUR - travelled with EIGHT paths and threw
  // "Path count mismatch for Circle Left: 8 paths vs 4 dancers" the moment the edit was applied to the library.
  //
  // The WRITER already knew this: `callTamXml` mirrors a four-dancer formation to eight before comparing, and
  // says so, "because that is what `buildCallImpl` does with a four-dancer formation before pairing paths". It
  // did not - it paired first and mirrored after - so the reference it wrote was one the reader could never
  // resolve. The two halves of the same decision were in different files and only one of them was tested.
  //
  // Mirroring is attempted and the counts are re-checked rather than assumed: a formation that already
  // CONTAINS its own antipodes is a whole set however few dancers it lists, and `mirrorToFull` leaves it alone.
  if (resolvedPaths.length === dancers.length * 2) {
    const full = materialiseFull(dancers);
    if (full.length === resolvedPaths.length) dancers = full;
  }

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

  // THE COMPLETION, APPLIED BY THE DECLARATION. `tam.symmetry` is the corpus's own answer: 1 = take
  // the written dancers as they stand, 2 = they are half the set and the completion supplies the other
  // half. `mirror` is the caller's separate permission to complete at all (`false` when reading an
  // already-expanded instance back).
  //
  // `mirrorToFull` STILL TESTS FOR AN ANTIPODE, and that is deliberately kept: a shape declaring
  // symmetry 2 that already contains a pair of dancers 180 degrees apart is a whole set whose attribute
  // was forgotten, and leaving it alone is a far better failure than doubling it. It is a TOLERANCE for
  // bad data, not the rule - the rule is the declaration, which is what makes the 18 tams that ARE
  // taken as written do so for the stated reason instead of because their geometry happened to say so.
  // MEASURED after giving `Allemande Left` from `O Trade By` its attribute (it was the one shipped tam
  // whose built size disagreed with its declaration): this changes NO shipped variant's size, and
  // `test/shape-census.mjs` gates the rule on synthetic shapes in both directions.
  const dancers2 = mirror && tam.symmetry === 2 ? mirrorToFull(withPath) : withPath;

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
    sequencerMode: tam.sequencerMode,
    forSequencer: tam.sequencerMode !== 'no',
    genderSpecific: tam.sequencerMode === 'gender-specific',
    symmetry: tam.symmetry,
    actives: tam.actives,
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
  /** The `<tamination title>` this file's calls live under - the FAMILY, for grouping an export. */
  family: string | null;
  setups: { label: string; from: string }[];
}

/**
 * Serialize a named formation as a `<formation>` block, the form `formations.xml` is written in.
 *
 * This is the CORPUS format, and the round trip is the point: a formation a user labels is
 * stored locally so it can be recognized immediately, and this is how it gets into the corpus -
 * pasted into `pom/src/assets/formations.xml`, where the next `parseFormations` reads it like
 * any other. `convert.mjs`-side symmetry is deliberate: the parser and the writer live side by
 * side so neither can drift from the other without the round-trip gate noticing.
 *
 * Only the four attributes the reader understands are written (`gender`, `x`, `y`, `angle`), in
 * degrees, because that is what `parseFormations` reads back.
 */
export function formationToXml(name: string, dancers: { x: number; y: number; heading: number; gender?: Gender }[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const r = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
  const lines = dancers.map(
    (d) => `    <dancer gender="${esc(d.gender ?? 'boy')}" x="${r(d.x)}" y="${r(d.y)}" angle="${r((d.heading * 180) / Math.PI)}" />`,
  );
  return `  <formation name="${esc(name)}">\n${lines.join('\n')}\n  </formation>`;
}
/**
 * A setup's identifying name: its FORMATION, with the `from` label as the fallback.
 *
 * ONE FUNCTION RATHER THAN TWO COPIES OF THE SAME PRECEDENCE. `from` is free text FOR THE USER - it labels an
 * EMBEDDED formation or gives a named one an alternative name - and `buildCallImpl` resolves the dancers from
 * `formationAttr` and never from it. So a Setup list named by `from` names the setup by something that need not
 * be a formation at all: the corpus writes `from="Lines"` for a tam whose formation is `Normal Lines`, and
 * `from=""` for tams that name themselves entirely through `formation`.
 *
 * AN EMBEDDED formation has no `formation` attribute, so its `from` is the only name there is - which is why
 * `from` is the fallback rather than discarded.
 */
export function setupLabel(formation: string | null, from: string): string {
  return formation || from || '(default)';
}

/**
 * The `<tamination>` a file's tams live in: the FAMILY the call belongs to, and the attribute a block of
 * exported tams is grouped under so it can be pasted back into the file it came from.
 */
export function parseTaminationTitle(xmlText: string): string | null {
  const el = byTag(parseXML(xmlText), 'tamination')[0];
  const title = el?.getAttribute('title');
  return title ? title : null;
}

export function callMeta(xmlText: string): CallMeta {
  const tams = parseCallXmlImpl(xmlText);
  return {
    title: tams[0]?.title ?? '',
    // The FAMILY the file groups its calls under, which is what a merged export has to be filed beneath.
    family: parseTaminationTitle(xmlText),
    // THE LABEL IS THE FORMATION'S NAME, NOT THE `from` LABEL - see `setupLabel`.
    setups: tams.map((t) => ({ label: setupLabel(t.formationAttr, t.from), from: t.from })),
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
