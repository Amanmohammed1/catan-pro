import { describe, it, expect } from "vitest";
import { buildBoardGraph, seedRng, neighbors, tileId } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * M0 acceptance criteria for the classic board.
 *
 * These live here rather than in the engine because they assert facts about the
 * scenario *data* as much as about the builder. The engine's own tests use
 * synthetic boards so it stays a leaf with no dependency on this package.
 */

const scenario = loadScenario("classic-3-4");
const { board } = buildBoardGraph(scenario, seedRng("acceptance"));

describe("classic board size", () => {
  it("has 19 tiles, 54 nodes and 72 edges", () => {
    expect(Object.keys(board.tiles)).toHaveLength(19);
    expect(Object.keys(board.nodes)).toHaveLength(54);
    expect(Object.keys(board.edges)).toHaveLength(72);
  });

  it("has 9 ports", () => {
    expect(Object.keys(board.ports)).toHaveLength(9);
  });
});

describe("classic board adjacency", () => {
  it("gives every node between one and three adjacent tiles", () => {
    for (const node of Object.values(board.nodes)) {
      expect(node.tiles.length).toBeGreaterThanOrEqual(1);
      expect(node.tiles.length).toBeLessThanOrEqual(3);
    }
  });

  it("has the exact rim and interior node distribution", () => {
    // Independently recomputed, and worth pinning exactly rather than as a
    // range. Note this contradicts the "every node has 2-3 adjacent tiles" line
    // in PLAN.md: a bare 19-tile board with no surrounding sea frame has 18 rim
    // nodes touching exactly one tile. Adding a sea ring in M6 turns all 54 of
    // these into 3-cell nodes; until then, 1 is correct and expected.
    const distribution: Record<number, number> = {};
    for (const node of Object.values(board.nodes)) {
      distribution[node.tiles.length] = (distribution[node.tiles.length] ?? 0) + 1;
    }
    expect(distribution).toEqual({ 1: 18, 2: 12, 3: 24 });
  });

  it("gives every edge exactly two distinct endpoints that exist", () => {
    for (const edge of Object.values(board.edges)) {
      expect(edge.nodes).toHaveLength(2);
      expect(edge.nodes[0]).not.toBe(edge.nodes[1]);
      expect(board.nodes[edge.nodes[0]]).toBeDefined();
      expect(board.nodes[edge.nodes[1]]).toBeDefined();
    }
  });

  it("is symmetric in every direction", () => {
    for (const edge of Object.values(board.edges)) {
      for (const nodeId of edge.nodes) {
        expect(board.nodes[nodeId]?.edges).toContain(edge.id);
      }
      for (const tile of edge.tiles) {
        expect(board.tiles[tile]?.edges).toContain(edge.id);
      }
    }
    for (const node of Object.values(board.nodes)) {
      for (const other of node.nodes) {
        expect(board.nodes[other]?.nodes).toContain(node.id);
      }
      for (const tile of node.tiles) {
        expect(board.tiles[tile]?.nodes).toContain(node.id);
      }
    }
    for (const tile of Object.values(board.tiles)) {
      for (const nodeId of tile.nodes) {
        expect(board.nodes[nodeId]?.tiles).toContain(tile.id);
      }
      for (const edgeId of tile.edges) {
        expect(board.edges[edgeId]?.tiles).toContain(tile.id);
      }
    }
  });

  it("has 30 boundary edges bordering a single tile", () => {
    const boundary = Object.values(board.edges).filter((e) => e.tiles.length === 1);
    expect(boundary).toHaveLength(30);
  });
});

describe("classic board content", () => {
  it("deals exactly the tile bag", () => {
    const counts: Record<string, number> = {};
    for (const tile of Object.values(board.tiles)) {
      counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
    }
    expect(counts).toEqual({
      forest: 4,
      pasture: 4,
      field: 4,
      hill: 3,
      mountain: 3,
      desert: 1,
    });
  });

  it("places 18 number tokens and leaves the desert bare", () => {
    const numbered = Object.values(board.tiles).filter((t) => t.number !== null);
    expect(numbered).toHaveLength(18);

    const desert = Object.values(board.tiles).filter((t) => t.terrain === "desert");
    expect(desert).toHaveLength(1);
    expect(desert[0]?.number).toBeNull();
  });

  it("places exactly the intended token multiset", () => {
    // The classic board lays the lettered A-R tokens in their printed order,
    // so the sequence is the multiset. (The 5-6 board draws from a bag.)
    expect(scenario.numbers.mode).toBe("path");
    if (scenario.numbers.mode !== "path") return;

    const placed = Object.values(board.tiles)
      .map((t) => t.number)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    const expected = [...scenario.numbers.sequence].sort((a, b) => a - b);
    expect(placed).toEqual(expected);
  });

  it("never puts a 6 next to an 8", () => {
    for (const tile of Object.values(board.tiles)) {
      if (tile.number !== 6 && tile.number !== 8) continue;
      for (const n of neighbors(tile.coord)) {
        const other = board.tiles[tileId(n)];
        if (other === undefined || other.number === null) continue;
        expect([6, 8]).not.toContain(other.number);
      }
    }
  });

  it("is all land edges, since the classic board has no sea cells", () => {
    for (const edge of Object.values(board.edges)) {
      expect(edge.kind).toBe("land");
    }
  });

  it("puts every port on a real edge with two real endpoints", () => {
    for (const port of Object.values(board.ports)) {
      expect(board.edges[port.edge]).toBeDefined();
      expect(port.nodes).toHaveLength(2);
      for (const nodeId of port.nodes) {
        expect(board.nodes[nodeId]?.port).toBe(port.id);
      }
    }
  });

  it("has four generic ports and one for each resource", () => {
    const ports = Object.values(board.ports);
    expect(ports.filter((p) => p.kind === "generic")).toHaveLength(4);
    const resources = ports
      .filter((p) => p.kind === "resource")
      .map((p) => p.resource)
      .sort();
    expect(resources).toEqual(["brick", "grain", "lumber", "ore", "wool"]);
  });

  it("puts every port on a coastline edge", () => {
    for (const port of Object.values(board.ports)) {
      expect(board.edges[port.edge]?.tiles).toHaveLength(1);
    }
  });
});

describe("classic board determinism", () => {
  it("produces a byte-identical board from the same seed", () => {
    const a = buildBoardGraph(scenario, seedRng("repeat")).board;
    const b = buildBoardGraph(scenario, seedRng("repeat")).board;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different board from a different seed", () => {
    const a = buildBoardGraph(scenario, seedRng("alpha")).board;
    const b = buildBoardGraph(scenario, seedRng("beta")).board;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("keeps the same topology no matter the seed", () => {
    const a = buildBoardGraph(scenario, seedRng("alpha")).board;
    const b = buildBoardGraph(scenario, seedRng("beta")).board;
    expect(Object.keys(a.nodes)).toEqual(Object.keys(b.nodes));
    expect(Object.keys(a.edges)).toEqual(Object.keys(b.edges));
  });

  it("satisfies every invariant across many seeds", () => {
    for (let i = 0; i < 50; i++) {
      const { board: b } = buildBoardGraph(scenario, seedRng(`sweep-${String(i)}`));
      expect(Object.keys(b.tiles)).toHaveLength(19);
      expect(Object.keys(b.nodes)).toHaveLength(54);
      expect(Object.keys(b.edges)).toHaveLength(72);

      const numbered = Object.values(b.tiles).filter((t) => t.number !== null);
      expect(numbered).toHaveLength(18);

      for (const tile of Object.values(b.tiles)) {
        if (tile.number !== 6 && tile.number !== 8) continue;
        for (const n of neighbors(tile.coord)) {
          const other = b.tiles[tileId(n)];
          if (other === undefined || other.number === null) continue;
          expect([6, 8]).not.toContain(other.number);
        }
      }
    }
  });
});

describe("fixture boards", () => {
  it("builds the tiny island with land, coast and sea edges", () => {
    const tiny = loadScenario("tiny-island");
    const { board: b } = buildBoardGraph(tiny, seedRng("tiny"));

    expect(Object.keys(b.tiles)).toHaveLength(12);
    expect(Object.keys(b.nodes)).toHaveLength(37);
    expect(Object.keys(b.edges)).toHaveLength(48);

    const kinds: Record<string, number> = {};
    for (const edge of Object.values(b.edges)) {
      kinds[edge.kind] = (kinds[edge.kind] ?? 0) + 1;
    }
    expect(kinds).toEqual({ land: 3, coast: 12, sea: 33 });
  });

  it("builds two disjoint islands", () => {
    const two = loadScenario("two-islands");
    const { board: b } = buildBoardGraph(two, seedRng("two"));

    expect(Object.keys(b.tiles)).toHaveLength(4);
    expect(Object.keys(b.nodes)).toHaveLength(20);
    expect(Object.keys(b.edges)).toHaveLength(22);

    // The two clusters share no node.
    for (const node of Object.values(b.nodes)) {
      const islands = new Set(node.tiles.map((t) => b.tiles[t]?.island));
      expect(islands.size).toBe(1);
    }
  });
});
