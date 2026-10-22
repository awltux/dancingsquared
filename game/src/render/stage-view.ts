// The render view: ONE stage, TWO boards, shown side by side — "you are here" and "get here".
//
// WHY ONE SCENE AND NOT TWO CANVASES. The stage owns a camera, a floor, two grids and the 2D/3D switch
// (AGENTS.md §4.3 keeps that knowledge in `packages/stage`), and a second canvas would mean a second copy of
// all of it plus a second `DancerView` lifecycle to keep in step. Two board GROUPS inside the one scene get
// the side-by-side comparison for free, and — the reason that actually matters — the 2D/3D toggle then
// applies to BOTH boards at once, which is what DESIGN.md §13's "on both the 2D and 3D views" asks for.
//
// IT SERVES BOTH MODES, which is why the class is `GameStage` and not `DrillStage` any more: the Drill shows
// a question's board beside the goal, and the Daily shows the player's board beside the same goal, and those
// are the same picture.
//
// DANCER VIEWS ARE KEYED BY IDENTITY, never by array position. `DancerView` bakes its avatar at construction
// — the boy/girl shape, the couple colour, the number label — so a view paired with the wrong dancer shows
// the wrong person at a correct position, which is the shape `reorderLike`'s comment in the engine records
// (every position right, the set scrambled).
//
// ONE OF THE TWO REPRESENTATIONS IS DRAWN AT A TIME, and this is the second thing that went wrong while
// building it. `DancerView.update` poses BOTH the 3D avatar and (through the caller) the flat marker, so a
// view that shows both draws a humanoid seen from directly overhead — long thin limbs crossing the board,
// which is what the "legs" in the first usable screenshot were. `poc/src/browser.ts` makes the same choice
// (`v.group.visible = on && !flat`); this module makes it once for two boards.
import * as THREE from 'three';
import { DancerView, buildBoardFloor, buildFlatMarker, createStage, displayCouple, type Stage } from 'dancing-squared-stage';
import { computeHandholds, type Board, type Pose } from 'dancing-squared-engine';
import { stillBoard } from '../game/poses.ts';
import type { WaypointState } from '../puzzle/waypoint-pair.ts';
import type { SequenceMotion } from '../puzzle/types.ts';
import { slideOffsets } from './slide-math.ts';
import { CELEBRATE_MS, justSolved, pulse, type BorderReading, type Pulse } from './celebrate.ts';

/**
 * HOW THE TWO BOARDS ARE SIZED AND PLACED — and the arithmetic is the geometry, not a pair of numbers that
 * happened to look right.
 *
 * THE STAGE FRAMES A 10-UNIT FLOOR (`FLOOR_HALF` is 5, so it spans ±5) and that one fact decides both
 * numbers. A board IS 10 units across, so at scale `s` it occupies `10s`, and two boards plus a gutter must
 * fit inside the frame:
 *
 *     2 · 10s + gutter ≤ 10        with s = 0.42 and gutter = 1.6  →  8.4 + 1.6 = 10.0
 *
 * So the scale is 0.42 and each board's centre sits at ±(10s/2 + gutter/2) = ±2.9. The first version used 0.45
 * with centres at ±2.6, which put each board's inner edge 0.1 units INSIDE the other's outer edge: the two
 * floors and both sets of dancers overlapped in the middle of the canvas, which is exactly what "you are
 * here" and "get here" must never do.
 *
 * THE CENTRE FOLLOWS THE SCALE, and that is a defect fixed rather than a refinement. It used to be computed
 * from the 2D scale once (`BOARD_CENTRE = 2.9`) and used by both views — but the 3D view draws each board at
 * 0.68, so a board half-width is 3.4 around a centre of 2.9 and the two boards OVERLAPPED by 1.0 unit. That
 * was invisible while the whole scene shared one stage-wide grid; it stopped being invisible the moment each
 * board got its own floor, which is why `centreFor` takes the scale.
 */
const BOARD_SCALE = 0.42;
const GUTTER = 1.6;

/** Where a board's centre sits for a given board scale: half a board plus half the gutter. */
function centreFor(scale: number): number {
  return 5 * scale + GUTTER / 2;
}

/**
 * THE SCALE DIFFERS BY VIEW, and the reason is that the two views have different constraints.
 *
 * 2D is the OVERHEAD view, and there the whole frame is the constraint: both boards must fit inside the
 * 10-unit floor, which is what fixes BOARD_SCALE at 0.42 (see above).
 *
 * 3D is an ORBIT view, and there the constraint is different: the camera can be pulled back, and what matters
 * is that a DANCER is legible. A dancer's avatar is 2 units tall at scale 1, so at 0.42 it spans ~0.84 units
 * on a board that is 4.2 across — measured on screen, eight of those read as a tangle of limbs seen edge-on
 * rather than as eight people, which is what the first 3D screenshot showed. At 0.68 a dancer spans ~1.36
 * units and the set reads as figures. The boards then reach further than one floor grid, which is why the
 * camera is told the arena's extent below rather than assuming a floor is all there is.
 */
const BOARD_SCALE_3D = 0.68;

/**
 * HOW FAR THE SCENE REACHES FROM ITS CENTRE, which is what the camera has to fit.
 *
 * TWO BOARDS AND THE GUTTER, not one floor: `centre + half a board`. The stage's default frame is one floor
 * plus its own 0.6 pad, which is right for the POC and too small here — MEASURED in the 3D view, the two
 * boards reached 6.3 units against a 5.6-unit frame, so both outer edges and the dancers on them were cropped
 * off the canvas. The 0.6 here is the same pad the stage uses, and it is deliberate that the 2D arena
 * (2.9 + 2.1 + 0.6) comes out at exactly that default: the flat view was already framed correctly and this
 * must not change it.
 *
 * THE 3D ARENA IS NOW 8.2 RATHER THAN 6.3, because `centreFor` follows the scale (see the comment above the
 * scales): at 0.68 the centres move out to ±4.2, so `4.2 + 3.4 + 0.6 = 8.2`. The old 6.3 was measured against
 * centres that did not move, which is the overlap the same comment records. A dancer is then ~8.3 % of the 3D
 * frame against ~7.5 % of the 2D one — still the larger of the two, which is what the 0.68 scale was for.
 */
const ARENA_PAD = 0.6;

/** The world half-extent a view must show, at the board scale that view uses. */
function arenaHalf(scale: number): number {
  return centreFor(scale) + 5 * scale + ARENA_PAD;
}

/**
 * Where two dancers' hands meet, in board units above the floor.
 *
 * The POC's own number (`poc/src/sequencer-ui.ts` aims every hold at `y = 1.0`), reused rather than
 * re-chosen: a dancer's avatar is 2 units tall, so a hand at 1.0 is at its own mid-height, and a hold drawn
 * anywhere else either floats above the pair or hides inside the floor.
 */
const HOLD_HEIGHT = 1.0;

/** A board at rest: the walk cycle held still, because nothing is travelling. */
const WALK_STILL = { phase: 0 };

/**
 * The walk phase at `beat`.
 *
 * THE POC'S EXACT EXPRESSION, including the `+ 1000`: it makes beat 0 and beat 2 land on the same phase, so
 * a two-beat call does not end its walk mid-stride, and it is the tempo the panel that authors these calls
 * uses. Re-deriving it here would make the same call look like two different dances in one app.
 */
function walkAt(beat: number): { phase: number } {
  return { phase: ((beat + 1000) % 2) / 2 };
}

export type ViewMode = '2d' | '3d';

/**
 * THE BORDER PALETTE, and it is three STATES rather than three shades: solved, next, locked.
 *
 * GREEN AND RED ARE THE GAME'S OWN `--ok` AND `--bad`, so a border reads as the same signal as the verdict text;
 * BLUE IS NEW and is the colour the palette did not have. The shell copies these into CSS custom properties for the
 * legend, so the drawn border and the swatch beside it cannot drift.
 */
export const OUTLINE_COLOR: Record<WaypointState, number> = {
  solved: 0x7fe3a1,
  next: 0x6fb7ff,
  locked: 0xff8f8f,
};

/**
 * HOW THE BORDER IS DRAWN: a flat square ANNULUS just outside the floor's edge, in board coordinates.
 *
 * A `LineLoop` would be a hairline — WebGL ignores `linewidth` — and a border that disappears at one pixel is not a
 * state a player can read. A mesh has a thickness in BOARD units, so it scales with the board in both views.
 *
 * IT SITS OUTSIDE `FLOOR_HALF` (5.16 against 5) rather than on the grid's outermost line, so it never hides one, and
 * at y = 0.02 it clears the floor (-0.001) and the grid (0) without z-fighting either.
 */
const OUTLINE_HALF = 5.16;
const OUTLINE_WIDTH = 0.26;
const OUTLINE_Y = 0.02;
/** How solid the border is at rest. `celebrate.ts` pulses a MULTIPLIER of this, so the resting look is one number. */
const OUTLINE_OPACITY = 0.95;
/** The colour the pulse brightens towards. One instance, because a fresh `THREE.Color` per board per frame is garbage for no gain. */
const OUTLINE_HIGHLIGHT = new THREE.Color(0xffffff);

/**
 * HOW LONG A CHANGE OF WAYPOINT PAIR TAKES, in milliseconds.
 *
 * 320 is long enough to read as MOVEMENT rather than a redraw and short enough that a player answering a drill's
 * steps is not waiting on it: at 200 the two frames blur together, and beyond ~400 the second board has visibly
 * arrived before the first has left. It is also well under one second, the threshold above which an interface is
 * reported as slow.
 */
const SLIDE_MS = 320;

/**
 * Whether the player has asked the system for less motion.
 *
 * THE SLIDE IS SKIPPED ENTIRELY when they have, rather than shortened: a translation of two boards is exactly the
 * kind of movement `prefers-reduced-motion` exists to remove, and the pair is still shown correctly at once.
 */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A square frame with a square hole, in the shape's XY plane, ready to be laid on the floor. */
function outlineGeometry(): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  const inner = new THREE.Path();
  const o = OUTLINE_HALF;
  const i = OUTLINE_HALF - OUTLINE_WIDTH;
  outer.moveTo(-o, -o);
  outer.lineTo(o, -o);
  outer.lineTo(o, o);
  outer.lineTo(-o, o);
  outer.closePath();
  // THE HOLE IS WOUND THE OTHER WAY, which is what makes it a hole rather than a second face over the first.
  inner.moveTo(-i, -i);
  inner.lineTo(-i, i);
  inner.lineTo(i, i);
  inner.lineTo(i, -i);
  inner.closePath();
  outer.holes.push(inner);
  return new THREE.ShapeGeometry(outer);
}

/** One board: its own group, one dancer view per dancer, one flat marker per dancer. */
class BoardView {
  private readonly group = new THREE.Group();
  private readonly views: DancerView[] = [];
  private readonly markers: THREE.Group[] = [];
  private readonly outline: THREE.Mesh;
  /** The state colour the pulse brightens FROM, so a flash cannot lose the colour the border is meant to report. */
  private readonly baseColor = new THREE.Color(OUTLINE_COLOR.solved);
  private ids: number[] = [];
  private flat = true;

  constructor(scene: THREE.Scene, offsetX: number) {
    this.group.position.x = offsetX;
    this.group.scale.set(BOARD_SCALE, BOARD_SCALE, BOARD_SCALE);
    // THE FLOOR IS THE BOARD'S OWN, added INSIDE this group so it carries the same scale and offset as the
    // dancers: a grid line and a dancer's position are then the same coordinate by construction, which is the
    // reported defect ("the background grid is not aligned with the dancer layout") closed rather than
    // re-tuned. The stage is told `floor: false` for the same reason — one floor across the scene is one
    // background shared by two boards.
    this.group.add(buildBoardFloor().group);
    // THE BORDER IS IN THE SAME GROUP AND HIDDEN UNTIL A STATE ARRIVES, so a board with no waypoint state yet shows
    // no border at all rather than a default colour that would have to be explained.
    this.outline = new THREE.Mesh(
      outlineGeometry(),
      new THREE.MeshBasicMaterial({
        color: OUTLINE_COLOR.solved,
        transparent: true,
        opacity: OUTLINE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.outline.rotation.x = -Math.PI / 2;
    this.outline.position.y = OUTLINE_Y;
    this.outline.visible = false;
    this.group.add(this.outline);
    scene.add(this.group);
  }

  /** The waypoint state this board's border reports, or null for no border. See `OUTLINE_COLOR`. */
  setOutline(state: WaypointState | null): void {
    this.outline.visible = state !== null;
    if (state === null) return;
    // THE STATE'S COLOUR IS REMEMBERED, not only applied: a pulse brightens towards white and then has to come back
    // to the colour the state MEANS, and reading it back off the material would read the flash's own colour.
    this.baseColor.setHex(OUTLINE_COLOR[state]);
    this.celebrate(null);
  }

  /**
   * Apply one instant of the success pulse, or `null` to put the border back at rest.
   *
   * THE RING GROWS IN ITS OWN PLANE. The geometry is drawn in XY and the mesh is laid flat by a rotation about X, so
   * a scale on X and Y grows the square along the floor and a scale on Z would do nothing anyone can see. The growth
   * is `CELEBRATE_GROW` — MEASURED against the pair's geometry: the ring's half-size is 5.16 board units, 1.06 of it
   * is 5.47, and two boards' centres are 5.8 world units apart at the 2D scale, so a pulse on one board cannot reach
   * into the other.
   */
  celebrate(state: Pulse | null): void {
    const material = this.outline.material as THREE.MeshBasicMaterial;
    if (state === null) {
      material.opacity = OUTLINE_OPACITY;
      material.color.copy(this.baseColor);
      this.outline.scale.set(1, 1, 1);
      return;
    }
    material.opacity = OUTLINE_OPACITY * state.opacity;
    material.color.copy(this.baseColor).lerp(OUTLINE_HIGHLIGHT, state.whiten);
    this.outline.scale.set(state.scale, state.scale, 1);
  }

  /** Show or hide the whole board, for the slot that waits off-screen between slides. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Rescale the board for the view. See BOARD_SCALE_3D for why this is a per-view number. */
  setScale(scale: number): void {
    this.group.scale.set(scale, scale, scale);
  }

  /**
   * Move the board to a slot.
   *
   * THE SLOT FOLLOWS THE SCALE, not a constant: `centreFor(scale)` is what keeps two boards from overlapping
   * at the 3D scale, which they did while the centres were computed once from the 2D one.
   */
  setOffset(offsetX: number): void {
    this.group.position.x = offsetX;
  }

  /** Which representation to draw. See the module header for why only one may be on at a time. */
  setFlat(flat: boolean): void {
    this.flat = flat;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    for (const v of this.views) v.group.visible = !this.flat;
    for (const m of this.markers) m.visible = this.flat;
  }

  /**
   * Show `board`, with `poses` (indexed like `board.dancers`).
   *
   * THE DANCER SET IS REBUILT ONLY WHEN IT CHANGES. A `DancerView` bakes its avatar and number label at
   * construction, so rebuilding per frame would be both slow and visibly wrong — a fresh avatar every frame.
   * A board change WITHIN a puzzle never changes the set (identity is carried through), so this rebuilds on
   * the first draw and on a genuinely different set, and nothing else.
   *
   * THE WALK PHASE FOLLOWS THE BEAT, which is why this takes one: the POC advances `phase` from the beat so
   * the legs swing as the dancer travels, and the engine's walk now supplies a real beat for every frame. A
   * constant phase — the version this replaced — left the legs neutral, which was honest when the motion was
   * a chord and the pose came from nowhere; it is not honest now that the frame IS the dance.
   *
   * THE ARMS ARE POSED FROM THE HOLDS, which is what makes a ring or a line read as joined up: the hold
   * graph is derived from the poses (`computeHandholds(poses, 'static')`, the POC's own choice for an
   * evaluated board), and each edge aims two hands at the point between the dancers. See `poses.ts` for why a
   * board cannot carry an authored grip.
   *
   * THE HOLD POINT MUST BE CONVERTED TO WORLD SPACE, and this is the defect the browser found in the version
   * that added holds: `DancerView.update` documents its arm targets as WORLD points and converts them into the
   * avatar's own frame by inverting `matrixWorld`, so a BOARD-space point is interpreted as a world one. This
   * group is scaled (0.42 or 0.68) and translated to ±2.9, so every target landed a board-width away from the
   * dancer it belonged to: MEASURED in a 3D screenshot, every dancer had two arms stretched right across the
   * canvas, which read as a cat's cradle rather than as a set holding hands. The POC does not hit this because
   * its views sit in an untransformed group, where board and world coordinates coincide.
   */
  draw(board: Board, poses: readonly Pose[], walk: { phase: number }): void {
    const ids = board.dancers.map((d) => d.id);
    if (!sameIds(this.ids, ids)) this.rebuild(board);
    // WHICH THE CONVERSION BELOW NEEDS TO BE CURRENT FOR THIS FRAME: `localToWorld` reads `matrixWorld`, and
    // this group's transform is written once in the constructor, so without this the first frame converts
    // through a stale matrix.
    this.group.updateMatrixWorld(true);
    const holds = computeHandholds([...poses], 'static');
    const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
    for (const h of holds) {
      // Board (x, y) -> 3D (x, height, -y), then to WORLD through this board's own scale and offset. The
      // height is converted with the point rather than added afterwards, so the hands meet at the same place
      // the avatars' shoulders are — both are children of the same scaled group.
      const point = new THREE.Vector3((poses[h.i].x + poses[h.j].x) / 2, HOLD_HEIGHT, -(poses[h.i].y + poses[h.j].y) / 2);
      const hold = this.group.localToWorld(point);
      if (h.hi === 'left') targets[h.i].left = hold;
      else targets[h.i].right = hold;
      // The SAME Vector3 is handed to both hands: `update` clones it as it aims, and the two hands meeting at
      // one point is the whole meaning of a hold.
      if (h.hj === 'left') targets[h.j].left = hold;
      else targets[h.j].right = hold;
    }
    for (let i = 0; i < this.views.length; i++) {
      const pose = poses[i] ?? { x: board.dancers[i].x, y: board.dancers[i].y, heading: board.dancers[i].heading, hands: 'both' as const };
      this.views[i].update(pose, targets[i], walk);
      const marker = this.markers[i];
      if (marker) {
        // Board (x, y) -> 3D (x, 0, -y), and a heading of 0 faces +x, so the marker's y-rotation IS the
        // heading. The same mapping `poc/src/browser.ts` uses; it is stated twice because a wrong sign here
        // is a board that looks plausibly mirrored rather than obviously broken.
        marker.position.set(pose.x, 0, -pose.y);
        marker.rotation.y = pose.heading;
      }
    }
  }

  private rebuild(board: Board): void {
    for (const v of this.views) {
      this.group.remove(v.group, v.trail, v.trailHighlight, v.facingTicks, v.selectionRing);
    }
    for (const m of this.markers) this.group.remove(m);
    this.views.length = 0;
    this.markers.length = 0;
    this.ids = board.dancers.map((d) => d.id);
    for (const [i, d] of board.dancers.entries()) {
      // EVERY BOARD IS DRAWN IN FOUR COLOURS, WHICH IT WAS NOT. The engine knows a dancer's home couple only for the
      // handful of formations it can identify (MEASURED at level 1: 6 of the 44 start boards, so 38 came back with
      // `couple: 0` on every dancer and `coupleColor(0)` is one grey) — reported as "can the game boards display the
      // dancer couple colours, even if the formations aren't in the start formations list".
      //
      // `displayCouple` is the SHARED rule (`packages/stage`), and the game passes `enabled: true` for every board:
      // it draws no couple NUMBER and no head/side letter for an unknown couple (see `labelled` below), so the colour
      // says only "these two are a pair in this formation's authored order" — and telling eight dancers apart is the
      // colour's whole job here. Where the engine DOES know the couples they win, because the first branch returns
      // `d.couple`. The POC gates the same function by formation name because its boards are read for couple numbers,
      // which is a different screen with a different claim; both call one function rather than keeping two copies.
      const knownCouple = typeof d.couple === 'number' && d.couple > 0;
      const couple = displayCouple(d, i, true);
      // `DancerView` READS ONLY `gender` AT CONSTRUCTION — the avatar shape and its colour — so the rest of
      // `DancerSpec` is empty ON PURPOSE. `x`/`y`/`angleDeg` are the pose it is HANDED every frame by
      // `update`, and `path` is the authored track that only a call bundle has; a drill board is a snapshot,
      // not a track. Filling them from the board would be a second, stale copy of the pose.
      //
      // THE NUMBER LABEL IS ONLY FOR A COUPLE THE ENGINE ACTUALLY KNOWS. `DancerView` can draw "1h"/"3s" beside an
      // avatar, and for a pair derived from the array order that would assert a head or a side nobody measured.
      const view = new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, couple, false, knownCouple);
      // NO TRAIL, AND IT IS SET RATHER THAN LEFT ALONE. `DancerView` builds a trail with an EMPTY geometry,
      // which draws nothing today — but a trail is the PATH a call walks and a drill board is a snapshot with
      // no path, so saying so explicitly means a later change to the view's defaults cannot start drawing a
      // track this game has no track for. The highlight, the facing ticks and the selection ring all start
      // hidden inside `DancerView` itself, so they need nothing here.
      view.setTrail([]);
      const marker = buildFlatMarker(d.gender, couple);
      this.group.add(view.group, view.trail, view.trailHighlight, view.facingTicks, view.selectionRing, marker);
      this.views.push(view);
      this.markers.push(marker);
    }
    this.applyVisibility();
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The four border facts of a pair, in the shape `celebrate.ts` reads.
 *
 * THE ADAPTER IS FOUR LINES AND IT EARNS THEM: `StagePair` carries the pair's BOARDS and their STATES, while the rule
 * about which border just turned solved is arithmetic over four values and is shared with the caption side. Passing
 * the whole pair would couple that rule to a type that holds `Board`s, and a copy of it here would be a second
 * implementation of a rule a probe already pins.
 */
function reading(pair: StagePair): BorderReading {
  return { leftIndex: pair.leftIndex, rightIndex: pair.rightIndex, left: pair.leftState, right: pair.rightState };
}

/**
 * THE TWO BOARDS AND WHAT THEIR BORDERS SAY.
 *
 * A puzzle is a sequence of WAYPOINTS (a waypoint is a formation), so the pair is two adjacent waypoints of ONE
 * puzzle: the left is where the player stands — their own board while the pair is live — and the right is the
 * waypoint to reach. The indices travel with the boards because a change of pair is a SLIDE rather than a redraw.
 */
export interface StagePair {
  /** The board in the left slot: the player's board, or an in-progress motion frame during a replay. */
  left: Board;
  /** The waypoint to reach. */
  right: Board;
  leftIndex: number;
  rightIndex: number;
  leftState: WaypointState;
  rightState: WaypointState;
}

/** The whole game's view: the stage, the boards, and the 2D/3D switch — shared by both modes. */
export class GameStage {
  private readonly stage: Stage;
  /**
   * THE THREE SLOTS. Two are the pair on screen and the third waits off to the right for a slide; the ROLES rotate
   * on commit, so these are not `readonly` even though each one is created once.
   */
  private left: BoardView;
  private right: BoardView;
  private incoming: BoardView;
  private mode: ViewMode = '2d';
  private scale = BOARD_SCALE;
  /** The pair the boards are showing, and the slide in progress if there is one. */
  private pair: StagePair | null = null;
  private slide: { from: StagePair; to: StagePair; direction: 1 | -1; startMs: number } | null = null;
  /**
   * The success pulse in flight, if any: WHICH SLOT currently holds the border that just turned solved, and when the
   * pulse began.
   *
   * IT IS A SLOT RATHER THAN A BOARD because the board moves: a solve slides the solved board from the right slot to
   * the left one, and `commitSlide` moves the pulse with it, so the flash follows the board the player earned instead
   * of jumping to whatever the new right-hand waypoint is.
   */
  private celebration: { slot: 'left' | 'right'; startMs: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // `floor: false` BECAUSE EACH BOARD BRINGS ITS OWN (see `BoardView`): the stage drawing one too would put
    // a third grid across both of them, which is the picture this change is fixing.
    this.stage = createStage(canvas, { floor: false });
    // THE BOARD GROUPS ARE PLACED BY THE SAME ARITHMETIC THAT SETS THE SCALE, so a change to one cannot silently
    // pull them into each other.
    const centre = centreFor(BOARD_SCALE);
    this.left = new BoardView(this.stage.scene, -centre);
    this.right = new BoardView(this.stage.scene, centre);
    this.incoming = new BoardView(this.stage.scene, 3 * centre);
    this.incoming.setVisible(false);
    // THE FLAT VIEW FIRST, because the design asks for it first and because a Drill question is geometry:
    // "which of these leaves the set where the waypoint is" reads more clearly on a flat board than through an
    // orbit camera. The 3D view is one button away and shows the same two boards.
    this.setMode('2d');
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    // A VIEW SWITCH ENDS ANY SLIDE: the geometry it was animating has changed under it, and half a transition in the
    // other projection would land the boards in slots the new view does not use. The pulse ends with it, because its
    // size is a multiplier of a ring in the board's own coordinates and the ring has just been rescaled.
    this.cancelSlide();
    this.stopCelebration();
    this.stage.setView2D(mode === '2d');
    const flat = mode === '2d';
    const scale = flat ? BOARD_SCALE : BOARD_SCALE_3D;
    this.scale = scale;
    const centre = centreFor(scale);
    for (const board of [this.left, this.right, this.incoming]) {
      board.setFlat(flat);
      board.setScale(scale);
    }
    // THE SLOTS ARE RE-DERIVED, not left where the other view put them: at the 3D scale a board is wider than
    // its 2D slot, so a constant offset overlaps the pair — see `centreFor`.
    this.left.setOffset(-centre);
    this.right.setOffset(centre);
    this.incoming.setOffset(3 * centre);
    // THE CAMERA IS TOLD WHAT TO FIT, per view: the two views use different board scales and so reach
    // different distances from the centre. Without this the 3D view is framed for one floor and crops the
    // outer half of each board — see `arenaHalf`.
    this.stage.setFrameHalf(arenaHalf(scale));
    this.resize();
  }


  /**
   * Draw the pair: the two boards and the border each one carries.
   *
   * THE PAIR IS THE ONLY DRAWING ENTRY POINT, because the two boards are two WAYPOINTS of one puzzle rather than a
   * start and a goal — the left one is where the player stands (and, at the front, their own board) and the right one
   * is the waypoint to reach. When the LEFT INDEX CHANGES the pair SLIDES rather than jumping (`slide-math.ts`): the
   * left board leaves, the right one takes its place, and the next waypoint arrives from the right.
   *
   * A CALL MADE EVERY FRAME IS THE NORMAL CASE — the shell's `draw()` runs from the animation loop — so a pair equal
   * to the one on screen is a redraw, and a pair whose index has not moved is never a slide.
   *
   * AND THE ADVANCE IS CELEBRATED when it is a SUCCESS rather than a page (`celebrate.ts`): the board the player just
   * reached flashes its border, and because that board is the one the slide moves to the left slot, the flash rides
   * with it. REPORTED: "there is no feedback other than changing the outline colour ... it jumps to the next waypoint
   * instantly, and this is confusing".
   */
  drawPair(pair: StagePair): void {
    if (this.slide) {
      // DURING A SLIDE THE TARGET WINS ONLY IF IT IS THE SAME TARGET; a pair that has moved AGAIN inside 320 ms has
      // no sensible in-between, so the newer one is committed at once rather than queued.
      if (pair.leftIndex === this.slide.to.leftIndex) return;
      this.cancelSlide();
    }
    const previous = this.pair;
    this.pair = pair;
    const solved = previous === null ? null : justSolved(reading(previous), reading(pair));
    const advanced = previous !== null && previous.leftIndex !== pair.leftIndex;
    if (advanced && !prefersReducedMotion()) {
      // THE SLIDE OWNS THE CELEBRATION. The solved board is still in the RIGHT slot when the slide begins, and
      // `commitSlide` moves the pulse to the left slot when the roles rotate, so there is one celebration and it does
      // not restart halfway.
      this.startSlide(previous, pair, solved === 'left');
      return;
    }
    this.paint(pair.left, pair.right, pair.leftState, pair.rightState);
    // NO SLIDE TO RIDE: the goal (both indices stay put) or the reduced-motion path, where the pair jumped and the
    // solved board is already in the slot it belongs in. A reduced-motion preference skips the TRANSLATION, not the
    // flash: a fade is not motion, one pulse in 520 ms is not a strobe, and the player asked for less movement rather
    // than for the success to be invisible.
    if (solved === 'left') this.startCelebration('left', performance.now());
    if (solved === 'right') this.startCelebration('right', performance.now());
  }

  /**
   * Draw the left board MID-MOTION at `beat`, with the right-hand waypoint still.
   *
   * THE FRAME COMES FROM THE ENGINE, not from an interpolation here: `motion.at(beat)` is the engine's own
   * walk of the calls, so the picture and the verdict are computed from the same evaluation (DESIGN.md 4.3).
   * At `beat = motion.beats` this draws the board the whole list ends on, which is what a finished replay
   * must settle on; at `beat = 0` it draws the board the list starts from.
   *
   * THE BORDERS DO NOT MOVE WITH THE REPLAY: they describe the waypoint the pair is showing, which a motion
   * inside one stage does not change. A MOTION CANCELS A SLIDE, because the pair it was animating to is the pair
   * this replay is now about.
   *
   * AND THE PAIR IS NOT ADOPTED HERE — the defect this closes. It used to assign `this.pair = pair`, and the pair a
   * motion is drawn FOR is the one the move has already produced — so by the time the replay ended, the stage
   * believed it had already shown the next waypoint and the change was a repaint rather than a slide. REPORTED as
   * "it jumps to the next waypoint instantly": the pair moved with no transition at all, at the one moment the
   * player was watching the board. Leaving `this.pair` alone is what makes the next `drawPair` see the index change
   * and animate it.
   */
  drawMotion(motion: SequenceMotion, pair: StagePair, beat: number): void {
    this.cancelSlide();
    const frame = motion.at(beat);
    this.left.draw(frame, stillBoard(frame), walkAt(beat));
    this.left.setOutline(pair.leftState);
    this.right.draw(pair.right, stillBoard(pair.right), WALK_STILL);
    this.right.setOutline(pair.rightState);
  }

  /**
   * Advance a slide and the success pulse. Call once per frame, BEFORE `render` — like `updateControls`, this writes
   * the scene graph and paints nothing, so a frame that skips it leaves the boards frozen mid-transition.
   */
  tick(nowMs: number): void {
    const celebration = this.celebration;
    if (celebration) {
      const t = (nowMs - celebration.startMs) / CELEBRATE_MS;
      if (t >= 1) this.stopCelebration();
      else this.slotView(celebration.slot).celebrate(pulse(t));
    }
    const slide = this.slide;
    if (!slide) return;
    const t = Math.min(Math.max((nowMs - slide.startMs) / SLIDE_MS, 0), 1);
    if (t >= 1) {
      this.commitSlide();
      return;
    }
    const offsets = slideOffsets(t, centreFor(this.scale), slide.direction);
    this.left.setOffset(offsets.left);
    this.right.setOffset(offsets.right);
    this.incoming.setOffset(offsets.incoming);
  }

  /** Stop any slide where it is, putting the boards back in their resting slots. */
  cancelSlide(): void {
    if (!this.slide) return;
    this.slide = null;
    this.restSlots();
  }

  /**
   * Start the success pulse on a slot, replacing any pulse already running.
   *
   * THE PULSE OUTLIVES A CANCELLED SLIDE and a motion that interrupts it (`drawMotion` cancels slides every frame, so
   * a celebration that stopped with the slide would be cancelled by the next move before it was ever seen). It ends
   * where it should: on its own clock, and when the puzzle changes (`forgetPair`).
   */
  private startCelebration(slot: 'left' | 'right', startMs: number): void {
    this.stopCelebration();
    this.celebration = { slot, startMs };
  }

  /** Put every border back at rest and forget the pulse. */
  private stopCelebration(): void {
    this.celebration = null;
    this.left.celebrate(null);
    this.right.celebrate(null);
    this.incoming.celebrate(null);
  }

  /** The board view in a slot, for a pulse that names a slot. */
  private slotView(slot: 'left' | 'right'): BoardView {
    return slot === 'left' ? this.left : this.right;
  }

  /**
   * Forget what was drawn, so the next pair is PAINTED rather than SLID TO.
   *
   * A NEW PUZZLE IS NOT A STEP ALONG THE OLD ROUTE: the two boards of the next drill have no spatial relationship to
   * the two of this one, so animating from one pair to the other would claim a continuity that does not exist. Every
   * path that puts a different puzzle on screen calls this, and only a change of waypoint inside one puzzle slides.
   */
  forgetPair(): void {
    this.cancelSlide();
    this.stopCelebration();
    this.pair = null;
  }

  /** The two resting slots, and the incoming board parked off to the right and hidden. */
  private restSlots(): void {
    const centre = centreFor(this.scale);
    this.left.setOffset(-centre);
    this.right.setOffset(centre);
    this.incoming.setOffset(3 * centre);
    this.incoming.setVisible(false);
  }

  /** Draw one board in each slot, with its border. */
  private paint(left: Board, right: Board, leftState: WaypointState, rightState: WaypointState): void {
    this.left.draw(left, stillBoard(left), WALK_STILL);
    this.left.setOutline(leftState);
    this.right.draw(right, stillBoard(right), WALK_STILL);
    this.right.setOutline(rightState);
  }

  /**
   * Begin a slide from `from` to `to`: three boards drawn, then the slots moved.
   *
   * THE THREE BOARDS ARE DRAWN ONCE, at the start: the content is a snapshot for the 320 ms of the animation, and the
   * only thing that changes per frame is where each group sits. Drawing them per frame would rebuild nothing (the
   * dancer ids are stable) but would still re-pose every dancer 20 times for a picture nobody is looking at.
   *
   * WHICH BOARD ARRIVES DEPENDS ON THE DIRECTION. Forward, the pair advances by moving LEFT, so the board that comes
   * in is the target's RIGHT one and it enters from off the right. Back, everything mirrors: the board that comes in
   * is the target's LEFT one and it enters from off the LEFT, because the board already on screen is moving right.
   *
   * `celebrate` IS THE SUCCESS, and a success is always a FORWARD advance (`celebrate.ts` only reports one when the
   * arriving board was the pending one), so the board leaving the right slot is the one the player just reached and
   * its border is painted SOLVED for the whole slide (not the `next` blue of the pair it is arriving from — the state
   * changed the moment the move landed, and a motion may already have drawn it green, so repainting the old state here
   * would make the success flicker back to "not yet"). `startMs` is the slide's own start, so the pulse and the
   * movement begin on the same frame.
   */
  private startSlide(from: StagePair, to: StagePair, celebrate: boolean): void {
    const direction: 1 | -1 = to.leftIndex > from.leftIndex ? 1 : -1;
    this.left.draw(from.left, stillBoard(from.left), WALK_STILL);
    this.left.setOutline(from.leftState);
    this.right.draw(from.right, stillBoard(from.right), WALK_STILL);
    this.right.setOutline(celebrate ? 'solved' : from.rightState);
    const arriving = direction === 1 ? to.right : to.left;
    this.incoming.draw(arriving, stillBoard(arriving), WALK_STILL);
    this.incoming.setOutline(direction === 1 ? to.rightState : to.leftState);
    this.incoming.setVisible(true);
    const startMs = performance.now();
    this.slide = { from, to, direction, startMs };
    if (celebrate) this.startCelebration('right', startMs);
    this.tick(startMs);
  }

  /**
   * Finish a slide: ROTATE THE ROLES rather than copying content, because the boards are already in the right places.
   *
   * At `t = 1` every board is exactly in the slot the new pair wants it in, so the three views keep their content and
   * only their NAMES change. That is why the commit cannot jump: nothing moves. The rotation is the direction's
   * mirror: forward the old RIGHT becomes the left board and the arriving one becomes the right; back, the old LEFT
   * becomes the right board and the arriving one becomes the left.
   *
   * THE SUCCESS PULSE RIDES THE ROTATION, which is why it names a SLOT: the solved board has just become the LEFT one,
   * so a pulse still aimed at the right slot would flash the waypoint the player has NOT reached yet — the opposite of
   * what it means.
   */
  private commitSlide(): void {
    const slide = this.slide;
    if (!slide) return;
    this.slide = null;
    if (slide.direction === 1) {
      const leaving = this.left;
      this.left = this.right;
      this.right = this.incoming;
      this.incoming = leaving;
      if (this.celebration) this.celebration.slot = 'left';
    } else {
      const leaving = this.right;
      this.right = this.left;
      this.left = this.incoming;
      this.incoming = leaving;
    }
    this.restSlots();
    if (this.pair) this.paint(this.pair.left, this.pair.right, this.pair.leftState, this.pair.rightState);
  }

  resize(): void {
    this.stage.resize();
  }

  /**
   * Tell the stage how much of the canvas the floating panel covers, so the two boards are framed in the
   * space that is LEFT rather than centred under the panel.
   *
   * CARRIED OVER FROM THE POC, WHERE IT WAS A REPORTED DEFECT: "the board seems to be centralised to the
   * screen, but it hasn't taken into account that the left hand dialog changes the visible board to the right
   * hand side". The panel is `position: absolute` over the canvas, so without this the left board's dancers
   * sit underneath it.
   */
  setViewInsets(insets: { left?: number; right?: number; top?: number; bottom?: number }): void {
    this.stage.setViewInsets(insets);
  }

  /** Call once per frame: advances the orbit/pan damping. */
  updateControls(): void {
    this.stage.updateControls();
  }

  /**
   * Call once per frame, AFTER `updateControls`: paint the frame from whichever camera is on screen.
   *
   * SEPARATE FROM `draw`, AND BOTH ARE NEEDED. `draw` writes poses into the scene graph; `render` paints it.
   * A loop that calls only `draw` shows a blank canvas — the bug this method exists to close. The camera
   * choice deliberately stays inside `Stage.render`, because the stage owns both cameras and a caller picking
   * one is how the flat view ends up drawn through the 3D camera.
   */
  render(): void {
    this.stage.render();
  }
}
