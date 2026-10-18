// THE CATALOGUE'S NAME FOR A GLOB'D CORPUS FILE - the one key the corpus XML is stored and looked up by.
//
// A `<tam>` file is identified in the catalogue by its CORPUS-RELATIVE name, `level/base` (`CallInfo.file`:
// `ms/circle`), because that is what a call id, an export path and a probe all name. `import.meta.glob` hands
// back its own key instead, and THE KEY'S PREFIX IS NOT THE FILE'S IDENTITY - it is whatever specifier form the
// pattern happened to have.
//
// MEASURED, and it is why this is a function rather than a template literal at each call site: the POC globbed
// `./assets/*/*.xml` and looked its XML up by `./assets/ms/circle.xml`. When the corpus moved to the repository
// root (`0d76cbd`) the pattern became the `@corpus` alias and Vite keyed the same files `../assets/ms/circle.xml`
// - the glob still matched (every file in the bundle, 2094 KB) and EVERY lookup missed. The catalogue parses the
// XML it is handed, so the lists still filled and the app looked alive, while every CALL load threw
// `Missing XML for <file>`: reported as "Dancers arent appearing on Call Editor board now. Sequencer seems ok",
// and the board had no dancers because there was no instance to draw.
//
// An absolute key (`/@fs/F:/.../assets/ms/circle.xml`) names the same file, so the prefix is never counted. The
// corpus is two levels deep - `<corpus>/<level>/<base>.xml` - so the name is its LAST TWO SEGMENTS, and the
// corpus directory's own name is deliberately not repeated here: it lives in `vite.corpus.ts`, which builds the
// directory, and `poc/tools/corpus-key-probe.mjs` measures that the two agree.
//
// Pure, with no imports, so a probe can import it: a rule that has to be measured cannot live in `data.ts`,
// which imports `?raw` assets and cannot run under plain node.

/** The `level/base` a globbed corpus path names, or null when it is not a `<level>/<base>.xml` under a directory. */
export function corpusFileOf(globPath: string): string | null {
  // The leading `(?:[^/]+/)?` is NOT optional decoration: it is what makes `./assets/ms/x.xml`,
  // `../assets/ms/x.xml`, `/@fs/.../assets/ms/x.xml` and a bare `assets/ms/x.xml` all name the same file while a
  // two-segment `ms/x.xml` with no directory at all is refused, because nothing about it says "the corpus".
  const m = /(?:[^/]+\/)([^/]+)\/([^/]+)\.xml$/.exec(globPath);
  return m ? `${m[1]}/${m[2]}` : null;
}
