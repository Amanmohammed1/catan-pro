import { describe, it, expect } from "vitest";
import {
  buildBoardGraph,
  seedRng,
  DEFAULT_LAYOUT,
  hexToPixel,
  nodeIdAt,
  type BoardGraph,
} from "@hexport/engine";
import { loadScenario } from "@hexport/scenarios";
import {
  BOARD_TOP,
  boardBounds,
  edgeTransform,
  hexCornerOffsets,
  nodePosition,
  orderedTileIds,
  pipCount,
  tilePosition,
} from "./layout3d.js";

/**
 * The 3D maths.
 *
 * This is the part of the renderer that can be quietly wrong: a hex rotated
 * thirty degrees, or an edge midpoint off by a fraction, puts every settlement
 * somewhere it does not belong and no type checker will notice. The component
 * that consumes it is covered by the build and by looking at the thing; these
 * cover the arithmetic.
 */

const board: BoardGraph = buildBoardGraph(
  loadScenario("classic-3-4"),
  seedRng("layout"),
).board;

describe("tile placement", () => {
  it("puts a tile where the engine's own 2D layout says, with y as z", () => {
    for (const tile of Object.values(board.tiles)) {
      const [x2, y2] = hexToPixel(DEFAULT_LAYOUT, tile.coord);
      const [x3, y3, z3] = tilePosition(tile.coord);
      expect(x3).toBeCloseTo(x2, 10);
      expect(z3).toBeCloseTo(y2, 10);
      expect(y3).toBe(0);
    }
  });

  it("keeps tile order stable, so instance indices never shuffle", () => {
    expect(orderedTileIds(board)).toEqual(orderedTileIds(board));
    expect(orderedTileIds(board)).toEqual([...orderedTileIds(board)].sort());
  });
});

describe("the hex outline", () => {
  const offsets = hexCornerOffsets();

  it("has six corners", () => {
    expect(offsets).toHaveLength(6);
  });

  it("puts every corner one hex size from the centre", () => {
    for (const [x, y] of offsets) {
      expect(Math.hypot(x, y)).toBeCloseTo(DEFAULT_LAYOUT.size, 10);
    }
  });

  it("spaces the corners sixty degrees apart", () => {
    const angles = offsets.map(([x, y]) => Math.atan2(y, x));
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i] as number;
      const b = angles[(i + 1) % angles.length] as number;
      let delta = Math.abs(b - a);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      expect(delta).toBeCloseTo(Math.PI / 3, 8);
    }
  });

  it("matches the intersections the rules use", () => {
    // The extruded slab is built from these offsets, so a corner of the mesh
    // has to land exactly on the engine's intersection or pieces sit crooked.
    const centre = tilePosition([0, 0]);
    const cornerIds = [0, 1, 2, 3, 4, 5].map((i) =>
      nodeIdAt([0, 0], i as 0 | 1 | 2 | 3 | 4 | 5),
    );

    for (const id of cornerIds) {
      const [nx, , nz] = nodePosition(id);
      const matched = offsets.some(
        ([ox, oz]) =>
          Math.abs(centre[0] + ox - nx) < 1e-9 && Math.abs(centre[2] + oz - nz) < 1e-9,
      );
      expect(matched).toBe(true);
    }
  });
});

describe("intersections", () => {
  it("sits pieces on the top face of the slab", () => {
    const node = Object.keys(board.nodes)[0] as string;
    expect(nodePosition(node)[1]).toBeCloseTo(BOARD_TOP, 10);
  });

  it("places every intersection within the board's bounds", () => {
    const bounds = boardBounds(board);
    for (const node of Object.keys(board.nodes)) {
      const [x, , z] = nodePosition(node);
      expect(Math.abs(x - bounds.centre[0])).toBeLessThanOrEqual(
        bounds.width / 2 + 1e-9,
      );
      expect(Math.abs(z - bounds.centre[2])).toBeLessThanOrEqual(
        bounds.depth / 2 + 1e-9,
      );
    }
  });
});

describe("paths", () => {
  it("puts a road at the midpoint of its two intersections", () => {
    for (const edge of Object.values(board.edges)) {
      const transform = edgeTransform(board, edge.id);
      expect(transform).not.toBeNull();
      if (transform === null) continue;

      const [ax, , az] = nodePosition(edge.nodes[0]);
      const [bx, , bz] = nodePosition(edge.nodes[1]);
      expect(transform.position[0]).toBeCloseTo((ax + bx) / 2, 10);
      expect(transform.position[2]).toBeCloseTo((az + bz) / 2, 10);
    }
  });

  it("gives every path the same length on a regular board", () => {
    const lengths = Object.keys(board.edges).map(
      (edge) => edgeTransform(board, edge)?.length ?? 0,
    );
    const first = lengths[0] as number;
    expect(first).toBeGreaterThan(0);
    for (const length of lengths) expect(length).toBeCloseTo(first, 9);
  });

  it("rotates a road to actually lie along its path", () => {
    for (const edge of Object.values(board.edges).slice(0, 12)) {
      const transform = edgeTransform(board, edge.id);
      if (transform === null) continue;

      const [ax, , az] = nodePosition(edge.nodes[0]);
      const [bx, , bz] = nodePosition(edge.nodes[1]);

      // A bar of the given length, rotated by rotationY about the centre,
      // should have its ends on the two intersections.
      const half = transform.length / 2;
      const endX = transform.position[0] + Math.cos(-transform.rotationY) * half;
      const endZ = transform.position[2] + Math.sin(-transform.rotationY) * half;

      const hitsA = Math.hypot(endX - ax, endZ - az) < 1e-6;
      const hitsB = Math.hypot(endX - bx, endZ - bz) < 1e-6;
      expect(hitsA || hitsB).toBe(true);
    }
  });

  it("returns null for a path that is not on the board", () => {
    expect(edgeTransform(board, "e|nonsense")).toBeNull();
  });
});

describe("bounds", () => {
  it("frames the whole board", () => {
    const bounds = boardBounds(board);
    expect(bounds.radius).toBeGreaterThan(2);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.depth).toBeGreaterThan(0);
  });

  it("survives an empty board without producing NaN", () => {
    const empty = { ...board, nodes: {} } as BoardGraph;
    const bounds = boardBounds(empty);
    expect(Number.isFinite(bounds.radius)).toBe(true);
    expect(Number.isFinite(bounds.centre[0])).toBe(true);
  });
});

describe("number token pips", () => {
  it("matches the ways each total can be rolled (p.10)", () => {
    // 6 and 8 are the most likely and get five pips; 2 and 12 get one.
    expect(pipCount(2)).toBe(1);
    expect(pipCount(12)).toBe(1);
    expect(pipCount(6)).toBe(5);
    expect(pipCount(8)).toBe(5);
    expect(pipCount(7)).toBe(6);
    expect(pipCount(3)).toBe(2);
    expect(pipCount(11)).toBe(2);
  });
});
