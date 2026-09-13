import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph, TileId } from "@hexport/engine";
import { createHexTileGeometry } from "./geometries.js";
import { orderedTileIds, tilePosition } from "./layout3d.js";
import { color, TERRAIN_COLOR } from "./palette.js";

/**
 * The terrain, drawn as one instanced mesh.
 *
 * Nineteen tiles would survive as separate meshes, but the 5-6 player board and
 * the Seafarers maps are much larger, and the cost of getting this right once is
 * a single component.
 */
export function Tiles({
  board,
  highlighted,
  onPick,
}: {
  readonly board: BoardGraph;
  /** Tiles the robber may move to. */
  readonly highlighted: ReadonlySet<TileId>;
  readonly onPick?: ((tile: TileId) => void) | undefined;
}): React.JSX.Element {
  const geometry = useMemo(() => createHexTileGeometry(), []);
  const ids = useMemo(() => orderedTileIds(board), [board]);
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;

    const matrix = new THREE.Matrix4();
    ids.forEach((id, index) => {
      const tile = board.tiles[id];
      if (tile === undefined) return;
      const [x, y, z] = tilePosition(tile.coord);
      matrix.makeTranslation(x, y, z);
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, color(TERRAIN_COLOR[tile.terrain]));
    });

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
    instanced.computeBoundingSphere();
  }, [board, ids]);

  return (
    <group>
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, ids.length]}
        castShadow
        receiveShadow
        onPointerDown={(event) => {
          if (onPick === undefined) return;
          const index = event.instanceId;
          if (index === undefined) return;
          const id = ids[index];
          if (id === undefined) return;
          if (!highlighted.has(id)) return;
          event.stopPropagation();
          onPick(id);
        }}
      >
        <meshStandardMaterial roughness={0.82} metalness={0.02} />
      </instancedMesh>

      {/* Robber destinations get a lifted rim so they read as choosable. */}
      {[...highlighted].map((id) => {
        const tile = board.tiles[id];
        if (tile === undefined) return null;
        const [x, , z] = tilePosition(tile.coord);
        return <TileHalo key={id} x={x} z={z} />;
      })}
    </group>
  );
}

function TileHalo({
  x,
  z,
}: {
  readonly x: number;
  readonly z: number;
}): React.JSX.Element {
  return (
    <mesh position={[x, 0.13, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.64, 0.86, 6]} />
      <meshBasicMaterial
        color="#ffe9a8"
        transparent
        opacity={0.55}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
