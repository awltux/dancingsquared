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
export const KNOWN_FORMATION_MAX = 6.0;

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
];

// Synonym table for formation names: every key is an alias that canonicalises to
// its value. The catalog sometimes names the same geometry differently (e.g.
// "Squared Set" and "Static Square" are identical); callers and the solver can
// pass either and get consistent behaviour.
export const FORMATION_SYNONYMS: Record<string, string> = {
  'Squared Set': 'Static Square',
};

// Synonym table for CALL names: every key is an alias that resolves to the
// canonical registered call name. Extend as alternate spellings/names are found.
export const CALL_SYNONYMS: Record<string, string> = {};

/** Resolve a name to its canonical form (checking call and formation synonyms
 * in turn). Non-aliases pass through unchanged, so this is safe to apply to any
 * name. */
export function canonicalName(name: string): string {
  return CALL_SYNONYMS[name] ?? FORMATION_SYNONYMS[name] ?? name;
}

