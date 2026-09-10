Feature: Home Identity, Heads and Sides
  As a square dance choreography engine
  I want to fix each dancer's head/side designation from their home couple for the whole tip
  So that calls which name a group (e.g. "Heads Pass Thru") act on the original head couples regardless of where the set has rotated

  Background:
    Given each dancer is stamped at the start of the tip with a home identity (id and home couple)
    And heads are home couples 1 and 3, and sides are home couples 2 and 4
    And a dancer's head/side designation never changes for the duration of the tip

  @bind:assignHomeIdentity @bind:matchFormations
  Scenario: A dancer keeps their head/side designation after the set rotates
    Given the set has rotated so the original head couple now stands at a side wall
    When a heads-specific call is applied
    Then it must act on the original head couples, not on whichever couples currently occupy the north/south positions
    # Engine: assignHomeIdentity stamps id/couple; matchFormations preserves home-couple alignment.

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: Identity-aware matching of a head/side call on a rotated square
    Given the board is a squared set rotated by 90 degrees, placing the original heads at east/west
    When a call such as "Heads Pass Thru" is matched against the board
    Then the matcher must break the geometric tie in favour of the alignment that maps the call's head slots onto the original head couples
    # Engine: match.ts identityScore tie-breaks equal-error alignments toward the home-couple mapping.

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: A side-specific call acts on the original side couples
    Given the set has rotated the original sides to the north/south walls
    When a sides-specific call is applied
    Then it must act on the original side couples (home couples 2 and 4)

  @bind:assignHomeIdentity
  Scenario: Head/side identity is preserved across the whole tip
    Given a sequence of calls permutes the couples' positions over multiple transitions
    When a heads-specific call is issued at a later step
    Then the dancers it targets must still be the same home couples designated heads at the start of the tip
    And a fresh tip must re-assign designations from a new home square

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: Gender-specific calls respect the gender arrangement
    Given a call is flagged as gender-specific (for example, "Boys Turn Back")
    When the board is matched to the call's start setup
    Then the call must only apply when the board's boy/girl arrangement aligns with the setup's gender slots
    And the call must be rejected if the genders are swapped on an otherwise identical geometry
    # Engine: matchFormations with requireGender=true enforces gender-compatible mapping.

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: Distinguishing the beau and belle roles within a couple
    Given a call designates the beau or the belle of each couple rather than a head/side or a gender
    When the engine must decide which dancer each role refers to
    Then it must derive the beau/belle role from the dancer's position and facing within the couple
    And a call addressed to the beaux must act on the left-hand dancer of each couple and the belles on the right-hand dancer
    And the role must be recomputed for the current couple orientation, not from home identity
    # Engine: beau/belle is a positional role (left/right within the couple) derived from heading,
    #          distinct from assignHomeIdentity's id/couple; matching must respect it.

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: Beau and belle are positional, not derived from gender
    Given a couple contains two dancers of the same gender or a gender arrangement that does not match the historic convention
    When the engine resolves a beaux/belles designation
    Then it must still assign the beau to the left-hand dancer and the belle to the right-hand dancer by position alone
    And it must not fall back to gender when position and gender disagree
    # RESOLVED: beau/belle is a POSITIONAL axis (left/right by facing), independent of gender.
    # This is what lets gender-free calling work: the role is recomputed from geometry, so it
    # remains well-defined regardless of the dancers' genders.

  @bind:matchFormations @bind:assignHomeIdentity @bind:subsetOf
  Scenario: Narrowing by group first, then applying a positional role within the group
    Given a call designates a group and then a role within it, such as "Heads Beaux" or "Boys Beaus"
    When the engine resolves which dancers act
    Then it must first select the named group by its designation axis (home couple, gender, or position)
    And within that group it must then apply the positional role to pick the acting dancers
    # RESOLVED: the role axes are NOT in competition. A call names one axis for the group
    # (head/side by couple, gender by gender) and may then narrow by a positional role
    # (beau/belle, leader/trailer, centers/ends) within it. Narrowing is sequential, not a conflict.

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: Head/side stays identity-based while beau/belle and leader/trailer stay positional
    Given a call may designate heads, sides, beaux, belles, leaders, or trailers
    When the engine resolves the designation
    Then head/side MUST always be resolved from the fixed home couple, surviving any rotation
    And beau/belle and leader/trailer MUST always be resolved from the current position and facing, recomputed each transition
    And the engine must not mix the two: identity designations never become positional, and positional roles never become identity
    # RESOLVED interaction: head/side is an identity axis (home couple, fixed for the tip);
    # beau/belle and leader/trailer are positional axes (geometry, dynamic). They address the
    # same dancers through different, non-interchangeable rules.

  @bind:boardForFormation @bind:assignHomeIdentity
  Scenario: A synthesised board carries declared gender but no home couple
    Given a board is synthesised for a named formation rather than reached by dancing there
    When the formation's geometry does not correspond to the home square
    Then each dancer must receive a distinct id
    And its GENDER must be the formation's declared gender, because that is real catalog data
    But its COUPLE must be unknown, because no home couple can be derived from geometry alone
    And couple- or role-sensitive behaviour must not read meaning into the unknown couple
    # Engine: boardFromMatchables stamps home id/couple from a geometry match against HOME_DANCERS,
    #   and takes the gender from the matchable itself when that match fails. Gender is declared
    #   per slot in formations.xml (and per dancer in a call's <tam>), so it is DATA; the couple is
    #   declared nowhere, so away from home it stays UNKNOWN_COUPLE. Measured on a synthesised
    #   Two-Faced Lines board: 4 boy + 4 girl with couples=[0], whereas a home-like board
    #   ("Static Square") comes back with real genders AND couples 1-4.

  @bind:boardForFormation @bind:recognize
  Scenario: A synthesised formation board is still geometrically correct
    Given a board is synthesised for a named formation
    When the engine recognises it
    Then it must recognise back to that same formation name
    And the geometry must stand on its own regardless of the dancer identities
    # The geometry is trustworthy on a synthesised board; recognition ignores gender anyway.

  @bind:parseFormations @bind:buildCall
  Scenario: Full-set and half-set definitions have equal boys and girls
    Given a formation in formations.xml or a call setup in a tam
    When it describes the whole set (8 dancers) or a half set (4 dancers)
    Then it must contain the same number of boys as girls
    And an imbalance must be reported as a DATA ERROR, failing the developer build
    # Engine: engine/test/gender-audit.mjs runs first in npm run verify and fails on an
    #          unbalanced 8- or 4-dancer definition. A half-set is completed to the full set by
    #          rotating it 180 degrees (square-dancing.md 7.1), so a balanced half is what makes
    #          a balanced whole; an imbalance in either is a mistyped gender attribute rather
    #          than a choreographic choice. Measured: 273 formations and 802 call setups, 0
    #          unbalanced among the 8- and 4-dancer definitions.

  @bind:parseFormations @bind:buildCall
  Scenario: Subset and partial setups are exempt from the balance rule
    Given a setup describes a SUBSET of the set rather than the whole or a half
    And a subset can legitimately be ALL ONE GENDER
    When the gender audit runs
    Then it must report the setup for information rather than failing the build
    # Engine: square-dancing.md 7.2 - "Beaus Only" is two boys by definition, "Center 4 Dancers"
    #          and "Columns of 3" are partial groups. A subset being all one gender is what makes
    #          an "all boys" / "all girls" call callable, so it is never an error. In the
    #          catalogue these have an odd dancer count (1, 3) or a gender-scoped from= label.

  @bind:boardForFormation @bind:assignHomeIdentity @bind:matchFormations
  Scenario: A board with real genders must be balanced, but a subset board need not be
    Given a board carries real boy and girl identities
    When the gender audit inspects it
    Then a board holding the WHOLE set (8 dancers) must have equal boys and girls
    But a board holding fewer dancers is a subset board and may be all one gender
    And a board whose genders are all unknown is reported as unknown rather than failed
    # Engine: the home square is 4 and 4. The audit uses a NARROWER rule for boards than for
    #          definitions: a 4-dancer DEFINITION is a half-set that mirrors to 8 and must be
    #          2 and 2, whereas a 4-dancer BOARD is the boys (or centers) acting and may be all
    #          one gender. The audit asserts both all-boys and all-girls subset boards are
    #          reported, not failed. Every synthesised formation board now carries real declared
    #          genders, so this check applies to all of them (0 are "identity unknown" today).
