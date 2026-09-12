/**
 * World positions for rendering. Nothing in this file participates in identity.
 *
 * CLAUDE.md: "3D is a view of engine state." The same applies to the 2D debug
 * renderer. Board topology comes from coords.ts and ids.ts, which never call
 * anything here. Changing `size` or `orientation` changes only pixels, and a
 * test asserts exactly that.
 */

import { hexesFromNodeId, type NodeId } from "./ids.js";
import { CORNER_INDICES, cornerHexes, type Axial } from "./coords.js";

export interface Layout {
  readonly orientation: "pointy" | "flat";
  /** Distance from hex centre to any corner. */
  readonly size: number;
  readonly origin: readonly [number, number];
}

export const DEFAULT_LAYOUT: Layout = {
  orientation: "pointy",
  size: 1,
  origin: [0, 0],
};

const SQRT3 = Math.sqrt(3);

/** Centre of a hex in world space. */
export function hexToPixel(layout: Layout, hex: Axial): readonly [number, number] {
  const [q, r] = hex;
  const [ox, oy] = layout.origin;

  if (layout.orientation === "pointy") {
    return [
      layout.size * (SQRT3 * q + (SQRT3 / 2) * r) + ox,
      layout.size * (1.5 * r) + oy,
    ];
  }

  return [
    layout.size * (1.5 * q) + ox,
    layout.size * ((SQRT3 / 2) * q + SQRT3 * r) + oy,
  ];
}

/**
 * Position of a vertex, as the centroid of the three hexes that meet there.
 *
 * Three mutually adjacent hex centres form an equilateral triangle whose
 * centroid is exactly their shared corner, so this needs no angle arithmetic
 * and is consistent with the identity scheme by construction.
 */
export function nodeToPixel(layout: Layout, nodeId: NodeId): readonly [number, number] {
  const hexes = hexesFromNodeId(nodeId);
  let x = 0;
  let y = 0;
  for (const hex of hexes) {
    const [px, py] = hexToPixel(layout, hex);
    x += px;
    y += py;
  }
  return [x / 3, y / 3];
}

/** The six corner positions of a hex, in corner-index order, for drawing. */
export function hexCornerPixels(
  layout: Layout,
  hex: Axial,
): readonly (readonly [number, number])[] {
  return CORNER_INDICES.map((corner) => {
    const hexes = cornerHexes(hex, corner);
    let x = 0;
    let y = 0;
    for (const h of hexes) {
      const [px, py] = hexToPixel(layout, h);
      x += px;
      y += py;
    }
    return [x / 3, y / 3] as const;
  });
}
