import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer } from '../dist/index.js';
setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const movesXml = read('poc/src/assets/moves.xml');
const formationsXml = read('poc/src/assets/formations.xml');
// ms-only catalog, like the teacher app.
const files = readdirSync(path.join(root, 'poc/src/assets/ms')).filter((f) => f.endsWith('.xml'));
const catalog = [];
for (const f of files) {
  const xml = read(`poc/src/assets/ms/${f}`);
  const blocks = xml.match(/<tam\b[\s\S]*?<\/tam>/g) || [];
  const byTitle = new Map();
  for (const b of blocks) {
    const t = (b.match(/title="([^"]*)"/) || [])[1] ?? '?';
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(b);
  }
  for (const [title, blks] of byTitle) catalog.push({ title, xml: `<calls>\n${blks.join('\n')}\n</calls>` });
}
const seq = new Sequencer(movesXml, formationsXml, catalog.map((c) => ({ name: c.title, xml: c.xml })));
console.log('catalog titles:', catalog.length);
const t0 = Date.now();
seq.transitionTable();
const buildMs = Date.now() - t0;
console.log(`table build: ${buildMs}ms, states=${seq.transitionTable().stateCount()}, edges=${seq.transitionTable().edgeCount()}`);
const t1 = Date.now();
const data = seq.serializeFsmTable();
const json = JSON.stringify(data);
console.log(`serialize: ${Date.now()-t1}ms, json bytes=${json.length}`);
// Round-trip into a fresh sequencer.
const t2 = Date.now();
const seq2 = new Sequencer(movesXml, formationsXml, catalog.map((c) => ({ name: c.title, xml: c.xml })));
seq2.loadFsmTable(data);
console.log(`load into fresh: ${Date.now()-t2}ms, states=${seq2.transitionTable().stateCount()}`);
