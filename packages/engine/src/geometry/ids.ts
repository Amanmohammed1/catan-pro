/**
 * Canonical identity for tiles, vertices and edges.
 *
 * ADR 0001. A vertex is named by the sorted triple of the three hex positions
 * that meet at it; an edge is named by the sorted pair of its two vertex ids.
 * Both are pure integer derivations.
 *
 * The alternative — rounding a computed world position to a few decimals and
 * keying on the string — fails in two ways that matter here. It can split one
 * corner into two when the true coordinates straddle a rounding step, silently
 * adding a settlement spot nobody can reach. And it ties identity to the
 * rendering constants, so changing hex size or orientation in the 3D client
 * would invalidate every id already written to the event log.
 */

import {
  compareAxial,
  cornerHexes,
  edgeCornerIndices,
  type Axial,
  type CornerIndex,
  type DirectionIndex,
} from "./coords.js";

export type TileId = string;
export type NodeId = string;
export type EdgeId = string;

/** Render one axial coordinate as "q,r". */
export function axialKey(hex: Axial): string {
  return `${hex[0]},${hex[1]}`;
}

/** Parse a "q,r" key back into an axial coordinate. */
export function parseAxialKey(key: string): Axial {
  const parts = key.split(",");
  if (parts.length !== 2) {
    throw new TypeError(`Malformed axial key: ${key}`);
  }
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new TypeError(`Malformed axial key: ${key}`);
  }
  return [q, r];
}

/** Tile id for the hex position a tile occupies. */
export function tileId(hex: Axial): TileId {
  return `t|${axialKey(hex)}`;
}

/**
 * Vertex id from the three hex positions meeting at a corner.
 *
 * The triple is sorted before joining, so all three hexes that share the corner
 * derive the same id and dedup is automatic.
 */
export function nodeIdFromHexes(hexes: readonly Axial[]): NodeId {
  if (hexes.length !== 3) {
    throw new TypeError(
      `A vertex is defined by exactly 3 hex positions, received ${String(hexes.length)}`,
    );
  }
  const sorted = [...hexes].sort(compareAxial);
  return `v|${sorted.map(axialKey).join("|")}`;
}

/** Vertex id for corner `corner` of `hex`. */
export function nodeIdAt(hex: Axial, corner: CornerIndex): NodeId {
  return nodeIdFromHexes(cornerHexes(hex, corner));
}

/**
 * Edge id from its two endpoints.
 *
 * Sorted, so the id does not depend on which of the two adjacent hexes derived
 * it or on which endpoint was discovered first.
 */
export function edgeIdFromNodes(a: NodeId, b: NodeId): EdgeId {
  if (a === b) {
    throw new TypeError(`An edge needs two distinct endpoints, received ${a}`);
  }
  const [first, second] = a < b ? [a, b] : [b, a];
  return `e|${first}__${second}`;
}

/** Edge id for edge `dir` of `hex`. */
export function edgeIdAt(hex: Axial, dir: DirectionIndex): EdgeId {
  const [ca, cb] = edgeCornerIndices(dir);
  return edgeIdFromNodes(nodeIdAt(hex, ca), nodeIdAt(hex, cb));
}

/** Recover the three hex positions encoded in a vertex id. */
export function hexesFromNodeId(id: NodeId): readonly [Axial, Axial, Axial] {
  if (!id.startsWith("v|")) {
    throw new TypeError(`Not a vertex id: ${id}`);
  }
  const parts = id.slice(2).split("|");
  if (parts.length !== 3) {
    throw new TypeError(`Malformed vertex id: ${id}`);
  }
  return [
    parseAxialKey(parts[0] as string),
    parseAxialKey(parts[1] as string),
    parseAxialKey(parts[2] as string),
  ];
}

/** Recover the two endpoint ids encoded in an edge id. */
export function nodesFromEdgeId(id: EdgeId): readonly [NodeId, NodeId] {
  if (!id.startsWith("e|")) {
    throw new TypeError(`Not an edge id: ${id}`);
  }
  const parts = id.slice(2).split("__");
  if (parts.length !== 2) {
    throw new TypeError(`Malformed edge id: ${id}`);
  }
  return [parts[0] as NodeId, parts[1] as NodeId];
}
