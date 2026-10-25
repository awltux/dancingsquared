// THE SEQUENCE DOCUMENT: its shape, its one validator, its ids - and `SequenceSyntax.md`, EXECUTED.
//
// WHAT THIS PINS. `poc/src/sequence-json.ts` is the format's implementation and `SequenceSyntax.md` is its spec, written
// so a person or a model can turn a caller's list of calls into a document the app loads. A spec that is only prose is
// a spec nobody checks, so this probe READS THE MARKDOWN: every fenced `sequence` block is parsed, resolved against the
// real corpus and applied, and the status line the page prints under it (`> Measured: ...`) must be the one the app
// would produce. Change the codec, the resolver or a status message and the page goes red with it.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. THE PARSER'S REFUSALS - bad JSON, another `format`, a future `version`, no `start`, no steps, a step that is
//      neither name nor id, a dancer without a gender. Each is refused with a reason that names the field, because a
//      document half-understood would dance something nobody wrote.
//   2. THE SERIALISER: every field survives `parse(sequenceToJson(doc))`, the output is byte-stable across two runs,
//      and an exact-pose board keeps its eight poses (the fallback §4 documents).
//   3. THE FOUR START FORMS in their resolution order: `dancers` wins, `sid` comes from the catalogue, `formation` goes
//      through the label bridge, and an id the catalogue does not hold is refused (with the id named) while the same
//      document with `dancers` loads.
//   4. THE IDS DO WHAT §2 CLAIMS: a step's `vid` resolves to that variant's title through the library, a name that
//      disagrees with the `vid` is reported rather than obeyed, and an unknown `vid` with no name refuses the step.
//   5. THE DOCUMENT'S EXAMPLES, executed through a real `Sequencer` (the table §9 prints), with each measured status
//      line asserted against the page.
//   6. THE PANEL USES THE CODEC: Import/Export call `parseSequenceDoc`/`resolveSequence`/`sequenceToJson` rather than a
//      copy, the start board goes through `setSetupBoard` (the Board drawer's own call), and `loadSteps` is shared with
//      `openSequence` - so All8, Browse and the document cannot load differently.
//
// Run: node tools/sequence-json-probe.mjs   (from poc/; reads engine/dist, so build the engine first)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';
import { DOMParser } from '@xmldom/xmldom';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(ROOT, 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
const { buildSetupCatalogue } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'setup-catalogue.ts')).href);
const { idsOf, parseSequenceDoc, resolveSequence, sequenceToJson, SEQUENCE_FORMAT, SEQUENCE_VERSION } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'sequence-json.ts')).href
);
const { LETTER_TEMPLATE, resolveStartFormation } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'start-formation.ts')).href
);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const formationsXml = read('formations.xml');
const seq = new engine.Sequencer(read('moves.xml'), formationsXml, callsByTitle(assets));

// ---- the real catalogue, the real labels, the real variants: the panel's three resolvers, built here --------------
const sources = [];
for (const level of fs.readdirSync(assets, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  for (const f of filesOf(level)) {
    const tams = engine.parseCallXml(read(`${level}/${f}`));
    sources.push({ file: `${level}/${f.replace(/\.xml$/, '')}`, tams: tams.map((tam, index) => ({ index, tam })) });
  }
}
const rows = buildSetupCatalogue({ formationsXml, files: sources }).rows;
const toDancers = (dancers) => dancers.map((d) => ({ gender: d.gender ?? 'phantom', x: d.x, y: d.y, heading: d.heading }));
const resolvers = {
  setup: (sid) => {
    const row = rows.find((r) => r.sid === sid);
    return row ? { sid: row.sid, fid: row.fid, aid: row.aid, display: row.display, dancers: toDancers(row.dancers) } : null;
  },
  formation: (name) => {
    const spec = resolveStartFormation(name);
    const board = spec
      ? spec.formation
        ? seq.boardForSetup(spec.formation)
        : engine.boardForFasrCode(spec.code ?? '', (l) => (LETTER_TEMPLATE[l] ? seq.boardForFormation(LETTER_TEMPLATE[l]) : null)).board
      : seq.boardForSetup(name) ?? seq.boardForFormation(name);
    return board ? { dancers: toDancers(board.dancers), label: name } : null;
  },
  variant: (vid) => {
    const found = seq.variantByVid(vid);
    return found ? { title: found.title } : null;
  },
};

const docText = (start, steps) => JSON.stringify({ format: SEQUENCE_FORMAT, version: SEQUENCE_VERSION, start, steps });

/** What the panel's `loadSteps` reports, and the board the sequence reaches. */
function load(text) {
  const parsed = parseSequenceDoc(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const resolved = resolveSequence(parsed.doc, resolvers);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  seq.setSetupBoard(resolved.sequence.start.dancers, resolved.sequence.start.label);
  const startBoard = seq.startBoard();
  const flat = seq.flatten(resolved.sequence.steps);
  let refused = 0;
  for (const step of resolved.sequence.steps) if (!seq.applyStep(step).legal) refused += 1;
  const stop = seq.sequenceStop(flat, startBoard);
  const total = seq.sequenceBeats(flat, startBoard);
  const endBoard = seq.evaluateSequence(flat, total, startBoard).board;
  const status = [
    `loaded ${flat.length} call(s)`,
    `from ${resolved.sequence.start.label}`,
    refused ? `${refused} refused` : '',
    stop ? `stops at "${stop.call}" - ${stop.reason}` : '',
  ].filter(Boolean).join(', ');
  return { ok: true, status, endBoard, refused, stop, notes: resolved.sequence.notes, steps: resolved.sequence.steps };
}

// ---------------------------------------------------------------- 1. the parser's refusals
console.log('\n== 1. a document that is not one is refused, and the reason names the field ==');
{
  const base = { format: SEQUENCE_FORMAT, version: SEQUENCE_VERSION, start: { formation: 'Static Square' }, steps: ['Pass Thru'] };
  const bad = (what, raw) => {
    const got = parseSequenceDoc(raw);
    check(!got.ok && got.reason.length > 0, `${what} is refused (${got.ok ? 'ACCEPTED' : got.reason})`);
    return got;
  };
  bad('text that is not JSON', 'not json at all');
  bad('an array', '[1,2,3]');
  bad('another format', JSON.stringify({ ...base, format: 'all8' }));
  bad('a future version', JSON.stringify({ ...base, version: SEQUENCE_VERSION + 1 }));
  bad('no start', JSON.stringify({ ...base, start: undefined }));
  bad('a start with no form', JSON.stringify({ ...base, start: { name: 'Zero Box' } }));
  bad('no steps', JSON.stringify({ ...base, steps: [] }));
  bad('a step with neither name nor id', JSON.stringify({ ...base, steps: [{ selection: 'Heads' }] }));
  bad('an empty step', JSON.stringify({ ...base, steps: [''] }));
  bad('a dancer without a gender', JSON.stringify({ ...base, start: { dancers: [{ x: 0, y: 0, heading: 0 }] } }));
  bad('a selection with no call', JSON.stringify({ ...base, steps: [{ vid: 'V1-x', selection: 'Heads' }] }));
  const ok = parseSequenceDoc(JSON.stringify(base));
  check(ok.ok && ok.doc.steps.length === 1, 'and the document this probe writes IS accepted');
}

// ---------------------------------------------------------------- 2. the serialiser
console.log('\n== 2. the exporter\'s shape: every field survives, and two runs are byte-identical ==');
{
  const doc = {
    format: SEQUENCE_FORMAT,
    version: SEQUENCE_VERSION,
    name: 'round trip',
    level: 'Mainstream',
    start: { sid: rows[0].sid, aid: rows[0].aid, fid: rows[0].fid, name: rows[0].display },
    steps: ['Pass Thru', { selection: 'Heads', call: 'Swing Thru', vid: 'V1-abc12345' }, { groups: [{ selection: 'Sides', calls: ['Trade', { call: 'Hinge', vid: 'V1-def67890' }] }] }],
    end: { sid: rows[0].sid, name: 'back' },
  };
  const text = sequenceToJson(doc);
  const again = sequenceToJson(doc);
  check(text === again, 'two exports of the same document are the same bytes');
  const back = parseSequenceDoc(text);
  check(back.ok, 'the text parses back');
  if (back.ok) {
    const got = back.doc;
    check(got.name === doc.name && got.level === doc.level, 'name and level survive');
    check(got.start.sid === doc.start.sid && got.start.aid === doc.start.aid && got.start.fid === doc.start.fid, 'the start ids survive');
    check(got.end?.sid === doc.end.sid, 'the end id survives');
    check(JSON.stringify(got.steps) === JSON.stringify(doc.steps), `the steps survive exactly (${JSON.stringify(got.steps)} vs ${JSON.stringify(doc.steps)})`);
  }
  const poses = { format: SEQUENCE_FORMAT, version: SEQUENCE_VERSION, start: { dancers: toDancers(seq.boardForSetup('Static Square').dancers) }, steps: ['Pass Thru'] };
  const posed = parseSequenceDoc(sequenceToJson(poses));
  check(posed.ok && posed.doc.start.dancers?.length === 8, 'an exact-pose start keeps its eight poses through the round trip');
}

// ---------------------------------------------------------------- 3. the four start forms
console.log('\n== 3. start: dancers win, then sid, then formation; an id the catalogue lacks is refused ==');
{
  const zeroBoxLabel = load(docText({ formation: 'Zero Box' }, ['Pass Thru']));
  check(zeroBoxLabel.ok && zeroBoxLabel.status.includes('from Zero Box'), `a label start resolves (${zeroBoxLabel.ok ? zeroBoxLabel.status : zeroBoxLabel.reason})`);
  check(zeroBoxLabel.ok && engine.setupId(zeroBoxLabel.endBoard) !== null, 'and the board it stands up has a setup id');

  const row = rows.find((r) => r.display.endsWith('Zero Box'));
  check(!!row, `the catalogue holds a Zero Box setup (${row?.sid ?? 'none'} as ${row?.display ?? '?'})`);
  if (row) {
    const bySid = load(docText({ sid: row.sid }, ['Pass Thru']));
    check(bySid.ok && bySid.status.includes('from '), `a sid start resolves through the catalogue (${bySid.ok ? bySid.status : bySid.reason})`);
    const chain = load(docText({ sid: row.sid, aid: 'A1-00000000' }, ['Pass Thru']));
    check(chain.ok && chain.notes.some((n) => n.includes('aid')), `a contradictory aid is REPORTED, not obeyed (${chain.ok ? chain.notes.join(' | ') : chain.reason})`);
  }

  const unknownSid = load(docText({ sid: 'S1-zzzzzzzz' }, ['Pass Thru']));
  check(!unknownSid.ok && unknownSid.reason.includes('S1-zzzzzzzz'), `a sid the catalogue does not hold is refused by name (${unknownSid.ok ? 'LOADED' : unknownSid.reason})`);
  const unknownLabel = load(docText({ formation: 'Not A Formation' }, ['Pass Thru']));
  check(!unknownLabel.ok && unknownLabel.reason.includes('Not A Formation'), 'an unknown formation name is refused by name');

  // THE EXACT POSES WIN, even over a sid that names a different board.
  const otherRow = rows.find((r) => r.display !== 'Zero Box');
  const posed = load(docText({ sid: otherRow.sid, dancers: toDancers(seq.boardForSetup('Static Square').dancers) }, ['Pass Thru']));
  check(posed.ok && posed.status.includes('Eight Chain Thru') === false, 'dancers win over a sid beside them');
}

// ---------------------------------------------------------------- 4. the ids on steps
console.log('\n== 4. a step\'s vid is authoritative: it resolves, a disagreeing name is reported, an unknown vid with no name refuses ==');
{
  // a real stored vid, from the library
  const first = seq.getVariants('Right and Left Thru')?.find((v) => v.vid !== null);
  check(!!first, `the corpus tags a Right and Left Thru variant (${first?.vid})`);
  if (first) {
    const byVid = load(docText({ formation: 'Zero Box' }, [{ vid: first.vid }]));
    check(byVid.ok && byVid.status.startsWith('loaded 1 call(s)'), `a vid alone resolves and applies (${byVid.ok ? byVid.status : byVid.reason})`);
    const disagree = load(docText({ formation: 'Zero Box' }, [{ vid: first.vid, call: 'Veer Left' }]));
    check(disagree.ok && disagree.notes.some((n) => n.includes('Right and Left Thru')), `a name that disagrees with the vid is reported (${disagree.ok ? disagree.notes.join(' | ') : disagree.reason})`);
    const unknown = load(docText({ formation: 'Zero Box' }, [{ vid: 'V1-zzzzzzzz' }]));
    check(!unknown.ok && unknown.reason.includes('V1-zzzzzzzz'), 'an unknown vid with no name refuses the step');
    const unknownWithName = load(docText({ formation: 'Zero Box' }, [{ vid: 'V1-zzzzzzzz', call: 'Right and Left Thru' }]));
    check(unknownWithName.ok && unknownWithName.notes.some((n) => n.includes('V1-zzzzzzzz')), 'an unknown vid with a name is reported and the name used');
  }
  // THE RESOLVER IS THE LIBRARY'S, NOT A SECOND MAP: every tagged variant it can find round-trips to its own title.
  let sampled = 0;
  let wrong = 0;
  for (const name of [...new Set(callsByTitle(assets).map((c) => c.name))].slice(0, 300)) {
    for (const variant of seq.getVariants(name) ?? []) {
      if (variant.vid === null) continue;
      sampled += 1;
      const found = seq.variantByVid(variant.vid);
      if (!found || found.title !== name) wrong += 1;
    }
  }
  check(sampled > 100 && wrong === 0, `every sampled stored vid resolves back to its own title (${sampled} checked, ${wrong} wrong)`);
}

// ---------------------------------------------------------------- 5. the document's own examples
console.log('\n== 5. SequenceSyntax.md: every `sequence` example loads, and the page\'s measured line is the real one ==');
{
  const md = fs.readFileSync(path.join(ROOT, 'SequenceSyntax.md'), 'utf8');
  const lines = md.split(/\r?\n/);
  const examples = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('```sequence')) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j].startsWith('```'); j += 1) body.push(lines[j]);
    // the page prints the measured status on the first `> Measured: ` line after the block
    let measured = null;
    for (let k = j + 1; k < lines.length; k += 1) {
      if (lines[k].startsWith('```sequence')) break;
      if (lines[k].startsWith('> Measured:')) { measured = lines[k].slice('> Measured: '.length).trim(); break; }
    }
    examples.push({ at: i + 1, text: body.join('\n'), measured });
    i = j;
  }
  check(examples.length >= 4, `the page carries ${examples.length} executable example(s)`);
  const names = new Set();
  for (const example of examples) {
    const parsed = parseSequenceDoc(example.text);
    check(parsed.ok, `line ${example.at}: the example parses${parsed.ok ? '' : ` - ${parsed.reason}`}`);
    if (!parsed.ok) continue;
    names.add(parsed.doc.name ?? '');
    const got = load(example.text);
    check(got.ok, `line ${example.at}: it resolves${got.ok ? '' : ` - ${got.reason}`}`);
    if (!got.ok) continue;
    check(example.measured !== null, `line ${example.at}: the page prints a measured line under it`);
    if (example.measured !== null) {
      const quoted = example.measured.replace(/^`|`$/g, '').trim();
      check(quoted === got.status, `line ${example.at}: "${parsed.doc.name}" loads as the page says\n         page:  ${quoted}\n         truth: ${got.status}`);
    }
  }
  check(names.size === examples.length, 'every example is named, so a failure above can be found by name');
}

// ---------------------------------------------------------------- 6. the panel uses the codec
console.log('\n== 6. the panel imports the codec, restores the start the way the Board drawer does, and shares one load path ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'sequencer-ui.ts'), 'utf8');
  const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
  check(/import \{ idsOf, parseSequenceDoc, resolveSequence, resolveSetupRef, sequenceToJson, SEQUENCE_FORMAT, SEQUENCE_VERSION \} from '\.\/sequence-json'/.test(ui),
    'the panel imports the codec rather than restating it');
  check(/private importSequence\(\)[\s\S]{0,900}?parseSequenceDoc\(text\)[\s\S]{0,900}?resolveSequence\(parsed\.doc, this\.sequenceResolvers\(\)\)/.test(ui),
    'Import is parse-then-resolve, in that order, with the live resolvers');
  check(/this\.seq\.setSetupBoard\(resolved\.sequence\.start\.dancers, resolved\.sequence\.start\.label\)/.test(ui),
    'the start board goes through `setSetupBoard` - the call the Board drawer uses - so the identity rules are the same');
  check(/private exportSequence\(\)[\s\S]{0,4000}?sequenceToJson\(doc\)/.test(ui), 'Export writes the document through `sequenceToJson`');
  check(/private loadSteps\(steps: ModuleStep\[\], atCall: string \| undefined, startLabel: string, notes: string\[\] = \[\]\)/.test(ui) &&
    (ui.match(/this\.loadSteps\(/g) ?? []).length >= 3,
    'All8, Browse, the document and the saved-module list share ONE `loadSteps`, so a load cannot differ between them');
  check(/id="seqJsonText"/.test(html) && /id="seqJsonImport"/.test(html) && /id="seqJsonExport"/.test(html) && /id="seqJsonInfo"/.test(html),
    'the drawer carries the box, the two buttons and the report line');
  check(/SequenceSyntax\.md/.test(html), 'and the row points at SequenceSyntax.md, which is the spec this probe executes');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
