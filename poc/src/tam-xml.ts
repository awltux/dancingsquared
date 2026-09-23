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

import formationsXmlText from './assets/formations.xml?raw';
import { DEG, callToXmlNamed, canonicalName, parseFormations } from 'dancing-squared-engine';
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
 * The 8-dancer poses a `formation="Name"` reference resolves to, or null when the corpus does not carry
 * that name.
 *
 * MIRRORED TO EIGHT when the corpus authors four dancers, because that is what `buildCallImpl` does with
 * a four-dancer formation before pairing paths: a created call is always full-set, so the comparison has
 * to be against the shape the parser will actually build.
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
    if (asPoses.length === 8) return asPoses;
    if (asPoses.length === 4) {
      return asPoses.concat(asPoses.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender })));
    }
    return asPoses;
  }
  // A USER FORMATION ONLY COUNTS ONCE THE CALLER HAS ADDED IT TO THE CORPUS - see the note above: a
  // reference to a shape that lives in one browser's storage is a call nobody else can load.
  const stored = findUserFormation(name);
  if (stored?.inCorpus) return stored.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  return null;
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
  const label = name ?? (call.from || call.title);
  return callToXmlNamed(call, label, corpusFormationPoses, symmetry ? { symmetry } : {});
}
