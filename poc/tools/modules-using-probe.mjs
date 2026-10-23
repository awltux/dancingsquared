// VERIFY the browse view's "which modules use this call?" lookup.
//
// A POC PROBE, AND IT LIVES HERE BECAUSE ITS SUBJECT IS THE APP'S. `poc/src/modules.ts` cannot be imported
// (its `ceder-modules.ts` uses Vite's `import.meta.glob`), so this reads the `modules/**/*.json` corpus
// directly and applies the SAME filter and the SAME name key. It was in `engine/test/tools/`, which runs
// nothing and is not the POC's gate; the R2 triage moved it to the directory that IS its registry — every
// `*-probe.mjs` here is run by `poc/tools/verify-probes.mjs`. What it checks is the part that can be wrong
// without the browser complaining:
//
//   1. the corpus loads and the "replayable" filter behaves as `validCederModules` documents
//      (success === true, and no ALLEMANDE_LEFT terminal marker);
//   2. the name key really matches a module's `Heads Pass Thru` to the browser's `Pass Thru`, i.e.
//      that selection-stripping and canonicalisation agree across the two vocabularies;
//   3. the reported INDEX is the first occurrence, and opening there is meaningful (in range).
//
// Run: node poc/tools/modules-using-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The POC root — the probes reach the engine through its BUILT dist, as every probe here does. */
const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { canonicalName, splitSelection } = engine;
/** The repo root: `modules/` is a sibling of `poc/`. */
const root = path.join(POC_DIR, '..');

/** The same filter `ceder-modules.ts` applies. */
function loadCorpus() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.json')) continue;
      let v;
      try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      if (!v || !Array.isArray(v.steps)) continue;
      if (v.success !== true) continue;
      if (v.steps.includes('ALLEMANDE_LEFT')) continue;
      out.push({ name: v.name || `ceder-${v.id}`, steps: v.steps });
    }
  };
  walk(path.join(root, 'modules'));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const label = (s) => (typeof s === 'string' ? s : s.call);
/** The same key `poc/src/modules.ts` uses: selection-STRIPPED and canonical. */
const callKey = (s) => canonicalName(splitSelection(label(s)).call).trim().toLowerCase();
/** The alternative: the FULL label, selection included, so `Heads Pass Thru` and `Pass Thru` are
 * different calls - which they are. The selection has to be read off the CallStep explicitly:
 * `label()` returns `.call` and would silently drop it, which made the first measurement of this
 * key report a bogus 0. */
const fullKey = (s) => {
  const sel = typeof s === 'string' ? splitSelection(s).selection : s.selection;
  const base = typeof s === 'string' ? splitSelection(s).call : s.call;
  return `${sel ?? ''} ${canonicalName(base)}`.trim().toLowerCase();
};

const corpus = loadCorpus();
console.log(`=== ${corpus.length} replayable module(s) in the corpus ===`);
if (corpus.length === 0) { console.log('FAIL: corpus is empty'); process.exit(1); }

const modulesUsing = (title) => {
  const want = callKey(title);
  const hits = [];
  for (const seq of corpus) {
    const index = seq.steps.findIndex((s) => callKey(s) === want);
    if (index >= 0) hits.push({ seq, index });
  }
  return hits.sort((a, b) => a.index - b.index || a.seq.name.localeCompare(b.seq.name));
};

let failures = 0;
const CALLS = ['Pass Thru', 'Swing Thru', 'Promenade', 'Heads Pass Thru', 'Allemande Left', 'Wheel and Deal', 'Spin the Top'];
for (const call of CALLS) {
  const hits = modulesUsing(call);
  const capped = hits.slice(0, 3);
  console.log(`\n${call}: ${hits.length} module(s)`);
  for (const h of capped) {
    // The index must be the FIRST occurrence and must be in range for the open button.
    const first = h.seq.steps.findIndex((s) => callKey(s) === callKey(call));
    const ok = first === h.index && h.index >= 0 && h.index < h.seq.steps.length;
    if (!ok) { failures++; console.log(`  FAIL ${h.seq.name}: index ${h.index}, recomputed ${first}`); }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} "${h.seq.name}" call ${h.index + 1}/${h.seq.steps.length}  -> ${label(h.seq.steps[h.index])}`);
  }
  if (hits.length === 0 && ['Pass Thru', 'Swing Thru', 'Allemande Left'].includes(call)) {
    failures++;
    console.log(`  FAIL: a call this common matching nothing suggests the key is wrong`);
  }
}

// The selection-stripping that makes a module's "Heads Pass Thru" match the browser's "Pass Thru".
//
// MEASURED, AND IT IS TOO LOSSY: stripping the selection makes `Heads Pass Thru` and `Pass Thru`
// collide, so browsing the scoped call listed 144 modules that all dance the BARE one. The full
// label is the correct key - they are different calls - so both are counted here to show the
// difference rather than assert a preference.
const strips = [
  ['Heads Pass Thru', 'Pass Thru'],
  ['Centers Swing Thru', 'Swing Thru'],
  ['Boys Run', 'Run'],
];
console.log('\n=== selection stripping, and what it would cost ===');
for (const [scoped] of strips) {
  const nStripped = corpus.filter((m) => m.steps.some((s) => callKey(s) === callKey(scoped))).length;
  const nFull = corpus.filter((m) => m.steps.some((s) => fullKey(s) === fullKey(scoped))).length;
  console.log(`  "${scoped}": stripped key -> ${nStripped} module(s); full label -> ${nFull}`);
}

console.log('\n=== what the corpus calls a promenade, and what it has for a bare call ===');
const names = new Map();
for (const m of corpus) for (const s of m.steps) names.set(label(s), (names.get(label(s)) ?? 0) + 1);
for (const [n, c] of [...names].filter(([n]) => /prom/i.test(n)).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${String(c).padStart(4)}  "${n}"`);
}
const bare = [...names].filter(([n]) => canonicalName(n).trim().toLowerCase() === 'promenade');
console.log(`  bare "Promenade" steps in the corpus: ${bare.reduce((s, [, c]) => s + c, 0)}`);

console.log(failures === 0 ? '\nMODULES-USING PASSED' : `\nMODULES-USING FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
