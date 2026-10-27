// WHERE THE ENGINE'S ENTRY POINTS ARE, written once for the three Vite apps - and WHY the aliases exist at all.
//
// THE ALIAS IS NOT (ONLY) ABOUT RESOLUTION: IT IS ABOUT THERE BEING ONE INSTANCE OF THE ENGINE. The engine injects a
// global DOMParser (`setParser`) and keeps module-level state, so a bundle that ends up with two copies - one
// resolved from an app's `node_modules`, one from the workspace's - can behave as two engines that agree on nothing.
// Pointing the specifier at the sibling workspace's built `dist` makes every importer, including
// `dancing-squared-stage`, share one module instance. That reason used to be repeated in each app's config; the
// corpus alias (`vite.corpus.ts`) is the same trade, made the same way.
//
// THE SUBPATHS ARE THE ENGINE'S OTHER SIX ENTRIES (`engine/src/entries/`, published in `engine/package.json`).
//
// THE MAP IS AN ARRAY AND THE BARE SPECIFIER IS ANCHORED BY A REGEXP, which is a correction rather than a style. A
// STRING `find` ALSO MATCHES EVERYTHING UNDER IT: Vite 5.4.21's own matcher (`vite/dist/node`, `matches()`) is
// `importee === find || importee.startsWith(find + '/')`, and the FIRST matching entry wins. So a bare specifier
// written as the string key `'dancing-squared-engine'` swallowed the subpath and rewrote `dancing-squared-engine/ids`
// to `<dist>/index.js/ids`. MEASURED in the game's dev server: `[plugin:vite:import-analysis] Failed to resolve
// import "dancing-squared-engine/ids" from "src/puzzle/caption.ts"` - on a tree where every gate was green, because
// the check this map had (in `engine/test/entry-tiers.mjs`) read the KEYS as text and never asked whether a subpath
// RESOLVED, and until that commit no app imported one. The anchored form matches the bare specifier and nothing
// beneath it, so the ORDER of this list stops being load-bearing.
//
// `engine/test/entry-tiers.mjs` pins the map three ways: it is an array of `{ find, replacement }`, it names exactly
// the keys `engine/package.json` publishes, and every specifier - bare and subpath - is matched against this list the
// way Vite matches it, asserting which replacement it lands on. A later bare entry written as a string therefore
// cannot shadow the six, and the failure is a gate rather than a dev-server overlay.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Alias } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The engine package's directory: one workspace member, beside the apps that consume it. */
export const ENGINE = path.join(here, 'engine');

/** `engine/dist/entries/<name>.js` - where `tsc` puts an entry point. */
const entry = (name: string): string => path.join(ENGINE, 'dist', 'entries', `${name}.js`);

/** Every engine specifier the apps may import, with the built file it resolves to. */
export const engineAlias: Alias[] = [
  { find: /^dancing-squared-engine$/, replacement: path.join(ENGINE, 'dist', 'index.js') },
  { find: 'dancing-squared-engine/core', replacement: entry('core') },
  { find: 'dancing-squared-engine/document', replacement: entry('document') },
  { find: 'dancing-squared-engine/ids', replacement: entry('ids') },
  { find: 'dancing-squared-engine/authoring', replacement: entry('authoring') },
  { find: 'dancing-squared-engine/sequencer', replacement: entry('sequencer') },
  { find: 'dancing-squared-engine/all8', replacement: entry('all8') },
];
