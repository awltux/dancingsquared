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
  Scenario: Replay output is per-frame interpolation, while the completed call is snapped
    Given a call is playing and the playhead is inside that call
    When a frame is produced for a beat strictly inside the call
    Then the frame must be interpolated from the call's authored path without snapping
    And only the completed call's final board must be clamped onto the recognised formation
    # Engine: evaluateCallAt -> evaluateVariantAt interpolates poseFor directly, whereas the
    #          completed step goes through applyToBoard, which end-snaps (rebase path). A frame
    #          at the exact end of the sequence and the interpolation an epsilon before it are
    #          produced by different code paths, so any disagreement between them shows up as a
    #          discontinuity on the final beat.

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
