Feature: Invalid Transitions and Breakdown Management
  As a square dance choreography engine
  I want to trap illegal calls and handle unsupported state changes
  So that the system prevents silent failures and transitions cleanly into a controlled breakdown state

  Scenario: Trapping undefined calls requested from incompatible formation states
    Given the FSM is currently in a restricted formation state
    When an unsupported or illegal call is submitted for execution
    Then the transition controller must recognize the absence of a valid destination edge

  Scenario: Preventing silent execution failures when a transition lacks a valid target
    Given a requested call has no defined mathematical mapping from the current configuration
    When the engine processes the command stream
    Then it must intercept the failure before modifying the core dancer coordinate matrix

  Scenario: Transitioning cleanly into a controlled breakdown state upon rule violation
    Given an invalid transition attempt or rule violation occurs
    When the error handler forces a state change
    Then the FSM must transition directly into an explicitly defined "Breakdown" error state rather than crashing

  Scenario: Generating descriptive error logs and diagnostic details for illegal state attempts
    Given the choreography engine catches an illegal call attempt
    When the diagnostic logger records the event
    Then it must output a detailed report containing the originating formation, the attempted call, and the specific failure reason

  Scenario: Recovering or resetting the FSM state following a structural breakdown event
    Given the engine is currently locked in a breakdown error state
    When a reset command or valid recovery routine is triggered
    Then the FSM must clear the error status and return to a safe baseline default formation

  Scenario: Rejecting a call whose start matrix does not overlay the current state
    Given the current formation matrix does not match a call's start-setup matrix within tolerance
    When the call is submitted for execution
    Then the transition controller must recognise the absence of a valid destination edge and reject it

  Scenario: Rejecting a call that violates home-identity assignment
    Given a head/side or gender-specific call is requested
    When the board's gender arrangement or original head/side designation does not match the call's requirement
    Then the engine must reject the transition
    And it must not silently redirect the call to whichever dancers now occupy the relevant compass positions

  Scenario: Rejecting a zero-weight transition from selection
    Given a call transition has an effective desirability weight of zero
    When a getout or tip generator attempts to select it
    Then the engine must not select it as a legal continuation

  Scenario: Refusing to expand a self-referential module
    Given a module includes itself directly or transitively in its call list
    When the module is expanded as a transition
    Then the engine must detect the cycle and refuse to expand it rather than looping forever

  Scenario: Emitting diagnostics that identify the originating state, call, and reason
    Given the engine rejects an illegal transition
    When the diagnostic logger records the event
    Then it must report the originating (formation, orientation) state, the attempted call, and the specific reason for rejection
