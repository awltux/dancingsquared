// THE CORPUS'S CALL INVENTORY, ONCE — every `<tam>` site, its title, and the block text the engine parses.
//
// WHY THIS MODULE EXISTS. "Which titles does the corpus carry, in which file, across which levels" was answered
// by five separate implementations, with five level lists and four shapes: `engine/test/lib/engine-calls.mjs`
// (imported by 134 harnesses and probes), `book/tools/lib/load.mjs`, `poc-teacher/src/catalog.ts`'s node feed,
// `game/src/data/corpus-node.ts`, and `scripts/call-titles.mjs`. The duplication had already cost correctness:
//
//   * the harnesses' reader scanned `<tam>` with a RAW REGEX, so it counted the tam blocks that are commented out
//     in the corpus. MEASURED: 2203 titles by a raw scan, 2191 by the engine's own parser, and the 12 that
//     differ exist only inside `<!-- -->` (`Heads Start`, `Sides Start`, `Bend the Line and Spread`,
//     `Magic Column Right and Left Thru`, and eight `Left/Right-Hand Star … and Roll`), spread over four files
//     (`a1/split_square_thru.xml`, `c1/magic_column_formation.xml`, `ms/star.xml`,
//     `plus/anything_and_spread.xml`). Eight more titles in `ms/star.xml` are BOTH commented and live, so their
//     pool carried a phantom second authoring. `engine/src/sequencer/call-titles.ts` — generated from the
//     engine's parser — has said 2191 all along.
//   * the book scanned the same way and paired the resulting INDEX with a DOM parse, so in those four files the
//     index addressed the wrong `<tam>` (recorded when the book started reporting unresolved start queries).
//
// THE EXTRACTION IS DELIBERATELY TWO-LAYERED, and each layer is the authority for a different question:
//
//   * the ENGINE'S parser (`parseCallXml`) answers "which titles, in what order" — because that order is what
//     `loadCallFromXml(xml, …, index)` and the library's registration address, and because it is the parser
//     `CALL_TITLE` was generated from. Comments never reach it.
//   * the FILE'S OWN TEXT answers "what is the block" — sliced after stripping comments, NOT re-serialised from
//     the DOM. A re-serialisation would re-escape the corpus's entities (`&quot;O&quot; Wheel Fan Thru`), and the
//     pooled XML every consumer hands the engine would stop matching the authoring on disk.
//
// THEY ARE CROSS-CHECKED, NOT ASSUMED TO AGREE: if the parsed tam count and the sliced block count differ, this
// throws with the level, the file and both counts. A malformed tam must not vanish in silence.
//
// WHAT THIS MODULE DOES NOT OWN, on purpose: the LEVEL LIST (each caller passes its own — `ASSET_LEVELS` for the
// harnesses, `['ms','plus']` for the book, `ms` for the game and the teacher, because a silent level change moves
// every count in the docs), the POOLING ORDER (highest-first is the harnesses' measured choice), the hidden-tam
// rule (`display="no"` filtering is the teacher's), and the engine-coupled title algebra (`implementedTitles`
// unions `CODED_MOVES` aliases and stays with the engine's tests).
import { DOMParser } from '@xmldom/xmldom';

import { parseCallXml, setParser } from 'dancing-squared-engine';

import { filesOf, readFile } from './files.ts';

// The path half is re-exported from the root entry so a caller needs ONE specifier; `./files` stays available for
// the callers that only want bytes (the teacher's build script, the game's whole-file loader).
export { corpusRoot, filesOf, levelPath, readFile } from './files.ts';

// THE ENGINE HAS NO PARSER OF ITS OWN — `convert.ts` takes one from the global if it exists and is otherwise
// unset, and `game/src/data/corpus-node.ts` supplies the same one for the same reason. The cast is the two
// `Document` declarations (`@xmldom`'s returns its own `Document`), not a dependency choice: the engine calls
// `parseFromString` and nothing else on it.
setParser(DOMParser as unknown as Parameters<typeof setParser>[0]);

/** One `<tam>` in the corpus: its identity, its position, and its own text. */
export interface TamSite {
  /**
   * The DECODED title, as the engine's parser reads it — the identity a caller matches on.
   *
   * It is decoded (`&quot;O&quot; …`, not `&quot;O&quot; …` with the entities intact) because that is the spelling
   * `CALL_TITLE` and `callMeta` carry. The RAW spelling is on `attrs.title` for the one caller that needs it: the
   * book's `tam_xml_queries` compare against the file's attributes as written.
   */
  title: string;
  /** The index `loadCallFromXml(xml, moves, formations, index)` and `parseCallXml(xml)[index]` address. */
  index: number;
  /** The `<tam>…</tam>` block, exactly as the file spells it (comments inside the block are the one loss). */
  xml: string;
  /** The block's opening-tag attributes, RAW (undecoded). */
  attrs: Readonly<Record<string, string>>;
  level: string;
  file: string;
}

/** Strip XML comments, leaving everything else byte for byte. */
export function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** A `<tam>` block's opening-tag attributes, as written (entities NOT decoded). */
export function tamAttrs(block: string): Record<string, string> {
  const end = block.indexOf('>');
  const open = end >= 0 ? block.slice(0, end + 1) : block;
  const attrs: Record<string, string> = {};
  for (const m of open.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

const siteCache = new Map<string, TamSite[]>();

/** Every `<tam>` site of one level's file, in the file's own order. */
export function tamsOf(level: string, file: string): TamSite[] {
  const key = `${level}/${file}`;
  const cached = siteCache.get(key);
  if (cached) return cached;
  const xml = readFile(level, file);
  const titles = parseCallXml(xml).map((tam) => tam.title ?? '');
  const blocks = stripComments(xml).match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  if (blocks.length !== titles.length) {
    throw new Error(
      `corpus: ${key} parses as ${titles.length} tam(s) but slices as ${blocks.length} block(s) — the engine's `
      + 'parser and this reader disagree, so neither index can be trusted',
    );
  }
  const sites = blocks.map((block, index) => ({
    title: titles[index],
    index,
    xml: block,
    attrs: tamAttrs(block),
    level,
    file,
  }));
  siteCache.set(key, sites);
  return sites;
}

/** Every tam site across `levels`, WALKED IN THE ORDER GIVEN, files sorted inside a level. */
export function sitesOfTitle(title: string, levels: readonly string[]): TamSite[] {
  const out: TamSite[] = [];
  for (const level of levels) {
    for (const file of filesOf(level)) {
      for (const site of tamsOf(level, file)) if (site.title === title) out.push(site);
    }
  }
  return out;
}

/**
 * One title's authorings pooled as the engine's `Sequencer` takes them — the wrapper and separator this
 * reproduces are the ones `engine/test/lib/engine-calls.mjs` has always produced, so the 134 harnesses that
 * read through it see no change beyond the comment-only blocks disappearing.
 */
export function pooledXmlOfTitle(title: string, levels: readonly string[]): string {
  return `<calls>${sitesOfTitle(title, levels).map((s) => s.xml).join('\n')}</calls>`;
}

/** Every distinct title across `levels`, as the engine's parser decodes them. */
export function titlesOf(levels: readonly string[]): Set<string> {
  const titles = new Set<string>();
  for (const level of levels) {
    for (const file of filesOf(level)) {
      for (const site of tamsOf(level, file)) if (site.title) titles.add(site.title);
    }
  }
  return titles;
}

/**
 * One level's files as the `Record<path, xml>` that `poc-teacher/src/catalog.ts`'s `buildCatalog` takes from Vite's
 * globs in the browser — so the build scripts feed it the same shape the app does.
 */
export function filesRecord(level: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of filesOf(level)) out[`${level}/${file}`] = readFile(level, file);
  return out;
}

/**
 * Whether a tam matches a query the way the corpus's own tams are addressed: every key the query names must equal
 * that attribute, and the two FORMATION keys (`from`, `formation`) are one question — a tam declares the formation
 * it is written for in either, and every tam in `ms/circle.xml` uses `formation` alone with `from` empty.
 *
 * This is the rule `book/tools/make-animations.mjs`'s `findTam` applies to `start-formations.json`'s queries, moved
 * here so the book, the game and any future caller cannot answer "is this the tam" three ways. Compared against
 * the RAW attributes, which is what the shipped queries are written in.
 */
export function matchesTamQuery(attrs: Readonly<Record<string, string>>, query: Readonly<Record<string, string>>): boolean {
  const FORMATION_KEYS = new Set(['from', 'formation']);
  for (const [key, value] of Object.entries(query)) {
    if ((attrs[key] ?? '') === value) continue;
    if (!FORMATION_KEYS.has(key)) return false;
    if ((attrs.formation ?? '') === value) continue;
    if ((attrs.from ?? '') === value) continue;
    return false;
  }
  return true;
}
