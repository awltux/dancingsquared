// Browser asset loading: the corpus, as raw XML, through Vite.
//
// THE CORPUS IS READ FROM `game/src/assets/`, WHICH IS A COPY OF `poc/src/assets/` — and that copy is not a
// preference. `import.meta.glob` CANNOT REACH OUTSIDE VITE'S ROOT: it only matches files under `root`, and
// `server.fs.allow` governs what may be SERVED rather than what may be GLOBBED. MEASURED, with the globs
// written as `../../poc/src/assets/...`, Vite compiled every one to an EMPTY OBJECT —
//
//     const MOVES = /* #__PURE__ */ Object.assign({});
//
// — and the app sat on "Loading the corpus…" forever, because `only()` throws on zero matches and a boot
// error has nowhere to surface. `game/tools/sync-corpus.mjs` copies the bytes and `--check`s them, and
// `tools/verify-probes.mjs` runs that check first, so the copy cannot silently drift from the original.
//
// THE ONLY FILE IN THE PACKAGE THAT USES `import.meta.glob`. That is deliberate: it is a Vite compile-time
// transform, so anything importing it needs the bundler, while `src/puzzle/**` must stay loadable by bare
// Node for the probes. Keeping it here makes the split a property of the import graph rather than a
// convention someone has to remember.
import { callMeta } from 'dancing-squared-engine';

const MOVES = import.meta.glob('../assets/moves.xml', { query: '?raw', import: 'default', eager: true });
const FORMATIONS = import.meta.glob('../assets/formations.xml', { query: '?raw', import: 'default', eager: true });
const CALL_FILES = import.meta.glob('../assets/ms/*.xml', { query: '?raw', import: 'default', eager: true });

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
