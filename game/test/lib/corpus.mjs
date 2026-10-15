// Corpus loading for the game's probes. NOT a probe (the runner only picks up `test/*-probe.mjs`), and
// not app code either — it reads the POC's asset tree with `fs`, which is a Node-only concern and has no
// business in `src/`.
//
// WHY THE GAME READS THE POC'S CORPUS. `poc/src/assets/` IS the canonical corpus in this repo
// (AGENTS.md §1), and `engine/test/mainstream.mjs` loads it the same way. A second copy under `game/`
// would be the duplication this repo keeps paying for.
//
// THE APPLIER IS THE REAL ONE. These probes drive the engine through `createEngineApplier`, so what is
// measured is the engine's own legality, naming and refusal strings — a stub would make the probes
// measure the stub.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, callMeta } from 'dancing-squared-engine';
import { createEngineApplier } from '../../src/engine/applier.ts';

setParser(DOMParser);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..');
const ASSETS = path.join(REPO, 'poc', 'src', 'assets');

export const movesXml = fs.readFileSync(path.join(ASSETS, 'moves.xml'), 'utf8');
export const formationsXml = fs.readFileSync(path.join(ASSETS, 'formations.xml'), 'utf8');

/**
 * Every Mainstream call the corpus carries, as `{ name, xml }` with the name taken from `callMeta`.
 *
 * REGISTRATION IS BY TITLE (AGENTS.md trap 7: a position into an authored list is not an identity), and
 * a file that yields no title is a moves/rule file rather than a call — `engine/test/mainstream.mjs`
 * skips it the same way.
 */
export function corpusCalls() {
  const dir = path.join(ASSETS, 'ms');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = callMeta(xml).title;
    if (title) out.push({ name: title, xml });
  }
  return out;
}

/**
 * An applier holding ONLY the first `poolSize` titles of `pool`.
 *
 * THE SLICE IS THE LEVEL. `CallLibrary` treats "the level IS the call set" (engine/README.md), so
 * constructing a sequencer from the sliced titles is what makes the offering list level-scoped by
 * construction rather than by a filter that could drift (DESIGN.md 5).
 */
export function applierFor(pool, poolSize) {
  const wanted = new Set(pool.slice(0, poolSize));
  const calls = corpusCalls().filter((c) => wanted.has(c.name));
  return { applier: createEngineApplier({ movesXml, formationsXml, calls }), registered: calls.length };
}
