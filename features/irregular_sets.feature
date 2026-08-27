Feature: Irregular Sets and Topography Edge Cases
  As a square dance choreography engine
  I want to detect and handle non-standard configurations and uneven sets
  So that the system gracefully adapts or rejects calls when dancer counts or geometries deviate from a standard square

  Scenario: Detecting non-standard set configurations with missing couples
    Given a set contains fewer than the standard four couples
    When the initialization or parsing routine evaluates the dancer array
    Then it must flag the configuration as an irregular set topography

  Scenario: Adapting FSM state recognition for three-couple sets instead of four
    Given a dance session is operating with three active couples instead of four
    When the state identification algorithm maps the formation
    Then the FSM must match it against specialized three-couple structural templates rather than failing to resolve

  Scenario: Handling broken sets where individual dancers are missing or displaced
    Given one or more specific dancer slots are vacant due to a breakdown or absence
    When the spatial evaluator assesses the set topology
    Then it must assign a "Broken Set" classification and isolate the unaffected sub-groups

  Scenario: Rejecting calls that strictly require a full eight-dancer square configuration
    Given an irregular set is currently active
    When a call requiring a full eight-dancer square structure is attempted
    Then the guard condition checker must reject the transition and prevent execution

  Scenario: Modifying transformation matrices to accommodate asymmetric or uneven formations
    Given an asymmetric or uneven formation requires coordinate calculation
    When the transformation engine computes the matrix offsets
    Then it must dynamically adjust the spatial bounds to fit the irregular dancer count without causing coordinate overflow

  Scenario: Using ghost dancers to complete phantom and fractional setups
    Given a call references a phantom column, incomplete box, or fractional formation with missing partners
    When the engine resolves the setup
    Then it must instantiate non-physical ghost dancers as geometric reference points
    And ghosts must be excluded from physical collision and occupancy checks

  Scenario: Handling a half-set that is an authoring convenience, not an occupied subset
    Given a formation is defined by only half its dancers as an authoring shortcut
    When the engine completes the full symmetric formation
    Then it must rotate the half about the centre to produce the full set
    And it must not confuse this with a genuine subset the dancers actually occupy

  Scenario: Rejecting a call that strictly requires a full set on an irregular board
    Given an irregular set is active
    When a call that requires a full eight-dancer square structure is attempted
    Then the engine must reject the transition
    And it must report the reason as the set not being a full squared set

  Scenario: Adapting to a set with fewer couples by limiting the available transitions
    Given a session is running with three active couples instead of four
    When the state identification algorithm maps the formation
    Then it must match against three-couple structural templates
    And any call that requires the fourth couple must be excluded from the state's outgoing transitions
