// Build the All8 figure fixtures from Rich Reel's own pages (verbatim, attributed).
//
// Not part of `verify`: this regenerates committed fixtures from the live site, so it is run by hand
// when the fixture needs refreshing. The committed JSON is what the harness reads.
//
// Run: node engine/test/tools/fetch-all8-figures.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'engine/test/fixtures/all8-figures.json');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const render = (s) => s
  .replace(/<hr\s*\/?>/gi, '\n\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

// --- 1. fig_m.htm: the big published set, as RENDERED text (tags stripped, whitespace kept),
//        because the column layout IS the call-sharing encoding.
const figUrl = 'http://www.all8.com/sd/calling/fig_m.htm';
const figHtml = await get(figUrl);
const pre = [...figHtml.matchAll(/<pre>([\s\S]*?)<\/pre>/gi)][0][1];
const figuresText = render(pre);

// --- 2. abbrev.htm: the worked call-sharing example. Its cells are real table cells, so the
//        sharing rule is literal (an empty cell inherits from the row above) - and All8 prints the
//        expected figure in full, which makes this a self-checking test.
const abbrevUrl = 'http://www.all8.com/sd/calling/abbrev.htm';
const abbrevHtml = await get(abbrevUrl);
const table = /<table border=1[\s\S]*?<\/table>/i.exec(abbrevHtml)[0];
const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((r) =>
  [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => render(c[1]).replace(/\s+/g, ' ').trim()),
);

const fixture = {
  source: figUrl,
  notationReference: abbrevUrl,
  archivedNotationKey: 'https://web.archive.org/web/20160701101228/http://www.all8.com/sd/calling/abbrlist.htm',
  fetched: new Date().toISOString().slice(0, 10),
  note:
    'VERBATIM from Rich Reel\'s all8.com, rendered from the page\'s own <pre> block (tags removed, '
    + 'whitespace and therefore the COLUMN LAYOUT preserved). The layout is not decoration: All8\'s '
    + 'call sharing is expressed by it. Do not reformat, re-indent or re-wrap these lines.',
  attribution: 'Richard Reel (Rich Reel), all8.com - used with attribution, not relicensed.',
  figuresText,
  workedExample: {
    note:
      'abbrev.htm\'s call-sharing example, as table CELLS. Empty cells are shared, inherited from the '
      + 'row above at the same index. All8 prints the expected reading of the highlighted row in full.',
    rows,
    // Printed verbatim by abbrev.htm directly under the table:
    //   "Heads Square Thru 4 Hands / Do Sa So / Swing Thru / Boys Run Right / Couples Circulate /
    //    Chain Down The Line / Pass The Ocean / All Eight Circulate / Swing and Promenade"
    expectedFigure: [
      'H-SqTh4', '--DoSaD', '--SwThr', 'B-RunR', '--Cpl.C', '--ChDTL', '--PsOcn', '--A8Cir', '--Sw&Pr',
    ],
    highlightedRow: 5,
  },
};

writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${out}`);
console.log(`  figuresText: ${figuresText.split('\n').length} lines, ${figuresText.length} chars`);
console.log(`  workedExample: ${rows.length} rows x up to ${Math.max(...rows.map((r) => r.length))} cells`);
