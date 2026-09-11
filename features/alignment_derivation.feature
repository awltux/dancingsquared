Feature: FASR Alignment Derivation
  As a caller reading All8's published choreography
  I want a setup like [L1p] to become a danceable board
  So that a published figure can be set up and danced, and a board can be classified back into the FASR state it is in

  # FASR is Callerlab's Formation/Arrangement/Sequence/Relationship vocabulary, and All8 indexes its
  # whole get-out corpus by it. This file covers the DERIVATION: turning a FASR id into a board, and
  # reporting the FASR state of a board.
  #
  # There are TWO ways to a board, and they are independent on purpose:
  #
  #   FROM THE DIAGRAM  All8 draws a diagram per alignment in which every spot carries a facing and a
  #                     home couple number, so the diagram plus the arrangement determines all eight
  #                     dancers. But a diagram is SCHEMATIC (a unit lattice, no distances), so it is
  #                     laid onto the engine's own template for the formation - spots and facings come
  #                     from the template, only the couple LAYOUT comes from the diagram - and the
  #                     result is a board the call matcher can actually dance.
  #
  #   FROM THE CODE     boardForFasrCode needs NO diagram. The FASR state already fixes the formation
  #                     letter, the arrangement, the sequence and the relationship, and the engine's
  #                     template supplies the metric and facings, so the code alone is enough. This is
  #                     what a published line such as `[L1p] --AL` requires: the line is self-contained.
  #
  # The two paths are cross-checked against each other rather than trusted separately, and they agree
  # on 26 of All8's 29 published alignments.

  Background:
    Given a FASR id names a formation letter, an arrangement, a sequence and a relationship
    And the engine has a formation template for each formation letter

  @bind:parseAlignmentId
  Scenario: A FASR id is parsed into its four parts
    Given an id such as `L1p`, `1W2p`, `5L2p` or `L.F2p`
    When it is parsed
    Then the letter must be the formation, the leading digit the arrangement, the next the sequence and the trailing letter the relationship
    And an id with no arrangement digit must default to arrangement 0
    And a string that is not a FASR id must parse to null rather than to a guess
    # Engine: alignment.ts parseAlignmentId. Multi-character letters occur legitimately (`L.F` is
    #          Lines Facing, a distinct formation from plain Lines), which is why the parse cannot be
    #          a fixed-position slice.

  @bind:boardFromDiagram
  Scenario: The diagram path takes only the couple layout from the drawing
    Given All8's schematic diagram for an alignment
    When it is laid onto the engine's template for the formation
    Then the spots and facings must come from the TEMPLATE, so the board carries the danceable metric
    And the couple numbers must come from the DIAGRAM, so the home identity is All8's
    And the gender on each spot must come from the arrangement table, since the diagram does not write it
    # Engine: alignment.ts boardFromDiagram. A diagram drawn rotated relative to the arrangement table
    #          is accepted by trying the four rotations and keeping the one that reproduces the
    #          table's facing layout; reflections are NOT tried, because a mirrored diagram is the
    #          other-handed formation rather than the same one drawn differently.

  @bind:boardsForAlignment @bind:ARRANGEMENT_TABLES
  Scenario: The derivation enumerates identity rather than guessing it
    Given a formation template and a requested FASR state
    When the state is derived
    Then every assignment of homes to spots must be tried and the ones in the requested state kept
    And the count must be 4! for the boys times 4! for the girls, which is 576
    And when no assignment satisfies the state the result must be EMPTY with a reason, never a near miss
    # Engine: alignment.ts boardsForAlignment. The arrangement fixes the gender on each spot, so what
    #          is genuinely free is which home couple stands where and which partner takes which of
    #          the couple's two spots - and enumerating that covers the whole alignment space, so the
    #          answer is exactly the set of boards in the state rather than one guess at it.

  @bind:boardForFasrCode @bind:FORMATIONS_FOR_LETTER
  Scenario: A setup code alone stands the dancers up
    Given a FASR setup code from a published figure, with no diagram
    When it is resolved through the engine's template for its letter
    Then a board must come back for every alignment measured except the known refusals
    And a refusal must carry the reason rather than an approximate board
    # Engine: alignment.ts boardForFasrCode, gated in test/all8-format.mjs against All8's own
    #          diagrams: 26 of 29 match the diagram-derived board exactly. The 2 that refuse are the
    #          [P] pair (Beginning Double Pass Thru), and refusing is CORRECT - see the next scenario.

  @bind:relationshipStateOf
  Scenario: A relationship letter is withheld when no single letter is justified
    Given a formation in which some couples face and others stand side by side
    When the relationship state is asked for
    Then the code must be null rather than the majority or the first letter found
    And a reason must say which dancers disagree
    # Engine: alignment.ts relationshipStateOf. All8 labels its [P] pages with a relationship letter
    #          any way, which is exactly why this must refuse rather than mirror the label: reporting
    #          a letter would invent a fact the board does not support, and every consumer of the
    #          state (get-outs, the solver's target checks) would inherit it.

  @bind:arrangementFor @bind:sequenceFor
  Scenario: Arrangement and sequence are read off the board, not carried alongside it
    Given a board
    When its arrangement is asked for
    Then the arrangement must be derived from the genders standing on the formation's spots
    And the sequence must be derived from the order the couples appear in, as a code
    And neither may be stored on the board, so a board that is danced into a new state is re-classified rather than mislabelled
    # Engine: alignment.ts arrangementFor / sequenceFor. Both take a live Board and return a result
    #          object (`{number, letter, candidates, mirroredCandidates}` and
    #          `{code, boys, girls, boysState, girlsState}`), which is what lets the same pair be
    #          cross-checked after a call in a harness or a test.

  @bind:boardForAlignment
  Scenario: Matching a formation is invariant under rigid motion, but identity is not invented
    Given a board that is a known formation
    When the whole board is translated, rotated, or reflected
    Then it must still be recognised as that formation, because the match is centre-relative and searches the rotations and the reflection
    But a board reached by geometry alone must carry UNKNOWN home identity rather than a guessed one
    # Engine: alignment.ts boardForAlignment / matcher.ts. Measured on a Static Square: translation
    #          by (5,5), a 90-degree rotation and a reflection all still report "Static Square". The
    #          identity half is the same rule the corner and partner relations follow - identity is
    #          data, and a relation between two dancers with no known identity is not a fact we have.
