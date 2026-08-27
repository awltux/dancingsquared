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

  @bind:matchFormations
  Scenario: The static formation's position order need not match the board's dancer order
    Given a formation's canonical definition lists its dancers in a fixed order of positions
    When the board places the same dancers in a different order, such as couple 1 not occupying positions 1 and 2
    Then the engine must not assume the formation's position order equals the board's dancer order
    And it must match by geometry and identity, deriving a mapping from each board dancer to its canonical position
    # Engine: matchFormations returns mapping[boardIdx] = candidateIdx, so the canonical
    #          position order and the board dancer order can differ freely.

  @bind:matchFormations
  Scenario: Matching a static formation to the board without trusting position order
    Given a board's dancers are permuted relative to a formation's canonical position list
    When the engine determines whether the board is at that formation state
    Then it must still recognise the state through order-independent matching
    And the resulting mapping must be used to align the transformation to the board's actual dancer order

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

  @bind:findMatchingVariant @bind:variantStarts @bind:applyToBoard
  Scenario: Resolving the correct variant when a call name has definitions per start formation
    Given a call such as one covered by the Facing Couples Rule may be defined differently from facing couples than from another setup
    When the engine is asked to apply that call from the current board
    Then it must select the variant whose start setup matches the current formation
    And it must use that variant's own end formation rather than a generic definition for the call name
    # Engine: findMatchingVariant picks the variant (variantStarts) whose setup matches the board,
    #          so the same name can yield different end formations from different start formations.

  @bind:formationState @bind:matchFormations
  Scenario: Distinguishing a wrong-way star from a normal star
    Given a formation is a star or thar whose dancers circulate in the direction opposite to the held hand
    When the FSM identifies the formation state
    Then it must treat the wrong-way star as a distinct (formation, orientation) state from its normal counterpart
    And the direction of circulation must be part of how the state is recognised, not inferred later

  @bind:formationState @bind:matchFormations @bind:findMatchingVariant
  Scenario: Distinguishing one-faced from two-faced lines
    Given a line of dancers may face a single direction (one-faced) or opposite directions as couples (two-faced)
    When the FSM decides which calls are legal from that line
    Then the one-faced and two-faced arrangements MUST be distinct states even if their dancers sit at the same positions
    And calls such as "Bend the Line" must only be legal from the arrangement they actually require
    # Engine: formationState / findMatchingVariant distinguish by facing (heading), so a two-faced
    #          line and a one-faced line with coincident dancers are different states.

  @bind:matchFormations @bind:formationState @bind:recognize
  Scenario: Recognising distinct topology classes such as diamonds, hourglasses, and T-bones
    Given a formation such as a diamond, hourglass, T-bone, or butterfly occupies a distinct non-standard layout
    When the FSM identifies the formation state
    Then each topology class must be recognised and matched as its own structural template, not conflated with lines or waves
    And a call authored for a specific topology must only apply when that topology is the current state
    # Engine: recognition matches each named formation's geometry (matchFormations/formationState),
    #          so diamond, hourglass, T-bone, butterfly, etc. are distinct templates in the library.

  @bind:matchFormations @bind:formationState @bind:getUniqueFormations
  Scenario: A topology may be required as the start formation of a call
    Given a call is authored to begin from a specific topology such as a diamond or a box
    When the engine checks whether the current board is at that start formation
    Then the board must be recognised as that topology within tolerance before the call is legal
    And calls that do not start from that topology must be rejected
