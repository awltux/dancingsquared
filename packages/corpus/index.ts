// THE CORPUS'S CALL INVENTORY, ONCE — every `<tam>` site, its title, and the block text the engine parses.
//
// WHY THIS MODULE EXISTS. "Which titles does the corpus carry, in which file, across which levels" was answered
// by five separate implementations, with five level lists and four shapes: `engine/test/lib/engine-calls.mjs`
// (imported by 134 harnesses and probes), `book/tools/lib/load.mjs`, `poc-teacher/src/catalog.ts`'s node feed,
// `game/src/data/corpus-node.ts`, and `scripts/call-titles.mjs`. The duplication had already cost correctness:
//
//   * the harnesses' reader scanned `<tam>` with a RAW REGEX and did not strip comments, so it counted the tam
//     blocks that are commented out in the corpus. MEASURED: 2203 titles by that scan, 2191 by the engine's own
//     parser, and the 12 that differ exist only inside `<!-- -->` (`Heads Start`, `Sides Start`,
//     `Bend the Line and Spread`, `Magic Column Right and Left Thru`, and eight `Left/Right-Hand Star … and Roll`),
//     spread over four files (`a1/split_square_thru.xml`, `c1/magic_column_formation.xml`, `ms/star.xml`,
//     `plus/anything_and_spread.xml`). Eight more titles in `ms/star.xml` are BOTH commented and live, so their
//     pool carried a phantom second authoring. `engine/src/sequencer/call-titles.ts` — generated from the engine's
//     parser — has said 2191 all along.
//   * the book scanned the same way and paired the resulting INDEX with a DOM parse, so in those four files the
//     index addressed the wrong `<tam>` (recorded when the book started reporting unresolved start queries).
//
// THE EXTRACTION, AND WHY IT IS NOT THE ENGINE'S PARSER AT RUNTIME. The two candidates were measured:
//
//     read + strip comments + regex :  128 ms   (500 files, 4.3 MB, 2191 titles)
//     read + a full document parse  : 1381 ms   (same, 2191 titles)
//     read + the engine's parseCallXml : 1934 ms (same, 2191 titles)
//
// Every harness and probe runs in its own process, so a runtime DOM parse is ~1.8 s of every one of them — MEASURED
// at +113 s on the light tier when this module used `parseCallXml` for the title list. So the RUNTIME extractor is
// the comment-stripped regex, and THE ENGINE'S PARSER IS THE JUDGE rather than the path:
// `engine/test/corpus-inventory.mjs` compares this module against `parseCallXml` for EVERY file in the corpus, not a
// sample, and pins the 2191/2203/12 facts by name. That is the same relationship `engine/test/catalogue.mjs` has to
// the pooling order: the cheap path is proven equal to the authoritative one by a gate that runs on every change.
//
// THE BLOCK TEXT IS THE FILE'S OWN, not a re-serialisation: the blocks are sliced after stripping comments, so a
// corpus entity (`&quot;O&quot; Wheel Fan Thru`) keeps the spelling the file uses. Titles ARE entity-decoded, because
// a title is an identity and `CALL_TITLE`/`callMeta` spell it decoded; the RAW attribute stays on `attrs` for the one
// caller that compares against the file as written (the book's `tam_xml_queries`).
//
// WHAT THIS MODULE DOES NOT OWN, on purpose: the LEVEL LIST (each caller passes its own — `ASSET_LEVELS` for the
// harnesses, `['ms','plus']` for the book, `ms` for the game and the teacher, because a silent level change moves
// every count in the docs), the POOLING ORDER (highest-first is the harnesses' measured choice), the hidden-tam
// rule (`display="no"` filtering is the teacher's), and the engine-coupled title algebra (`implementedTitles`
// unions `CODED_MOVES` aliases and stays with the engine's tests). It also has NO ENGINE DEPENDENCY: it reads bytes.
import { filesOf, readFile } from './files.ts';

// The path half is re-exported from the root entry so a caller needs ONE specifier; `./files` stays available for
// the callers that only want bytes (the teacher's build script, the game's whole-file loader).
export { corpusRoot, filesOf, levelPath, levelsAvailable, readFile } from './files.ts';

/** One `<tam>` in the corpus: its identity, its position, and its own text. */
export interface TamSite {
  /**
   * The DECODED title — the identity a caller matches on, spelled as `CALL_TITLE` and `callMeta` spell it. The RAW
   * spelling is on `attrs.title` for the one caller that needs it: the book's `tam_xml_queries` compare against the
   * file's attributes as written.
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

/** The five XML entities the corpus uses, decoded. `&amp;` LAST, so `&amp;quot;` does not become a quote. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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

/**
 * Every `<tam>` site of one level's file, in the file's own order — comments excluded, so the index is the same
 * one the engine's parser produces (proven per file by `engine/test/corpus-inventory.mjs`).
 */
export function tamsOf(level: string, file: string): TamSite[] {
  const key = `${level}/${file}`;
  const cached = siteCache.get(key);
  if (cached) return cached;
  const blocks = stripComments(readFile(level, file)).match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  const sites = blocks.map((block, index) => {
    const attrs = tamAttrs(block);
    return {
      title: decodeEntities(attrs.title ?? ''),
      index,
      xml: block,
      attrs,
      level,
      file,
    };
  });
  siteCache.set(key, sites);
  return sites;
}

const byTitleCache = new Map<string, Map<string, TamSite[]>>();

/**
 * Every title's sites across `levels`, in ONE WALK, keyed by title in first-seen order.
 *
 * THE ONE WALK IS THE POINT. The obvious shape — ask for one title at a time and filter the corpus — is
 * `titles × files`, and MEASURED it cost `engine/test/catalogue.mjs` 5.5 s → 14.1 s and the light tier
 * 432 s → 545 s when `callsByTitle` was built on it. A caller that wants many titles (`callsByTitle` wants all
 * 2191) takes this map once; a caller that wants one takes `sitesOfTitle`, which is a lookup into it.
 */
export function sitesByTitle(levels: readonly string[]): Map<string, TamSite[]> {
  const key = levels.join('|');
  const cached = byTitleCache.get(key);
  if (cached) return cached;
  const out = new Map<string, TamSite[]>();
  for (const level of levels) {
    for (const file of filesOf(level)) {
      for (const site of tamsOf(level, file)) {
        const sites = out.get(site.title);
        if (sites) sites.push(site);
        else out.set(site.title, [site]);
      }
    }
  }
  byTitleCache.set(key, out);
  return out;
}

/** Every tam site of one title across `levels`, WALKED IN THE ORDER GIVEN, files in the directory's order. */
export function sitesOfTitle(title: string, levels: readonly string[]): TamSite[] {
  return sitesByTitle(levels).get(title) ?? [];
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
  return new Set(sitesByTitle(levels).keys());
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
 * How a tam matches a query the way the corpus's own tams are addressed: every key the query names must equal that
 * attribute, and the two FORMATION keys (`from`, `formation`) are one question — a tam declares the formation it is
 * written for in either, and every tam in `ms/circle.xml` uses `formation` alone with `from` empty.
 *
 * Returns WHICH way it matched, because a caller counts the fallback: `book/tools/make-animations.mjs` prints how
 * many of its start queries needed the declared-formation reading ("1 matched on a tam's own declared formation"),
 * and that number is how a corpus that has quietly dropped an attribute shows up instead of being absorbed.
 *
 * This is the rule `book/tools/make-animations.mjs`'s `findTam` applied to `start-formations.json`'s queries, moved
 * here so the book, the game and any future caller cannot answer "is this the tam" three ways. Compared against
 * the RAW attributes, which is what the shipped queries are written in.
 */
export function tamQueryMatch(attrs: Readonly<Record<string, string>>, query: Readonly<Record<string, string>>): 'direct' | 'declared-formation' | null {
  const FORMATION_KEYS = new Set(['from', 'formation']);
  let declared = false;
  for (const [key, value] of Object.entries(query)) {
    if ((attrs[key] ?? '') === value) continue;
    if (!FORMATION_KEYS.has(key)) return null;
    if ((attrs.formation ?? '') === value || (attrs.from ?? '') === value) {
      declared = true;
      continue;
    }
    return null;
  }
  return declared ? 'declared-formation' : 'direct';
}

/** `tamQueryMatch` as a predicate, for the callers that do not need to know how it matched. */
export function matchesTamQuery(attrs: Readonly<Record<string, string>>, query: Readonly<Record<string, string>>): boolean {
  return tamQueryMatch(attrs, query) !== null;
}
