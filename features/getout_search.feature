Feature: The Get-out Search
  As a caller who has to close the square
  I want the engine to find a short sequence of legal calls that takes the set home
  So that a caller can be told how to resolve from wherever the dancers actually are

  # The search answers one question - "how do I get home from here?" - and it is the only part of the
  # engine that RUNS the whole machine rather than evaluating one call. Everything else (matching,
  # application, FASR) is a pure step; this drives them in a loop and has to terminate.
  #
  # THE CALLER CONVENTION is what makes its answers usable, and it is a deliberate departure from the
  # stricter reading. It is stated in solver.ts's own doc comment: "Under the caller convention a
  # sequence that reaches a state a standard finish closes COUNTS as a getout, and the finish is
  # appended to the path." So the search does not have to find a sequence that sits literally on the
  # home board - it has to reach a state the standard finishes resolve FROM, and then append one.
  # That is how a caller - and All8's published get-outs - write it: the line ends at `--AL`, `--RLG`
  # or `--Prom`, not at a description of the home square.

  Background:
    Given the search starts from the board the sequence actually began from, not from a fixed one
    And it may only use calls that APPLY to the board it is standing on
    And a standard finish is one of Allemande Left, Right and Left Grand, or Promenade

  @bind:STANDARD_FINISHES @bind:canonicalName
  Scenario: A finish closes the square, but it is not the only way a path may end
    Given a board that is one standard finish away from home
    When a getout is asked for
    Then the returned path may end with the finish that closes it
    And that finish must be one of the declared standard finishes, matched through the same name canon the rest of the engine uses
    But a path may ALSO end without one, when the search found an exact route home instead
    # Engine: constants.ts STANDARD_FINISHES = ['Allemande Left', 'Right and Left Grand', 'Promenade'];
    #          canonicalName resolves the spoken name to the catalogue's. The list is shared with the
    #          corpus harness that measures "did this get-out reach a resolve", so the search and the
    #          measurement cannot drift apart.
    #
    #          MEASURED, and it corrected an earlier version of this scenario: across a bounded sample
    #          of 15 accepted amendments, 11 ended at a standard finish but FOUR did not - two at
    #          `Heads Promenade 1/2`, one at `All 8 Linear Cycle`, and one at a rigid single-call
    #          getout (`All 4 Ladies make a right-hand star, turn it once around; boys Courtesy Turn
    #          your girl`). So the real invariant is NOT "the last call is a finish" - it is that the
    #          path, applied, takes the set home; the convention is what lets a FINISH serve as that
    #          final step, and an exact route home needs no finish at all. Asserting the stronger
    #          claim would have been wrong, and it is the kind of wrong that a spec is believed for.

  @bind:getout
  Scenario: A caller convention, and the refusal it still produces
    Given a board from which no path home exists within the bound
    When a getout is asked for
    Then it must return null rather than a path that overshoots
    And the cost of that refusal must be measured rather than assumed
    # Engine: measured. In a bounded 34-pair sample of amendment candidates, the getout gate refused
    #          TWO (~6%) that had already passed applicability and known-formation - so the gate is a
    #          real but small constraint, not a free check and not a dominant one. Of the 15 that were
    #          accepted, 11 (73%) were closed by the convention's finish, which is the measured reason
    #          the convention matters here: without it those amendments would have had to find some
    #          other exact route home. The sample is time-capped and small, and is reported as such -
    #          an unbounded 392-pair sweep did not finish in ten minutes.

  @bind:getout
  Scenario: maxCalls bounds the path RETURNED, finish included
    Given a maximum length and a board that can reach a finish
    When the search runs
    Then the returned path may be at most that long INCLUDING the appended finish
    And a board that needs more calls than the bound must return null rather than a path that overshoots
    # Engine: Sequencer.getout(opts) -> HomeSolver.getout(board, opts). The doc comment is explicit that
    #          maxCalls "bounds the length of the path RETURNED, finish included". A caller asking for
    #          at most 5 calls means five calls they will say out loud, so the finish has to be inside
    #          the budget rather than one more.

  @bind:getout
  Scenario: The search reads the Sequencer's OWN board, not the one you pass it
    Given the Sequencer's current board, and a different board passed as an argument
    When the search runs
    Then it must search the Sequencer's own board
    And a board passed to it must be silently ignored, because the method takes only opts
    # Engine: Sequencer.getout(opts) has NO board parameter and calls solver.getout(this.board, opts),
    #          while HomeSolver.getout(board, opts) DOES take one. Writing
    #          `seq.getout(someBoard, { ... })` therefore does not error and does not search
    #          someBoard - it searches this.board. That mistake is recorded in HANDOVER section 6
    #          because it invalidated a whole round of measurements here and then a conclusion built
    #          on top of them. Call setBoard(board) first, and check the arity rather than the intent.

  @bind:getout @bind:STANDARD_FINISHES
  Scenario: A geometry-derived finish is a usable final edge
    Given Promenade is carried by a precondition over the live board rather than by an authored setup
    When the search considers the final step
    Then Promenade must be usable as a finish even though it is absent from the catalogue
    And a board its precondition rejects must not be closed with it
    # Engine: solver.ts's doc comment names this as a designed property: "Promenade is a usable final
    #          edge even though it is geometry-derived and absent from the catalog." It matters because
    #          the catalogue is the natural source of candidate edges, and the convention's most
    #          common finish is the one thing that is not in it.

  @bind:getout
  Scenario: The same board gives the same answer
    Given a fixed board
    When the search is run twice, on the same instance, on a fresh instance, and after an unrelated search
    Then it must return the same path every time
    # Engine: measured. A search whose answer depended on what it had searched before would be
    #          unusable for a caller and unreproducible for a harness, and the engine's caches
    #          (finishCache, the reachability memo, the formation-match cache) exist to make it FAST,
    #          not to make it differ. The one cache that is keyed differently on purpose is
    #          finishToHome's, which keys on the full pose INCLUDING headings - see the notes in
    #          board.ts and selection.mjs, because boardSig is positions-only and would let two boards
    #          differing only by facing share an answer.

  @bind:getin @bind:fixIt
  Scenario: The reverse search, and the repair search, are bounded differently
    Given getin searches from home INTO a formation, and fixIt searches from a board to a target
    When each is asked for an answer
    Then getin must be bounded like getout, and must return null when it cannot get there
    And fixIt must take a DEPTH bound rather than a call-count bound, and must return a path rather than null
    # Engine: Sequencer.getin(opts) mirrors getout; Sequencer.fixIt(opts) takes { target, depth } and
    #          returns string[] - a list that may be EMPTY, which is how "already there" is reported,
    #          and is why the return type is not nullable. The two bounds are different on purpose:
    #          getout bounds how many calls a caller would have to SAY, fixIt bounds how deep the
    #          repair search may go before it gives up.

  @bind:matrixGetout @bind:closenessToHome
  Scenario: Two cheap answers that are not the search
    Given a rigid self-inverse single-call getout, and a heuristic distance from home
    When they are asked for
    Then matrixGetout must return that one call or null, without searching
    And closenessToHome must return a ranking distance, and must not be read as "can this resolve"
    # Engine: Sequencer.matrixGetout() takes no options and returns a one-call answer or null;
    #          closenessToHome(board) is a scalar used to RANK candidates, not to decide legality. The
    #          distinction matters because a small distance is not a proof that a path exists, and a
    #          search that trusted it would report get-outs it cannot actually produce.
