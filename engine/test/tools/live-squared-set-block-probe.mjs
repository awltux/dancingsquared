// Print the LIVE [S] block of all8's arrangement page BOTH ways, so the two renderings can be
// compared rather than confused: the raw `<pre>` source (which carries the printed columns) and the
// normalized text `fetch-arrangements.mjs` itself parses. They disagree for [S], and a transcription
// must be taken from one of them deliberately.
//
// Usage: node engine/test/tools/live-squared-set-block-probe.mjs   (network needed, nothing written)

const SOURCE = 'https://www.all8.com/sd/calling/arrngdia.htm';

const r = await fetch(SOURCE, { headers: { 'User-Agent': 'dancingsquared-verify/0.1' } });
if (!r.ok) { console.log(`FAIL: HTTP ${r.status}`); process.exit(1); }
const html = await r.text();
console.log(`fetched ${html.length} bytes`);

const anchor = html.indexOf('<a name="S"></a>');
const LETTERS = process.argv.slice(2).length ? process.argv.slice(2) : ['S'];
for (const letter of LETTERS) {
  const a = html.indexOf(`<a name="${letter}"></a>`);
  console.log(`\n=== RAW <pre> of the [${letter}] block (anchor at ${a}) ===`);
  if (a < 0) { console.log('  (no anchor)'); continue; }
  const open = html.indexOf('<pre>', a);
  const close = html.indexOf('</pre>', open);
  console.log(`  <pre> at ${open}, </pre> at ${close}`);
  html.slice(open + 5, close).split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    console.log(`${String(i).padStart(3)} len=${String(l.length).padStart(3)} |${l}|`);
    console.log(`        ${[...l].map((c) => (c === ' ' ? ' ' : '^')).join('')}`);
    console.log(`        ${[...l].map((_, j) => String(j % 10)).join('')}`);
  });
}

const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|pre|td)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/\r/g, '').replace(/\n{2,}/g, '\n');
const lines = text.split('\n');
const start = lines.findIndex((l) => /^\s*\[S\]\s+0\s+5\s+1\s+2\s+3\s+4\s*$/.test(l));
console.log(`\n=== the SAME block through fetch-arrangements' own text normalization (header at line ${start}) ===`);
for (let i = start; i < Math.min(start + 12, lines.length); i++) {
  const toks = [...lines[i].matchAll(/\S+/g)].map((m) => `${m[0]}@${m.index}`);
  console.log(`${String(i - start).padStart(3)} |${lines[i]}|`);
  console.log(`      ${toks.join(' ')}`);
}
