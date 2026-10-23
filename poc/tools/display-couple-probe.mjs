// THE COLOUR A BOARD WITH NO HOME IDENTITY IS DRAWN IN, THE LIST OF SETUPS THAT ENABLES IT, AND THE THREE
// VIEWS THAT MUST AGREE.
//
// Reported: "How can I get the dancer colour coding to appear for the formations in the zero setup? it appears
// to be something related to this text in the ui 'no home identity (not a squared set)' ... e.g. zero lines,
// zero colums etc", and then the shape of the answer: "it would be nice if there was an array of
// formations/arrangement titles that are deemed zeros. and this enabled colour displays ... But only when they
// are the first formation in a sequence or in the call editor".
//
// THE DIAGNOSIS IN THE REPORT IS EXACT. `assignHomeIdentity` stamps `couple` by matching the start formation to
// the home square, so MEASURED, **6 of the 291** formations in `assets/formations.xml` carry one; the other 285
// come back `UNKNOWN_COUPLE` and `coupleColor(0)` draws every dancer the same grey. Worse, the two views
// disagreed: the sequencer has had a display-only fallback for years, while the browse/edit board
// (`browser.ts`, which is what the Call editor previews through) passed `d.couple ?? 0` straight to the avatar -
// the SAME board coloured in one panel and grey in the other.
//
// SO THE FALLBACK IS PAIR BY PAIR AND ONLY WHERE THE PAIRING IS A DECISION: `displayCouple` recolours an
// anonymous dancer by `floor(index / 2) + 1`, and only when the setup's name is in `ZERO_FORMATIONS`. The list
// is not derivable - four identities share one set of spots, which is `PLAN.md` §3's canonical-identity
// problem - so it is written down, one name per line, and this probe measures it against the corpus.
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. a real home couple is passed through untouched, so the fallback cannot repaint a squared set (the
//      plausible wrong rule: always number by position, red here for 8 of 8 dancers);
//   2. an enabled anonymous board gets 1,1,2,2,3,3,4,4 - a PAIR per colour, not one colour per dancer (red
//      for `(i % 4) + 1` at 6 of 8) and not one grey;
//   3. DISABLED MEANS GREY: a board whose setup is not in the list keeps couple 0, which is the whole of the
//      "only where it is a decision" requirement - the plausible wrong rule here is enabling on any anonymous
//      board, which is red for 8 of 8;
//   4. THE HALF-SET CASE, where the rule earns its keep: a half-set formation is completed by turning the
//      written dancers 180 degrees about the centre, so written `1,2` completes to `1,2,3,4` and the fallback
//      reproduces the TRUE home couples - measured against the engine's own squared set, not a restatement;
//   5. each consecutive pair in a listed formation's own order is ONE BOY AND ONE GIRL, and the formation
//      completes to an even number of dancers, so a name cannot be listed for a setup whose colours would pair
//      two boys;
//   6. every listed name is a formation the corpus carries (a typo is otherwise a silent no-op) and one the
//      engine cannot identify (a listed squared set would be dead weight, and its order is not zero order);
//   7. three render paths ask the question - the browse/edit board through `browser.ts`, the sequencer through
//      `startIsZeroOrder`, the editor's own line of words - and each imports the list rather than restating it.
//
// Run: node tools/display-couple-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');

const { displayCouple } = await import(pathToFileURL(path.join(ROOT, 'packages', 'stage', 'display-couple.ts')).href);
const { completeHalfSet } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);
const { ZERO_FORMATIONS, isZeroSetup } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'zero-formations.ts')).href);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);

let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/** `displayCouple` over a list of couples, in board order: the whole of what the render path does. */
const colourBy = (couples, enabled) => couples.map((couple, i) => displayCouple({ couple }, i, enabled));

// ---- 1. a real identity is never repainted ---------------------------------------------------------------
{
  // The home squared set, in `makeSquaredSet`'s own array order: couples 3,3,2,2,1,1,4,4.
  const home = engine.makeSquaredSet();
  const real = home.dancers.map((d) => d.couple);
  const drawn = colourBy(real, true);
  check(real.length === 8 && real.every((c) => c > 0), `1a the engine's squared set really carries 8 home couples (${real.join(',')})`);
  check(drawn.join(',') === real.join(','), `1b a known couple is drawn in its own colour, for all 8 (${drawn.join(',')})`);
  const alwaysNumbered = real.map((_, i) => (Math.floor(i / 2) % 4) + 1);
  check(alwaysNumbered.join(',') !== real.join(','), '1c NEGATIVE CONTROL: numbering by position regardless of identity repaints the squared set, so 1b is a check and not a tautology');
}

// ---- 2. an enabled anonymous board is drawn a PAIR per colour ---------------------------------------------
{
  const drawn = colourBy([0, 0, 0, 0, 0, 0, 0, 0], true);
  check(drawn.join(',') === '1,1,2,2,3,3,4,4', `2a eight unknown couples are drawn as four pairs, in order (${drawn.join(',')})`);
  const perDancer = Array.from({ length: 8 }, (_, i) => (i % 4) + 1);
  check(perDancer.join(',') !== drawn.join(','), '2b NEGATIVE CONTROL: one colour per dancer (i % 4 + 1) is not four pairs, so 2a measures the PAIRING');
  check(drawn.every((c) => c >= 1 && c <= 4), '2c every colour is one the palette holds');
}

// ---- 3. an anonymous board whose setup is not listed keeps ONE grey ---------------------------------------
{
  const drawn = colourBy([0, 0, 0, 0, 0, 0, 0, 0], false);
  check(drawn.every((c) => c === 0), `3a a setup that is not a zero formation is drawn with no couple colour (${drawn.join(',')})`);
  const enableOnAny = colourBy([0, 0, 0, 0, 0, 0, 0, 0], true);
  check(enableOnAny.join(',') !== drawn.join(','), '3b NEGATIVE CONTROL: enabling on every anonymous board is not the same board, so 3a measures the LIST and not the absence of identity');
}

// ---- 4. the half-set case, against the engine's own home couples ------------------------------------------
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
  const drawn = colourBy(full.map(() => 0), true);
  check(drawn.join(',') === truth.join(','), `4c the fallback reproduces the TRUE couples of a zero-order half set (${drawn.join(',')} vs ${truth.join(',')})`);
  const countedFromTheEnd = full.map((_, i) => (Math.floor((i - full.length / 2) / 2) % 4) + 1);
  check(countedFromTheEnd.join(',') !== truth.join(','), '4d NEGATIVE CONTROL: counting the completed half separately from its start gets the antipodal couples wrong');
}

// ---- 5 & 6. the list, measured against the corpus --------------------------------------------------------
{
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const formations = engine.parseFormations(fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8'));
  const DEG = Math.PI / 180;
  const missing = ZERO_FORMATIONS.filter((z) => ![...formations.keys()].some((n) => n.toLowerCase() === z.toLowerCase()));
  check(ZERO_FORMATIONS.length > 0 && missing.length === 0, `5a every listed name is a formation formations.xml carries (${ZERO_FORMATIONS.length} listed${missing.length ? `, missing: ${missing.join(', ')}` : ''})`);
  const dupes = ZERO_FORMATIONS.filter((z, i) => ZERO_FORMATIONS.findIndex((o) => o.toLowerCase() === z.toLowerCase()) !== i);
  check(dupes.length === 0, `5b no name is listed twice${dupes.length ? ` (${dupes.join(', ')})` : ''}`);

  const bad = [];
  const identified = [];
  let pairsChecked = 0;
  for (const z of ZERO_FORMATIONS) {
    const name = [...formations.keys()].find((n) => n.toLowerCase() === z.toLowerCase());
    if (!name) continue;
    const full = completeHalfSet(formations.get(name).map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    const stamped = engine.assignHomeIdentity(full.map((p) => ({ ...p, angleDeg: p.heading / DEG, path: [] })));
    if (stamped.every((d) => (d.couple ?? 0) > 0)) identified.push(name);
    if (full.length % 2 !== 0) {
      bad.push(`${name} completes to ${full.length}`);
      continue;
    }
    for (let i = 0; i < full.length; i += 2) {
      pairsChecked++;
      if (full[i].gender === full[i + 1].gender) bad.push(`${name} pair ${i / 2} is ${full[i].gender}/${full[i + 1].gender}`);
    }
  }
  check(bad.length === 0, `5c every listed formation completes to an even set whose consecutive pairs are one boy and one girl (${pairsChecked} pairs)${bad.length ? ` - ${bad.slice(0, 4).join('; ')}` : ''}`);
  check(identified.length === 0, `6a no listed formation is one the engine can already identify (dead weight: ${identified.join(', ') || 'none'})`);

  // The corpus figure the report is about, so the size of the gap is on the record rather than in a story.
  let anonymous = 0;
  for (const [, ds] of formations) {
    const full = completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: (d.angleDeg * Math.PI) / 180, gender: d.gender })));
    const stamped = engine.assignHomeIdentity(full.map((p) => ({ ...p, angleDeg: (p.heading * 180) / Math.PI, path: [] })));
    if (!stamped.every((d) => (d.couple ?? 0) > 0)) anonymous++;
  }
  console.log(
    `\n${formations.size - anonymous} of ${formations.size} formations in formations.xml carry a home identity; ` +
      `${ZERO_FORMATIONS.length} of the other ${anonymous} are listed as zero order.`,
  );
}

// ---- 7. the three render paths ask the question, in one place --------------------------------------------
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const browser = read('poc/src/browser.ts');
  const sequencer = read('poc/src/sequencer-ui.ts');
  const editor = read('poc/src/editor-ui.ts');
  check(/const zeroOrder = isZeroSetup\(call\.formation, call\.from\)/.test(browser), '7a the browse/edit board decides from the call\'s own setup names');
  check(/new DancerView\(d, displayCouple\(d, i, zeroOrder\)\)/.test(browser), '7b ...and builds its avatar (and marker) through `displayCouple`');
  check(!/d\.couple \?\? 0/.test(browser), '7c the grey-avatar shape (`d.couple ?? 0`) is gone from the browse/edit board');
  check(/import \{ displayCouple \} from 'dancing-squared-stage'/.test(browser) && /import \{ isZeroSetup \} from '\.\/zero-formations'/.test(browser), '7d ...imported from the SHARED stage package (the game imports the same rule), not restated');
  check(/this\.zeroStartFlag = isZeroSetup\(this\.seq\.knownFormation\(start\)\)/.test(sequencer), '7e the sequencer decides from its START board, not the board under the playhead');
  check(/displayCouple\(d, i, zeroOrder\)/.test(sequencer) && !/const displayCouple =/.test(sequencer), '7f ...and draws through the same function, with no private copy left behind');
  check(/isZeroSetup\(call\.formation, call\.from\)/.test(editor), '7g the editor says which of the two kinds of board it is showing');
  check(/no home identity \(not a squared set\)/.test(editor), '7h ...in the same line the report quoted, rather than somewhere else');
}

// ---- 8. the matcher's own answer for a named setup, on a zero formation and on one that is not -----------
{
  const DEG = Math.PI / 180;
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const xml = fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8');
  const formations = engine.parseFormations(xml);
  const named = (n) => completeHalfSet(formations.get(n).map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
  // `isZeroSetup` takes the NAMES a call carries, so what matters is that it answers YES for the two spellings
  // a real setup arrives in (the `formation` attribute and the `from` label) and NO for anything else.
  check(isZeroSetup('Circle') && isZeroSetup('circle ') && !isZeroSetup('Circle Left'), '8a the list matches the setup name, trimmed and case-insensitively, and not a call title');
  check(isZeroSetup(null, undefined, '', 'Normal Lines Compact'), '8b a call with the name in its second slot is still a zero setup');
  check(!isZeroSetup(null, undefined, ''), '8c no name at all is not a zero setup');
  check(named('Circle').length === 8, '8d the corpus\'s Circle completes to eight dancers');
}

// ---- 9. which formations are candidates, measured the way the list was seeded -----------------------------
//
// NOT a check, and that is deliberate: whether a pair of dancers IS a couple cannot be read off their geometry
// (four identities share one set of spots - `PLAN.md` §3), so this is the narrower question the list was built
// from - partners standing side by side facing the SAME way, the pairs going south, east, north, west - and it
// prints the answer so adding a name is a measurement rather than a guess. `Circle` is the exception that shows
// why this cannot be the gate: its partners toe in towards the ring's centre by 45 degrees, so it fails the
// facings test while being in square-set order, and it is listed because the reorder process and
// `engine/test/formation-order.mjs` - not this geometric test - are what justify a name in `ZERO_FORMATIONS`.
{
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const formations = engine.parseFormations(fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8'));
  const DEG = Math.PI / 180;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const passes = (dancers) => {
    if (dancers.length < 4 || dancers.length % 2 !== 0) return false;
    const pairs = [];
    for (let i = 0; i < dancers.length; i += 2) {
      const a = dancers[i];
      const b = dancers[i + 1];
      if (a.gender === b.gender) return false;
      if (Math.abs(norm(a.heading - b.heading)) > 1e-6) return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const along = Math.abs(dx * Math.cos(a.heading) + dy * Math.sin(a.heading));
      const across = Math.abs(-dx * Math.sin(a.heading) + dy * Math.cos(a.heading));
      if (along > 0.1 || Math.abs(across - 2) > 0.6) return false;
      pairs.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const cx = dancers.reduce((s, d) => s + d.x, 0) / dancers.length;
    const cy = dancers.reduce((s, d) => s + d.y, 0) / dancers.length;
    const angles = pairs.map((p) => Math.atan2(p.y - cy, p.x - cx));
    return angles.every((a, i) => i === 0 || norm(a - angles[i - 1]) > 0);
  };
  const candidates = [];
  for (const [name, ds] of formations) {
    const full = completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (passes(full)) candidates.push(name);
  }
  const unlisted = candidates.filter((n) => !isZeroSetup(n));
  console.log(
    `\n${candidates.length} formations are authored with partners side by side facing the same way, ` +
      `going south, east, north, west; ${unlisted.length} of them are not in ZERO_FORMATIONS` +
      `${unlisted.length ? ` (${unlisted.join(', ')})` : ''}.`,
  );
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
