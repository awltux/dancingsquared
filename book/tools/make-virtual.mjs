// THE WHOLE-SET INSTANCES OF CALLS THE CORPUS ONLY AUTHORS AS SUBSET UNITS.
//
// WHY THIS EXISTS. `make-animations.mjs` plays whole-set instances only (its `WHOLE_SET` note carries the
// measurement: 48 of 75 cards used to play a 2- or 4-dancer authoring). Some calls have NO eight-dancer
// authoring in the corpus, so their cards have no picture. The engine's answer to a subwhole authoring is the
// VIRTUAL call (`engine/src/sequencer/virtual-call.ts`): place the written unit on a whole board and keep the
// placement only if it STARTS and ENDS on a formation the namer recognises. This tool materialises a chosen
// placement as a `<tam>`, so the player can fetch it by `(file, tamIndex)` like any other authoring.
//
// A PLACEMENT MUST ALSO BE LEGAL, AND THAT IS THE PERMISSION LAYER'S QUESTION, NOT GEOMETRY'S. A placement says
// WHICH DANCERS dance (`VirtualCandidate.placement[copy][j]` is a board index); `PERMISSION_RULES` is written in
// READINGS ("Heads", "Sides", "Couple #2", "All 8"). `Sequencer.readingOf` translates one into the other and
// `Sequencer.mayOffer` answers, which is the same predicate the POC's picker uses - MEASURED on this tool's first
// run, the tiled `Circle Four Left` on a Static Square reads as `All 8` and is refused by name: "Circle Four is
// danced by four dancers - the heads or the sides - so the whole square cannot circle four". Its PARTIAL
// placement reads as `Sides` and is allowed, which is the picture the book should show.
//
// SO CANDIDATES ARE FILTERED BY PERMISSION BEFORE ONE IS CHOSEN, in `chooseVirtual`'s own preference order (a
// tiled placement before a partial one, then the lower placement error, then the placement key). A call with no
// allowed reading anywhere is RECORDED AS REFUSED, with the rule's sentence, rather than drawn illegally: the
// index carries a `refusals` section and `make-animations.mjs` puts that sentence on the card.
//
// THE SEARCH IS NOT IN THE BUILD, AND THAT IS THE POINT. `virtual-call.ts` keeps "no cache and no ambient
// state", so a placement is a SEARCH over boards. Running that search over every call and every formation is
// exactly the explosion the owner warned about - a call as unconstrained as `Dancer Turn Right` places on very
// many setups, and a map keyed by call title would either store a combinatorial set of records or pin whichever
// placement it happened to find first (the silent-choice defect `e199c42` removed from the bindings). So the
// boards are DECLARED, one per card, in `virtual-placements.json`; this tool VALIDATES each claim and refuses
// it when the engine disagrees. `--discover=<title>` is a person's aid for writing a row, and nothing else runs
// it.
//
// THE REFUSALS, each a different mistake:
//   - the declared board does not stand up (`boardForFormation` returns null);
//   - the placement is illegal for that call (the source does not fit the board at all);
//   - no placement on that board carries an ALLOWED reading (permission);
//   - the placement is AMBIGUOUS (`chooseVirtual` would refuse it: equally good placements, or one placement
//     reaching two different named ends);
//   - a row marked `refused` whose call DOES have an allowed reading - the claim is false, so declare it;
//   - a row whose `level` does not author a call with its `title`, which is a mistake in the ROW rather than a
//     geometric refusal and must not read as one;
//   - the serialised `<tam>` does not reproduce the placed bundle when read back;
//   - an `assets/<level>/*.virtual.xml` that no row produces: a writing run DELETES it, and `--check` FAILS on
//     it, because a generated file left behind is read as an authored one by anything that forgot the suffix;
//   - in `--check` only, a row whose card has since gained an eight-dancer CORPUS authoring, which is dead
//     weight because the catalogue prefers the corpus.
//
// THE OUTPUT IS ONE GENERATED FILE BESIDE EACH CALL'S OWN FAMILY, plus one generated index:
//   assets/<level>/<family>.virtual.xml   the `<tam>`s for the placements whose source lives in that family
//   book/tools/virtual-index.json         { placements: card -> {...}, refusals: card -> the rule's sentence }
//
// THE TAM LIVES BESIDE ITS FAMILY, AND THAT IS A CORPUS RULE RATHER THAN A TIDINESS ONE. A generated whole-set
// instance of `Circle Four Left` belongs next to `ms/circle.xml` — the file that authors the call — so a reader
// walking the corpus sees the family and its generated instances together, and so an integration that resolves
// a call by its FILE has the same answer for the authored and the generated authoring. It used to live in
// `assets/virtual/tams.xml`, a directory that was not a level: MEASURED, that cost three gates (`call-titles`
// counted its tams, `poc/tools/corpus-key-probe.mjs` counted eleven level directories, and
// `poc/tools/mirror-moves-probe.mjs` reached a degenerate facing curve the corpus authors but never loads).
//
// SO `filesOf` EXCLUDES THESE FILES BY NAME (`.virtual.xml`), and `virtualFilesOf` is how a caller asks for
// them. THE GENERATED FILES ARE NOT AUTHORED DATA: no census of authored tams may count them, which is why the
// exclusion lives in the one corpus reader rather than in each census.
//
// EACH TAM NAMES THE VARIANT IT WAS PLACED FROM, as `parent_vid` — the same `V1-` scheme an authored tam carries
// in its own `vid`, and deliberately the same word: `vid` names a CALL VARIANT, so a reference to the variant a
// placement came from says `parent_vid` rather than the old `parent_id`, which read as if it might be a dancer id or
// a database key. The value is the engine's call-variant id — `callVariantId(level, title, fid)` — where `fid` is
// the tag STORED on the source definition (`VirtualCallInfo.sourceFid` when the source authored its own setup,
// otherwise the tag of the formation it names). That is the identity a consumer dedupes on: several authorings of
// one variant share it BY DESIGN, so two generated instances of the same call from the same start shape carry the
// same `parent_vid`.
//
// Run: node book/tools/make-virtual.mjs            (regenerate)
//      node book/tools/make-virtual.mjs --check    (verify the committed artefacts)
//      node book/tools/make-virtual.mjs --discover=Dosado
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, levelsAvailable, readFile, tamsOf, VIRTUAL_SUFFIX, virtualFilesOf } from 'dancing-squared-corpus';

import { loadEngine, readAsset, toolsDir } from './lib/load.mjs';
import { loadTags } from './lib/variants.mjs';

const PLACEMENTS = join(toolsDir, 'virtual-placements.json');
const OUT_INDEX = join(toolsDir, 'virtual-index.json');
// `VIRTUAL_SUFFIX` is IMPORTED: the corpus package owns the convention (`packages/corpus/virtual.ts`), and a
// second spelling here is the two-conventions trap the suffix exists to avoid.

/** The levels an authoring may come from; the same two the book draws on. */
const LEVELS = ['ms', 'plus'];

/** The tolerance the XML's own rounding admits - four decimals on every coordinate (`callToXml`). IT IS THE ENGINE'S
 *  NUMBER NOW, not a copy of it: this file used to write `1e-3` and note in a comment that `startsFromFormation` used
 *  "the same 1e-3 for the same reason", which is a copy kept in step by prose. `XML_ROUND_TRIP_TOL` is that rule's one
 *  name (`engine/src/tolerances.ts`), and `lib/load.mjs` asserts the export exists. */
const ROUND_TRIP_TOL = loadEngine().XML_ROUND_TRIP_TOL;

/** Boards `--discover` tries. A REPORT's input, bounded on purpose: this list is not a search the build runs. */
const DISCOVER_BOARDS = [
  'Static Square', 'Squared Set', 'Normal Lines', 'Facing Lines', 'Ocean Waves', 'Right-Hand Waves',
  'Two-Faced Lines', 'Eight Chain Thru', 'Double Pass Thru', 'Completed Double Pass Thru', 'Columns',
];

/**
 * Every `<tam>` in ms+plus, by title, as XML — the source the placements are built from — AND the file that
 * authors each title in a level, which is where that family's generated instances belong.
 *
 * THE FAMILY IS THE FIRST FILE IN THE DIRECTORY'S OWN ORDER that carries the title, which is a measurement
 * rather than a rule about names: `Circle Four Left` is authored in `ms/circle.xml`, and for the seven
 * placements this book has, the first authoring file's basename is the call's own family in every case. A title
 * authored in two levels is two families, so the key is `level|title` and the row's `level` (default `ms`)
 * chooses - the same key the book's variant resolver uses.
 */
function sources() {
  const byTitle = new Map();
  const familyOf = new Map();
  for (const level of LEVELS) {
    for (const file of filesOf(level)) {
      for (const tam of tamsOf(level, file)) {
        if (!tam.title) continue;
        if (!byTitle.has(tam.title)) byTitle.set(tam.title, []);
        byTitle.get(tam.title).push(tam.xml);
        const key = `${level}|${tam.title}`;
        if (!familyOf.has(key)) familyOf.set(key, file);
      }
    }
  }
  return { byTitle, familyOf };
}

/**
 * Place `title` on `board`, or explain why it cannot be: the engine's candidate list, or a sentence naming the
 * geometric refusal. Permission is asked separately, per candidate, by `chooseLegal`.
 */
function place(eng, byTitle, title, boardName) {
  const written = byTitle.get(title) ?? [];
  if (!written.length) return { error: `no corpus authoring carries the title "${title}"` };
  let seq;
  try {
    seq = new eng.Sequencer(readAsset('moves.xml'), readAsset('formations.xml'), [
      { name: title, xml: `<calls>\n${written.join('\n')}\n</calls>` },
    ]);
  } catch (err) {
    return { error: `the engine could not load those tams: ${String(err.message ?? err)}` };
  }
  const board = seq.boardForFormation(boardName);
  if (!board) return { error: `the engine stands up no board for "${boardName}"` };
  const outcome = seq.virtualCall(board, title);
  if (!outcome.legal) return { error: outcome.reason };
  return { seq, board, candidates: outcome.candidates };
}

/** `chooseVirtual`'s own preference: a tiled placement first, then the lower error, then the placement key. */
const placementKey = (c) => c.placement.map((copy) => copy.join('+')).join('/');
const preference = (a, b) =>
  (a.kind === 'tiled' ? 0 : 1) - (b.kind === 'tiled' ? 0 : 1) ||
  a.error - b.error ||
  placementKey(a).localeCompare(placementKey(b));

/**
 * The first placement whose READING the permission layer allows, with the reading and the rule's answer.
 *
 * A candidate whose dancers no group names is skipped with that reason recorded: the permission question cannot
 * be asked about dancers nobody has a word for, and asking it about the nearest name would be a different call.
 */
function chooseLegal(seq, board, title, candidates) {
  const denied = [];
  for (const candidate of [...candidates].sort(preference)) {
    const ids = [...new Set(candidate.placement.flat())].map((i) => board.dancers[i].id);
    const reading = seq.readingOf(board, ids);
    if (!reading) {
      denied.push(`${candidate.kind} placement moves dancers ${ids.join(',')}, which no reading names`);
      continue;
    }
    const verdict = seq.mayOffer(title, reading, board);
    if (verdict.allowed) {
      return {
        chosen: candidate,
        reading,
        permission: verdict.reason ?? `the ${reading} reading is permitted from ${candidate.startFormation}`,
      };
    }
    denied.push(`${candidate.kind}/${reading}: ${verdict.reason ?? 'denied'}`);
  }
  return { denied };
}

/** Every sampled pose of a bundle, row for row - the shape the round-trip comparison walks. */
function posesOf(eng, bundle) {
  const out = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = (bundle.beats * i) / steps;
    out.push({ t, poses: eng.allPoses(bundle, t) });
  }
  return out;
}

/** How far two bundles' sampled poses differ, as the worst single coordinate over the whole walk.
 *
 *  HEADINGS ARE COMPARED AS ANGLES, NOT NUMBERS. MEASURED: the first run reported a drift of 6.28 on `Swing Your
 *  Partner` - exactly one turn - because the same facing came back as 0 and as 2*pi. A raw subtraction would
 *  refuse a correct artefact, and normalising to (-pi, pi] is what the engine does everywhere it reads a facing. */
function poseDrift(eng, a, b) {
  if (a.dancers.length !== b.dancers.length) return Infinity;
  const pa = posesOf(eng, a);
  const pb = posesOf(eng, b);
  const turn = (d) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  let worst = 0;
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pa[i].poses.length; j++) {
      const x = pa[i].poses[j];
      const y = pb[i].poses[j];
      worst = Math.max(worst, Math.abs(x.x - y.x), Math.abs(x.y - y.y), turn(x.heading - y.heading));
    }
  }
  return worst;
}

/**
 * The whole render, in memory: each generated file's text, the index object, and every refusal. Pure apart from
 * the engine, so `--check` and a writing run compare the same thing.
 */
export function render() {
  const placements = JSON.parse(readFileSync(PLACEMENTS, 'utf8'));
  const eng = loadEngine();
  const tags = loadTags(eng);
  const { byTitle, familyOf } = sources();
  /** corpus-relative path -> the `<tam>` texts it carries, in placement order (a family may host two). */
  const tams = new Map();
  const entries = {};
  const refusals = {};
  const problems = [];

  for (const id of Object.keys(placements).filter((k) => !k.startsWith('$')).sort()) {
    const row = placements[id];
    const level = row.level ?? 'ms';
    // THE FAMILY IS NAMED BEFORE THE PLACEMENT IS TRIED, because a row whose level does not author its own
    // title is a MISTAKE IN THE ROW rather than a geometric refusal, and the two must not read the same.
    const family = familyOf.get(`${level}|${row.title}`) ?? null;
    if (!family) {
      problems.push(`${id}: level "${level}" authors no call titled "${row.title}" - name the level that does (rows default to ms)`);
      continue;
    }
    const placed = place(eng, byTitle, row.title, row.board);
    if (placed.error) {
      problems.push(`${id}: ${placed.error}`);
      continue;
    }
    const legal = chooseLegal(placed.seq, placed.board, row.title, placed.candidates);
    if (row.refused) {
      // A REFUSAL IS A CLAIM TOO, and the check that it is true is that no placement on this board is allowed.
      if (legal.chosen) {
        problems.push(`${id}: marked refused, but a legal placement exists (${legal.chosen.kind}/${legal.chosen.reading}) - declare it instead`);
      } else {
        refusals[id] = legal.denied[0] ?? `no placement of "${row.title}" on ${row.board}`;
      }
      continue;
    }
    if (!legal.chosen) {
      problems.push(`${id}: no placement on ${row.board} has an allowed reading - ${legal.denied.join(' | ')}`);
      continue;
    }
    const { chosen } = legal;
    // THE VARIANT THE INSTANCE WAS PLACED FROM. Its third input is the SOURCE DEFINITION'S STORED TAG: the inline
    // block's own when the source authored its setup, otherwise the tag of the formation it names. `sourceStart`
    // is a content address and is only named in the failure message.
    const sourceStart = chosen.bundle.virtual?.sourceStart ?? '';
    const sourceFid = chosen.bundle.virtual?.sourceFid ?? null;
    const sourceFormation = chosen.bundle.virtual?.sourceFormation ?? null;
    const fid = sourceFid ?? (sourceFormation ? tags.get(sourceFormation)?.fid ?? null : null);
    const parentVid = fid ? eng.callVariantId(level, chosen.bundle.title, fid) : '';
    if (!eng.isCallVariantId(parentVid)) {
      problems.push(`${id}: the engine minted no call-variant id for "${chosen.bundle.title}" from ${level} (sourceStart "${sourceStart}")`);
      continue;
    }
    // BESIDE THE FAMILY, inside the FAMILY'S OWN LEVEL: `ms/circle.xml` -> `ms/circle.virtual.xml`, so the
    // generated instance is addressed by the same `level/<file>#tamIndex` every other authoring is.
    const file = `${level}/${family.replace(/\.xml$/, VIRTUAL_SUFFIX)}`;
    const tamIndex = tams.get(file)?.length ?? 0;
    if (!tams.has(file)) tams.set(file, []);
    tams.get(file).push(eng.callToXml(chosen.bundle, undefined, { extraAttrs: { parent_vid: parentVid } }));
    entries[id] = {
      file,
      tamIndex,
      title: chosen.bundle.title,
      parentVid,
      level,
      board: chosen.startFormation,
      kind: chosen.kind,
      reading: legal.reading,
      permission: legal.permission,
      startFormation: chosen.startFormation,
      endFormation: chosen.endFormation,
      why: row.why,
    };
  }

  const files = new Map();
  for (const [file, list] of [...tams].sort(([a], [b]) => a.localeCompare(b))) {
    // THE ROOT ELEMENT IS THE CORPUS'S OWN, `<tamination title="…">` — singular, as every authored file under a
    // level directory spells it — and the title is the FAMILY's, read from the file these instances were placed
    // beside. A generated file that used a different root (`<taminations>`, as the old `assets/virtual/tams.xml`
    // did) is a second convention in one tree for no gain: `parseTaminationTitle` reads a family off every corpus
    // file, and it would have read none off these.
    const familyFile = file.replace(new RegExp(`${VIRTUAL_SUFFIX.replace('.', '\\.')}$`), '.xml');
    const [familyLevel, ...familyRest] = familyFile.split('/');
    const familyTitle = eng.parseTaminationTitle(readFile(familyLevel, familyRest.join('/')));
    files.set(
      file,
      '<?xml version="1.0"?>\n'
      + '<!-- GENERATED by book/tools/make-virtual.mjs from virtual-placements.json - do not edit by hand. -->\n'
      + `<tamination title="${familyTitle}">\n`
      + list.join('\n')
      + '\n</tamination>\n',
    );
  }

  // THE ROUND TRIP, against the file that will actually ship. A tam's paths are paired with the formation's
  // dancers BY INDEX, so a text that re-reads to a different set of poses is a wrong picture, not a format
  // nuance - and the tolerance is the XML's own rounding, not a fudge factor.
  for (const id of Object.keys(entries).sort()) {
    const entry = entries[id];
    const text = files.get(entry.file);
    let back;
    try {
      back = eng.loadCallFromXml(text, readAsset('moves.xml'), readAsset('formations.xml'), entry.tamIndex, true);
    } catch (err) {
      problems.push(`${id}: the generated tam does not re-read: ${String(err.message ?? err)}`);
      continue;
    }
    if (!back || back.dancers.length !== 8) {
      problems.push(`${id}: the generated tam re-reads as ${back?.dancers?.length ?? 0} dancers, not 8`);
      continue;
    }
    const placed = place(loadEngine(), byTitle, entry.title, entry.board);
    const legal = placed.error ? null : chooseLegal(placed.seq, placed.board, entry.title, placed.candidates).chosen;
    const drift = legal ? poseDrift(eng, legal.bundle, back) : Infinity;
    if (!(drift <= ROUND_TRIP_TOL)) {
      problems.push(`${id}: the generated tam plays differently from the placement it claims (worst pose drift ${drift.toExponential(2)}, tolerance ${ROUND_TRIP_TOL})`);
    }
  }

  return { files, index: { version: 1, placements: entries, refusals }, problems, placements };
}

/**
 * Every `*.virtual.xml` in the corpus, as corpus-relative paths — the population a writing run must reconcile
 * against what it produced, so a placement deleted from the JSON does not leave its artefact behind to be read
 * as an authored file by something that forgot the suffix.
 *
 * THE LIST COMES FROM THE READER, not from a walk of its own: `filesOf` excludes that name and `virtualFilesOf`
 * is the other half of the same decision (`packages/corpus/virtual.ts`), so a private `readdirSync` here would be
 * a second spelling of the suffix test — the one thing the corpus package exists to prevent.
 */
function virtualFilesOnDisk() {
  return levelsAvailable().flatMap((level) => virtualFilesOf(level).map((name) => `${level}/${name}`)).sort();
}

/** A row whose card has since gained an eight-dancer corpus authoring is dead weight - the catalogue prefers it. */
function rowsStillNeeded() {
  const placements = JSON.parse(readFileSync(PLACEMENTS, 'utf8'));
  const eng = loadEngine();
  const { byTitle } = sources();
  const dead = [];
  for (const id of Object.keys(placements).filter((k) => !k.startsWith('$'))) {
    const row = placements[id];
    let anyEight = false;
    for (const xml of byTitle.get(row.title) ?? []) {
      try {
        const b = eng.loadCallFromXml(
          `<?xml version="1.0"?><taminations>${xml}</taminations>`,
          readAsset('moves.xml'), readAsset('formations.xml'), 0, true,
        );
        if (b.dancers.length === 8) anyEight = true;
      } catch { /* an authoring that does not build is not an eight-dancer one */ }
    }
    if (anyEight) dead.push(`${id}: "${row.title}" now has an eight-dancer corpus authoring, so this row is dead - delete it`);
  }
  return dead;
}

export function main() {
  const check = process.argv.includes('--check');
  const discover = process.argv.find((a) => a.startsWith('--discover'));

  if (discover) {
    const title = discover.includes('=') ? discover.split('=')[1] : '';
    const eng = loadEngine();
    const { byTitle } = sources();
    if (!byTitle.has(title)) {
      console.error(`no corpus authoring carries the title "${title}"`);
      return 1;
    }
    for (const board of DISCOVER_BOARDS) {
      const placed = place(eng, byTitle, title, board);
      if (placed.error) {
        console.log(`${board}: REFUSED (${placed.error})`);
        continue;
      }
      const legal = chooseLegal(placed.seq, placed.board, title, placed.candidates);
      console.log(
        `${board}: ${legal.chosen
          ? `PLACES ${legal.chosen.startFormation} to ${legal.chosen.endFormation} (${legal.chosen.kind}/${legal.reading}, ALLOWED)`
          : `no allowed reading (${legal.denied[0] ?? 'no candidates'})`}`,
      );
    }
    return 0;
  }

  const { files, index, problems } = render();
  problems.push(...rowsStillNeeded());

  // AN ARTEFACT WITH NO ROW IS A LIE WAITING TO BE READ: a placement deleted from the JSON would leave its
  // `.virtual.xml` behind, and the corpus reader excludes that name while a reader that walks the directory
  // does not. So the population on disk is reconciled here - deleted by a writing run, and a FAILURE in
  // `--check`, where nothing may be written.
  const written = new Set(files.keys());
  const orphans = virtualFilesOnDisk().filter((f) => !written.has(f));

  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\n${problems.length} placement problem(s); nothing written.`);
    return 1;
  }

  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  if (check) {
    const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    let drift = 0;
    for (const [file, text] of files) {
      const full = join(corpusRoot(), file);
      if (!existsSync(full) || !sameText(readFileSync(full, 'utf8'), text)) {
        console.error(`DRIFT assets/${file}`);
        drift++;
      }
    }
    if (!existsSync(OUT_INDEX) || !sameText(readFileSync(OUT_INDEX, 'utf8'), indexText)) {
      console.error(`DRIFT ${OUT_INDEX}`);
      drift++;
    }
    for (const file of orphans) {
      console.error(`UNCLAIMED assets/${file} - no placement row produces it; delete it`);
      drift++;
    }
    if (drift) {
      console.error(`\n${drift} file(s) differ. Re-run without --check.`);
      return 1;
    }
    console.log(
      `${Object.keys(index.placements).length} virtual placement(s) reproduce exactly in ${files.size} file(s)`
      + `, ${Object.keys(index.refusals).length} refusal(s) still true.`,
    );
    return 0;
  }

  for (const [file, text] of files) writeFileSync(join(corpusRoot(), file), text, 'utf8');
  for (const file of orphans) {
    unlinkSync(join(corpusRoot(), file));
    console.error(`  DELETED assets/${file} - no placement row produces it`);
  }
  writeFileSync(OUT_INDEX, indexText, 'utf8');
  for (const id of Object.keys(index.placements).sort()) {
    const e = index.placements[id];
    console.log(`  ${id}  ${e.title}  from ${e.board}  (${e.kind}/${e.reading}, ends on ${e.endFormation})  ${e.parentVid}  -> ${e.file}#${e.tamIndex}`);
  }
  for (const id of Object.keys(index.refusals).sort()) console.log(`  ${id}  REFUSED: ${index.refusals[id]}`);
  console.log(`${Object.keys(index.placements).length} placement(s) in ${files.size} file(s), ${Object.keys(index.refusals).length} refusal(s) -> assets/ + ${OUT_INDEX}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
