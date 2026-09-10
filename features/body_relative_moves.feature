Feature: Body-Relative Codified Moves
  As a square dance choreography engine
  I want a set of body-relative move transforms (mirroring taminations-flutter's coded moves, e.g. Face Left / Face Right)
  So that a call can be expressed as a reusable per-dancer affine transform applied in each dancer's own local frame, without needing XML path data for every pose

  Background:
    Given a move is defined in a dancer's local frame where local +x is the dancer's facing direction and local +y is the dancer's left (90° CCW from facing)
    And a move records a net local displacement (dx, dy) plus a net heading change turn (radians, + = left / CCW)
    And applying the move rotates the local displacement by the dancer's world heading and adds the turn to its heading
    And a pure face/turn has zero local displacement so the dancer pivots about its own position
    # Engine: moves.ts applies move local-frame conventions; matrix.ts provides the 5x5 affine
    #          per-dancer transform (position by rotation+translation, heading by rotation).

  @bind:FaceRight @bind:applyMoveToState
  Scenario: Face Right turns a dancer a quarter-turn to its own right without moving it
    Given a dancer at a position facing an initial direction
    When Face Right is applied
    Then the dancer's heading must turn 90° clockwise (to its own right)
    And its position must be unchanged

  @bind:FaceLeft @bind:applyMoveToState
  Scenario: Face Left turns a dancer a quarter-turn to its own left
    Given a dancer facing an initial direction
    When Face Left is applied
    Then the dancer's heading must turn 90° counter-clockwise (to its own left)
    And Face Left followed by Face Right must restore the original heading

  @bind:UTurnLeft @bind:FaceHalf @bind:applyMoveToState
  Scenario: A U-Turn is a 180° pivot about the dancer's own position
    Given a dancer facing an initial direction
    When a U-Turn (Face Half) is applied
    Then the dancer's heading must reverse by 180°
    And its position must be unchanged

  @bind:FaceRight @bind:FaceLeft @bind:applyMoveToState
  Scenario: Body-relative turning is independent of the set's orientation
    Given dancers all performing the same body-relative turn but facing different directions (e.g. in a line or wave)
    When the turn is applied to each dancer
    Then every dancer must turn relative to its own heading, so the set may become asymmetric
    # Each dancer rotates about itself; because their starting headings differ, the same "turn"
    # call can send different dancers to different absolute headings.

  @bind:faceInOutStates @bind:applyMoveToState
  Scenario: Face In and Face Out turn each dancer toward or away from the set centre
    Given a set of dancers whose centre is computable
    When Face In is requested
    Then each dancer must turn to face the set centre
    And Face Out must turn each dancer to face away from the set centre
    # Unlike Face Left/Right these are NOT fixed matrices: the turn each dancer makes depends
    # on its angle about the centre, so the engine computes a per-dancer end heading.

  @bind:Forward @bind:Back @bind:applyMoveToState
  Scenario: A forward move displaces one slot along the dancer's facing
    Given a dancer facing a direction
    When a Forward move is applied
    Then the dancer must move one slot in the direction it is facing
    And a Back move must move it one slot opposite its facing

  @bind:applyMoveToBoard @bind:applyMoveToState
  Scenario: A move can be applied to the whole board or to a selected subset
    Given a board of dancers and a move
    When the move is applied to the board
    Then every dancer must reach its deterministic end state
    And when only a subset of dancer ids is given, only those dancers move while the rest hold

  @bind:moveMatrix @bind:dancerMatrix @bind:apply5
  Scenario: Each move yields a per-dancer affine matrix from start to end
    Given a dancer start state and a body-relative move
    When the move's per-dancer matrix is computed
    Then applying that matrix to the start state must yield exactly the move's end state
    And the end state must equal the canonical end positions and headings

  @bind:applyToBoard @bind:FaceRight
  Scenario: The Sequencer applies Face Right as a coded call from any formation
    Given a current board in any formation and no catalog <tam> named "Face Right"
    When the Sequencer applies "Face Right"
    Then it must be legal without needing a matching XML formation
    And every dancer must pivot 90° to its own right with its position unchanged
    # These are NOT XML-data calls: they are the same per-dancer pivot whatever the
    # formation, so the Sequencer applies the moves.ts transform directly.

  @bind:apply @bind:FaceLeft @bind:FaceRight
  Scenario: Face Left then Face Right restores the original facing
    Given a board whose dancers face some direction
    When Face Left is applied and then Face Right is applied
    Then every dancer must be back at its original heading and position
    # Coded face calls compose: applying the opposite pivot twice is the identity.

  @bind:applyToBoard
  Scenario: A name that is neither a catalog call nor a coded move is not legal
    Given a call name that is not in the catalog and not a registered coded move
    When it is applied
    Then the Sequencer must report it as not legal

  # -----------------------------------------------------------------------------
  # Notational / engine notes
  # -----------------------------------------------------------------------------
  # Face Left/Right are 90° pivots (dx = dy = 0): Face Right = -90° heading, Face Left = +90°,
  # Face Half = 180°, Face 1/8 = ±45°, Face 3/8 = ±135° in the engine's CCW-positive convention.
  # faceInOutStates computes the shortest turn toward/away the set centroid per dancer.
  # The Sequencer registers coded body-relative calls (Face/Turn Left/Right/In/Out/Half) that are
  # applied directly from geometry and are legal from any formation; they are not FSM/catalog edges
  # unless the pivoted geometry happens to be an existing formation state.
  # The same registry also carries one geometry-derived WHOLE-SET RESOLVE, Promenade / Promenade
  # Home. It is NOT body-relative: it is not a per-dancer local-frame transform, it declares a
  # precondition over the whole board, it may refuse and say why, and it moves everybody - so it
  # is legal from some boards and not others, unlike the pivots above (see resolve_calls.feature).
  # The rest of the taminations move catalog (fold/run/dodge/hinge/...) can be added as new
  # Move entries carrying their net local displacement + turn; a move is pure-body-relative only
  # when its direction is fixed in the dancer's local frame (callers orient it first otherwise).
