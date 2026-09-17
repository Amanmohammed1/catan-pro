import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildBoardGraph, seedRng, type BoardGraph } from "@hexport/engine";
import { loadScenario } from "@hexport/scenarios";
import {
  createCityGeometry,
  createClayGeometry,
  createDesertRockGeometry,
  createHexTileGeometry,
  createRoadGeometry,
  createRobberGeometry,
  createRockGeometry,
  createSettlementGeometry,
  createSheafGeometry,
  createSheepGeometry,
  createShoreGeometry,
  createTokenFaceGeometry,
  createTokenRimGeometry,
  createTreeGeometry,
} from "./geometries.js";
import {
  BOARD_TOP,
  CAMERA_FOV,
  FRAME_WIDTH,
  SEA_WIDTH,
  boardBounds,
  cameraPose,
  convexHull,
  islandOutline,
  nodePosition,
  offsetOutline,
} from "./layout3d.js";

/**
 * The meshes, measured.
 *
 * Every piece is placed at BOARD_TOP on the assumption that the tile's top face
 * is there and that the piece's own geometry starts at its origin. Both halves
 * were once false together — the slab's top sat at 0.35 while pieces stood at
 * 0.11 — and every token and road rendered inside the tiles while every test
 * passed. These measure the real geometry instead of trusting the constants.
 */

function bounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error("No bounding box");
  return box;
}

describe("tile slab", () => {
  it("has its top face exactly at BOARD_TOP", () => {
    expect(bounds(createHexTileGeometry()).max.y).toBeCloseTo(BOARD_TOP, 6);
  });

  it("rests on the table at y = 0", () => {
    expect(bounds(createHexTileGeometry()).min.y).toBeCloseTo(0, 6);
  });

  it("sits above the sand shore that shows in the gaps", () => {
    expect(bounds(createShoreGeometry()).max.y).toBeLessThan(BOARD_TOP - 0.02);
  });
});

describe("number token face", () => {
  it("is printed on top of its rim, not inside it", () => {
    expect(bounds(createTokenFaceGeometry()).min.y).toBeGreaterThan(
      bounds(createTokenRimGeometry()).max.y,
    );
  });

  it("maps the texture's top edge to the far side of the board", () => {
    // Canvas "up" is v = 1. The default camera looks toward -z, so v must grow
    // toward -z for numerals to read upright. They once came out sideways.
    const face = createTokenFaceGeometry();
    const position = face.getAttribute("position");
    const uv = face.getAttribute("uv");
    let far = { z: Infinity, v: 0 };
    let near = { z: -Infinity, v: 0 };
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i);
      if (z < far.z) far = { z, v: uv.getY(i) };
      if (z > near.z) near = { z, v: uv.getY(i) };
    }
    expect(far.v).toBeGreaterThan(near.v);
  });
});

describe("pieces stand on their own origin", () => {
  const pieces: [string, () => THREE.BufferGeometry][] = [
    ["token rim", createTokenRimGeometry],
    ["road", createRoadGeometry],
    ["settlement", createSettlementGeometry],
    ["city", createCityGeometry],
    ["robber", createRobberGeometry],
    ["tree", createTreeGeometry],
    ["rock", createRockGeometry],
    ["sheep", createSheepGeometry],
    ["sheaf", createSheafGeometry],
    ["clay pit", createClayGeometry],
    ["desert rock", createDesertRockGeometry],
  ];

  it.each(pieces)("%s starts at y = 0, so BOARD_TOP puts it on the tile", (_, make) => {
    const box = bounds(make());
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeGreaterThan(0.02);
  });
});

describe("island outline", () => {
  const board = buildBoardGraph(loadScenario("classic-3-4"), seedRng("outline")).board;

  it("is a convex hull of the land", () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [1, 0.2], [0, 2], [2, 2]])).toHaveLength(4);
  });

  it("wraps every intersection", () => {
    const hull = islandOutline(board);
    // Every intersection is inside or on the hull (all cross products >= 0 for CCW).
    for (const node of Object.keys(board.nodes)) {
      const [x, , z] = nodePosition(node);
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i]!;
        const b = hull[(i + 1) % hull.length]!;
        const cross = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
        expect(cross).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("grows outward by the requested distance", () => {
    const hull = islandOutline(board);
    const grown = offsetOutline(hull, 1);
    const reach = (pts: readonly (readonly [number, number])[]): number =>
      Math.max(...pts.map(([x, z]) => Math.hypot(x, z)));
    expect(reach(grown) - reach(hull)).toBeCloseTo(1, 1);
  });
});

describe("camera framing", () => {
  const board: BoardGraph = buildBoardGraph(
    loadScenario("classic-3-4"),
    seedRng("framing"),
  ).board;
  const extent = boardBounds(board);

  function project(aspect: number, points: readonly THREE.Vector3[]): THREE.Vector3[] {
    const pose = cameraPose(extent, aspect);
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 500);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    return points.map((p) => p.clone().project(camera));
  }

  const intersections = Object.keys(board.nodes).map(
    (node) => new THREE.Vector3(...nodePosition(node)),
  );

  // The sea, the harbours on it and the wooden frame around it.
  const rim = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    const reach = extent.radius + SEA_WIDTH + FRAME_WIDTH;
    return new THREE.Vector3(
      extent.centre[0] + Math.cos(angle) * reach,
      0,
      extent.centre[2] + Math.sin(angle) * reach,
    );
  });

  // Phone portrait, square, a typical board panel, laptop and ultrawide.
  it.each([0.46, 1, 1.24, 1.6, 2.4])(
    "keeps every intersection and the harbour rim in view at aspect %s",
    (aspect) => {
      for (const p of project(aspect, [...intersections, ...rim])) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each([0.46, 1.24, 2.4])(
    "does not leave the board tiny at aspect %s",
    (aspect) => {
      const projected = project(aspect, intersections);
      const spanX = Math.max(...projected.map((p) => Math.abs(p.x)));
      const spanY = Math.max(...projected.map((p) => Math.abs(p.y)));
      // The island fills most of the limiting axis; the sea and the wooden
      // frame around it take the rest, which is why this is not nearer 1. A
      // board marooned in the middle of a large empty table is the failure
      // this guards against — that measured about 0.35.
      expect(Math.max(spanX, spanY)).toBeGreaterThan(0.55);
    },
  );
});
