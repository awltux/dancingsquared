// Shared sequencer constants.

// Default tolerance for formation matching (matchFormations' maxError) when
// deciding whether a call is LEGAL from a board. Genuine starts match at ~0.0
// while wrong-formation force-fits start well above 1.5, so 1.5 keeps correct
// calls and rejects the spurious ones.
export const DEFAULT_MATCH_MAX = 1.5;

// Tolerance for the SEARCH path (getout/fixIt). Those operate on pure-relative
// boards that are not snap-clamped, so intermediate states drift slightly off
// the canonical setup and need a looser tolerance to chain multi-call sequences.
export const SEARCH_MATCH_MAX = 6.0;

// Tolerance for END-recognition: whether a call's RESULT lands in any known
// catalog formation. This gates sequencing continuity, not legality.
//
// IT DOES NOT MEAN "6 UNITS OF SLACK", and the difference is worth knowing because the number reads
// like a very loose tolerance and has been recorded as one. `error` is a SUM over all dancers, but
// the distance-signature pre-filter in matchEqualLength binds first, and it binds at
// `maxError / 12` - not at `maxError`. Measured on a real board: moving ONE dancer is forgiven up to
// 0.50 units and no further, uniformly over every dancer and over Static Square, Normal Lines and
// Ocean Waves. Changing this constant to 3.0 changes that limit to exactly 0.25, so the effective
// per-dancer allowance is this value / 12 and the 12 is what actually decides it.
//
// The practical consequence: the effective tolerance is ~0.5, i.e. a QUARTER of the 2-unit dancer
// spacing - tight, not loose. Do not "tighten" this constant on the assumption that 6.0 is being
// spent; measure the effective limit instead (test/selection.mjs pins it).
export const KNOWN_FORMATION_MAX = 6.0;

// Couple value meaning "identity unknown". Real home couples are 1..4. A board
// synthesised from geometry alone (e.g. jumped to with setFormation, rather than
// reached by dancing) has no real home identity, so its dancers carry this
// sentinel instead of a couple derived from the array index.
//
// INDEX INDEPENDENCE: nothing may treat this as a couple. The matching identity
// tie-break, the couple-based groupings (heads/sides/couples/beau-belle) and the
// couple-coherence check in the parallel partition all skip it, so an
// index-derived value can never decide a match or a subset.
export const UNKNOWN_COUPLE = 0;

/** Whether `c` is a real home couple (1..4) rather than UNKNOWN_COUPLE. */
export const isKnownCouple = (c: number | null | undefined): c is number =>
  typeof c === 'number' && c > 0;

// Standard Mainstream formations used for RECOGNITION. Matching against a
// curated list avoids mislabeling a setup as a congruent-but-unrelated named
// formation (many 4-dancer setups become geometrically congruent once mirrored,
// e.g. "Single File Promenade" vs "Squared Set").
export const STANDARD_FORMATIONS = [
  'Squared Set',
  'Static Square',
  'Normal Lines',
  'Double Pass Thru',
  'Quarter Tag',
  'Tidal Line RH',
  'Tidal Wave RH',
  'Separated Columns',
  'Alamo Wave',
  'Eight Chain Thru',
  'Two-Faced Lines',
  'Ocean Waves RH',
  // Thars are common end formations (e.g. after Recycle/any "… and anything"
  // that leaves a star); including them lets those end states resolve in the FSM.
  'Thar LH Boys',
  'Thar LH Girls',
  'Thar RH Boys',
  'Thar RH Girls',
  // Additional named formations from the all8 formations index that are common
  // end-states and exist in the catalog (LH/mirror variants and tidal/diamond
  // forms) — lets their end states resolve rather than being dropped.
  'Tidal Line LH',
  'Tidal Wave',
  'Two-Faced Tidal Line RH',
  'Two-Faced Tidal Line LH',
  'Diamond RH',
  'Diamond LH',
  'Magic Column RH',
  'Magic Column LH',
  '3/4 Tag',
  'Quarter Tag LH',
  'Box RH',
  'Quarter Lines RH',
  'Quarter Lines LH',
  'Ocean Waves',
];

// Synonym table for formation names: every key is an alias that canonicalises to
// its value. The catalog sometimes names the same geometry differently (e.g.
// "Squared Set" and "Static Square" are identical); callers and the solver can
// pass either and get consistent behaviour.
export const FORMATION_SYNONYMS: Record<string, string> = {
  'Squared Set': 'Static Square',
};

// Synonym table for CALL names: every key is an alias that resolves to the canonical registered
// call name. `canonicalName()` applies it, and it is consulted by `CallLibrary.hasCall`,
// `getVariants` and `register`, so an alias works everywhere a title does.
//
// PHASE 6: the bridge LIVES HERE NOW. It used to be three entries in a TEST HARNESS
// (`engine/test/lib/engine-calls.mjs`), which meant only the corpus harness could read published
// choreography - any real consumer had to re-implement the mapping. `canonicalName()` already
// applied a (empty) synonym table, so the engine had the mechanism and no data.
//
// These are differently-NAMED calls, not spellings: All8 writes `Touch 1/4` for the call the
// catalogue titles `Touch a Quarter`, and so on. Aliases that are the SAME call are already
// handled by the call itself (`Promenade` / `Promenade Home` are one registry entry), so they do
// not belong here.
export const CALL_SYNONYMS: Record<string, string> = {
  'Touch 1/4': 'Touch a Quarter',
  'Cast Off 3/4': 'Cast Off Three Quarters',
  'Do Sa Do': 'Dosado',
  // All8 writes the composed call as `DoSaD ToWav` - literally "Do Sa Do to a Wave" - because `&`
  // and `ToWav` are its own modifiers, while the catalogue titles the call `Dosado to a Wave`. So
  // the composed SPOKEN name and the TITLE are differently named, exactly like `Do Sa Do` above,
  // and the synonym is what lets our All8 decoder emit the spoken form (all8-notation.ts
  // SUFFIX_TOKENS) without producing a phantom name.
  'Do Sa Do to a Wave': 'Dosado to a Wave',
  'Left Touch 1/4': 'Left Touch a Quarter',
  // From All8's own abbreviation key, which lists these as the SAME call under two names:
  //   `Hinge  {designated} Hinge  (prefer SHing if designating all)`
  //   `SHing  Single Hinge`
  // So "Single Hinge" is how All8 spells the call the catalogue titles `Hinge` - there is no
  // `Single Hinge` title anywhere in the assets, and the reason it looked like a catalogue gap
  // is that nothing bridged the two names. `Hinge` is authored from 14 formations (boxes, waves,
  // columns, two-faced lines, diamonds, tidals, quarter tags), so bridging it is what makes the
  // nine published get-outs that use `SHing` danceable.
  'Single Hinge': 'Hinge',
  // All8: `LHing  (with the) Left Hand (Single) Hinge  (Hinge by the Left)` - the same call with
  // the other hand, and `Hinge` is authored from the LEFT-HAND boxes, waves, columns, two-faced
  // lines and tidals as well as the right-hand ones, so the catalogue covers it the same way.
  'Left Hand Hinge': 'Hinge',
};

// ---------------------------------------------------------------- number words
//
// Some call families are named with the NUMBER SPELLED OUT in the catalogue and with a DIGIT
// everywhere else. The `Eight Chain` family is the case in hand: the Plus programme titles them
// `Eight Chain One` .. `Eight Chain Seven`, while All8 abbreviates them `8Chn1` .. `8Chn7` and a
// caller says "Eight Chain One". So the two differ by a digit-to-text conversion, and the bridge
// belongs here - which is why `Eight Chain 1` was WRONGLY declared a catalogue gap: the engine
// implements the call, under the other spelling. That is the exact failure the gap list exists to
// make visible, and the stale-gap check is what caught it.
//
// The conversion is written out family by family rather than applied to every name, because a
// blanket rule breaks real titles: `Square Thru 4` and `Square Thru 2 1/2` are catalogue titles
// WITH digits, so converting digits unconditionally would rename them out of existence.
const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  CALL_SYNONYMS[`Eight Chain ${n}`] = `Eight Chain ${NUMBER_WORDS[n]}`;
}

// The calls a caller uses to CLOSE the square. Under the caller convention a
// get-out succeeds by reaching a state one of these resolves from, which is exactly
// how All8's published get-outs are written (their last token is `--AL`, `--RLG` or
// `--Prom`). The search treats them as its final edges, and the corpus harness
// measures "did this get-out reach a resolve?" with the same list, so the two
// cannot drift apart.
//
// Order matters only for which finish a search returns first when several apply.
export const STANDARD_FINISHES = ['Allemande Left', 'Right and Left Grand', 'Promenade'];

/** Resolve a name to its canonical form (checking call and formation synonyms
 * in turn). Non-aliases pass through unchanged, so this is safe to apply to any
 * name. */
export function canonicalName(name: string): string {
  return CALL_SYNONYMS[name] ?? FORMATION_SYNONYMS[name] ?? name;
}

