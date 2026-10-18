# Measured facts behind `formation-reorder`

Everything here is a number from a run in this repository, not an estimate. The measurements were taken
at `9d33185` (the commit that fixed `Circle Left Home`), read-only, with the engine built.

## Why a diff is not enough (the question that started this)

`Circle`'s block is 4 dancers in `assets/formations.xml`; the reader completes it to 8 with the 180° rule,
and **22** tams name it:

| file | tams |
|---|---|
| `ms/allemande.xml` | 1 |
| `ms/circle.xml` | 16 |
| `ms/promenade.xml` | 2 |
| `ms/sashay.xml` | 3 |

All 22 write **4 paths** with `symmetry 2`, and **0** tams carry an inline formation on Circle's spot set.
A raw `formations.xml` diff cannot tell you what those 22 tams need, for three measured reasons:

1. **The permutation is not the obvious one.** `Circle`'s completed order is `[W boy, W girl, N boy,
   N girl, E boy, E girl, S boy, S girl]`. Reordering the authored half to S,E,N,W needs
   **`[2,3,0,1]`** (new S takes the old N path, new E the old W path) because a half-set tam's 4 paths
   pair with the **written** dancers and the mirrored half reuses each written dancer's local path. The
   couple-order reading gives `[3,2,1,0]`, and **I measured it**: it moves dancers by up to **3.68 units**
   (it rotates the dance 180°). `[2,3,0,1]` reproduces every board to a worst sampled position difference
   of **3.23e-15** over 16 samples per track, 22/22 tams, 0 mismatches.
2. **Half-set and whole-set tams are different rules.** A whole-set tam writes one path per completed
   dancer, where the antipode's path is **not** interchangeable; a half-set tam's is. The tool selects the
   matching rule by path count (`written` vs `2 × written`).
3. **Inline copies and aliases are not dependents.** `Alamo Wave`, `Right and Left Grand Circle`,
   `Single File Promenade` and `Single File Reverse Promenade` share Circle's **positions and genders**
   (Alamo Wave differs in facing), so a name-driven change does not reach them and must say so rather than
   look complete.

## The convention, and how much of the corpus shares it

A square set's couple order in FASR terms is **S, E, N, W** (couples 1–4 counter-clockwise), boy then
girl inside each couple. Measured over `formations.xml`'s **139** formations whose consecutive pairs sit on
the compass points, **4** are in that order:

- `Right and Left Grand Static Square`
- `Wrong Way Grand Static Square`
- `Right and Left Grand Circle`
- `Wrong Way Grand Circle`

The other **135** are not — `Circle` was `WNES`, `Static Square` is `SWNE` — so this is **not** a corpus
convention. Each conversion is a deliberate, separate decision and a separate commit. (`Static Square` is
left alone until someone wants it; converting it would touch every call that starts from home.)

## The invariant that is actually being bought

> A dancer may be **re-ordered**; a dancer may not be **moved**.

The engine's `compareGeometry` matches dancers by START POSE (not by index, because the index is what
changes) and samples both tracks. The harness `engine/test/formation-order.mjs` pins the same property as
data: a digest of every dependent's `start-spot → end-spot` pairs. That digest is **identical before and
after a correct conversion** (the order changed, the geometry did not) and **changes** if one dependent is
left stale. Its control builds the same calls against a deliberately wrong order
(`1ff72181 → ab84d575` on the baseline), so the pin is not a tautology.

## What the tool does not do

- It does not choose the order; the block in the working tree is the decision.
- It does not re-author a tam whose paths cannot be permuted (no such case exists for Circle).
- It does not touch inline formation copies, `actives` tams, or alias names — it reports them.
- It does not convert more than the one formation it was asked about.
