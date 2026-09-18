import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph, Building, EdgeId, NodeId, PlayerId } from "@hexport/engine";
import {
  createCityGeometry,
  createRoadGeometry,
  createSettlementGeometry,
  createShipGeometry,
  ROAD_LENGTH,
} from "./geometries.js";
import { BOARD_TOP, edgeTransform, nodePosition, SEA_LEVEL } from "./layout3d.js";
import { color } from "./palette.js";
import { useGrowIn } from "./useGrowIn.js";

/**
 * Roads, settlements and cities.
 *
 * One instanced mesh per piece type, coloured per instance, plus a second
 * instanced "hull" drawn back-faces-only in near-black and slightly larger: a
 * cheap outline that keeps a white settlement legible on a pale field and a
 * green one on a forest. A piece that has just appeared grows into place.
 */

/** Roads stop short of the corners, so the buildings at each end stay clear. */
export const ROAD_SPAN = 0.8;
/** Road thickness and width, relative to the modelled plank. */
export const ROAD_BULK = 1.2;
/**
 * Buildings are modelled at a comfortable unit size and scaled up here: real
 * pieces are big against the hexes, and a settlement you have to squint at is
 * the opposite of what a board game wants.
 */
export const PIECE_SCALE = 1.38;
const OUTLINE = "#1a110a";

interface PieceInstance {
  readonly key: string;
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  readonly scale: THREE.Vector3;
  readonly color: string;
}

export function Roads({
  board,
  roads,
  colors,
}: {
  readonly board: BoardGraph;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly colors: readonly string[];
}): React.JSX.Element | null {
  const geometry = useMemo(() => createRoadGeometry(), []);
  const instances = useMemo(() => {
    const out: PieceInstance[] = [];
    for (const [edge, owner] of Object.entries(roads).sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const transform = edgeTransform(board, edge, BOARD_TOP);
      if (transform === null) continue;
      out.push({
        key: edge,
        position: new THREE.Vector3(...transform.position),
        rotationY: transform.rotationY,
        scale: new THREE.Vector3(
          (transform.length * ROAD_SPAN) / ROAD_LENGTH,
          ROAD_BULK,
          ROAD_BULK,
        ),
        color: colors[owner] ?? "#888888",
      });
    }
    return out;
  }, [board, roads, colors]);

  return (
    <PieceLayer geometry={geometry} instances={instances} outline={[1.04, 1.3, 1.35]} />
  );
}

/**
 * Ships, floating at sea level rather than standing on the board face.
 *
 * The height is the whole trick: a road sits on top of the tiles at BOARD_TOP,
 * while a ship belongs on the water, which is a good deal lower. Passing the
 * same edge through `edgeTransform` at a different height is all it takes, and
 * it is why a ship on a coastal edge reads as being in the water beside the
 * land rather than on it.
 */
export function Ships({
  board,
  ships,
  colors,
}: {
  readonly board: BoardGraph;
  readonly ships: Readonly<Record<EdgeId, { readonly player: PlayerId }>>;
  readonly colors: readonly string[];
}): React.JSX.Element | null {
  const geometry = useMemo(() => createShipGeometry(), []);
  const instances = useMemo(() => {
    const out: PieceInstance[] = [];
    for (const [edge, ship] of Object.entries(ships).sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const transform = edgeTransform(board, edge, SEA_LEVEL);
      if (transform === null) continue;
      out.push({
        key: edge,
        position: new THREE.Vector3(...transform.position),
        rotationY: transform.rotationY,
        scale: new THREE.Vector3(
          (transform.length * ROAD_SPAN) / ROAD_LENGTH,
          ROAD_BULK,
          ROAD_BULK,
        ),
        color: colors[ship.player] ?? "#888888",
      });
    }
    return out;
  }, [board, ships, colors]);

  return (
    <PieceLayer geometry={geometry} instances={instances} outline={[1.04, 1.24, 1.3]} />
  );
}

export function Buildings({
  buildings,
  colors,
}: {
  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly colors: readonly string[];
}): React.JSX.Element {
  const settlementGeometry = useMemo(() => createSettlementGeometry(), []);
  const cityGeometry = useMemo(() => createCityGeometry(), []);

  const [settlements, cities] = useMemo(() => {
    const make = (kind: Building["kind"]): PieceInstance[] =>
      Object.entries(buildings)
        .filter(([, b]) => b.kind === kind)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([node, b]) => ({
          key: node,
          position: new THREE.Vector3(...nodePosition(node, BOARD_TOP)),
          rotationY: 0,
          scale: new THREE.Vector3(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE),
          color: colors[b.player] ?? "#888888",
        }));
    return [make("settlement"), make("city")];
  }, [buildings, colors]);

  return (
    <>
      <PieceLayer
        geometry={settlementGeometry}
        instances={settlements}
        outline={[1.1, 1.07, 1.12]}
      />
      <PieceLayer
        geometry={cityGeometry}
        instances={cities}
        outline={[1.08, 1.05, 1.1]}
      />
    </>
  );
}

function PieceLayer({
  geometry,
  instances,
  outline,
}: {
  readonly geometry: THREE.BufferGeometry;
  readonly instances: readonly PieceInstance[];
  /** Hull scale relative to the piece, per axis. */
  readonly outline: readonly [number, number, number];
}): React.JSX.Element | null {
  const body = useRef<THREE.InstancedMesh>(null);
  const hull = useRef<THREE.InstancedMesh>(null);
  const grown = useGrowIn(instances.map((i) => i.key));

  useLayoutEffect(() => {
    const main = body.current;
    const rim = hull.current;
    if (main === null || rim === null) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    instances.forEach((piece, index) => {
      const t = grown.get(piece.key) ?? 1;
      quaternion.setFromEuler(euler.set(0, piece.rotationY, 0));

      scale.copy(piece.scale).multiplyScalar(t);
      matrix.compose(piece.position, quaternion, scale);
      main.setMatrixAt(index, matrix);
      main.setColorAt(index, color(piece.color));

      scale.set(
        piece.scale.x * outline[0] * t,
        piece.scale.y * outline[1] * t,
        piece.scale.z * outline[2] * t,
      );
      matrix.compose(piece.position, quaternion, scale);
      rim.setMatrixAt(index, matrix);
    });

    for (const mesh of [main, rim]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (main.instanceColor !== null) main.instanceColor.needsUpdate = true;
  }, [instances, grown, outline]);

  if (instances.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={body}
        args={[geometry, undefined, instances.length]}
        castShadow
        receiveShadow
        raycast={() => null}
      >
        {/* Vertex colours darken the roof; the instance colour is the seat. */}
        <meshStandardMaterial vertexColors roughness={0.5} metalness={0.02} />
      </instancedMesh>
      <instancedMesh
        ref={hull}
        args={[geometry, undefined, instances.length]}
        raycast={() => null}
      >
        <meshBasicMaterial color={OUTLINE} side={THREE.BackSide} />
      </instancedMesh>
    </group>
  );
}
