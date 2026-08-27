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
