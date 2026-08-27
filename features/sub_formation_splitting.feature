Feature: Sub-Formation Splitting and Concurrency
  As a square dance choreography engine
  I want to temporarily split the eight-dancer set into independent sub-formations and re-merge them
  So that concurrent calls operating on isolated sub-groups are accurately simulated and synchronized

  Scenario: Splitting the eight-dancer set into independent sub-formations during concurrent calls
    Given a unified eight-dancer set is executing a call that divides the floor
    When the transition evaluator processes the division command
    Then the system must separate the dancer matrix into independent sub-formations such as mini-waves or lines

  Scenario: Managing parallel execution states across isolated sub-groups
    Given the set is split into multiple independent sub-formations
    When concurrent call steps are executed across the floor
    Then each sub-group must track its own internal FSM state and coordinate progression independently without interfering with others

  Scenario: Re-merging separate sub-formations back into a unified set configuration
    Given multiple independent sub-formations have completed their respective concurrent movements
    When a re-merge call is executed
    Then the engine must combine the sub-groups back into a single unified eight-dancer set and validate overall structural alignment

  Scenario: Handling asymmetrical set divisions with uneven dancer distributions
    Given a call results in an uneven split of the dancer pool across sub-formations
    When the spatial and state engines parse the division
    Then it must allocate correct coordinate boundaries and transformation constraints to accommodate the asymmetrical groups

  Scenario: Detecting spatial conflicts between adjacent concurrently operating sub-formations
    Given two adjacent sub-formations are executing parallel movements in close proximity
    When the collision detection routine monitors their trajectories
    Then it must flag any boundary overlaps or clearance violations between the independent sub-groups

  Scenario: Applying a subset call to every disjoint copy of its start setup
    Given a smaller formation, such as a facing couple or a box of four, occurs in several copies across the set
    When a call authored for that smaller formation is requested
    Then the engine must find every disjoint copy and apply the call to each concurrently
    And no dancer may be reused across two copies

  Scenario: Requiring a clean even partition for parallel action
    Given the set cannot be partitioned into equal, disjoint copies of a call's start setup
    When a parallel application of that call is attempted
    Then the engine must refuse to parallel-apply it rather than leaving an uneven remainder

  Scenario: Keeping a subset group couple-coherent
    Given a subset is being formed for a call
    When the subset is matched by shape
    Then every couple that appears in the subset must have both of its dancers in that subset
    And the engine must not assemble a bare geometric silhouette that scrambles who the dancers are

  Scenario: Splitting by a named group such as heads/sides/centers/ends
    Given a call acts on a named group such as heads, sides, boys, girls, centers, or ends
    When the engine splits the set into those subsets
    Then the grouping must be by the dancers' home identity or structural position as the call requires
    And the result must cover the intended dancers without double-counting
