// THE START SETUPS THE BOARD PICKER OFFERS, AND WHY IT IS NOT THE LIBRARY'S NAME LIST.
//
// WHAT THIS PINS. The sequencer's Board drawer used to fill its picker from `CallLibrary.getUniqueFormations()`: a
// key of geometry up to CONGRUENCE (`matchFormations` at 0.5, reflection included, gender ignored), keeping one
// representative NAME per shape. So the picker hid every setup that shares an `fid` with a listed name - reported as
// "this hides the other formation elements with the same FID ... it should select a start setup, i.e. a unique SID"
// - and it hid the setups carried only as a call's inline `<formation>` block entirely. The replacement
// (`poc/src/setup-catalogue.ts`) reads every definition, completes the half sets, dedupes by `sid` and labels each
// row `[shape name] setup name`, so the list orders by shape and a shape with several setups shows all of them.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. THE POPULATION IS THE CORPUS'S, not the library's: 218 named eight-dancer definitions + 489 inline
//      eight-dancer blocks = 707 elements, which are **484 setups over 295 shapes**, 82 of them carrying more than
//      one setup. The library's 138 names are a
//      SUBSET of the 484, and it does not even carry `Sashayed Lines` - the check that the old picker really did
//      hide a setup, not merely rename one.
//   2. ONE ROW PER SETUP: no two rows share a `sid`, and each row's `sid`/`fid`/`aid` are the engine's ids for the
//      row's own dancers - so the board the picker sets re-computes exactly that row's `sid` (the round trip).
//   3. THE CORPUS'S STORED TAGS EQUAL THE COMPUTED ONES for every eight-dancer element, measured here
//      independently of the module: the sweep parses the same XML, completes the same rule and compares. This is
//      the cross-check the catalogue relies on rather than trusting a stale tag.
//   4. THE LABELS: `[Lines] Normal Lines`, `[Column] Columns`, `[Waves] Ocean Waves`, `[Lines Facing Out]
//      Chuck-A-Luck`; a single-setup shape is UNBRACKETED (`Static Square`); and two setups that share a name are
//      told apart by their `sid` (`As Couples Slide Thru`).
//   5. `sharedShapeName`'s RULES, each with the plausible wrong rule beside it: a two-letter shared word is
//      rejected (`RH`), a mid-word match is rejected (`Cab`/`Scab`), a tie on length prefers the LATER word
//      (`Two-Faced Lines`/`Two-Faced Lines RH` => `Lines`, not `Faced`), and a group with no shared word is null.
//   6. THE SELECTION ROUND TRIP, against a real `Sequencer`: `setSetupBoard(row.dancers, row.name)` puts dancer `i`
//      on the row's pose `i` (order preserved - the thing the name path cannot promise) and the board re-computes
//      to the row's `sid`. A home-shaped setup gets home identity; a setup the FASR registry covers keeps its
//      identity; one it does not keeps `UNKNOWN_COUPLE`.
//   7. ORDER: rows are sorted by shape name, then by display, which is what the `[shape]` prefix is for.
//
// Run: node tools/setup-picker-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';
import {
  setParser,
  parseFormations,
  parseFormationTags,
  parseCallXml,
  Sequencer,
  setupId,
  formationId,
  arrangementId,
  UNKNOWN_COUPLE,
} from 'dancing-squared-engine';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildSetupCatalogue, sharedShapeName, SETUP_PICKER_SIZE } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'setup-catalogue.ts')).href
);
const { completeHalfSet } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);

setParser(DOMParser);
const DEG = Math.PI / 180;

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const formationsXml = read('formations.xml');
const movesXml = read('moves.xml');

// THE CORPUS'S DIRECTORIES, derived rather than listed: the app's glob is `@corpus/*/*.xml`, and a hand-kept level
// list is exactly the drift `corpus-key-probe.mjs` and the level owner removed.
const LEVELS = fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** Every level file's parsed tams, the shape `data.ts` hands the catalogue. */
const FILES = LEVELS.flatMap((level) =>
  filesOf(level).map((file) => {
    const xml = read(`${level}/${file}`);
    return { file: `${level}/${file.replace(/\.xml$/, '')}`, xml };
  }),
);
const sources = FILES.map(({ file, xml }) => {
  const tams = parseCallXml(xml);
  return { file, tams: tams.map((tam, index) => ({ index, tam })) };
});

const catalogue = buildSetupCatalogue({ formationsXml, files: sources });
const rows = catalogue.rows;

console.log('== 1. the population is the corpus, not the library ==');
check(SETUP_PICKER_SIZE === 8, `the picker's population is the ${SETUP_PICKER_SIZE}-dancer elements`);
check(catalogue.elements.named === 218, `218 named ${SETUP_PICKER_SIZE}-dancer definitions (${catalogue.elements.named})`);
check(catalogue.elements.inline === 489, `489 inline ${SETUP_PICKER_SIZE}-dancer blocks (${catalogue.elements.inline})`);
check(catalogue.elements.total === 707, `707 elements in all (${catalogue.elements.total})`);
check(rows.length === 484, `484 distinct setups, one row each, over ${catalogue.elements.total} elements (${rows.length})`);
check(catalogue.groups.length === 295, `295 shape ids (${catalogue.groups.length})`);
{
  const multi = catalogue.groups.filter((g) => g.rows.length > 1).length;
  check(multi === 82, `82 shapes carry more than one setup, so the old one-name-per-shape list hid 82 shapes' others (${multi})`);
}

console.log('\n== 2. one row per setup, and the row ids are the board\'s ==');
{
  const seen = new Set();
  const dupes = [];
  for (const r of rows) {
    if (seen.has(r.sid)) dupes.push(r.sid);
    seen.add(r.sid);
  }
  check(dupes.length === 0, `no two rows share a sid (${dupes.length} duplicates)`, dupes.slice(0, 5).join(', '));
  check(rows.every((r) => /^S1-[0-9a-z]{8}$/.test(r.sid)), 'every sid is the S1- shape');
  // THE ROW'S OWN DANCERS ARE THE BOARD, and the ids are computed from them the same way the board will be.
  const boardOf = (row) => ({
    dancers: row.dancers.map((p, i) => ({ id: i + 1, couple: UNKNOWN_COUPLE, gender: p.gender ?? 'phantom', x: p.x, y: p.y, heading: p.heading })),
  });
  const wrong = rows.filter((r) => setupId(boardOf(r)) !== r.sid || formationId(boardOf(r)) !== r.fid || arrangementId(boardOf(r)) !== r.aid);
  check(wrong.length === 0, `all ${rows.length} rows re-compute their own sid, fid and aid (${wrong.length} do not)`,
    wrong.slice(0, 3).map((r) => `${r.display}: ${setupId(boardOf(r))} vs ${r.sid}`).join('; '));
  // A SETUP WITH SEVERAL NAMES is one row, with the others carried as aliases.
  const square = rows.find((r) => r.name === 'Static Square');
  check(square !== undefined && square.aliases.includes('Squared Set'),
    `Static Square and Squared Set are ONE setup with an alias (${square ? square.aliases.join(', ') || 'no alias' : 'row missing'})`);
  const aliased = rows.filter((r) => r.aliases.length > 0).length;
  check(aliased === 87, `87 setups carry more than one corpus name (${aliased})`);
}

console.log('\n== 3. the corpus\'s stored tags are the computed ones (independent sweep) ==');
{
  const problems = [];
  let seen = 0;
  const compare = (what, poses, stored, symmetric) => {
    const dancers = symmetric ? completeHalfSet(poses) : poses;
    if (dancers.length !== SETUP_PICKER_SIZE) return;
    seen++;
    const board = { dancers: dancers.map((p, i) => ({ id: i + 1, couple: UNKNOWN_COUPLE, gender: p.gender ?? 'phantom', x: p.x, y: p.y, heading: p.heading })) };
    const computed = { fid: formationId(board), aid: arrangementId(board), sid: setupId(board) };
    for (const k of ['fid', 'aid', 'sid']) if (stored[k] && stored[k] !== computed[k]) problems.push(`${what}: ${k} ${stored[k]} vs ${computed[k]}`);
  };
  const namedTags = parseFormationTags(formationsXml);
  for (const [name, dancers] of parseFormations(formationsXml)) {
    const poses = dancers.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
    compare(name, poses, namedTags.get(name) ?? {}, true);
  }
  for (const { file, xml } of FILES) {
    for (const [index, tam] of parseCallXml(xml).entries()) {
      if (tam.dancers.length === 0) continue;
      const poses = tam.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: (d.gender ?? 'boy') }));
      compare(`${file}#${index}`, poses, tam.formationTag, tam.symmetry !== 1);
    }
  }
  check(seen === 707, `the sweep reached all 707 eight-dancer elements (${seen})`);
  // THE TAGS ARE UIDs, SO A CORRECTION DOES NOT MOVE THEM (`scripts/tag-formations.mjs`), and three definitions
  // minted before a geometry correction therefore carry a fid/aid their current geometry does not compute. That is
  // the RULE working, not a defect - but it is a NAMED SET, so a fourth appears here only on purpose. The `sid`s
  // are exact: none of the drifts is a setup id, and the picker computes its own ids rather than reading these.
  const STORED_TAG_DRIFT = [
    'Alamo Wave Inverted: fid F3-imy1u3eo vs F3-hg18iz6o',
    'Promenade 2: aid A1-oo15o3ev vs A1-ioe51sjt',
    'Promenade 2: fid F3-szrgk1br vs F3-h0dh2uu1',
    'ms/allemande#16: fid F3-imy1u3eo vs F3-hg18iz6o',
  ].sort();
  const sortedProblems = [...problems].sort();
  check(JSON.stringify(sortedProblems) === JSON.stringify(STORED_TAG_DRIFT),
    `the stored tags differ from the ids their geometry computes in exactly the 4 recorded places (${problems.length} found)`,
    `found: ${sortedProblems.join('; ') || 'none'}\n        pinned: ${STORED_TAG_DRIFT.join('; ')}`);
  check(problems.every((p) => !p.includes(': sid ')),
    'NONE of the drifts is a sid: the setup tags are exact, and the picker computes its own ids anyway');
}

console.log('\n== 4. the labels: [shape] setup, shape first ==');
{
  const shapeOf = (name) => rows.find((r) => r.name === name)?.shape;
  const displayOf = (name) => rows.find((r) => r.name === name)?.display;
  check(shapeOf('Normal Lines') === 'Lines', `Normal Lines and Sashayed Lines share the shape \`Lines\` (${shapeOf('Normal Lines')})`);
  check(shapeOf('Sashayed Lines') === 'Lines', '...both rows carry it');
  check(shapeOf('Columns') === 'Column', `Columns and Column RH GBGB share the shape \`Column\` (${shapeOf('Columns')})`);
  check(shapeOf('Ocean Waves') === 'Waves', `Ocean Waves' shape is \`Waves\` (${shapeOf('Ocean Waves')})`);
  check(shapeOf('Lines Facing Out') === 'Lines Facing Out', `one named setup uses its own name as the shape (${shapeOf('Lines Facing Out')})`);
  check(displayOf('Normal Lines') === '[Lines] Normal Lines', `the display puts the shape first (${displayOf('Normal Lines')})`);
  check(displayOf('Static Square') === 'Static Square', `a single-setup shape has no bracket (${displayOf('Static Square')})`);
  check(rows.some((r) => r.display === '[Lines Facing Out] Boys Chase Right, Girls Circulate'),
    'an inline-only setup is bracketed by its shape');
  // A NAME THAT REPEATS (several inline blocks name their setup `Lines Facing Out`, and the named definition does
  // too) is disambiguated with the sid, so every option reads differently.
  const namedLines = rows.find((r) => r.name === 'Lines Facing Out' && r.kind === 'named');
  check(namedLines.display.startsWith('Lines Facing Out (S1-'),
    `a repeated name gets its sid appended (${namedLines.display})`);
  const displays = new Set(rows.map((r) => r.display));
  check(displays.size === rows.length, `every display is distinct (${rows.length - displays.size} collisions)`);
  const sameName = rows.filter((r) => r.name === 'As Couples Slide Thru');
  check(sameName.length === 2 && sameName.every((r) => r.display.endsWith(`(${r.sid})`)),
    `two setups sharing a name are told apart by their sid (${sameName.map((r) => r.display).join(' | ')})`);
}

console.log('\n== 5. the shape-name rule, and the wrong rules it rules out ==');
check(sharedShapeName(['Normal Lines', 'Sashayed Lines']) === 'Lines', 'the longest shared word');
check(sharedShapeName(['Columns', 'Column RH GBGB']) === 'Column', 'a word PREFIX counts: Columns/Column share `Column`');
check(sharedShapeName(['Two-Faced Lines', 'Two-Faced Lines RH']) === 'Lines',
  'a tie on length takes the LATER word (the head noun), so `Lines`, not `Faced`');
check(sharedShapeName(['Alpha RH', 'Beta RH']) === null, 'NEGATIVE: a two-letter shared word is not a shape name (`RH`)');
check(sharedShapeName(['Cab', 'Scab']) === null, 'NEGATIVE: a MID-WORD match is not a match (`Cab`/`Scab`)');
check(sharedShapeName(['Alpha', 'Beta']) === null, 'NEGATIVE: no shared word is null');
check(sharedShapeName(['Only One']) === null, 'one name is not a shared name');
check(sharedShapeName(['normal lines', 'SASHayed LINES']) !== null, 'the match is case-insensitive');

console.log('\n== 6. ordering: shape first, then the setup name ==');
{
  const sorted = [...rows].sort((a, b) => a.shape.localeCompare(b.shape) || a.display.localeCompare(b.display));
  check(sorted.every((r, i) => r === rows[i]), 'the rows come out sorted by shape and then by display');
  const index = (shape) => rows.findIndex((r) => r.shape === shape);
  check(index('Lines') < index('Waves'), `Lines comes before Waves (${index('Lines')} < ${index('Waves')})`);
}

console.log('\n== 7. the selection round trip, against a real Sequencer ==');
{
  const seq = new Sequencer(movesXml, formationsXml, []);
  check(seq.listFormations().length === 138, `the library offers 138 names (${seq.listFormations().length})`);
  check(!seq.listFormations().includes('Sashayed Lines'),
    'the OLD picker\'s list does not even carry `Sashayed Lines` - the setup the report said was hidden');
  const missing = seq.listFormations().filter((n) => !rows.some((r) => r.name === n || r.aliases.includes(n)));
  check(missing.length === 0, `every library name is one of the catalogue's setups (${missing.length} missing)`,
    missing.slice(0, 5).join(', '));

  const samePose = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
    && Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))) < 1e-9
    && a.gender === b.gender;
  const sidMismatch = [];
  const orderMismatch = [];
  for (const row of rows) {
    seq.setSetupBoard(row.dancers, row.name);
    if (setupId(seq.board) !== row.sid) sidMismatch.push(row.display);
    if (!seq.board.dancers.every((d, i) => samePose(d, row.dancers[i]))) orderMismatch.push(row.display);
  }
  check(sidMismatch.length === 0, `every row's board re-computes to that row's sid (${sidMismatch.length} wrong)`,
    sidMismatch.slice(0, 3).join('; '));
  check(orderMismatch.length === 0, `and dancer i is the row's pose i, for all ${rows.length} rows (${orderMismatch.length} moved)`,
    orderMismatch.slice(0, 3).join('; '));

  // HOME IDENTITY WHERE THE GEOMETRY IS HOME; UNKNOWN AWAY FROM IT.
  const square = rows.find((r) => r.name === 'Static Square');
  seq.setSetupBoard(square.dancers, square.name);
  check(seq.board.dancers.every((d) => d.couple > 0), 'a home-shaped setup keeps its real home couples');
  const home = rows.find((r) => r.name === 'Normal Lines');
  seq.setSetupBoard(home.dancers, home.name);
  check(seq.board.dancers.every((d) => d.couple > 0),
    'a setup the FASR registry covers keeps its identity (the name overlay is applied)');
  const inline = rows.find((r) => r.kind === 'inline');
  seq.setSetupBoard(inline.dancers, inline.name);
  check(seq.board.dancers.every((d) => d.couple === UNKNOWN_COUPLE),
    `a setup the registry does not cover keeps UNKNOWN_COUPLE (${inline.name})`);
}

console.log('\n== 8. the caller\'s own formations join or fold in ==');
{
  const withNew = buildSetupCatalogue({
    formationsXml,
    files: sources,
    // ONE DANCER MOVED, so the shape really is new: a TRANSLATION of an existing setup is the same setup, because
    // the ids are translation-invariant (the first version of this check shifted every dancer and saw no new row).
    userFormations: [{ name: 'Probe Shape', dancers: rows[0].dancers.map((p, i) => (i === 0 ? { ...p, x: p.x + 3 } : { ...p })) }],
  });
  check(withNew.rows.length === rows.length + 1, `a new user shape is its own row (${withNew.rows.length} vs ${rows.length})`);
  check(withNew.rows.some((r) => r.kind === 'user' && r.name === 'Probe Shape'), '...and is marked as the user\'s');
  const duplicate = buildSetupCatalogue({
    formationsXml,
    files: sources,
    userFormations: [{ name: 'Probe Alias', dancers: rows[0].dancers }],
  });
  check(duplicate.rows.length === rows.length,
    `a user shape that IS a corpus setup folds into that row (${duplicate.rows.length} vs ${rows.length})`);
  check(duplicate.rows.find((r) => r.sid === rows[0].sid)?.aliases.includes('Probe Alias') === true,
    '...and its name is carried as an alias');
}

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
