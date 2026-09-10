Feature: Index Independence in Matching
  As a square dance choreography engine
  I want formation indexes, call indexes and board indexes to be mutually meaningless
  So that dancers are matched only by their position coordinates and rotation, and separately
  authored sequences can be joined without any index correspondence between them

  # There are three INDEPENDENT index spaces:
  #   - BOARD index     : a dancer's position in board.dancers[]
  #   - CALL index      : a dancer's position in a call variant's <tam>/<path> list
  #   - FORMATION index : a slot's position in a formation template's <dancer> list
  #
  # No index carries meaning across a boundary. The only permitted correspondence between two
  # dancer sets is their geometry (x, y, heading) up to translation, rotation and reflection,
  # and that correspondence must be DERIVED by matching, never assumed.
  #
  # The one place an index legitimately seeds meaning is board INITIALISATION: the opening
  # formation's order lays the dancers out on the board. After that the indexes are inert -
  # including when sequences are concatenated into a larger sequence.

  @bind:matchFormations @bind:findMatchingVariant
  Scenario: The three index spaces are mutually independent
    Given a board lists its dancers in one array order
    And a call variant lists its dancers in its own authored order
    And a formation template lists its slots in its own order
    When the engine matches the board against the call setup or against the formation template
    Then it must derive the correspondence from position coordinates and rotation alone
    And it must not assume that board index i corresponds to call index i or to formation slot i
    # Engine: match.ts uses a sorted pairwise-distance signature (an order-independent quick
    #          reject) plus a greedy position+facing assignment, and returns
    #          mapping[boardIdx] = candidateIdx. The mapping is computed, never assumed.

  @bind:matchFormations @bind:applyToBoard
  Scenario: Permuting the board array does not change which dancer goes where
    Given the same set geometry is presented twice with the board dancers listed in different orders
    When the same call is applied to both boards
    Then each dancer identity must reach the same end position in both results
    And the engine must not depend on the two arrays sharing an order
    # Engine: applyWholeBoard indexes the variant through the DERIVED mapping
    #          (variant.dancers[mapping[i]]), so the board's array order is irrelevant.

  @bind:registerModule @bind:flatten @bind:applyToBoard
  Scenario: Joining sequences at runtime re-matches by geometry, not by index
    Given two independently authored sequences are concatenated into a larger sequence
    When the larger sequence is flattened and replayed
    Then each constituent call must be re-matched against the board it actually starts from
    And no index correspondence between the two sequences' dancer lists may be assumed
    # Engine: library.flatten expands modules to call names, and the applicator re-matches each
    #          call against the live board - so RUNTIME joining is already index-free. This is
    #          the behaviour the editor path below must also satisfy.

  # ---- gaps: the editor's join path ------------------------------

  @bind:alignFormationToCore @bind:matchFormations
  Scenario: Editor alignment must use the same rotation granularity as matching
    Given the matcher accepts a board offset from a template by any multiple of 45 degrees
    When the call editor aligns a formation to a core's start formation
    Then it must try the same 45-degree rotation steps
    And it must not be limited to 90-degree rotations
    # GAP: editor.ts alignFormationToCore tries ORIGIN_ROTS = [0, 90, 180, -90] only, whereas
    #          match.ts ROTS tries 45-degree steps. A 45-degree-offset formation therefore
    #          cannot be aligned geometrically by the editor at all.

  @bind:alignFormationToCore @bind:synthesizeSetup @bind:synthesizeSetupChain @bind:correctEndTo
  Scenario: Editor joins must not fall back to array index when geometry does not determine the mapping
    Given the call editor joins two dancer lists, such as a setup to a core or one core to another core
    When the geometric alignment is ambiguous or finds no match within tolerance
    Then the join must fail loudly rather than silently pairing dancers by array index
    And any pairing that is kept must have been established by matching coordinates and rotation
    # GAP: alignFormationToCore falls back to index order for every unmapped slot, and
    #          synthesizeSetup / synthesizeSetupChain / correctEndTo then pair strictly by index
    #          (setup.start[i], coreA.dancers[i], target[i]). Their published contracts require
    #          the caller to have pre-aligned by index, so an unaligned or 45-degree-offset join
    #          silently emits index-correlated output instead of reporting the failure.

  # ---- gap: index-derived placeholder identity -------------------

  @bind:boardForFormation @bind:matchFormations @bind:subsetOf
  Scenario: Index-derived placeholder identity must not be used as identity
    Given a board is synthesised for a formation whose geometry is not the home square
    And its dancers therefore carry placeholder couples and genders
    When the engine matches that board against a call, or resolves a couple-based subset on it
    Then the placeholder identity must be treated as unknown
    And it must not be used as a matching tie-break or as a real couple grouping
    # GAP: sequencer.boardFromMatchables stamps `couple: ((i >> 1) % 4) + 1` and `gender: 'boy'`
    #          from the BOARD ARRAY INDEX whenever the geometry is not home-like. Those
    #          placeholders reach match.ts identityScore (a tie-break) and the grouping layer
    #          (couple-coherent partitions, beau/belle roles), so an index-derived value can
    #          decide a match or a subset. Initialising by index is permitted; letting that
    #          placeholder then act as identity is not.

  # ---- the bounded exceptions ------------------------------------

  @bind:matchFormations @bind:assignHomeIdentity
  Scenario: The only non-geometric matching criteria are bounded and data-derived
    Given matching is defined by position coordinates and rotation
    When the engine matches a board against a setup
    Then the only additional criteria permitted are the home-couple identity tie-break and gender compatibility
    And each must apply only when BOTH sides carry that information from the source data
    And neither may be derived from an array index
    # Engine: match.ts identityScore (home couple) and genderCompatible (requireGender) are the
    #          sanctioned exceptions. Couples reach a call setup only via assignHomeIdentity's
    #          geometric match against HOME_MATCHABLES, and named formations carry no couple at
    #          all (library.ts), so the tie-break is inert for pure recognition. Placeholder
    #          identity is the one path that would make these criteria index-derived.
