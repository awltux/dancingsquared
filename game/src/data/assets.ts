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
import { callMeta } from 'dancing-squared-engine';

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
 * Every Mainstream call the corpus carries, as `{ name, xml }` with the name taken from `callMeta`.
 *
 * REGISTRATION IS BY TITLE, never by file basename (AGENTS.md trap 7: a position into an authored list is
 * not an identity). A file that yields no title is a moves/rule file rather than a call and is skipped —
 * measured when the pool was generated (P1), which is why this names **62 titles from 66 files**: one per
 * file, because `callMeta(xml).title` is the FIRST tam's and the corpus's other 260 tam titles go unnamed.
 * `game/src/data/corpus-node.ts` measures the same two numbers and is the twin of this file.
 *
 * THE FILE ORDER IS THE DIRECTORY'S, and it does not need to be the pool's: `poolFor` selects from the
 * ORDERED title list in `src/puzzle/calls-data.ts`, so this only has to supply the XML for a title.
 */
export function corpusCalls(): { name: string; xml: string }[] {
  const out: { name: string; xml: string }[] = [];
  for (const path of Object.keys(CALL_FILES).sort()) {
    const xml = String(CALL_FILES[path]);
    const title = callMeta(xml).title;
    if (title) out.push({ name: title, xml });
  }
  return out;
}
