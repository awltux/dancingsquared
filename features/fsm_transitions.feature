Feature: FSM Transitions Between Formation Matrices
  As a square dance choreography engine
  I want to model the dance as a finite state machine where each state is a (formation, orientation) matrix and each call is a deterministic matrix transformation
  So that every legal sequence is exactly a walk through the FSM from one formation state to another, with transitions ranked by desirability

  Background:
    Given the FSM state set is the collection of all recognized (formation, orientation) states
    And each state is backed by a canonical matrix of the eight dancers' position-and-heading vectors
    And each transition is a call, which deterministically maps a start state matrix to exactly one end state matrix
    And every outgoing transition of a state carries a desirability weight in [0,1]

  Scenario: A state is identified by both formation and absolute orientation
    Given a squared set is configured with the heads facing north
    When the same structural formation is configured with the heads facing east
    Then the two configurations MUST resolve to different FSM states because they differ in absolute orientation
    And each state must still share the same structural formation template for guard-condition matching

  Scenario: A call is a deterministic matrix transformation from one state to one end state
    Given the FSM is in a start state matrix S
    When a specific call C is applied to S
    Then the engine must compute exactly one end state matrix S'
    And S' must equal the canonical representation of the resulting dancer positions and headings

  Scenario: Applying the same call from a rotated start state produces a rotated end state
    Given a start state S and a 90-degree-rotated copy S_rot of the same structural formation
    When the same call C is applied to both S and S_rot
    Then the two end states must be congruent under the same 90-degree rotation
    And both transitions must reference the same call and the same desirability weight

  Scenario: Enumerating the outgoing edges of a state
    Given the FSM is settled in a specific state node
    When the transition table for that node is queried
    Then it must return every call that is legal from that state
    And each returned edge must include its desirability weight and its deterministic end state

  Scenario: A legal sequence is a walk through the FSM
    Given a sequence of calls is proposed starting from a home squared-set state
    When the engine walks the FSM by applying each call in order
    Then each step must transition to a state that is a recognized member of the state set
    And the sequence must be rejected if any call has no outgoing edge from the current state

  Scenario: Preserving identity across a transition
    Given each dancer carries a fixed home identity (id and home couple) stamped at the start of the tip
    When a call transformation moves the dancers to the end state
    Then each end-state matrix entry must retain its dancer's home identity
    And heads/sides designations must continue to refer to the original home couples, not to whichever couples now occupy the compass positions

  Scenario: Recording the orientation delta of a transition
    Given a call is applied and the set rotates by some multiple of 45 degrees
    When the transition is recorded
    Then the edge must capture the net orientation delta at 45-degree granularity so the FSM can reconstruct absolute heading states

  Scenario: Supporting 45-degree (1/8-rotation) orientation granularity
    Given the FSM encodes orientation as one of eight compass steps at 45-degree intervals
    When a move that rotates the set by an eighth of a turn is applied
    Then the orientation component of the state must advance by one 45-degree step
    And the orientation id must encode all eight steps (for example, a 3-bit orientation id)
    And a move with no net rotation must leave the orientation id unchanged

  Scenario: A 45-degree rotation lands on a distinct orientation state
    Given a formation state is settled at a canonical orientation
    When a call rotates the set by 45 degrees
    Then the resulting state must differ from the original in its orientation component
    And the structural formation template must remain the same

