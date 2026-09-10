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
  Scenario: A formation board synthesised from geometry alone has no real home identity
    Given a board is synthesised for a named formation rather than reached by dancing there
    When the formation's geometry does not correspond to the home square
    Then each dancer must still receive a distinct id, but the couple and gender must be placeholders rather than real home identity
    And couple- or role-sensitive behaviour must not read meaning into those placeholder designations
    # Engine: Sequencer.boardForFormation -> boardFromMatchables stamps id/couple/gender only
    #   when the geometry matches HOME_DANCERS. "Static Square" therefore comes back with real
    #   genders (4 boy + 4 girl, couples 1-4), while "Two-Faced Lines" / "Eight Chain Thru" come
    #   back as eight placeholder 'boy' dancers with index-assigned couples. Partner/corner/lead
    #   relationships and the displayed couple colours are consequently meaningless on such a
    #   board, even though its geometry is correct.

  @bind:boardForFormation @bind:recognize
  Scenario: A synthesised formation board is still geometrically correct
    Given a board is synthesised for a named formation
    When the engine recognises it
    Then it must recognise back to that same formation name
    And the geometry must stand on its own even though the dancer identities are placeholders
    # The geometry is trustworthy on a synthesised board; only the identity axis is not.
