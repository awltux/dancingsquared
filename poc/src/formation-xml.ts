// THE CALL EDITOR'S `Export <formation>`: the START formation of the call on screen, written as the
// `<formation>` block `assets/formations.xml` is authored in.
//
// WHY A CALL EDITOR EXPORTS A FORMATION AT ALL. Asked for as: "Call editor: When I change the order of the dancer
// list, I'm really changing the formation definition, but there is no way to export a formation from the call
// editor. Add an 'Export <formation>' button." The observation is exact, and it is the FORMAT's rather than a
// quirk of this app: a `<tam>`'s paths are paired with the formation's dancers BY POSITION IN THE LIST
// (`buildCallImpl` pairs `dancers[i]` with `paths[i]`, mirroring a four-dancer formation to eight before it does),
// so the same spots in a different ORDER are a different setup as far as every call that names that formation is
// concerned. `startsFromFormation` is the engine saying the same thing from the other side. The registry is a file
// the browser cannot write, so the editor hands the block over to be pasted - the same local-first,
// export-for-the-corpus shape every other edit in this panel has.
//
// WHAT IS WRITTEN: HALF THE SET, which is how the corpus authors every entry and how the reader reads one - the
// missing dancers are reconstituted at load time by duplicating the written ones and turning them 180 degrees
// about the BOARD CENTRE (`half-set.ts`, and `hasAntipode` in `convert.ts` where the parser decides). The first
// half is the authored one, because that is the order `completeHalfSet` produces and the order the parser then
// pairs paths against. MEASURED over the corpus (`poc/tools/formation-export-probe.mjs`): **281 of the 291**
// formations are authored as half a set, and the half written here reproduces the authored COUNT for all 291 -
// the ten whole ones cannot be halved and are written out in full.
//
// SO THE EXPORT HAS TO SAY WHICH IT DID, because the two are different claims: a block of half the set means the
// reader completes it, and a block of the whole set means it does not. The half is written ONLY when the whole
// set really is that half rotated 180 degrees about the centre - otherwise writing half would silently drop
// dancers, which is a worse trade than a block longer than the corpus's usual one.
//
// THE VERDICT IS THE HALF THAT COSTS NOTHING AND SAVES THE MOST. A block pasted under a name the corpus already
// carries REPLACES that entry (`parseFormationsImpl` `map.set`s by name, so the last one wins), and every call
// naming it then pairs its paths with the wrong dancer. So the export says which of four things it is before the
// caller pastes it:
//
//     add        no corpus formation carries that name, so pasting it adds one
//     same       the corpus's own spots, in the same order - pasting it changes no board
//     reordered  the SAME spots in a DIFFERENT ORDER - the formation was reordered, and pasting it replaces it
//     changed    some spots differ - pasting it replaces the corpus's formation of that name
//
// `reordered` is a separate answer from `changed` because it is the case the caller reported: the spots are all
// there and only their order moved. MEASURED over the corpus: exporting a corpus formation's own resolved poses
// back under its own name is `same` for all 291 entries, and swapping two dancers of a real call's start turns it
// into `reordered` with exactly 2 of 8 spots differing.
//
// PURE, and it takes the corpus lookup as an argument, so a probe can drive every verdict without a browser - the
// same trade `half-set.ts`, `scrub-keep.ts` and `move-nav.ts` make. The block itself is written by the engine's
// `formationToXml`, because the reader and the writer have to agree and that pair is already gated by the
// engine's own round-trip harness (`engine/test/editor.mjs`); this module adds the NAME, the HALF and the VERDICT.

import { formationToXml, normAngle, XML_ROUND_TRIP_TOL } from 'dancing-squared-engine';
import type { FormDancer } from 'dancing-squared-engine';
// THE HALF-SET RULE, imported rather than restated: the reader completes a formation with it, so the writer has
// to find the half it would complete back to this board. THE EXTENSION IS EXPLICIT so bare node can load this
// module (`poc/tools/formation-export-probe.mjs` does), which `allowImportingTsExtensions` allows and
// `fsm-view.ts`'s `./dom.ts` already relies on.
import { completeHalfSet } from './half-set.ts';

/** Which of the four things this block is, if it is pasted into `assets/formations.xml`. */
export type FormationVerdict = 'add' | 'same' | 'reordered' | 'changed';

export interface FormationExport {
  /** The name the block carries, trimmed - `parseFormations` skips a `<formation>` with no `name`. */
  name: string;
  /** The `<formation>` block, ready to paste into `assets/formations.xml`. */
  xml: string;
  verdict: FormationVerdict;
  /** Spots that differ from the corpus formation of the same name, INDEX FOR INDEX - `0` when it does not exist. */
  differing: number;
  /** How many dancers the FORMATION has, i.e. the board the reader will build. */
  count: number;
  /**
   * How many dancers the BLOCK lists. Half of `count` when the board is its own half turned 180 degrees about the
   * centre - the corpus's authoring convention, and what the reader completes - and `count` when it is not.
   */
  written: number;
  /**
   * How many spots the corpus formation of that name has (after the half-set rule), or `null` when it does not
   * exist. IT IS NOT ALWAYS `count`: a six-dancer setup exported under an eight-dancer name is a REPLACEMENT of a
   * different size, and a message saying "8 of 6 spots differ" is a nonsense the panel must not print.
   */
  corpusCount: number | null;
}

/**
 * THE TOLERANCE IS THE XML'S OWN, and it is the ENGINE'S NUMBER rather than a copy of it: the exporter rounds to four
 * decimals, so a formation that has been through the corpus once comes back within about `1e-4`, and a board that has
 * just been dragged comes back at whatever the pointer gave it. An exact comparison would report `changed` for a
 * formation nobody touched.
 *
 * IT USED TO SAY "the same `1e-3` `startsFromFormation` uses" - a copy kept in step by a sentence, which nothing
 * enforces. `XML_ROUND_TRIP_TOL` is that rule's one name (`engine/src/tolerances.ts`), and the shortest-angle step is
 * the engine's `normAngle` too: this module said the engine's normaliser "is private", which was never true (`moves.ts`
 * exports it), and an `atan2` spelling is a DIFFERENT rule at the seam rather than a copy - MEASURED in
 * `engine/test/angle-normalisation.mjs` §2, `atan2(sin, cos)` returns -PI for -PI where `normAngle` returns +PI.
 * The probe still cross-checks the verdict against `startsFromFormation` on real calls, so the two cannot drift.
 */
const TOL = XML_ROUND_TRIP_TOL;

/** Two spots are the same place, facing the same way, holding the same gender. */
function sameSpot(a: FormDancer, b: FormDancer, tol = TOL): boolean {
  if (Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol) return false;
  if (Math.abs(normAngle(a.heading - b.heading)) > tol) return false;
  // A spot with no declared gender (a phantom, or a formation written without one) does not constrain the other
  // side - the same rule `startsFromFormation` applies, and for the same reason: the format lets `gender` default.
  return b.gender === undefined || a.gender === b.gender;
}

/** The same SPOTS, with no respect for their order: every one of `a` can be paired with a distinct one of `b`. */
function sameSpotsIgnoringOrder(a: FormDancer[], b: FormDancer[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Array(b.length).fill(false);
  for (const spot of a) {
    const at = b.findIndex((other, i) => !used[i] && sameSpot(spot, other));
    if (at < 0) return false;
    used[at] = true;
  }
  return true;
}

/**
 * THE DANCERS TO WRITE: the half the reader would complete back to this board, or every dancer when there is no
 * such half.
 *
 * THE HALF IS THE FIRST ONE, because that is the order `completeHalfSet` builds (`written` then `written` turned
 * 180 degrees about the origin) and therefore the order a corpus entry of half a set has - so writing the first
 * half of a board that came from the corpus reproduces the corpus's own block, dancer for dancer.
 *
 * IT IS CHECKED RATHER THAN ASSUMED. `completeHalfSet` returns its input unchanged when the input already
 * contains its own antipodes (two dancers would otherwise stack on one spot), so a set that is whole cannot be
 * halved - and a set that is NOT symmetric about the centre would lose dancers if it were. So the half is used
 * only when completing it gives back this board, index for index; otherwise every dancer is written, which is
 * longer than the corpus's usual block and always true.
 *
 * NOTHING SMALLER THAN TWO DANCERS IS WRITTEN. A two-dancer board IS its own half (one dancer turned 180 degrees
 * about the centre is the other), but `formations.xml`'s smallest entry is two dancers - it has no one-dancer
 * entry at all, and it authors 62 two-dancer ones - so a one-dancer block would be an authoring style nothing
 * else in the file uses. MEASURED: with this floor the written count equals the authored count for all 291
 * entries; without it, two entries ("Opposite Boy", "Opposite Girl") come out at one dancer.
 */
function halfOf(spots: FormDancer[]): FormDancer[] {
  if (spots.length < 4 || spots.length % 2 !== 0) return spots;
  const half = spots.slice(0, spots.length / 2);
  const completed = completeHalfSet(half.map((p) => ({ ...p })));
  if (completed.length !== spots.length) return spots;
  return completed.every((p, i) => sameSpot(p, spots[i])) ? half : spots;
}

/**
 * The `<formation>` block for `spots`, named `name`, with the verdict a paste into `assets/formations.xml` would
 * have - or `null` when there is no name to write.
 *
 * `corpusAt` resolves a name to the poses the ENGINE would build for it (the corpus entry completed to its whole
 * set, or a formation the caller has added to the corpus), or `null`. THE PANEL PASSES THE COMPLETED POSES rather
 * than the authored ones, because the comparison is against the board the parser will produce: `Circle` is
 * authored as four dancers and every call that names it starts from eight.
 */
export function formationExportXml(
  name: string | null | undefined,
  spots: FormDancer[],
  corpusAt: (name: string) => FormDancer[] | null,
): FormationExport | null {
  const trimmed = (name ?? '').trim();
  // A `<formation>` WITH NO NAME IS ONE `parseFormationsImpl` SKIPS (`continue` on a missing attribute), so a
  // block written without one is a block that does nothing. Refused here rather than written as a nameless
  // element; the panel reports the refusal.
  if (!trimmed) return null;
  const written = halfOf(spots);
  const xml = formationToXml(
    trimmed,
    written.map((p) => ({ x: p.x, y: p.y, heading: p.heading, gender: p.gender })),
  );
  const base = { name: trimmed, xml, count: spots.length, written: written.length };
  const corpus = corpusAt(trimmed);
  if (!corpus) return { ...base, verdict: 'add', differing: 0, corpusCount: null };
  let differing = 0;
  for (let i = 0; i < Math.max(spots.length, corpus.length); i++) {
    const a = spots[i];
    const b = corpus[i];
    // A SPOT MISSING FROM EITHER SIDE IS A DIFFERENCE: a set of six is not a set of eight with two matches.
    if (!a || !b || !sameSpot(a, b)) differing++;
  }
  // INDEX FOR INDEX, because that is how a call's paths are paired with a formation's dancers - so the same
  // spots in another order is `reordered` rather than `same`, which is the case this button exists for.
  const verdict: FormationVerdict = differing === 0 ? 'same' : sameSpotsIgnoringOrder(spots, corpus) ? 'reordered' : 'changed';
  return { ...base, verdict, differing, corpusCount: corpus.length };
}
