Feature: Zeros, Getouts and Tips
  As a square dance choreography engine
  I want to recognise zero sequences, compute getouts/getins, and assemble 64-beat tips over the FSM
  So that the engine can generate and validate self-contained choreography that starts and ends home

  Background:
    Given a sequence of calls is a walk through the FSM starting from a home squared-set state
    And the home state is the in-sequence squared set with every dancer at their home identity

  Scenario: Recognising a zero sequence
    Given a sequence of calls is proposed
    When the engine walks the FSM from the home state and back
    Then the sequence is a "zero" if and only if it ends at the home state with the original home identity and sequence restored

  Scenario: Computing a getout back to home
    Given the set is in some non-home state
    When the engine searches for a forward call sequence to the home state
    Then it must return a legal path whose final state is home
    And it must not return a path whose first call is rejected when actually applied from the current state

  Scenario: Computing a getin from home into a formation
    Given the engine is at the home state
    When it searches for a forward sequence into a target formation state
    Then it must return a legal path, distinct from simply running a getout backwards
    And calls must not run in reverse to construct the getin

  Scenario: Preferring a cheap getout via a rigid self-inverse call
    Given the current board is exactly the image of home under a rigid, self-inverse call
    When the engine looks for a getout
    Then it should return that single call as an O(1), matrix-verified getout
    And the same call applied once more returns home

  Scenario: Assembling a 64-beat tip from a sequence
    Given a flat sequence of calls (modules expanded) is proposed as a tip
    When the engine sums the call beats
    Then the tip is valid only if it is a zero and its total beats sum to a complete 64-beat segment (four 16-beat phrases)
    And continuous terminal actions such as a promenade are acknowledged as flow rather than counted to exactly 64

  Scenario: Rejecting a tip that is not a zero
    Given a tip sequence does not return to the home state in-sequence
    When the engine validates the tip
    Then it must report the tip as not a zero and reject it

  Scenario: Exposing a module as a reusable transition subsequence
    Given a named module is a sequence of calls
    When the module is used as a single transition in a sequence
    Then it must expand to its constituent calls, cycle-guarded against self-reference
    And the module is legal only if every constituent call is legal from the state it is reached at
