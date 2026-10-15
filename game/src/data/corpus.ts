// The app's engine seam: a `GameApplier` bound to the real corpus.
//
// THE TWIN OF `game/test/lib/corpus.mjs`, AND THE DIFFERENCE BETWEEN THEM IS ONLY WHERE THE BYTES COME
// FROM. The probe reads them with `fs` under Node; the app gets them from Vite `?raw`. Everything that
// decides BEHAVIOUR — `createEngineApplier`, `poolFor`, the level's slice — is imported from the same
// modules in both, so the app and its gate cannot disagree about what a level is.
import { createEngineApplier } from '../engine/applier.ts';
import { poolFor, type CallPool } from '../puzzle/pool.ts';
import type { LevelSpec } from '../puzzle/types.ts';
import { corpusCalls, formationsXml, movesXml } from './assets.ts';

let cachedCalls: { name: string; xml: string }[] | null = null;

/** Every Mainstream call the corpus carries, parsed once. */
function allCalls(): { name: string; xml: string }[] {
  cachedCalls ??= corpusCalls();
  return cachedCalls;
}

interface LevelRuntime {
  /** The applier the generator and the UI share. One sequencer per level, holding only that level's calls. */
  applier: ReturnType<typeof createEngineApplier>;
  /** How many of the level's titles the corpus actually carries — it can be fewer, if a title is missing. */
  registered: number;
}

/**
 * Build the runtime for a level.
 *
 * THE SLICE IS THE LEVEL. `CallLibrary` treats "the level IS the call set" (engine/README.md), so a
 * sequencer built from the sliced titles has level-scoped legality BY CONSTRUCTION rather than by a filter
 * at the call site — which is the property DESIGN.md §5 relies on.
 *
 * Candidates in the pool that the corpus does not carry are silently absent rather than fatal: the ladder
 * is authored data and the corpus is too, and a title that exists in one and not the other is a data
 * question the ladder census reports (`tools/measure-ladder.mjs` prints `registered`). Throwing here would
 * turn that measurement into a blank screen.
 */
export function createLevelRuntime(level: LevelSpec, pool: CallPool): LevelRuntime {
  const wanted = new Set(poolFor(level, pool));
  const calls = allCalls().filter((c) => wanted.has(c.name));
  return { applier: createEngineApplier({ movesXml, formationsXml, calls }), registered: calls.length };
}
