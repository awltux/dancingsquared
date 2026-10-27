// A SUBWHOLE-SET AUTHORING PLACED ON A WHOLE-SET BOARD — the "virtual call".
//
// THE PROBLEM, MEASURED. Part of the corpus is authored for PART of the set, so it cannot be applied from a
// whole-set board at all: `ms/promenade.xml`'s `Promenade` from `Facing Couples Far` writes TWO dancers and
// `Promenade - Keep Walking` from `Two-Faced Lines LH` writes FOUR, and their start poses are literally slots of
// a square (`(-2,±1) (-2,±3)`). `deriveFormationMapping` refuses that by design ("cannot align 8 dancers to a
// 4-dancer core"), `findMatchingVariant` skips a subset match on purpose (`matcher.ts`: "handled by the
// parallel-subset path"), and `parallelApply` tiles such a unit but produces no bundle — so a caller that wants
// ONE whole-board call to draw or to name has nothing to ask. This module is that missing answer: a `CallBundle`
// with one path per board dancer.
//
// THE OWNER'S CONSTRAINT, AND IT IS THE ACCEPTANCE CRITERION.
//
//     ALL VIRTUAL VARIANTS MUST START AND END ON A KNOWN FORMATION.
//
// The start is the board's own formation, so it must be NAMED by the engine's namer rather than assumed from the
// board we were handed — `knownFormation` refuses a board that is close to nothing, a board with one dancer too
// far out, and a board whose best match is TIED, so a name here is an identity rather than a best guess (AGENTS
// §8 trap 10). The end is the same test on the placed result, and a candidate whose end is unnamed is DROPPED,
// not returned: a variant that finishes on a scattered set of spots cannot be sequenced, drawn or reasoned about.
//
// THAT CONSTRAINT DOUBLES AS THE ARBITER between the two shapes of answer. A `partial` placement leaves the
// dancers it does not use standing on their own spots, which is almost never a named formation, while a `tiled`
// one moves every dancer and usually is — so the cases that matter are decided by the constraint itself rather
// than by a preference this file invents.
//
// WHAT IS REUSED RATHER THAN RE-DERIVED (§11.4.4).
//   - `matchFormations` / `matchFormationsAll` (`match.ts`) do the placement search: rotations at 45 degrees, the
//     optional reflection, the gender rule, and — for `matchFormationsAll` — pairwise-DISJOINT copies, which is
//     exactly what a tiling is.
//   - `boardMatchables` (`cells.ts`) is the board's shape for those.
//   - `normalizeInstance` (`editor.ts`) materialises a half-set variant into full-set coordinates. It is not
//     optional: a mirrored dancer's `path` is replayed with the pose negated, so copying it verbatim would place
//     a track that starts somewhere else.
//   - `padSegment` (`editor.ts`) is the hold: `from === to` gives a zero-length travel curve and a zero turn, so
//     a dancer who does not move is still one path of the call's own length.
//
// WHY THE PLACED PATH IS COPIED VERBATIM, which is why this file is small. A path is authored in DANCER-LOCAL
// coordinates (`types.ts`: the origin is the dancer's spot when the move begins, +X the facing), so a placement
// that is a pure ROTATION plus translation leaves every local path unchanged — the dancer turns with the set and
// their own track is the same. Only a REFLECTED placement would need the track mirrored, and a reflection is
// writable only about the dancer's own axes: reflecting a track about any other line puts the facing curve's
// first control off the local +X axis, which the format has no `cy3` for (AGENTS.md §8 trap 18, MEASURED at 444
// of 444 diagonal facings unrepresentable). So this module REFUSES a reflected placement BY NAME instead of
// approximating one, and the sweep reports how often that is the only placement available.

import { allPoses, poseFor } from '../core.js';
import { normalizeInstance, padSegment, cloneSegs } from '../editor.js';
import { matchFormations, matchFormationsAll, type Matchable } from './match.js';
import { boardMatchables } from './cells.js';
import { formationId } from './formation-id.js';
import { DEFAULT_MATCH_MAX, UNKNOWN_COUPLE } from './constants.js';
import type { Board, SeqDancer } from './types.js';
import type { CallBundle, DancerSpec, Seg, VirtualCallInfo } from '../types.js';

/** `tiled`: every board dancer dances a copy of the source. `partial`: one placement dances, the rest hold. */
export type VirtualKind = 'tiled' | 'partial';

/** The namer, injected: `knownFormation` is the engine's own answer to "is this board a known formation". */
export type FormationNamer = (board: Board) => string | null;

/**
 * ONE COPY OF THE SOURCE, ONTO THE BOARD.
 *
 * `from` is the only correspondence that matters: board index -> source dancer index. It is a Map rather than
 * two parallel arrays because `FormationMatch` indexes the OTHER way round (`mapping[boardIdx]` is only valid
 * against the array it was computed on) and a subset match leaves `-1` in the rest of it — the exact shape of
 * mistake that has already been made once in this tree, so the type here rules it out.
 */
export interface PlacementCopy {
  from: ReadonlyMap<number, number>;
}

export interface VirtualOptions {
  /** Placement tolerance, the same quantity `findMatchingVariant` takes (`DEFAULT_MATCH_MAX`). */
  matchTol?: number;
  /**
   * The board indices the caller would PREFER the source to occupy — resolved from the variant's own `actives`
   * declaration by the layer that knows what "Heads" means (`Sequencer`), never by this module.
   */
  preferPlacement?: number[];
}

export interface VirtualCandidate {
  /** The placed whole-board call. `virtual` is set; every other declaration is copied from the source. */
  bundle: CallBundle;
  /** The end board, read with `poseFor` at the bundle's own length — the reader the engine uses everywhere. */
  end: Board;
  /** The start formation, as the namer names the board the call was placed on. */
  startFormation: string;
  /** The end formation, as the namer names `end`. Never null: an unnamed end is a dropped candidate. */
  endFormation: string;
  kind: VirtualKind;
  /** The placement error, summed over the dancers by `matchFormations`. */
  error: number;
  /** `placement[copy][j]` is the board index that took source dancer `j` — one row per copy (see `VirtualCallInfo`). */
  placement: number[][];
}

export type VirtualOutcome =
  | { legal: true; candidates: VirtualCandidate[] }
  | { legal: false; reason: string; tried: string };

/** Two placement errors closer than this are the same error — the epsilon the matcher uses for a reflection tie. */
const CHOICE_TIE_EPS = 1e-6;

/**
 * Place one or more disjoint copies of `variant` onto `board`.
 *
 * `copies` holds one entry per copy: `tiled` passes `n / k` of them (a partition of the physical dancers) and
 * `partial` passes one. Every placement must be REFLECTION-FREE; that refusal belongs to `resolveVirtual`, where
 * the candidate is decided on, so a reflected one reaching here is a programming error and throws.
 *
 * `startFormation` is the board's own formation name — the name this call now starts from, and the reason the
 * result can be exported as a named reference rather than as an anonymous inline block.
 *
 * THE RESULT IS IN BOARD ORDER, ghosts included: index `i` of the bundle is index `i` of the board, so nothing
 * downstream carries a permutation (`reorderLike` exists because a rebuilt board that comes back in another
 * order is a defect, AGENTS §4.3).
 */
export function placeVirtual(
  board: Board,
  variant: CallBundle,
  copies: readonly PlacementCopy[],
  kind: VirtualKind,
  startFormation: string,
): CallBundle {
  const source = normalizeInstance(variant);
  const beats = source.beats;
  const cover = new Map<number, { copy: number; from: number }>();
  for (const [copy, c] of copies.entries()) {
    for (const [at, sj] of c.from) {
      if (cover.has(at)) throw new Error(`placeVirtual: board index ${at} is covered by two placements`);
      if (sj < 0 || sj >= source.dancers.length) {
        throw new Error(`placeVirtual: a placement points at source dancer ${sj}, which the variant does not have`);
      }
      cover.set(at, { copy, from: sj });
    }
  }
  const placement: number[][] = copies.map(() => source.dancers.map(() => -1));
  const placed = board.dancers.map((d, i) => {
    const hit = cover.get(i);
    if (hit === undefined) {
      // NOT USED BY THIS CALL: one zero-length move of the call's own length, so every path is one length.
      const pose = { x: d.x, y: d.y, heading: d.heading };
      return spec(d, [padSegment(pose, pose, beats)]);
    }
    placement[hit.copy][hit.from] = i;
    return spec(d, cloneSegs(source.dancers[hit.from].path));
  });
  placement.forEach((copy, index) => {
    const missing = copy.indexOf(-1);
    if (missing >= 0) {
      throw new Error(`placeVirtual: copy ${index} never placed source dancer ${missing} — a placement must cover every source dancer`);
    }
  });
  const info: VirtualCallInfo = {
    sourceTitle: source.title,
    sourceFormation: source.formation,
    // THE AUTHORING'S OWN START, priced from the source's first poses. `formationCanonical` reads x, y and
    // heading and nothing else - its header says so ("WHAT IT IGNORES, DELIBERATELY: gender, and every slot of
    // home identity") - which is why `FormationBoard` accepts a bare pose list: a virtual call's source has no
    // dancer identity to carry, and inventing one would be inventing identity for a digest that ignores it.
    sourceStart: formationId({ dancers: allPoses(source, 0) }),
    // THE SOURCE DEFINITION'S STORED TAG, when it authored its own setup. `sourceStart` above is a CONTENT ADDRESS
    // and moves with a geometry correction; the tag is the reference, and this is the last place the source board
    // exists to read it from. A source that NAMES a formation carries no inline tag - the caller resolves that
    // definition's tag by name (`book/tools/lib/variants.mjs`), which is why this is null rather than derived.
    sourceFid: source.formationTag?.fid ?? null,
    sourceSize: source.dancers.length,
    placement,
    kind,
  };
  return {
    title: source.title,
    // The board's own formation is what this call now starts from, and `formation` says so as a NAME so an
    // export can be a reference. `from` is the free-text field a reader shows.
    from: startFormation,
    formation: startFormation,
    // A SYNTHESISED variant is not a corpus definition, so it carries no stored tags; what identifies it is
    // `virtual.sourceStart` (the source authoring's own formation id), already carried below.
    formationTag: { fid: null, aid: null, sid: null },
    // NO STORED VARIANT TAG EITHER: `vid` names an authoring the corpus wrote, and this bundle is one the engine
    // built. Its provenance is `virtual` below.
    vid: null,
    parts: source.parts,
    taminator: source.taminator,
    dancers: placed,
    beats,
    leadin: source.leadin,
    leadout: source.leadout,
    totalBeats: source.leadin + beats + source.leadout,
    sequencerMode: source.sequencerMode,
    forSequencer: source.forSequencer,
    genderSpecific: source.genderSpecific,
    // WRITTEN OUT IN FULL, so nothing completes it again: a virtual call is an eight-dancer authoring.
    symmetry: 1,
    actives: source.actives,
    going: source.going,
    virtual: info,
  };
}

/**
 * Every candidate this board admits for `variants`, with the owner's start/end-named test applied.
 *
 * `variants` is the caller's slice — normally `library.matchableVariants(callName)`. It is passed in rather than
 * looked up so that this function is pure: the same board and the same list give the same candidates, with no
 * library, no cache and no ambient state, which is what lets a harness pin it.
 */
export function resolveVirtual(
  board: Board,
  variants: readonly CallBundle[],
  namer: FormationNamer,
  opts: VirtualOptions = {},
): VirtualOutcome {
  const tol = opts.matchTol ?? DEFAULT_MATCH_MAX;
  const title = variants[0]?.title ?? 'that call';
  const startFormation = namer(board);
  if (startFormation === null) {
    return {
      legal: false,
      reason: `the board is not a formation the engine names, so a virtual ${title} has no start to declare`,
      tried: 'the start board',
    };
  }
  const phys = board.dancers.filter((d) => !d.isGhost);
  const n = phys.length;
  // PHYS order is what the match sees; BOARD order is what the bundle is written in. Keep the bridge explicit.
  const boardIndexOf = phys.map((d) => board.dancers.indexOf(d));
  const source = boardMatchables({ dancers: phys });

  const placements: { variant: CallBundle; copies: PlacementCopy[]; kind: VirtualKind; error: number }[] = [];
  const reasons = new Map<string, number>();
  const note = (why: string) => reasons.set(why, (reasons.get(why) ?? 0) + 1);

  for (const variant of variants) {
    // A DEMONSTRATION IS NOT A CANDIDATE, the same rule the whole-board matcher applies (`forSequencer`).
    if (!variant.forSequencer) {
      note('a demonstration authoring (sequencer="no") is not a candidate');
      continue;
    }
    const norm = normalizeInstance(variant);
    const k = norm.dancers.length;
    if (k === 0) {
      note('a variant with no dancers');
      continue;
    }
    if (k >= n) {
      note('not a subset of this board');
      continue;
    }
    const target: Matchable[] = norm.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender, couple: d.couple };
    });
    const gendered = !!norm.genderSpecific;

    // TILED: n / k disjoint copies covering every physical dancer. A PARTITION, never a sample.
    if (n % k === 0) {
      const wanted = n / k;
      const disjoint = matchFormationsAll(source, target, tol, gendered).filter((m) => !m.reflect && m.subset);
      if (disjoint.length >= wanted) {
        const used = disjoint.slice(0, wanted);
        const copies = used.map((m) => copyOf(m, boardIndexOf));
        const covered = new Set(copies.flatMap((c) => [...c.from.keys()]));
        // `matchFormationsAll` guarantees the copies are pairwise DISJOINT, so `wanted` copies of `k` dancers cover
        // exactly `n`. A shortfall would be a broken contract in `match.ts`, not a board this call cannot dance, and
        // a silent note here would hide it — so it throws.
        if (covered.size !== n) {
          throw new Error(`resolveVirtual: ${wanted} disjoint copies of ${k} covered ${covered.size} of ${n} dancers — matchFormationsAll's disjointness contract is broken`);
        }
        placements.push({
          variant: norm,
          copies,
          kind: 'tiled',
          error: used.reduce((s, m) => s + m.error, 0),
        });
      } else {
        note('no disjoint tiling');
      }
    }

    // PARTIAL: one placement dances, the rest hold.
    const one = matchFormations(source, target, tol, gendered);
    if (one?.subset && !one.reflect) {
      placements.push({ variant: norm, copies: [copyOf(one, boardIndexOf)], kind: 'partial', error: one.error });
    } else if (one) {
      // THE REFUSAL THAT IS A FORMAT LIMIT: this module copies the authored track verbatim, so it can honour a
      // rotation-plus-translation placement only (see the header). A reflected one would need the track mirrored
      // about a line that is not the dancer's own axis, which the XML cannot carry.
      note('the only placement mirrors the track, which the loop format cannot express');
    } else {
      note('the source does not fit this board');
    }
  }

  if (placements.length === 0) {
    return {
      legal: false,
      reason: `no virtual variant of ${title} can start AND end on a formation the engine names from ${startFormation}`,
      tried: describe(reasons) || 'nothing',
    };
  }

  const candidates: VirtualCandidate[] = [];
  const unnamed = new Map<string, number>();
  for (const p of placements) {
    const bundle = placeVirtual(board, p.variant, p.copies, p.kind, startFormation);
    const end = endBoardOf(bundle);
    const endFormation = namer(end);
    if (endFormation === null) {
      unnamed.set(p.kind, (unnamed.get(p.kind) ?? 0) + 1);
      continue;
    }
    candidates.push({
      bundle,
      end,
      startFormation,
      endFormation,
      kind: p.kind,
      error: p.error,
      placement: bundle.virtual?.placement ?? [],
    });
  }
  if (candidates.length === 0) {
    const tried = [...unnamed].map(([kind, count]) => `a ${kind} placement ends on a board the engine does not name (${count})`).join('; ');
    return {
      legal: false,
      reason: `every placement of ${title} from ${startFormation} ends on a board the engine does not name`,
      tried: tried || 'nothing',
    };
  }
  return { legal: true, candidates };
}

/**
 * Pick the one candidate to use, or REFUSE when the call itself is ambiguous.
 *
 * THE ORDER IS THE POLICY, in one place so it can be argued with:
 *   1. a placement the caller asked for (the variant's own `actives`, resolved to ids upstream),
 *   2. `tiled` before `partial` — the reading that moves every dancer is the stronger claim, and the end-named
 *      test has usually removed the alternative already,
 *   3. the smallest placement error,
 *   4. the lexicographically smallest placement, and then the end's name, so the answer cannot depend on the
 *      order the catalogue happened to hold.
 *
 * AND THE REFUSAL IS NOT A TIE-BREAK FALLBACK: two candidates on the SAME placement at the SAME error that reach
 * DIFFERENT named ends are two bodies of one call (the corpus has them — `Promenade` has an authoring that ends
 * on `Static Square` and one that ends on `Promenade`, both placing on the same four slots at error 0). Nothing
 * in the geometry chooses between those, so the caller is told, exactly as `knownFormation` refuses a tied
 * board: a tie is an artefact of what the library happened to hold, not an identity.
 */
export function chooseVirtual(
  candidates: readonly VirtualCandidate[],
  opts: VirtualOptions = {},
): { chosen?: VirtualCandidate; reason: string } {
  if (candidates.length === 0) return { reason: 'no candidates' };
  const prefer = opts.preferPlacement ? new Set(opts.preferPlacement) : null;
  const hits = (c: VirtualCandidate) => (prefer ? c.placement.flat().filter((i) => prefer.has(i)).length : 0);
  const rank = (c: VirtualCandidate) => (c.kind === 'tiled' ? 0 : 1);
  const key = (c: VirtualCandidate) => c.placement.map((copy) => copy.join('+')).join('/');
  const sorted = [...candidates].sort(
    (a, b) =>
      hits(b) - hits(a) ||
      rank(a) - rank(b) ||
      a.error - b.error ||
      key(a).localeCompare(key(b)) ||
      a.endFormation.localeCompare(b.endFormation),
  );
  const best = sorted[0];
  const sameStrength = (c: VirtualCandidate) =>
    hits(c) === hits(best) && rank(c) === rank(best) && Math.abs(c.error - best.error) <= CHOICE_TIE_EPS;
  // TWO KINDS OF AMBIGUITY, and the caller is told about both:
  //   - different PLACEMENTS at the same strength: which dancers does it, and on a symmetric board nothing in the
  //     geometry says (`Single File Promenade` on a squared set fits the boys' pair and the girls' pair at error 0);
  //   - the same placement reaching different NAMED ends: two bodies of one call (`Promenade` has an authoring that
  //     ends on `Static Square` and one that ends on `Promenade`).
  // `preferPlacement` is the caller's way to break the first; nothing breaks the second, which is why it is
  // reported rather than guessed.
  const rival = sorted.find(
    (c) => c !== best && sameStrength(c) && (key(c) !== key(best) || c.endFormation !== best.endFormation),
  );
  if (rival) {
    const how = key(rival) !== key(best)
      ? `equally good placements reach it (${key(best)} and ${key(rival)}) — say which dancers`
      : `two bodies sit on the same placement ${key(best)}: one ends on ${best.endFormation}, the other on ${rival.endFormation} — nothing in the geometry chooses between them`;
    return { reason: `${best.bundle.title} from ${best.startFormation}: ${how}` };
  }
  return {
    chosen: best,
    reason: `the ${best.kind} placement ${key(best)}: ${best.startFormation} to ${best.endFormation}`,
  };
}

/** One `FormationMatch` as a placement, with the PHYS index translated back to a board index. */
function copyOf(m: { subset?: number[]; mapping: number[] }, boardIndexOf: readonly number[]): PlacementCopy {
  const from = new Map<number, number>();
  for (const i of m.subset ?? []) {
    const sj = m.mapping[i];
    if (sj >= 0) from.set(boardIndexOf[i], sj);
  }
  return { from };
}

/** The end board, read at the call's own length with the engine's own pose reader. */
function endBoardOf(bundle: CallBundle): Board {
  return {
    dancers: bundle.dancers.map((d, i) => {
      const p = poseFor(d, bundle.beats);
      return {
        id: d.id ?? i + 1,
        couple: d.couple ?? UNKNOWN_COUPLE,
        gender: d.gender,
        x: p.x,
        y: p.y,
        heading: p.heading,
      };
    }),
  };
}

/** A board dancer's identity and pose, with the given path. */
function spec(board: SeqDancer, path: Seg[]): DancerSpec {
  return {
    gender: board.gender,
    x: board.x,
    y: board.y,
    angleDeg: (board.heading * 180) / Math.PI,
    path,
    id: board.id,
    couple: board.couple,
    mirror: false,
  };
}

function describe(reasons: ReadonlyMap<string, number>): string {
  return [...reasons].map(([why, count]) => `${why} (${count})`).join('; ');
}
