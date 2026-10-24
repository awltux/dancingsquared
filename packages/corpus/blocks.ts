// THE `<tam>` BLOCKS OF ONE FILE'S TEXT, read the one way — pure, so the BROWSER can use it too.
//
// WHY THE SPLIT FROM `index.ts`. The corpus package's reader was Node-only because `index.ts` reaches `./files.ts`,
// which reads the filesystem. That was fine while the engine harnesses and the book tools were the only callers; it
// stopped being fine when `poc-teacher/src/catalog.ts::buildCatalog` turned out to be the tree's last live hand-written
// slice of corpus text, and it was slicing WITHOUT stripping XML comments. MEASURED then (`engine/test/
// tam-readers.mjs`): the teacher pooled 1068 setups where the corpus has 1060, because 8 `Left/Right-Hand Star` titles
// carry a second authoring that exists only inside `<!-- -->` in `ms/star.xml` — so the engine offered 2 matchable
// variants instead of 1 for each, and `scripts/build-fsm-asset.mjs` turns that catalogue into `assets/fsm-ms.json`.
// The corpus package's header records what the same class of bug cost before: 2203 titles by a raw scan against 2191
// by the engine's parser, and the book pairing a raw index with a DOM parse.
//
// SO THE SLICE MOVES HERE, WITHOUT `fs`. `index.ts` keeps the filename walk and the caches (it is the Node entry);
// this module takes the file's TEXT and returns the same `TamSite`s, so a caller that already has the bytes — a Vite
// `import.meta.glob`, a test fixture, a tool that read the file itself — uses the one implementation. `./blocks` is a
// package export for that reason, like `./virtual`: the two entries a BROWSER may import.
//
// THE RULES ARE THE ONES THE NODE PATH ALWAYS HAD, moved rather than restated:
//
//   * comments are stripped BEFORE the slice. A raw `<tam>` scan counts the blocks inside `<!-- -->`; the engine's
//     parser does not, so the two disagree on exactly those files and every index after a commented block shifts.
//   * the block TEXT is the file's own (a corpus entity keeps the spelling the file uses); TITLES are entity-decoded,
//     because a title is an identity and `CALL_TITLE`/`callMeta` spell it decoded. The RAW attribute stays on `attrs`
//     for the one caller that compares against the file as written (the book's `tam_xml_queries`).
//   * `index` is the position `loadCallFromXml`/`parseCallXml` address, which is why the stripping has to happen here
//     and not at the call site.

/** One `<tam>` in the corpus: its identity, its position, and its own text. */
export interface TamSite {
  /**
   * The DECODED title — the identity a caller may match on, spelled as `CALL_TITLE` and `callMeta` spell it. The RAW
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

/**
 * Every `<tam>` site of ONE file's text, in the file's own order, comments excluded — so the index is the one the
 * engine's parser produces (proven per file by `engine/test/corpus-inventory.mjs`).
 *
 * `level`/`file` are carried through rather than derived: a caller loading a Vite glob key knows them, and a caller
 * reading the disk knows them, and neither should have to agree about how to split a path.
 */
export function tamSitesOf(level: string, file: string, xml: string): TamSite[] {
  const blocks = stripComments(xml).match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  return blocks.map((block, index) => {
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
}

/**
 * The call FAMILY a corpus file groups its calls under: the root `<tamination title="…">`, decoded, or null.
 *
 * A family is not a call identity — the engine's `parseTaminationTitle` is the authority, and it is the judge this is
 * checked against (`engine/test/tam-readers.mjs` compares them over every corpus file) — but a browser caller has no
 * engine parser in hand, and the alternative was a second regex in the app.
 *
 * The COMMENTS ARE STRIPPED FIRST, so a `<tamination>` that has been commented out is not the family of a live file.
 */
export function taminationTitle(xml: string): string | null {
  const m = /<tamination\b[^>]*\btitle="([^"]*)"/.exec(stripComments(xml));
  return m === null ? null : decodeEntities(m[1]);
}
