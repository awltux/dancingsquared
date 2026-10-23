// THE GENERATED-INSTANCE SUFFIX, AND THE ONE PREDICATE THAT KNOWS IT.
//
// WHY THIS IS A MODULE WITH NO IMPORTS AT ALL. `files.ts` reads the filesystem, so a BROWSER cannot import it —
// but the two Vite apps glob the corpus themselves (`import.meta.glob('@corpus/*/*.xml')`) and have to skip
// these files BY KEY, in the browser, with no `node:fs` in the bundle. So the convention lives here and both
// sides import the same predicate: the Node reader (`files.ts`) to exclude them, and the app loaders to filter
// the keys their glob returned. Two spellings of `.virtual.xml` would drift (AGENTS §11.4.4).
//
// WHAT THE SUFFIX MEANS. `<level>/<family>.virtual.xml` holds the whole-set INSTANCES that
// `book/tools/make-virtual.mjs` generates for calls the corpus only authors as subset units — `ms/circle.virtual.xml`
// sits beside `ms/circle.xml`, the file that authors `Circle Four Left`. The tams are GENERATED GEOMETRY, not
// authored data (`VirtualCallInfo` marks one at runtime; the suffix marks it on disk), so no census of authored
// tams may count them.
//
// MEASURED, and it is why the convention exists at all. Those seven tams used to live in `assets/virtual/tams.xml`,
// a directory that was not a level. That layout cost three gates: `engine/test/call-titles.mjs` counted the tams
// (its generated header says 500 files / 5489 tams, the directory made it 501 / 5496),
// `poc/tools/corpus-key-probe.mjs` counted eleven level directories against a pinned ten, and
// `poc/tools/mirror-moves-probe.mjs` reached a degenerate facing curve (`cx3="0" cx4="1" cy4="0" x4="1" y4="0"`,
// `atan2(0, 0) = 0`) that the corpus authors but never loads, reporting π instead of 0.
//
// THE ALTERNATIVE REJECTED: excluding by a file-list allowlist. A list is a second place the layout is written
// down and it goes stale on the first new generated file; the name carries the fact.

/** The suffix a generated whole-set instance carries: `ms/circle.virtual.xml`. */
export const VIRTUAL_SUFFIX = '.virtual.xml';

/**
 * Whether a corpus FILE NAME (no directory) is a generated instance rather than an authored authoring.
 *
 * A NAME, not a path: every caller already has the file's name from a directory listing or a glob key's last
 * segment, and a suffix test on a path would also match a directory that happened to end that way.
 */
export function isVirtualFile(file: string): boolean {
  return file.endsWith(VIRTUAL_SUFFIX);
}
