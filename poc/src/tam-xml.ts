// How a created or edited call is written as `<tam>` XML: the ONE place that decides whether the start
// formation is EMBEDDED or NAMED.
//
// THE CORPUS'S OWN TAMS NAME IT. `<tam title="Circle Four Left 1/4" from="Facing Couples"
// formation="Facing Couples">` carries `formation="Name"` and no geometry, and `buildCallImpl` resolves
// that against the formation registry ("inline wins over named attribute"). Every tam the editor wrote
// embedded a `<formation>` block instead, and for a created call that is not a style question: the
// caller's whole point in labelling a formation from a call's end is that OTHER calls start from it, and
// an embedded copy means the shape exists once per call, so editing the formation does not reach them and
// the same eight dancers are repeated in every file.
//
// THE REFERENCE IS ONLY SAFE WHEN IT DESCRIBES THE CALL, which is two questions:
//
//   1. does the name RESOLVE? Only the corpus and the formations the caller has ADDED TO THE CORPUS
//      (`UserFormation.inCorpus`) are written anywhere but this browser's local store, and a reference to
//      one of those is a call that fails to load elsewhere - so those are the only names considered.
//   2. is the call's start REALLY that formation? `startsFromFormation` compares the eight poses INDEX
//      FOR INDEX, because a tam's paths are paired with the formation's dancers by position; a call whose
//      dancers merely occupy the same SPOTS in another order is a reference to somebody else's paths.
//
// Anything else embeds the block, which is what every export did until now and is always correct.

import formationsXmlText from '@corpus/formations.xml?raw';
import { DEG, callToXmlNamed, canonicalName, completedFormation, parseFormations } from 'dancing-squared-engine';
import type { CallBundle, FormDancer, Gender, Symmetry } from 'dancing-squared-engine';
import { findUserFormation } from './formations';

/** The corpus's own formations, parsed once. Keyed by name, holding the AUTHORED dancers in degrees. */
let corpusFormations: Map<string, { x: number; y: number; angleDeg: number; gender?: Gender }[]> | null = null;

function corpusOf(name: string): { x: number; y: number; angleDeg: number; gender?: Gender }[] | null {
  corpusFormations ??= parseFormations(formationsXmlText);
  // Canonical names on BOTH sides, the same way the library compares them: naming a shape "Squared Set"
  // registers as "Static Square", and a direct map lookup would miss it.
  const key = canonicalName(name);
  for (const [n, ds] of corpusFormations) if (canonicalName(n) === key) return ds;
  return null;
}

/**
 * The poses a `formation="Name"` reference resolves to, or null when the corpus does not carry that name.
 *
 * COMPLETED BY THE CORPUS'S OWN HALF-SET RULE at whatever size the corpus authored, because that is what
 * `buildCallImpl` does before pairing paths: the comparison has to be against the shape the parser will
 * actually build, and the parser completes a written shape by rotating it 180 degrees about the origin
 * whenever it is not already whole.
 *
 * IT USED TO COMPLETE ONLY THE 4-DANCER CASE - four was mirrored to eight and every other size was left as
 * authored. MEASURED: `Facing Couples Far`, the setup `ms/promenade.xml`'s `Promenade Full to Home` names,
 * is authored as TWO dancers, so the comparison was four built dancers against two posed ones and
 * `startsFromFormation` refused on the size mismatch however exactly the shapes agreed. Every call starting
 * from a two-dancer formation was therefore exported with its `<formation>` block written out - which is
 * what "the export has no `formation` property" looks like from the editor.
 *
 * THAT SENTENCE USED TO BE FALSE AND THE REFERENCE IT JUSTIFIED WAS UNREADABLE. `buildCallImpl` paired paths
 * against the AUTHORED four and mirrored later, so a four-dancer formation carrying eight paths threw "Path
 * count mismatch ... 8 paths vs 4 dancers" - and since `Circle` authors four, a `Circle Left` whose whole call
 * had been laid on a circle could be written but not read back. The comparison here was always right; the
 * parser was the half that disagreed, and `convert.ts` now places the mirrored half BEFORE pairing. A gate on
 * the TEXT of an export cannot see this, which is why `engine/test/editor.mjs` 27 round-trips one instead.
 */
export function corpusFormationPoses(name: string): FormDancer[] | null {
  const authored = corpusOf(name);
  if (authored) {
    const asPoses = authored.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
    return completedFormation(asPoses);
  }
  // A USER FORMATION ONLY COUNTS ONCE THE CALLER HAS ADDED IT TO THE CORPUS - see the note above: a
  // reference to a shape that lives in one browser's storage is a call nobody else can load.
  const stored = findUserFormation(name);
  if (stored?.inCorpus) return stored.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  return null;
}

// The half-set rule is the ENGINE's `completedFormation` (`formation-order.ts`), imported rather than restated -
// the POC used to keep its own copy in `half-set.ts` so that a probe could import it, which is what the engine's
// version makes unnecessary. This module itself cannot be imported by anything but the bundler (it pulls
// `formations.xml?raw`), which is why the rule may not live here.

/**
 * EVERY NAMED FORMATION THE CORPUS CAN STAND UP AT A GIVEN SIZE, as start poses.
 *
 * WHY THIS EXISTS RATHER THAN THE LIBRARY. The editor's Start and End pickers were filled from the
 * sequencer's formation library, which is EIGHT dancers only (`listFormations()` is 134 names and
 * `toWholeSet` completes a four-written shape to eight). MEASURED: **212 of the catalogue's 547 calls
 * have four dancers**, and their `from` names - "Facing Couples", "Right-Hand Box", "Right-Hand Wave" -
 * are exactly the corpus's TWO-written entries. So a four-dancer call was offered a list of eight-dancer
 * formations, every one of which `setStartFormation` refuses and `doEndFormation` refuses out loud: the
 * picker could not express the call's own start.
 *
 * The library is NOT widened to cover this. Its 134 names and their all-eight invariant are pinned by
 * `engine/test/shape-census.mjs` and walked by four engine harnesses and several probes, so doubling the
 * two-written shapes there is an engine-wide behaviour change with a blast radius far beyond a picker's
 * contents. This reads the same file the library does and applies the same rule, at the sizes the
 * library cannot reach.
 *
 * NOT GEOMETRICALLY DEDUPED THE WAY THE LIBRARY'S NAMES ARE, and this is the one difference worth
 * knowing: the library collapses shapes that are equal up to rotation and reflection because the
 * SEQUENCER matches boards by geometry, whereas a caller choosing a start is choosing a NAME the corpus
 * uses. Every name here is one a call in the catalogue actually starts from.
 *
 * AN ARRANGEMENT IS WHERE THE DANCERS STAND, WHICH WAY THEY FACE, AND THEIR GENDERS, and this dedupes on
 * all three AT THE SAME SPOT. The library's key is geometry up to congruence (see `CallLibrary`'s
 * constructor), and that is right for matching a board - a board is recognised by its shape. It is NOT
 * right for this picker, and the consequence was reported as "I need to see Arrangements, not
 * Formations". MEASURED on the corpus's own columns, from the AUTHORED four (each completing to eight by
 * the half-set rule):
 *
 *     Columns         (-3,-1)@180 girl  (-1,-1)@180 boy  ( 1,-1)@180 girl  (3,-1)@180 boy
 *     Column RH GBGB  the same four, spot for spot, including both genders
 *     Columns LH      the same positions              @0, i.e. the 180-degree ROTATION
 *     Column LH GBGB  the same positions @0 with the genders swapped
 *
 * `Columns` and `Column RH GBGB` are the same arrangement twice under two names and get one row.
 * `Columns LH` is NOT - it is every dancer at the antipode of the spot, facing the opposite way - and
 * neither is `Column LH GBGB`.
 *
 * WHY CONGRUENCE IS THE WRONG KEY HERE, MEASURED against `matchFormations(..., 0.5)`: it reports
 * `reflect: true` and a `rotation` of NaN on these half-set boards, and it accepts a reflection as a
 * match. Keying on it therefore ruled `Columns` and `Columns LH` the SAME arrangement, and did the same
 * to `Star LH`/`Star Facing`, `Wave RH`/`Wave LH`, `Box RH`/`Box LH Girls Lead`, the four
 * `Tidal 3 and 1 Line #5-#8` (the corpus's own 180-degree rotations of `#1-#4`) and `Promenade 2`
 * against `Promenade`. MEASURED counts over `formations.xml`: the congruence key keeps 176 of the 211
 * eight-dancer names and 38 of 51 at four; the positional key below keeps 201 and 48. A caller choosing
 * a start is choosing a board, and a reflected or rotated board is a different board.
 *
 * CANONICAL NAME STILL COLLAPSES SPELLINGS. `canonicalName` folds a synonym ("Squared Set" vs "Static
 * Square"), which is a spelling rather than a second arrangement, so only the first spelling of a given
 * arrangement is listed. Two names that agree in positions, headings AND genders are the SAME board and
 * get one row, deliberately: the picker offers arrangements, and a caller picking one does not want the
 * same board twice under two labels.
 */
export function corpusFormationsOfSize(dancers: number): { name: string; poses: FormDancer[] }[] {
  corpusFormations ??= parseFormations(formationsXmlText);
  const out: { name: string; poses: FormDancer[] }[] = [];
  for (const [name, ds] of corpusFormations) {
    const poses = completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length !== dancers) continue;
    out.push({ name, poses });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  // First spelling wins, in NAME order so the representative does not depend on file order.
  const kept: { name: string; poses: FormDancer[] }[] = [];
  for (const f of out) {
    const dup = kept.find((k) => sameArrangement(k.poses, f.poses));
    if (dup) continue;
    kept.push(f);
  }
  return kept;
}

/**
 * The SAME ARRANGEMENT: every spot of one has a spot of the other at the same place, facing the same way,
 * held by the same gender - and no spots left over on either side.
 *
 * POSITIONAL, NOT CONGRUENT, and that is the whole point - see `corpusFormationsOfSize` for the measured
 * cost of getting this wrong. A rotation moves dancers to other spots and a reflection turns them round,
 * so neither preserves this key, which is exactly what a caller means by "the same arrangement".
 *
 * ORDER-INDEPENDENT. The two lists have nothing to say about each other's ordering, so the spots are
 * matched by KEY - the rounded position, heading and gender, sorted - rather than index for index. That
 * also makes it independent of which half of a half-set formation the file happens to author first.
 *
 * ROUNDED, because these are parsed decimals rather than integers: two spellings of one board may differ
 * in the last bits of a coordinate. The grid is 2 units, so 0.01 is tight enough that no two distinct
 * corpus formations collide.
 */
function sameArrangement(a: FormDancer[], b: FormDancer[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: FormDancer) => {
    const deg = ((p.heading / DEG) % 360 + 360) % 360;
    return `${p.x.toFixed(2)},${p.y.toFixed(2)},${deg.toFixed(2)},${p.gender ?? 'phantom'}`;
  };
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}

/**
 * The `<tam>` for a call, as a REFERENCE when the call's own `from` names a formation the corpus carries
 * and the call really starts from it, and as an embedded block otherwise.
 *
 * The DECISION is the engine's (`callToXmlNamed`): this module only answers "what does that name resolve
 * to here" - the corpus file, or a formation the caller has added to it - which is the part the engine
 * cannot know.
 *
 * `name` is the label to write (the editor's generated setup name); it is also the name looked up, which
 * is the same thing for a created setup - the name IS the new formation.
 *
 * `symmetry` is the caller's `asymmetric` choice, read the format's way round: `1` writes the whole set
 * out and declares `asymmetric="true"`, `2` writes the half set and declares nothing. It is passed
 * through rather than decided here because the DECISION is the editor's (the checkbox) and the FORMAT is
 * the engine's; all this module adds is which names resolve. It is also inert in reference mode, where
 * the tam names its formation and writes no dancers at all - the editor says so rather than letting the
 * checkbox look as though it did something.
 */
export function callTamXml(call: CallBundle, name?: string, symmetry?: Symmetry): string {
  // THE CALL'S OWN SETUP IS THE NAME TO USE, and `call.formation` is where the parser keeps it: the tam's
  // `formation="Name"` attribute, carried through when the tam embedded no block of its own. It was missing
  // from this chain, which is why an edited corpus call exported as `from=""` with its starting shape
  // written out inline while the corpus's own tam named it.
  //
  // `||` RATHER THAN `??`, and that is the second half of the bug rather than a style choice: the app passes
  // `this.instance.from`, which is the EMPTY STRING for exactly the tams that name their setup through the
  // `formation` attribute, so `'' ?? x` is `''` and every fallback below it was dead.
  const label = name || call.formation || call.from || call.title;
  return callToXmlNamed(call, label, corpusFormationPoses, symmetry ? { symmetry } : {});
}
