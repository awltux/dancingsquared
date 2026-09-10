Feature: Formation States and FSM Structure
  As a square dance choreography engine
  I want to define formations as abstract FSM states and recognize structural equivalence classes
  So that state transitions remain consistent regardless of absolute compass orientation or minor positional variations

  @bind:matchFormations @bind:recognize
  Scenario: Defining abstract formations as distinct FSM states
    Given a set of eight dancers are positioned in a recognized structural layout
    When the engine evaluates the absolute coordinates against known formation templates
    Then the FSM must map the current configuration to a distinct abstract formation state

  @bind:matchFormations @bind:formationState
  Scenario: Recognising structural equivalence classes regardless of absolute compass orientation
    Given two sets of dancers are arranged in identical wave structures but oriented toward different compass points
    When the state identification algorithm processes both sets
    Then both configurations must resolve to the same abstract structural equivalence class
    # Template vs state: a formation TEMPLATE is the abstract structural equivalence class (shape
    # + facing), shared by both boards. The FSM STATE is the normalised formation keyed on that
    # template. They are distinct concepts: the template describes the shape; the state is the
    # template's place in the FSM. Orientation is carried by the transition delta, not by the state.

  @bind:legalCalls @bind:applyToBoard
  Scenario: Mapping valid start and end conditions for standard formations
    Given a specific square dance call has defined prerequisite formations
    When the FSM queries the transition table for that call
    Then it must correctly return the valid start states and the guaranteed corresponding end states

  @bind:matchFormations @bind:formationState
  Scenario: Normalising rotated or mirrored formations to a canonical state representation
    Given a formation is rotated or mirrored relative to the default template definition
    When the normalisation filter is applied to the dancer matrix
    Then the system must transform the coordinates into a canonical state representation for accurate matching
    # Engine: matcher.rebasedPose re-expresses a pose in the board's own frame using the match.

  @bind:formationState @bind:recognize
  Scenario: Querying active formation metadata from the current state node
    Given the FSM is currently settled in a specific formation state node
    When a query is made for structural metadata such as center points and slot alignments
    Then the state node must return the accurate geometric properties required for the next transition calculation

  @bind:poseToVec @bind:apply5
  Scenario: Encoding a formation state as a matrix of dancer state vectors
    Given a recognized structural layout is settled as the current state
    When the state is materialized for transformation
    Then it must be encoded as a matrix of the eight dancers' position-and-heading vectors
    And the matrix must carry each dancer's home identity so it is preserved across transitions

  @bind:formationState
  Scenario: States that differ only by absolute orientation are the same normalised state
    Given a formation state is settled with the set oriented to the north
    When the identical structural formation is oriented to a different compass step
    Then the FSM must treat them as the SAME state because the formation is normalised
    And the orientation difference must be captured by the transition delta, not by distinct states

  @bind:matchFormations @bind:snapBoard
  Scenario: Normalising a state to its canonical matrix for matching
    Given a state matrix may be translated, rotated, or reflected relative to its default template
    When a transition queries whether a board is at this state
    Then the engine must recognise the board as this normalised formation state
    And all rotation/reflection must be normalised away before matching because the state identity is the abstract formation
    # Engine: matcher.snapBoard clamps onto canonical slots while preserving id/couple/gender.

  @bind:matchFormations
  Scenario: The static formation's position order need not match the board's dancer order
    Given a formation's canonical definition lists its dancers in a fixed order of positions
    When the board places the same dancers in a different order, such as couple 1 not occupying positions 1 and 2
    Then the engine must not assume the formation's position order equals the board's dancer order
    And it must match by geometry and identity, deriving a mapping from each board dancer to its canonical position
    # Engine: matchFormations returns mapping[boardIdx] = candidateIdx, so the canonical
    #          position order and the board dancer order can differ freely.

  @bind:matchFormations
  Scenario: Matching a static formation to the board without trusting position order
    Given a board's dancers are permuted relative to a formation's canonical position list
    When the engine determines whether the board is at that formation state
    Then it must still recognise the state through order-independent matching
    And the resulting mapping must be used to align the transformation to the board's actual dancer order

  @bind:dancerMatrix @bind:apply5
  Scenario: Reusing the canonical matrix to seed the next transition
    Given the FSM is settled in a state node whose canonical matrix is cached
    When the next call transition is about to be applied
    Then the transition must consume the canonical start matrix
    And the resulting end matrix must become the new current state's canonical matrix

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Adding a new formation to the FSM from its geometry alone
    Given a user wants to add a formation that is not yet on the valid-formation list
    When the user supplies the formation's dancer coordinates and headings
    Then the FSM must add it as a new state carrying its geometry, home-identity mapping, and orientation steps
    And it must not be required to provide a getout or call-validity checks at the moment it is added
    # Engine: the new formation enters the FSM by its shape (dancer positions/headings);
    #          getout and call-validity remain deferred until later verified or amended.

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Deferring getout and call checks on a newly added formation
    Given a formation has just been added to the FSM from its geometry alone
    When the engine later checks whether a getout or any valid call exists from it
    Then those checks must be allowed to return empty while the formation is still being filled in
    And the formation must not be treated as a verified, callable state until those checks are satisfied

  @bind:matchFormations @bind:getUniqueFormations
  Scenario: Recording a newly added formation in the change ledger
    Given a new formation has been added to the FSM
    When the FSM records the change
    Then the ledger must note the added formation with its author, timestamp, geometry, and the user's reason
    And the change must be exported along with the rest of the FSM snapshot and delta ledger

  @bind:findMatchingVariant @bind:variantStarts @bind:applyToBoard
  Scenario: Resolving the correct variant when a call name has definitions per start formation
    Given a call such as one covered by the Facing Couples Rule may be defined differently from facing couples than from another setup
    When the engine is asked to apply that call from the current board
    Then it must select the variant whose start setup matches the current formation
    And it must use that variant's own end formation rather than a generic definition for the call name
    # Engine: findMatchingVariant picks the variant (variantStarts) whose setup matches the board,
    #          so the same name can yield different end formations from different start formations.

  @bind:getVariants @bind:variantStarts @bind:applyToBoard
  Scenario: A call exposes exactly one variant per authored setup
    Given a call file carries several <tam> setups, such as one per start formation
    When the engine registers that call
    Then getVariants must return one variant per authored setup, and variantStarts must list each setup
    And dropping a setup must make the call spuriously ILLEGAL from that setup's start formation
    # Engine: CallLibrary.register parses every <tam> of the registration as a variant, and
    #          findMatchingVariant then selects the one whose start matches the board. Registering
    #          only a subset of the setups (e.g. only "Lines Facing Out" for Wheel and Deal) leaves
    #          the call illegal from the other setups (e.g. Two-Faced Lines) even though the full
    #          data would allow it. A loader that drops <tam> blocks therefore silently narrows the
    #          call picker rather than failing loudly.

  @bind:formationState @bind:matchFormations
  Scenario: Distinguishing a wrong-way star from a normal star
    Given a formation is a star or thar whose dancers circulate in the direction opposite to the held hand
    When the FSM identifies the formation state
    Then it must treat the wrong-way star as a distinct normalised formation state from its normal counterpart
    And the direction of circulation must be part of how the state is recognised, not inferred later

  @bind:formationState @bind:matchFormations @bind:findMatchingVariant
  Scenario: Distinguishing one-faced from two-faced lines
    Given a line of dancers may face a single direction (one-faced) or opposite directions as couples (two-faced)
    When the FSM decides which calls are legal from that line
    Then the one-faced and two-faced arrangements MUST be distinct states even if their dancers sit at the same positions
    And calls such as "Bend the Line" must only be legal from the arrangement they actually require
    # Engine: formationState / findMatchingVariant distinguish by facing (heading), so a two-faced
    #          line and a one-faced line with coincident dancers are different states.

  @bind:matchFormations @bind:formationState @bind:recognize
  Scenario: Recognising distinct topology classes such as diamonds, hourglasses, and T-bones
    Given a formation such as a diamond, hourglass, T-bone, or butterfly occupies a distinct non-standard layout
    When the FSM identifies the formation state
    Then each topology class must be recognised and matched as its own structural template, not conflated with lines or waves
    And a call authored for a specific topology must only apply when that topology is the current state
    # Engine: recognition matches each named formation's geometry (matchFormations/formationState),
    #          so diamond, hourglass, T-bone, butterfly, etc. are distinct templates in the library.

  @bind:matchFormations @bind:snapBoard
  Scenario: Matching a formation at any 45-degree orientation offset
    Given a board is at a formation whose orientation is offset from the template by a multiple of 45 degrees
    When the engine recognises the formation state
    Then the matcher must accept an orientation offset of 45, 90, 135, 180, 225, 270, or 315 degrees
    And it must not be limited to 90-degree rotations when deciding the board is at that formation
    # Engine requirement: matchFormations must try 45-degree rotation steps (not just the 90-degree
    #          ROTS=[0,90,180,270] today), so a 45-degree-offset board still normalises to the same state.

  @bind:matchFormations @bind:recognize @bind:snapBoard
  Scenario: An orientation offset that is not a multiple of 45 degrees is not recognised
    Given a board sits at a formation but is rotated by an angle that is not a multiple of 45 degrees
    When the engine tries to recognise the formation state
    Then it must NOT report that formation, because recognition works in 45-degree steps
    And the board must be left unsnapped rather than being force-fitted onto a 45-degree slot
    # Engine: the 45-degree step matching above is exact, not interpolating. An offset such as
    #          22.5 degrees matches no rotation step, so recognize() returns null and snapBoard()
    #          is a no-op (the best formation error exceeds snapMaxError). This is the boundary
    #          that distinguishes "the engine cannot handle 45 degrees" (false) from "the engine
    #          cannot handle angles between the 45-degree steps" (true).

  @bind:snapBoard @bind:formationState @bind:recognize
  Scenario: Snapping preserves the board's own orientation instead of re-aligning it to the compass
    Given a board sits in a recognised formation but rotated away from the template's canonical compass orientation
    When the result is clamped onto the recognised formation's slots
    Then each dancer must move to the nearest slot expressed in the BOARD's own rotation, reflection, and centre
    And the result must not be rotated back to the template's canonical (axis-aligned) orientation
    # Engine: snapBoard maps each canonical slot through the match's rot/reflect/cSrc/cTgt
    #          (rebasedPose), so a board is clamped onto its formation IN ITS OWN FRAME. A
    #          45-degree-rotated Eight Chain Thru therefore snaps with zero displacement and
    #          stays at 45 degrees. The end-formation overlay is orientation-preserving; it is
    #          not a re-axing pass, and it is not the cause of an orientation "flip" at the end
    #          of a call.

  @bind:matchFormations @bind:formationState @bind:getUniqueFormations
  Scenario: A topology may be required as the start formation of a call
    Given a call is authored to begin from a specific topology such as a diamond or a box
    When the engine checks whether the current board is at that start formation
    Then the board must be recognised as that topology within tolerance before the call is legal
    And calls that do not start from that topology must be rejected

  @bind:canonicalName @bind:matchesNamed @bind:getout @bind:getin
  Scenario: Recognising synonymous names for the same formation
    Given the catalog names the same geometry under two different names, such as "Squared Set" and "Static Square"
    When a caller or the solver uses either name for a formation
    Then the engine must treat them as the SAME formation
    And a getout, getin, or "is at formation" query must behave identically for either synonym
    # Engine: constants.ts FORMATION_SYNONYMS maps aliases to a canonical name; canonicalName is
    #          applied in the solver (getout/getin/fixIt targets) and matcher.matchesNamed, so
    #          passing either "Squared Set" or "Static Square" gives consistent results.

  @bind:recognize @bind:matchesNamed
  Scenario: A recognised label is always a formation the board actually is
    Given a board sits in some formation
    When the engine recognises it and reports a formation name
    Then the board must also answer "yes" to a direct query for that same formation
    And the two answers must never contradict each other
    # Engine: recognize() gates its label at DEFAULT_MATCH_MAX - the same tight tolerance the
    #          sequencer uses to accept a call's setup as matching a board - and matchesNamed()
    #          requires that same tight error AND that the formation be (tied-)best among the
    #          curated set. They used to disagree: a board 3.14 from Eight Chain Thru reported
    #          "Double Pass Thru" from recognize() while isAt() claimed Eight Chain Thru, because
    #          matchesNamed matched at matchFormations' loose 6.0 default.

  @bind:recognize @bind:matchesNamed @bind:knownFormation
  Scenario: A board in a non-curated formation reports no curated label
    Given a board sits in a real formation that is outside the curated recognition set, such as a T-Bone
    When the engine recognises it
    Then it must report no formation rather than the nearest curated name that merely happens to be closest
    But a direct query for that non-curated formation must still answer yes
    # Engine: on an exact T-Bone LDDR board the best curated match is 3.14 (pi) away, so recognize()
    #          returns null while isAt("T-Bone LDDR") stays true (names outside the curated set are
    #          answered geometrically). Across the catalog this cuts 39 of 733 end-board labels and
    #          every one was a WRONG curated name - e.g. a board that is exactly "3 and 1 lines #2"
    #          was labelled "Normal Lines" 3.14 away. Nothing genuine is lost: the error
    #          distribution is bimodal (exact, or no curated match at all).
