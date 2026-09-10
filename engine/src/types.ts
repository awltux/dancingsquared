// Normalized runtime types for the dancing-squared engine.
// The converter (convert.ts) produces these from taminations XML.

export type Gender = 'boy' | 'girl' | 'phantom';

export type Hands =
  | 'none'
  | 'left'
  | 'right'
  | 'both'
  | 'gripleft'
  | 'gripright'
  | 'gripboth';

// A cubic Bezier in dancer-local space. P0 is implicitly (0, 0); the dancer's
// +X is its initial facing direction; +Y is to the dancer's left.
export interface BezierData {
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x2: number;
  y2: number;
}

// One atomic movement: 1-2 Beziers + timing + hand state.
export interface Seg {
  beats: number;
  hands: Hands;
  // Translation path (always present).
  translate: BezierData;
  // Facing path. When null the dancer faces along the translation tangent.
  rotate: BezierData | null;
}

export interface DancerSpec {
  gender: Gender;
  x: number; // grid x
  y: number; // grid y
  angleDeg: number; // initial facing in degrees (0 = +X, ccw)
  path: Seg[]; // normalized, one path per dancer
  // Home-square identity, stamped by assignHomeIdentity. A dancer keeps this
  // from the start of the square throughout the dance; it is NOT derived from
  // the dancer's position or array index.
  id?: number; // 1..8 home identity
  couple?: number; // 1..4 home couple
  // When true this dancer is the duplicate half of the set: the pose is rotated
  // 180 degrees about the origin (x,y -> -x,-y, heading -> heading + pi). Used
  // to build the full square from taminations' half-group calls.
  mirror?: boolean;
}

/**
 * The value of a `<tam sequencer="…">` attribute.
 *
 * Taminations defines exactly four values (`taminations-flutter/lib/animated_call.dart:157-168`,
 * where `isPerimeter` / `isExact` / `isGenderSpecific` / `notForSequencer` are written back out
 * as `'perimeter'` / `'exact'` / `'gender-specific'` / `'no'`), and its own sequencer SKIPS the
 * `no` case outright when it looks for a setup to apply
 * (`taminations-flutter/lib/sequencer/calls/xml_call.dart:57-59`):
 *
 *     for (var tam in lookupAnimatedCall(norm)) {
 *       if (tam.notForSequencer) continue;
 *
 * The engine used to read only `gender-specific` — by comparing the raw attribute string — so
 * `no`, `perimeter` and `exact` were silently dropped and those variants registered as ordinary
 * setups. On the published asset tree that is 271 `no` variants across 61 titles, and **32 titles
 * with no eligible variant at all**, concentrated in exactly the families the get-out corpus is
 * stuck on (`Boys Run` 32/32, `Girls Run` 34/34, `Centers Run` 20/20, `Ends Run` 18/18, `Trade`
 * 3/3, `Boys Fold` 2/2, `Centers Cast Off Three Quarters` 12/12, and 12 of `Boys Trade`'s 24).
 *
 * A `no` variant is a caller-school DEMONSTRATION of the call, not a setup the sequencer may
 * apply: it stays registered — it is a legitimate animation, and the picker and the editor still
 * list it — but it is not matchable from a board.
 */
export type SequencerMode = 'perimeter' | 'exact' | 'gender-specific' | 'no';

export interface CallBundle {
  title: string;
  from: string;
  parts: string;
  taminator: string;
  dancers: DancerSpec[];
  // beats = max dancer path beats (excluding lead-in/out).
  beats: number;
  leadin: number;
  leadout: number;
  totalBeats: number; // leadin + beats + leadout
  // The authored `sequencer` attribute, verbatim, or null when it is absent.
  sequencerMode: SequencerMode | null;
  // Whether the sequencer may MATCH this variant from a board. False only for
  // `sequencerMode === 'no'`. Anything that hunts for a variant to apply must filter on
  // this; anything that merely LISTS variants (the picker, `variantStarts`, the FSM
  // state set) must not, or the demonstration animations would vanish from the UI.
  forSequencer: boolean;
  // sequencer="gender-specific": the call only applies when the board's gender
  // arrangement matches the setup's gender slots (e.g. "Boys Turn Back"). Derived from
  // `sequencerMode`, which is the single source of truth for the attribute.
  genderSpecific?: boolean;
}

export interface Pose {
  x: number; // world X
  y: number; // world Y (2D; map to depth in 3D)
  heading: number; // radians, 0 = +X, positive = ccw
  hands: Hands;
}
