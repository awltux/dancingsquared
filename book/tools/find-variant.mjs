// WHICH AUTHORING MINTS A CALL-VARIANT ID — the reverse of `V1-…`, which cannot be inverted.
//
// WHY IT EXISTS. A generated instance in the corpus (`<level>/<family>.virtual.xml`, one of the seven
// `book/tools/make-virtual.mjs` writes) carries `parent_id="V1-…"`: the call variant of the authoring it was placed
// FROM. That id is a digest of (level, title, formation ROOT) — `engine/src/sequencer/call-variant-id.ts` — so it
// cannot be computed backwards. The only way from an id to the tam that carries it is to build the candidate
// authorings and mint their ids, which is what this does, with the engine's own arithmetic through
// `lib/variants.mjs` (the module the book's card bindings resolve through, so there is no second spelling of it).
//
// AN ID IS NOT ONE FILE'S IDENTITY, and that is why it prints every candidate. Several authorings of one variant
// share an id BY DESIGN — MEASURED, 38 of ms+plus's 1,730 variants are authored more than once — because the id is
// (level, title, formation ROOT) and a root covers one start SHAPE, not one board. So nothing here picks a winner.
//
// THE RECIPE, in the order the questions actually arrive:
//
//   node book/tools/find-variant.mjs --virtual=ms/circle.virtual.xml
//        Read a generated instance's own `title` and `parent_id` out of the file, then name every authoring that
//        mints that variant. This is the documented way back from `parent_id` (see `assets/README.md`).
//
//   node book/tools/find-variant.mjs V1-85721b7k --title="Circle Four Left"
//        The same question when you already have both halves. `--title` is a HINT that narrows the search and
//        nothing else: a candidate whose id does not match is not printed, however exactly its title matches.
//
//   node book/tools/find-variant.mjs --title="Circle Four Left"
//        Every variant that title has, with the authoring(s) that mint each — the index a placement row in
//        `virtual-placements.json` is written from.
//
// AN ID WITH NO TITLE SEARCHES EVERY LEVEL, and that builds every authoring in the corpus (MEASURED: 5,489 tams,
// minutes rather than seconds), so the tool says so before it starts rather than appearing to hang. It is the
// fallback, not the recipe.
//
// EXIT CODES ARE THE ANSWER: 0 when something was found, 1 when nothing mints what you asked for — a stale
// `parent_id` is a real outcome, because the ledger keeps a CORRECTED FORMATION pointed at its old root while a
// RETITLE or a re-levelling mints a new variant — and 2 for a usage error. A title no level authors is a FAILURE
// and not an empty search: a sweep that silently skips its input measures less than it claims.
//
// Run: node book/tools/find-variant.mjs --virtual=ms/circle.virtual.xml   (from anywhere; the engine must be built)
import { filesOf, levelsAvailable, readFile, tamsOf } from 'dancing-squared-corpus';

import { loadEngine, readAsset } from './lib/load.mjs';
import { loadTags, variantOf } from './lib/variants.mjs';

const USAGE = `usage: node book/tools/find-variant.mjs --virtual=<level>/<file>.virtual.xml
       node book/tools/find-variant.mjs <V1-id> [--title="<call>"] [--level=<level>]
       node book/tools/find-variant.mjs --title="<call>" [--level=<level>]

  --virtual=  a generated instance; its own title and parent_id are read out of the file
  --title=    a HINT that narrows the search; the id still decides
  --level=    one level to search (default: every level the corpus has)`;

/** The value of `--name` or `--name=value`, `undefined` when absent and `''` for a bare `--name`. */
function flagValue(args, name) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}

function main() {
  const args = process.argv.slice(2);
  const refuse = (message) => {
    console.error(message);
    return 2;
  };

  const eng = loadEngine();
  let id = args.find((a) => !a.startsWith('--')) ?? '';
  let title = flagValue(args, 'title') || '';
  const virtualPath = flagValue(args, 'virtual');
  const oneLevel = flagValue(args, 'level') || '';

  if (virtualPath !== undefined) {
    // THE GENERATED INSTANCE ANSWERS BOTH HALVES ITSELF, which is the point: a reader who has the file does not
    // have to know that `parent_id` is keyed on a formation ROOT as well as on a level and a title.
    const [level, ...rest] = String(virtualPath).split('/');
    const file = rest.join('/');
    if (!level || !file) return refuse(`--virtual wants <level>/<file>.virtual.xml, got "${virtualPath}"\n\n${USAGE}`);
    if (!filesOf(level).length) return refuse(`"${level}" is not a level this corpus has\n\n${USAGE}`);
    const [tam] = tamsOf(level, file);
    if (!tam) return refuse(`no <tam> in ${virtualPath} — is that a corpus file this reader can see?`);
    id = tam.attrs.parent_id ?? '';
    title = tam.title;
    if (!eng.isCallVariantId(id)) return refuse(`${virtualPath} carries no parent_id, or it is not a V1- id: "${id}"`);
    console.log(`${virtualPath} is "${title}" from ${level}, placed from variant ${id}`);
  }
  if (!id && !title) return refuse(USAGE);
  if (id && !eng.isCallVariantId(id)) return refuse(`"${id}" is not a call-variant id (they start with V1-)\n\n${USAGE}`);

  const tags = loadTags(eng);
  const levels = (oneLevel ? [oneLevel] : levelsAvailable().filter((lv) => filesOf(lv).length)).slice().sort();
  if (!levels.length) return refuse(`no level to search${oneLevel ? ` (asked for "${oneLevel}")` : ''}`);

  // THE FALLBACK IS ANNOUNCED BEFORE IT RUNS. Without a title there is nothing to narrow on, so the population is
  // the whole corpus rather than the handful of authorings one title has.
  if (!title) {
    const files = levels.reduce((n, lv) => n + filesOf(lv).length, 0);
    console.error(
      `no --title given: building every authoring in ${levels.length} levels (${files} files) — this takes minutes;`
      + ' --title="<call>" narrows it to one title\'s authorings',
    );
  }

  const hits = [];
  const movesXml = readAsset('moves.xml');
  const formationsXml = readAsset('formations.xml');
  let built = 0;
  let skipped = 0;
  for (const level of levels) {
    for (const file of filesOf(level)) {
      // ONE READ PER FILE, and the sites address it by index (`tamsOf` and `loadCallFromXml` share the reader).
      const xml = readFile(level, file);
      for (const site of tamsOf(level, file)) {
        if (title && site.title !== title) continue;
        let bundle;
        try {
          bundle = eng.loadCallFromXml(xml, movesXml, formationsXml, site.index, true);
        } catch {
          skipped++; // an authoring that does not build mints no id — `engine/test/identity-census.mjs` counts those
          continue;
        }
        built++;
        const { variantId, shape, root } = variantOf(eng, bundle, level, tags);
        if (id && variantId !== id) continue;
        hits.push({ site: `${level}/${file}#${site.index}`, title: site.title, from: site.attrs.from ?? '', variantId, shape, root });
      }
    }
  }

  if (!built && !skipped) {
    // A TITLE NOTHING AUTHORS IS A FAILURE, not an empty search, and exit 1 rather than 2 says so: the argument was
    // well formed and the CORPUS is the thing that has nothing to show.
    console.error(`nothing to search: no level authors a call titled "${title}"${oneLevel ? ` in ${oneLevel}` : ''}`);
    return 1;
  }
  if (!hits.length) {
    console.error(
      `no authoring mints ${id || `a variant of "${title}"`}`
      + ` (built ${built}, skipped ${skipped} that do not load, over ${levels.length} level(s))`,
    );
    console.error('        a RETITLE or a re-levelling mints a new variant; the ledger only keeps a corrected FORMATION on its old root');
    return 1;
  }

  for (const hit of hits) {
    // THE `from` LABEL IS AUTHORED AND OFTEN ABSENT (an inline `<formation>` block needs none), so it is printed
    // only when the file carries one rather than as `from ""`.
    console.log(`  ${hit.site}  "${hit.title}"${hit.from ? `  from "${hit.from}"` : ''}`);
    console.log(`      variant ${hit.variantId}   start shape ${hit.shape} -> root ${hit.root}`);
  }
  console.log(
    `${hits.length} authoring(s) ${id ? `mint ${id}` : `carry a variant of "${title}"`}`
    + ` — built ${built}, skipped ${skipped} that do not load, over ${levels.length} level(s)`,
  );
  return 0;
}

process.exit(main());