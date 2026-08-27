Feature: Fractional Calls and Handedness Variants
  As a square dance choreography engine
  I want to model fractional call variants and left/right handedness as distinct, non-interchangeable FSM transitions
  So that the many ways a single call can be specified are captured without ambiguity

  @bind:applyToBoard @bind:variantStarts
  Scenario: Modelling fractional calls as distinct transitions
    Given a call has fractional variants such as "Circle Left 1/4", "1/2", and "3/4"
    When each variant is requested from the same start state
    Then each fractional variant must be a distinct transition to its own end state
    # Engine: each fractional variant is a separate <tam> / CallBundle variant; applyToBoard
    #          produces its own end board.

  @bind:applyToBoard @bind:mul5
  Scenario: A full call composes from its fractional parts
    Given a "full" call and its fractional variants share a common start state
    When the full call is expressed as the sum of its fractions
    Then the end state of the full call must equal the end state reached by applying the fractions in sequence
    # Engine: composing the fractional matrices via matrix.mul5 must equal the full call's matrix.

  @bind:applyToBoard @bind:bezierPoint
  Scenario: Animating only the requested fraction
    Given a fractional variant of a call is selected
    When the movement is interpolated over the call's beats
    Then only the fraction of the full path corresponding to the requested fraction must be animated
    And the endpoint must match the fractional call's end state matrix

  @bind:applyToBoard @bind:matchFormations
  Scenario: Left- and right-handed variants are distinct transitions
    Given a call has a left-handed and a right-handed variant, such as a left-hand star vs a right-hand star
    When the variant is selected
    Then the engine must choose the transition whose handhold orientation matches the requested variant
    And the two variants must not be interchangeable as outgoing edges

  @bind:applyToBoard @bind:physicalDancers
  Scenario: A fractional call on a half-set completes across the mirrored half
    Given a fractional call is authored on a half of the set
    When the fraction is applied
    Then the movement must be applied identically to the mirrored opposite half
    And both halves must reach a coherent end state together
    # Engine: mirrored (duplicate-half) dancers are materialised via 180-degree rotation at pose time.

  @bind:applyToBoard @bind:bezierPoint @bind:dancerBeats
  Scenario: A fractional call takes a proportional number of beats
    Given a full call is timed to a certain number of beats
    When a fractional variant such as a half or a quarter is selected
    Then the fraction must be timed proportionally to its fraction of the full call
    And the beat count of the fractional edge must reflect that proportion
    # Engine: the fractional variant's end pose and beat span are a proportion of the full
    #          call's path (dancerBeats), so the edge's beat count scales with the fraction.

  @bind:variantStarts @bind:applyToBoard @bind:matchFormations
  Scenario: The "Left" modifier mirrors a call into a distinct variant
    Given a call is preceded by the modifier "Left"
    When the engine builds the left-handed variant
    Then it must interchange right with left and, where applicable, belle with beau and clockwise with counter-clockwise
    And the resulting variant must be a distinct transition, not interchangeable with the unmodified call
    # Engine: "Left" is a systematic mirror (right<->left, belle<->beau, cw<->ccw) producing its
    #          own variant; applyToBoard/variantStarts select that variant from the current board.

  @bind:applyToBoard @bind:matchFormations @bind:physicalDancers
  Scenario: The "Split" modifier divides a line or box into two acting groups
    Given a call is preceded by "Split" and applies from a line or box
    When the engine applies the split modifier
    Then it must divide the dancers into two groups, each executing the call from its own half
    And the "Split" action must only be legal when the start formation is a line or box large enough to divide
    # Engine: "Split" reuses the sub-formation splitting path on the line/box, acting separately
    #          on each half rather than as one whole-board apply.
