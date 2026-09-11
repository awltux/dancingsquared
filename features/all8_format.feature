Feature: All8 Sequence Import and Export
  As a caller working from Rich Reel's published choreography
  I want to read and write All8's own call notation
  So that a figure from an all8.com page can be danced here, and a sequence built here can be pasted back into that notation

  # All8's format (all8.com) is three things at once, and the third is the one that bites:
  #
  #   1. 2+5 ABBREVIATIONS. A token is 2 characters of designator plus up to 5 of call name:
  #      `G-SwThr` is "Girls Swing Thru", and `--SwThr` is "(everyone) Swing Thru" - the `--` holds
  #      the empty designator place. Designators A B G C E H S are All Boys Girls Centers Ends
  #      Heads Sides.
  #   2. An optional [FASR] SETUP header, e.g. `[L1p]`.
  #   3. CALL SHARING, expressed as INDENTATION. "When a line appears indented, calls are shared in
  #      common with a line above it." This is the part that makes the format a layout rather than a
  #      list, and the part a naive parser gets wrong: the shared calls are NOT on the line at all.
  #
  # The reading of sharing is not a matter of opinion, because All8 PUBLISHES ITS OWN ANSWER: the
  # worked example on abbrev.htm prints the expected reading of one highlighted row in full. If the
  # rule is read wrong, that row cannot reproduce it, and no amount of internal consistency hides it.

  Background:
    Given All8 writes a call as a 2-character designator plus a call-name abbreviation
    And All8 writes a figure as a line of such tokens, optionally preceded by a [FASR] setup code
    And All8 writes call sharing as indentation, blank leading cells being inherited from a line above

  @bind:parseAll8Figures @bind:ALL8_PITCH
  Scenario: The number of shared leading calls is read from the indent
    Given a plain-text block of All8 figures laid out in columns
    When the block is parsed
    Then each figure's shared count must be its indent divided by the column pitch
    And the pitch must be 8, being All8's documented uniform 2+5 width of 7 characters plus a separator
    And that division must be exact, because a fractional share count means the column assumption has failed
    # Engine: all8-format.ts parseAll8Figures -> parseBlock. The base column is the block's own
    #          left-most indent, and ALL8_PITCH = 8. A row is only allowed to inherit when an earlier
    #          row in the same block actually has that many calls; otherwise it is treated as
    #          unshared rather than having calls invented for it.

  @bind:parseAll8Figures
  Scenario: A blank line ends a sharing block
    Given All8 pages carry page text between groups of figures
    When a block is parsed
    Then a line that is not a figure must end the current sharing block
    And it must be reported in the skipped list rather than silently dropped
    # Engine: all8-format.ts parseAll8Figures. The base column is per-block, so a page-text line at
    #          column 0 would otherwise become the base and shift every subsequent share count.

  @bind:parseAll8CellRows
  Scenario: A table of figures states sharing literally, and must agree with the indent reading
    Given All8's worked call-sharing example, whose cells are already separate
    When it is parsed as rows of cells
    Then an empty cell must be inherited from the nearest row above at the same index
    And the highlighted row must resolve to the figure All8 prints in full
    # Engine: all8-format.ts parseAll8CellRows. Resolution is tracked PER COLUMN, because a cell's
    #          share reference is "the row above at the same index" and that index has to survive.
    #          test/all8-format.mjs asserts the printed figure, so the two readings cannot drift.

  @bind:decodeLine @bind:MULTI_TOKENS @bind:REPEAT_TOKENS @bind:SUFFIX_TOKENS
  Scenario: A token can be a call, several calls, or a rule about the previous call
    Given a token may name one call, expand to more than one, or modify the one before it
    When a line is decoded
    Then a multi-call token such as TagI must yield both of its calls
    And a repeat token must yield a second copy of the previous call
    And a suffix token must rewrite the previous call's name rather than adding a call
    And a repeat or suffix token with nothing before it must be reported as unreadable, not silently ignored
    # Engine: all8-notation.ts decodeLine. TagI is All8's compound "Tag The Line - Face In"; `Twice`
    #          is "repeat the previous call again"; `ToWav` is "To Wave (to Formation, not call)", so
    #          `DoSaD ToWav` is ONE call. The line-level reader is the authority for all three, which
    #          is why decodeStats applies the same position rule and decodeToken does not answer for them.

  @bind:formatAll8Figures @bind:formatAll8Call
  Scenario: Export applies call sharing, and admits what it cannot express
    Given a list of figures expressed as engine call names
    When they are formatted as All8 text
    Then a figure whose leading calls match the previous figure's must omit them and be indented by that many cells
    And a call with no All8 abbreviation must be written in [square brackets] rather than dropped
    And a call with no All8 abbreviation must format as null, never as a made-up token
    # Engine: all8-format.ts formatAll8Figures / formatAll8Call. Inventing a token would produce
    #          something All8 never prints and that nothing could read back, so the bracket form keeps
    #          the round trip honest about what it could not express.

  @bind:looksLikeAll8Call
  Scenario: Page text must not be read as calls
    Given an All8 page mixes figures with prose, flags, and quoted delivery words
    When a line is tested for whether it is a figure
    Then a real token such as `--DoSaD`, `H-Pr1/2`, `--1/2Tg` or `4LChn` must be accepted
    And a page word such as `Get-outs`, `practice` or `anyone` must be rejected
    And a quoted span must be blanked before tokenising, because a word inside it can otherwise pass the test
    # Engine: all8-format.ts looksLikeAll8Call / blankQuoted. The failure mode is chosen deliberately:
    #          a wrong rejection skips a line, while a wrong acceptance invents a call. `--"Roll HIM
    #          away"` is why quotes are blanked - `HIM` is all-caps and passes every shape test a real
    #          abbreviation passes.
