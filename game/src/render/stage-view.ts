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
import { DancerView, buildBoardFloor, buildFlatMarker, createStage, type Stage } from 'dancing-squared-stage';
import { computeHandholds, type Board, type Pose } from 'dancing-squared-engine';
import { stillBoard } from '../game/poses.ts';
import type { SequenceMotion } from '../puzzle/types.ts';

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

/** One board: its own group, one dancer view per dancer, one flat marker per dancer. */
class BoardView {
  private readonly group = new THREE.Group();
  private readonly views: DancerView[] = [];
  private readonly markers: THREE.Group[] = [];
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
    scene.add(this.group);
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
    for (const d of board.dancers) {
      const couple = d.couple ?? 0;
      // `DancerView` READS ONLY `gender` AT CONSTRUCTION — the avatar shape and its colour — so the rest of
      // `DancerSpec` is empty ON PURPOSE. `x`/`y`/`angleDeg` are the pose it is HANDED every frame by
      // `update`, and `path` is the authored track that only a call bundle has; a drill board is a snapshot,
      // not a track. Filling them from the board would be a second, stale copy of the pose.
      const view = new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, couple);
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

/** The whole game's view: the stage, the two boards, and the 2D/3D switch — shared by both modes. */
export class GameStage {
  private readonly stage: Stage;
  private readonly start: BoardView;
  private readonly goal: BoardView;
  private mode: ViewMode = '2d';

  constructor(canvas: HTMLCanvasElement) {
    // `floor: false` BECAUSE EACH BOARD BRINGS ITS OWN (see `BoardView`): the stage drawing one too would put
    // a third grid across both of them, which is the picture this change is fixing.
    this.stage = createStage(canvas, { floor: false });
    // THE TWO BOARD GROUPS ARE PLACED BY THE SAME ARITHMETIC THAT SETS THE SCALE, so a change to one cannot
    // silently pull them into each other.
    this.start = new BoardView(this.stage.scene, -centreFor(BOARD_SCALE));
    this.goal = new BoardView(this.stage.scene, centreFor(BOARD_SCALE));
    // THE FLAT VIEW FIRST, because the design asks for it first and because a Drill question is geometry:
    // "which of these leaves the set where the goal is" reads more clearly on a flat board than through an
    // orbit camera. The 3D view is one button away and shows the same two boards.
    this.setMode('2d');
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.stage.setView2D(mode === '2d');
    const flat = mode === '2d';
    const scale = flat ? BOARD_SCALE : BOARD_SCALE_3D;
    const centre = centreFor(scale);
    for (const board of [this.start, this.goal]) {
      board.setFlat(flat);
      board.setScale(scale);
    }
    // THE SLOTS ARE RE-DERIVED, not left where the other view put them: at the 3D scale a board is wider than
    // its 2D slot, so a constant offset overlaps the pair — see `centreFor`.
    this.start.setOffset(-centre);
    this.goal.setOffset(centre);
    // THE CAMERA IS TOLD WHAT TO FIT, per view: the two views use different board scales and so reach
    // different distances from the centre. Without this the 3D view is framed for one floor and crops the
    // outer half of each board — see `arenaHalf`.
    this.stage.setFrameHalf(arenaHalf(scale));
    this.resize();
  }


  /** Draw both boards at rest. */
  drawStill(startBoard: Board, goalBoard: Board): void {
    this.start.draw(startBoard, stillBoard(startBoard), WALK_STILL);
    this.goal.draw(goalBoard, stillBoard(goalBoard), WALK_STILL);
  }

  /**
   * Draw the left board MID-MOTION at `beat`, with the goal board still.
   *
   * THE FRAME COMES FROM THE ENGINE, not from an interpolation here: `motion.at(beat)` is the engine's own
   * walk of the calls, so the picture and the verdict are computed from the same evaluation (DESIGN.md 4.3).
   * At `beat = motion.beats` this draws the board the whole list ends on, which is what a finished replay
   * must settle on; at `beat = 0` it draws the board the list starts from.
   */
  drawMotion(motion: SequenceMotion, goalBoard: Board, beat: number): void {
    const frame = motion.at(beat);
    this.start.draw(frame, stillBoard(frame), walkAt(beat));
    this.goal.draw(goalBoard, stillBoard(goalBoard), WALK_STILL);
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
