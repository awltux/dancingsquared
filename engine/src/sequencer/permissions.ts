// MAY THIS CALL BE OFFERED HERE, BY THESE DANCERS?
//
// A PICKER-ONLY permission layer. It decides what the call chooser OFFERS and nothing else: the engine's
// legality check is untouched, so a caller who knows the call can still apply it. That scope is
// deliberate - it separates "the app will not suggest this" from "the engine refuses this", which are
// different claims and were previously conflated.
//
// WHY IT EXISTS. `groupCanPerform` already answered "can this GROUP perform this call", by composing the
// group and applying it. That is the geometric question, and it cannot express the others:
//
//   * some calls are simply NOT AVAILABLE FROM a given formation, however well they tile. The reported
//     case is all-8 `Dosado` from a `Static Square`: the coded `Do Sa Do` rule returns the right answer
//     ("#5 has no dancer directly in front of it"), but the parallel tiling manufactures the call anyway
//     by pairing dancers six apart, and the result walks bodies through each other. No body-overlap
//     threshold can separate it from the perfectly legal `Single Circle Left Full` - measured, every
//     candidate criterion refused one or the other - so the distinction is a RULE, not a measurement.
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

/** The programme order, weakest first. A rule at a LATER index overrides one at an earlier index.
 *
 * THE ENGINE OWNS THIS LIST and `poc/src/data.ts` imports it, because the app's level selector and the
 * engine's override order have to agree - when they were two hand-kept copies they drifted. `ssd` has no
 * asset directory of its own: it is a synthesized alias level, and it sits here because `calls.xml`
 * orders it between Basic and Mainstream.
 *
 * `b1` and `b2` were removed when the Basic levels were retired in favour of `ms` 2026. The four calls
 * that existed only there were migrated into `ms/` first, so no capability was lost. */
export const PERMISSION_LEVELS = [
  'discovered', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b',
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
 * An absent field is a wildcard, so `{ call: 'Dosado', level: 'ms' }` covers every group.
 *
 * `call` is the bare call name. `group` is the READING the request is about - the selector the picker has
 * chosen, or `All 8` for a whole-board reading - and it is matched against the request's own single group.
 */
export interface PermissionRule {
  call?: string;
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
  level: PermissionLevel;
  decision: PermissionDecision;
  /** Human-readable, and shown when the rule denies. Required on a deny so a refusal can never be a
   *  bare "no" - the picker and the audit both need the reason. */
  reason?: string;
}

/** A request for permission: a call, optionally for a chosen group, optionally from a named board. */
export interface PermissionRequest {
  call: string;
  group?: string | null;
  /** The board's recognised formation name, or absent when the caller did not supply one. A rule that
   *  names a board then does not match, which is the safe direction: an un-named board must not be
   *  treated as if it were the one the rule is about. */
  board?: string | null;
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
 * make `{ call: 'Dosado' }` also cover `Left Dosado`, `Dosado to a Wave` and `Heads Dosado` - and
 * `Left Dosado` is LEGAL from a square set while `Dosado` is not, so a fuzzy match would break the very
 * distinction the rule exists to draw.
 *
 * THE GROUP LIST IS ITERATED ANY-OF, and the loop allocates nothing: the request's group is normalised
 * once and compared against each name in turn. This runs for every candidate call when the picker builds
 * its list (`legalNext`), so a `.map`/`.some` over the array per rule per call is the kind of per-call
 * allocation this repository does not spend on a config lookup. An empty list matches nothing, which the
 * harness pins as a rejected rule rather than a silent no-op.
 */
function matches(rule: PermissionRule, req: PermissionRequest): boolean {
  if (rule.call !== undefined && normCall(rule.call) !== normCall(req.call)) return false;
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
    call: 'Dosado',
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
    call: 'Dosado',
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
    call: 'Lead Right',
    group: ['All 8', 'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Beaus', 'Belles' ],
    board: 'Static Square',
    level: 'ms',
    decision: 'deny',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: 'Lead Right from Close Couples',
    group: ['All 8', 'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Beaus', 'Belles' ],
    board: 'Static Square',
    level: 'ms',
    decision: 'deny',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
  {
    call: 'Lead Right from Lines',
    group: ['All 8', 'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Beaus', 'Belles' ],
    board: 'Static Square',
    level: 'ms',
    decision: 'deny',
    reason:
      'Lead Right is danced by one couple - the heads or the sides - so the whole square cannot lead '
      + 'right. `Heads Lead Right` and `Sides Lead Right` are the scoped forms, and choosing a group in '
      + 'the picker applies it as one.',
  },
];
