Feature: Guard Conditions for Call Preconditions
  As a square dance choreography engine
  I want to evaluate guard conditions prior to state transitions
  So that calls are only executed when hand holds, couple alignments, and facing directions meet exact prerequisites

  @bind:computeHandholds @bind:findMatchingVariant @bind:applyToBoard
  Scenario: Verifying hand hold connectivity requirements before call execution
    Given the current formation state requires specific hand-to-hand connections for a call
    When the engine checks the guard conditions for the requested transition
    Then it must verify that adjacent dancers possess the correct physical grips (e.g., right-hand star vs left-hand pull-by)
    # Engine: engine.handholds(poses) derives the entering handholds; findMatchingVariant gates apply.

  @bind:matchFormations @bind:findMatchingVariant
  Scenario: Checking couple alignment and structural pairing prerequisites
    Given a call requires dancers to be paired as designated couples or tandem units
    When the guard condition evaluator analyzes the active state matrix
    Then it must confirm that couples are correctly aligned side-by-side or front-to-back before allowing the transition

  @bind:findMatchingVariant @bind:matchFormations
  Scenario: Validating dancer facing directions against specific call preconditions
    Given a call specifies mandatory directional headings for incoming dancers
    When the transition guard assesses individual dancer orientation vectors
    Then it must ensure every dancer's heading matches the required facing direction (e.g., facing in, out, or down the line)
    # Engine: matchFormations includes heading in the per-dancer match error.

  @bind:findMatchingVariant @bind:computeHandholds @bind:matchFormations
  Scenario: Evaluating composite guard conditions combining multiple geometric prerequisites
    Given a complex call relies on simultaneous hand holds, facing directions, and mini-wave alignments
    When the composite guard rule is processed by the FSM
    Then all individual geometric and connective criteria must evaluate to true for the transition to be permitted

  @bind:applyToBoard @bind:findMatchingVariant
  Scenario: Rejecting state transitions when mandatory call preconditions are unmet
    Given a caller requests a movement from a formation where guard preconditions fail
    When the transition validation routine runs
    Then the system must block the transition, prevent execution, and flag the specific unmet prerequisite condition
    # Engine: applyToBoard returns {legal:false, reason} when the start setup does not match.
