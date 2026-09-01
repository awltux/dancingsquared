Feature: Dancer Selection for Subset Calls
  As a square dance choreography engine
  I want to apply a call to a selected subset of dancers by a selection prefix (Heads, All, Centers, Boys, Girls, Ends, Couples, Men, Women, Leaders, Same 4, Head Position, Couple #N, "N Boys Have Girl On Right", etc.)
  So that subset calls can be expressed as a selection plus a base call family, and applied to the intended dancers while the rest of the set holds

  Background:
    Given a call may act on fewer than the full eight dancers
    And the acting dancers are named by a selection prefix before the call family name
    And the non-selected dancers must remain in place while the selected ones act

  @bind:splitSelection @bind:selectionGroup @bind:resolveSelection
  Scenario: Parsing a selection prefix from a call family name
    Given a call step such as "Centers Pass Thru" or "Same 4 Star Thru"
    When the engine splits the step into a selection and a base call
    Then it must identify the leading selection ("Centers", "Same 4") and the remaining base call ("Pass Thru", "Star Thru")
    And a step with no leading selection must be treated as a whole-board call
    # Engine: selection.splitSelection returns { selection, call }; selectionGroup maps the
    #          selection to a group key.

  @bind:resolveSelection
  Scenario: Resolving a selection to the acting dancer ids
    Given a board with eight dancers carrying home identity and gender
    When a selection such as "Heads", "Boys", "Centers", "Ends", "Couples", "Men", "Women", or "Leaders" is resolved
    Then it must return the ids of the dancers in that subset
    And the same dancer must not appear twice across the resolved set

  @bind:applySelected
  Scenario: Applying a base call to the selected subset only
    Given a board and a selection plus a base call
    When the engine applies the call to the selected subset
    Then the selected dancers must move according to the base call
    And the non-selected dancers must keep their positions and headings
    And the result must be legal only if the base call applies to the subset's formation

  @bind:applySelected
  Scenario: A subset call is legal only when the subset matches the base call's formation
    Given a selection resolves to dancers whose arrangement does not match the base call's starting formation
    When the engine tries to apply the base call to that subset
    Then it must report the step as not legal
    # This is the key limitation: subset application works only when the subset geometry
    # matches the base call's setup (e.g. heads facing each other for "Pass Thru"). Authored
    # selector-prefixed titles (Heads Pass Thru, Boys Trade) keep their purpose-built setups.

  @bind:applyToBoard @bind:splitSelection
  Scenario: Trying the authored title before flexible selection
    Given a call name that may be an authored selector-prefixed title (e.g. "Heads Pass Thru")
    When the engine applies it
    Then if the full name is a registered call it must use that authored setup
    And only when the full name is NOT a registered call must it fall back to flexible selection
    # This keeps authored (correct-geometry) selector calls authoritative and uses flexible
    # selection only for compositions that have no authored title (e.g. "Centers Pass Thru").

  @bind:applySelected @bind:registerModule
  Scenario: Carrying a selection on a module step
    Given a module step is written as { selection, call }
    When the module is registered and applied
    Then the step must apply the base call to the selected dancers
    And a step with no selection applies to the whole board

  @bind:resolveSelection
  Scenario: Supporting parametric selectors
    Given a selection such as "Couple #1", "Couple #1 and #2", "Head Position", "Side Position", "Same 4", or "N Boys Have Girl On Right"
    When the selection is resolved against a board
    Then it must return the corresponding dancers by home couple or position
    # These parametric selectors are resolved with board context; where a selector is
    # ambiguous (e.g. "Same 4" position-dependent) the engine resolves it as best it can
    # and notes the approximation.
