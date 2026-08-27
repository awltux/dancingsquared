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
