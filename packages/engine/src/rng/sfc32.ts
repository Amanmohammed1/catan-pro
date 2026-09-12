/**
 * sfc32 — "Small Fast Counter", 32-bit variant.
 *
 * CLAUDE.md golden rule 4: all randomness comes from a seeded PRNG stored inside
 * GameState, and the same seed plus the same action list must produce a
 * byte-identical state. That forces two properties on this module:
 *
 *   1. The state is plain data — four unsigned 32-bit integers — so it
 *      serializes into GameState and survives a JSON round trip unchanged.
 *   2. Every function is pure. Nothing here mutates; each draw returns the value
 *      alongside the next state, and the caller threads it. A mutating generator
 *      would make reducers impure and replays unreproducible.
 *
 * The dice-fairness scheme in CLAUDE.md depends on this too: the server publishes
 * sha256(seed) at game start and reveals the seed at the end, so anyone can
 * replay the stream and verify every roll.
 */

/** Four unsigned 32-bit words. Plain data, safe to serialize into GameState. */
export type RngState = readonly [number, number, number, number];

/** Number of outputs discarded after seeding to wash out seed correlation. */
const WARMUP_ROUNDS = 12;

/**
 * cyrb128 string hash — expands an arbitrary seed string into four well-mixed
 * 32-bit words. A weak seed expansion leaves visible structure in the first
 * outputs, which is exactly what a player inspecting early dice rolls would see.
 */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** One sfc32 round. Returns the drawn word and the successor state. */
function step(state: RngState): readonly [number, RngState] {
  let [a, b, c, d] = state;

  a |= 0;
  b |= 0;
  c |= 0;
  d |= 0;

  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;

  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]] as const;
}

/** Derive an initial generator state from a seed string. */
export function seedRng(seed: string): RngState {
  let state: RngState = hashSeed(seed);
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    state = step(state)[1];
  }
  return state;
}

/** Draw one unsigned 32-bit integer. Returns the value and the next state. */
export function nextU32(state: RngState): readonly [number, RngState] {
  return step(state);
}

/** Draw a float in [0, 1). */
export function nextFloat(state: RngState): readonly [number, RngState] {
  const [value, next] = step(state);
  return [value / 0x100000000, next] as const;
}

/**
 * Draw an integer in [0, maxExclusive).
 *
 * Uses rejection sampling rather than a modulo, because modulo bias is visible
 * over the tens of thousands of draws a fuzz run makes and would quietly skew
 * tile bags and dice.
 */
export function nextInt(
  state: RngState,
  maxExclusive: number,
): readonly [number, RngState] {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError(
      `nextInt requires a positive integer range, received ${String(maxExclusive)}`,
    );
  }

  if (maxExclusive === 1) {
    return [0, step(state)[1]] as const;
  }

  // Largest multiple of maxExclusive that fits in 32 bits; draws at or above
  // this threshold are rejected so every residue is equally likely.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;

  let current = state;
  for (;;) {
    const [value, next] = step(current);
    current = next;
    if (value < limit) {
      return [value % maxExclusive, current] as const;
    }
  }
}

/**
 * Fisher-Yates shuffle. Returns a new array; the input is never touched.
 *
 * Used for tile bags, number tokens and, later, the development card deck —
 * anything whose order must be reproducible from the seed alone.
 */
export function shuffle<T>(
  state: RngState,
  items: readonly T[],
): readonly [T[], RngState] {
  const out = [...items];
  let current = state;

  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(current, i + 1);
    current = next;
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }

  return [out, current] as const;
}
