import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardGraph, TileId } from "@hexport/engine";
import { createRobberGeometry } from "./geometries.js";
import { SEA_LEVEL, tilePosition } from "./layout3d.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * The pirate.
 *
 * The robber's counterpart at sea (Seafarers p.2): it sits on a sea hex, stops
 * ships being built on that hex's edges, and steals from a ship there rather
 * than from a building. Like the robber it slides rather than teleports, since
 * where it lands decides whose fleet is stuck.
 *
 * Nullable, unlike the robber, because a scenario need not place one and a base
 * game never has one at all.
 *
 * It shares the robber's silhouette in a colder colour rather than getting a
 * shape of its own. The two are the same piece in the player's mind — the thing
 * blocking you — and the hex it stands on already says which is which.
 */
export function Pirate({
  board,
  tile,
}: {
  readonly board: BoardGraph;
  readonly tile: TileId | null;
}): React.JSX.Element | null {
  const geometry = useMemo(() => createRobberGeometry(), []);
  const mesh = useRef<THREE.Mesh>(null);
  const from = useRef<THREE.Vector3 | null>(null);
  const to = useRef(new THREE.Vector3());
  const startedAt = useRef(0);

  const target = useMemo(() => {
    if (tile === null) return null;
    const hex = board.tiles[tile];
    if (hex === undefined) return null;
    const [x, , z] = tilePosition(hex.coord);
    return new THREE.Vector3(x, SEA_LEVEL, z);
  }, [board, tile]);

  useEffect(() => {
    if (target === null) return;
    const current = mesh.current;
    if (current === null) return;

    if (from.current === null || prefersReducedMotion()) {
      current.position.copy(target);
      from.current = target.clone();
      to.current.copy(target);
      startedAt.current = 0;
      return;
    }

    from.current = current.position.clone();
    to.current.copy(target);
    startedAt.current = performance.now();
  }, [target]);

  useFrame(() => {
    const current = mesh.current;
    if (current === null || startedAt.current === 0 || from.current === null) {
      return;
    }

    const t = Math.min(1, (performance.now() - startedAt.current) / 620);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    current.position.lerpVectors(from.current, to.current, eased);
    // It sails rather than hops: a shallower arc than the robber's, and it
    // never rises far above the water.
    current.position.y = SEA_LEVEL + Math.sin(eased * Math.PI) * 0.22;

    if (t >= 1) {
      startedAt.current = 0;
      current.position.copy(to.current);
    }
  });

  if (target === null) return null;

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      castShadow
      position={target}
      raycast={() => null}
    >
      <meshStandardMaterial color="#1f2b33" roughness={0.38} metalness={0.28} />
    </mesh>
  );
}
