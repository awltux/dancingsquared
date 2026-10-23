// THE CORPUS'S CALL TITLES, AS CONSTANTS — the generator behind `engine/src/sequencer/call-titles.ts`.
//
// WHY A CALL TITLE NEEDS A CONSTANT AT ALL. A title is an API: nine harnesses and two generated artefacts
// spelled `Promenade Home`, the corpus retitled that family to the bare `Promenade` (`e02b434`), and nothing
// failed to compile — the names simply stopped resolving, and the failures surfaced later as
// `"Promenade Full" not legal for selected dancers` and `?deg` in an unrelated harness. A name typed twice is
// a defect waiting for the rename (AGENTS.md §11.2.6). With every title in this module, a retitle changes the
// corpus and this file, and every call site that still names the old title stops COMPILING — the compiler is
// the migration list.
//
// WHY THE CONSTANT IS KEYED BY THE TITLE ITSELF rather than by an invented identifier. `CALL_TITLE['Promenade']`
// is typo-checked at compile time (an unknown key is an error) and grep-able as the exact string a dancer would
// read. A sanitised identifier (`PROMENADE_1_4_KEEP_WALKING`) would be a second spelling of every title — two of
// the 2190 collide once punctuation is stripped — which is the same "a name typed twice" defect wearing a hat.
//
// AND THE KEY IS THE VALUE, deliberately. It is not redundant: the key is what TypeScript checks and the value
// is what an app passes to the engine, so a title that is escaped in the source (`"O" Cross and Turn`) reads
// back as the string the XML carried, and neither can drift from the other without the file changing.
//
// THE XML IS PARSED, NOT PATTERN-MATCHED. 2190 titles include literal quotes and ampersands
// (`"O" Cross and Turn`, `Swing & Promenade`-shaped names), so a `<tam title="..."` regex reads `&amp;` and
// breaks on the quotes. Measured on the shipped corpus: 500 call files, 5488 tams, 2190 distinct titles, 0
// tams without a title.
//
// Usage: node scripts/call-titles.mjs            (report the set, write nothing)
//        node scripts/call-titles.mjs --write    (regenerate the module)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { filesOf, levelsAvailable, tamsOf } from 'dancing-squared-corpus';

/** Where the generated module lives. A constant of this script, not of the caller: there is one module. */
export const MODULE = fileURLToPath(new URL('../engine/src/sequencer/call-titles.ts', import.meta.url));

/**
 * Every `<tam title>` the corpus carries, deduplicated and sorted by code point.
 *
 * CODE-POINT ORDER, NOT `localeCompare`: the sort decides the generated file's line order, so it has to be the
 * same in every locale or the gate's byte comparison reports a change that is only an environment difference.
 *
 * THE WALK IS `packages/corpus`'s, since the consolidation: the same one the engine's harnesses, the book, the
 * teacher and the game read, so the generated module cannot describe a corpus that a consumer does not see. The
 * LEVELS are discovered (`levelsAvailable`) rather than listed, because this file is the one caller that must never
 * fall behind a new programme directory; the corpus is flat (two root files, one directory per level), so
 * "every level directory" is the whole tree and the root's `moves.xml`/`formations.xml` are outside the walk by
 * construction rather than by an exclusion list. A file that does not parse throws with its level and name.
 */
export function corpusCallTitles() {
  let files = 0;
  let tams = 0;
  let untitled = 0;
  const titles = new Set();
  for (const level of levelsAvailable()) {
    for (const file of filesOf(level)) {
      files++;
      for (const site of tamsOf(level, file)) {
        tams++;
        if (!site.title) {
          untitled++;
          continue;
        }
        titles.add(site.title);
      }
    }
  }
  const sorted = [...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { titles: sorted, files, tams, untitled };
}

/** The module's text. One function so the GATE and the `--write` path cannot render it differently. */
export function renderCallTitles({ titles, files, tams }) {
  const header = [
    '// GENERATED FILE — DO NOT EDIT. Every call title the corpus carries, as a constant.',
    '//',
    '// Regenerate: `node scripts/call-titles.mjs --write`',
    '// Gate:        `engine/test/call-titles.mjs` (registered in `engine/test/verify-suite.mjs`)',
    '// Source:      `scripts/call-titles.mjs`, which explains why this exists at all.',
    '//',
    `// MEASURED at generation: ${titles.length} distinct titles across ${tams} tams in ${files} call files.`,
    '//',
    '// HOW TO USE IT, in order of preference. TYPE THE TABLE: a list or record of titles — a season, a finish',
    "// list, a permission rule's calls — is checked by annotating it `readonly CallTitle[]` or",
    "// `Record<string, CallTitle>`, which is one word and no churn. `CALL_TITLE['...']` is for a site that names",
    '// ONE call: a selector, a comparison, an expectation. A name that arrives at RUNTIME — authored data, a user',
    '// typing a call — goes through `isCallTitle`.',
    '//',
    '// WHY NOT REWRITE EVERY LITERAL. MEASURED before this module existed: 1983 executable title literals in 137',
    '// files. A blanket rewrite to `CALL_TITLE[...]` would be a 2000-line diff for a guarantee that a type',
    '// annotation on the few big tables buys outright, so the migration is table-by-table, not site-by-site.',
    '//',
    '// WRITE `CALL_TITLE[...]`, NEVER A BARE LITERAL, for any title the CODE names — a harness witness, a',
    '// finish list, a probe selector, a book index. The key is checked by the compiler, so a retitle in the',
    '// corpus breaks every call site that still spells the old name, and the broken sites ARE the migration',
    '// list. A name that arrives at RUNTIME (authored data, a user typing a call) must go through',
    '// `isCallTitle`, which is the same set as a type guard.',
    '',
    '/** Every `<tam title>` in the corpus. The key is what the compiler checks; the value is the string. */',
    'export const CALL_TITLE = {',
  ];
  for (const title of titles) {
    const literal = JSON.stringify(title);
    header.push(`  ${literal}: ${literal},`);
  }
  header.push('} as const;', '');
  header.push('/** The title of a call this corpus carries — the key type of `CALL_TITLE`. */');
  header.push('export type CallTitle = keyof typeof CALL_TITLE;', '');
  header.push('/**');
  header.push(' * Is this string a title the corpus carries? The narrowing test for anything authored at runtime.');
  header.push(' *');
  header.push(' * `hasOwnProperty`, not `in`: `in` answers true for `toString` and every other inherited name, which');
  header.push(' * would let a call title that is also an object method through as a known call.');
  header.push(' */');
  header.push('export function isCallTitle(name: string): name is CallTitle {');
  header.push('  return Object.prototype.hasOwnProperty.call(CALL_TITLE, name);');
  header.push('}');
  header.push('');
  return header.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = corpusCallTitles();
  const rendered = renderCallTitles(built);
  console.log(
    `${built.titles.length} distinct titles across ${built.tams} tams in ${built.files} call files` +
      `${built.untitled ? `, ${built.untitled} tam(s) with no title` : ''}`,
  );
  if (process.argv.includes('--write')) {
    fs.writeFileSync(MODULE, rendered, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), MODULE)} (${rendered.length} bytes)`);
  } else {
    const current = fs.existsSync(MODULE) ? fs.readFileSync(MODULE, 'utf8') : null;
    console.log(
      current === rendered
        ? 'the committed module is up to date'
        : 'the committed module DIFFERS — run `node scripts/call-titles.mjs --write`',
    );
  }
}
