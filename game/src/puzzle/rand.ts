// A seeded pseudo-random source, and nothing else.
//
// WHY THIS IS HERE AND NOT IN THE ENGINE. The engine's nondeterminism seam is `config.rand`, an
// INJECTABLE source for its probabilistic variant selection — a hook, not a generator. A puzzle,
// though, must be reproducible from its seed alone (DESIGN.md 7: "pure and deterministic in
// `(seed, levelSpec, poolVersion)`"), because a leaderboard entry is verified by the server
// REGENERATING the puzzle and replaying the run. Two calls with the same seed must pick the same
// candidate, shuffle the options the same way and choose the same `unknown` call, on any machine.
//
// mulberry32 rather than a new dependency: it is nine lines, it has no state beyond one uint32, and
// AGENTS.md 4.5 asks for a reason that survives review before a dependency is added. Its quality is
// irrelevant here — this is not cryptography and not a simulation, it is a reproducibility device.

export interface Rng {
  /** The next uint32. */
  next(): number;
  /** An integer in `[0, n)`. */
  int(n: number): number;
  /** A shuffled COPY of `xs`, Fisher-Yates, from this rng. */
  shuffle<T>(xs: readonly T[]): T[];
  /** One element, or `undefined` for an empty list. */
  pick<T>(xs: readonly T[]): T | undefined;
}

/**
 * A deterministic generator for `seed`.
 *
 * `>>> 0` on every step is load-bearing rather than decoration: JavaScript's `*` produces a float, and
 * without the unsigned coercion the multiply overflows into a magnitude that changes with the
 * arithmetic's rounding — so the same seed would not give the same stream, which is the one property
 * this whole file exists to provide.
 */
export function rngFrom(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const int = (n: number): number => (n <= 0 ? 0 : next() % n);
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, shuffle, pick: <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[int(xs.length)] : undefined) };
}
