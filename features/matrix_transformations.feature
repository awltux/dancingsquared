Feature: Matrix Transformations of Formation States
  As a square dance choreography engine
  I want to treat every call as an affine matrix transformation on a formation's dancer-state matrix
  So that applying a call is an exact, orientation-aware map from one formation state to another, and the same transformation composes cleanly

  Background:
    Given each formation state is represented as a matrix whose rows are the eight dancers' (x, y, cos-heading, sin-heading) state vectors
    And a call is an affine transformation over that matrix (rotation + translation for position, rotation for heading)
    And the transformation is deterministic given the start state

  @bind:poseToVec @bind:apply5
  Scenario: Representing a formation as a dancer-state matrix
    Given eight dancers occupy a recognized formation
    When the formation is encoded as a matrix
    Then each row must hold the dancer's position vector and orientation components
    And the matrix must preserve each dancer's home identity alongside its state row
    # Engine: matrix.ts poseToVec produces [x, y, cos(h), sin(h), 1] rows; apply5 applies a 5x5.

  @bind:dancerMatrix @bind:apply5
  Scenario: Applying a call as a matrix transformation
    Given a formation state matrix S and a call C with a defined matrix M
    When the call is applied
    Then the end state matrix must equal M applied to S
    And the end state must equal the canonical representation of the resulting positions and headings
    # Engine: matrix.ts dancerMatrix builds the per-dancer 5x5; apply5 applies it.

  @bind:mul5 @bind:apply5
  Scenario: Composing two calls as a matrix product
    Given two consecutive calls C1 and C2 apply matrices M1 and M2
    When the sequence C1 then C2 is evaluated from a start state S
    Then the end state must equal (M2 · M1) applied to S
    And this must agree with applying M1 then M2 step by step
    # Engine: matrix.ts mul5 composes two 5x5 matrices.

  @bind:fitRigidMatrix @bind:mul5 @bind:identity5 @bind:matrixGetout
  Scenario: Using the inverse matrix for a getout fast-path
    Given a call is rigid and self-inverse, so its matrix M satisfies M·M = identity
    When the board is exactly the image of home under that call
    Then applying the same call once more must return the set to home
    And the engine may return that single call as a guaranteed, replayable getout without searching
    # Engine: matrix.ts fitRigidMatrix fits the global rotation+translation; solver.matrixGetout
    #          returns the single self-inverse rigid call as an O(1) getout.

  @bind:matchFormations @bind:applyToBoard
  Scenario: Rejecting a call whose start matrix does not match the current state
    Given the current formation matrix does not overlay a call's start-setup matrix within tolerance
    When the call is requested
    Then the engine must reject the transition before mutating the dancer-state matrix
    # Engine: matcher.findMatchingVariant / matchFormations rejects the mismatch before apply.
