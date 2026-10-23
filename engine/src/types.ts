// Normalized runtime types for the dancing-squared engine.
// The converter (convert.ts) produces these from taminations XML.

import type { Going } from './going.js';

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

/**
 * HOW MANY COPIES OF A WRITTEN SHAPE MAKE THE SET - the corpus's own declaration, and the answer to
 * "this shape lists four dancers, so what is it?".
 *
 * The authoring convention (Taminations, and `square-dancing.md` §7.1) is that a `<formation>` or a
 * `<tam>`'s inline formation writes HALF the set and the other half is implied: the written dancers
 * turned 180 degrees about the origin. So a shape of four stands for eight, and a shape of two stands
 * for four. A shape that is NOT a half - one already written out in full - says so with
 * `asymmetric="true"` (`tamination.dtd:38` declares the attribute on `<tam>`, and
 * `animated_call.dart:161-162` writes it back), and is then taken exactly as written.
 *
 * The reference implements this as a declared multiplier rather than a guess: `geometry.dart` gives
 * `SQUARE = 2` and `ASYMMETRIC = 1`, `CallContext.fromFormation` instantiates the written dancers
 * `geometryType` times (`call_context.dart:170-197`), and `dance_model.dart:383` reads it as
 * `mycall.formation.asymmetric ? 1 : _geometryType`. So 2 is the DEFAULT and 1 is the opt-out.
 *
 * WHY IT IS CARRIED BEFORE IT IS ACTED ON. The engine currently re-derives this geometrically - see
 * `hasAntipode` in `convert.ts`, which completes a shape unless some pair of its dancers already sits
 * 180 degrees apart - and MEASURED over the shipped tree the two rules agree everywhere but one case:
 * of 5963 tams, 5961 build, 5942 at written x 2, 18 at written x 1 (all 18 of which declare it), and
 * exactly ONE builds against its declaration (`Allemande Left` from `O Trade By`, written as a whole
 * eight-dancer setup that the guess leaves at eight). The proxy therefore works, and is kept until
 * this field is read - the point of carrying it is that the rule becomes the DATA's rather than a
 * geometric accident, and that the disagreement is a pinned list instead of a silent one.
 *
 * `formations.xml` CANNOT DECLARE IT (`tamination.dtd`'s `<formation>` takes `name` only), so every
 * registry entry is a half by construction and is symmetry 2. That is why the library holds exactly
 * the shapes whose written size is 4 - see `CallLibrary`'s constructor for the 63 entries whose
 * declared set is not eight and which it drops today.
 *
 * TWO DANCERS IS THE CASE THIS SETTLES. A pair is written with BOTH dancers and
 * `asymmetric="true"`, which is the only way to give the two dancers different genders: completing a
 * one-dancer authoring duplicates that dancer, and the copy carries the original's gender, so a lone
 * `boy` becomes a pair of boys. Measured on the four shipped tams that do this
 * (`Step to a Wave` and `Step to a Left-Hand Wave`, both from `Facing Dancers`): written 1, built 2,
 * genders `boy,boy`.
 */
export type Symmetry = 1 | 2;

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
  // How many copies of the WRITTEN shape make this variant's set: 2 (the default, the written shape
  // is half the set) or 1 (the tam declares `asymmetric="true"`, take it as written). See `Symmetry`
  // for the rule, the reference and the measurement. The engine still completes shapes geometrically;
  // this is the declaration that will replace that guess.
  symmetry: Symmetry;
  // The authored `actives` attribute, verbatim, or absent. WHICH DANCERS the tam's paths describe:
  // a tam that declares it is authored for a subset (or for "All"), and the engine currently
  // IGNORES it when it mirrors a four-dancer setup to eight. Carried so that mis-registration is
  // visible and pinnable; see `TamRaw.actives` in convert.ts and PLAN.md's Phase C.
  actives?: string | null;
  /**
   * The NAME this tam declared its start formation by (`formation="Name"` against `formations.xml`),
   * or `null` when the tam carried the setup INLINE and named nothing.
   *
   * WHY IT IS KEPT. `buildCallImpl` resolves the dancers from that name and then dropped it, so the
   * engine could say what GEOMETRY a call starts from but not which declared formation a CALLER
   * asked for. Those are different questions and the second one is the level question: a programme
   * restricts which formations a call may be used from, and that restriction is written in exactly
   * this attribute. Adding it here is what lets the state vocabulary be derived from the calls
   * actually registered instead of from the whole `formations.xml` (Stage 0b).
   *
   * `from="..."` is NOT this. `from` is free text for the user - `buildCallImpl` never reads it - so
   * a tam whose only name is `from="Lines"` has declared its setup INLINE and this is `null`.
   */
  formation: string | null;
  /**
   * HOW this authoring goes, where the corpus publishes more than one body for a call: `close`, `normal` or `far`,
   * DERIVED from the title (`going.ts` says why derived, and why it is a label rather than a measurement). `null` when
   * the title does not say.
   *
   * IT IS ON THE VARIANT BECAUSE THAT IS THE THING THAT DIFFERS. Several bodies of one call can share their setup
   * exactly, so a match has to be able to say WHICH body it chose — and a permission rule has to be able to refuse one
   * without refusing the call.
   */
  going: Going | null;
  /**
   * SET ONLY ON A SYNTHESISED VARIANT - a subwhole-set authoring placed on a whole-set board. A virtual call
   * is INVENTED GEOMETRY: every other fact in this tree comes from the corpus, and this is the one kind that
   * does not. The marker is what keeps it out of every census that counts authored tams (§11.2.4's neighbour:
   * a number that starts counting boards nobody authored is worse than no number), and it is what lets a
   * consumer say where the paths came from.
   *
   * `undefined` on everything the corpus or the editor produced, so an existing caller cannot observe a change.
   */
  virtual?: VirtualCallInfo;
}

/**
 * WHERE A VIRTUAL VARIANT CAME FROM. Carried on the bundle rather than inferred from its size, because a
 * whole-set call and a placed subset can look identical from the outside.
 */
export interface VirtualCallInfo {
  /** The authored title the paths were copied from. The placed bundle keeps it, so a caller can say the name. */
  sourceTitle: string;
  /** The formation the SOURCE authoring starts from, or null when it named none. */
  sourceFormation: string | null;
  /**
   * THE FORMATION ID OF THE BOARD THE SOURCE STARTS FROM — the identity of the authoring this variant was
   * placed FROM, in the form `formationRootOf` takes.
   *
   * WHY IT IS HERE AND NOT DERIVED BY THE CALLER. `sourceFormation` is a NAME, and it is null on every inline
   * authoring (`convert.ts`: an embedded `<formation>` says no name), which is most of the corpus — so a
   * consumer that wants to say WHICH authoring a virtual instance came from has nothing to hold. The id is
   * computed where the source board still exists, and it is the whole input of the variant identity:
   * `callVariantId(level, sourceTitle, formationRootOf(sourceStart, roots))`.
   *
   * A FORMATION ID RATHER THAN A `Board`, because that is exactly what the consumer needs and the board would
   * be re-typed by the caller anyway: the id is a pure content address of the source's start poses
   * (`formation-id.ts` reads x, y and heading and ignores gender, couple and id), so carrying the board would
   * carry the same fact three ways.
   */
  sourceStart: string;
  /**
   * How many dancers the source authoring describes AS PLACED — the normalised size, so a half-set unit written
   * as two dancers reads 4 here, because that is how many dancers one copy moves.
   */
  sourceSize: number;
  /**
   * `placement[copy][j]` is the board index that took source dancer `j` of that copy. A `tiled` variant has one
   * entry per copy and covers the whole board; a `partial` one has exactly one entry and leaves the other
   * dancers holding. NESTED because a tiled placement puts one source dancer on SEVERAL board dancers — a flat
   * list silently kept only the last copy, which read as a 4-dancer placement of an 8-dancer call.
   */
  placement: number[][];
  /** `tiled`: every board dancer dances a copy. `partial`: one placement dances and the rest hold. */
  kind: 'tiled' | 'partial';
}

export interface Pose {
  x: number; // world X
  y: number; // world Y (2D; map to depth in 3D)
  heading: number; // radians, 0 = +X, positive = ccw
  hands: Hands;
}
