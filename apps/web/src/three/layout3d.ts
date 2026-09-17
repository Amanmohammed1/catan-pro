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

/**
 * Height of the tile slab, bevel included. The slab runs from y = 0 to its top
 * face at BOARD_TOP, and every piece, token and marker stands on that face.
 *
 * These were once out of step: the slab's top sat at 0.35 while pieces stood at
 * 0.11, so tokens and roads rendered inside the tiles. `geometries.test.ts`
 * measures the real mesh against this constant so that cannot recur.
 */
export const TILE_THICKNESS = 0.22;
export const TILE_BEVEL = 0.02;
export const BOARD_TOP = TILE_THICKNESS;

/** Default camera field of view, degrees, vertical. */
export const CAMERA_FOV = 42;

/**
 * Where the camera looks from: straight "south" of the board, tilted about 41°
 * from vertical. Close enough to overhead to read every token, low enough that
 * the pieces read as objects standing on the table.
 */
const CAMERA_TILT = Math.atan2(0.72, 0.82);

/** Room kept around the island for the sea, harbours and the wooden frame. */
const FRAME_MARGIN = 1.42;

/** The sea's surface: below the tiles, above the table. */
export const SEA_LEVEL = 0.06;
/** Open water between the island's rim and the frame. Harbours sit in it. */
export const SEA_WIDTH = 0.95;
export const FRAME_WIDTH = 0.42;

type Point2 = readonly [number, number];

/**
 * The island's outline in the XZ plane: the convex hull of every intersection.
 *
 * Intersections are exactly the tile corners, so this is the hull of the land.
 * Used to shape the sea and the frame around any board, the 5–6 player and
 * Seafarers layouts included, without a per-scenario outline.
 */
export function islandOutline(board: BoardGraph): Point2[] {
  const points: Point2[] = Object.keys(board.nodes).map((node) => {
    const [x, , z] = nodePosition(node);
    return [x, z] as const;
  });
  return convexHull(points);
}

/**
 * The outline grown outward by `distance`, with rounded corners.
 *
 * The hull of circles centred on every hull vertex: for a convex shape that is
 * exactly its offset, and rounding the corners is what a routed wooden frame
 * looks like anyway.
 */
export function offsetOutline(outline: readonly Point2[], distance: number): Point2[] {
  const grown: Point2[] = [];
  const steps = 18;
  for (const [x, z] of outline) {
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      grown.push([x + Math.cos(angle) * distance, z + Math.sin(angle) * distance]);
    }
  }
  return convexHull(grown);
}

/** Andrew's monotone chain. Counter-clockwise, no repeated first point. */
export function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point2, a: Point2, b: Point2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Point2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/**
 * How far off the edge of the screen the board's rim lands, from `distance`.
 *
 * Projects the rim of a disc of `radius` (plus the frame's height, since the
 * near edge of a raised frame reaches higher into the frustum) through the same
 * camera basis three will use, and returns the largest normalised coordinate.
 * At most 1, the whole board is inside the viewport.
 *
 * Perspective is why this cannot be a ratio: the near rim is closer to the lens
 * than the far rim, so it projects much larger, and by a different amount at
 * every distance and tilt.
 */
function rimExtent(
  distance: number,
  radius: number,
  height: number,
  tanV: number,
  tanH: number,
): number {
  // Camera looks down at CAMERA_TILT from straight above, from +z.
  const sin = Math.sin(CAMERA_TILT);
  const cos = Math.cos(CAMERA_TILT);
  const py = distance * cos;
  const pz = distance * sin;
  // Basis: right is +x; forward and up follow from the tilt.
  const forward = [0, -cos, -sin] as const;
  const up = [0, sin, -cos] as const;

  let worst = 0;
  for (let i = 0; i < 72; i++) {
    const angle = (i / 72) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    for (const y of [0, height]) {
      const v = [x, y - py, z - pz] as const;
      const depth = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
      if (depth <= 0.01) return Infinity;
      const right = v[0];
      const vertical = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
      worst = Math.max(
        worst,
        Math.abs(right / (depth * tanH)),
        Math.abs(vertical / (depth * tanV)),
      );
    }
  }
  return worst;
}

/**
 * A camera pose that fits the whole board in view.
 *
 * Binary-searches the closest distance at which the board, its sea and its
 * frame all still fit the viewport, so the board fills the space it is given at
 * any window shape rather than floating in the middle of an empty table.
 * `geometries.test.ts` projects real board points through a real camera to
 * check both halves of that: nothing clipped, nothing marooned.
 */
export function cameraPose(
  bounds: BoardBounds,
  aspect: number,
  fovDeg = CAMERA_FOV,
): CameraPose {
  const radius = bounds.radius + FRAME_MARGIN;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(aspect, 0.1);

  let near = radius * 0.6;
  let far = radius * 30;
  for (let i = 0; i < 36; i++) {
    const middle = (near + far) / 2;
    if (rimExtent(middle, radius, BOARD_TOP + 0.3, tanV, tanH) > 1) near = middle;
    else far = middle;
  }
  // A whisker of air, so nothing sits exactly on the edge of the frame.
  const distance = far * 1.02;

  const [cx, , cz] = bounds.centre;
  return {
    position: [
      cx,
      distance * Math.cos(CAMERA_TILT),
      cz + distance * Math.sin(CAMERA_TILT),
    ],
    target: [cx, 0, cz],
  };
}

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
