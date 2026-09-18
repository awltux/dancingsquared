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
  #
  # -------------------------------------------------------------------------------------------------
  # A `<tam>` IS an INSTANCE, and the second half of this file is the editor's second job: edit the
  # instance ITSELF - its start formation and the arrangement of that formation, its end formation,
  # and the moves that carry each dancer between them - rather than only re-framing a call by padding
  # it. The model is the CallBundle (a DancerSpec already IS a start pose plus a path), so the editor
  # needs no parallel representation to drift out of step with the renderer, the matcher or the XML
  # codec; what it adds is the OPERATIONS, each returning a NEW bundle.

  Background:
    Given a core call with a native start formation and a native end formation
    And a new start and new end supplied as dancer positions and headings
    And a pad segment moves one dancer from one pose to another
    And a call instance is one `<tam>`: a start formation, a path per dancer, and the beats around them

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

  # ------------------------------------------------------------------ editing the instance itself

  @bind:instanceTable @bind:normalizeInstance
  Scenario: A call instance reads as a table in FULL-SET coordinates
    Given a call instance, including one authored for half the set
    When it is normalized and read as a table
    Then every dancer must be explicit and un-mirrored, at the pose the renderer would draw it at
    And the normalization must not move anybody, beyond one ulp of floating-point round-off
    And each row must report its own start pose, end pose, gender, move count and path beats
    And the home couple must be reported as a READ of the start formation, or as null when the start
      formation is not a home-like eight-dancer set - never invented from array position
    # Engine: editor.ts normalizeInstance / instanceTable. A tam authored for half the set publishes
    #          its dancers in HALF-set space, so editing those numbers would edit a frame the caller
    #          never sees and a start edit would land on the mirror image of the spot that was typed.
    #          The normalization is exact algebra (a mirrored pose is the base pose under a 180-degree
    #          rotation about the origin, and that left factor commutes with the whole path chain);
    #          editor.mjs pins the measured worst gap at under 1e-14 units and requires idempotence.

  @bind:setDancerStart
  Scenario: Re-posing a dancer's start re-frames that dancer's whole path
    Given a dancer of an instance and a new start pose
    When the start pose is set
    Then the start must be where it was put, and no other dancer may move
    And a TRANSLATED start must translate the dancer's end by the same vector
    And a start HEADING must rotate the path about the start, because a path is authored in
      dancer-local coordinates
    And the beat count must be untouched
    # Engine: editor.ts setDancerStart. Both halves are asserted in editor.mjs. This is the reason an
    #          edit here is an edit of the INSTANCE and not a rewrite of its choreography: the moves
    #          are carried through verbatim, in the frame the caller just chose.

  @bind:setDancerGender
  Scenario: Gender is what changes a formation's arrangement
    Given a dancer of an instance and a new gender
    When the gender is set
    Then nobody may move and nobody may re-face
    And the home couple read must be unchanged, because identity is matched on position and heading
    # Engine: editor.ts setDancerGender. MEASURED in editor.mjs, and the reason `couple` is reported
    #          as a read rather than as a field: flipping a dancer's gender changes WHICH SPOTS ARE
    #          BOYS AND GIRLS - the arrangement, in the FASR sense - and leaves the couple number
    #          where it was, so the couple can end up holding two dancers of the same gender.

  @bind:setDancerEnd
  Scenario: Setting an end pose re-aims only the last move, and holds the beats
    Given a dancer of an instance and a target end pose
    When the end pose is set
    Then that dancer must end exactly on the target
    And only its LAST move may change, and no other dancer may move
    And the call's beat count must be unchanged
    # Engine: editor.ts setDancerEnd, using the same construction as correctEndTo for a whole set.
    #          editor.mjs measures the end pose to 1e-12 and checks the move count and every other
    #          dancer's end are untouched.

  @bind:setMove @bind:addMove @bind:removeMove @bind:instanceBeats
  Scenario: The moves are editable, and the call re-times only when the LONGEST path changes
    Given a dancer of an instance and a replacement, inserted or deleted move
    When the move is edited
    Then the call's beats must follow its longest path
    And an authored PAUSE - a declared beat count longer than every path - must survive as a delta
    # Engine: editor.ts setMove / addMove / removeMove / instanceBeats. Both halves are asserted in
    #          editor.mjs, and the second is a correction of this file's first draft: "beats =
    #          max(path)" CUT an authored pause off the end of an unrelated edit (a 14-beat call whose
    #          longest path was 10 came back at 10.5 after half a beat was added to a shorter dancer),
    #          and leaving the number alone ignored a genuine re-time. The pause is carried as a
    #          delta: whatever the authored count exceeds the longest path by, it keeps exceeding it by.

  @bind:callToXml
  Scenario: An edited instance exports back to `<tam>` XML and re-parses to the same instance
    Given an edited call instance
    When it is exported and built again
    Then the start formation, the end formation, the gender of every dancer, the moves and the beats
      must all come back
    And the round trip must not drift, so exporting the re-parsed instance must be byte-identical
    And the declarations that change behaviour - `sequencer`, `actives` and the `<taminator>` note -
      must survive, because a fix or a created position is registered into the sequencer from THIS xml
    # Engine: editor.ts callToXml, round-tripped by editor.mjs. The export is EXPANDED - named
    #          `<move select="…"/>` references come out as explicit `<movement>` Beziers - and the two
    #          are the same animation, because resolvePath expands the first into the second.
    #          DROPPING `sequencer` WAS A REAL DEFECT, not a tidiness question: an edit to the
    #          `sequencer="no"` half of a call came back as an ordinary, matchable setup, re-opening
    #          the demonstration hole the flag exists to close. The export precision is 4 decimals for
    #          the same reason: at the assets' own 2 decimals a 10-move path's END pose came back
    #          0.0672 units out, because each segment's rounded rotation Bezier accumulates.
    #          ONE FOOTGUN IS PINNED rather than discovered later: the engine mirrors a half set
    #          unless SOME 180-degree partner already exists, so an edited eight-dancer formation with
    #          no origin-opposite pair is DOUBLED (16 dancers) when read with mirror=true. The
    #          editor's own path is mirror=false.
