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
import { isVirtualFile } from './virtual.ts';

/** The repository's one copy of the tamination corpus. */
export function corpusRoot(): string {
  return CORPUS;
}

/** The directory a level's call files live in. A level with no directory is not an error — see `filesOf`. */
export function levelPath(level: string): string {
  return path.join(CORPUS, level);
}

/**
 * The LEVELS the corpus actually has, as its immediate subdirectories, IN THE DIRECTORY'S OWN ORDER.
 *
 * Derived rather than listed, for the one caller that must not keep a list: `scripts/call-titles.mjs` walks the whole
 * corpus to generate `CALL_TITLE`, and a hand-kept level list there would silently stop seeing a new level — the
 * generated module would then claim to hold "every title the corpus carries" while missing a programme's.
 *
 * The corpus is ONE FLAT LEVEL of directories over `moves.xml`/`formations.xml` (MEASURED: ten level directories and
 * no nesting), so "immediate subdirectory" IS "level"; a nested directory would be a corpus layout change and this
 * function is where it would show up.
 */
export function levelsAvailable(): string[] {
  return fs
    .readdirSync(CORPUS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** ONE DIRECTORY'S LISTING, in the directory's own order, split by the `.virtual.xml` convention. */
interface Listing {
  /** The AUTHORED files: what `filesOf` returns, and the only ones a census of the corpus may count. */
  authored: readonly string[];
  /** The GENERATED whole-set instances (`virtual.ts` says what they are and why they are excluded). */
  virtual: readonly string[];
}

const fileCache = new Map<string, Listing>();

/** An empty listing, shared, frozen — a level with no directory. */
const NO_FILES: Listing = { authored: Object.freeze([] as string[]), virtual: Object.freeze([] as string[]) };

function listingOf(level: string): Listing {
  const dir = levelPath(level);
  const cached = fileCache.get(dir);
  if (cached) return cached;
  if (!fs.existsSync(dir)) {
    fileCache.set(dir, NO_FILES);
    return NO_FILES;
  }
  const xml = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
  const listing: Listing = Object.freeze({
    authored: Object.freeze(xml.filter((f) => !isVirtualFile(f))),
    virtual: Object.freeze(xml.filter((f) => isVirtualFile(f))),
  });
  fileCache.set(dir, listing);
  return listing;
}

/**
 * The AUTHORED `<call>` XML files of one level, IN THE DIRECTORY'S OWN ORDER, or [] when the level has no
 * directory.
 *
 * NOT SORTED, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. The order a level's files are walked decides the
 * order a multi-authoring title's `<tam>` blocks are pooled, and the engine resolves an EQUAL match error by array
 * order (`FormationMatcher.findMatchingVariant`). Sorting would be more deterministic across machines — and
 * `engine/test/corpus-inventory.mjs` MEASURED that it changes the walk order in **7 of the 11** level directories
 * on the shipped corpus (`ms`, `plus`, `a1`, `c1`, `c2`, `c3a`, `c3b`), which would move the pooling offsets
 * `engine/test/catalogue.mjs` pins (Circulate: `c1` at 7, `ms` at 2528). So this reader preserves what the filesystem gives, exactly as the reader it replaces did, and
 * making the order deterministic belongs in its own change with its own re-measurement.
 *
 * A MISSING LEVEL IS EMPTY, NOT AN ERROR: a reader that threw would make every caller carry a list of the levels that
 * happen to exist today. MEASURED: this paragraph used to name `ssd`, the level the POC synthesized with no asset
 * directory; it was retired with CALLERLAB's 2026 replacement (Basic/Mainstream/SSD became one Mainstream programme),
 * so the witness is now a level the ladder no longer names at all - `b1`, retired with the Basic levels - and
 * `engine/test/corpus-inventory.mjs` pins the tolerance by asking `filesOf('b1')` for an empty array.
 *
 * THE GENERATED INSTANCES ARE EXCLUDED, which is the whole reason this function exists rather than each caller
 * walking the directory: `<level>/<family>.virtual.xml` is generated geometry (`virtual.ts`), and a census that
 * counted it would be counting boards nobody authored. MEASURED when they moved into the level directories:
 * without the exclusion, `make-virtual.mjs`'s own dead-row check saw its SEVEN generated tams as new eight-dancer
 * authorings and declared every placement row obsolete.
 *
 * THE RETURNED ARRAY IS FROZEN, because it is the cached one: `filesOf(lv).sort()` would silently reorder the
 * walk for EVERY later reader in the process, and the order is load-bearing (paragraph above). MEASURED before
 * this rule: the one caller that sorted in place was `poc/tools/named-setup-probe.mjs`, which ran before the
 * harnesses that pin pooling offsets. A caller sorts a copy (`[...filesOf(lv)].sort()`, as that probe now does).
 */
export function filesOf(level: string): readonly string[] {
  return listingOf(level).authored;
}

/**
 * The GENERATED whole-set instances of one level, in the directory's own order.
 *
 * This is the reader for the population `filesOf` excludes, so a caller that NEEDS them (the book's
 * `make-animations.mjs` resolves one by `level/<file>#tamIndex`; `book/tools/make-virtual.mjs` reconciles what it
 * wrote against what is on disk) asks for them by name rather than walking the directory and re-stating the
 * suffix. Excluded from `filesOf` and available here is one decision, made once (`virtual.ts`).
 */
export function virtualFilesOf(level: string): readonly string[] {
  return listingOf(level).virtual;
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
