Feature: FSM Transitions Between Formation Matrices
  As a square dance choreography engine
  I want to model the dance as a finite state machine where each state is a (formation, orientation) matrix and each call is a deterministic matrix transformation
  So that every legal sequence is exactly a walk through the FSM from one formation state to another, with transitions ranked by desirability

  Background:
    Given the FSM state set is the collection of all recognized (formation, orientation) states
    And each state is backed by a canonical matrix of the eight dancers' position-and-heading vectors
    And each transition is a call, which deterministically maps a start state matrix to exactly one end state matrix
    And every outgoing transition of a state carries a desirability weight in [0,1]

  @bind:formationState @bind:recognize
  Scenario: A state is identified by the normalised formation, not absolute orientation
    Given a squared set is configured with the heads facing north
    When the same structural formation is configured with the heads facing east
    Then the two configurations MUST resolve to the SAME FSM state because the formation is normalised
    And the orientation difference is carried by the transition delta, not by distinct states
    # Engine: matcher.formationState(board) returns the normalised formation name; the FSM keys
    #          states on that normalised identity, so symmetric rotations do not split the state set.

  @bind:applyToBoard @bind:dancerMatrix @bind:apply5
  Scenario: A call is a deterministic matrix transformation from one state to one end state
    Given the FSM is in a start state matrix S
    When a specific call C is applied to S
    Then the engine must compute exactly one end state matrix S'
    And S' must equal the canonical representation of the resulting dancer positions and headings
    # Engine: applicator.applyToBoard(board, call) computes the end board; matrix.ts
    #          dancerMatrix/dancerMatricesById yield the per-dancer affine maps.

  @bind:applyToBoard @bind:matchFormations @bind:dancerMatrix @bind:apply5
  Scenario: The transformation and end formation are expressed in the board's dancer frame
    Given a call is authored against a formation's canonical position order, which may differ from the board's dancer order
    When the call is applied to the board
    Then the engine must re-base the canonical start, the transformation matrix, and the end formation into the board's own dancer order
    And the mapping from board dancer to canonical position must be applied consistently to the start, the transform, and the end
    And the resulting end board must carry each dancer to the position its identity reaches, not the canonical position's index
    # Engine: findMatchingVariant yields the mapping; applyWholeBoard uses variant.dancers[mapping[i]]
    #          and rebasedPose so start, matrix, and end all follow the board's dancer order.

  @bind:matchFormations @bind:formationState
  Scenario: Applying the same call from a rotated start state produces a rotated end state
    Given a start state S and a 90-degree-rotated copy S_rot of the same structural formation
    When the same call C is applied to both S and S_rot
    Then the two end states must be congruent under the same 90-degree rotation
    And both transitions must reference the same call and the same desirability weight

  @bind:legalCalls @bind:legalNext
  Scenario: Enumerating the outgoing edges of a state
    Given the FSM is settled in a specific state node
    When the transition table for that node is queried
    Then it must return every call that is legal from that state
    And each returned edge must include its desirability weight and its deterministic end state
    # Engine: legality.legalCalls(board) / Sequencer.legalNext() enumerate legal transitions.

  @bind:apply @bind:legalCalls
  Scenario: A legal sequence is a walk through the FSM
    Given a sequence of calls is proposed starting from a home squared-set state
    When the engine walks the FSM by applying each call in order
    Then each step must transition to a state that is a recognized member of the state set
    And the sequence must be rejected if any call has no outgoing edge from the current state
    # Engine: Sequencer.apply(name) applies one call and returns {legal, board, formation}.

  @bind:apply @bind:legalCalls @bind:matchFormations @bind:setMatchMargin
  Scenario: The walk tolerates small drift when matching the next call's start formation
    Given the dancers reach the end of one call only approximately on the next call's canonical start formation
    When the engine decides whether the next call is legal from that state
    Then it must accept the next call if its start setup matches within the configured matching tolerance
    And a natural continuation such as "Circle Left" into "Circle Right" must remain legal despite the small end-pose drift
    # Engine: legalCalls gates each step via matchFormations with DEFAULT_MATCH_MAX +
    #          config.matchMargin; Sequencer.setMatchMargin() widens/narrows that tolerance, so
    #          near-exact end states (e.g. circle to circle) are accepted rather than rejected.

  @bind:assignHomeIdentity
  Scenario: Preserving identity across a transition
    Given each dancer carries a fixed home identity (id and home couple) stamped at the start of the tip
    When a call transformation moves the dancers to the end state
    Then each end-state matrix entry must retain its dancer's home identity
    And heads/sides designations must continue to refer to the original home couples, not to whichever couples now occupy the compass positions
    # Engine: identity.assignHomeIdentity stamps id/couple so heads/sides stay on home couples.

  @bind:formationState
  Scenario: Recording the orientation delta of a transition
    Given a call is applied and the set rotates by some multiple of 45 degrees
    When the transition is recorded
    Then the edge must capture the net orientation delta at 45-degree granularity so the FSM can reconstruct absolute heading states
    # The state identity is the normalised formation; the edge delta records net rotation so the
    # absolute heading of the dancers can still be reconstructed without making it a state.

  @bind:formationState
  Scenario: Supporting 45-degree (1/8-rotation) granularity in the transition delta
    Given the engine tracks orientation changes at one of eight 45-degree steps
    When a move that rotates the set by an eighth of a turn is applied
    Then the transition delta must advance by one 45-degree step
    And the delta must be encodable in a small integer (for example, 3 bits for eight steps)
    And a move with no net rotation must leave the delta at zero
    # Orientation granularity lives on the EDGE (the delta), not on the state: the state itself is
    # the normalised formation, so all orientations of a shape are the same state.

  @bind:formationState @bind:fitRigidMatrix
  Scenario: A 45-degree rotation is recorded as a delta, not a new state
    Given a formation state is settled at a canonical orientation
    When a call rotates the set by 45 degrees
    Then the resulting state must be the SAME normalised state as the original
    And the transition must record a 45-degree orientation delta instead of creating a distinct state

  @bind:formationState @bind:fitRigidMatrix
  Scenario: Naming calls that actually rotate the set by 1/8 of a turn
    Given a call is authored with 45-degree (Eighth) or half-hinge move primitives
    When the call's net rigid rotation is measured
    Then the call must record a 45-degree orientation delta on its transition
    And concrete examples that do this include Reverse, Wheel Around, Alamo Style, Circle By,
        Circle to a Line, Chain Reaction, Cross By, and the Concentric family
    # Data: moves.xml defines Eighth Left/Right (45deg turn in place), HalfHinge and
    #       HalfBackHinge (45deg of a hinge). Calls that compose these, e.g.
    #       a1/reverse.xml, b2/wheel_around.xml, b2/alamo_style.xml, b1/circle_by.xml,
    #       b1/circle_to_a_line.xml, c1/chain_reaction.xml, c1/cross_by.xml, and
    #       c1/concentric_concept.xml, are the concrete 1/8-rotation examples.

  @bind:formationState
  Scenario: Orientations normalise into the same state for symmetric formations
    Given a formation is rotationally symmetric, such as a squared set under a 90-degree rotation
    When the FSM state set is built
    Then orientations related by the formation's own symmetry MUST collapse to the same state
    And a 90-degree rotation of a squared set must resolve to the SAME normalized state, not a new one
    # This is the resolved symmetry rule: state identity is the NORMALISED formation, so rotations
    # that map a formation onto itself (its symmetry) do not create new states. The transition's
    # net orientation is still carried by the edge delta for reconstructing absolute headings, but
    # the state itself is normalised — orientation is not part of the state's identity.

  @bind:registerModule @bind:flatten @bind:applyToBoard
  Scenario: Expanding a generative prefix into concrete call transitions
    Given a prefix such as "Anything and Roll", "As Couples", or "Explode and Anything" is combined with a base call
    When the engine must produce the concrete transition
    Then it must expand the generative prefix over the base call into each concrete call as a distinct transition
    And each concrete expansion must be its own legal edge with its own end formation
    # Engine: a generative prefix is not a single call; it yields a family of concrete calls.
    #          registerModule/flatten model the expansion, and each concrete call is applied via
    #          applyToBoard as its own deterministic transition.

  @bind:registerModule @bind:flatten @bind:applyToBoard @bind:hasCall @bind:getVariants
  Scenario: Resolving a call-name synonym to its canonical registered call
    Given a call may be referenced by an alternate name or spelling for the same movement
    When a caller or a module requests the call by its synonym
    Then the engine must resolve it to the canonical registered call and apply that call
    And lookups such as "is a known call" and "get this call's variants" must treat the synonym as the canonical name
    # Engine: CALL_SYNONYMS in constants.ts maps aliases to canonical names; canonicalName is
    #          applied in the library's hasCall/getVariants/register/flatten, so a synonym is
    #          applied and flattened exactly as its canonical call.
