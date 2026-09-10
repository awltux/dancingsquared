Feature: Zeros, Getouts and Tips
  As a square dance choreography engine
  I want to recognise zero sequences, compute getouts/getins, and assemble 64-beat tips over the FSM
  So that the engine can generate and validate self-contained choreography that starts and ends home

  Background:
    Given a sequence of calls is a walk through the FSM starting from a home squared-set state
    And the home state is the in-sequence squared set with every dancer at their home identity

  @bind:isZero @bind:apply
  Scenario: Recognising a zero sequence
    Given a sequence of calls is proposed
    When the engine walks the FSM from the home state and back
    Then the sequence is a "zero" if and only if it ends at the home state with the original home identity and sequence restored
    # Engine: SequenceAnalyzer.isZero(flat) checks the walk returns home in-sequence.

  @bind:isZero @bind:analyzeFasr @bind:stepBeats
  Scenario: A zero must also restore the dancers' facings
    Given a sequence turns every dancer in place without moving anyone, such as a pivot
    When the engine asks whether the sequence is a zero
    Then it must NOT report a zero, because the set no longer faces the way it started
    But a sequence whose net turn is a full circle must still be a zero
    # Engine: the FASR key alone is derived from POSITIONS (sequence parity plus the
    #          partner/corner relationships), so it reports a pure in-place pivot as a zero.
    #          isZero therefore ALSO requires every dancer to be back on its own facing,
    #          compared by identity and modulo a full turn (sameFacing, FACING_EPS 1e-3 rad so
    #          only floating-point drift is absorbed). This corrected catalogue calls such as
    #          "Allemande Left" (previously reported as a zero) while genuine zeros - a circle,
    #          "Heads Forward and Back", two half-pivots, opposite pivots - still pass.

  @bind:getout @bind:applyToBoard
  Scenario: Computing a getout back to home
    Given the set is in some non-home state
    When the engine searches for a forward call sequence to the home state
    Then it must return a legal path whose final state is home
    And it must not return a path whose first call is rejected when actually applied from the current state
    # Engine: solver.getout(board) returns a verified legal path to the target.

  @bind:getin
  Scenario: Computing a getin from home into a formation
    Given the engine is at the home state
    When it searches for a forward sequence into a target formation state
    Then it must return a legal path, distinct from simply running a getout backwards
    And calls must not run in reverse to construct the getin
    # Engine: solver.getin(board, {target}) searches forward from home.

  @bind:matrixGetout @bind:fitRigidMatrix @bind:mul5 @bind:identity5
  Scenario: Preferring a cheap getout via a rigid self-inverse call
    Given the current board is exactly the image of home under a rigid, self-inverse call
    When the engine looks for a getout
    Then it should return that single call as an O(1), matrix-verified getout
    And the same call applied once more returns home
    # Engine: solver.matrixGetout returns the single rigid self-inverse call; matrix.ts
    #          fitRigidMatrix + mul5 verify M·M = identity.

  @bind:buildTip @bind:sequenceBeats @bind:phrasesForBeats @bind:isZero
  Scenario: Assembling a 64-beat tip from a sequence
    Given a flat sequence of calls (modules expanded) is proposed as a tip
    When the engine sums the call beats
    Then the tip is valid only if it is a zero and its total beats sum to a complete 64-beat segment (four 16-beat phrases)
    And a continuous terminal action such as a promenade is the recognised exception: it is acknowledged as flow rather than counted to exactly 64
    # Engine: analyzer.sequenceBeats, phrasesForBeats, buildTip, isZero. Fixed per-call beats apply
    #          except for the closing terminal action, which is allowed to land short of 64.

  @bind:sequenceBeats @bind:stepBeats @bind:phrasesForBeats
  Scenario: A call has a defined beat count independent of how it is reached
    Given a call is a candidate transition in a sequence
    When the engine sums the beats of a sequence containing that call
    Then the call must contribute its own fixed beat count regardless of the preceding or following calls
    And the phrasing must align to the 16-beat phrase boundary once calls are summed
    # Engine: each call's beat count comes from its authored timing (stepBeats/sequenceBeats) and
    #          is independent of context; the phrase count (phrasesForBeats) is derived from the sum.

  @bind:sequenceBeats @bind:buildTip @bind:isZero
  Scenario: A getout may end on a terminal action that does not hit exactly 64 beats
    Given a tip is assembled from a sequence of calls with fixed beat counts
    When the getout ends with a continuous terminal action such as a promenade
    Then the preceding calls must sum to their fixed beats, but the promenade need not land exactly on the 64-beat boundary
    And the terminal action must be acknowledged as continuous flow rather than counted to exactly 64
    # Engine: each call before the terminal action contributes its fixed beat count; the closing
    #          promenade is treated as continuous flow so the final total need not equal 64 exactly.

  @bind:isZero @bind:validateSegment
  Scenario: Rejecting a tip that is not a zero
    Given a tip sequence does not return to the home state in-sequence
    When the engine validates the tip
    Then it must report the tip as not a zero and reject it

  @bind:flatten @bind:registerModule @bind:isModule
  Scenario: Exposing a module as a reusable transition subsequence
    Given a named module is a sequence of calls
    When the module is used as a single transition in a sequence
    Then it must expand to its constituent calls, cycle-guarded against self-reference
    And the module is legal only if every constituent call is legal from the state it is reached at
    # Engine: library.flatten expands modules cycle-guarded; registerModule/isModule.

  @bind:getout @bind:getin @bind:flatten @bind:mul5
  Scenario: Using a module as a single edge when computing a getout or getin
    Given a module is defined from a known start formation to a known end formation
    When the getout or getin search is considering paths through that formation
    Then the module must be usable as one transition rather than replayed call-by-call
    And the search must still verify the module's end formation and that it stays legal
    # Engine: the module's composed matrix (mul5) lets solver.getout/getin treat it as one
    #          step, while the resulting end formation is still validated.

  @bind:getout @bind:getin @bind:applyToBoard @bind:legalCalls
  Scenario: Substituting an equivalent call to resolve or get out
    Given a call is choreographically equivalent to a simpler known call from the current formation
    When the engine seeks a getout or a resolution
    Then it must be able to substitute the equivalent call and treat it as interchangeable for the purpose of resolution
    And the substituted call must still be legal and reach the same end state as the call it replaces
    # Engine: equivalents remain SEPARATE FSM edges. They are not merged, because the resolver must
    #          know which concrete call is used to know which path was taken. Substitution widens the
    #          search; it does not collapse the two calls into one edge.
