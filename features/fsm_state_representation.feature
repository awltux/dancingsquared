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

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Bounding the FSM to a limited set of valid formations
    Given the valid-formation list restricts what counts as a formation
    When the FSM is built
    Then the total number of distinct formation states must be bounded to a small fixed budget (on the order of a few hundred)
    And any board whose structural formation is not on the valid list must not be resolvable to an FSM state
    # Engine: library.getUniqueFormations() already collapses the 273 named formations to
    #          ~33 distinct shapes; the FSM curates its own smaller valid-formation list.

  @bind:matchFormations @bind:recognize
  Scenario: Rejecting a board that is not on the valid-formation list
    Given a board resolves to a structural shape that is not a recognised valid formation
    When the engine attempts to assign it an FSM state
    Then it must reject the configuration as not being a valid FSM state
    And it must not silently coerce it into a different valid formation

  # ---- compact encoding ----

  @bind:formationState
  Scenario: Encoding a state with a short formation id and orientation id
    Given every valid formation is assigned a short numeric id
    When a state is encoded
    Then the state id must combine the formation id with an orientation id
    And the orientation id must encode eight 45-degree steps (for example, a 3-bit orientation id)
    And the state id must therefore fit in a small integer

  @bind:dancerMatrix @bind:poseToVec @bind:apply5
  Scenario: Storing the canonical translation matrix alongside the state id
    Given a state represents a formation at a specific orientation
    When the state is materialised
    Then it must produce the canonical translation matrix of the eight dancers' position-and-heading vectors
    And this matrix must be reusable as the start matrix for the state's outgoing transitions
    # Engine: matrix.ts poseToVec builds each row; apply5 materialises the start matrix.

  @bind:formationState
  Scenario: Keeping memory bounded with short ids
    Given the FSM holds a bounded set of states and their outgoing edges
    When the table is stored
    Then each edge must reference its end state by short id rather than by an embedded matrix
    And the total memory footprint must stay small (on the order of tens of kilobytes for the whole table)

  # ---- rotation-equivariance ----

  @bind:formationState @bind:fitRigidMatrix
  Scenario: Computing a transition once at canonical orientation and reusing it across orientations
    Given a call's transition is computed from a formation at its canonical orientation
    When the same call is needed from an oriented copy of that formation
    Then the engine must reuse the canonical transition and apply only the orientation delta
    And it must not re-run the full call check for every orientation
    # Engine: fitRigidMatrix measures the net rotation of a rigid call so the orientation
    #          delta can be stored once instead of per orientation.

  @bind:formationState
  Scenario: Storing an orientation delta instead of a separate end matrix per orientation
    Given a call rotates the set by some multiple of 45 degrees
    When the transition is stored
    Then the edge must store the net orientation delta rather than a full end matrix per orientation
    And this must keep the transition table roughly independent of the number of orientations

  # ---- build-time enumeration ----

  @bind:applyToBoard @bind:legalCalls @bind:getout @bind:collisions
  Scenario: Enumerating the transition table once at build time
    Given a candidate call and a valid formation state
    When the build-time step evaluates the transition
    Then it must apply the call and verify the end lands in a valid formation
    And it must verify at least one valid getout exists from that end formation
    And it must verify the dancers do not collide in the end state
    And it must emit the statically-verified edge with its desirability weight
    # Engine: applicator.applyToBoard applies; matcher.knownFormation checks validity;
    #          solver.getout verifies a getout exists; Sequencer.collisions checks occupancy.

  @bind:legalCalls @bind:getout @bind:collisions
  Scenario: Running the expensive checks offline, not at runtime
    Given the per-formation call checks are expensive
    When the build completes
    Then every (formation, call) transition must have been verified and stored
    And the runtime engine must read the precomputed table rather than re-verifying transitions live

  @bind:applyToBoard @bind:legalCalls @bind:getout @bind:collisions
  Scenario: Skipping a transition that fails build-time verification
    Given a call from a formation ends in an unrecognised formation, has no getout, or collides
    When the build-time enumerator runs
    Then it must not add that call to the formation's outgoing edge set

  # ---- user amendment of the FSM ----

  @bind:applyToBoard @bind:getout @bind:collisions @bind:legalCalls
  Scenario: Amending the FSM with a call a user knows is valid
    Given a user knows a call is valid from a particular formation even though the build-time enumerator did not list it
    When the user amends the FSM to add that transition
    Then the amendment must be accepted only if applying the call lands in a recognised formation
    And the amended end formation must still have at least one valid getout to home
    And the amendment must be rejected if it would collide dancers or dead-end with no getout
    # Engine: the same checks the build-time step uses — applyToBoard, knownFormation,
    #          getout, collisions — gate a manual override so it can never introduce an
    #          illegal or dead-end transition.

  @bind:applyToBoard @bind:getout @bind:collisions
  Scenario: Rejecting an amendment that would create an illegal transition
    Given a user proposes an amendment whose end formation is unrecognised, collides, or has no getout
    When the FSM applies the proposed override
    Then the amendment must be rejected rather than silently added to the live FSM

  @bind:legalCalls
  Scenario: Recording an accepted amendment in the change ledger
    Given a user amendment passes the validity checks and is accepted
    When the FSM records the change
    Then the ledger must note the added (formation, call) edge with its author, timestamp, before-after values, and the user's reason
    And the runtime engine must now select that call as a legal continuation from the formation

  # ---- export and change ledger ----

  @bind:getUniqueFormations @bind:legalCalls
  Scenario: Exporting the FSM as a full snapshot plus a delta ledger
    Given the FSM holds the full set of states and transitions, some of which are user amendments and new formations
    When the user submits the FSM for integration with the master copy
    Then the export must contain a complete snapshot of the current FSM states and edges
    And it must be accompanied by a delta ledger of every change since the baseline
    And the ledger must record for each change its author, timestamp, target, before-after values, and reason
    # Engine: the snapshot reflects the current state set (getUniqueFormations) and edges;
    #          the delta ledger is the change log the engine maintains as the FSM is amended.

  @bind:legalCalls
  Scenario: The delta ledger covers amendments, new formations, and removals
    Given the change ledger tracks every modification to the FSM
    When an amendment, a newly added formation, or a removal is made
    Then each such change must appear in the ledger with its before-after values
    And a removal must record the removed target and why it was removed

  @bind:getUniqueFormations @bind:legalCalls
  Scenario: Exporting the snapshot and ledger as a machine-readable submission
    Given a user requests to submit the FSM to the master copy
    When the export is produced
    Then the snapshot and the delta ledger must be serialised in a machine-readable format suitable for review and import by the master
    And the submission must let a reviewer see exactly which changes are user-authored versus build-time defaults
