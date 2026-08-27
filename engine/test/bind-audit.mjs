// Bind-audit: verify every `@bind:<name>` tag in the feature files resolves to a
// real engine capability. Tags are classified by which surface they resolve to:
//   tier-1 : a named export of the engine package (index.js)
//   tier-2 : a public method on the Sequencer facade class
//   tier-3 : a public method on an internal collaborator class
//            (FormationMatcher, CallLibrary) that is NOT exposed via Sequencer
//            or the package exports
//   MISSING: the symbol does not exist anywhere in the source (a genuine dangling tag)
//
// tier-1/tier-2 are the intended public API. tier-3 methods exist but are not on
// the public surface, so their scenarios reference an unreachable capability as
// written. MISSING is a hard error.
//
// Run: `node test/bind-audit.mjs` from engine/. Requires `npm run build` first.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import * as engineNs from '../dist/index.js';
import { Sequencer, setParser } from '../dist/index.js';
import { FormationMatcher } from '../dist/sequencer/matcher.js';
import { CallLibrary } from '../dist/sequencer/library.js';
import { HomeSolver } from '../dist/sequencer/solver.js';
import { LegalityChecker } from '../dist/sequencer/legality.js';
import { CallApplicator } from '../dist/sequencer/applicator.js';
import { SequenceAnalyzer } from '../dist/sequencer/sequence.js';
import { Grouping } from '../dist/sequencer/grouping.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const featuresDir = path.join(root, 'features');

// ---- tier-1: named exports of the engine package ----
const tier1 = new Set(Object.keys(engineNs));

// ---- tier-2: public methods of the Sequencer facade ----
const tier2 = new Set();
for (const name of Object.getOwnPropertyNames(Sequencer.prototype)) {
  if (name !== 'constructor') tier2.add(name);
}

// ---- tier-3: public methods of the internal collaborator classes ----
const collaborators = { FormationMatcher, CallLibrary, HomeSolver, LegalityChecker, CallApplicator, SequenceAnalyzer, Grouping };
const tier3 = new Set();
const tier3Owner = new Map(); // tag -> owner class name
for (const [clsName, cls] of Object.entries(collaborators)) {
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    if (name !== 'constructor') {
      tier3.add(name);
      if (!tier3Owner.has(name)) tier3Owner.set(name, clsName);
    }
  }
}

// ---- classify a tag ----
const classify = (tag) => {
  if (tier1.has(tag)) return 'tier-1';
  if (tier2.has(tag)) return 'tier-2';
  if (tier3.has(tag)) return `tier-3 (${tier3Owner.get(tag)})`;
  return 'MISSING';
};

// ---- collect @bind: tags ----
const features = readdirSync(featuresDir).filter((f) => f.endsWith('.feature'));
const tagToFeatures = new Map();
for (const f of features) {
  const text = readFileSync(path.join(featuresDir, f), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/@bind:([A-Za-z0-9_]+)/g);
    if (m) {
      for (const raw of m) {
        const tag = raw.replace('@bind:', '');
        if (!tagToFeatures.has(tag)) tagToFeatures.set(tag, new Set());
        tagToFeatures.get(tag).add(f);
      }
    }
  }
}

const allTags = [...tagToFeatures.keys()].sort();
const summary = { 'tier-1': [], 'tier-2': [], 'tier-3': [], MISSING: [] };
for (const tag of allTags) {
  const c = classify(tag);
  const key = c.startsWith('tier-3') ? 'tier-3' : c;
  summary[key].push(tag);
}

for (const tag of allTags) {
  const c = classify(tag);
  const fs = [...tagToFeatures.get(tag)].sort().join(', ');
  console.log(`  ${c.padEnd(28)} ${tag}  (${fs})`);
}

console.log('\n== Tier-1 exported symbols ==');
for (const t of summary['tier-1']) console.log('  ' + t);
console.log('\n== Tier-2 Sequencer facade methods ==');
for (const t of summary['tier-2']) console.log('  ' + t);
console.log('\n== Tier-3 internal collaborator methods (exist, but NOT on the public surface) ==');
for (const t of summary['tier-3']) console.log('  ' + t);
console.log('\n== MISSING (do not exist anywhere) ==');
for (const t of summary.MISSING) console.log('  ' + t);

console.log(`\nChecked ${allTags.length} unique bind tags across ${features.length} feature files.`);
console.log(`  tier-1 exports : ${summary['tier-1'].length}`);
console.log(`  tier-2 methods : ${summary['tier-2'].length}`);
console.log(`  tier-3 internal: ${summary['tier-3'].length}`);
console.log(`  MISSING        : ${summary.MISSING.length}`);

if (summary.MISSING.length > 0) {
  console.log(`\nFAIL: ${summary.MISSING.length} bind tag(s) reference a symbol that does not exist.`);
  process.exitCode = 1;
} else {
  console.log('\nNo truly missing bind tags. Review tier-3 tags: they reference internal collaborator');
  console.log('methods that are not reachable through the public Sequencer/package API as written.');
}
