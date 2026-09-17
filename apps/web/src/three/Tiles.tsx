import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { prefersReducedMotion } from "../ui/motion.js";
import type { BoardGraph, Terrain, TileId } from "@hexport/engine";
import { createHexTileGeometry, createShoreGeometry } from "./geometries.js";
import { BOARD_TOP, orderedTileIds, tilePosition } from "./layout3d.js";
import { TERRAIN_SIDE } from "./palette.js";
import { terrainTexture } from "./textures.js";

/**
 * The terrain.
 *
 * One instanced mesh per terrain type, so each can carry its own painted
 * texture while every tile of a kind is still a single draw call. Tiles are set
 * very slightly apart over a sand base, the way cardboard hexes sit in a real
 * frame; the seams make the grid legible without drawing lines on it.
 */

/** Tiles are inset a little so the sand between them shows. */
export const TILE_SCALE = 0.955;

export function Tiles({
  board,
  highlighted,
  producing,
  onPick,
}: {
  readonly board: BoardGraph;
  /** Tiles the robber may move to. */
  readonly highlighted: ReadonlySet<TileId>;
  /** Tiles that just paid out, flashed for a moment after the roll. */
  readonly producing?: ReadonlySet<TileId> | undefined;
  readonly onPick?: ((tile: TileId) => void) | undefined;
}): React.JSX.Element {
  const tileGeometry = useMemo(() => createHexTileGeometry(), []);
  const shoreGeometry = useMemo(() => createShoreGeometry(), []);
  const ids = useMemo(() => orderedTileIds(board), [board]);

  const byTerrain = useMemo(() => {
    const groups = new Map<Terrain, TileId[]>();
    for (const id of ids) {
      const tile = board.tiles[id];
      if (tile === undefined) continue;
      const list = groups.get(tile.terrain) ?? [];
      list.push(id);
      groups.set(tile.terrain, list);
    }
    return [...groups.entries()];
  }, [board, ids]);

  return (
    <group>
      <Shore board={board} ids={ids} geometry={shoreGeometry} />

      {byTerrain.map(([terrain, list]) => (
        <TerrainLayer
          key={terrain}
          board={board}
          terrain={terrain}
          ids={list}
          geometry={tileGeometry}
          highlighted={highlighted}
          onPick={onPick}
        />
      ))}

      {/* Robber destinations get a lifted rim so they read as choosable. */}
      {[...highlighted].map((id) => {
        const tile = board.tiles[id];
        if (tile === undefined) return null;
        const [x, , z] = tilePosition(tile.coord);
        return <TileHalo key={id} x={x} z={z} />;
      })}

      {/* Hexes that just produced, so a roll is visible on the board and not
          only in the log. */}
      {[...(producing ?? [])].map((id) => {
        const tile = board.tiles[id];
        if (tile === undefined) return null;
        const [x, , z] = tilePosition(tile.coord);
        return <ProductionFlash key={`p-${id}`} x={x} z={z} />;
      })}
    </group>
  );
}

function TerrainLayer({
  board,
  terrain,
  ids,
  geometry,
  highlighted,
  onPick,
}: {
  readonly board: BoardGraph;
  readonly terrain: Terrain;
  readonly ids: readonly TileId[];
  readonly geometry: THREE.BufferGeometry;
  readonly highlighted: ReadonlySet<TileId>;
  readonly onPick?: ((tile: TileId) => void) | undefined;
}): React.JSX.Element {
  const mesh = useRef<THREE.InstancedMesh>(null);

  // Group 0 of the slab is its top and bottom, group 1 the bevelled sides.
  const materials = useMemo(() => {
    const map = terrainTexture(terrain);
    // The top face's UVs are the shape's own coordinates, -1..1 for a unit hex.
    map.repeat.set(0.5, 0.5);
    map.offset.set(0.5, 0.5);
    return [
      new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({
        color: TERRAIN_SIDE[terrain],
        roughness: 0.95,
        metalness: 0,
      }),
    ];
  }, [terrain]);

  useEffect(
    () => () => {
      for (const material of materials) material.dispose();
    },
    [materials],
  );

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(TILE_SCALE, 1, TILE_SCALE);
    const identity = new THREE.Quaternion();

    ids.forEach((id, index) => {
      const tile = board.tiles[id];
      if (tile === undefined) return;
      position.set(...tilePosition(tile.coord));
      matrix.compose(position, identity, scale);
      instanced.setMatrixAt(index, matrix);
    });

    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [board, ids]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, materials, ids.length]}
      castShadow
      receiveShadow
      onPointerOver={(event) => {
        const id = event.instanceId === undefined ? undefined : ids[event.instanceId];
        if (id !== undefined && highlighted.has(id)) document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
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
    />
  );
}

/** Sand under the tiles, showing in the seams between them. */
function Shore({
  board,
  ids,
  geometry,
}: {
  readonly board: BoardGraph;
  readonly ids: readonly TileId[];
  readonly geometry: THREE.BufferGeometry;
}): React.JSX.Element {
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
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [board, ids]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, ids.length]}
      receiveShadow
      raycast={() => null}
    >
      <meshStandardMaterial color="#d8c08e" roughness={1} />
    </instancedMesh>
  );
}

/** A bright hex outline that fades as it lifts, for a hex that just paid out. */
function ProductionFlash({
  x,
  z,
}: {
  readonly x: number;
  readonly z: number;
}): React.JSX.Element {
  const mesh = useRef<THREE.Mesh>(null);
  const born = useRef(0);

  useFrame(({ clock }) => {
    const current = mesh.current;
    if (current === null) return;
    if (born.current === 0) born.current = clock.getElapsedTime();

    const age = clock.getElapsedTime() - born.current;
    const material = current.material as THREE.MeshBasicMaterial;
    if (prefersReducedMotion()) {
      material.opacity = age < 0.9 ? 0.5 : 0;
      return;
    }
    const t = Math.min(1, age / 1.1);
    material.opacity = 0.85 * (1 - t);
    current.position.y = BOARD_TOP + 0.012 + t * 0.12;
    current.scale.setScalar(1 + t * 0.14);
  });

  return (
    <mesh
      ref={mesh}
      position={[x, BOARD_TOP + 0.012, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <ringGeometry args={[0.72, 0.95, 6, 1, Math.PI / 6]} />
      <meshBasicMaterial
        color="#ffe9b0"
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
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
    <mesh position={[x, BOARD_TOP + 0.01, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.66, 0.84, 6, 1, Math.PI / 6]} />
      <meshBasicMaterial
        color="#ffe3a0"
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
