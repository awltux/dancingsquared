// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// STEP 3, ITEM 7, SECOND SOURCE: do all8's 16com pages carry a couple-numbered GRID, or only labels?
//
// The canonical-board rule measured on the get-out corpus (sequence 1 -> relabel +3, 2 -> +2, 3/4 -> 0,
// 26 of 26) is one source. all8's "16 Possible Pairings with Standard Arrangement" pages are the other
// candidate: they enumerate 4 sequences x 4 relationships per formation, and the labels alone cannot
// place a couple on a spot. This dumps the RAW markup of one page's state grid so the question is
// answered from the source rather than from the text rendering (which is what lost the [S] rows).
//
// Usage: node engine/test/tools/sixteen-states-raw-probe.mjs [B|P|L|F|W]
//        (network needed; nothing is written except, with --save, a scratch html file)

import { writeFileSync } from 'node:fs';

const letter = process.argv[2]?.toUpperCase() ?? 'B';
const URL = `https://www.all8.com/sd/calling/16com_${letter.toLowerCase()}.htm`;
const res = await fetch(URL);
if (!res.ok) { console.log(`FAIL: HTTP ${res.status} from ${URL}`); process.exit(1); }
const html = await res.text();
if (process.argv.includes('--save')) { writeFileSync(`16com_${letter}.html`, html); console.log(`wrote 16com_${letter}.html (${html.length} bytes)`); }

console.log(`\n=== ${URL} (${html.length} bytes) ===`);
// Does the raw markup carry per-spot data? Look for the things a couple-numbered diagram needs.
const probes = {
  'an <img> (a graphic diagram)': /<img\b/gi,
  'a nested <table> (a grid)': /<table\b/gi,
  'FASR labels [0B1c]': /\[[0-5]?[A-Za-z.]{1,3}[1-4]?[pocr]?\]/g,
  'digits 1-4 (couple numbers?)': /\b[1-4]\b/g,
};
for (const [label, re] of Object.entries(probes)) {
  console.log(`  ${label.padEnd(32)} ${(html.match(re) ?? []).length}`);
}

// How much markup is BETWEEN the labels? A pure label list has almost none; a diagram has plenty.
const first = html.search(/\[[0-5]?[A-Za-z.]{1,3}[1-4]?[pocr]?\]/);
if (first >= 0) {
  console.log('\n=== the 1200 characters starting at the first FASR label ===');
  console.log(html.slice(first, first + 1200));
}

// The table structure, tag by tag, so a grid cannot hide in it.
console.log('\n=== every tag inside the first table after the labels ===');
const tableStart = html.indexOf('<table', first);
if (tableStart < 0) console.log('  (no <table> after the labels)');
else {
  const tableEnd = html.indexOf('</table>', tableStart);
  const inner = html.slice(tableStart, tableEnd + 8);
  const tags = [...inner.matchAll(/<\/?([a-z0-9]+)\b[^>]*>/gi)].map((m) => m[0]);
  const counts = {};
  for (const t of tags) counts[t.replace(/[^a-z/]/gi, '').toLowerCase()] = (counts[t.replace(/[^a-z/]/gi, '').toLowerCase()] ?? 0) + 1;
  console.log(`  table is ${inner.length} chars, ${tags.length} tags: ${JSON.stringify(counts)}`);
  console.log(`  first 600 chars: ${inner.slice(0, 600)}`);
}
