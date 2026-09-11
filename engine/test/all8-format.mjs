// All8 sequence import/export (engine/src/sequencer/all8-format.ts), gated against Rich Reel's own
// published data.
//
// WHY: the codec's hard part is CALL SHARING, and the sharing rule is not something to reason about
// - it is written down twice by All8 and, better, one of those places PRINTS THE ANSWER. So this
// harness checks the rule against All8's own worked example rather than against our reading of it:
//
//   1. abbrev.htm's call-sharing example is a real table with empty cells, and the page prints the
//      expected reading of the highlighted row in full. That row is the gate. If our reading of
//      sharing is wrong, this fails, and no amount of self-consistency elsewhere can hide it.
//   2. fig_m.htm's ~180 published figures are imported whole, and the imports are checked for the
//      structural properties a share-count bug would break (every figure must reach a resolve, no
//      figure may silently contain an unread token in a position that changes its length).
//   3. Round trip: export -> import must return the same call names.
//
// Run: node test/all8-format.mjs   (part of `npm run verify`)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAll8Figures,
  parseAll8CellRows,
  formatAll8Figures,
  formatAll8Call,
  looksLikeAll8Call,
  ALL8_PITCH,
} from '../dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(path.join(root, 'test/fixtures/all8-figures.json'), 'utf8'));

let pass = 0;
const fails = [];
const ok = (m) => { pass++; console.log(`  ok    ${m}`); };
const fail = (m, d) => { fails.push(m); console.log(`  FAIL  ${m}`); if (d) console.log(`        ${d}`); };

/** Engine call names of a figure, flattened (`TagI` is one token that is two calls). */
const namesOf = (f) => f.calls.flatMap((c) => c.names);

// ---------------------------------------------------------------------------------------------
console.log('\n== 1. All8\'s own worked example (abbrev.htm) ==');
// All8 prints: "Heads Square Thru 4 Hands / Do Sa Do / Swing Thru / Boys Run Right / Couples
// Circulate / Chain Down The Line / Pass The Ocean / All Eight Circulate / Swing and Promenade".
{
  const figs = parseAll8CellRows(fixture.workedExample.rows);
  const want = fixture.workedExample.expectedFigure;
  const row = figs[fixture.workedExample.highlightedRow];
  const got = row.calls.map((c) => c.token);
  const engine = namesOf(row);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail('the highlighted row does not resolve to the figure All8 prints in full', `want ${want.join(' ')}\n        got  ${got.join(' ')}`);
  } else {
    ok(`the highlighted row resolves to All8's printed figure: ${engine.join(' / ')}`);
  }
  // The sharing rule must also be *used* here: this row shares its first four cells.
  if (row.shared !== 4) fail(`the highlighted row should share 4 leading cells, got ${row.shared}`);
  else ok('...and it is reached by sharing 4 leading cells, as the table\'s empty cells say');

  const anyEmpty = figs.some((f) => namesOf(f).length === 0);
  if (anyEmpty) fail('a table row resolved to no calls at all');
  else ok(`all ${figs.length} table rows resolved to calls`);

  const undecodable = figs.flatMap((f) => f.calls).filter((c) => c.names.length === 0);
  if (undecodable.length) {
    console.log(`  note  ${undecodable.length} token(s) in the example are not in our table: ${[...new Set(undecodable.map((c) => c.token))].join(', ')}`);
  } else {
    ok('every token in All8\'s example is in our abbreviation table');
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n== 2. fig_m.htm: import every published figure ==');
const { figures, skipped } = parseAll8Figures(fixture.figuresText);
{
  // The ONLY non-figure lines on the page are its three-line preamble. Anything else we skipped is
  // a figure we failed to read, which is the failure mode that matters.
  const wantSkipped = 3;
  if (skipped.length !== wantSkipped) {
    fail(`${skipped.length} lines were skipped as non-figures, expected only the ${wantSkipped}-line preamble`,
      skipped.join('\n        '));
  } else {
    ok(`read the page, skipping exactly the preamble (${wantSkipped} lines)`);
  }

  if (figures.length < 150) fail(`only ${figures.length} figures imported; the page publishes ~180`);
  else ok(`imported ${figures.length} figures`);

  // Every COMPLETE figure should end at a resolve - that is what makes it a figure rather than a
  // fragment, and a share-count bug shows up here as a lost or duplicated tail. Lines carrying
  // quoted delivery text are breaks/codas, so they are excluded and reported instead.
  const resolver = /^(promenade|all promenade|promenade home|swing|allemande left|right and left grand)$/i;
  const complete = figures.filter((f) => !f.spoken);
  const notResolved = complete.filter((f) => {
    const n = namesOf(f);
    return !n.length || !resolver.test(n[n.length - 1]);
  });
  if (notResolved.length) {
    fail(`${notResolved.length} figures do not end at a resolve`, notResolved.slice(0, 3).map((f) => namesOf(f).join(' / ')).join('\n        '));
  } else {
    ok(`all ${complete.length} complete figures end at a resolve (of 188; the other ${figures.length - complete.length} carry quoted delivery text and are breaks/codas)`);
  }

  // Sharing must actually be exercised: the page is built around it.
  const shifted = figures.filter((f) => f.shared > 0).length;
  if (shifted < figures.length / 3) fail(`only ${shifted} of ${figures.length} figures share leading calls; the page is built on sharing`);
  else ok(`${shifted} of ${figures.length} figures are reached by sharing (${Math.round((100 * shifted) / figures.length)}%)`);

  // The indent rule says share count is indent/pitch. Verify it is EXACT across the page: a
  // non-integral division anywhere would mean the pitch assumption is wrong for that block.
  const bad = figures.filter((f) => f.shared < 0 || !Number.isInteger(f.shared));
  if (bad.length) fail(`${bad.length} figures got a non-integral share count`);
  else ok(`every share count is a whole number of ${ALL8_PITCH}-character cells`);

  // All8's 2+5 format: a call abbreviation never contains a space, so no figure may end up with a
  // token that is actually two page words glued together.
  const glued = figures.flatMap((f) => f.calls).filter((c) => /\s/.test(c.token));
  if (glued.length) fail(`${glued.length} tokens contain whitespace`, glued.slice(0, 5).map((c) => c.token).join(', '));
  else ok('no token spans whitespace (the page\'s prose words did not leak into calls)');

  const undecoded = new Map();
  for (const f of figures) for (const c of f.calls) if (!c.names.length) undecoded.set(c.token, (undecoded.get(c.token) ?? 0) + 1);
  const total = [...undecoded.values()].reduce((a, b) => a + b, 0);
  console.log(`  note  ${total} call token(s) over ${undecoded.size} distinct abbreviation(s) are not in our table:`);
  console.log(`        ${[...undecoded.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(' ') || '(none)'}`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n== 3. round trip: export -> import ==');
{
  const sample = figures.slice(0, 40).filter((f) => namesOf(f).length > 2);
  const names = sample.map((f) => namesOf(f));
  const text = formatAll8Figures(names);
  const back = parseAll8Figures(text).figures;
  let bad = 0;
  sample.forEach((f, i) => {
    const a = namesOf(f).join('|');
    const b = back[i] ? namesOf(back[i]).join('|') : '<missing>';
    if (a !== b) { if (bad < 3) console.log(`        ${names[i].join(' / ')}\n     -> ${b}`); bad++; }
  });
  if (bad) fail(`${bad} of ${sample.length} figures did not round-trip`);
  else ok(`${sample.length} figures export and re-import with identical call names`);

  // Sharing must be applied by the exporter, not just understood by the importer.
  const lines = text.split('\n');
  const indented = lines.filter((l) => l.startsWith(' '.repeat(2 + ALL8_PITCH))).length;
  if (indented === 0) fail('the exporter emitted no shared (indented) lines, so it is not applying call sharing');
  else ok(`the exporter applied call sharing to ${indented} of ${lines.length} lines`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n== 4. the exporter must not invent vocabulary ==');
{
  if (formatAll8Call('Slide Thru') !== '--SldTh') fail(`Slide Thru exported as ${formatAll8Call('Slide Thru')}`);
  else ok('Slide Thru exports as --SldTh');
  if (formatAll8Call('Girls Hinge') !== 'G-Hing') fail(`Girls Hinge exported as ${formatAll8Call('Girls Hinge')}`);
  else ok('a group-scoped call exports in All8\'s designator form (Girls Hinge -> G-Hing)');
  if (formatAll8Call('No Such Call At All') !== null) fail('an unknown call produced a token instead of null');
  else ok('a call with no All8 abbreviation returns null rather than a made-up token');

  // `looksLikeAll8Call` is the prose/call discriminator; both directions matter.
  for (const t of ['--DoSaD', 'H-Pr1/2', '--1/2Tg', '4LChn', 'SqTh4', '?--StepW'])
    if (!looksLikeAll8Call(t)) fail(`${t} should look like an All8 call`);
  for (const t of ['Get-outs', 'practice', 'anyone', 'for', '"Sneaky"', '(*)'])
    if (looksLikeAll8Call(t)) fail(`${t} is page text and should NOT look like an All8 call`);
  ok('the prose/call discriminator accepts every real token shape and rejects page words');
}

// ---------------------------------------------------------------------------------------------
console.log(`\nAll8 FORMAT: ${pass} checks passed, ${fails.length} failed.`);
if (fails.length) { console.log('FAILED:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
