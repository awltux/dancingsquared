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
// IT READS `game/src/assets/` — THE CHECKED COPY, NOT `poc/src/assets/`. That copy exists because
// `import.meta.glob` cannot reach outside Vite's root (see `assets.ts`), and `tools/sync-corpus.mjs --check`
// runs FIRST in the game's gate. So the bytes the server serves are the bytes the gate verified, which is the
// property that matters once a wrong puzzle is served to every player at a level at once (DESIGN.md 7.2).
//
// IT IS THE ONLY FILE UNDER `src/` THAT READS THE FILESYSTEM OR NEEDS NODE TYPES, and it is in no browser
// import graph: `src/data/corpus.ts` is the app's seam, this is the server's and the probes'. `tsconfig.json`
// therefore lists both `vite/client` and `node` — the note there says which file the second one is for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, callMeta } from 'dancing-squared-engine';
import { createEngineApplier } from '../engine/applier.ts';

// THE CAST IS THE TWO `Document` DECLARATIONS, NOT A DEPENDENCY CHOICE. `setParser` takes the DOM lib's
// `typeof DOMParser`; `@xmldom/xmldom`'s returns ITS OWN `Document`, and the compiler names the gap exactly:
// "Type 'Document' is missing the following properties from type 'Document': URL, alinkColor, all, anchors,
// and 194 more". The engine calls `parseFromString` and nothing else on it, so the cast is exact for the use
// it gets — and the alternative, a `Document` shim of our own, would be a second parser.
setParser(DOMParser as unknown as Parameters<typeof setParser>[0]);

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The corpus the game ships, resolved RELATIVE TO THIS FILE so a deployed copy travels with it. */
const ASSETS = path.resolve(HERE, '..', 'assets');

const movesXml = fs.readFileSync(path.join(ASSETS, 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(ASSETS, 'formations.xml'), 'utf8');

let cachedCalls: { name: string; xml: string }[] | null = null;

/**
 * Every Mainstream call the corpus carries, as `{ name, xml }` with the name taken from `callMeta`.
 *
 * REGISTRATION IS BY TITLE (AGENTS.md trap 7: a position into an authored list is not an identity), and a
 * file that yields no title is a moves/rule file rather than a call — `engine/test/mainstream.mjs` skips it
 * the same way. MEASURED in P1's `tools/build-pool.mjs`: the pool holds 62 titles from 66 files.
 *
 * THE FILE ORDER IS THE DIRECTORY'S, and it does not need to be the pool's: `poolFor` selects from the
 * ORDERED title list in `src/puzzle/calls-data.ts`, so this only has to supply the XML for a title.
 *
 * IT IS PARSED ONCE AND KEPT, because both consumers ask for it more than once — the app's gate builds a
 * runtime per level — and the parse is the expensive half of building one.
 */
function corpusCalls(): { name: string; xml: string }[] {
  if (cachedCalls) return cachedCalls;
  const dir = path.join(ASSETS, 'ms');
  const out: { name: string; xml: string }[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
    const xml = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = callMeta(xml).title;
    if (title) out.push({ name: title, xml });
  }
  cachedCalls = out;
  return out;
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
