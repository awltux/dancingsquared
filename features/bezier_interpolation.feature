Feature: Bézier Interpolation for Floor Physics and Animation
  As a square dance choreography engine
  I want to calculate and interpolate movement paths using Bézier curves
  So that dancers move smoothly across the floor within timing and velocity constraints

  @bind:bezierPoint @bind:poseFor
  Scenario: Generating smooth trajectories using Bézier control points
    Given a transition payload contains start positions and Bézier control points
    When the engine parses the transition data from the Taminations dataset
    Then it must generate a continuous smooth curve for each dancer from start to end coordinates
    # Engine: core.bezierPoint evaluates a cubic Bézier at a parameter t.

  @bind:poseFor @bind:bezierPoint
  Scenario: Interpolating dancer positions along multi-segment transition curves
    Given a complex call requires a multi-segment trajectory
    When the animation engine steps through the interpolation frames
    Then each dancer's position must be calculated at precise fractional time intervals along the curve

  @bind:poseFor @bind:bezierAngle
  Scenario: Enforcing velocity limits and total duration constraints during execution
    Given a call has a mandatory beat count and maximum speed threshold
    When the system calculates the point distribution along the Bézier path
    Then the velocity profile must not exceed physical movement limits throughout the duration

  @bind:poseFor @bind:bezierPoint
  Scenario: Synchronising arrival times for dancers travelling different path lengths
    Given two dancers travel paths of unequal physical distance during the same call
    When the animation engine computes the interpolation parameters
    Then both dancers must adjust their pacing to arrive at their destination simultaneously at the end of the beat count

  @bind:poseFor @bind:bezierAngle
  Scenario: Preserving smooth rotational orientation alongside positional curves
    Given a dancer translates and rotates simultaneously along a curved path
    When the system interpolates both position matrices and heading angles
    Then the rotational orientation must update smoothly without abrupt snapping or gimbal issues
    # Engine: core.poseFor updates both position (translate Bezier) and heading (rotation Bezier).

  @bind:poseFor @bind:applyToBoard
  Scenario: Interpolating between a formation state matrix and its end state
    Given a call is applied as a matrix transformation from a start state to an end state
    When the animation engine plays the transition
    Then each dancer's position and heading must be interpolated from the start matrix to the end matrix over the call's beat count
    And the final interpolated pose must coincide with the end state's canonical matrix

  @bind:poseFor @bind:dancerBeats
  Scenario: Easing a dancer to rest when it does not move during a transition
    Given a dancer's start and end matrix rows are identical for a call
    When the call plays
    Then the dancer must settle to rest instead of continuing to walk
    And its stride must ease smoothly to zero

  @bind:poseFor @bind:bezierPoint
  Scenario: Handling a fractional call by animating only a part of the full path
    Given a fractional variant of a call is requested
    When the engine interpolates the movement
    Then it must animate only the fraction of the full path corresponding to the requested fraction
    And the endpoint must match the fractional call's end state matrix
