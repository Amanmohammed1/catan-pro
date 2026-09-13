import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph, Building, EdgeId, NodeId, PlayerId } from "@hexport/engine";
import {
  createCityGeometry,
  createRoadGeometry,
  createSettlementGeometry,
} from "./geometries.js";
import { BOARD_TOP, edgeTransform, nodePosition } from "./layout3d.js";
import { color } from "./palette.js";
import { useGrowIn } from "./useGrowIn.js";

/**
 * Roads, settlements and cities.
 *
 * One instanced mesh per piece type, coloured per instance. A piece that has
 * just appeared grows into place; see `useGrowIn`.
 */

const SETTLE_SCALE = 1;

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
  const entries = useMemo(
    () => Object.entries(roads).sort(([a], [b]) => (a < b ? -1 : 1)),
    [roads],
  );
  const mesh = useRef<THREE.InstancedMesh>(null);
  const grown = useGrowIn(entries.map(([edge]) => edge));

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    entries.forEach(([edge, owner], index) => {
      const transform = edgeTransform(board, edge, BOARD_TOP + 0.005);
      if (transform === null) return;

      position.set(...transform.position);
      quaternion.setFromEuler(new THREE.Euler(0, transform.rotationY, 0));
      // Roads stretch to exactly span their path, whatever the board scale.
      const t = grown.get(edge) ?? 1;
      scale.set(transform.length / 0.62, t, 1);

      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, color(colors[owner] ?? "#888"));
    });

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
    instanced.computeBoundingSphere();
  }, [board, entries, colors, grown]);

  if (entries.length === 0) return null;

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, entries.length]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial roughness={0.55} metalness={0.05} />
    </instancedMesh>
  );
}

export function Buildings({
  buildings,
  colors,
}: {
  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly colors: readonly string[];
}): React.JSX.Element {
  const settlements = useMemo(
    () =>
      Object.entries(buildings)
        .filter(([, b]) => b.kind === "settlement")
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    [buildings],
  );
  const cities = useMemo(
    () =>
      Object.entries(buildings)
        .filter(([, b]) => b.kind === "city")
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    [buildings],
  );

  return (
    <>
      <BuildingLayer
        entries={settlements}
        colors={colors}
        make={createSettlementGeometry}
      />
      <BuildingLayer entries={cities} colors={colors} make={createCityGeometry} />
    </>
  );
}

function BuildingLayer({
  entries,
  colors,
  make,
}: {
  readonly entries: readonly (readonly [string, Building])[];
  readonly colors: readonly string[];
  readonly make: () => THREE.BufferGeometry;
}): React.JSX.Element | null {
  const geometry = useMemo(make, [make]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const grown = useGrowIn(entries.map(([node]) => node));

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    entries.forEach(([node, building], index) => {
      const [x, y, z] = nodePosition(node, BOARD_TOP);
      position.set(x, y, z);
      quaternion.identity();
      const t = grown.get(node) ?? 1;
      // Overshoot slightly on the way in: the piece lands rather than appears.
      scale.setScalar(SETTLE_SCALE * t);

      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, color(colors[building.player] ?? "#888"));
    });

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
    instanced.computeBoundingSphere();
  }, [entries, colors, grown]);

  if (entries.length === 0) return null;

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, entries.length]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial roughness={0.45} metalness={0.08} />
    </instancedMesh>
  );
}
