// Converter: ingests taminations XML (moves.xml, formations.xml, per-call XML)
// and emits normalized runtime bundles. Depends only on DOMParser and receives
// XML as strings, so it is renderer/bundler agnostic.
//
// In the browser DOMParser is global. In Node, call `setParser` with
// @xmldom/xmldom's DOMParser (as the test does).

import { goingOfTitle } from './going.js';
// THE EXPORT PRECISION, from the one module that owns it; `formationToXml` used to carry a local copy of the same
// four-decimal lambda. The rejected alternative for a FACING is in that module's header - a formation writes the
// geometry it was given, so its `angle` is an `exportNumber`, not an `exportAngleDeg`.
import { exportNumber } from './export-format.js';
import type { BezierData, CallBundle, DancerSpec, FormationTag, Gender, Hands, Seg, SequencerMode, Symmetry } from './types.js';

// Re-exported from where it is declared, so a caller reading a definition's tags has one type to name.
export type { FormationTag } from './types.js';

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

/**
 * THE XML ESCAPE RULE, and it is deliberately NARROWER than the HTML one.
 *
 * `&`, `<` and `"` are escaped; `>` and `'` are not. That is correct for THIS target rather than a
 * tidiness choice: every attribute this engine writes is DOUBLE-quoted (so `"` is the quote to break),
 * XML requires only `&` and `<` in text, `>` is legal raw everywhere except inside `]]>`, and `'` needs
 * escaping only in a SINGLE-quoted attribute. Escaping them anyway would change the bytes the exporter
 * writes — and those bytes are what the corpus round-trip gates compare — for no safety.
 *
 * SO DO NOT "UNIFY" THIS WITH `poc/src/dom.ts`'s `esc`. That one is the HTML rule (`& < > " '`), which is
 * wider because HTML attributes may be single-quoted and because it feeds `innerHTML`. Two targets, two
 * rules, one implementation each: this function is the XML one, and `poc/tools/escape-probe.mjs` pins both
 * sets and the fact that they differ.
 */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

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

/**
 * THE HAND STATE'S MIRROR: a grip changes hands, a pair of hands does not.
 *
 * A REFLECTION IS GEOMETRY AND HANDEDNESS IN ONE OPERATION. The reference's own `reflect()` is
 * `scale(1, -1)` and its `scale` swaps the hand bits when the y factor is negative
 * (`math/movement.dart:141-150`; `taminations.md` §7.4), so a mirrored Left-hand move is a Right-hand
 * one. `both` and `gripboth` are their own mirror, and `none` has no hand to change.
 *
 * Exported for the editor's track mirror (`mirrorDancerMoves`), so the corpus's convention has ONE
 * definition rather than a second one written beside the button.
 */
export function swapLR(h: Hands): Hands {
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

/**
 * READ, NEVER VERIFIED, HERE. This is a byte reader like `parseFormations`: whether the tags are present, well
 * formed and consistent is `test/formation-tags.mjs`'s question, and the parser must not pre-empt it with a
 * throw - a corpus mid-tagging has to stay readable so the tagger can report what is missing.
 */

/** The tags an element carries, or nulls when it carries none. Shared by both definition sites. */
function tagOf(el: { getAttribute(name: string): string | null }): FormationTag {
  return { fid: el.getAttribute('fid'), aid: el.getAttribute('aid') };
}

function parseFormationTagsImpl(xmlText: string): Map<string, FormationTag> {
  const doc = parseXML(xmlText);
  const map = new Map<string, FormationTag>();
  for (const f of byTag(doc, 'formation')) {
    const name = f.getAttribute('name');
    if (!name) continue;
    map.set(name, tagOf(f));
  }
  return map;
}

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

export interface TamRaw {
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
  /**
   * The TAGS on this tam's INLINE `<formation>`, or nulls when it has none (which is also every tam that
   * starts from a named formation - that reference carries no tags; the definition it names does).
   *
   * Carried rather than looked up because the inline block IS a formation definition: it writes half a set,
   * `reconstituteWholeSet` supplies the other half, and the tags are that definition's stored identity. A
   * consumer that wants to say which setup an authoring starts from has nothing else to hold - an inline block
   * has no name.
   */
  formationTag: FormationTag;
  /**
   * The CALL-VARIANT id this authoring realises, or null when the corpus carries none.
   *
   * A variant is (level, title, the fid of the definition the tam starts from) - `callVariantId` mints it - and the
   * corpus stores the result on the tam as `vid`, so a reader can name the variant without re-deriving it and a
   * gate can assert the stored value equals the computed one. The LEVEL is the caller's: it is the directory the
   * file lives in, which this parser never sees, so this field is the tag as written and not a check.
   */
  vid: string | null;
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
      formationTag: inline ? tagOf(inline) : { fid: null, aid: null },
      vid: tam.getAttribute('vid'),
    });
  }
  return tams;
}

// Build the full square when a call is authored for only one half of the set.
// The duplicate half is the base rotated 180 degrees about the origin.
// Mirroring is auto-applied only when it is unambiguous: it is skipped when a
// dancer's 180-degree partner already exists in the formation (e.g. a full
// Squared Set or an on-axis wave/column).
/** How close two spots must be, in units, for a duplicate to be "already there". */
export const MIRROR_EPS = 0.01;

/** Anything placed on the floor: both the formation registry's dancers and a tam's own carry these. */
export type PlacedDancer = { x: number; y: number; angleDeg: number; mirror?: boolean };

/** Whether a set already CONTAINS its own 180-degree partners, and so is already whole. */
export function hasAntipode(dancers: readonly PlacedDancer[]): boolean {
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
 * THE RECONSTITUTION RULE, WRITTEN ONCE: a formation definition writes HALF the set, and the whole is
 * the written dancers plus the same dancers rotated 180 degrees about the origin - `(x, y, angle)` ->
 * `(-x, -y, angle + 180)`. The duplication is SKIPPED when the written shape already contains a dancer at
 * every dancer's antipode, because then the two would land on one spot (a Squared Set, an on-axis wave, or
 * a definition that is already whole at a size other than eight).
 *
 * WHY IT IS EXPORTED. It is what gives a formation definition the geometry the ids are taken over, so the
 * tagger (`scripts/tag-formations.mjs`) and the gate (`test/formation-tags.mjs`) must ask it rather than
 * restate it - a restated copy is one edit away from tagging a geometry the engine never builds (AGENTS §5).
 *
 * IT PLACES THE DUPLICATE. `mirrorToFull` is the SAME rule in the bundle's representation - it keeps the
 * base coordinates and sets `mirror: true`, which `poseFor` negates, because one path is then replayed for
 * both halves. The tag must be a content address of an actual board, and a board's poses are placed, so a
 * caller computing an id uses this form. MEASURED: `allPoses(bundle, 0)` and this agree, which is why the census
 * the deleted root ledger ran (`test/tools/formation-roots.mjs`, removed when `7980688` replaced the ledger with
 * the tag each definition stores) minted the same 198 ids this scheme writes down.
 */
export function reconstituteWholeSet<T extends PlacedDancer>(dancers: readonly T[]): T[] {
  if (hasAntipode(dancers)) return [...dancers];
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
    // THE TAM'S OWN `asymmetric` DECLARATION DECIDES, NOT THE GEOMETRY. `mirrorToFull`/`reconstituteWholeSet`
    // guess by looking for an antipode, and the guess and the declaration agree on every shipped tam but
    // one - which is why carrying `tam.symmetry` and never acting on it went unnoticed. The paths have
    // honoured it since they were written (`mirror && tam.symmetry === 2` below); the FORMATION did not, so
    // a tam declaring `asymmetric="true"` beside two written dancers had its formation completed to four
    // while its paths stayed at two - the same tam read two different ways by the two loaders.
    //
    // AND THIS COMPLETION IS NOT THE CALLER'S `mirror` TO REFUSE. That flag governs completing the PATHS (the
    // block below), because an already-expanded instance must not be doubled. Here the evidence is
    // arithmetical: the tam writes 2N paths for N dancers, so the written dancers ARE half the set whatever
    // the caller asked for, and pairing them 1:1 throws on the tam's own arithmetic. MEASURED when this was
    // gated on `mirror`: an edit exported by the app (`callToXmlNamed` -> `formation="Circle"`, FOUR written
    // dancers, EIGHT paths) read back with `mirror: false` - the mode the app uses for an applied edit -
    // threw `Path count mismatch for Circle Left Home: 8 paths vs 4 dancers`, while the same XML read with
    // `mirror: true` was fine. NO SHIPPED TAM IS AFFECTED: of the corpus's 5488 tams, ZERO carry 2N paths
    // for N dancers at symmetry 2, so this branch only ever fires on editor-authored XML.
    const full = tam.symmetry === 2 ? reconstituteWholeSet(dancers) : dancers;
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
    formation: tam.dancers.length === 0 ? tam.formationAttr : null,
    // THE START DEFINITION'S STORED TAGS travel with the bundle, because the variant identity names a DEFINITION and
    // an inline block has no name to look one up by. A named reference carries nulls here - its definition, not the
    // tam, holds the tags.
    formationTag: tam.formationTag,
    // HOW this body goes, DERIVED from the title at the one place a CallBundle is born. `going.ts` carries the reason it
    // is derived rather than authored (these tams are app-exported, so an authored attribute needs the exporter and its
    // survival gate; a derived label cannot be lost) and the measurement that says it must be a label, not a distance.
    going: goingOfTitle(tam.title),
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

/** The `fid`/`aid` every definition carries, by formation name. See `FormationTag`. */
export function parseFormationTags(xmlText: string): Map<string, FormationTag> {
  return parseFormationTagsImpl(xmlText);
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
export function formationToXml(
  name: string,
  dancers: { x: number; y: number; heading: number; gender?: Gender }[],
  tags?: FormationTag,
): string {
  const lines = dancers.map(
    (d) => `    <dancer gender="${esc(d.gender ?? 'boy')}" x="${exportNumber(d.x)}" y="${exportNumber(d.y)}" angle="${exportNumber((d.heading * 180) / Math.PI)}" />`,
  );
  // THE TAGS GO ON THE BLOCK the same way they are written in `formations.xml`, so an exported definition
  // re-enters the corpus already tagged. A caller that has none omits them and the corpus gate reports the
  // definition as untagged - which is the honest outcome, not a block that claims an id it never matched.
  const attrs = [
    `name="${esc(name)}"`,
    ...(tags?.fid ? [`fid="${esc(tags.fid)}"`] : []),
    ...(tags?.aid ? [`aid="${esc(tags.aid)}"`] : []),
  ].join(' ');
  return `  <formation ${attrs}>\n${lines.join('\n')}\n  </formation>`;
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

/**
 * WHICH TAM OF A FILE TO LOAD: by position, or by NAME.
 *
 * A POSITION IS NOT A NAME, and the difference matters more than it looks. `circle.xml` holds eighty
 * tams and the order they are written in is an authoring decision that changes whenever the data is
 * reworked - MEASURED, `b83c305` moved `Circle Left - Stop at Home` (now `Circle Left Home`) to the front
 * of that file, and every caller that meant "Circle Left" by loading index 0 silently got the home-ending
 * variant instead. Nothing failed; the callers simply started testing a different call. Naming the call is
 * what makes a harness survive a data change, which is the whole reason this selector exists.
 *
 * A TITLE ALONE IS NOT THE NAME. The name is the title PLUS the formation the tam starts from - the
 * `formation` attribute when the tam references a named formation, and `from` when the formation is
 * embedded. MEASURED over the corpus's 547 files and 5963 tams, 811 of which carry no `formation`
 * attribute at all:
 *
 *   - a duplicate `title` alone                       398 files (72.8%) - so the title cannot be the key;
 *   - a duplicate `title` + `from`                     39 files ( 7.1%);
 *   - a duplicate `title` + `(formation ?? from)`      19 files ( 3.5%) - so that is the key.
 *
 * The remaining 19 need an `nth` (1-based), which is why it is here. AND AN AMBIGUOUS NAME IS AN ERROR,
 * never a silent first match: a wrong pick reintroduces exactly the invisible drift this exists to
 * remove. Every failure names what the file actually holds, so a call site can be fixed without opening
 * the data.
 */
export type TamSelector =
  | number
  | string
  | { title: string; formation?: string; from?: string; nth?: number };

/** A tam's NAME, the way a call site should write it: title plus the formation it starts from. */
export function tamName(tam: TamRaw): string {
  const start = tam.formationAttr ?? tam.from;
  return start ? `${tam.title} [${start}]` : tam.title;
}

function availableTams(tams: TamRaw[]): string {
  const seen: string[] = [];
  for (const t of tams) {
    const d = tamName(t);
    if (!seen.includes(d)) seen.push(d);
  }
  const head = seen.slice(0, 8).join('; ');
  return `${seen.length} tam(s): ${head}${seen.length > 8 ? '; ...' : ''}`;
}

/**
 * Resolve a TamSelector against a file's tams, or explain exactly why it could not.
 *
 * Exported because a caller that already holds the parsed tams should not have to re-parse the file to
 * find one, and because a harness asserting "this name resolves to that call" needs the same resolution
 * the loader uses.
 */
export function selectTam(tams: TamRaw[], selector: TamSelector): TamRaw {
  if (tams.length === 0) throw new Error('No <tam> in call XML');

  if (typeof selector === 'number') {
    const tam = tams[selector];
    // NO SILENT FALLBACK. This used to be `tams[index] ?? tams[0]`, so an index that had drifted past
    // the end loaded the FIRST tam and reported no problem at all - the same invisible swap by name.
    if (!tam) {
      throw new Error(
        `tam index ${selector} is out of range: the file holds ${tams.length} tam(s) (0..${tams.length - 1}). ` +
          `Load by name instead. It holds ${availableTams(tams)}`,
      );
    }
    return tam;
  }

  const want = typeof selector === 'string' ? { title: selector } : selector;
  const matching =
    `"${want.title}"` +
    (want.formation !== undefined ? ` [${want.formation}]` : '') +
    (want.from !== undefined ? ` from "${want.from}"` : '');
  const matches = tams.filter(
    (t) =>
      t.title === want.title &&
      (want.formation === undefined || t.formationAttr === want.formation) &&
      (want.from === undefined || t.from === want.from),
  );

  if (want.nth !== undefined) {
    const nth = matches[want.nth - 1];
    if (!nth) {
      throw new Error(
        `${matches.length} tam(s) match ${matching}, so there is no #${want.nth}. Fix the call site, or use one of: ${availableTams(tams)}`,
      );
    }
    return nth;
  }
  if (matches.length === 0) {
    throw new Error(`no tam matches ${matching}. The file holds ${availableTams(tams)}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} tams match ${matching}, so the name is NOT unique and cannot say which to load. ` +
        `Add a \`formation\` or \`nth\` (1-based). The file holds ${availableTams(tams)}`,
    );
  }
  return matches[0];
}
export function loadCallFromXml(
  callXml: string,
  movesXml: string,
  formationsXml: string,
  tam: TamSelector = 0,
  mirror = true,
): CallBundle {
  const moves = parseMovesImpl(movesXml);
  const formations = parseFormationsImpl(formationsXml);
  const tams = parseCallXmlImpl(callXml);
  return buildCallImpl(selectTam(tams, tam), formations, moves, mirror);
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
