// WHERE THE CORPUS IS AND WHAT FILES IT HOLDS — paths and bytes, and nothing that needs the engine.
//
// Split from `index.ts` so a caller that only needs the bytes (`poc-teacher`'s build script, the game's
// whole-file loader) does not drag the parser in, and so the one import that reads the filesystem is visible
// at the top of exactly one module.
//
// THE LOCATION IS NOT WRITTEN DOWN HERE. `vite.corpus.ts` at the repository root is the single place the corpus
// path exists, for the two Vite apps' `@corpus` alias and for every Node reader alike; this module imports it.
// A second `join(process.cwd(), 'assets')` is precisely the class of copy that produced `game/src/assets/` and
// its `--check` gate (AGENTS.md §8 trap 26).
import fs from 'node:fs';
import path from 'node:path';

import { CORPUS } from '../../vite.corpus.ts';

/** The repository's one copy of the tamination corpus. */
export function corpusRoot(): string {
  return CORPUS;
}

/** The directory a level's call files live in. A level with no directory is not an error — see `filesOf`. */
export function levelPath(level: string): string {
  return path.join(CORPUS, level);
}

const fileCache = new Map<string, string[]>();

/**
 * The `<call>` XML files of one level, IN THE DIRECTORY'S OWN ORDER, or [] when the level has no directory.
 *
 * NOT SORTED, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. The order a level's files are walked decides the
 * order a multi-authoring title's `<tam>` blocks are pooled, and the engine resolves an EQUAL match error by array
 * order (`FormationMatcher.findMatchingVariant`). Sorting would be more deterministic across machines — and
 * `engine/test/corpus-inventory.mjs` MEASURED that it changes the walk order in **7 of the 11** level directories
 * on the shipped corpus (`ms`, `plus`, `a1`, `c1`, `c2`, `c3a`, `c3b`), which would move the pooling offsets
 * `engine/test/catalogue.mjs` pins (Circulate: `c1` at 7, `ms` at 2528). So this reader preserves what the filesystem gives, exactly as the reader it replaces did, and
 * making the order deterministic belongs in its own change with its own re-measurement.
 *
 * A MISSING LEVEL IS EMPTY, NOT AN ERROR: `PERMISSION_LEVELS` and the harnesses' `ASSET_LEVELS` both name
 * `ssd` and `discovered`, which have no asset directory, and a reader that threw would make every caller
 * carry a list of the levels that happen to exist today.
 */
export function filesOf(level: string): string[] {
  const dir = levelPath(level);
  const cached = fileCache.get(dir);
  if (cached) return cached;
  if (!fs.existsSync(dir)) {
    fileCache.set(dir, []);
    return [];
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
  fileCache.set(dir, files);
  return files;
}

/** One level's file, as text. Throws (loudly, with the path) rather than returning '' for a missing file. */
export function readFile(level: string, file: string): string {
  const full = path.join(levelPath(level), file);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (err) {
    throw new Error(`corpus: cannot read ${level}/${file}: ${String((err as Error).message ?? err)}`);
  }
}
