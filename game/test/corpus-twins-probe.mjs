// THE TWO CORPUS LOADERS, AND THE ONE HALF OF THEM THAT MUST AGREE.
//
// `game/src/data/assets.ts` enumerates the corpus through Vite's `import.meta.glob` (a browser has no `fs`) and
// `game/src/data/corpus-node.ts` through `filesOf`/`readFile`. That split is deliberate and cannot be collapsed. What
// was NOT deliberate is that the POOLING — walk each file's `<tam>`s, take each title once, hand the caller the whole
// file's text for it — was written twice, in both files, each copy carrying the same measurement (62 titles became
// 322). TODO item 50 filed it; the rule now lives in `packages/corpus/blocks.ts::pooledByTitle`, and this probe is the
// gate that the two loaders still agree about what a call is.
//
// HOW IT CAN BE MEASURED AT ALL, since neither loader runs in the other's environment. Two halves:
//   1. BEHAVIOUR: the Node loader is importable under bare node (that is why it exists), so its title list is
//      compared against `pooledByTitle` run over the same files read from disk. A break in the shared rule shows up
//      as a difference HERE, which is the half a source check could never see.
//   2. THE PANEL: `assets.ts` imports `import.meta.glob`, so a node probe cannot import it — its half is read as
//      SOURCE and asserted to call the same pooling function rather than carrying a loop of its own. That is the
//      same limit, and the same answer, as `facing-chain-probe.mjs` records for the panel's write rules.
//
// Run: node game/test/corpus-twins-probe.mjs   (from anywhere; reads the real corpus, needs no engine build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, readFile } from 'dancing-squared-corpus';
import { pooledByTitle } from 'dancing-squared-corpus/blocks';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// --------------------------------------------------------------------------------- 1. the rule, over the real corpus
console.log('\n== 1. `pooledByTitle` over every Mainstream file ==');
const files = filesOf('ms').map((file) => ({ file, xml: readFile('ms', file) }));
const pooled = pooledByTitle(files);
check(files.length > 50, `the corpus walk found ${files.length} Mainstream files (a zero would make this vacuous)`);
check(pooled.length > 300, `and ${pooled.length} distinct titles, where the per-FILE reading named one per file`);
check(new Set(pooled.map((p) => p.name)).size === pooled.length, 'every title appears exactly ONCE');
check(pooled.every((p) => p.name.trim() !== ''), 'no pooled call has an empty title (a moves/rule file contributes nothing)');
// THE XML IS THE FILE'S, not the block's: `register` pools a whole document, so the pairing must be (title, file text).
check(pooled.every((p) => p.xml.length > 0 && p.xml.includes('<tam')), 'each pooled call carries its FILE\'s text, not a bare block');

// A NEGATIVE CONTROL: the same files with the pooling rule bypassed - one name per file, the walk this replaced.
const perFile = files.map(({ file, xml }) => ({ name: file, xml }));
check(perFile.length < pooled.length && perFile.length === files.length,
  `the per-FILE reading names ${perFile.length} calls against the pool's ${pooled.length}, so the check above is not decoration`);

// ------------------------------------------------------------------- 2. the Node loader agrees with the rule
console.log('\n== 2. the game\'s Node loader returns what the rule says ==');
// THE NODE LOADER IS IMPORTABLE, which is why it exists (a browser has no `fs` and so the browser half is source-read
// instead). Its `.ts` specifier is loaded by node's own type stripping, the same way the puzzle probes load the core.
const nodeLoader = await import(pathToFileURL(path.join(ROOT, 'game', 'src', 'data', 'corpus-node.ts')).href);
const fromLoader = nodeLoader.corpusTamTitles();
const fromRule = pooled.map((p) => p.name).sort();
check(fromLoader.length === fromRule.length,
  `the loader names ${fromLoader.length} titles and the rule names ${fromRule.length}`);
check(JSON.stringify(fromLoader) === JSON.stringify(fromRule),
  'and they are the SAME titles, sorted the same way - the loader is the rule, not a copy of it');

// ------------------------------------------------------------- 3. the panel's half, read from source
console.log('\n== 3. the panel loader calls the same rule ==');
const panel = read('game/src/data/assets.ts');
check(/import \{ pooledByTitle \} from 'dancing-squared-corpus\/blocks';/.test(panel),
  '`assets.ts` imports `pooledByTitle` from the corpus package');
check(/return pooledByTitle\(files\)/.test(panel),
  'and returns its answer, so the pooling loop is not restated in the browser loader');
// THE CONTROL: the loop that used to be here. `parseCallXml` per file with a `seen` set is exactly the copy item 50
// described, so its presence must fail this check rather than pass it.
{
  const restated = `${panel}\nconst seen = new Set();\nfor (const xml of files) for (const tam of parseCallXml(xml)) if (!seen.has(tam.title)) seen.add(tam.title);\n`;
  check(/parseCallXml/.test(restated) && !/parseCallXml/.test(panel),
    'and no `parseCallXml` pooling loop is back in it (the control)');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
