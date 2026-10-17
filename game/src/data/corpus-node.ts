// The corpus, read from DISK: the Node twin of `src/data/assets.ts`, which reads the same bytes through
// Vite's `?raw` globs. What differs between the two is where the bytes come from; what decides behaviour
// (`createEngineApplier`, the level's slice) is imported from the same modules by both, so the app, the
// gate and the server cannot disagree about what a level is.
//
// WHY THIS IS IN `src/data/` AND NOT IN THE PROBES' `test/lib/`. It began as `game/test/lib/corpus.mjs` —
// probe support, and nothing else read it. Phase 5 gives it a second consumer: the API re-runs the SAME
// generator to validate a submission (DESIGN.md 11), so a second `fs` loader would be a second place for
// "the slice is the level" to drift, which is the failure AGENTS.md 5 forbids by name.
//
// IT READS THE REPOSITORY'S ONE CORPUS, at `assets/` in the root, through the same `CORPUS` constant the Vite apps'
// `@corpus` alias is built from (`vite.corpus.ts`). It used to read a CHECKED COPY under `game/src/assets/`, kept in
// step by `tools/sync-corpus.mjs --check`, because a comment claimed `import.meta.glob` could not reach outside
// Vite's root — a claim that is false, and the copy is gone with it. So the bytes the server serves and the bytes the
// browser bundles are the same file on disk, which is a stronger property than the copy had: there is nothing left
// to drift (DESIGN.md 7.2 is about a wrong puzzle being served to every player at a level at once).
//
// IT IS THE ONLY FILE UNDER `src/` THAT READS THE FILESYSTEM OR NEEDS NODE TYPES, and it is in no browser
// import graph: `src/data/corpus.ts` is the app's seam, this is the server's and the probes'. `tsconfig.json`
// therefore lists both `vite/client` and `node` — the note there says which file the second one is for.
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, callMeta, parseCallXml } from 'dancing-squared-engine';
import { createEngineApplier } from '../engine/applier.ts';
import { CORPUS } from '../../../vite.corpus.ts';

// THE CAST IS THE TWO `Document` DECLARATIONS, NOT A DEPENDENCY CHOICE. `setParser` takes the DOM lib's
// `typeof DOMParser`; `@xmldom/xmldom`'s returns ITS OWN `Document`, and the compiler names the gap exactly:
// "Type 'Document' is missing the following properties from type 'Document': URL, alinkColor, all, anchors,
// and 194 more". The engine calls `parseFromString` and nothing else on it, so the cast is exact for the use
// it gets — and the alternative, a `Document` shim of our own, would be a second parser.
setParser(DOMParser as unknown as Parameters<typeof setParser>[0]);

/** The corpus directory: the root's `assets/`, from the one place that names it. */
const ASSETS = CORPUS;

const movesXml = fs.readFileSync(path.join(ASSETS, 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(ASSETS, 'formations.xml'), 'utf8');

let cachedCalls: { name: string; xml: string }[] | null = null;
let cachedTamTitles: string[] | null = null;

/** The Mainstream call files, read once: name and bytes, in the directory's sorted order. */
function corpusFiles(): { file: string; xml: string }[] {
  const dir = path.join(ASSETS, 'ms');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort().map((file) => ({ file, xml: fs.readFileSync(path.join(dir, file), 'utf8') }));
}

/**
 * Every Mainstream call the corpus carries, as `{ name, xml }` with the name taken from `callMeta`.
 *
 * REGISTRATION IS BY TITLE (AGENTS.md trap 7: a position into an authored list is not an identity), and a
 * file that yields no title is a moves/rule file rather than a call — `engine/test/mainstream.mjs` skips it
 * the same way. MEASURED, and it is the number that limits the pool: **62 titles, one per file**, because
 * `callMeta(xml).title` is the FIRST `<tam>`'s title and every other tam in the file goes unnamed. The
 * corpus actually carries **322 distinct tam titles** — see `corpusTamTitles` below, which is the difference.
 *
 * THE FILE ORDER IS THE DIRECTORY'S, and it does not need to be the pool's: `poolFor` selects from the
 * ORDERED title list in `src/puzzle/calls-data.ts`, so this only has to supply the XML for a title.
 *
 * IT IS PARSED ONCE AND KEPT, because both consumers ask for it more than once — the app's gate builds a
 * runtime per level — and the parse is the expensive half of building one.
 */
function corpusCalls(): { name: string; xml: string }[] {
  if (cachedCalls) return cachedCalls;
  const out: { name: string; xml: string }[] = [];
  const seen = new Set<string>();
  // ONE PAIR PER TAM TITLE, not one per file. A title is the call's identity and a file is a FAMILY of calls, so
  // the old walk named 62 of the corpus's 322 Mainstream titles and handed each the whole document. MEASURED: with
  // the per-file walk level 1 registered ONE of its ten titles. `registerByTitle` then takes only that title's own
  // authorings, so `Boys Trade` stops matching `Partner Trade`'s. The census that justifies it: 62 -> 322 names,
  // 1791 -> 4960 legal applications over the 138 named formations, and no formation losing one.
  for (const { xml } of corpusFiles()) {
    for (const tam of parseCallXml(xml)) {
      if (!tam.title || seen.has(tam.title)) continue;
      seen.add(tam.title);
      out.push({ name: tam.title, xml });
    }
  }
  cachedCalls = out;
  return out;
}

/**
 * EVERY tam title the corpus carries, across every file — 322 distinct ones, where `corpusCalls` offers 62.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE DIFFERENCE THAT MATTERS TO A CURATED POOL. `corpusCalls` names each FILE
 * after its first tam, which is what the app has always drawn: one call per file. A hand-curated
 * `CALLS_IN_ORDER` can name any call the corpus holds, though, and `Circle Left 3/4` is a title four different
 * tams carry (Static Square, Circle, Normal Lines, Normal Lines Compact) while `Circle Left 3/4 Home` is four
 * more — so "does the pool name a real call" and "can the level loader register it" are two different
 * questions with two different answers, and a probe that conflated them would report the second as if the
 * call did not exist.
 *
 * IT READS THE SAME FILES AS `corpusCalls` rather than opening its own — AGENTS.md's rule that there is one
 * `fs` reader for the corpus, so the two cannot disagree about what the corpus holds.
 *
 * IT IS NODE-ONLY, unlike the applier seam both loaders share: its one caller is the probe, and the browser
 * has no use for a list of titles it cannot register.
 */
export function corpusTamTitles(): string[] {
  if (cachedTamTitles) return cachedTamTitles;
  const titles = new Set<string>();
  for (const { xml } of corpusFiles()) {
    for (const tam of parseCallXml(xml)) if (tam.title) titles.add(tam.title);
  }
  cachedTamTitles = [...titles].sort();
  return cachedTamTitles;
}

/**
 * An applier holding ONLY the first `poolSize` titles of `titles`.
 *
 * THE SLICE IS THE LEVEL. `CallLibrary` treats "the level IS the call set" (engine/README.md), so a sequencer
 * built from the sliced titles has level-scoped legality BY CONSTRUCTION rather than by a filter that could
 * drift (DESIGN.md 5). `poolFor(level, pool)` is what produces `titles`; it is not done here so a measurement
 * can drive an arbitrary pool size, which the ladder census does.
 *
 * THE APPLIER IS THE REAL ONE. Callers drive the engine's own legality, naming and refusal strings — a stub
 * here would make every probe above it measure the stub.
 *
 * IT IS NOT CACHED, AND THAT IS THE API'S DECISION TO MAKE. Building one allocates a sequencer over the
 * level's calls; the server builds one per level and keeps it for the container's life, because a cache is
 * not a rule and the place it lives should say so.
 */
export function applierFor(titles: readonly string[], poolSize: number): {
  applier: ReturnType<typeof createEngineApplier>;
  registered: number;
} {
  const wanted = new Set(titles.slice(0, poolSize));
  const calls = corpusCalls().filter((c) => wanted.has(c.name));
  return { applier: createEngineApplier({ movesXml, formationsXml, calls }), registered: calls.length };
}
