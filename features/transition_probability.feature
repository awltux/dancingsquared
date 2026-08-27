Feature: Transition Probability, Flow and Selection
  As a square dance choreography engine
  I want to weight each call transition from a formation state by a static build-time desirability, a runtime flow, and family-repeat rules
  So that the engine can rank legal continuations and select a next call in a way that reflects how naturally and desirably one call flows into another

  Background:
    Given every outgoing call transition of a formation state can be selected
    And a call is deterministic: applying it from a start state always yields a single end state
    And the effective weight of a transition is a combination of its static desirability, its runtime flow, and any family-repeat adjustment

  # ---- static (build-time) desirability ----

  @bind:applyToBoard @bind:legalCalls @bind:getout @bind:collisions
  Scenario: Verifying a transition statically at build time
    Given a call is authored as a matrix transformation from a start formation state
    When the build-time verifier checks the transition
    Then it must confirm the call's end matrix lands in a valid recognised formation
    And it must confirm at least one valid getout exists from that resulting formation
    And it must confirm the dancers do not collide in the end state
    And it must assign a static desirability weight from these verification outcomes

  @bind:applyToBoard @bind:legalCalls @bind:getout @bind:collisions
  Scenario: Excluding a truly invalid transition but only down-weighting bad flow
    Given a call ends in an unrecognised formation, has no getout from that formation, or produces a collision
    When the build-time verifier runs
    Then a call that is truly invalid and can never happen must be EXCLUDED from the state's outgoing edge set
    And a call that is legal but has poor flow must instead be retained with a LOW static desirability
    # Engine: the verifier separates hard invalidity (unrecognised end / no getout / collision ->
    #          exclude) from mere bad flow (retained, low weight). Exclusion and low-weighting
    #          are distinct outcomes, not interchangeable.

  @bind:legalCalls
  Scenario: Static desirability is fixed for a given build
    Given a transition has been statically verified
    When the same build is run again
    Then its static desirability weight must not vary at runtime

  # ---- runtime flow ----

  @bind:computeHandholds @bind:legalCalls
  Scenario: Computing runtime flow from the dancers' state
    Given the set is about to transition out of a start state
    When the runtime flow for an outgoing call is computed
    Then it must consider each dancer's gender
    And it must consider the handhold entering the call and the handhold leaving it
    And it must consider the dancers' momentum leading into the move
    And a higher flow must yield a higher effective weight for that call
    # Engine: engine.handholds derives the entering handholds from the current poses.

  @bind:computeHandholds @bind:legalCalls
  Scenario: Flow favours the natural continuation of a handhold
    Given the dancers are holding hands in a certain grip at the end of the current call
    When the incoming and outgoing handholds of the next call are evaluated
    Then a call whose handholds flow naturally from the current grip must score higher flow than one that forces an awkward regrip

  @bind:legalCalls
  Scenario: Flow respects momentum
    Given the set has momentum moving in a direction from the preceding call
    When a next call is considered
    Then a call that continues that momentum must score higher flow than one that sharply reverses it

  @bind:matchFormations @bind:legalCalls
  Scenario: Flow accounts for gender-specific continuation
    Given a transition involves gender-specific movement
    When the flow is computed
    Then the flow must favour the call when the dancers' genders align with the movement they are about to make

  # ---- family-repeat rules ----

  @bind:legalCalls
  Scenario: Applying a family-repeat rule
    Given a tip has already used a call from a family
    When a next call from that same family is considered
    Then the selection must apply the configured family-repeat rule, which may discourage or permit the repeat depending on the family

  @bind:legalCalls
  Scenario: Recognising common family-to-family continuations
    Given a pair of calls forms a common, natural continuation within or across families
    When the pair is evaluated
    Then it must be recognised as highly likely, for example "Circle Left" followed by "Circle Right"
    And such a pair must receive a higher effective weight than a non-idiomatic continuation

  @bind:legalCalls
  Scenario: Discounting the exact repetition of a call already used
    Given a call has already been used in the current tip
    When the next call is selected
    Then repeating the exact same call must be down-weighted unless a family-repeat rule overrides it

  # ---- combining and selecting ----

  @bind:legalCalls @bind:setSelectionMode @bind:setRandomSource
  Scenario: Combining static desirability, flow, and family rules into an effective weight
    Given a formation state has several legal outgoing calls
    When the effective weight of each is computed
    Then it must combine the static desirability, the runtime flow, and the family-repeat adjustment
    And any call with zero effective weight must not be selected

  @bind:parallelLegalCalls @bind:matchFormationsAll @bind:setSelectionMode @bind:setRandomSource
  Scenario: A whole-set parallel transition is weighed as one edge
    Given a call applies concurrently across several disjoint sub-formations of the set
    When the engine computes the effective weight of that whole-set transition
    Then the static desirability, runtime flow, and family-repeat adjustment must all be evaluated over the combined whole-set outcome
    And the parallel call must be selected as a single edge in proportion to that one combined weight
    And it must never be selected per sub-formation independently
    # Engine: parallelLegalCalls yields one {name, board} per whole-set transition; selection
    #          ranks whole-set edges, so the parallel transition competes as one weighted edge.

  @bind:setSelectionMode @bind:setRandomSource @bind:legalCalls
  Scenario: Selecting among available calls with randomness
    Given multiple outgoing calls have positive effective weight
    When the engine chooses a continuation
    Then it may select probabilistically in proportion to the effective weights
    And the chosen call still yields its single deterministic end state
    # Engine: Sequencer.setSelectionMode('best' | 'probabilistic') and setRandomSource() drive
    #          selection; config.rand is the injectable random source.

  @bind:applyToBoard @bind:setSelectionMode @bind:setRandomSource
  Scenario: The probability is a property of the transition and context, never the outcome
    Given a call is selected by the engine
    When it is applied
    Then the end state must be the unique deterministic outcome
    And the weight must affect only the likelihood of choosing the call, never its result
