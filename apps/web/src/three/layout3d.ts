import {
  DEFAULT_LAYOUT,
  hexCornerPixels,
  hexToPixel,
  nodeToPixel,
  type Axial,
  type BoardGraph,
  type EdgeId,
  type NodeId,
  type TileId,
} from "@hexport/engine";

/**
 * Where things sit in 3D.
 *
 * The engine already computes 2D positions for the debug renderer and is
 * explicit that they are render-only (ADR 0001). This lifts them into three
 * dimensions: the board lies in the XZ plane with Y up, so the engine's 2D y
 * becomes z and nothing about board identity changes.
 *
 * No game logic lives here. It is arithmetic on public board data.
 */

export type Vec3 = readonly [number, number, number];

/** Height of the tile slab. Everything else is measured from its top face. */
export const TILE_THICKNESS = 0.22;
export const BOARD_TOP = TILE_THICKNESS / 2;

/** Hex corner offsets from a tile centre, in the XZ plane. */
export function hexCornerOffsets(): readonly (readonly [number, number])[] {
  const centre = hexToPixel(DEFAULT_LAYOUT, [0, 0]);
  return hexCornerPixels(DEFAULT_LAYOUT, [0, 0]).map(
    ([x, y]) => [x - centre[0], y - centre[1]] as const,
  );
}

export function tilePosition(coord: Axial): Vec3 {
  const [x, y] = hexToPixel(DEFAULT_LAYOUT, coord);
  return [x, 0, y];
}

export function nodePosition(node: NodeId, height = BOARD_TOP): Vec3 {
  const [x, y] = nodeToPixel(DEFAULT_LAYOUT, node);
  return [x, height, y];
}

export interface EdgeTransform {
  readonly position: Vec3;
  /** Rotation about Y that aligns a piece with the edge. */
  readonly rotationY: number;
  readonly length: number;
}

export function edgeTransform(
  board: BoardGraph,
  edge: EdgeId,
  height = BOARD_TOP,
): EdgeTransform | null {
  const graph = board.edges[edge];
  if (graph === undefined) return null;

  const [ax, , az] = nodePosition(graph.nodes[0], height);
  const [bx, , bz] = nodePosition(graph.nodes[1], height);

  return {
    position: [(ax + bx) / 2, height, (az + bz) / 2],
    // Negated because a rotation about +Y turns from +Z toward +X.
    rotationY: -Math.atan2(bz - az, bx - ax),
    length: Math.hypot(bx - ax, bz - az),
  };
}

export interface BoardBounds {
  readonly centre: Vec3;
  readonly radius: number;
  readonly width: number;
  readonly depth: number;
}

/** Extent of the board, used to frame the camera and size the water. */
export function boardBounds(board: BoardGraph): BoardBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const node of Object.keys(board.nodes)) {
    const [x, , z] = nodePosition(node);
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) {
    return { centre: [0, 0, 0], radius: 6, width: 12, depth: 12 };
  }

  const width = maxX - minX;
  const depth = maxZ - minZ;

  return {
    centre: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
    radius: Math.max(width, depth) / 2,
    width,
    depth,
  };
}

/** Tiles in a stable order, so instance indices never shuffle between frames. */
export function orderedTileIds(board: BoardGraph): TileId[] {
  return Object.keys(board.tiles).sort();
}

/** Probability pips printed under a number token. Rules p.10. */
export function pipCount(value: number): number {
  return Math.max(0, 6 - Math.abs(7 - value));
}
