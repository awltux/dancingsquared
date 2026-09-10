Feature: Sequence Replay Model and Board Seeding
  As a square dance choreography engine
  I want the sequence evaluators to replay from a well-defined start board
  So that playback, animation and export agree with the board the caller is actually looking at

  # The replay evaluators walk forward from a START BOARD. It defaults to the home squared set,
  # so a sequence danced from home behaves exactly as before; a caller may instead pass the board
  # the sequence actually began from (e.g. one jumped to with "Set"), which is what makes
  # playback and export agree with the board on screen.

  @bind:sequenceBeats @bind:evaluateSequence @bind:isZero
  Scenario: Replay roots at the home square by default
    Given a flat call sequence is replayed by the engine
    When the evaluators compute the total beats or the board at a given beat
    And no explicit start board is supplied
    Then they must start from the home squared set, not from the caller's current board
    And an empty sequence must evaluate to the home square with zero beats
    # Engine: analyzer.sequenceBeats / evaluateSequence / sequenceInfo call replayStart(), which
    #          returns makeSquaredSet() when no start board is given. isZero / buildTip /
    #          validateSegment are intrinsically home-anchored (a "zero" IS defined as returning
    #          home in sequence) and never take a start board.

  @bind:setFormation @bind:boardForFormation @bind:evaluateSequence @bind:sequenceBeats @bind:setBoard
  Scenario: A board established by jumping to a formation replays from that board when asked
    Given the caller sets the board to a non-home formation such as Two-Faced Lines
    And the call history is empty because no calls were danced to get there
    When the engine replays the sequence WITHOUT a start board
    Then it must return the home squared set rather than the formation that was set
    But when the set board IS passed as the start board
    Then an empty replay must return that board exactly
    And a call that is legal only from that board must have zero beats from home and real beats from it
    And its replayed end board must be identical to the live board
    And replaying must not mutate the caller's start board
    # Engine: Sequencer.setFormation mutates seq.board; the caller passes it (as a COPY) so Play,
    #          trails and Copy positions all agree with the screen. Without the start board the
    #          old divergence remains: the live board and the replayed board are two boards.

  @bind:evaluateSequence @bind:sequenceBeats @bind:setBoard @bind:setFormation
  Scenario: Restoring a sequence's start board before replaying its history
    Given a sequence was started from a board that was jumped to
    When the caller undoes or seeks within that sequence
    Then the board must be restored to the sequence's START board before the history is replayed
    And it must not be reset to the home square, which would replay the history from the wrong board
    # Engine: Sequencer.setBoard(board) replaces the current board (a copy) and clears the
    #          match/solver caches, so a caller can re-establish a non-home start; Sequencer.reset()
    #          restores home for a fresh sequence.

  @bind:evaluateSequence @bind:applyToBoard
  Scenario: The last animated frame lands on the board the call actually produces
    Given a call is playing and the playhead approaches the end of that call
    When the frame just before the call completes is compared with the completed board
    Then the two must agree, so nothing snaps on the final beat
    # Engine: the frame an instant before the end and the completed board come from different
    #          code paths (interpolation vs applyToBoard), so they must be made to converge.
    #          Measured across the catalog this is now within 0.04 units / 0.6 degrees; before,
    #          subset calls disagreed by up to 10.2 units and a full 180 degrees.

  @bind:evaluateSequence @bind:applyToBoard @bind:parallelLegalCalls
  Scenario: A subset call is animated from its start board to the board it produces
    Given a call applies only to a SUBSET of the dancers, so it takes the parallel path
    When a frame is produced inside that call
    Then the frame must blend from the call's start board to the board the call actually produces
    And it must NOT be re-derived from the authored path, which does not converge for these calls
    # Engine: the parallel path partitions the board at its own tolerance and runs each group with
    #          pure-relative motion, so re-deriving an authored interpolation produced frames that
    #          did not converge (measured 4.0 units / 180 degrees even with the board order fixed).
    #          evaluateCallAt therefore blends identifiers from the start board to the applied end.

  @bind:applyToBoard @bind:parallelLegalCalls @bind:evaluateSequence
  Scenario: Applying a call preserves the board's dancer array order
    Given a board lists its dancers in some array order
    When a call is applied to it, including a subset/parallel call
    Then the returned board must list its dancers in that same order
    # Engine: the parallel path concatenated its groups in partition order, which permuted the
    #          board (e.g. 1,2,7,8,3,4,5,6). The renderer pairs its per-dancer views with the
    #          board BY ARRAY POSITION, so a permuted board made dancers appear to swap places the
    #          moment a subset call completed - the "flip" this work set out to fix. The board's
    #          index is not meaningful, so anything pairing by position must be able to rely on
    #          the order being stable.


  @bind:evaluateSequence @bind:sequenceBeats @bind:applyToBoard @bind:stepBeats
  Scenario: Coded body-relative moves replay and animate
    Given a sequence contains a coded body-relative call such as "Face Right"
    When the analyzer computes the sequence's beats or evaluates a frame
    Then the coded call must contribute exactly 1 beat
    And a frame inside it must show a smooth rotation from the current facing to the new one
    And the dancer must not leave its spot, because a coded move is a pivot in place
    And the replayed end must equal the board the live apply produces
    And opposite pivots must cancel so the sequence continues from the restored facing
    # Engine: coded-moves.ts is the single registry of the coded calls (name + aliases +
    #          CODED_MOVE_BEATS + the whole-board transform); the Sequencer applies them to the
    #          live board and SequenceAnalyzer replays/animate them through evaluateCodedAt,
    #          interpolating each dancer's heading by the fraction of the beat (positions lerp to
    #          the same spot). legalNext() still surfaces them, and legalCalls()/the FSM still
    #          exclude them, so coded pivots never become FSM edges.

  @bind:sequenceInfo @bind:evaluateSequence
  Scenario: A coded move has no trail to trace
    Given the playhead is inside a coded body-relative move
    When the UI asks for the call's variant and board mapping to draw a trail
    Then it must report no trail for that move
    But the replay must continue past it, so a later call still has one
    # Engine: sequenceInfo returns null while a coded move plays (there is no authored path to
    #          sample), and skips past it otherwise.
