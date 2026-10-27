// Browser asset loading: the corpus, as raw XML, through Vite.
//
// THE CORPUS IS READ FROM `assets/` AT THE REPOSITORY ROOT, through the `@corpus` alias — there is ONE copy of it
// and no build step that duplicates the bytes. An earlier version of this header said the opposite, and that claim
// is corrected rather than repeated: `import.meta.glob` DOES reach outside Vite's root (the POC has globbed the
// repo-root `modules/` from `poc/src/` since the ceder corpus landed), and the empty object that made a copy look
// necessary came from one `../` too few — see `vite.corpus.ts`, which measured both directions and is the one place
// the corpus's location is written down.
//
// THE ONLY FILE IN THE PACKAGE THAT USES `import.meta.glob`. That is deliberate: it is a Vite compile-time
// transform, so anything importing it needs the bundler, while `src/puzzle/**` must stay loadable by bare
// Node for the probes. Keeping it here makes the split a property of the import graph rather than a
// convention someone has to remember.
// THE POOLING RULE, from the corpus package rather than the engine: it needs the `<tam>` slice, not a DOM parse, and
// `packages/corpus` is the module that owns it — which also keeps the engine's document parser out of the browser
// bundle for a title list.
import { pooledByTitle } from 'dancing-squared-corpus/blocks';
import { isVirtualFile } from 'dancing-squared-corpus/virtual';

const MOVES = import.meta.glob('@corpus/moves.xml', { query: '?raw', import: 'default', eager: true });
const FORMATIONS = import.meta.glob('@corpus/formations.xml', { query: '?raw', import: 'default', eager: true });
const CALL_FILES = import.meta.glob('@corpus/ms/*.xml', { query: '?raw', import: 'default', eager: true });

function only(map: Record<string, unknown>, what: string): string {
  const values = Object.values(map);
  if (values.length !== 1) throw new Error(`expected exactly one ${what}; the glob found ${values.length}`);
  return String(values[0]);
}

export const movesXml = only(MOVES, 'moves.xml');
export const formationsXml = only(FORMATIONS, 'formations.xml');

/**
 * Every Mainstream call the corpus carries, as `{ name, xml }` with the name being a `<tam>` TITLE.
 *
 * REGISTRATION IS BY TITLE, never by file basename (AGENTS.md trap 7: a position into an authored list is not an
 * identity), and one pair is emitted per tam title rather than per file: MEASURED, the per-FILE reading named 66 calls
 * where the corpus carries **315 distinct titles over 66 files** (`game/test/corpus-twins-probe.mjs`). That number is
 * not pinned here — it moves with the corpus — the probe prints it and fails if the two loaders ever disagree. A file
 * that yields no title is a moves/rule file rather than a call and contributes nothing.
 *
 * THE FILE ORDER IS THE DIRECTORY'S, and it does not need to be the pool's: `poolFor` selects from the
 * ORDERED title list in `src/puzzle/calls-data.ts`, so this only has to supply the XML for a title.
 */
export function corpusCalls(): { name: string; xml: string }[] {
  // ONE PAIR PER TAM TITLE, not one per file — and the walk is the CORPUS PACKAGE's, not this file's any more. The
  // pooling rule was written twice (here and in `corpus-node.ts`), each copy carrying the same measurement; it now
  // lives in `packages/corpus/blocks.ts::pooledByTitle`, the module that already owns the `<tam>` slice, so this file
  // is only the ENUMERATION — which is the half a browser and a Node process genuinely cannot share.
  // `game/test/corpus-twins-probe.mjs` is the gate that the two loaders still agree.
  //
  // THE GENERATED INSTANCES ARE SKIPPED BY KEY. `ms/circle.virtual.xml` holds a whole-set instance the BOOK's
  // generator placed, not an authored call: registering it would put invented geometry into the game's pool. The
  // Node loader gets the same exclusion from `filesOf`; this glob is a SECOND enumeration (Vite's), so it applies
  // the same predicate — imported from the corpus package, never restated (AGENTS §11.4.4, §1).
  const files = Object.keys(CALL_FILES)
    .filter((path) => !isVirtualFile(path))
    .sort()
    .map((path) => ({ file: path, xml: String(CALL_FILES[path]) }));
  return pooledByTitle(files).map(({ name, xml }) => ({ name, xml }));
}
