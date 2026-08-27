Feature: Transition Probability and Desirability
  As a square dance choreography engine
  I want to weight every outgoing call transition of a formation state
  So that the engine can rank legal continuations, pick the most desirable call for a getout/tip, and optionally select a call probabilistically

  Background:
    Given every outgoing call transition of a formation state carries a desirability weight in [0,1]
    And a call is deterministic: applying it from a start state always yields the same single end state

  Scenario: Assigning a fixed desirability weight to a call transition
    Given a formation state F has several legal outgoing calls
    When each call transition is registered in the transition table
    Then each edge must store a base desirability weight reflecting how typical or preferred that transition is

  Scenario: Ranking the legal continuations of a state by weight
    Given the engine must choose a continuation from the current formation state
    When the outgoing transitions are enumerated
    Then they must be orderable by desirability weight (highest first)
    And the ordering must be stable for a fixed state and call set

  Scenario: Overriding a base weight with a context-dependent weight
    Given a transition has a base desirability weight
    When the caller supplies a context (for example, the current session's taught calls or prioritised problem call-setups)
    Then the effective weight must be computed from the base weight and the context overrides
    And prioritised call-setups must receive an increased effective weight, capped at 1.0

  Scenario: Selecting a continuation deterministically by weight
    Given a getout or a generated tip must choose among several legal calls
    When the selection mode is "best"
    Then the engine must pick the legal call with the highest effective weight

  Scenario: Selecting a continuation probabilistically by weight
    Given the engine operates in probabilistic mode
    When a call is chosen from the legal continuations
    Then each call must be selected with probability proportional to its effective weight
    And calls with zero weight must never be selected
    And the selected call still yields its single deterministic end state

  Scenario: A zero-weight transition is unreachable by selection
    Given a call transition has an effective weight of zero
    When a continuation is selected either deterministically or probabilistically
    Then that call must never be chosen by the selection algorithm

  Scenario: Rejecting selection when no outgoing transition has positive weight
    Given the current state has only zero-weight outgoing transitions
    When a getout or tip generator attempts to select a continuation
    Then the engine must report that no desirable continuation exists rather than picking arbitrarily

  Scenario: The probability is a property of the transition, not the outcome
    Given a call is selected from a state
    When the call is applied
    Then the resulting end state must be the unique deterministic outcome regardless of the selected weight
    And the weight must not change the end state, only the likelihood of choosing the call
