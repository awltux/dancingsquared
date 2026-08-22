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
}

export interface Pose {
  x: number; // world X
  y: number; // world Y (2D; map to depth in 3D)
  heading: number; // radians, 0 = +X, positive = ccw
  hands: Hands;
}
