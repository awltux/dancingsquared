Feature: Synthesizing a Missing Setup (the Call Editor)
  As a caller with a call that the catalogue has for one formation but not another
  I want to author the missing setup by padding the call's own core movement
  So that a call can be made danceable from a formation nobody has authored yet, without inventing its choreography

  # The editor does NOT author choreography. It takes a call that already exists for some setup and
  # RE-FRAMES it: the call's core movement is kept exactly, and the dancers are moved from the new
  # start onto the core's native start, and from the core's native end onto the new end.
  #
  #   [newStart] --padIn--> [coreStart] --core (untouched)--> [coreEnd] --padOut--> [newEnd]
  #
  # The pad segments are a straight-line translate plus a turn each, built with the same Bezier
  # convention taminations uses, so a synthesized setup is an ordinary call bundle like any other -
  # it matches, applies, animates and exports through the same code paths, and nothing downstream
  # needs to know it was synthesized.
  #
  # The whole file therefore rests on ONE property: the correspondence between the new formation's
  # dancers and the core's dancers must be DERIVED from geometry, not assumed from array order. If it
  # were assumed, a re-ordered or rotated input would silently pad the wrong dancer to the wrong spot
  # and produce a call that looks plausible and dances wrongly.

  Background:
    Given a core call with a native start formation and a native end formation
    And a new start and new end supplied as dancer positions and headings
    And a pad segment moves one dancer from one pose to another

  @bind:rigidFit
  Scenario: The best rigid transform is rotation plus translation, and reports its error
    Given two sets of points
    When the best rigid transform mapping the first onto the second is fitted
    Then it must consist of a rotation and a translation, and NOT a reflection
    And it must report how well it fitted, so a caller can see that the formations are not congruent
    # Engine: editor.ts rigidFit returns { cos, sin, tx, ty, error } - a Procrustes fit over
    #          rotation + translation only. Reflection is deliberately absent: a mirrored formation is
    #          the other-handed formation, so fitting one onto the other with a reflection would
    #          produce pads that are geometrically close and choreographically wrong.

  @bind:synthesizeSetup @bind:endPoses
  Scenario: A synthesized setup is the core with padding around it, and the core is untouched
    Given a core call and a new start and end
    When the setup is synthesized
    Then at beat 0 the dancers must be on the new start
    And after the pad-in they must be on the core's own start
    And at the end of the core they must be on the core's own end
    And at the total end they must be on the new end
    # Engine: editor.ts synthesizeSetup. The four boundaries are the contract, and editor.mjs asserts
    #          all four (plus that the core's own beats between them are unchanged). The point of the
    #          structure is that the core movement is carried through verbatim - the editor moves
    #          dancers TO and FROM it, and never edits it.

  @bind:padSegment
  Scenario: A pad is a straight-line shift plus a turn
    Given two poses for one dancer
    When the pad segment between them is built
    Then the dancer must travel in a straight line from one to the other
    And must end facing the target heading, turning along the way
    # Engine: editor.ts padSegment. editor.mjs checks the mid-pad motion is a straight line for a
    #          congruent formation, which is what makes a synthesized setup look like a deliberate
    #          lead-in rather than a shuffle.

  @bind:closureDiscrepancy @bind:alignTargetToStart
  Scenario: Closure is measured against a dancer SET, not an array order
    Given a call and an intended end formation
    When the discrepancy between them is measured
    Then the target must be re-ordered into the call's dancer order BY GEOMETRY, via the call's start poses
    And permuting the target's array order must not change the reported error
    And the result must report a worst-case position error AND a worst-case heading error separately
    # Engine: editor.ts closureDiscrepancy -> { actual, target, maxPosErr, maxHeadingErr }. Position and
    #          heading are reported separately because a call can land every dancer on the right SPOT
    #          while facing them the wrong way, and a single combined number would hide that - the same
    #          reason isZero checks facings as well as fasrKey.

  @bind:correctEndTo
  Scenario: Correcting an end uses the same derived correspondence, and handles half sets
    Given a call whose end does not reach the intended formation
    When the end is corrected toward the target
    Then the correspondence must again come from geometry, not from array position
    And a half-set call must be handled, because the mirror that duplicates it is an involution
    # Engine: editor.ts correctEndTo, which carries the same INDEX INDEPENDENCE note as
    #          closureDiscrepancy. The half-set remark is in its doc comment: a call authored as a
    #          half set is mirrored to eight dancers, and the mirror being an involution is what lets
    #          the correction be written once for both halves.

  @bind:setupToXml @bind:callToXml
  Scenario: A synthesized setup exports back into the catalogue's own format
    Given a synthesized setup
    When it is exported
    Then it must come out as taminations `<tam>` XML with its paths and moves
    And building that XML back must return the same call bundle
    # Engine: editor.ts setupToXml / callToXml, round-tripped by editor.mjs. This is what makes the
    #          editor an AUTHORING tool rather than a runtime trick: the result can be written into an
    #          asset file and loaded like any other call, which is how the authored variants elsewhere
    #          in this repo were produced and how they stay checkable by the same gates.

  @bind:alignFormationToCore
  Scenario: A rotated copy aligns to the same dancer identities
    Given a formation and a rotation of it about the origin
    When both are aligned to the core
    Then the same dancer must map to the same counterpart in each, so the identity is unchanged by the rotation
    # Engine: editor.ts alignFormationToCore. editor.mjs asserts the 90-degree case explicitly, couple
    #          1 to couple 1. The rotation is about the ORIGIN rather than the set centre on purpose:
    #          the case that breaks a centre-relative alignment is a formation whose centre does not
    #          coincide with the origin, and that is exactly what a rotated copy produces.
