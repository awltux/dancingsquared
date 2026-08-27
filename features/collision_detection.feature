Feature: Collision Detection for Spatial Safety
  As a square dance choreography engine
  I want to monitor simultaneous dancer movements along intersecting Bézier paths
  So that physical overlaps, collisions, and impossible trajectories are prevented

  Scenario: Detecting spatial overlaps along intersecting Bézier paths
    Given two dancers have concurrent transition paths derived from Bézier control points
    When the simulation checks spatial occupancy across all time steps
    Then the system must identify any coordinate pairs where the distance between dancers falls below the collision threshold

  Scenario: Enforcing minimum safety clearance radii between adjacent dancers during movement
    Given a set of dancers are executing a close-proximity call
    When the animation engine evaluates path separation
    Then it must maintain a mandatory minimum safety clearance radius around each dancer at every frame

  Scenario: Identifying impossible trajectories or sharp directional turns exceeding physical turning limits
    Given a transition path contains a sharp directional change in the Bézier control points
    When the physics analyzer evaluates the acceleration and turning radius
    Then it must flag the trajectory as an impossible human movement if it exceeds maximum physical turning limits

  Scenario: Synchronising path crossings where multiple dancers traverse intersecting coordinates
    Given multiple dancers are scheduled to pass through the same floor coordinate
    When the temporal execution of their paths is analyzed
    Then the engine must verify that they arrive at the intersection at staggered time intervals to prevent simultaneous occupancy

  Scenario: Triggering a safety breakdown and flagging an alert upon path violation
    Given a path conflict or collision risk is detected during trajectory calculation
    When the safety validation routine flags the violation
    Then the system must trigger a safety breakdown event and generate an alert containing the offending timestamp and dancer identifiers

  Scenario: Excluding ghost dancers from occupancy and collision checks
    Given a setup includes non-physical ghost dancers for a phantom or fractional call
    When the collision detection routine scans dancer positions
    Then ghost dancers must be excluded from spatial-occupancy exclusion checks
    And only physical dancers may be flagged as colliding

  Scenario: Detecting end-state collisions after a transition is snapped to a formation
    Given a call's computed end board is snapped onto a recognised formation's slots
    When the collision check runs on the resulting positions
    Then it must confirm that no two physical dancers occupy the same slot
    And it must flag any genuine overlap that snapping did not resolve
