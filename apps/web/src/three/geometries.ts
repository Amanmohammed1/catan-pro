import * as THREE from "three";
import {
  hexCornerOffsets,
  SEA_TILE_THICKNESS,
  TILE_BEVEL,
  TILE_THICKNESS,
} from "./layout3d.js";

/**
 * Shared geometries.
 *
 * Built once and reused by every instance. Creating geometry per piece is the
 * usual reason a board game drops frames on integrated graphics — it is not the
 * draw calls, it is the allocation.
 *
 * Every piece is modelled standing on its own origin (min y = 0), so placing it
 * at BOARD_TOP puts it on the tile. `geometries.test.ts` measures that.
 *
 * Pieces carry a vertex colour used as a multiplier: 1 on walls, darker on
 * roofs, so one instanced player colour still reads as wall-and-roof. Props
 * (trees, rocks, sheep) carry their real colours the same way.
 */

/** A hex slab from y = 0 to `height`, optionally scaled in plan. */
function hexSlab(height: number, bevel: number, scale = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  hexCornerOffsets().forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x * scale, y * scale);
    else shape.lineTo(x * scale, y * scale);
  });
  shape.closePath();

  // The bevel adds its thickness to both faces, so the core is thinner by two.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });

  // Extrude builds in XY from z = -bevel; lay it flat (XZ, Y up) and lift it so
  // the slab spans y = 0 to y = height.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The tile slab.
 *
 * Extruded from the engine's own corner offsets rather than a six-sided
 * cylinder, so the mesh lines up exactly with the intersections and paths the
 * rules use. Its top face takes UVs from the shape's coordinates (-1..1), which
 * the terrain material maps onto its painted texture. Group 0 is the top and
 * bottom faces, group 1 the bevelled sides — two materials, one mesh.
 */
export function createHexTileGeometry(): THREE.BufferGeometry {
  return hexSlab(TILE_THICKNESS, TILE_BEVEL);
}

/** The sand under the tiles, seen in the gaps between them. */
export function createShoreGeometry(): THREE.BufferGeometry {
  return hexSlab(TILE_THICKNESS * 0.7, 0.02, 1.04);
}

/**
 * A sea hex: a thin sheet at the water's surface, not a blue slab of land.
 *
 * Height is the entire point. A land tile stands from 0 to BOARD_TOP; water
 * belongs at SEA_LEVEL, which is far lower, so the land reads as rising out of
 * the sea and a ship floats *in* the water rather than being swallowed by it.
 *
 * Built at full height and lowered by the caller would have been simpler, and
 * wrong: the slab's sides would still be there, a wall of blue around every
 * sea hex. This is deliberately almost flat.
 */
export function createSeaGeometry(): THREE.BufferGeometry {
  return hexSlab(SEA_TILE_THICKNESS, 0.012);
}

/** A number token's rim: an open cylinder, standing on y = 0. */
export const TOKEN_RADIUS = 0.34;
export const TOKEN_HEIGHT = 0.055;

export function createTokenRimGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    TOKEN_RADIUS,
    TOKEN_RADIUS * 1.02,
    TOKEN_HEIGHT,
    40,
    1,
    false,
  );
  geometry.translate(0, TOKEN_HEIGHT / 2, 0);
  return geometry;
}

/**
 * A number token's printed face.
 *
 * A flat circle with planar UVs, laid face up. Laid flat this way, the canvas
 * texture's top edge points away from the default camera, so numerals read
 * upright. (A cylinder's own cap UVs are rotated a quarter turn, which is how
 * the tokens once came out sideways.)
 */
export function createTokenFaceGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(TOKEN_RADIUS * 0.985, 48);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, TOKEN_HEIGHT + 0.001, 0);
  return geometry;
}

/** A road: a bevelled plank laid along a path, 0.62 long before stretching. */
export const ROAD_LENGTH = 0.62;

export function createRoadGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hl = ROAD_LENGTH / 2 - 0.025;
  const h = 0.06;
  shape.moveTo(-hl, 0);
  shape.lineTo(hl, 0);
  shape.lineTo(hl, h);
  shape.lineTo(-hl, h);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.022,
    bevelSegments: 2,
  });
  geometry.translate(0, 0.022, -0.05);
  geometry.computeVertexNormals();
  return withShade(geometry, () => 1);
}

/**
 * A settlement: the classic house silhouette — square walls, pitched roof —
 * extruded from its front profile.
 */
/**
 * A ship: a little wooden hull, modelled along the same axis as a road.
 *
 * Deliberately the road's sibling rather than something grander. The two sit on
 * the same edges and compete for the coastal ones (Seafarers p.2), so they read
 * best as two pieces from one box — a plank and a hull — and a ship scales
 * along its edge exactly as a road does.
 *
 * The profile is a side view: flat keel, a stern that lifts a little and a prow
 * that lifts more, so the direction it faces is legible from across the board.
 */
export function createShipGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hl = ROAD_LENGTH / 2 - 0.02;

  shape.moveTo(-hl * 0.92, 0.015);
  shape.lineTo(hl * 0.78, 0.0);
  shape.lineTo(hl, 0.155); // prow
  shape.lineTo(hl * 0.62, 0.125);
  shape.lineTo(-hl * 0.66, 0.115);
  shape.lineTo(-hl * 0.98, 0.135); // stern
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.115,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  geometry.translate(0, 0.02, -0.058);
  geometry.computeVertexNormals();
  return withShade(geometry, () => 1);
}

export function createSettlementGeometry(): THREE.BufferGeometry {
  return profilePiece(
    [
      [-0.12, 0],
      [0.12, 0],
      [0.12, 0.15],
      [0, 0.27],
      [-0.12, 0.15],
    ],
    0.2,
    0.15,
  );
}

/** A city: a hall with a tall gabled tower, clearly bigger than a settlement. */
export function createCityGeometry(): THREE.BufferGeometry {
  return profilePiece(
    [
      [-0.23, 0],
      [0.2, 0],
      [0.2, 0.33],
      [0.085, 0.45],
      [-0.03, 0.33],
      [-0.03, 0.17],
      [-0.13, 0.26],
      [-0.23, 0.17],
    ],
    0.22,
    0.17,
  );
}

/** Extrude a front profile into a wooden piece with darker roof slopes. */
function profilePiece(
  points: readonly (readonly [number, number])[],
  depth: number,
  eaves: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  const bevel = 0.012;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -(depth - 2 * bevel) / 2);
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  geometry.translate(0, -minY, 0);
  geometry.computeVertexNormals();

  // Roof slopes: faces above the eaves that point upward.
  return withShade(geometry, (normal, y) => (y > eaves && normal.y > 0.3 ? 0.72 : 1));
}

/** The robber: a hooded figure, turned on a lathe. */
export function createRobberGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.19, 0],
    [0.2, 0.025],
    [0.17, 0.06],
    [0.13, 0.08],
    [0.12, 0.14],
    [0.14, 0.26],
    [0.13, 0.31],
    [0.1, 0.34],
    [0.12, 0.39],
    [0.12, 0.45],
    [0.09, 0.5],
    [0.04, 0.53],
    [0, 0.535],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geometry = new THREE.LatheGeometry(profile, 28);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The pirate: a channel-marker buoy, turned on a lathe.
 *
 * Deliberately not the robber's silhouette. The two block different things —
 * the robber stops a hex producing, the pirate stops ships using one — and at
 * a glance across a board of sea and land you need to know which one you are
 * looking at without reading the hex underneath it.
 *
 * Flared base, pinched waist, a lantern bulge and a tall thin mast: nothing
 * like the robber's smooth hooded pawn, even in silhouette at a distance.
 */
export function createPirateGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.22, 0],
    [0.24, 0.04],
    [0.2, 0.1],
    [0.1, 0.2],
    [0.07, 0.24],
    [0.13, 0.3],
    [0.13, 0.38],
    [0.07, 0.42],
    [0.035, 0.46],
    [0.03, 0.62],
    [0, 0.64],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geometry = new THREE.LatheGeometry(profile, 24);
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat ring, used to mark a legal intersection. */
export function createMarkerRingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.RingGeometry(0.13, 0.2, 28);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// ---------------------------------------------------------------------------
// Props: the small scenery that says what a hex produces at a glance.

/** A pine: trunk and two tiers of canopy. */
export function createTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.018, 0.024, 0.07, 6);
  trunk.translate(0, 0.035, 0);
  const lower = new THREE.ConeGeometry(0.085, 0.14, 7);
  lower.translate(0, 0.12, 0);
  const upper = new THREE.ConeGeometry(0.06, 0.11, 7);
  upper.translate(0, 0.2, 0);
  return merge([
    tint(trunk, "#6b4424"),
    tint(lower, "#2f6b2c"),
    tint(upper, "#3d8036"),
  ]);
}

/** A craggy peak with a pale top. */
export function createRockGeometry(): THREE.BufferGeometry {
  const peak = new THREE.ConeGeometry(0.13, 0.24, 5);
  peak.translate(0, 0.12, 0);
  const cap = new THREE.ConeGeometry(0.052, 0.07, 5);
  cap.translate(0, 0.205, 0);
  const boulder = new THREE.DodecahedronGeometry(0.06, 0);
  boulder.translate(0.1, 0.035, 0.04);
  return merge([tint(peak, "#7b838d"), tint(cap, "#e6ebf0"), tint(boulder, "#666d76")]);
}

/** A sheep, small enough to graze beside the token. */
export function createSheepGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.055, 10, 8);
  body.scale(1.3, 0.95, 1);
  body.translate(0, 0.075, 0);
  const head = new THREE.SphereGeometry(0.03, 8, 6);
  head.translate(0.075, 0.09, 0);
  const legs = [
    [-0.035, -0.025],
    [0.035, -0.025],
    [-0.035, 0.025],
    [0.035, 0.025],
  ].map(([x, z]) => {
    const leg = new THREE.CylinderGeometry(0.009, 0.009, 0.04, 5);
    leg.translate(x ?? 0, 0.02, z ?? 0);
    return tint(leg, "#3a2f27");
  });
  return merge([tint(body, "#f7f3e8"), tint(head, "#3a2f27"), ...legs]);
}

/** A sheaf of wheat, tied at the waist. */
export function createSheafGeometry(): THREE.BufferGeometry {
  const sheaf = new THREE.CylinderGeometry(0.05, 0.035, 0.13, 8);
  sheaf.translate(0, 0.065, 0);
  const crown = new THREE.SphereGeometry(0.055, 8, 6);
  crown.scale(1, 0.7, 1);
  crown.translate(0, 0.135, 0);
  const tie = new THREE.CylinderGeometry(0.041, 0.041, 0.02, 8);
  tie.translate(0, 0.07, 0);
  return merge([tint(sheaf, "#d9ab3a"), tint(crown, "#f0cd5c"), tint(tie, "#8a5a2e")]);
}

/** A clay pit with a small stack of fired bricks beside it. */
export function createClayGeometry(): THREE.BufferGeometry {
  const mound = new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1.2, 0.6, 1);
  const stack = [0, 1, 2].map((i) => {
    const brick = new THREE.BoxGeometry(0.07, 0.028, 0.035);
    brick.translate(0.11, 0.014 + i * 0.03, (i % 2) * 0.012);
    return tint(brick, i % 2 === 0 ? "#b4522c" : "#c9643a");
  });
  return merge([tint(mound, "#9a4c28"), ...stack]);
}

/** A weathered stone on the sand. */
export function createDesertRockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.DodecahedronGeometry(0.07, 0);
  rock.scale(1.3, 0.7, 1);
  rock.translate(0, 0.04, 0);
  const small = new THREE.DodecahedronGeometry(0.035, 0);
  small.translate(0.09, 0.02, 0.05);
  return merge([tint(rock, "#b89c6a"), tint(small, "#a3875a")]);
}

// ---------------------------------------------------------------------------
// Helpers

/** Give every vertex of a geometry one colour. Returns non-indexed geometry. */
function tint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const c = new THREE.Color(hex);
  const count = flat.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return flat;
}

/** A grey vertex colour chosen per vertex, used as a shade multiplier. */
function withShade(
  geometry: THREE.BufferGeometry,
  shadeAt: (normal: THREE.Vector3, y: number) => number,
): THREE.BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const position = flat.getAttribute("position");
  const normal = flat.getAttribute("normal");
  const colours = new Float32Array(position.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
    const s = shadeAt(n, position.getY(i));
    colours[i * 3] = s;
    colours[i * 3 + 1] = s;
    colours[i * 3 + 2] = s;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return flat;
}

/**
 * Merge several geometries into one.
 *
 * three ships this helper in an addon path that pulls in more than is wanted
 * here. Positions, normals and vertex colours are all these shapes carry, so
 * merging them by hand is both smaller and stable across releases.
 */
function merge(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];

  for (const part of parts) {
    const flat = part.index === null ? part : part.toNonIndexed();
    flat.computeVertexNormals();
    const position = flat.getAttribute("position");
    const normal = flat.getAttribute("normal");
    const colour = flat.getAttribute("color") as THREE.BufferAttribute | undefined;

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (colour === undefined) colours.push(1, 1, 1);
      else colours.push(colour.getX(i), colour.getY(i), colour.getZ(i));
    }
    if (flat !== part) flat.dispose();
    part.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));

  // Rest on the ground: a boulder's underside must not sink into the tile.
  merged.computeBoundingBox();
  merged.translate(0, -(merged.boundingBox?.min.y ?? 0), 0);
  return merged;
}
