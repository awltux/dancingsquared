// High-level convenience wrapper around the converter + core + handholds.
// Parse the (global) moves.xml and formations.xml once, then load any call XML.

import { buildCall, callMeta, parseCallXml, parseFormations, parseMoves } from './convert.js';
import { allPoses, type HeadingMode } from './core.js';
import { computeHandholds, type HoldMode } from './handholds.js';
import type { CallBundle, Pose } from './types.js';

export class Engine {
  private moves: ReturnType<typeof parseMoves>;
  private formations: ReturnType<typeof parseFormations>;

  constructor(movesXml: string, formationsXml: string) {
    this.moves = parseMoves(movesXml);
    this.formations = parseFormations(formationsXml);
  }

  /** Load a call from its XML, resolving moves/formations against this engine. */
  loadCall(callXml: string, tamIndex = 0, mirror = true): CallBundle {
    const tams = parseCallXml(callXml);
    const tam = tams[tamIndex] ?? tams[0];
    if (!tam) throw new Error('No <tam> in call XML');
    return buildCall(tam, this.formations, this.moves, mirror);
  }

  /** All <tam> variants of a call (each a start formation + paths). */
  loadCallVariants(callXml: string, mirror = true): CallBundle[] {
    return parseCallXml(callXml).map((tam) => buildCall(tam, this.formations, this.moves, mirror));
  }

  /** Metadata (title + setups) for a call XML. */
  callMeta(callXml: string) {
    return callMeta(callXml);
  }

  /** All dancer poses at a beat. */
  poses(call: CallBundle, beat: number, headingMode: HeadingMode = 'rotation'): Pose[] {
    return allPoses(call, beat, headingMode);
  }

  /** Hand holds derived from a set of poses. */
  handholds(poses: Pose[], mode: HoldMode = 'active') {
    return computeHandholds(poses, mode);
  }
}
