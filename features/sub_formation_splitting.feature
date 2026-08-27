Feature: Sub-Formation Splitting and Concurrency
  As a square dance choreography engine
  I want to temporarily split the eight-dancer set into independent sub-formations and re-merge them
  So that concurrent calls operating on isolated sub-groups are accurately simulated and synchronized

  @bind:matchFormationsAll @bind:physicalDancers
  Scenario: Splitting the eight-dancer set into independent sub-formations during concurrent calls
    Given a unified eight-dancer set is executing a call that divides the floor
    When the transition evaluator processes the division command
    Then the system must separate the dancer matrix into independent sub-formations such as mini-waves or lines
    # Engine: matchFormationsAll returns each disjoint copy of a sub-formation in the board.

  @bind:parallelLegalCalls @bind:matchFormationsAll
  Scenario: Managing parallel execution states across isolated sub-groups
    Given the set is split into multiple independent sub-formations
    When concurrent call steps are executed across the floor
    Then each sub-group must track its own internal FSM state and coordinate progression independently without interfering with others

  @bind:applyToBoard @bind:matchFormations
  Scenario: Re-merging separate sub-formations back into a unified set configuration
    Given multiple independent sub-formations have completed their respective concurrent movements
    When a re-merge call is executed
    Then the engine must combine the sub-groups back into a single unified eight-dancer set and validate overall structural alignment

  @bind:matchFormationsAll
  Scenario: Handling asymmetrical set divisions with uneven dancer distributions
    Given a call results in an uneven split of the dancer pool across sub-formations
    When the spatial and state engines parse the division
    Then it must allocate correct coordinate boundaries and transformation constraints to accommodate the asymmetrical groups

  @bind:collisions @bind:physicalDancers
  Scenario: Detecting spatial conflicts between adjacent concurrently operating sub-formations
    Given two adjacent sub-formations are executing parallel movements in close proximity
    When the collision detection routine monitors their trajectories
    Then it must flag any boundary overlaps or clearance violations between the independent sub-groups

  @bind:parallelLegalCalls @bind:matchFormationsAll
  Scenario: Applying a subset call to every disjoint copy of its start setup
    Given a smaller formation, such as a facing couple or a box of four, occurs in several copies across the set
    When a call authored for that smaller formation is requested
    Then the engine must find every disjoint copy and apply the call to each concurrently
    And no dancer may be reused across two copies
    # Engine: matchFormationsAll packs disjoint subsets; parallelLegalCalls applies to all copies.

  @bind:parallelLegalCalls @bind:matchFormationsAll
  Scenario: A whole-set parallel transition carries one combined weight
    Given a call applies concurrently across several disjoint sub-formations of the set
    When the engine ranks this as a candidate next transition
    Then the whole-set transition must carry exactly ONE desirability weight, not one per sub-group
    And that single weight must be derived from the combined outcome of all sub-calls applied together
    # Engine: parallelLegalCalls returns one {name, board} per whole-set transition; the
    #          combined end board (not each sub-group in isolation) is what gets weighed.

  @bind:parallelLegalCalls
  Scenario: Requiring a clean even partition for parallel action
    Given the set cannot be partitioned into equal, disjoint copies of a call's start setup
    When a parallel application of that call is attempted
    Then the engine must refuse to parallel-apply it rather than leaving an uneven remainder

  @bind:matchFormations @bind:matchFormationsAll
  Scenario: Keeping a subset group couple-coherent
    Given a subset is being formed for a call
    When the subset is matched by shape
    Then every couple that appears in the subset must have both of its dancers in that subset
    And the engine must not assemble a bare geometric silhouette that scrambles who the dancers are

  @bind:subsetOf @bind:parallelApplicable @bind:assignHomeIdentity
  Scenario: Splitting by a named group such as heads/sides/centers/ends
    Given a call acts on a named group such as heads, sides, boys, girls, centers, or ends
    When the engine splits the set into those subsets
    Then the grouping must be by the dancers' home identity or structural position as the call requires
    And the result must cover the intended dancers without double-counting
    # Engine: grouping.subsetOf(board, group) / parallelApplicable split by home identity.
