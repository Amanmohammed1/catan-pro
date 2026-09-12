import { describe, it, expect } from "vitest";
import {
  seedRng,
  nextU32,
  nextFloat,
  nextInt,
  shuffle,
  type RngState,
} from "./sfc32.js";

describe("seedRng", () => {
  it("is a pure function of the seed string", () => {
    expect(seedRng("heading-for-new-shores")).toEqual(
      seedRng("heading-for-new-shores"),
    );
  });

  it("produces different state for different seeds", () => {
    expect(seedRng("a")).not.toEqual(seedRng("b"));
  });

  it("produces four 32-bit unsigned integers", () => {
    const state = seedRng("classic");
    expect(state).toHaveLength(4);
    for (const word of state) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("is sensitive to a single character change", () => {
    expect(seedRng("seed-0001")).not.toEqual(seedRng("seed-0002"));
  });
});

describe("nextU32", () => {
  it("never mutates the state it is given", () => {
    const state = seedRng("immutability");
    const before = [...state];
    nextU32(state);
    expect([...state]).toEqual(before);
  });

  it("returns unsigned 32-bit values", () => {
    let state = seedRng("range");
    for (let i = 0; i < 1000; i++) {
      const [value, next] = nextU32(state);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
      state = next;
    }
  });

  it("produces an identical stream from an identical seed", () => {
    const draw = (seed: string, n: number): number[] => {
      let state = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const [value, next] = nextU32(state);
        out.push(value);
        state = next;
      }
      return out;
    };
    expect(draw("determinism", 200)).toEqual(draw("determinism", 200));
    expect(draw("determinism", 200)).not.toEqual(draw("determinism-x", 200));
  });

  it("does not repeat itself over a short horizon", () => {
    let state = seedRng("cycle");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const [value, next] = nextU32(state);
      seen.add(value);
      state = next;
    }
    // A 32-bit generator should have essentially no collisions in 5000 draws.
    expect(seen.size).toBeGreaterThan(4990);
  });
});

describe("state serialization", () => {
  it("survives a JSON round trip and resumes the same stream", () => {
    let state = seedRng("persistence");
    for (let i = 0; i < 37; i++) {
      state = nextU32(state)[1];
    }

    const revived = JSON.parse(JSON.stringify(state)) as RngState;
    expect(revived).toEqual(state);

    const fromOriginal: number[] = [];
    const fromRevived: number[] = [];
    let a = state;
    let b = revived;
    for (let i = 0; i < 50; i++) {
      const [va, na] = nextU32(a);
      const [vb, nb] = nextU32(b);
      fromOriginal.push(va);
      fromRevived.push(vb);
      a = na;
      b = nb;
    }
    expect(fromRevived).toEqual(fromOriginal);
  });
});

describe("nextFloat", () => {
  it("stays in [0, 1)", () => {
    let state = seedRng("floats");
    for (let i = 0; i < 2000; i++) {
      const [value, next] = nextFloat(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it("has a mean near 0.5 over many draws", () => {
    let state = seedRng("uniformity");
    let total = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const [value, next] = nextFloat(state);
      total += value;
      state = next;
    }
    expect(total / n).toBeGreaterThan(0.48);
    expect(total / n).toBeLessThan(0.52);
  });
});

describe("nextInt", () => {
  it("stays within [0, maxExclusive)", () => {
    let state = seedRng("ints");
    for (let i = 0; i < 2000; i++) {
      const [value, next] = nextInt(state, 6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      expect(Number.isInteger(value)).toBe(true);
      state = next;
    }
  });

  it("reaches every value in a small range", () => {
    let state = seedRng("coverage");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const [value, next] = nextInt(state, 6);
      seen.add(value);
      state = next;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("returns 0 for a range of 1", () => {
    const [value] = nextInt(seedRng("degenerate"), 1);
    expect(value).toBe(0);
  });

  it("rejects a non-positive range", () => {
    expect(() => nextInt(seedRng("bad"), 0)).toThrow();
    expect(() => nextInt(seedRng("bad"), -3)).toThrow();
  });
});

describe("shuffle", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  it("does not mutate the input array", () => {
    const input = [...items];
    shuffle(seedRng("nomutate"), input);
    expect(input).toEqual([...items]);
  });

  it("is a permutation", () => {
    const [out] = shuffle(seedRng("permutation"), items);
    expect([...out].sort((a, b) => a - b)).toEqual([...items]);
  });

  it("is deterministic for a given seed", () => {
    const [a] = shuffle(seedRng("same"), items);
    const [b] = shuffle(seedRng("same"), items);
    expect(a).toEqual(b);
  });

  it("differs for different seeds", () => {
    const [a] = shuffle(seedRng("one"), items);
    const [b] = shuffle(seedRng("two"), items);
    expect(a).not.toEqual(b);
  });

  it("advances the state so successive shuffles differ", () => {
    const [first, afterFirst] = shuffle(seedRng("advance"), items);
    const [second] = shuffle(afterFirst, items);
    expect(second).not.toEqual(first);
  });

  it("handles empty and single-element inputs", () => {
    expect(shuffle(seedRng("empty"), [])[0]).toEqual([]);
    expect(shuffle(seedRng("single"), ["only"])[0]).toEqual(["only"]);
  });
});
