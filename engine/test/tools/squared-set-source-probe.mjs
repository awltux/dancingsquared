// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// WHAT DOES ALL8's [S] ARRANGEMENT TABLE ACTUALLY SAY, COLUMN BY COLUMN?
//
// `fetch-arrangements.mjs` DROPS every printed row whose six gender cells cannot be read as
// contiguous letters. The [S] page prints its two MIDDLE rows with the cells spread apart
// (`B     g`), so the fixture on disk holds only the two hole-free rows of [S] (and loses a row of
// [D] and three of [I] the same way). Step 2 has to transcribe [S] from the SOURCE, so this reads the
// raw `<pre>` block - where the hole is simply a GAP in the printing - and prints every row with its
// exact character positions, so the column each cell belongs to is recovered from the source's own
// spacing rather than assumed. It also prints the reconstructed row strings with '.' for the holes.
//
// Usage: node engine/test/tools/squared-set-source-probe.mjs   (network needed, nothing is written)

const SOURCE = 'https://www.all8.com/sd/calling/arrngdia.htm';
const FACE = '^v<>';

const r = await fetch(SOURCE);
if (!r.ok) { console.log(`FAIL: HTTP ${r.status} from ${SOURCE}`); process.exit(1); }
const html = await r.text();

/** The raw <pre> block of a formation's anchor, with the line's exact spacing intact. */
function preBlock(letter) {
  const anchor = html.indexOf(`<a name="${letter}"></a>`);
  if (anchor < 0) return null;
  const open = html.indexOf('<pre>', anchor);
  const close = html.indexOf('</pre>', open);
  return html.slice(open + 5, close).replace(/\r/g, '');
}

/** Column positions of a single cell character in a printed row, or null if it is not a cell row. */
function cellsAt(line) {
  // A cell row is either a FACING row (all `^v<>` and gaps) or a GENDER row (all `Bg` and gaps,
  // optionally with a facing token at one or both ends for the narrow formations). The gender rows of
  // [S] carry no facing, so the two kinds are told apart by which characters they contain.
  const arrows = [...line].every((c) => c === ' ' || FACE.includes(c));
  const letters = [...line].every((c) => c === ' ' || c === 'B' || c === 'g' || FACE.includes(c));
  if (!arrows && !letters) return null;
  const cols = [];
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ') cols.push([i, line[i]]);
  return { kind: arrows ? 'facing' : 'gender', cols };
}

for (const letter of ['S', 'D', 'I']) {
  const block = preBlock(letter);
  console.log(`\n=== [${letter}] raw <pre> block ===`);
  if (!block) { console.log('  (no anchor)'); continue; }
  const header = block.split('\n').findIndex((l) => new RegExp(`^\\s*\\[${letter}\\]\\s+0\\s+5\\s+1\\s+2\\s+3\\s+4\\s*$`).test(l));
  const lines = block.split('\n').slice(header + 1);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = cellsAt(line);
    if (!cells) break; // the table ended (a note, a link, the next formation)
    rows.push({ line, cells });
    console.log(`  |${line}|`);
    console.log(`      ${cells.kind.padEnd(6)} at ${cells.cols.map(([i, c]) => `${c}@${i}`).join(' ')}`);
  }

  // The column positions a hole-free row uses are the table's own columns; a hole is any of them
  // missing from a row. Prose rows that follow the table are not cells and stop the scan above.
  const columns = [...new Set(rows.flatMap(({ cells }) => cells.cols.map(([i]) => i)))].sort((a, b) => a - b);
  if (!rows.length) { console.log('  (no cell rows read)'); continue; }
  console.log(`  columns used by the block: ${columns.join(', ')}`);
  for (const { cells } of rows) {
    const at = new Map(cells.cols);
    const text = columns.map((c) => at.get(c) ?? '.').join('');
    console.log(`    ${cells.kind === 'gender' ? 'gender' : 'facing'}  ${text}`);
  }
}
