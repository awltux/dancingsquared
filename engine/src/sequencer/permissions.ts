// MAY THIS CALL BE OFFERED HERE, BY THESE DANCERS?
//
// A PICKER-ONLY permission layer. It decides what the call chooser OFFERS and nothing else: the engine's
// legality check is untouched, so a caller who knows the call can still apply it. That scope is
// deliberate - it separates "the app will not suggest this" from "the engine refuses this", which are
// different claims and were previously conflated.
//
// THAT IS STILL THE DEFAULT, AND IT IS NOW A MODE. `SequencerConfig.permissionMode` can make the engine refuse what
// the picker will not offer (`'consistent'`), which is what keeps the two answers from drifting apart on a reading a
// rule was written about. The wiring lives in `Sequencer.permissionFor` - ONE predicate, asked by both - and the
// apply asks it at the READING boundary (`CallApplicator.applyStepInner`), never inside the tiling. This module
// itself is unchanged by that: it is still a pure rule chain that knows nothing about boards or levels.
//
// WHY IT EXISTS. `groupCanPerform` already answered "can this GROUP perform this call", by composing the
// group and applying it. That is the geometric question, and it cannot express the others:
//
//   * some calls are simply NOT AVAILABLE FROM a given formation, however well they tile. The reported
//     case is all-8 `Dosado` from a `Static Square`: the coded `Do Sa Do` rule returns the right answer
//     ("#5 has no dancer directly in front of it"), but the parallel tiling manufactures the call anyway
//     by pairing dancers six apart, and the result walks bodies through each other. No body-overlap
//     threshold can separate it from `Single Circle Left` - measured, every candidate criterion refused one
//     or the other - so the distinction is a RULE, not a measurement.
//
//     AND THE EXAMPLE IS HISTORY, NOT A CLAIM ABOUT WHAT IS LEGAL NOW. Both sides of it are rules today: the
//     Single Circle family is itself withheld at Mainstream (see the white-list rule below), and the title the
//     measurement was written against, `Single Circle Left Full`, is not a corpus title any more - the corpus
//     spells the BARE title as the full turn (`Single Circle Left`, and `... 1/2`, `1/4`, `3/4` beside it). The
//     measurement still says what it was cited for: no geometry criterion could tell those two apart, which is
//     why a rule exists at all.
//
//   * and a rule is LEVEL-SCOPED, because the programmes differ. A restriction that holds at MS may be
//     lifted later: **a later level OVERRIDES an earlier one.**
//
// THE LEVEL MODEL IS THE PROVIDER'S OWN. `library.ts` records that "the level IS the call set", and the
// engine deliberately has no level concept. This module does not add one: a level is just an ordering,
// supplied by the caller, and a rule names the level it belongs to. `PERMISSION_LEVELS` is that order.
//
// "NEVER" IS A RULE NO LEVEL OVERRIDES. There is no special category: a `deny` at MS that no later level
// contradicts behaves exactly as a permanent restriction, and one that PLUS contradicts is simply
// overridden. That is what makes "this is a never can" auditable rather than a special case buried in
// the picker - the reason string says which rule produced the answer.

// THE GROUP NAMES ARE IMPORTED, NOT RE-EXPORTED. `export { X } from './selection.js'` publishes `X` for
// consumers and creates NO local binding, which is why a rule could not reference `SINGLES_GROUP_NAMES`
// while that line was there - TS2304, "Cannot find name". A module that USES a name has to import it, and
// the public barrel for these is `index.ts`, not this file.
import { COMBINED_GROUP_NAMES, SINGLES_GROUP_NAMES, COUPLES_GROUP_NAMES, COUPLE_GROUP_NAMES } from './selection.js';
import type { Going } from '../going.js';

/** The programme order, weakest first. A rule at a LATER index overrides one at an earlier index.
 *
 * THE ENGINE OWNS THIS LIST and `poc/src/data.ts` imports it, because the app's level selector and the
 * engine's override order have to agree - when they were two hand-kept copies they drifted.
 *
 * `b1` and `b2` were removed when the Basic levels were retired in favour of `ms` 2026. The four calls
 * that existed only there were migrated into `ms/` first, so no capability was lost.
 *
 * `ssd` WAS REMOVED when CALLERLAB dropped SSD and replaced Basic/Mainstream/SSD with the single Mainstream
 * programme of 2026 (`book/08-reference/programme-membership.md`). It was never an asset directory: the POC
 * synthesized it from `assets/src/calls.xml`'s `ssd/…` links as a VIEW of calls authored under `ms`/`plus`/`a1`.
 * MEASURED before the removal: 72 `ssd/…` index rows, 58 distinct basenames, of which 57 resolve to a file the
 * corpus already carries at `ms` or `discovered` and ONE (`circle_to_a_line`) to `plus/` - so the view supplied
 * exactly ONE title (`Circle to a Line`) to the app's Mainstream-and-below pool, and 289 duplicate catalogue
 * entries to its level selector. No shipped permission rule named `ssd` (all 17 are at `ms`), so no rule's scope
 * moved when the entry left the order.
 *
 * THE LADDER AND THE CORPUS NOW AGREE EXACTLY: these nine names are nine directories under `assets/`, plus the
 * `src` index. `engine/test/corpus-inventory.mjs` compares them both ways and fails on a folder nobody names; a
 * future level with no authorings has to be added to that gate's exception list, with its reason. */
export const PERMISSION_LEVELS = [
  'discovered', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b',
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number] | string;

/** Rank of a level for override purposes. An unknown level sorts LAST, so a rule naming one the order
 *  does not list is treated as the most specific rather than silently ignored. */
export function levelRank(level: PermissionLevel): number {
  const i = (PERMISSION_LEVELS as readonly string[]).indexOf(level);
  return i < 0 ? PERMISSION_LEVELS.length : i;
}

/** What a rule decides, and why. */
export type PermissionDecision = 'allow' | 'deny';

/**
 * One rule in the chain.
 *
 * A rule matches a REQUEST - a call, optionally performed by a group - when every field it names agrees.
 * An absent field is a wildcard, so `{ call: ['Dosado'], level: 'ms' }` covers every group.
 *
 * `call` is the bare call name(s) and `group` is the READING the request is about - the selector the picker
 * has chosen, or `All 8` for a whole-board reading - and each is matched against the request's own single
 * value.
 */
export interface PermissionRule {
  /**
   * The call names this rule applies to, matched ANY-OF, or absent for every call.
   *
   * AN ARRAY RATHER THAN ONE NAME, for the same reason `group` is one. An authoring family is governed by
   * ONE decision: `Lead Right - Close`, `- Normal` and `- Far` are one call at three authored spacings,
   * refused for one cause and allowed for one cause, so the family is written once with its reason once
   * instead of six near-identical entries kept in step by hand.
   *
   * IT IS NOT "ALL OF THESE". A request names ONE call, so a rule listing several applies to each of them,
   * not only to a request that is somehow all of them at once.
   *
   * AN EMPTY ARRAY MATCHES NOTHING, which is a rule that can never fire rather than a way to write "any
   * call" - that is still the absent field, and `test/permissions.mjs` rejects a rule with `[]` so the
   * difference cannot be lost by accident.
   */
  call?: string[];
  /**
   * The groups this rule applies to, matched ANY-OF, or absent for every group.
   *
   * AN ARRAY RATHER THAN ONE NAME, because the same restriction usually holds for several groups: the
   * whole-square `Dosado` rules below refuse `Boys` and `Girls` for one reason, and written as one rule
   * that reason exists once instead of twice with the two copies kept in step by hand.
   *
   * IT IS NOT "ALL OF THESE". A request is about ONE reading, so a rule naming several groups applies to
   * each of them, not only to a request that is somehow all of them at once.
   *
   * AN EMPTY ARRAY MATCHES NOTHING, which is a rule that can never fire rather than a way to write "any
   * group" - that is still the absent field, and `test/permissions.mjs` rejects a rule with `[]` so the
   * difference cannot be lost by accident.
   */
  group?: string[];
  /** The FORMATION this rule applies from, when it is formation-specific. Matched against the board's
   *  recognised name (`Sequencer.recognize`). Absent means every board. */
  board?: string;
  /**
   * The board's FORMATION ID (`formation-id.ts`), for a board no name reaches.
   *
   * WHY BOTH FIELDS EXIST. A name is the readable key, and it is the one to use wherever there is one - but
   * `recognize` is a CURATED caption and names 16 of the corpus's 138 eight-dancer formations, and nothing
   * names the setups an embedded `<tam>` carries ("Facing Dancers Close", "Right-Hand Wave"). An id is
   * computed from the board, so it always exists, and it is as coarse as a name on purpose: the same shape
   * up to rotation, whatever genders or couple numbers stand where.
   *
   * They match INDEPENDENTLY, and a rule may name both - a rule that names `board` still matches only the
   * name, which is what keeps every rule written before this field existed meaning exactly what it did.
   */
  boardId?: string;
  /**
   * The BODY this rule is about (`going.ts`), when it is body-specific. Absent means every body.
   *
   * A request that names NO body (`going` null — a reading-level ask, before a variant is chosen) never matches this, and
   * that is the safe direction, the same one `board` takes for an unnamed board. Only the candidate filter names a body,
   * because a body is the only thing that distinguishes authorings which share one setup exactly.
   */
  going?: Going;
  level: PermissionLevel;
  decision: PermissionDecision;
  /** Human-readable, and shown when the rule denies. Required on a deny so a refusal can never be a
   *  bare "no" - the picker and the audit both need the reason. */
  reason?: string;
}

/** A request for permission: a call, optionally for a chosen group, optionally from a named board or body. */
export interface PermissionRequest {
  call: string;
  group?: string | null;
  /** The board's recognised formation name, or absent when the caller did not supply one. A rule that
   *  names a board then does not match, which is the safe direction: an un-named board must not be
   *  treated as if it were the one the rule is about. */
  board?: string | null;
  /** The board's formation id, or absent/null when the caller did not supply one. An id-keyed rule then does
   *  not match, for the same reason an id-less board never matches a name: the direction that cannot
   *  misfire is "this ask is not about the thing the rule describes". */
  boardId?: string | null;
  /** The BODY the ask is about, or absent/null when the body is not chosen yet. A rule that names a body then does not
   *  match, for the same reason a board-keyed rule does not match an unnamed board. */
  going?: Going | null;
  /** The ACTIVE level. Rules above it are not consulted - the app has not registered those calls, so
   *  they could not apply anyway, and honouring them would let an unloaded programme forbid a call. */
  level: PermissionLevel;
}

/** The answer, with the rule that produced it so a caller can explain itself. */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  /** The rule that decided it, or null when nothing matched and the default applied. */
  rule: PermissionRule | null;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const normCall = (s: string): string => norm(s);

/**
 * Whether a rule matches a request.
 *
 * CALL MATCHING IS EXACT ON THE NORMALISED NAME, and deliberately so. A substring or prefix match would
 * make `{ call: ['Dosado'] }` also cover `Left Dosado`, `Dosado to a Wave` and `Heads Dosado` - and
 * `Left Dosado` is LEGAL from a square set while `Dosado` is not, so a fuzzy match would break the very
 * distinction the rule exists to draw.
 *
 * BOTH LISTS ARE ITERATED ANY-OF, and neither loop allocates: the request's value is normalised once and
 * compared against each name in turn, with `break` on the first hit. This runs for every candidate call
 * when the picker builds its list (`legalNext`), so a `.map`/`.some` over the array per rule per call is
 * the kind of per-call allocation this repository does not spend on a config lookup. An empty list matches
 * nothing, which the harness pins as a rejected rule rather than a silent no-op.
 */
function matches(rule: PermissionRule, req: PermissionRequest): boolean {
  if (rule.call !== undefined) {
    const got = normCall(req.call);
    let hit = false;
    for (const c of rule.call) if (normCall(c) === got) { hit = true; break; }
    if (!hit) return false;
  }
  if (rule.group !== undefined) {
    const got = req.group ? norm(req.group) : '';
    let hit = false;
    for (const g of rule.group) if (norm(g) === got) { hit = true; break; }
    if (!hit) return false;
  }
  if (rule.board !== undefined) {
    const want = norm(rule.board);
    const got = req.board ? norm(req.board) : '';
    if (want !== got) return false;
  }
  // THE SAME DIRECTION FOR THE ID, and the same exact-equality rule: an id is a KEY, not a name, so there is
  // nothing to normalise beyond the case and no prefix that means anything.
  if (rule.boardId !== undefined) {
    const want = norm(rule.boardId);
    const got = req.boardId ? norm(req.boardId) : '';
    if (want !== got) return false;
  }
  // A RULE ABOUT A BODY DOES NOT MATCH AN ASK THAT NAMES NONE, which is the reading-level ask: the body is not chosen
  // yet, so a rule written about `far` cannot be the reason a reading is refused. The same direction as `board` above,
  // and the reason a `going`-keyed rule only bites in the candidate filter.
  if (rule.going !== undefined) {
    const want = norm(rule.going);
    const got = req.going ? norm(req.going) : '';
    if (want !== got) return false;
  }
  return true;
}

/**
 * Whether a rule is IN FORCE at the active level.
 *
 * A rule applies when its own level is at or below the active one, which is the inheritance rule the
 * app already uses for calls: `sequencerCallsUpTo(level)` registers every level up to the chosen one, so
 * a rule from a level that has not been loaded must not be consulted. A rule ABOVE the active level is
 * not "pending" - it simply has not been introduced yet.
 */
function inForce(rule: PermissionRule, level: PermissionLevel): boolean {
  return levelRank(rule.level) <= levelRank(level);
}

/**
 * Evaluate the chain for a request. LAST MATCHING RULE WINS, with the rules pre-sorted so that level
 * order is the primary key: because a later level overrides an earlier one, the chain is sorted by
 * `levelRank` with a stable sort, so within one level declaration order decides and across levels the
 * higher one always wins.
 *
 * The DEFAULT IS ALLOW. A permission layer that defaulted to deny would empty the picker the moment a
 * rule failed to match, which is the failure mode `groupCanPerform`'s empty-picker bug already showed.
 */
export function evaluatePermissions(
  rules: readonly PermissionRule[],
  req: PermissionRequest,
): PermissionResult {
  let best: PermissionRule | null = null;
  let bestRank = -1;
  for (const rule of rules) {
    if (!inForce(rule, req.level)) continue;
    if (!matches(rule, req)) continue;
    const rank = levelRank(rule.level);
    // `>=` so that within a level the LAST declared rule wins, and across levels the higher one does.
    if (rank >= bestRank) { best = rule; bestRank = rank; }
  }
  if (!best) return { allowed: true, rule: null };
  return {
    allowed: best.decision === 'allow',
    ...(best.reason ? { reason: best.reason } : {}),
    rule: best,
  };
}

/**
 * The rules the engine ships.
 *
 * ONLY RULES THAT ARE MEASURED AND AGREED GO HERE. The layer is only as good as its entries: a wrong
 * rule hides a working call, and there is no way to tell that from inside the engine.
 *
 * TWO KINDS LIVE HERE, and they are distinguished by whether a later level could ever lift them:
 *
 *   LEVEL-SCOPED   the restriction belongs to a programme and a later programme may contradict it. The
 *                  all-8 `Dosado` rule is of this kind: it is stated at MS and PLUS is free to override
 *                  it by declaring an `allow`.
 *   NEVER          nothing may override it, so it is declared at the EARLIEST programme whose calls
 *                  carry it - `ms` for the rules below, which is the first level the app registers for
 *                  a real corpus (`discovered` holds synthesised home tams and no Dosado). Because a
 *                  later level overrides an earlier one, a rule at the earliest level is the one
 *                  position no higher level can be contradicted from below; lifting it would take a
 *                  deliberate `allow` in this list. There is no separate "never" flag, and that is the
 *                  point: the same mechanism expresses both, so neither is a special case.
 */
export const PERMISSION_RULES: readonly PermissionRule[] = [
  {
    // `Circle Four` IS A FOUR-DANCER CALL, so only a four-dancer reading may dance it: the heads or the
    // sides. THE AUTHORITY IS THE CALL'S OWN FAMILY ENTRY, not a judgement about the corpus:
    // `callerlab-ms.txt`'s "b. Circle of 4 Left/Right (1/4, 1/2, 3/4, Full) / Starting formation: Facing
    // Couples", whose command examples include "Circle Four, 1/2 way around" and "In Groups of 4, Circle
    // Left 3/4 of the way around". Four dancers, from facing couples - which is exactly two of the four
    // couples on a squared set.
    //
    // A WHITE LIST IN THE SHAPE THE `Lead Right` RULES USE: a deny that catches every reading, then an
    // allow for the readings that survive.
    //
    // THE ALLOW NAMES THE TWO READINGS EXPLICITLY RATHER THAN SPREADING A GROUP CONSTANT, and the reason is
    // what `selection.ts` already records about those constants: `COUPLES_GROUP_NAMES` carries `Couple #1`-
    // `#4` beside `Heads`/`Sides`, and a numbered couple names ONE couple - half of the four dancers the
    // call needs, so it is not a reading this call can be danced from. `All 8` is the other mistake: eight
    // dancers cannot circle four.
    //
    // ALL EIGHT AUTHORINGS ARE ONE DECISION, which is what `call` being an array is for: the direction and
    // the amount are the call's scale, not its choreography, so the white list is stated once rather than
    // eight times.
    call: [
      'Circle Four Left', 'Circle Four Left 1/4', 'Circle Four Left 1/2', 'Circle Four Left 3/4',
      'Circle Four Right', 'Circle Four Right 1/4', 'Circle Four Right 1/2', 'Circle Four Right 3/4',
    ],
    level: 'ms',
    decision: 'deny',
    reason:
      'Circle Four is danced by four dancers - the heads or the sides - so the whole square cannot circle '
      + 'four, and one couple alone cannot either. Choose the Heads or the Sides reading.',
  },
  {
    call: [
      'Circle Four Left', 'Circle Four Left 1/4', 'Circle Four Left 1/2', 'Circle Four Left 3/4',
      'Circle Four Right', 'Circle Four Right 1/4', 'Circle Four Right 1/2', 'Circle Four Right 3/4',
    ],
    group: ['Heads', 'Sides'],
    level: 'ms',
    decision: 'allow',
    reason:
      'Circle Four is for four dancers - the heads or the sides - and both of those readings are facing '
      + 'couples.',
  },
  {
    // THE SINGLE CIRCLE FAMILY, WITHHELD AT MAINSTREAM - a white list started and not finished, so the reason says
    // what is MEASURED rather than pretending to be a dance rule.
    //
    // WHY IT IS NOT A RULE ABOUT THE DANCE. MEASURED over `ms/circle.xml`: all SIXTEEN authorings write TWO
    // dancers (`formation="Facing Dancers"` or `Facing Dancers Far`), fifteen of them declaring
    // `asymmetric="true"`, so every variant builds to two dancers. `applyToBoard` from a squared set therefore
    // reaches them only by TILING - the whole-board reading needs a variant with as many dancers as the board -
    // and a tiling chooses WHICH dancers circle. The corpus does not say who: NONE of those sixteen declares
    // `actives`, while 28 shipped tams elsewhere do, so the attribute is present in the corpus and simply absent
    // here. Withholding the family while those readings are curated is the honest answer, and this rule is where
    // an exception goes when one is curated.
    call: [
      'Single Circle Left', 'Single Circle Left 1/4', 'Single Circle Left 1/2', 'Single Circle Left 3/4',
      'Single Circle Right', 'Single Circle Right 1/4', 'Single Circle Right 1/2', 'Single Circle Right 3/4',
    ],
    level: 'ms',
    decision: 'deny',
    reason:
      'Single Circle is authored two dancers at a time and names no actives, so a whole-square reading has to '
      + 'choose which dancers circle and the corpus does not say. Withheld at Mainstream until those readings are '
      + 'curated, and an exception belongs here when one is.',
  },
  {
    // `Boys Dosado` / `Girls Dosado` FROM A STATIC SQUARE - never, at every programme.
    //
    // WHY THE WHOLE-SET BOYS' AND GIRLS' DOSADO IS A DIFFERENT CASE FROM THE ALL-8 ONE. Every boy faces
    // his partner and every girl faces hers, so each pair DOES have a dancer directly in front of it and
    // the coded `Do Sa Do` precondition is satisfied - which is why these are offered at all, and why
    // they are not covered by the all-8 rule above. The tiling is also sound. What fails is the set: the
    // four pairs are spread around the square and all four meet in the middle at the same instant.
    // MEASURED, worst body gap -0.200 with FOUR pairs inside each other simultaneously, which is the
    // reported "they conflict in the middle of the square".
    //
    // WHY A RULE AND NOT A BODY THRESHOLD, once more: `Single Circle Left Full` from the same board is
    // LEGAL and penetrates DEEPER (-0.613). No measurement separates a conflict from a legal close pass
    // here; the difference is that four pairs converge on one point at once.
    //
    // The board condition is what keeps this narrow. `Boys Dosado` is a perfectly ordinary call from a
    // formation where the boys are together; only the Static Square reading is refused.
    //
    // ONE RULE FOR BOTH GROUPS, because the restriction and its reason are the same for the two: the
    // whole-set form is refused whichever gender is named, and an array is what says so without a second
    // near-identical entry whose prose has to be kept in step with this one. MEASURED for each group.
    call: ['Dosado'],
    group: ['Boys', 'Girls'],
    board: 'Static Square',
    level: 'ms',
    decision: 'deny',
    reason:
      'Every boy faces his partner and every girl faces hers, so a Boys or Girls Dosado dances both pairs '
      + 'at once - and from a Static Square the two pairs are opposite each other, so all four couples '
      + 'converge on the middle together. Use the per-couple forms (Heads Dosado, Sides Dosado) from this '
      + 'board.',
  },
  {
    // ALL-8 `Dosado` FROM A NON-SQUARE BOARD.
    //
    // A SQUARE-SET DENY, NOT A "NEVER": plus and above may say otherwise, and the difference is real.
    //
    // This was stated with no board condition, which would have refused the call from EVERY board - and
    // that is wrong. `Dosado` from a formation where the pairs genuinely face each other is the call
    // working as authored. The reported defect was always the square set specifically.
    call: ['Dosado'],
    group: ['All 8'],
    board: 'Static Square',
    level: 'ms',
    decision: 'deny',
    reason:
      'Do Sa Do starts from Facing Dancers, and a Static Square is not one - the dancers face across the '
      + 'set, not at a partner. The tiling can pair them six apart, but only by walking the bodies '
      + 'through each other. `Heads Dosado` / `Sides Dosado` are the scoped forms and still available.',
  },
  {
    // THE AUTHORING FAMILY AS ONE RULE. `- Close`, `- Normal` and `- Far` are three SETUPS of one couple
    // call (the separation is the call's scale, not its choreography), so the white list, its refusal and
    // its reason are one decision three times over - which is what the `call` array is for. The per-sibling
    // wording of the reason is gone; the CAUSE is not, and section 16 pins that every authoring variant of a
    // governed call is governed.
    call: ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far'],
    level: 'ms',
    decision: 'deny',
    reason:
      'START A WHITE LIST FOR LEAD RIGHT',
  },
  {
    call: ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far'],
    group: [...COUPLE_GROUP_NAMES],
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Right - Close, - Normal and - Far are each for a single couple to dance',
  },
  {
    call: ['Lead Right'],
    level: 'ms',
    decision: 'deny',
    reason:
      'START A WHITE LIST FOR LEAD RIGHT',
  },
  {
    call: ['Lead Right'],
    group: [...COUPLES_GROUP_NAMES],
    board: 'Static Square',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: ['Lead Right'],
    group: ['All 8', ...COUPLES_GROUP_NAMES],
    board: 'Eight Chain Thru',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: ['Lead Right'],
    group: ['All 8', ...COUPLES_GROUP_NAMES],
    board: 'Normal Lines',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    // THE OTHER DIRECTION'S FAMILY, on the same reasoning: `- Normal` and `- Far` are two setups of one
    // call, so one deny and one allow carry the whole family.
    call: ['Lead Left - Normal', 'Lead Left - Far'],
    level: 'ms',
    decision: 'deny',
    reason:
      'START A WHITE LIST FOR LEAD LEFT',
  },
  {
    call: ['Lead Left - Normal', 'Lead Left - Far'],
    group: [...COUPLE_GROUP_NAMES],
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Left - Normal and - Far are each for a single couple to dance',
  },
  {
    call: ['Lead Left'],
    level: 'ms',
    decision: 'deny',
    reason:
      'START A WHITE LIST FOR LEAD LEFT',
  },
  {
    call: ['Lead Left'],
    group: [...COUPLES_GROUP_NAMES],
    board: 'Static Square',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Left is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Left` and `Sides Lead Left` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: ['Lead Left'],
    group: ['All 8', ...COUPLES_GROUP_NAMES],
    board: 'Eight Chain Thru',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Left is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Left` and `Sides Lead Left` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: ['Lead Left'],
    group: ['All 8', ...COUPLES_GROUP_NAMES],
    board: 'Normal Lines',
    level: 'ms',
    decision: 'allow',
    reason:
      'Lead Left is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Left` and `Sides Lead Left` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
];
