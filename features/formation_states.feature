Feature: Formation States and FSM Structure
  As a square dance choreography engine
  I want to define formations as abstract FSM states and recognize structural equivalence classes
  So that state transitions remain consistent regardless of absolute compass orientation or minor positional variations

  @bind:matchFormations @bind:recognize
  Scenario: Defining abstract formations as distinct FSM states
    Given a set of eight dancers are positioned in a recognized structural layout
    When the engine evaluates the absolute coordinates against known formation templates
    Then the FSM must map the current configuration to a distinct abstract formation state

  @bind:matchFormations @bind:formationState
  Scenario: Recognising structural equivalence classes regardless of absolute compass orientation
    Given two sets of dancers are arranged in identical wave structures but oriented toward different compass points
    When the state identification algorithm processes both sets
    Then both configurations must resolve to the same abstract structural equivalence class
    # The structural template is the same; only the orientation component differs, so the FSM
    # state (formation, orientation) differs but shares the template for guard matching.

  @bind:legalCalls @bind:applyToBoard
  Scenario: Mapping valid start and end conditions for standard formations
    Given a specific square dance call has defined prerequisite formations
    When the FSM queries the transition table for that call
    Then it must correctly return the valid start states and the guaranteed corresponding end states

  @bind:matchFormations @bind:formationState
  Scenario: Normalising rotated or mirrored formations to a canonical state representation
    Given a formation is rotated or mirrored relative to the default template definition
    When the normalisation filter is applied to the dancer matrix
    Then the system must transform the coordinates into a canonical state representation for accurate matching
    # Engine: matcher.rebasedPose re-expresses a pose in the board's own frame using the match.

  @bind:formationState @bind:recognize
  Scenario: Querying active formation metadata from the current state node
    Given the FSM is currently settled in a specific formation state node
    When a query is made for structural metadata such as center points and slot alignments
    Then the state node must return the accurate geometric properties required for the next transition calculation

  @bind:poseToVec @bind:apply5
  Scenario: Encoding a formation state as a matrix of dancer state vectors
    Given a recognized structural layout is settled as the current state
    When the state is materialized for transformation
    Then it must be encoded as a matrix of the eight dancers' position-and-heading vectors
    And the matrix must carry each dancer's home identity so it is preserved across transitions

  @bind:formationState
  Scenario: Distinguishing states that differ only by absolute orientation
    Given a formation state is settled with the set oriented to the north
    When the identical structural formation is oriented to a different compass step
    Then the FSM must treat them as two distinct states because orientation is part of state identity
    And orientation must be quantised to 45-degree (1/8-rotation) steps, giving eight distinct orientations
    And both states must share the same structural equivalence class for guard-condition purposes

  @bind:matchFormations @bind:snapBoard
  Scenario: Normalising a state to its canonical matrix for matching
    Given a state matrix may be translated, rotated, or reflected relative to its default template
    When a transition queries whether a board is at this state
    Then the engine must recognise the board as this (formation, orientation) state
    And any rotation/reflection that is NOT part of the state identity must be normalised away before matching
    # Engine: matcher.snapBoard clamps onto canonical slots while preserving id/couple/gender.

  @bind:dancerMatrix @bind:apply5
  Scenario: Reusing the canonical matrix to seed the next transition
    Given the FSM is settled in a state node whose canonical matrix is cached
    When the next call transition is about to be applied
    Then the transition must consume the canonical start matrix
    And the resulting end matrix must become the new current state's canonical matrix

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Adding a new formation to the FSM from its geometry alone
    Given a user wants to add a formation that is not yet on the valid-formation list
    When the user supplies the formation's dancer coordinates and headings
    Then the FSM must add it as a new state carrying its geometry, home-identity mapping, and orientation steps
    And it must not be required to provide a getout or call-validity checks at the moment it is added
    # Engine: the new formation enters the FSM by its shape (dancer positions/headings);
    #          getout and call-validity remain deferred until later verified or amended.

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Deferring getout and call checks on a newly added formation
    Given a formation has just been added to the FSM from its geometry alone
    When the engine later checks whether a getout or any valid call exists from it
    Then those checks must be allowed to return empty while the formation is still being filled in
    And the formation must not be treated as a verified, callable state until those checks are satisfied

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Recording a newly added formation in the change ledger
    Given a new formation has been added to the FSM
    When the FSM records the change
    Then the ledger must note the added formation with its author, timestamp, geometry, and the user's reason
    And the change must be exported along with the rest of the FSM snapshot and delta ledger
