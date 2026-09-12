/**
 * Axial hex coordinates and the corner/edge combinatorics built on them.
 *
 * Reference: Red Blob Games, "Hexagonal Grids" (redblobgames.com/grids/hexagons).
 *
 * Everything in this file is integer arithmetic. No world positions, no floats.
 * That is deliberate: vertex and edge identity is derived from these integers
 * alone (see ids.ts and docs/adr/0001-vertex-edge-identity.md), so the board
 * graph cannot change when rendering constants change.
 */

/** Axial coordinate: q along one axis, r along another, both integers. */
export type Axial = readonly [q: number, r: number];

/**
 * The six neighbour directions, in order.
 *
 * Consecutive entries are 60 degrees apart, which is the property the corner
 * derivation below relies on: dir[i] and dir[i+1] are themselves adjacent, so
 * the hex, its dir[i] neighbour and its dir[i+1] neighbour form the three hexes
 * meeting at one corner.
 *
 * For a pointy-top layout these read: E, NE, NW, W, SW, SE.
 */
export const AXIAL_DIRECTIONS: readonly Axial[] = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
] as const;

/** A corner index 0-5, matching the direction pair that produces it. */
export type CornerIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** A direction index 0-5 into AXIAL_DIRECTIONS. */
export type DirectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const CORNER_INDICES: readonly CornerIndex[] = [0, 1, 2, 3, 4, 5];
export const DIRECTION_INDICES: readonly DirectionIndex[] = [0, 1, 2, 3, 4, 5];

export function addAxial(a: Axial, b: Axial): Axial {
  return [a[0] + b[0], a[1] + b[1]];
}

export function equalAxial(a: Axial, b: Axial): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** The neighbour of `hex` in direction `dir`. */
export function neighbor(hex: Axial, dir: DirectionIndex): Axial {
  const delta = AXIAL_DIRECTIONS[dir];
  if (delta === undefined) {
    throw new RangeError(`Direction index out of range: ${String(dir)}`);
  }
  return addAxial(hex, delta);
}

/** All six neighbours, in direction order. */
export function neighbors(hex: Axial): readonly Axial[] {
  return AXIAL_DIRECTIONS.map((delta) => addAxial(hex, delta));
}

/**
 * Total ordering on axial coordinates, by q then r.
 *
 * Canonicalisation depends on this being a stable total order; a lexicographic
 * string sort would also be stable but orders "-1" after "10", which makes ids
 * harder to read when debugging.
 */
export function compareAxial(a: Axial, b: Axial): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** Cube coordinates, useful for distance and rotation. x + y + z === 0. */
export type Cube = readonly [x: number, y: number, z: number];

export function axialToCube(hex: Axial): Cube {
  const [q, r] = hex;
  return [q, -q - r, r];
}

export function cubeToAxial(cube: Cube): Axial {
  return [cube[0], cube[2]];
}

/** Number of steps between two hexes. */
export function hexDistance(a: Axial, b: Axial): number {
  const [ax, ay, az] = axialToCube(a);
  const [bx, by, bz] = axialToCube(b);
  return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
}

/**
 * The three hex positions meeting at corner `corner` of `hex`.
 *
 * Every corner in the hex plane is shared by exactly three hex positions,
 * whether or not a tile occupies them. That is what makes this a total function
 * and what lets rim corners of an irregular Seafarers board be identified
 * without inventing placeholder tiles.
 *
 * Returned unsorted; ids.ts canonicalises.
 */
export function cornerHexes(
  hex: Axial,
  corner: CornerIndex,
): readonly [Axial, Axial, Axial] {
  const next = ((corner + 1) % 6) as DirectionIndex;
  return [hex, neighbor(hex, corner), neighbor(hex, next)];
}

/**
 * The two corner indices at the ends of edge `dir` of a hex.
 *
 * Edge `dir` separates the hex from its dir-neighbour. The two corners on that
 * edge are the ones whose hex triples both contain the hex and that neighbour,
 * which are corners dir-1 and dir.
 */
export function edgeCornerIndices(
  dir: DirectionIndex,
): readonly [CornerIndex, CornerIndex] {
  return [((dir + 5) % 6) as CornerIndex, dir];
}

/** The two hex positions separated by edge `dir` of `hex`. */
export function edgeHexes(hex: Axial, dir: DirectionIndex): readonly [Axial, Axial] {
  return [hex, neighbor(hex, dir)];
}
