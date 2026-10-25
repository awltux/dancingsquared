// THE COLOUR A BOARD WITH NO HOME IDENTITY IS DRAWN IN - ONE RULE FOR THE SEQUENCER, THE BROWSE/EDIT BOARD AND THE
// GAME - AND THE RETIRED "APPROVED SETUP" LIST THAT USED TO GATE IT.
//
// Reported: "How can I get the dancer colour coding to appear for the formations in the zero setup? it appears
// to be something related to this text in the ui 'no home identity (not a squared set)' ... e.g. zero lines,
// zero colums etc", and then, about the other app, "some calls show as grey dancers, which makes differentiating
// them more difficult".
//
// THE DIAGNOSIS IN THE REPORT IS EXACT. `assignHomeIdentity` stamps `couple` by matching the start formation to
// the home square, so it names only six of the formations in `assets/formations.xml` (this probe prints the live
// figure); the rest come back `UNKNOWN_COUPLE` and `coupleColor(0)` draws every dancer the same grey. Worse, the two
// views disagreed: the sequencer had a display-only fallback, while the browse/edit board (`browser.ts`, which is what
// the Call editor previews through) passed `d.couple ?? 0` straight to the avatar - the SAME board coloured in one
// panel and grey in the other.
//
// SO THE RULE IS THE PAIR, EVERYWHERE: `displayCouple` draws a dancer with no home couple in the colour of the pair it
// sits in in the board's own order - `floor(index / 2) + 1` - and the board's order IS the formation element's order
// (`sid` is the arrangement AND the order: `engine/src/sequencer/setup-id.ts`). It used to take an `enabled` flag and
// the sequencer passed `false` unless the start board's NAME was one of 24 in `poc/src/zero-formations.ts`, a list of
// the setups whose authored order had been verified as square-set order. That list gated a COLOUR on a NAME: a setup
// reached through the setup picker was grey unless its own name happened to be listed, and the 274 setups that exist
// only as a call's inline `<formation>` block were never listed at all. With every defined formation element carrying
// a `sid`, every one of them is a setup whose order is its own data, so the list, `isZeroSetup`, `startIsZeroOrder`
// and the flag are retired.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. a real home couple is passed through untouched, so the fallback cannot repaint a squared set (the plausible
//      wrong rule: always number by position, red here for 8 of 8 dancers);
//   2. a board of unknown couples gets 1,1,2,2,3,3,4,4 - a PAIR per colour, not one colour per dancer (red for
//      `(i % 4) + 1` at 6 of 8) and not one grey;
//   3. THE GATE IS GONE, measured three independent ways: the module is deleted, no POC or game source mentions the
//      list or the flag, and every call site passes the two arguments the rule takes (a third argument is the flag
//      coming back);
//   4. THE HALF-SET CASE, where the rule earns its keep: a half-set formation is completed by turning the written
//      dancers 180 degrees about the centre, so written `1,2` completes to `1,2,3,4` and the fallback reproduces the
//      TRUE home couples - measured against the engine's own squared set, not a restatement;
//   5. THE SIZE OF THE CHANGE, in setups rather than in names: the engine can stamp couples on only a handful of the
//      484 setups the Board picker offers, and the rule colours all 484 - so a rule that coloured only the identified
//      boards would grey almost every start setup;
//   6. the render paths ask for what they claim: the browse/edit board colours every board and labels none of them,
//      the sequencer colours through the same function and keeps the couple NUMBER (the one screen that reads pairs
//      off the board), and the game labels only a couple the engine stamped.
//
// Run: node tools/display-couple-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';
import { DOMParser } from '@xmldom/xmldom';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const DEG = Math.PI / 180;

const { displayCouple } = await import(pathToFileURL(path.join(ROOT, 'packages', 'stage', 'display-couple.ts')).href);
const { completeHalfSet } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);
const { buildSetupCatalogue } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'setup-catalogue.ts')).href);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
engine.setParser(DOMParser);

let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/** `displayCouple` over a list of couples, in board order: the whole of what the render path does. */
const colourBy = (couples) => couples.map((couple, i) => displayCouple({ couple }, i));

// ---- 1. a real identity is never repainted ---------------------------------------------------------------
{
  // The home squared set, in `makeSquaredSet`'s own array order: couples 3,3,2,2,1,1,4,4.
  const home = engine.makeSquaredSet();
  const real = home.dancers.map((d) => d.couple);
  const drawn = colourBy(real);
  check(real.length === 8 && real.every((c) => c > 0), `1a the engine's squared set really carries 8 home couples (${real.join(',')})`);
  check(drawn.join(',') === real.join(','), `1b a known couple is drawn in its own colour, for all 8 (${drawn.join(',')})`);
  const alwaysNumbered = real.map((_, i) => (Math.floor(i / 2) % 4) + 1);
  check(alwaysNumbered.join(',') !== real.join(','), '1c NEGATIVE CONTROL: numbering by position regardless of identity repaints the squared set, so 1b is a check and not a tautology');
}

// ---- 2. a board of unknown couples is drawn a PAIR per colour --------------------------------------------
{
  const drawn = colourBy([0, 0, 0, 0, 0, 0, 0, 0]);
  check(drawn.join(',') === '1,1,2,2,3,3,4,4', `2a eight unknown couples are drawn as four pairs, in order (${drawn.join(',')})`);
  const perDancer = Array.from({ length: 8 }, (_, i) => (i % 4) + 1);
  check(perDancer.join(',') !== drawn.join(','), '2b NEGATIVE CONTROL: one colour per dancer (i % 4 + 1) is not four pairs, so 2a measures the PAIRING');
  check(drawn.every((c) => c >= 1 && c <= 4), '2c every colour is one the palette holds');
  check(colourBy([0, 0, 0, 0]).join(',') === '1,1,2,2', '2d a four-dancer board is two pairs, so the rule is not written for eight dancers');
}

// ---- 3. the gate is retired, three independent ways -------------------------------------------------------
{
  const gone = !existsSync(path.join(POC_DIR, 'src', 'zero-formations.ts'));
  check(gone, '3a `poc/src/zero-formations.ts` no longer exists - the approved-setup list is deleted, not just unused');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const sources = ['poc/src/sequencer-ui.ts', 'poc/src/browser.ts', 'game/src/render/stage-view.ts'].map(read);
  const named = ['ZERO_FORMATIONS', 'isZeroSetup', 'startIsZeroOrder', 'zeroOrder', 'viewZeroOrder', 'zeroStartFlag'];
  const mentions = sources.flatMap((src, i) => named.filter((n) => src.includes(n)).map((n) => `${i}:${n}`));
  check(mentions.length === 0, `3b no render path names the list or its flag any more (${mentions.length} mention(s))`);
  const threeArgs = sources.flatMap((src) =>
    [...src.matchAll(/displayCouple\(([^()]*)\)/g)]
      .map((m) => m[1])
      .filter((args) => args.split(',').length > 2),
  );
  check(threeArgs.length === 0, `3c every call site passes the two arguments the rule takes - a third is the retired flag (${threeArgs.length} with three)`);
}

// ---- 4. the half-set case, against the engine's own home couples -----------------------------------------
{
  // The written half of a formation authored in square-set order: the SOUTH couple then the EAST couple, and
  // the reader completes it by turning each dancer 180 degrees about the centre. The spots are the engine's
  // own squared set, so the couple each spot really is comes from the engine and not from this probe.
  const home = engine.makeSquaredSet().dancers;
  const byCouple = (c) => home.filter((d) => d.couple === c);
  const half = [1, 2].flatMap((c) => byCouple(c)).map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  const full = completeHalfSet(half);
  const truth = full.map((p) => home.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 1e-9)?.couple ?? 0);
  check(full.length === 8 && truth.every((c) => c > 0), `4a the written half completes to 8 spots the engine's square names (couples ${truth.join(',')})`);
  check(truth.join(',') === '1,1,2,2,3,3,4,4', `4b the antipode of couple 1 is couple 3, and of 2 is 4 (${truth.join(',')})`);
  const drawn = colourBy(full.map(() => 0));
  check(drawn.join(',') === truth.join(','), `4c the rule reproduces the TRUE couples of a zero-order half set (${drawn.join(',')} vs ${truth.join(',')})`);
  const countedFromTheEnd = full.map((_, i) => (Math.floor((i - full.length / 2) / 2) % 4) + 1);
  check(countedFromTheEnd.join(',') !== truth.join(','), '4d NEGATIVE CONTROL: counting the completed half separately from its start gets the antipodal couples wrong');
}

// ---- 5. the size of the change: setups, not names ---------------------------------------------------------
{
  const xml = fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8');
  const formations = engine.parseFormations(xml);
  let anonymous = 0;
  for (const [, ds] of formations) {
    const full = completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    const stamped = engine.assignHomeIdentity(full.map((p) => ({ ...p, angleDeg: p.heading / DEG, path: [] })));
    if (!stamped.every((d) => (d.couple ?? 0) > 0)) anonymous++;
  }
  const identified = formations.size - anonymous;
  check(identified > 0 && identified < formations.size, `5a the engine carries a home identity on only ${identified} of the ${formations.size} formations in formations.xml, so identity alone cannot colour the corpus`);

  // THE POPULATION THE SEQUENCER'S PICKER OFFERS, built the same way `data.ts` hands it over.
  const assets = corpusRoot();
  const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
  const LEVELS = fs.readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const sources = LEVELS.flatMap((level) =>
    filesOf(level).map((file) => {
      const tams = engine.parseCallXml(read(`${level}/${file}`));
      return { file: `${level}/${file.replace(/\.xml$/, '')}`, tams: tams.map((tam, index) => ({ index, tam })) };
    }),
  );
  const rows = buildSetupCatalogue({ formationsXml: xml, files: sources }).rows;
  const identifiable = rows.filter((r) =>
    engine
      .assignHomeIdentity(r.dancers.map((p) => ({ ...p, angleDeg: p.heading / DEG, path: [] })))
      .every((d) => (d.couple ?? 0) > 0),
  );
  check(rows.length > 0, `5b the Board picker offers ${rows.length} setups, the population the colour has to reach`);
  check(identifiable.length < rows.length && identifiable.length >= 1, `5c NEGATIVE CONTROL: only ${identifiable.length} of them are boards the engine can stamp, so a rule that coloured only known couples would leave ${rows.length - identifiable.length} grey`);
  const coloured = rows.filter((r) => r.dancers.every((_, i) => displayCouple({ couple: 0 }, i) > 0));
  check(coloured.length === rows.length, `5d every one of those ${rows.length} setups is drawn a colour (${coloured.length})`);
  console.log(
    `\n${identified} of ${formations.size} formations in formations.xml carry a home identity; ` +
      `${identifiable.length} of the picker's ${rows.length} setups are such a board, and all ${rows.length} are coloured.`,
  );
}

// ---- 6. the render paths ask for what they claim: colour everywhere, numbers on one screen ---------------
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const browser = read('poc/src/browser.ts');
  const sequencer = read('poc/src/sequencer-ui.ts');
  const editor = read('poc/src/editor-ui.ts');
  const game = read('game/src/render/stage-view.ts');
  check(
    /const couples = dancers\.map\(\(d, i\) => displayCouple\(d, i\)\)/.test(browser),
    '6a the browse/edit board colours EVERY board, its beat-0 setup being the one whose array order means anything',
  );
  check(
    /new DancerView\(d, couples\[i\], false, false\)/.test(browser),
    '6b ...and draws NO couple number on it - the fourth argument is `labelled`, and leaving it at its `true` default is the plausible wrong rule',
  );
  check(
    /import \{ displayCouple \} from 'dancing-squared-stage'/.test(browser) &&
      /import \{ displayCouple \} from 'dancing-squared-stage'/.test(sequencer),
    '6c both POC screens take the SHARED rule by package name (the game imports the same), so there is no private copy left behind',
  );
  check(
    /displayCouple\(d, i\)/.test(sequencer) && !/const displayCouple =/.test(sequencer) && !/startIsZeroOrder/.test(sequencer),
    '6d the sequencer colours through that function with no question about the setup\'s name',
  );
  check(
    /displayCouple\(d, i\),\s*!!d\.isGhost,?\s*\)/.test(sequencer),
    '6e ...and KEEPS the couple number (`labelled` left to its default), because "which pair is this" is what a caller reads off that board',
  );
  check(
    /const couple = displayCouple\(d, i\);/.test(game) && /const knownCouple = typeof d\.couple === 'number' && d\.couple > 0/.test(game),
    '6f the game colours through the same rule and labels only a couple the engine stamped',
  );
  check(
    /no home identity \(not a squared set\) — colours follow the list order/.test(editor),
    '6g the editor says the colours are the list order rather than an identity',
  );
  check(!/one colour, because this setup is not a zero formation/.test(editor), '6h ...and no longer says any board is one colour, because none of them is');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
