import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph, Terrain } from "@hexport/engine";
import {
  createClayGeometry,
  createDesertRockGeometry,
  createRockGeometry,
  createSheafGeometry,
  createSheepGeometry,
  createTreeGeometry,
} from "./geometries.js";
import { BOARD_TOP, hexCornerOffsets, orderedTileIds, tilePosition } from "./layout3d.js";
import { seeded } from "./textures.js";
import { TILE_SCALE } from "./Tiles.js";

/**
 * Scenery on the tiles: trees in forests, peaks on mountains, sheep on pasture,
 * sheaves in fields, clay pits on hills, stones in the desert.
 *
 * Purely decorative, and the fastest way to tell terrain apart at a glance —
 * the reason a physical board is illustrated at all. Props keep clear of the
 * number token in the middle and of the corners where settlements stand, and
 * never take a click.
 *
 * Placement is seeded by tile id, so the same board always looks the same.
 */

interface PropKind {
  readonly make: () => THREE.BufferGeometry;
  readonly count: number;
  readonly scale: readonly [number, number];
}

const PROPS: Partial<Record<Terrain, PropKind>> = {
  forest: { make: createTreeGeometry, count: 8, scale: [0.85, 1.3] },
  mountain: { make: createRockGeometry, count: 3, scale: [0.85, 1.2] },
  pasture: { make: createSheepGeometry, count: 3, scale: [0.95, 1.15] },
  field: { make: createSheafGeometry, count: 5, scale: [0.85, 1.15] },
  hill: { make: createClayGeometry, count: 2, scale: [0.95, 1.15] },
  desert: { make: createDesertRockGeometry, count: 3, scale: [0.7, 1.2] },
};

/** Keep this far from the tile centre: the number token lives there. */
const INNER = 0.47;
const OUTER = 0.74;
/** And this far from any corner: that is where settlements go. */
const CORNER_CLEARANCE = 0.3;

export function Props({ board }: { readonly board: BoardGraph }): React.JSX.Element {
  const layers = useMemo(() => {
    const corners = hexCornerOffsets().map(
      ([x, z]) => [x * TILE_SCALE, z * TILE_SCALE] as const,
    );
    const out = new Map<Terrain, THREE.Matrix4[]>();

    for (const id of orderedTileIds(board)) {
      const tile = board.tiles[id];
      if (tile === undefined) continue;
      const kind = PROPS[tile.terrain];
      if (kind === undefined) continue;

      const random = seeded(id);
      const [cx, , cz] = tilePosition(tile.coord);
      const placed: [number, number][] = [];
      const list = out.get(tile.terrain) ?? [];

      for (let attempt = 0; attempt < 60 && placed.length < kind.count; attempt++) {
        const angle = random() * Math.PI * 2;
        const radius = INNER + random() * (OUTER - INNER);
        const px = Math.cos(angle) * radius;
        const pz = Math.sin(angle) * radius;

        if (corners.some(([x, z]) => Math.hypot(px - x, pz - z) < CORNER_CLEARANCE)) continue;
        if (placed.some(([x, z]) => Math.hypot(px - x, pz - z) < 0.16)) continue;
        placed.push([px, pz]);

        const s = kind.scale[0] + random() * (kind.scale[1] - kind.scale[0]);
        list.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(cx + px, BOARD_TOP, cz + pz),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0)),
            new THREE.Vector3(s, s, s),
          ),
        );
      }
      out.set(tile.terrain, list);
    }
    return [...out.entries()];
  }, [board]);

  return (
    <group>
      {layers.map(([terrain, matrices]) => {
        const kind = PROPS[terrain];
        if (kind === undefined || matrices.length === 0) return null;
        return <PropLayer key={terrain} make={kind.make} matrices={matrices} />;
      })}
    </group>
  );
}

function PropLayer({
  make,
  matrices,
}: {
  readonly make: () => THREE.BufferGeometry;
  readonly matrices: readonly THREE.Matrix4[];
}): React.JSX.Element {
  const geometry = useMemo(make, [make]);
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;
    matrices.forEach((matrix, index) => {
      instanced.setMatrixAt(index, matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [matrices]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, matrices.length]}
      castShadow
      receiveShadow
      raycast={() => null}
    >
      <meshStandardMaterial vertexColors roughness={0.85} metalness={0} flatShading />
    </instancedMesh>
  );
}
