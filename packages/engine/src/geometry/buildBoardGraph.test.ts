import { describe, it, expect } from "vitest";
import { buildBoardGraph, ScenarioError } from "./buildBoardGraph.js";
import { seedRng } from "../rng/sfc32.js";
import { axialKey, tileId } from "./ids.js";
import { neighbors, type Axial } from "./coords.js";
import type { Scenario, ScenarioCell, Terrain } from "../scenario/types.js";

/**
 * These tests use synthetic scenarios built in the file, never the real data in
 * packages/scenarios. That keeps the engine a leaf with no test-only dependency
 * on the package that depends on it; the classic board's acceptance numbers are
 * asserted over in packages/scenarios, where that data lives.
 */

function scenario(partial: {
  cells: readonly ScenarioCell[];
  sequence?: readonly number[];
  path?: readonly Axial[];
  bags?: Scenario["bags"];
  ports?: Scenario["ports"];
  noAdjacentRed?: boolean;
}): Scenario {
  const numbered = partial.cells.filter(
    (c) => c.slot === "land" && c.terrain !== "desert",
  );
  return {
    id: "synthetic",
    name: "Synthetic",
    schemaVersion: 1,
    players: { min: 3, max: 4 },
    victoryPoints: 10,
    modules: ["base"],
    layout: { orientation: "pointy" },
    cells: partial.cells,
    bags: partial.bags ?? {},
    numbers: {
      mode: "path",
      sequence: partial.sequence ?? numbered.map((_, i) => (i % 10) + 2),
      path: partial.path ?? partial.cells.map((c) => c.coord),
      skipTerrains: ["desert", "sea"],
      ...(partial.noAdjacentRed === true
        ? { constraints: { noAdjacentRedNumbers: true } }
        : {}),
    },
    ports: partial.ports ?? [],
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [],
    hiddenStacks: [],
    startingPieces: [],
  };
}

function land(coord: Axial, terrain: Terrain = "forest"): ScenarioCell {
  return { coord, slot: "land", terrain };
}

function sea(coord: Axial): ScenarioCell {
  return { coord, slot: "sea", terrain: "sea" };
}

function build(s: Scenario, seed = "test") {
  return buildBoardGraph(s, seedRng(seed));
}

describe("board size", () => {
  const sizeCases: { label: string; cells: Axial[]; nodes: number; edges: number }[] = [
    { label: "a single hex", cells: [[0, 0]], nodes: 6, edges: 6 },
    {
      label: "two adjacent hexes",
      cells: [
        [0, 0],
        [1, 0],
      ],
      nodes: 10,
      edges: 11,
    },
    {
      label: "a mutually adjacent triangle",
      cells: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      nodes: 13,
      edges: 15,
    },
  ];

  it.each(sizeCases)(
    "$label yields $nodes nodes and $edges edges",
    ({ cells, nodes, edges }) => {
      const { board } = build(scenario({ cells: cells.map((c) => land(c)) }));
      expect(Object.keys(board.tiles)).toHaveLength(cells.length);
      expect(Object.keys(board.nodes)).toHaveLength(nodes);
      expect(Object.keys(board.edges)).toHaveLength(edges);
    },
  );

  it("shares corners rather than duplicating them", () => {
    // Two hexes share exactly two corners: 12 corner slots, 10 distinct nodes.
    const { board } = build(scenario({ cells: [land([0, 0]), land([1, 0])] }));
    const shared = Object.values(board.nodes).filter((n) => n.tiles.length === 2);
    expect(shared).toHaveLength(2);
  });
});

describe("graph invariants", () => {
  const disc: Axial[] = [];
  for (let q = -1; q <= 1; q++) {
    for (let r = Math.max(-1, -q - 1); r <= Math.min(1, -q + 1); r++) {
      disc.push([q, r]);
    }
  }
  const { board } = build(scenario({ cells: disc.map((c) => land(c)) }));

  it("builds the expected radius-1 board", () => {
    expect(Object.keys(board.tiles)).toHaveLength(7);
    expect(Object.keys(board.nodes)).toHaveLength(24);
    expect(Object.keys(board.edges)).toHaveLength(30);
  });

  it("gives every edge exactly two distinct endpoints", () => {
    for (const edge of Object.values(board.edges)) {
      expect(edge.nodes).toHaveLength(2);
      expect(edge.nodes[0]).not.toBe(edge.nodes[1]);
      expect(board.nodes[edge.nodes[0]]).toBeDefined();
      expect(board.nodes[edge.nodes[1]]).toBeDefined();
    }
  });

  it("gives every node between one and three adjacent tiles", () => {
    for (const node of Object.values(board.nodes)) {
      expect(node.tiles.length).toBeGreaterThanOrEqual(1);
      expect(node.tiles.length).toBeLessThanOrEqual(3);
    }
  });

  it("gives every edge one or two adjacent tiles", () => {
    for (const edge of Object.values(board.edges)) {
      expect(edge.tiles.length).toBeGreaterThanOrEqual(1);
      expect(edge.tiles.length).toBeLessThanOrEqual(2);
    }
  });

  it("is symmetric between edges and their endpoints", () => {
    for (const edge of Object.values(board.edges)) {
      for (const nodeId of edge.nodes) {
        expect(board.nodes[nodeId]?.edges).toContain(edge.id);
      }
    }
    for (const node of Object.values(board.nodes)) {
      for (const edgeId of node.edges) {
        expect(board.edges[edgeId]?.nodes).toContain(node.id);
      }
    }
  });

  it("is symmetric between adjacent nodes", () => {
    for (const node of Object.values(board.nodes)) {
      for (const other of node.nodes) {
        expect(board.nodes[other]?.nodes).toContain(node.id);
      }
      expect(node.nodes).not.toContain(node.id);
    }
  });

  it("is symmetric between tiles and their corners and edges", () => {
    for (const tile of Object.values(board.tiles)) {
      expect(tile.nodes).toHaveLength(6);
      expect(tile.edges).toHaveLength(6);
      expect(new Set(tile.nodes).size).toBe(6);
      expect(new Set(tile.edges).size).toBe(6);

      for (const nodeId of tile.nodes) {
        expect(board.nodes[nodeId]?.tiles).toContain(tile.id);
      }
      for (const edgeId of tile.edges) {
        expect(board.edges[edgeId]?.tiles).toContain(tile.id);
      }
    }
  });

  it("references only ids that exist", () => {
    const nodeIds = new Set(Object.keys(board.nodes));
    const edgeIds = new Set(Object.keys(board.edges));
    const tileIds = new Set(Object.keys(board.tiles));

    for (const node of Object.values(board.nodes)) {
      for (const t of node.tiles) expect(tileIds.has(t)).toBe(true);
      for (const e of node.edges) expect(edgeIds.has(e)).toBe(true);
      for (const n of node.nodes) expect(nodeIds.has(n)).toBe(true);
    }
    for (const edge of Object.values(board.edges)) {
      for (const t of edge.tiles) expect(tileIds.has(t)).toBe(true);
    }
  });

  it("agrees with the coordinate neighbour relation", () => {
    for (const tile of Object.values(board.tiles)) {
      const expected = neighbors(tile.coord)
        .map((n) => tileId(n))
        .filter((id) => board.tiles[id] !== undefined);

      const viaEdges = new Set<string>();
      for (const edgeId of tile.edges) {
        for (const other of board.edges[edgeId]?.tiles ?? []) {
          if (other !== tile.id) viaEdges.add(other);
        }
      }
      expect([...viaEdges].sort()).toEqual([...expected].sort());
    }
  });
});

describe("edge classification", () => {
  // A land triangle fully enclosed by sea: the only shape with all three kinds.
  const core: Axial[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
  const ring = new Map<string, Axial>();
  for (const hex of core) {
    for (const n of neighbors(hex)) {
      if (!core.some((c) => axialKey(c) === axialKey(n))) {
        ring.set(axialKey(n), n);
      }
    }
  }

  const { board } = build(
    scenario({
      cells: [...core.map((c) => land(c)), ...[...ring.values()].map((c) => sea(c))],
      sequence: [5, 9, 4],
      path: core,
    }),
  );

  it("classifies land, coast and sea edges", () => {
    const counts: Record<string, number> = {};
    for (const edge of Object.values(board.edges)) {
      counts[edge.kind] = (counts[edge.kind] ?? 0) + 1;
    }
    // Independently recomputed: 3 interior land edges, 12 coastline, 33 sea.
    expect(counts).toEqual({ land: 3, coast: 12, sea: 33 });
  });

  it("marks an edge coast exactly when it divides land from sea", () => {
    for (const edge of Object.values(board.edges)) {
      const slots = edge.tiles.map((t) => board.tiles[t]?.slot);
      const hasLand = slots.includes("land");
      const hasSea = slots.includes("sea");
      if (hasLand && hasSea) expect(edge.kind).toBe("coast");
      else if (hasSea) expect(edge.kind).toBe("sea");
      else expect(edge.kind).toBe("land");
    }
  });

  it("treats a board with no sea cells as entirely land", () => {
    const { board: allLand } = build(scenario({ cells: core.map((c) => land(c)) }));
    for (const edge of Object.values(allLand.edges)) {
      expect(edge.kind).toBe("land");
    }
  });
});

describe("disjoint boards", () => {
  it("builds two islands that share nothing", () => {
    const { board } = build(
      scenario({
        cells: [land([0, 0]), land([1, 0]), land([6, 0]), land([7, 0])],
      }),
    );
    expect(Object.keys(board.tiles)).toHaveLength(4);
    expect(Object.keys(board.nodes)).toHaveLength(20);
    expect(Object.keys(board.edges)).toHaveLength(22);

    // No node touches tiles from both clusters.
    for (const node of Object.values(board.nodes)) {
      const qs = node.tiles.map((t) => board.tiles[t]?.coord[0] ?? 0);
      const spansGap = Math.max(...qs) - Math.min(...qs) > 2;
      expect(spansGap).toBe(false);
    }
  });
});

describe("terrain and numbers", () => {
  const cells: ScenarioCell[] = [
    { coord: [0, 0], slot: "land" },
    { coord: [1, 0], slot: "land" },
    { coord: [0, 1], slot: "land" },
    { coord: [1, 1], slot: "land" },
  ];
  const bags: Scenario["bags"] = {
    land: {
      terrain: [
        { terrain: "forest", count: 1 },
        { terrain: "hill", count: 1 },
        { terrain: "field", count: 1 },
        { terrain: "desert", count: 1 },
      ],
    },
  };

  it("deals exactly the bag contents", () => {
    const { board } = build(scenario({ cells, bags, sequence: [3, 4, 5] }));
    const dealt = Object.values(board.tiles)
      .map((t) => t.terrain)
      .sort();
    expect(dealt).toEqual(["desert", "field", "forest", "hill"]);
  });

  it("leaves the desert without a number and numbers everything else", () => {
    const { board } = build(scenario({ cells, bags, sequence: [3, 4, 5] }));
    for (const tile of Object.values(board.tiles)) {
      if (tile.terrain === "desert") expect(tile.number).toBeNull();
      else expect(tile.number).not.toBeNull();
    }
    const placed = Object.values(board.tiles)
      .map((t) => t.number)
      .filter((n): n is number => n !== null)
      .sort();
    expect(placed).toEqual([3, 4, 5]);
  });

  it("gives sea cells no number", () => {
    const { board } = build(
      scenario({
        cells: [land([0, 0]), sea([1, 0])],
        sequence: [6],
        path: [[0, 0]],
      }),
    );
    expect(board.tiles[tileId([1, 0])]?.number).toBeNull();
  });

  it("honours a pinned number", () => {
    const { board } = build(
      scenario({
        cells: [
          { coord: [0, 0], slot: "land", terrain: "forest", number: 11 },
          land([1, 0], "hill"),
        ],
        sequence: [4],
      }),
    );
    expect(board.tiles[tileId([0, 0])]?.number).toBe(11);
    expect(board.tiles[tileId([1, 0])]?.number).toBe(4);
  });

  it("keeps red numbers apart when the constraint is set", () => {
    const disc: Axial[] = [];
    for (let q = -1; q <= 1; q++) {
      for (let r = Math.max(-1, -q - 1); r <= Math.min(1, -q + 1); r++) {
        disc.push([q, r]);
      }
    }
    const s = scenario({
      cells: disc.map((c) => ({ coord: c, slot: "land" as const })),
      bags: {
        land: {
          terrain: [
            { terrain: "forest", count: 2 },
            { terrain: "hill", count: 2 },
            { terrain: "field", count: 2 },
            { terrain: "desert", count: 1 },
          ],
        },
      },
      sequence: [6, 8, 5, 9, 10, 4],
      noAdjacentRed: true,
    });

    const { board } = build(s, "red-constraint");
    for (const tile of Object.values(board.tiles)) {
      if (tile.number !== 6 && tile.number !== 8) continue;
      for (const n of neighbors(tile.coord)) {
        const other = board.tiles[tileId(n)];
        if (other === undefined || other.number === null) continue;
        expect([6, 8]).not.toContain(other.number);
      }
    }
  });

  it("fails loudly when the red-number constraint cannot be satisfied", () => {
    // A radius-1 disc is a 6-cycle around a centre adjacent to all of it, so at
    // most three tiles can be pairwise non-adjacent. Asking for four reds is
    // impossible, and the builder must say so rather than spin or place them
    // anyway.
    const disc: Axial[] = [];
    for (let q = -1; q <= 1; q++) {
      for (let r = Math.max(-1, -q - 1); r <= Math.min(1, -q + 1); r++) {
        disc.push([q, r]);
      }
    }
    const impossible = scenario({
      cells: disc.map((c) => ({ coord: c, slot: "land" as const })),
      bags: {
        land: {
          terrain: [
            { terrain: "forest", count: 2 },
            { terrain: "hill", count: 2 },
            { terrain: "field", count: 2 },
            { terrain: "desert", count: 1 },
          ],
        },
      },
      sequence: [6, 8, 6, 8, 5, 9],
      noAdjacentRed: true,
    });

    expect(() => build(impossible, "impossible")).toThrow(ScenarioError);
    expect(() => build(impossible, "impossible")).toThrow(/red-number/);
  });
});

describe("ports", () => {
  const cells = [land([0, 0]), land([1, 0])];

  it("resolves to an existing edge and its two endpoints", () => {
    const { board } = build(
      scenario({
        cells,
        sequence: [3, 4],
        ports: [
          { at: [0, 0], edgeDir: 3, kind: "generic", ratio: 3 },
          { at: [1, 0], edgeDir: 0, kind: "resource", resource: "ore", ratio: 2 },
        ],
      }),
    );

    const ports = Object.values(board.ports);
    expect(ports).toHaveLength(2);

    for (const port of ports) {
      expect(board.edges[port.edge]).toBeDefined();
      expect(port.nodes).toHaveLength(2);
      for (const nodeId of port.nodes) {
        expect(board.nodes[nodeId]).toBeDefined();
        expect(board.nodes[nodeId]?.port).toBe(port.id);
      }
      expect(board.edges[port.edge]?.nodes.slice().sort()).toEqual(
        port.nodes.slice().sort(),
      );
    }
  });

  it("records the resource only for resource ports", () => {
    const { board } = build(
      scenario({
        cells,
        sequence: [3, 4],
        ports: [
          { at: [0, 0], edgeDir: 3, kind: "generic", ratio: 3 },
          { at: [1, 0], edgeDir: 0, kind: "resource", resource: "ore", ratio: 2 },
        ],
      }),
    );
    const generic = Object.values(board.ports).find((p) => p.kind === "generic");
    const specific = Object.values(board.ports).find((p) => p.kind === "resource");
    expect(generic?.resource).toBeNull();
    expect(generic?.ratio).toBe(3);
    expect(specific?.resource).toBe("ore");
    expect(specific?.ratio).toBe(2);
  });

  it("leaves nodes without a port null", () => {
    const { board } = build(scenario({ cells, sequence: [3, 4] }));
    for (const node of Object.values(board.nodes)) {
      expect(node.port).toBeNull();
    }
  });

  it("rejects a port anchored off the board", () => {
    expect(() =>
      build(
        scenario({
          cells,
          sequence: [3, 4],
          ports: [{ at: [9, 9], edgeDir: 0, kind: "generic", ratio: 3 }],
        }),
      ),
    ).toThrow(ScenarioError);
  });

  it("rejects a resource port with no resource", () => {
    expect(() =>
      build(
        scenario({
          cells,
          sequence: [3, 4],
          ports: [{ at: [0, 0], edgeDir: 3, kind: "resource", ratio: 2 }],
        }),
      ),
    ).toThrow(ScenarioError);
  });
});

describe("determinism", () => {
  const disc: Axial[] = [];
  for (let q = -1; q <= 1; q++) {
    for (let r = Math.max(-1, -q - 1); r <= Math.min(1, -q + 1); r++) {
      disc.push([q, r]);
    }
  }
  const s = scenario({
    cells: disc.map((c) => ({ coord: c, slot: "land" as const })),
    bags: {
      land: {
        terrain: [
          { terrain: "forest", count: 2 },
          { terrain: "hill", count: 2 },
          { terrain: "field", count: 2 },
          { terrain: "desert", count: 1 },
        ],
      },
    },
    sequence: [3, 4, 5, 6, 9, 10],
  });

  it("produces a byte-identical board for the same seed", () => {
    const a = buildBoardGraph(s, seedRng("same-seed")).board;
    const b = buildBoardGraph(s, seedRng("same-seed")).board;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different board for a different seed", () => {
    const a = buildBoardGraph(s, seedRng("seed-a")).board;
    const b = buildBoardGraph(s, seedRng("seed-b")).board;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("keeps topology identical across seeds, changing only content", () => {
    const a = buildBoardGraph(s, seedRng("seed-a")).board;
    const b = buildBoardGraph(s, seedRng("seed-b")).board;
    expect(Object.keys(a.nodes)).toEqual(Object.keys(b.nodes));
    expect(Object.keys(a.edges)).toEqual(Object.keys(b.edges));
    expect(Object.keys(a.tiles)).toEqual(Object.keys(b.tiles));
  });

  it("advances the rng state it was given", () => {
    const start = seedRng("advance");
    const { rng } = buildBoardGraph(s, start);
    expect(rng).not.toEqual(start);
  });

  it("serializes with sorted keys so output is stable", () => {
    const { board } = buildBoardGraph(s, seedRng("sorted"));
    for (const record of [board.tiles, board.nodes, board.edges]) {
      const keys = Object.keys(record);
      expect(keys).toEqual([...keys].sort());
    }
  });
});

describe("scenario errors", () => {
  it("rejects duplicate cells", () => {
    expect(() =>
      build(scenario({ cells: [land([0, 0]), land([0, 0])], sequence: [3, 4] })),
    ).toThrow(ScenarioError);
  });

  it("rejects an empty board", () => {
    expect(() => build(scenario({ cells: [], sequence: [] }))).toThrow(ScenarioError);
  });

  it("rejects a missing bag", () => {
    expect(() =>
      build(
        scenario({
          cells: [{ coord: [0, 0], slot: "land" }],
          sequence: [3],
        }),
      ),
    ).toThrow(ScenarioError);
  });

  it("rejects a bag whose size does not match the cells drawing from it", () => {
    expect(() =>
      build(
        scenario({
          cells: [
            { coord: [0, 0], slot: "land" },
            { coord: [1, 0], slot: "land" },
          ],
          bags: { land: { terrain: [{ terrain: "forest", count: 1 }] } },
          sequence: [3, 4],
        }),
      ),
    ).toThrow(ScenarioError);
  });

  it("rejects a number path that leaves the board", () => {
    expect(() =>
      build(
        scenario({
          cells: [land([0, 0])],
          sequence: [3],
          path: [[5, 5]],
        }),
      ),
    ).toThrow(ScenarioError);
  });

  it("rejects a sequence that is too short or too long", () => {
    expect(() =>
      build(scenario({ cells: [land([0, 0]), land([1, 0])], sequence: [3] })),
    ).toThrow(ScenarioError);
    expect(() => build(scenario({ cells: [land([0, 0])], sequence: [3, 4] }))).toThrow(
      ScenarioError,
    );
  });
});
