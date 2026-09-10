Feature: Geometry-Derived Resolves
  As a square dance choreography engine
  I want a call to be carried by a precondition over the live board's geometry, not only by an authored setup
  So that a whole-set finish such as Promenade can be performed from any formation it is legal from, and refuse with a reason when it is not

  # Three kinds of call now exist. They are distinguished by HOW they are applied, not by name:
  #   - CATALOG calls    : matched against an authored <tam> setup (findMatchingVariant) and applied
  #                        by the CallApplicator;
  #   - DERIVED PIVOTS   : Face Left/Right, U-Turn Back (Face Half), Face In/Out - per-dancer
  #                        transforms with no precondition, so they are legal from any board;
  #   - DERIVED RESOLVES : a whole-set transformation that is legal only when its PRECONDITION
  #                        holds on the live board. Promenade / Promenade Home is the whole of
  #                        this class today.
  # Both derived kinds live in ONE registry (coded-moves.ts) so that the Sequencer and the sequence
  # analyser share one definition, one beat count and one precondition, and neither can drift.

  Background:
    Given a call may be a catalog call, a geometry-derived pivot, or a geometry-derived resolve
    And a derived resolve declares a precondition over the board and is applied only when that precondition holds
    And a board the resolve applies to is a board the dancers can finish from

  @bind:findCodedMove @bind:CODED_MOVES @bind:codedMoveApplies @bind:promenadeHome
  Scenario: A derived resolve declares a precondition, while a derived pivot declares none
    Given the registry of geometry-derived calls
    When the engine asks whether each registered call applies to a board
    Then a pure pivot must apply from any board, because it declares no precondition
    And Promenade must apply exactly when promenadeHome accepts the board
    And a resolve whose precondition fails must not be applied at all, not partially and not by force
    # Engine: coded-moves.ts CodedMove.precondition is ABSENT for Face Right/Left/Half/In/Out (each
    #          CODED_MOVE_BEATS = 1) and is promenadeProblem for Promenade (PROMENADE_BEATS = 8).
    #          codedMoveApplies is the single predicate - no precondition means "always" - and
    #          Sequencer.tryCodedMove runs it before applying: on failure it returns the board
    #          UNCHANGED plus the reason, so a refusal can never half-move the set.

  @bind:promenadeHome @bind:promenadeAnchor
  Scenario: Each couple's centre is taken by home couple number and snapped to an axis point
    Given a board whose dancers carry a home couple identity
    When the promenade test takes the centre of each couple
    Then the centre must be the midpoint of the two dancers whose home couple NUMBER is that couple
    And it must not be the midpoint of whichever two dancers happen to be standing next to each other
    And each centre must be snapped to the nearest of the four axis points (0,2), (-2,0), (0,-2), (2,0) by quadrant
    And the snap must be deterministic on the quadrant boundaries, so a centre lying exactly on an axis resolves the same way every time
    # Engine: promenadeHome groups board.dancers into a map KEYED ON d.couple, so the answer changes
    #          when the identity labels move even though the geometry has not - this is what makes it
    #          a promenade HOME rather than a wheel around whatever ring the set happens to form.
    #          promenadeAnchor resolves the boundaries in a fixed if-chain order
    #          ((x>=0,y>0)->north, (x<0,y>=0)->west, (x<=0,y<0)->south, else east), so a centre on an
    #          axis or at the origin lands on one stated point rather than on whatever a rounding of
    #          atan2 happened to produce.

  @bind:promenadeHome
  Scenario: The set must be spread one couple per side, in ring order 1 to 2 to 3 to 4 counter-clockwise
    Given a board whose four couples each snap to one of the axis points
    When the promenade test checks the ring
    Then the four couples must occupy four DIFFERENT axis points
    And couple k+1 must be 90 degrees counter-clockwise from couple k, for every couple
    # Engine: promenadeHome rejects duplicate anchors ("not spread one per side of the square") and
    #          then requires ccwDelta(axisAngle(anchor[k]), axisAngle(anchor[k+1])) == 90 within
    #          1e-6. This is the "in sequence" test, and it is DIRECTION-sensitive: the promenade
    #          travels counter-clockwise, so a ring that runs 1 -> 4 -> 3 -> 2 counter-clockwise
    #          (the mirror of home) fails with -90 degrees and no single wheeling of the set can
    #          bring everybody home. The caller has to fix the sequence first (Allemande Left); this
    #          finish is not allowed to paper over an out-of-sequence square.

  @bind:promenadeHome @bind:assignHomeIdentity
  Scenario: A promenade ends on the literal home squared set, verified dancer by dancer
    Given a board the promenade applies to
    When the promenade completes
    Then every dancer must be back on its own home position AND its own home facing
    And that must be verified by identity, dancer by dancer, not by recognising that the result "looks like" the home formation
    # Engine: promenadeHome does not move the dancers at all - it returns makeSquaredSet(), the literal
    #          home board. The end state is therefore exact by construction: a dancer that is not home
    #          is a defect the test must not absorb, which is why the result is compared per id rather
    #          than matched against the home formation at some tolerance.
    #          assignHomeIdentity is what stamps d.id and d.couple in the first place (by matching a
    #          call's start formation to the home squared set); the promenade READS that identity and
    #          never re-derives a couple from array order or from the board's geometry.

  @bind:promenadeHome @bind:applyToBoard
  Scenario: The same home board is reached from a rotated squared set and from the formations a set is commonly in
    Given the home squared set rotated by any whole number of quarter-turns
    And a facing line, a wave, or a two-faced line whose couples stand one per side in ring order
    When the promenade is applied to each of them
    Then all of them must resolve to the same literal home board
    # Engine: the test reads only the couples' snapped centres and their ring order, so it is
    #          ROTATION-INVARIANT: rotating the home set turns all four anchors together and leaves
    #          the 90-degree ring order intact, while a facing line or a wave has its couples together,
    #          one per quadrant, in the same ring order. An implementation that recognised the board
    #          against an authored start setup would reject every one of these - which is exactly why
    #          this call is geometry-derived and is not a catalog <tam>.

  @bind:promenadeHome @bind:promenadeProblem
  Scenario: Facings are not part of the promenade test
    Given a board whose couples stand one per side in ring order but whose dancers face in, out or sideways
    When the promenade test runs
    Then it must not consult the dancers' headings, and the board must still be promenadeable
    # Forming up into promenade position is PART OF THE CALL, so a board reached facing in, out or
    # sideways is equally promenadeable. The published corpus shows the consequence directly: the
    # only get-out All8 lists for the two-faced line [L.F1p] is a bare "--PromH" with no body at all,
    # i.e. a board the corpus says promenades home and which is not a squared set. Requiring the
    # dancers to be facing promenade-wise first would refuse a finish that is legal.

  @bind:promenadeHome @bind:promenadeProblem @bind:promenadeApplies
  Scenario: A promenade that cannot apply refuses with its own reason and leaves the board unchanged
    Given a board whose couples are permuted round the ring
    And a board whose four couples are not one per side of the square
    And a board whose partners are not standing together as a couple
    And a board that carries no home identity at all
    When each of them is asked to promenade
    Then each must be refused for its OWN reason, naming which test failed
    And the board handed back must be identical to the board handed in: nothing moved, nothing snapped, nothing teleported home
    And a board that does not carry four couples of two dancers each, one boy and one girl, must be refused before any ring arithmetic runs
    # Engine: promenadeHome fails in this order - physical dancer count, then per-dancer known home
    #          couple ("... carries no identity"), then four couples of two, then same-gender partners
    #          and the partner separation, then duplicate anchors ("not spread one per side"), then
    #          the ring order ("out of sequence"). promenadeApplies and promenadeProblem are the same
    #          rule read as a boolean and as a reason, so the Sequencer, the analyser and the registry
    #          precondition cannot disagree about whether a board is promenadeable.
    #          A refusal must never be reported as an applied promenade, and it must never be reported
    #          as a "zero" either: an unresolvable square is not a resolved one.
    #          A board whose dancers carry couple numbers OUTSIDE the four home couples is refused the
    #          same way, and deliberately so: the ring-order test reads couples 1..4 by number while
    #          the identity guard only requires a positive couple number, so the stray case is checked
    #          explicitly (it used to throw) rather than left to the ring arithmetic.

  @bind:promenadeHome @bind:promenadeProblem @bind:PROMENADE_COUPLE_MAX @bind:PROMENADE_COUPLE_MIN
  Scenario: The partners must be standing together as a couple, within the standard separation band
    Given a board on which the two dancers of some couple are not the standard couple separation apart
    When the promenade test runs
    Then that couple must fail the test, because partners flung apart are not standing as a couple
    And the standard separation must be accepted with a band of plus or minus one unit around it
    # Engine: promenadeHome measures each couple's partner gap and requires it inside
    #          PROMENADE_COUPLE_MIN..PROMENADE_COUPLE_MAX, i.e. 1..3 - the standard couple separation
    #          2 plus or minus 1, the same unit as the engine's own snapMaxError. Both bounds are
    #          declared in promenade.ts and re-exported by the package index.
    #          This is deliberately STRICTER than the reference implementation, which takes a couple's
    #          centre wherever the two dancers happen to be: on a board with the partners flung apart
    #          that still "promenades home" on paper, which in this engine would launder a BROKEN BODY
    #          into a false success. The band is measured, not guessed - every healthy pre-promenade
    #          state in the published corpus has its partners exactly 2.00 apart, while the states our
    #          own broken bodies produce measure 0.00, 4.00 and 6.00 (0.00 being two dancers on the
    #          same spot). A rule without the band accepts those and reports a resolved square that
    #          never formed up.

  @bind:findCodedMove @bind:PROMENADE_ALIASES @bind:applyToBoard
  Scenario: Promenade and Promenade Home are one call, resolved in one place
    Given a caller writes "Promenade" and another writes "Promenade Home"
    When the engine resolves either name to a call
    Then both must resolve to the same registered call, with the same precondition and the same beat count
    # Engine: coded-moves.ts builds ONE byAlias map from each call's alias list and findCodedMove does a
    #          single trim+lowercase lookup, so an alias cannot exist for one entry point and not for
    #          another. PROMENADE_ALIASES is the authored alias list ('Promenade', 'Promenade Home')
    #          and its first entry is the canonical display name the engine reports.

  @bind:applyToBoard @bind:findCodedMove @bind:codedMoveApplies
  Scenario: A group prefix that names everyone is the resolve, while a genuine subset is not
    Given a whole-set resolve and a call written with a leading group prefix
    When the prefix names everyone, as "All Promenade" does
    Then it must be treated as the same call as "Promenade"
    And when the prefix names a genuine subset, as "Boys Promenade" does
    Then it must NOT be applied as the resolve: a whole-set resolve has no half-set reading
    # Engine: Sequencer.tryCodedMove resolves the selection first and runs the whole-set resolve only
    #          when the resolved ids are exactly all of the physical dancers, so the group prefix
    #          "All" (like Everybody/Everyone) adds nothing and the call must not fail on account of
    #          it - the published corpus writes the finish that way. A PROPER subset is deliberately
    #          left to the applicator, which refuses it for not being legal for selected dancers,
    #          rather than promenading the whole set on a half-set request.

  @bind:legalNext @bind:legalCalls @bind:transitionTable
  Scenario: A derived call is offered in legalNext only when it applies, and is not an FSM edge
    Given the board is a set the promenade applies to
    When the engine lists the calls legal next from that board
    Then the resolve must be listed
    But from a board the promenade does not apply to it must be absent from that list
    And the pure derived pivots must be listed from every board, because they always apply
    And the catalog enumeration and the precomputed transition table must not carry it, because a geometry-derived call is not an FSM edge
    # Engine: sequencer.ts legalNext = legality.legalCalls(board) (the CATALOG enumeration by
    #          library.callNames(), through the applicator) plus CODED_MOVE_NAMES filtered by
    #          codedMoveApplies and by "not already listed". legalCalls() lists a call only when the
    #          catalog carries an authored setup for it - it enumerates library.callNames() and
    #          applies each through the applicator - so a geometry-derived call, which has no authored
    #          setup, never appears there. Sequencer.transitionTable enumerates its build-time edges
    #          from legalCalls(board) as well, so the precomputed table cannot hold a geometry-derived
    #          edge either.
    #          The derived entries are listed under CANONICAL names, so a pivot is offered as
    #          "Face Half" however the caller writes "U-Turn Back".
    #          Recorded limitation: a geometry-derived edge is not yet expressible in the precomputed
    #          table; the table builder would need a rule for derived edges, and until it has one the
    #          table and legalNext are allowed to disagree about which derived calls exist.

  @bind:sequenceBeats @bind:stepBeats @bind:PROMENADE_BEATS
  Scenario: A promenade occupies a declared beat cost on the timeline
    Given a sequence of calls containing a promenade
    When the engine sums the beats of the sequence
    Then the promenade must contribute its declared PROMENADE_BEATS to the sequence total, whatever board it starts from
    And its beat cost must not depend on how far the set actually travels
    # Engine: coded-moves.ts registers the resolve with beats = PROMENADE_BEATS (8), and
    #          SequenceAnalyzer.stepBeats returns a coded move's beats BEFORE it matches anything,
    #          so every entry point - sequenceBeats, validateSegment, a tip's 64-beat total, the
    #          solver's budget - sees the same number for every board.
    #          The fixed 8 is a stated SIMPLIFICATION of a distance-dependent motion: a set already
    #          at home promenades no distance at all and one 270 degrees round promenades three
    #          quarters of the way, and both are charged 8 beats.

  @bind:evaluateSequence @bind:PROMENADE_BEATS
  Scenario: Half way through a promenade the board is in motion, and on the last beat it is exactly home
    Given a sequence of one promenade replayed from a board that is not the home set
    When the engine evaluates the sequence at half the promenade's beat cost
    Then the board must be neither the board it started from nor the home set: the set is in motion
    And at the final beat of the promenade the board must be exactly the literal home board
    # Engine: sequence.ts evaluateSequence routes a coded move through evaluateCodedAt, which blends
    #          every dancer from its pose on the live board to its pose on the move's COMPLETED board
    #          by t = localBeat / beats (t = 0.5 half way), and applies the move whole once
    #          beat >= accumulated + beats. The last beat therefore lands exactly on the board the
    #          Sequencer stores, so the animation converges instead of jumping on the final beat.
    #          Replayed from the home set itself the blend is a no-op at every beat (start and end
    #          poses coincide), so the in-motion assertion is only meaningful from a board that is
    #          not already home - a test that replayed from home would prove nothing.

  @bind:evaluateSequence @bind:isZero @bind:promenadeApplies
  Scenario: A promenade that does not apply leaves the replay where it was, and is never a zero
    Given a sequence contains a promenade that does not apply to the board it reaches
    When the engine replays the sequence
    Then the board must be left exactly where the sequence had got to, never teleported home
    And the sequence must not be reported as a zero
    But a promenade from the home set IS a zero: it returns home in sequence with the facings restored
    # Engine: evaluateSequence breaks out of the replay when codedMoveApplies is false and returns the
    #          board as it stands (the refusal already handed back its input board), so an inapplicable
    #          finish cannot move the set. isZero returns false OUTRIGHT for a coded move that does not
    #          apply rather than skipping it: skipping would judge the sequence on a board it never
    #          reaches, which is precisely how a false zero would be reported, and a sequence whose
    #          promenade cannot apply is not the same thing as a sequence that ends home.
