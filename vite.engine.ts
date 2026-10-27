// WHERE THE ENGINE'S ENTRY POINTS ARE, written once for the two Vite apps - and WHY the aliases exist at all.
//
// THE ALIAS IS NOT (ONLY) ABOUT RESOLUTION: IT IS ABOUT THERE BEING ONE INSTANCE OF THE ENGINE. The engine injects a
// global DOMParser (`setParser`) and keeps module-level state, so a bundle that ends up with two copies - one
// resolved from an app's `node_modules`, one from the workspace's - can behave as two engines that agree on nothing.
// Pointing the specifier at the sibling workspace's built `dist` makes every importer, including
// `dancing-squared-stage`, share one module instance. That reason used to be repeated in each app's config; the
// corpus alias (`vite.corpus.ts`) is the same trade, made the same way.
//
// THE SUBPATHS ARE THE ENGINE'S OTHER SIX ENTRIES (`engine/src/entries/`, published in `engine/package.json`). They
// are aliased one by one rather than through a prefix rule, because an alias is matched by exact specifier and a
// prefix would also rewrite the bare `dancing-squared-engine` specifier. `engine/test/entry-tiers.mjs` pins this map
// against the package's `exports` keys, so an entry cannot exist in one place and not the other: a published entry
// the apps cannot resolve fails at dev-server time, which is later and louder than a gate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The engine package's directory: one workspace member, beside the apps that consume it. */
export const ENGINE = path.join(here, 'engine');

/** `engine/dist/entries/<name>.js` - where `tsc` puts an entry point. */
const entry = (name: string): string => path.join(ENGINE, 'dist', 'entries', `${name}.js`);

/** Every engine specifier the apps may import, with the built file it resolves to. */
export const engineAlias: Record<string, string> = {
  'dancing-squared-engine': path.join(ENGINE, 'dist', 'index.js'),
  'dancing-squared-engine/core': entry('core'),
  'dancing-squared-engine/document': entry('document'),
  'dancing-squared-engine/ids': entry('ids'),
  'dancing-squared-engine/authoring': entry('authoring'),
  'dancing-squared-engine/sequencer': entry('sequencer'),
  'dancing-squared-engine/all8': entry('all8'),
};
