import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildBoardGraph, seedRng, type BoardGraph } from "@hexport/engine";
import { loadScenario } from "@hexport/scenarios";
import {
  createCityGeometry,
  createHexTileGeometry,
  createRoadGeometry,
  createRobberGeometry,
  createSettlementGeometry,
  createTokenGeometry,
} from "./geometries.js";
import {
  BOARD_TOP,
  CAMERA_FOV,
  boardBounds,
  cameraPose,
  nodePosition,
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
});

describe("pieces stand on their own origin", () => {
  const pieces: [string, () => THREE.BufferGeometry][] = [
    ["number token", createTokenGeometry],
    ["road", createRoadGeometry],
    ["settlement", createSettlementGeometry],
    ["city", createCityGeometry],
    ["robber", createRobberGeometry],
  ];

  it.each(pieces)("%s starts at y = 0, so BOARD_TOP puts it on the tile", (_, make) => {
    const box = bounds(make());
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeGreaterThan(0.02);
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

  // Harbours sit on the water just past the rim.
  const rim = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    const reach = extent.radius + 0.9;
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
      // The limiting axis should be at least half filled by the island itself.
      expect(Math.max(spanX, spanY)).toBeGreaterThan(0.5);
    },
  );
});
