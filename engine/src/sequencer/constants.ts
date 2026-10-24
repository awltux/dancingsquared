// Shared sequencer constants.
import type { CallTitle } from './call-titles.js';

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

/**
 * THE PER-DANCER DIVISOR: the `12` the paragraph above says "is what actually decides it".
 *
 * `matchEqualLength`'s distance-signature pre-filter binds at `maxError / SIGNATURE_DIVISOR`, not at `maxError`, so a
 * caller passing `KNOWN_FORMATION_MAX` (6.0) gets an effective per-dancer allowance of 0.5. MEASURED: moving ONE dancer
 * is forgiven up to 0.50 units and no further, uniformly over every dancer and over Static Square, Normal Lines and
 * Ocean Waves; changing `KNOWN_FORMATION_MAX` to 3.0 moves that limit to exactly 0.25, i.e. the divisor is what sets it.
 *
 * WHY IT IS A NAME NOW. It was an unnamed `12` in three places (match.ts twice, matcher.ts once) while the paragraph
 * above described it as the deciding number - a rule documented in prose and spelled in code. It is NOT 12 because
 * there are twelve dancers: the corpus's sets are 2..16 dancers and the filter is a SUM over pairs, so the divisor is
 * a bound on how a single dancer's displacement distributes into that sum, and `test/selection.mjs` pins the effective
 * limit rather than this arithmetic.
 */
export const SIGNATURE_DIVISOR = 12;

// Tolerance for "IS THIS THE SAME BOARD" — the per-dancer position AND heading slack `sameBoardById`
// allows when it compares two boards by dancer IDENTITY.
//
// THIS IS NOT A MATCHING TOLERANCE, and it must not be confused with one. `DEFAULT_MATCH_MAX` answers
// "may this call be called from this board", which is tolerant by design: a caller's board is never
// exactly the authored setup. This answers "did the set arrive at the goal", which is exact by design:
// the two boards being compared were both computed by applying the SAME calls to the SAME start board,
// so the only difference a correct arrival can carry is floating-point residue.
//
// The distinction matters because a tolerance here is the difference between a correct answer and a
// wrong one that happens to be near. MEASURED by `test/board-identity.mjs`: a path applied twice
// reproduces its end board to 0, i.e. bit-identically, so any positive tolerance is already slack; and
// the smallest difference that must be REJECTED is a dancer moved one grid cell (1.0 unit) or turned by
// the authored step (45 degrees = 0.785 rad) — six to eight orders of magnitude above this. There is no
// population near the boundary, so this is a range rather than a taste.
export const SAME_BOARD_TOL = 1e-6;


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
  // ---------------------------------------------------------------------------------------------
  // PHASE 9b: the rest of the bridge, found by NORMALISING every remaining declared gap against
  // `implementedTitles()` rather than by reading the key. Two of the figures suite's 22 declared
  // gaps are not gaps at all - they are the same call under a different spelling - and these are
  // the largest two:
  //
  //   `1/2 Tag` (13 figure stops, the single biggest item on that list). All8's key:
  //       `1/2Tg  1/2 Tag`
  //   and it reads `1/2` as "Half" itself in the very next family it abbreviates:
  //       `Pr1/2  Promenade Half Way Around`
  //   The catalogue titles the call `Half Tag` (`ms/fraction_tag.xml`, beside `Left Half Tag` and
  //   the `3/4 Tag the Line` forms), so this is a pure spelling difference.
  '1/2 Tag': 'Half Tag',
  //   `Right-hand Star` (5 figure stops). All8's key:
  //       `RStar  Right-hand Star  (also StarR)`
  //   The catalogue titles it `Right Hand Star` (`ms/star.xml`) - identical but for the hyphen,
  //   which All8's own punctuation table says carries no meaning inside a call name.
  'Right-hand Star': 'Right Hand Star',
  //   `Split the Outside Couple` (4 figure stops). This one is not a spelling difference and it is
  //   not an equivalence decision either: it is a call CALLERLAB RENAMED. Its own change log says so
  //   in as many words -
  //
  //       "1/9/08 ... Replaced 'Split the Outside Couple' with 'Split Two' and corrected the
  //        definition of Separate."
  //
  //   - and the current `Split Two` entry still lists both spellings among its own command examples
  //   (`Centers Split the Outside Couple and Separate Around 1 to a Line`, `Heads Square Thru 4;
  //   Split the Outside Couple`). The catalogue has `Split Two` (`ms/split_two.xml`), so All8 is
  //   writing the retired name for a call the engine already performs.
  'Split the Outside Couple': 'Split Two',
  //   `Split the Outside 2` is the same entry's other wording for the same action (`Centers Split
  //   the Outside 2`, `Heads Square Thru 4; Split the Outside 2`), so it is bridged with it. Not
  //   `Split the Outsides`: that one appears only inside "Centers Split the Outsides, Go Around 1 to
  //   a Line", where it carries the Around-1 continuation and is therefore a different reading of
  //   the name rather than another spelling of the bare call.
  'Split the Outside 2': 'Split Two',
  //   `Left Allemande` is how the ceder corpus writes `Allemande Left` - the same call with the words
  //   the other way round, and the repo's own All8 key already treats them as one: `all8-notation.ts`
  //   records `LA` as "Allemande Left" while its comment calls that token "Left Allemande" out loud.
  //   It is also the single largest stop in the `Zero Box` corpus (33 modules of 324), so it is worth
  //   having even though nothing in the asset catalogue carries the title.
  'Left Allemande': 'Allemande Left',
  // NOT bridged, because they are equivalence decisions rather than spellings, and each needs its
  // own evidence: `All 8 Circulate 1 1/2` -> `Circulate 1 1/2` (Phase 5c's dispatch says the two
  // coincide FROM A WAVE only) and `All Promenade 1/2` -> `All 4 Couples Promenade 1/2`.
  // `Split the Outside Couple` USED TO BE LISTED HERE and is bridged above: the plan wanted evidence
  // that it means `Centers Split the Outside Couple`, and CALLERLAB's change log supplied better
  // evidence than that - the name was retired in favour of `Split Two`.
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
//
// `Promenade` IS IN THIS LIST AND IS A TITLE THE CORPUS AUTHORS — 5 tams, MEASURED. The note this replaces
// said the bare name was authored by nothing and was therefore undanceable, which stopped being true when the
// promenade family was retitled (`e02b434`); the list itself never had to change, and that is the point of
// typing it `readonly CallTitle[]`: a finish the corpus stops carrying cannot be quietly kept here, it fails
// the BUILD (MEASURED — adding the phantom `Promenade Home` reports TS2322 against `CallTitle`). Whether the
// engine can actually take one of these edges is a separate question, asked where the search applies a call.
export const STANDARD_FINISHES: readonly CallTitle[] = ['Allemande Left', 'Right and Left Grand', 'Promenade'];

/** Resolve a name to its canonical form (checking call and formation synonyms
 * in turn). Non-aliases pass through unchanged, so this is safe to apply to any
 * name. */
export function canonicalName(name: string): string {
  return CALL_SYNONYMS[name] ?? FORMATION_SYNONYMS[name] ?? name;
}

