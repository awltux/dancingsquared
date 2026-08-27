Feature: FSM Transitions Between Formation Matrices
  As a square dance choreography engine
  I want to model the dance as a finite state machine where each state is a (formation, orientation) matrix and each call is a deterministic matrix transformation
  So that every legal sequence is exactly a walk through the FSM from one formation state to another, with transitions ranked by desirability

  Background:
    Given the FSM state set is the collection of all recognized (formation, orientation) states
    And each state is backed by a canonical matrix of the eight dancers' position-and-heading vectors
    And each transition is a call, which deterministically maps a start state matrix to exactly one end state matrix
    And every outgoing transition of a state carries a desirability weight in [0,1]

  @bind:formationState @bind:recognize
  Scenario: A state is identified by both formation and absolute orientation
    Given a squared set is configured with the heads facing north
    When the same structural formation is configured with the heads facing east
    Then the two configurations MUST resolve to different FSM states because they differ in absolute orientation
    And each state must still share the same structural formation template for guard-condition matching
    # Engine: matcher.formationState(board) returns {name, rot, reflect, ...}; a rotated board
    #          must yield a different rot so the FSM keys states on (formation, orientation).

  @bind:applyToBoard @bind:dancerMatrix @bind:apply5
  Scenario: A call is a deterministic matrix transformation from one state to one end state
    Given the FSM is in a start state matrix S
    When a specific call C is applied to S
    Then the engine must compute exactly one end state matrix S'
    And S' must equal the canonical representation of the resulting dancer positions and headings
    # Engine: applicator.applyToBoard(board, call) computes the end board; matrix.ts
    #          dancerMatrix/dancerMatricesById yield the per-dancer affine maps.

  @bind:matchFormations @bind:formationState
  Scenario: Applying the same call from a rotated start state produces a rotated end state
    Given a start state S and a 90-degree-rotated copy S_rot of the same structural formation
    When the same call C is applied to both S and S_rot
    Then the two end states must be congruent under the same 90-degree rotation
    And both transitions must reference the same call and the same desirability weight

  @bind:legalCalls @bind:legalNext
  Scenario: Enumerating the outgoing edges of a state
    Given the FSM is settled in a specific state node
    When the transition table for that node is queried
    Then it must return every call that is legal from that state
    And each returned edge must include its desirability weight and its deterministic end state
    # Engine: legality.legalCalls(board) / Sequencer.legalNext() enumerate legal transitions.

  @bind:apply @bind:legalCalls
  Scenario: A legal sequence is a walk through the FSM
    Given a sequence of calls is proposed starting from a home squared-set state
    When the engine walks the FSM by applying each call in order
    Then each step must transition to a state that is a recognized member of the state set
    And the sequence must be rejected if any call has no outgoing edge from the current state
    # Engine: Sequencer.apply(name) applies one call and returns {legal, board, formation}.

  @bind:assignHomeIdentity
  Scenario: Preserving identity across a transition
    Given each dancer carries a fixed home identity (id and home couple) stamped at the start of the tip
    When a call transformation moves the dancers to the end state
    Then each end-state matrix entry must retain its dancer's home identity
    And heads/sides designations must continue to refer to the original home couples, not to whichever couples now occupy the compass positions
    # Engine: identity.assignHomeIdentity stamps id/couple so heads/sides stay on home couples.

  @bind:formationState
  Scenario: Recording the orientation delta of a transition
    Given a call is applied and the set rotates by some multiple of 45 degrees
    When the transition is recorded
    Then the edge must capture the net orientation delta at 45-degree granularity so the FSM can reconstruct absolute heading states

  @bind:formationState
  Scenario: Supporting 45-degree (1/8-rotation) orientation granularity
    Given the FSM encodes orientation as one of eight compass steps at 45-degree intervals
    When a move that rotates the set by an eighth of a turn is applied
    Then the orientation component of the state must advance by one 45-degree step
    And the orientation id must encode all eight steps (for example, a 3-bit orientation id)
    And a move with no net rotation must leave the orientation id unchanged

  @bind:formationState @bind:fitRigidMatrix
  Scenario: A 45-degree rotation lands on a distinct orientation state
    Given a formation state is settled at a canonical orientation
    When a call rotates the set by 45 degrees
    Then the resulting state must differ from the original in its orientation component
    And the structural formation template must remain the same

  @bind:formationState @bind:fitRigidMatrix
  Scenario: Naming calls that actually rotate the set by 1/8 of a turn
    Given a call is authored with 45-degree (Eighth) or half-hinge move primitives
    When the call's net rigid rotation is measured
    Then the call must advance the orientation component by one 45-degree step
    And concrete examples that do this include Reverse, Wheel Around, Alamo Style, Circle By,
        Circle to a Line, Chain Reaction, Cross By, and the Concentric family
    # Data: moves.xml defines Eighth Left/Right (45deg turn in place), HalfHinge and
    #       HalfBackHinge (45deg of a hinge). Calls that compose these, e.g.
    #       a1/reverse.xml, b2/wheel_around.xml, b2/alamo_style.xml, b1/circle_by.xml,
    #       b1/circle_to_a_line.xml, c1/chain_reaction.xml, c1/cross_by.xml, and
    #       c1/concentric_concept.xml, are the concrete 1/8-rotation examples.

  @bind:formationState
  Scenario: Orientations are never collapsed even for symmetric formations
    Given a formation is rotationally symmetric, such as a squared set under a 90-degree rotation
    When the FSM state set is built
    Then every one of the eight 45-degree orientations MUST remain a distinct state
    And the formation's symmetry must not merge 0 and 180 degrees or any other pair of orientations
    # This is the resolved symmetry-collapse rule: orientation is part of state identity, so
    # all eight orientations are distinct regardless of the formation's rotational symmetry.
    # The edge table stays small because transitions are shared across orientations via the
    # rotation-delta (rotation-equivariance), not by collapsing states.
