Feature: Sequence Replay Model and Board Seeding
  As a square dance choreography engine
  I want the sequence evaluators to replay from a well-defined start board
  So that playback, animation and export agree with the board the caller is actually looking at

  # The analyzer's evaluators are defined as a walk that STARTS FROM HOME. This is the single
  # assumption behind most of the "the board I set is not what is played/copied" confusion:
  # a board reached by dancing is reproducible by replay, but a board established by jumping
  # (Set formation) is not, because the jump is not part of the replayed sequence.

  @bind:sequenceBeats @bind:evaluateSequence @bind:isZero
  Scenario: Replay and evaluation always root at the home square
    Given a flat call sequence is replayed by the engine
    When the evaluators compute the total beats or the board at a given beat
    Then they must start from the home squared set, not from the caller's current board
    And an empty sequence must evaluate to the home square with zero beats
    # Engine: analyzer.sequenceBeats / evaluateSequence / sequenceInfo / isZero each construct
    #          makeSquaredSet() as their starting board. Replay is therefore only defined relative
    #          to home: a sequence is a walk from the home square.

  @bind:setFormation @bind:boardForFormation @bind:evaluateSequence @bind:sequenceBeats
  Scenario: A board established by jumping to a formation is not reproducible by replay
    Given the caller sets the board to a non-home formation such as Two-Faced Lines
    And the call history is empty because no calls were danced to get there
    When the engine replays that (empty) sequence to obtain the board at the playhead
    Then replay must return the home squared set, NOT the formation that was set
    # Engine: Sequencer.setFormation mutates seq.board, but the analyzer still roots at
    #          makeSquaredSet(), so evaluateSequence([], 0) is the home square while seq.board is
    #          Two-Faced Lines. Everything derived from replay therefore diverges from the set
    #          board: the played animation, the drawn end state, and any copied/exported dancer
    #          positions. The live board and the replayed board are two different boards.

  @bind:evaluateSequence @bind:sequenceBeats @bind:setFormation
  Scenario: Replaying from a non-home start board requires the start board to be passed in
    Given the engine is asked to replay a sequence that begins from a set formation
    When no explicit start board is supplied to the evaluator
    Then the capability to replay from that formation must be reported as not implemented
    # Desired capability (NOT IMPLEMENTED): evaluateSequence(flat, beat, startBoard) and
    #   sequenceBeats(flat, startBoard) seeded with the board the caller is on, so a sequence
    #   started by Set - or resumed from a saved mid-tip position - animates and exports
    #   consistently with what is displayed. Until then, callers must not mix a Set board with
    #   replay-derived output (Play, Copy positions).

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
