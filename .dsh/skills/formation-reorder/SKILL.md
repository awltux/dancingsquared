---
name: formation-reorder
description: Reorder a named formation's dancer index in this repo's taminations corpus (for example to square-set S,E,N,W order) and permute every call that names it, so no call's geometry moves. Use when a formation in assets/formations.xml has the wrong dancer order, or before changing that order by hand.
whenToUse: A formation's `<dancer>` list order looks wrong (e.g. `Circle` was W,N,E,S where a square set is S,E,N,W), or you are about to edit a formation block and need the 5-60 calls that name it to follow. Not for changing a formation's SHAPE - only its order.
user-invocable: true
---

# Reordering a formation

A formation's `<dancer>` order is **data every caller depends on**: a `<tam>`'s `<path>` list is paired
with the formation's dancers **by index**, so moving one dancer in the list gives every call that names
the formation somebody else's track. Nothing in the files shows it afterwards - the spots are the same,
the tams parse, the board still looks like a ring. So the formation block and every dependent call's
paths must change **together**, and this skill is that procedure.

The rules live in `engine/src/formation-order.ts`; the driver is `scripts/reorder-formation.mjs`; the
permanent pin is `engine/test/formation-order.mjs`. Measured facts (22 dependents, the path permutation,
the invariance number, why a raw diff is not enough) are in `references/measured-facts.md`.

## Procedure

1. **Clean tree.** `git status --short` must be empty. The tool refuses otherwise, and it is right to:
   anything modified besides `assets/formations.xml` is someone else's in-flight work.

2. **Produce the new block.** In the POC's Call editor, load a call that starts from the formation, put
   the dancer table in the order you want with the `⇄` swap button, and press **`Export <formation>`**
   (the block is on your clipboard). Paste it over the old block in `assets/formations.xml`.

   You do not have to use the editor: any block with the same spots in a different order will do. What
   the tool requires is that the change is a **reorder** - same spots, same genders - not a reshape.

3. **Read the plan.** `node scripts/reorder-formation.mjs --formation <Name>` (a dry run; it writes
   nothing). It prints the old and new compass order, the path permutation, every dependent
   (`file  count`), the worst sampled geometry difference, and one line per thing it **refuses**.

4. **Apply it.** `node scripts/reorder-formation.mjs --formation <Name> --write`. It re-reads what it
   wrote and re-proves the geometry; on any failure it restores the files and exits non-zero.

5. **Gate the corpus.**
   ```
   node engine/test/shape-census.mjs
   npm run build --prefix engine && npm run verify:light --prefix engine
   node poc/verify.cjs
   node poc/tools/verify-probes.mjs
   node book/tools/check-links.mjs
   ```
   Then re-pin `engine/test/formation-order.mjs` (its `PINNED` table: `order`, `pending: false`; the
   **digest must not change**, and if it does the conversion moved somebody). Run it before and after;
   a stale dependent is exactly what it catches.

6. **Commit once, per formation.** `corpus: the <Name> formation is ordered <letters> and N calls
   follow` - carrying the permutation, the dependent count and the worst sampled difference. One
   formation per commit, so the diff is reviewable and a revert is one revert.

## What it refuses, and what that means

| Refusal | Meaning |
|---|---|
| tree dirty outside `assets/formations.xml` | commit or stash first; do not run |
| `no-partner` / `size-mismatch` | the new block is a different SHAPE, not a reorder |
| a dependent writes neither `written` nor `2 × written` paths | its pairing is not the half-set or the whole-set rule; re-author that tam by hand |
| a dependent carries `actives` | a subset's paths pair by a different rule; not this tool's decision |
| a dependent carries an INLINE `<formation>` | it is a copy the named change does not reach; convert it separately |
| "geometry moves" | the plan is wrong for that tam - nothing is written |

The tool also **reports** (does not edit) formations that share the spot set under another name
(`Alamo Wave` shares `Circle`'s), because they are not dependents. A reported refusal is not a failure of
the tool: it is the list of what a human still has to decide.

## Do not

- Do not hand-permute the `<path>` blocks. The correct permutation is not the one a couple-order reading
  suggests (see `references/measured-facts.md`), and the proof that nobody moved is the point.
- Do not convert more than one formation in a commit, and do not convert a formation whose calls are
  being edited in another branch - the corpus files are shared ground.
- Do not assume the rest of the corpus is in the same order. Only the formations in the pin are
  converted; **135 of the 139** compass-class formations are still out of order, and each is a separate
  decision.
