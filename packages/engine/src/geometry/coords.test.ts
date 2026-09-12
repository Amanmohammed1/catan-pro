import { describe, it, expect } from "vitest";
import {
  AXIAL_DIRECTIONS,
  CORNER_INDICES,
  DIRECTION_INDICES,
  addAxial,
  axialToCube,
  compareAxial,
  cornerHexes,
  cubeToAxial,
  edgeCornerIndices,
  equalAxial,
  hexDistance,
  neighbor,
  neighbors,
  type Axial,
  type CornerIndex,
  type DirectionIndex,
} from "./coords.js";
import {
  axialKey,
  edgeIdAt,
  edgeIdFromNodes,
  hexesFromNodeId,
  nodeIdAt,
  nodeIdFromHexes,
  nodesFromEdgeId,
  parseAxialKey,
  tileId,
} from "./ids.js";
import { DEFAULT_LAYOUT, hexToPixel, nodeToPixel } from "./layout.js";

const ORIGIN: Axial = [0, 0];

describe("axial directions", () => {
  it("has six distinct directions", () => {
    expect(AXIAL_DIRECTIONS).toHaveLength(6);
    expect(new Set(AXIAL_DIRECTIONS.map(axialKey)).size).toBe(6);
  });

  it("has directions that cancel in opposite pairs", () => {
    for (const dir of DIRECTION_INDICES) {
      const opposite = ((dir + 3) % 6) as DirectionIndex;
      const sum = addAxial(
        AXIAL_DIRECTIONS[dir] as Axial,
        AXIAL_DIRECTIONS[opposite] as Axial,
      );
      expect(sum).toEqual([0, 0]);
    }
  });

  it("has consecutive directions that are themselves adjacent", () => {
    // This is the property cornerHexes depends on: three hexes meeting at a
    // corner are mutually adjacent.
    for (const dir of DIRECTION_INDICES) {
      const next = ((dir + 1) % 6) as DirectionIndex;
      const a = neighbor(ORIGIN, dir);
      const b = neighbor(ORIGIN, next);
      expect(hexDistance(a, b)).toBe(1);
    }
  });
});

describe("neighbors", () => {
  it("is symmetric", () => {
    const samples: Axial[] = [
      [0, 0],
      [2, -1],
      [-3, 4],
      [7, 7],
      [-5, 0],
    ];
    for (const hex of samples) {
      for (const dir of DIRECTION_INDICES) {
        const other = neighbor(hex, dir);
        expect(neighbors(other).some((n) => equalAxial(n, hex))).toBe(true);
      }
    }
  });

  it("produces six distinct neighbours at distance 1", () => {
    const ns = neighbors([3, -2]);
    expect(new Set(ns.map(axialKey)).size).toBe(6);
    for (const n of ns) {
      expect(hexDistance([3, -2], n)).toBe(1);
    }
  });

  it("rejects an out-of-range direction", () => {
    expect(() => neighbor(ORIGIN, 9 as DirectionIndex)).toThrow();
  });
});

describe("cube coordinates", () => {
  it("round trips through axial", () => {
    const samples: Axial[] = [
      [0, 0],
      [3, -1],
      [-2, 5],
    ];
    for (const hex of samples) {
      expect(cubeToAxial(axialToCube(hex))).toEqual(hex);
    }
  });

  it("sums to zero", () => {
    for (const hex of [
      [0, 0],
      [4, -7],
      [-3, 1],
    ] as Axial[]) {
      const [x, y, z] = axialToCube(hex);
      expect(x + y + z).toBe(0);
    }
  });
});

describe("hexDistance", () => {
  it("is zero to itself and one to each neighbour", () => {
    expect(hexDistance(ORIGIN, ORIGIN)).toBe(0);
    for (const n of neighbors(ORIGIN)) {
      expect(hexDistance(ORIGIN, n)).toBe(1);
    }
  });

  it("is symmetric", () => {
    expect(hexDistance([2, -3], [-1, 4])).toBe(hexDistance([-1, 4], [2, -3]));
  });
});

describe("compareAxial", () => {
  it("orders by q then r", () => {
    const sorted: Axial[] = [
      [1, 0],
      [-1, 5],
      [0, -1],
      [0, 2],
    ];
    sorted.sort(compareAxial);
    expect(sorted).toEqual([
      [-1, 5],
      [0, -1],
      [0, 2],
      [1, 0],
    ]);
  });
});

describe("cornerHexes", () => {
  it("returns three mutually adjacent hexes including the source", () => {
    for (const corner of CORNER_INDICES) {
      const [a, b, c] = cornerHexes([1, -2], corner);
      expect(a).toEqual([1, -2]);
      expect(hexDistance(a, b)).toBe(1);
      expect(hexDistance(a, c)).toBe(1);
      expect(hexDistance(b, c)).toBe(1);
    }
  });

  it("gives six distinct corners per hex", () => {
    const ids = CORNER_INDICES.map((corner) => nodeIdAt([0, 0], corner));
    expect(new Set(ids).size).toBe(6);
  });
});

describe("vertex identity", () => {
  it("is the same from all three hexes that share the corner", () => {
    const corner: CornerIndex = 2;
    const [h1, h2, h3] = cornerHexes([0, 0], corner);
    const id = nodeIdFromHexes([h1, h2, h3]);

    // Every hex at this corner must derive the identical id from its own
    // corner index. Find that index by matching the hex triple.
    for (const hex of [h1, h2, h3]) {
      const match = CORNER_INDICES.map((c) => nodeIdAt(hex, c)).filter(
        (candidate) => candidate === id,
      );
      expect(match).toHaveLength(1);
    }
  });

  it("does not depend on the order of the three hexes", () => {
    const hexes: Axial[] = [
      [0, 0],
      [1, -1],
      [1, 0],
    ];
    const permutations: Axial[][] = [
      [hexes[0]!, hexes[1]!, hexes[2]!],
      [hexes[2]!, hexes[0]!, hexes[1]!],
      [hexes[1]!, hexes[2]!, hexes[0]!],
      [hexes[2]!, hexes[1]!, hexes[0]!],
    ];
    const ids = new Set(permutations.map((p) => nodeIdFromHexes(p)));
    expect(ids.size).toBe(1);
  });

  it("round trips back to its three hexes", () => {
    const id = nodeIdAt([2, -1], 4);
    const recovered = hexesFromNodeId(id);
    expect(recovered).toHaveLength(3);
    expect(nodeIdFromHexes(recovered)).toBe(id);
  });

  it("rejects a triple of the wrong size", () => {
    expect(() => nodeIdFromHexes([[0, 0]])).toThrow();
    expect(() =>
      nodeIdFromHexes([
        [0, 0],
        [1, 0],
        [1, -1],
        [0, 1],
      ]),
    ).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() => hexesFromNodeId("e|nope")).toThrow();
    expect(() => hexesFromNodeId("v|0,0")).toThrow();
  });
});

describe("edge identity", () => {
  it("is shared by the two hexes the edge separates", () => {
    for (const dir of DIRECTION_INDICES) {
      const hex: Axial = [0, 0];
      const other = neighbor(hex, dir);
      const opposite = ((dir + 3) % 6) as DirectionIndex;
      expect(edgeIdAt(hex, dir)).toBe(edgeIdAt(other, opposite));
    }
  });

  it("does not depend on endpoint order", () => {
    const a = nodeIdAt([0, 0], 0);
    const b = nodeIdAt([0, 0], 1);
    expect(edgeIdFromNodes(a, b)).toBe(edgeIdFromNodes(b, a));
  });

  it("gives six distinct edges per hex", () => {
    const ids = DIRECTION_INDICES.map((dir) => edgeIdAt([0, 0], dir));
    expect(new Set(ids).size).toBe(6);
  });

  it("round trips to its two endpoints", () => {
    const id = edgeIdAt([1, 1], 3);
    const [a, b] = nodesFromEdgeId(id);
    expect(a).not.toBe(b);
    expect(edgeIdFromNodes(a, b)).toBe(id);
  });

  it("endpoints match the two corners flanking the direction", () => {
    for (const dir of DIRECTION_INDICES) {
      const [ca, cb] = edgeCornerIndices(dir);
      const expected = new Set([nodeIdAt([0, 0], ca), nodeIdAt([0, 0], cb)]);
      const actual = new Set(nodesFromEdgeId(edgeIdAt([0, 0], dir)));
      expect(actual).toEqual(expected);
    }
  });

  it("rejects a degenerate edge", () => {
    const a = nodeIdAt([0, 0], 0);
    expect(() => edgeIdFromNodes(a, a)).toThrow();
  });
});

describe("tileId and axial keys", () => {
  it("round trips", () => {
    expect(parseAxialKey(axialKey([-3, 7]))).toEqual([-3, 7]);
  });

  it("is distinct per coordinate", () => {
    expect(tileId([1, 2])).not.toBe(tileId([2, 1]));
  });

  it("rejects malformed keys", () => {
    expect(() => parseAxialKey("1")).toThrow();
    expect(() => parseAxialKey("1,2,3")).toThrow();
    expect(() => parseAxialKey("a,b")).toThrow();
    expect(() => parseAxialKey("1.5,2")).toThrow();
  });
});

describe("layout is render-only", () => {
  it("places a vertex at the centroid of its three hexes", () => {
    const id = nodeIdAt([0, 0], 0);
    const hexes = hexesFromNodeId(id);
    const centres = hexes.map((h) => hexToPixel(DEFAULT_LAYOUT, h));
    const expectedX = centres.reduce((sum, c) => sum + c[0], 0) / 3;
    const expectedY = centres.reduce((sum, c) => sum + c[1], 0) / 3;

    const [x, y] = nodeToPixel(DEFAULT_LAYOUT, id);
    expect(x).toBeCloseTo(expectedX, 12);
    expect(y).toBeCloseTo(expectedY, 12);
  });

  it("puts every vertex exactly one hex size from each of its three centres", () => {
    // Confirms the centroid really is the shared corner.
    const id = nodeIdAt([2, -1], 3);
    const [vx, vy] = nodeToPixel(DEFAULT_LAYOUT, id);
    for (const hex of hexesFromNodeId(id)) {
      const [cx, cy] = hexToPixel(DEFAULT_LAYOUT, hex);
      const distance = Math.hypot(vx - cx, vy - cy);
      expect(distance).toBeCloseTo(DEFAULT_LAYOUT.size, 10);
    }
  });

  it("leaves vertex ids unchanged when the layout changes", () => {
    // The regression test for ADR 0001. Identity must not follow the renderer.
    const before = CORNER_INDICES.map((c) => nodeIdAt([1, -1], c));
    const after = CORNER_INDICES.map((c) => nodeIdAt([1, -1], c));
    expect(after).toEqual(before);

    const big = { ...DEFAULT_LAYOUT, size: 97.5, origin: [12, -40] as const };
    const flat = { ...DEFAULT_LAYOUT, orientation: "flat" as const };

    // Positions move...
    expect(nodeToPixel(big, before[0]!)).not.toEqual(
      nodeToPixel(DEFAULT_LAYOUT, before[0]!),
    );
    expect(nodeToPixel(flat, before[0]!)).not.toEqual(
      nodeToPixel(DEFAULT_LAYOUT, before[0]!),
    );
    // ...ids do not.
    expect(CORNER_INDICES.map((c) => nodeIdAt([1, -1], c))).toEqual(before);
  });
});
