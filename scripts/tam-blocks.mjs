// THE `<tam>` BLOCKS A FILE *HAS*, AS OPPOSED TO THE ONES ITS TEXT MATCHES.
//
// A REORDER TOOL ADDRESSES A TAM BY POSITION - `parseCallXml` returns a list, `scripts/reorder-formation.mjs`
// edits the block at the same index - so the two lists have to be the same list. They were not, and the
// difference is a COMMENTED-OUT TAM: `parseCallXml` (rightly) ignores `<!-- <tam ...> ... </tam> -->` while a
// naive `/<tam\b[^>]*>[\s\S]*?<\/tam>/g` scan counts it, so every block after it was one position out.
//
// MEASURED over the corpus (500 call files): the raw scan finds **5515** blocks and the parser returns **5495** -
// and masking comments out closes the gap EXACTLY, 5495 = 5495. Twenty tams are commented out in four files:
// `ms/star.xml` (16), `a1/split_square_thru.xml` (2), `c1/magic_column_formation.xml` (1) and
// `plus/anything_and_spread.xml` (1).
//
// The one that bit is `plus/anything_and_spread.xml`: its commented `"Bend the Line and Spread"` shifted every
// later block by one, and the tool refused `"Pass the Ocean and Spread"` with "the raw block at that position is
// a different tam" - the cross-check doing its job, which is why the fix is here rather than a loosened check.
//
// THE MATCH IS FOUND ON THE MASKED TEXT BUT THE TEXT IT RETURNS IS THE REAL ONE, and that distinction cost four
// corpus files to learn. `String.prototype.matchAll` returns the substring it matched IN THE STRING IT MATCHED,
// so a caller that took `m[0]` was handed the MASKED block - and writing that back turned every comment INSIDE a
// tam into a run of spaces. MEASURED: a `Normal Lines` reorder rewrote `<!--  Scoot and Little  -->` in
// `c1/interrupt.xml`, `c2/cross_the_k.xml`, `c3a/scatter_circulate.xml` and `plus/walk_and_dodge.xml` into
// blanks, and the tool's own write-then-verify did NOT see it, because it re-parses the files and a comment has
// no geometry. So the slice is taken from the ORIGINAL text here, where a caller cannot forget it.
//
// Newlines are preserved by the mask and by the slice, so a caller's line numbers stay true as well.

/**
 * The file's LIVE `<tam>` blocks, in document order.
 *
 * `index` addresses the ORIGINAL text (the mask is length-preserving), and `text` is the original block's bytes,
 * comments and all - so a caller may rewrite it verbatim without eating anything.
 */
export function liveTamBlocks(text) {
  const masked = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  return [...masked.matchAll(/<tam\b[^>]*>[\s\S]*?<\/tam>/g)].map((m) => ({
    index: m.index,
    text: text.slice(m.index, m.index + m[0].length),
  }));
}

/**
 * `title="…"` as a regex over a raw block, for telling two tams apart.
 *
 * A title is NOT an identity on its own - `ms/sashay.xml` carries two `Ladies In, Men Sashay` tams - so callers
 * use this to CONFIRM a position rather than to find one.
 */
export const titlePattern = (title) => new RegExp(`title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
