// ============================================================================================
// WHAT IS A SHAPE OF FOUR DANCERS? - the authoring convention, measured, and pinned.
//
// WHY THIS EXISTS. A `<formation>` or a `<tam>`'s inline formation writes HALF the set: the written
// dancers plus the same dancers turned 180 degrees about the origin (`square-dancing.md` §7.1). A
// shape that is already complete says so with `asymmetric="true"`. So every authored shape carries a
// SET SIZE that is not its written size, and until now nothing in the engine named that - it was
// re-derived geometrically (`hasAntipode` in `convert.ts`: complete the shape unless some pair of its
// dancers already sits 180 degrees apart).
//
// The reference declares it instead. `geometry.dart` gives `SQUARE = 2` and `ASYMMETRIC = 1`,
// `call_context.dart:170-197` instantiates the written dancers `geometryType` times, and
// `dance_model.dart:383` reads `mycall.formation.asymmetric ? 1 : _geometryType`. `tamination.dtd:38`
// declares the attribute on `<tam>`, and `animated_call.dart:162` writes it back.
//
// THE RULE THIS HARNESS PINS is therefore:
//
//     built size  ==  written size  x  symmetry        (symmetry 1 if `asymmetric="true"`, else 2)
//     a built bundle is `symmetry` COPIES of a `written`-dancer UNIT
//
// The second line is the one that answers "how is a two-dancer call written", and it is why the
// written size is a UNIT size rather than merely a count:
//
//   1 written, 1 path   -> 2 copies of a ONE-dancer unit: a facing pair that moves as ONE
//                          (`Step to a Wave` from `Facing Dancers`; the pair is gender-blind, and the
//                          copy carries the written gender, which is why it prints `boy,boy`)
//   2 written, 2 paths  -> 2 copies of a TWO-dancer unit: two copies of a 2-dancer call, each dancer
//                          with its own motion (`Star Thru` from `Facing Couples`; `Turn Thru` from
//                          `Right-Hand Wave`)
//   4 written, 4 paths  -> 2 copies of a FOUR-dancer unit: the whole eight-dancer set, every dancer
//                          with its own motion (`Turn Partner by the Right`)
//
// A two-dancer FORMATION - a shape whose set really is two dancers and whose two dancers may be of
// different genders - is written as a 2-dancer unit with `asymmetric="true"` and so ONE copy. That is
// the only way to give the pair two genders: completing a one-dancer authoring duplicates that dancer
// WITH its gender, which is exactly the `boy,boy` above.
//
// WHAT IS PINNED AND WHY. Only the RULE is asserted as true-or-false; the numbers are shipped-data
// facts pinned as literals, the same way `catalogue.mjs` pins the `actives` census. Every pin here is
// a deliberate edit: a new tam that changes a count fails this harness until someone writes the new
// number down, which is how a silent catalogue drift becomes a reviewed one.
// ============================================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, buildCall, callToXml, parseCallXml, parseFormations, parseMoves, setParser } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const formationsXml = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const formations = parseFormations(formationsXml);
const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
// Parsed ONCE for all 5963 builds below; `buildCall` takes the registry as an argument.
const moves = parseMoves(movesXml);
const seq = new Sequencer(
  movesXml,
  formationsXml,
  callsByTitle(assets),
);

const tally = (values) => [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map()).entries()]
  .sort((a, b) => a[0] - b[0]);

// ---------------------------------------------------------------- the tams, one row each
//
// `written` is the authored size: an inline <formation>'s dancers, or the named formation the tam
// references. 0 means neither resolves, which is a build failure and not a shape at all.
const rows = [];
for (const { xml } of callsByTitle(assets)) {
  let tams;
  try {
    tams = parseCallXml(xml);
  } catch {
    continue; // a file with no tams yet
  }
  for (const tam of tams) {
    const written = tam.dancers.length || (tam.formationAttr ? (formations.get(tam.formationAttr)?.length ?? 0) : 0);
    const symmetry = tam.symmetry;
    let built = null;
    let genders = '';
    let error = null;
    try {
      const b = buildCall(tam, formations, moves, true);
      built = b.dancers.length;
      genders = b.dancers.map((d) => d.gender[0]).join('');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    rows.push({ title: tam.title, from: tam.from, written, symmetry, paths: tam.paths.length, built, genders, error });
  }
}

console.log('== the shipped tams, by authored (written) size ==');
{
  const got = tally(rows.map((r) => r.written));
  const want = [[0, 2], [1, 4], [2, 1063], [3, 19], [4, 4815], [6, 38], [8, 22]];
  check(JSON.stringify(got) === JSON.stringify(want),
    `${rows.length} tams authored at ${got.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) console.log(`        wanted ${JSON.stringify(want)}`);
  // The two that name a formation the corpus does not ship. Named rather than counted, because the
  // count alone cannot tell a fixed one from a newly broken one - `catalogue.mjs` pins the same pair.
  const unresolvable = rows.filter((r) => r.written === 0);
  check(unresolvable.length === 2 && unresolvable.every((r) => r.error !== null),
    'the only tams with no resolvable formation are the two known ones (they fail to build, and say so)');
}

console.log('\n== symmetry: the declared rule is `written x symmetry`, and it is what the build does ==');
{
  const built = rows.filter((r) => r.built !== null);
  const mismatched = rows.filter((r) => r.built !== null && r.built !== r.written * r.symmetry);
  console.log(`  ${built.length} of ${rows.length} tams build; ${built.length - mismatched.length} build at written x symmetry`);
  check(JSON.stringify(tally(built.map((r) => r.built))) === JSON.stringify([[2, 4], [4, 1081], [6, 19], [8, 4798], [12, 38], [16, 21]]),
    `built sizes are ${tally(built.map((r) => r.built)).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  // NO SHIPPED TAM BUILDS AGAINST ITS DECLARATION. There was exactly one until the declaration became
  // the rule: `Allemande Left` from `O Trade By` (ms/allemande.xml) writes all eight dancers and eight
  // paths, and nothing said so, so `mirrorToFull`'s antipode test was what kept it at eight - right by
  // luck. It now declares `asymmetric="true"`, which is what that comment block above the tam records.
  // The list is printed IN FULL so a new disagreement names itself instead of only changing a count.
  check(mismatched.length === 0,
    mismatched.length === 0
      ? 'no shipped tam builds against its declaration'
      : `${mismatched.length} tam(s) build against their declaration: ${mismatched.map((r) => `${r.title} [${r.from}] written ${r.written} x ${r.symmetry} = ${r.written * r.symmetry}, built ${r.built}`).join('; ')}`);
  // The opt-out is rare, which is why the default has to be the convention rather than the attribute.
  const optOut = rows.filter((r) => r.symmetry === 1);
  check(optOut.length === 19 && optOut.every((r) => r.built === r.written),
    `${optOut.length} tams declare asymmetric="true" and every one is taken as written`);
}

console.log('\n== the rule has a DIRECTION: the declaration decides, not the geometry ==');
{
  // A synthetic tam, because the shipped corpus cannot show this: all 19 tams that opt out happen to
  // contain an antipodal pair, so on today's data "taken as written" and "left alone by the antipode
  // test" are indistinguishable. The two shapes below differ ONLY in the attribute, and NEITHER
  // contains an antipode - so geometry alone would complete both to four, and only a rule that reads
  // the declaration can tell them apart. That is the difference between a correct answer and a lucky
  // one, and it is what stops the field from being carried-but-unread.
  const synthetic = (attrs, dancers) =>
    parseCallXml(
      `<tams><tam title="Probe" from="Probe" ${attrs}><formation>` +
        dancers.map((d) => `<dancer gender="${d.gender}" x="${d.x}" y="${d.y}" angle="0"/>`).join('') +
        `</formation>${dancers.map(() => '<path><move select="Extend Left" beats="2"/></path>').join('')}</tam></tams>`,
    )[0];
  const build = (t) => buildCall(t, formations, moves, true).dancers.length;
  const couple = [{ gender: 'boy', x: 1, y: 1 }, { gender: 'girl', x: 1, y: -1 }];
  const antipodal = [{ gender: 'boy', x: 1, y: 1 }, { gender: 'girl', x: -1, y: -1 }];
  check(build(synthetic('asymmetric="true"', couple)) === 2,
    'a 2-dancer unit declaring asymmetric="true" is taken as written (2)');
  check(build(synthetic('', couple)) === 4,
    'the SAME unit without it completes to 4 - so the declaration is what decided, not the geometry');
  // AND THE TOLERANCE IS STILL THERE, deliberately: a shape that declares nothing but already contains
  // its own 180-degree partners is a whole set whose attribute was forgotten, and leaving it alone
  // beats doubling it. This is why `mirrorToFull` keeps its antipode test under the declared rule.
  check(build(synthetic('', antipodal)) === 2,
    'a shape declaring nothing that already contains antipodes is left alone (the forgotten-attribute tolerance)');
  // AND THE DECLARATION SURVIVES THE EXPORT, which is where it earns its keep: `callToXml` writes every
  // dancer out explicitly, so its output is a whole set and must say so. Without the attribute a
  // written-out set with no antipodal pair came back DOUBLED - and the reader that doubled it is the
  // SEQUENCER's registration path (`loadVariants` passes `mirror: true`), not the editor's, so the
  // `mirror: false` that `rebuildInstance` passes covered only half of them. The pair below is the
  // witness: read back both ways, the same size either way.
  const whole = synthetic('asymmetric="true"', [
    { gender: 'boy', x: 1, y: 3 }, { gender: 'girl', x: 1, y: 1 },
    { gender: 'girl', x: 3, y: 3 }, { gender: 'boy', x: 3, y: 1 },
    { gender: 'boy', x: -3, y: 3 }, { gender: 'girl', x: -3, y: 1 },
    { gender: 'girl', x: -1, y: 3 }, { gender: 'boy', x: -1, y: 1 },
  ]);
  const bundle = buildCall(whole, formations, moves, true);
  const exported = callToXml(bundle, 'Probe');
  const reread = parseCallXml(exported)[0];
  check(/asymmetric="true"/.test(exported), 'callToXml declares the whole set it wrote out');
  check(bundle.dancers.length === 8 && buildCall(reread, formations, moves, true).dancers.length === 8,
    `an exported whole set with no antipodal pair re-reads at 8 either way (was 16 through the registration path)`);
}

console.log('\n== the authoring idiom: ONE PATH PER WRITTEN DANCER, and the completion duplicates it ==');
{
  // THE PATH COUNT IS RELATIVE TO THE WRITTEN SIZE, NOT THE BUILT ONE, and getting that wrong is easy
  // because the completion hides it: a written-4 tam with 4 paths builds as 8 dancers with 4 distinct
  // paths, so `paths * 2 == built` is true while the authoring is one path per written dancer. The
  // three relations `buildCallImpl` distinguishes are therefore classified against `written`:
  //
  //   per-dancer  paths == written       each written dancer has its own motion, and the completion
  //                                      gives its mirror the same motion.
  //   per-pair    paths * 2 == written   the written list is a set of PAIRS and each pair moves as one.
  //   full-set    paths == written * 2   a path per COMPLETED dancer against a half-written shape -
  //                                      `convert.ts` places the duplicate half before pairing.
  //
  // MEASURED: the shipped corpus uses the FIRST of these and nothing else. Both other branches are
  // real code with real callers - an editor-authored call is full-set, which is what `full-set` is for
  // (`convert.ts`'s note on `formation="Circle"` carrying eight paths against a four-dancer shape) -
  // but NO shipped tam reaches them, so a change to either cannot be validated from the catalogue and
  // has to be gated from `editor.mjs`'s round-trips instead. That is worth stating rather than
  // assuming: it is the difference between "the corpus covers this" and "only the editor does".
  const relation = (r) =>
    r.paths === r.written ? 'per-dancer'
    : r.paths * 2 === r.written ? 'per-pair'
    : r.paths === r.written * 2 ? 'full-set'
    : 'other';
  const built = rows.filter((r) => r.built !== null);
  const kinds = tally(built.map(relation));
  console.log(`  authored: ${built.filter((r) => relation(r) === 'per-dancer').length} per-dancer, ` +
    `${built.filter((r) => relation(r) === 'per-pair').length} per-pair, ` +
    `${built.filter((r) => relation(r) === 'full-set').length} full-set, ` +
    `${built.filter((r) => relation(r) === 'other').length} unclassified`);
  check(kinds.length === 1 && kinds[0][0] === 'per-dancer',
    `every built tam authors one path per written dancer (${kinds.map(([k, v]) => `${k}:${v}`).join(' ')})`);
  check(built.every((r) => r.paths === r.written),
    'so no shipped tam reaches the per-pair or full-set pairing branch');
  // A ONE-DANCER WRITTEN UNIT IS ONE PATH FOR TWO DANCERS, because the completion reuses it: the pair
  // moves as one and the copy carries the written dancer's gender. Measured over the four shipped tams
  // that do it, and it is why a two-dancer shape with TWO GENDERS needs `asymmetric="true"` with both
  // dancers written - completing a lone dancer can only ever produce two of the same.
  const oneWritten = rows.filter((r) => r.written === 1);
  check(oneWritten.length === 4 && oneWritten.every((r) => r.built === 2 && r.genders[0] === r.genders[1]),
    `the 4 one-dancer authorings all build as a SAME-GENDER pair (${[...new Set(oneWritten.map((r) => r.genders))].join(', ')})`);
  // The two-dancer idiom, which is what a 2-dancer call IS here: two written dancers with their own
  // motions, completed to two copies. Counted, because it is the largest authoring family after the
  // whole-set ones and its size is what makes "a 2-dancer call on an 8-dancer board" mean four copies.
  const twoWritten = rows.filter((r) => r.written === 2 && r.built === 4 && r.paths === 2);
  check(twoWritten.length === 1063,
    `${twoWritten.length} tams are authored as a 2-dancer unit with one path per dancer, completing to two copies`);
}

console.log('\n== what the formation registry holds: only the shapes whose declared set is eight ==');
{
  const named = seq.library.getNamedFormations();
  const unique = seq.library.getUniqueFormations();
  check(named.every((f) => f.dancers.length === 8) && named.length === 210,
    `namedFormations is ${named.length} entries and every one is 8 dancers`);
  check(unique.every((f) => f.dancers.length === 8) && unique.length === 134,
    `uniqueFormations is ${unique.length} entries and every one is 8 dancers`);
  // `formations.xml` cannot declare symmetry - `tamination.dtd`'s <formation> takes `name` only - so
  // every entry there is a half by construction, and its declared set is written x 2.
  const authored = [...formations.entries()].map(([name, ds]) => ({ name, written: ds.length, setSize: ds.length * 2 }));
  check(JSON.stringify(tally(authored.map((f) => f.written))) === JSON.stringify([[2, 51], [3, 1], [4, 210], [6, 11]]),
    `formations.xml authors ${authored.length} shapes at ${tally(authored.map((f) => f.written)).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  // A SHAPE WHOSE DECLARED SET IS NOT EIGHT IS DROPPED - it is neither a whole set nor, as a lookup
  // target, a sub-formation of one. 63 of them, and the reason the 2-dancer family is unreachable as
  // a NAME. `Facing Couples` is the one to watch: it is a 2-written shape declaring a FOUR-dancer set
  // of two facing couples, which is what `Star Thru` is authored against, and it is not in the
  // library. Naming the total AND a witness keeps a fix from being invisible and a regression from
  // being a bare number.
  const dropped = authored.filter((f) => f.setSize !== 8);
  check(dropped.length === 63,
    `${dropped.length} of ${authored.length} declared shapes are not an 8-dancer set and are absent from the library`);
  // NAMED, not merely counted, and with a present witness for contrast: a total alone cannot tell a
  // fixed entry from a newly broken one, and a bare "63" cannot tell which shapes a fix would add.
  // `Facing Couples` is the one to watch - a 2-written shape declaring a FOUR-dancer set of two facing
  // couples, which is the formation `Star Thru` is authored against by NAME, and it is not in the
  // library. Its COMPACT spelling is a different entry (also 2-written, also absent).
  const names = new Set(named.map((f) => f.name));
  const witnesses = ['Facing Couples', 'Facing Couples Compact', 'Facing Dancers'];
  check(witnesses.every((n) => !names.has(n)) && names.has('Eight Chain Thru') && names.has('Static Square'),
    `the drops are absent by name (${witnesses.filter((n) => !names.has(n)).join(', ')}), and whole-set shapes are present`);
}

console.log('\n== a TWO-DANCER pair: written with both dancers, applied to every copy ==');
{
  // THE CASE THAT MOTIVATED THE FIELD. A call between two dancers - a partner arm turn, a step to a
  // wave between facing dancers - needs a shape whose set really is two dancers, and the two dancers
  // may differ in gender. The ONE-DANCER authoring cannot express that: the completed copy carries the
  // written dancer's gender, so a lone `boy` becomes a pair of boys (measured above). Writing BOTH
  // dancers and declaring `asymmetric="true"` is the way to say it.
  //
  // AND IT IS NOT MERELY EXPRESSIBLE - it is APPLICABLE, which is the part worth pinning, because the
  // reading is the whole question: a 2-dancer shape never matches a whole 8-dancer board (the matcher
  // rejects a subset mapping for a whole-board apply by construction), so the only route is the
  // PARALLEL one - the board is tiled into 2-dancer boxes and the pair call runs in every box. This
  // measures that, and measures the refusal that makes it mean something.
  const pairXml =
    `<calls><tam title="Probe Pair" from="Facing Dancers" asymmetric="true"><formation>` +
    `<dancer gender="boy" x="-1" y="0" angle="0"/>` +
    `<dancer gender="girl" x="1" y="0" angle="180"/>` +
    `</formation><path><move select="Extend Left" beats="2"/></path><path><move select="Extend Left" beats="2"/></path>` +
    `</tam></calls>`;
  seq.register('Probe Pair', pairXml);
  const variants = seq.getVariants('Probe Pair') ?? [];
  check(variants.length === 1 && variants[0].dancers.length === 2 && variants[0].symmetry === 1,
    `the pair is held at TWO dancers with its own symmetry, not completed (${variants.map((v) => `${v.dancers.length}d symmetry=${v.symmetry}`).join(', ')})`);
  check(variants[0]?.dancers.map((d) => d.gender[0]).join('') === 'bg',
    `and BOTH genders survive, which is what the one-dancer authoring cannot do (${variants[0]?.dancers.map((d) => d.gender[0]).join('')})`);
  // A board of four facing pairs. `Eight Chain Thru` is exactly that: every dancer faces a dancer of
  // the adjacent couple, 2 apart.
  const boxes = seq.boardForSetup('Eight Chain Thru');
  const before = new Map(boxes.dancers.map((d) => [d.id, `${d.x.toFixed(2)},${d.y.toFixed(2)}`]));
  const applied = seq.applyToBoard(boxes, 'Probe Pair');
  const moved = applied.legal
    ? applied.board.dancers.filter((d) => before.get(d.id) !== `${d.x.toFixed(2)},${d.y.toFixed(2)}`).length
    : 0;
  check(applied.legal && applied.board.dancers.length === 8 && moved === 8,
    `applied to a four-facing-pair board it runs in FOUR copies, moving all eight dancers (legal=${applied.legal}, moved=${moved}/8)`);
  // THE NEGATIVE CONTROL, without which the check above would pass for a call that force-fits anything.
  // A squared set has no two facing dancers 2 apart - each dancer faces its corner, six units away - so
  // there is no pair to tile and the call must be refused rather than applied to a made-up grouping.
  const square = seq.boardForSetup('Static Square');
  const refused = seq.applyToBoard(square, 'Probe Pair');
  check(!refused.legal,
    `and a board with no such pair is REFUSED rather than force-fitted (${refused.reason})`);
}

console.log(`\nshape-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
