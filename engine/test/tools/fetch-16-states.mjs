// Author-time refresh for fixtures/all8-16-states.json.
//
// All8 publishes, per formation, the complete table of the 16 possible FASR states
// at standard arrangement (4 sequences x 4 relationships), and each state carries a
// short resolve hint - e.g. [0B1c] is hinted "AL", i.e. an allemande left works from
// there straight away. Those hints are the seeds of the step-4 cross-check: they say
// which resolves a state admits, independently of our own search.
//
//   node test/tools/fetch-16-states.mjs
//
// Note the labels carry no arrangement digit: All8's rule is that an absent
// arrangement means 0 (standard), so [B1p] is [0B1p] and is recorded that way.

import { writeFileSync } from 'node:fs';

const PAGES = { B: '16com_b', P: '16com_p', L: '16com_l', F: '16com_f', W: '16com_w' };

const out = {
  note: "All8's per-formation table of the 16 possible FASR states with standard (0) arrangement: 4 sequences X 4 relationships. Authoritative label list for the alignment dimension of the get-out workstream.",
  source: Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, `https://www.all8.com/sd/calling/${v}.htm`])),
  method: "Visible FASR labels [<arrangement><formation><sequence><relationship>] scraped from each page's state grid; the trailing text on each label's line is All8's own resolve hint (often the name of a get-out known to work from that state). A missing arrangement digit means arrangement 0, per All8's own notation rule.",
  structuralClaim: "Each page states: 'Columns differ by sequence: FASR 1,2,3,4' and 'Rows differ by relationship: FASR p,o,c,r' - i.e. the grid is sequence x relationship, exactly the 4x4 model. The cells are laid out with nested tables, so the order scraped here need not be the visual order; the SET is what matters, and it is complete.",
  formations: {},
};

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|pre|td)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');

const LABEL = /\[([0-5]?)([A-Z]{1,3}(?:\.[A-Z]{1,2})?)([1-4])([pocr])\]/g;

for (const [letter, page] of Object.entries(PAGES)) {
  const url = `https://www.all8.com/sd/calling/${page}.htm`;
  const r = await fetch(url);
  if (!r.ok) { console.log(`FAIL ${letter}: HTTP ${r.status}`); process.exitCode = 1; continue; }
  const lines = strip(await r.text()).split('\n');
  const states = [];
  const seen = new Set();
  for (const line of lines) {
    LABEL.lastIndex = 0;
    const m = LABEL.exec(line);
    if (!m) continue;
    const id = `${m[1] || '0'}${m[2]}${m[3]}${m[4]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const hint = line.slice(m.index + m[0].length).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    states.push({ id, formation: m[2], arrangement: m[1] || '0', sequence: Number(m[3]), relationship: m[4], hint });
  }
  out.formations[letter] = { url, stateCount: states.length, states };
  console.log(`${letter}: ${states.length} states  ${states.map((s) => s.id.slice(1)).join(' ')}`);
  if (states.length !== 16) {
    console.log(`WARN ${letter}: expected 16 states (4 sequences x 4 relationships), got ${states.length}`);
  }
}

writeFileSync(new URL('../fixtures/all8-16-states.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('written');
