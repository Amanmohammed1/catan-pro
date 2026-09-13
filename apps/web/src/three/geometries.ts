import * as THREE from "three";
import { hexCornerOffsets, TILE_BEVEL, TILE_THICKNESS } from "./layout3d.js";

/**
 * Shared geometries.
 *
 * Built once at module load and reused by every instance. Creating geometry per
 * piece is the usual reason a board game drops frames on integrated graphics —
 * it is not the draw calls, it is the allocation.
 */

/**
 * The tile slab.
 *
 * Extruded from the engine's own corner offsets rather than a six-sided
 * cylinder, so the mesh lines up exactly with the intersections and paths the
 * rules use. A cylinder would need its rotation guessed, and a guess that is
 * thirty degrees out puts every settlement in the wrong place.
 */
export function createHexTileGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const corners = hexCornerOffsets();

  corners.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  // The bevel adds its thickness to both faces, so the extruded core is thinner
  // by two bevels and the whole slab measures exactly TILE_THICKNESS.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TILE_THICKNESS - 2 * TILE_BEVEL,
    bevelEnabled: true,
    bevelThickness: TILE_BEVEL,
    bevelSize: TILE_BEVEL,
    bevelSegments: 2,
  });

  // Extrude builds in XY from z = -bevel; lay it flat (XZ, Y up) and lift it so
  // the slab spans y = 0 to y = TILE_THICKNESS, which is BOARD_TOP.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, TILE_BEVEL, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** A road: a low rounded bar laid along a path. */
export function createRoadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(0.62, 0.09, 0.15);
  geometry.translate(0, 0.045, 0);
  return geometry;
}

/**
 * A settlement: a small house. Box body, prism roof, merged so it draws as one
 * instanced mesh.
 */
export function createSettlementGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.26, 0.16, 0.26);
  body.translate(0, 0.08, 0);

  // A four-sided cone is a pyramid; rotated an eighth turn it reads as a gable.
  const roof = new THREE.ConeGeometry(0.21, 0.15, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.235, 0);

  return mergeGeometries([body, roof]);
}

/** A city: a taller two-tier building, clearly bigger than a settlement. */
export function createCityGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.38, 0.16, 0.3);
  base.translate(0, 0.08, 0);

  const tower = new THREE.BoxGeometry(0.22, 0.26, 0.26);
  tower.translate(0.07, 0.29, 0);

  const roof = new THREE.ConeGeometry(0.18, 0.14, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0.07, 0.49, 0);

  return mergeGeometries([base, tower, roof]);
}

/** The robber: a chess-pawn silhouette. */
export function createRobberGeometry(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.17, 0.21, 0.08, 16);
  base.translate(0, 0.04, 0);

  const body = new THREE.CylinderGeometry(0.08, 0.16, 0.26, 16);
  body.translate(0, 0.21, 0);

  const head = new THREE.SphereGeometry(0.11, 16, 12);
  head.translate(0, 0.42, 0);

  return mergeGeometries([base, body, head]);
}

/** The disc a number token is printed on. */
export function createTokenGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.045, 28);
  geometry.translate(0, 0.0225, 0);
  return geometry;
}

/** A flat ring, used to mark a legal intersection. */
export function createMarkerRingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.RingGeometry(0.13, 0.2, 28);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Merge several geometries into one.
 *
 * three ships this helper in an addon path that pulls in more than is wanted
 * here, and the version has moved between releases. Positions and normals are
 * all these shapes carry, so merging them by hand is both smaller and stable.
 */
function mergeGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const part of parts) {
    const indexed = part.index === null ? part : part.toNonIndexed();
    const position = indexed.getAttribute("position");
    const normal = indexed.getAttribute("normal");

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    if (indexed !== part) indexed.dispose();
    part.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}
