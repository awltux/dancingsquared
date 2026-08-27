Feature: FSM State Representation and Build-Time Enumeration
  As a square dance choreography engine
  I want to represent the FSM states with a compact encoding and precompute the transition table at build time
  So that the whole state machine stays memory-bounded and the expensive per-formation call checks run once, offline

  Background:
    Given the FSM state set is the collection of recognised (formation, orientation) states
    And a state is valid only if its formation is on the curated valid-formation list
    And each state is encoded with a short id plus a canonical translation matrix
    And transitions are computed once at build time and stored

  # ---- state set and validity ----

  Scenario: Bounding the FSM to a limited set of valid formations
    Given the valid-formation list restricts what counts as a formation
    When the FSM is built
    Then the total number of distinct formation states must be bounded to a small fixed budget (on the order of a few hundred)
    And any board whose structural formation is not on the valid list must not be resolvable to an FSM state

  Scenario: Rejecting a board that is not on the valid-formation list
    Given a board resolves to a structural shape that is not a recognised valid formation
    When the engine attempts to assign it an FSM state
    Then it must reject the configuration as not being a valid FSM state
    And it must not silently coerce it into a different valid formation

  # ---- compact encoding ----

  Scenario: Encoding a state with a short formation id and orientation id
    Given every valid formation is assigned a short numeric id
    When a state is encoded
    Then the state id must combine the formation id with an orientation id
    And the orientation id must encode eight 45-degree steps (for example, a 3-bit orientation id)
    And the state id must therefore fit in a small integer

  Scenario: Storing the canonical translation matrix alongside the state id
    Given a state represents a formation at a specific orientation
    When the state is materialised
    Then it must produce the canonical translation matrix of the eight dancers' position-and-heading vectors
    And this matrix must be reusable as the start matrix for the state's outgoing transitions

  Scenario: Keeping memory bounded with short ids
    Given the FSM holds a bounded set of states and their outgoing edges
    When the table is stored
    Then each edge must reference its end state by short id rather than by an embedded matrix
    And the total memory footprint must stay small (on the order of tens of kilobytes for the whole table)

  # ---- rotation-equivariance ----

  Scenario: Computing a transition once at canonical orientation and reusing it across orientations
    Given a call's transition is computed from a formation at its canonical orientation
    When the same call is needed from an oriented copy of that formation
    Then the engine must reuse the canonical transition and apply only the orientation delta
    And it must not re-run the full call check for every orientation

  Scenario: Storing an orientation delta instead of a separate end matrix per orientation
    Given a call rotates the set by some multiple of 45 degrees
    When the transition is stored
    Then the edge must store the net orientation delta rather than a full end matrix per orientation
    And this must keep the transition table roughly independent of the number of orientations

  # ---- build-time enumeration ----

  Scenario: Enumerating the transition table once at build time
    Given a candidate call and a valid formation state
    When the build-time step evaluates the transition
    Then it must apply the call and verify the end lands in a valid formation
    And it must verify at least one valid getout exists from that end formation
    And it must verify the dancers do not collide in the end state
    And it must emit the statically-verified edge with its desirability weight

  Scenario: Running the expensive checks offline, not at runtime
    Given the per-formation call checks are expensive
    When the build completes
    Then every (formation, call) transition must have been verified and stored
    And the runtime engine must read the precomputed table rather than re-verifying transitions live

  Scenario: Skipping a transition that fails build-time verification
    Given a call from a formation ends in an unrecognised formation, has no getout, or collides
    When the build-time enumerator runs
    Then it must not add that call to the formation's outgoing edge set
