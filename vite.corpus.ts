// WHERE THE CORPUS LIVES — declared once, for the two Vite apps and the Node loader alike.
//
// THE CORPUS WAS DUPLICATED, AND THE REASON GIVEN FOR IT WAS A BUG RATHER THAN A VITE LIMIT. `game/src/assets/`
// was a COPY of the POC's corpus, kept identical by `game/tools/sync-corpus.mjs --check`, on the recorded claim
// that "`import.meta.glob` CANNOT REACH OUTSIDE VITE'S ROOT". MEASURED, it can: `poc/src/ceder-modules.ts` has
// globbed the repo-root `modules/` (`../../modules/**/*.json`) since the ceder corpus landed, and pointing the
// game's own globs at the corpus the same way puts it in the bundle — 2094 KB, with the glob's `ms/circle.xml`
// key present. What produced the empty object the copy existed for is ONE `../` TOO FEW: `../../poc/src/assets`
// written from `game/src/data/` resolves to `game/poc/src/assets`, which never existed, and an unmatched glob
// compiles to `{}` silently — MEASURED at 731 KB with no `ms/circle.xml` key, and the app then hangs on "Loading
// the corpus…" because `only()` throws on zero matches and nothing on the page surfaces a boot error.
//
// SO THERE IS ONE CORPUS, at `assets/` in this repository's root, and this file is the only place its location is
// written down. The Vite apps reach it through the `@corpus` alias below — an alias rather than a relative path,
// because a relative path's `../` count is precisely what broke the first time — and the Node loader
// (`game/src/data/corpus-node.ts`) reads the same directory through `CORPUS`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository's one copy of the tamination corpus: `assets/` at the root. */
export const CORPUS = path.join(here, 'assets');

/** The specifier the Vite apps glob the corpus by, so no app counts `../` to reach it. */
export const corpusAlias: Record<string, string> = { '@corpus': CORPUS };
