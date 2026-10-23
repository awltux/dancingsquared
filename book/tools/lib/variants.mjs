// A BINDING NAMES A VARIANT, NOT A POSITION.
//
// WHY THIS EXISTS. `call-map.json` stores one site per call, and that site USED to be `{file, tamIndex}` - a
// position into an authored list. The corpus was retitled on 2026-10-20, and every stored position below an
// insertion then pointed at a different call: MEASURED, 7 of the book's 75 animated cards drew an authoring
// whose title was not the card's, with `m03b` playing `Promenade 1/2` under `Single File Promenade`. `e199c42`
// repaired those seven by regenerating the map, which is a repair and not a guard. This module is the guard: a
// binding carries the call-variant id (`V1-`, level + title + formation ROOT), and the corpus is asked which
// authoring has that id at build time.
//
// THE TITLE STAYS BESIDE THE ID AS A HINT, and it is a PERFORMANCE decision rather than an identity one.
// Resolving by id alone means building every authoring in the corpus (~1,800 calls, ~4 minutes) to answer one
// lookup; the hint narrows the search to the sites carrying that title (a handful), and the ID decides - a
// candidate whose id does not match is not used, however well its title matches.
//
// THE ID IS THE ENGINE'S. `variantOf` reads the start board's formation id, resolves it to the ledger's ROOT,
// and mints `V1-` from the three inputs. Nothing here re-implements that arithmetic - the whole point of the
// root is that one definition exists (`engine/src/sequencer/call-variant-id.ts`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogue, loadCall, root } from './load.mjs';

/** The append-only ledger of formation roots, as a plain `formation id -> root` object. */
export function loadRoots() {
  return JSON.parse(readFileSync(join(root, 'assets', 'formation-roots.json'), 'utf8')).roots ?? {};
}

/** The board a bundle starts from, carrying each dancer's gender - what both derived ids are functions of. */
export function startBoard(eng, bundle) {
  return { dancers: eng.allPoses(bundle, 0).map((p, i) => ({ ...p, gender: bundle.dancers[i].gender })) };
}

/** The variant an authoring realises, with the shape and root it was derived from (for error messages). */
export function variantOf(eng, bundle, level, roots) {
  const shape = eng.formationId(startBoard(eng, bundle));
  const rootId = eng.formationRootOf(shape, roots);
  return { variantId: eng.callVariantId(level, bundle.title, rootId), shape, root: rootId };
}

/**
 * The level a corpus file lives in: `ms/foo.xml` -> `ms`. A level is part of a variant's identity, so reading it
 * off the path is the one place the book states it.
 */
export function levelOf(file) {
  return String(file).split('/')[0];
}

/**
 * Resolve a binding to the authoring it names, or null when the corpus no longer has one.
 *
 * The cache is keyed by `level|title` because that is the hint's whole extent: one walk of the candidate sites
 * per title, then a map lookup per binding. A candidate that fails to build is skipped rather than thrown -
 * `identity-census` counts the corpus's two unbuildable authorings, and the book must not be the place that
 * discovers them.
 */
export function makeResolver(eng, roots, { levels } = {}) {
  const byTitle = catalogue(levels);
  const cache = new Map();
  const attempts = { built: 0, failed: 0 };

  const indexFor = (level, title) => {
    const key = `${level}|${title}`;
    if (cache.has(key)) return cache.get(key);
    const map = new Map();
    for (const site of byTitle.get(title) ?? []) {
      if (levelOf(site.file) !== level) continue;
      attempts.built++;
      try {
        const bundle = loadCall(eng, site);
        if (!bundle?.dancers?.length) throw new Error('built no dancers');
        const { variantId } = variantOf(eng, bundle, level, roots);
        if (!map.has(variantId)) map.set(variantId, site);
      } catch {
        attempts.failed++;
      }
    }
    cache.set(key, map);
    return map;
  };

  return {
    attempts,
    resolve(binding) {
      if (!binding?.variantId) return null;
      return indexFor(binding.level, binding.title).get(binding.variantId) ?? null;
    },
    /** Every id this level+title pair can mint - used to name near misses when a binding does not resolve. */
    known(level, title) {
      return [...indexFor(level, title).keys()];
    },
  };
}
