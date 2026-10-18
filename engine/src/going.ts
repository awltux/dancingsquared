// HOW A CALL GOES: which authored BODY of a call this is, where the corpus publishes more than one.
//
// WHY THIS EXISTS. `Lead Right - Close`, `- Normal` and `- Far` are three authorings that start from the IDENTICAL setup
// (measured: all five `Lead Right`/`Lead Left` bodies resolve `Adjacent Dancers Close`, two dancers at (+-1, 0), heading
// 90deg). They differ only in the motion, so nothing about a board can select between them: over the 139 named
// formations the family is legal on 84, and on every one of those 84 MORE THAN ONE title is legal with the same error
// and the same mapping. They are not distinguishable by geometry, which is why the distinction has to be a LABEL.
//
// THE LABEL IS DERIVED FROM THE TITLE, and that is deliberate rather than convenient. These tams are exported by the
// dancing-squared web app (`<tam title="Lead Right - Close" ...>`, "exported by the dancing-squared web app"), so an
// AUTHORED attribute would be dropped by the next editor round-trip unless the exporter and its survival gate
// (`editor.mjs` 14b) learned it too. A derived label cannot be lost that way, and the title is where the corpus
// already says it.
//
// IT IS A DISCRIMINATOR, NOT A MEASUREMENT. What the three words MEAN is the author's business (the same vocabulary
// names `Adjacent Dancers Close/Compact/.../Far` START SEPARATIONS, which is a different axis and is why the label is
// not read from `formation`). Measured, the two readings do not agree: `- Close` and `- Normal` differ by 0.008 units of
// leader path (3.767 against 3.775) and their followers both travel exactly 1.000, so a label named for DISTANCE would
// have two values that measure the same. The values only have to be distinct and stable.

/** The bodies the corpus distinguishes. Closed on purpose: a dash suffix alone is not a going (`- Stop at Home` is not). */
export type Going = 'close' | 'normal' | 'far';

/** The values, for a rule or a probe that has to enumerate them. */
export const GOING_VALUES: readonly Going[] = ['close', 'normal', 'far'];

/**
 * The trailing `- Close` / `- Normal` / `- Far` of a title, or null.
 *
 * `Circle Left - Stop at Home` is the control that matters: it is a real shipped title with a dash suffix, and it is NOT
 * one of these — so the suffix list is closed rather than "anything after a dash".
 */
export function goingOfTitle(title: string): Going | null {
  // THE DASH IS PART OF THE RULE: without it, a title that is one of the three words (`Far`) would read as a suffix, and
  // the label would be inferred from a call's NAME rather than from the authoring's declaration of a body.
  const m = /\s-\s*(close|normal|far)\s*$/i.exec(title.trim());
  return m === null ? null : (m[1].toLowerCase() as Going);
}
