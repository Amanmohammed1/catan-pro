import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardGraph, TileId } from "@hexport/engine";
import { createRobberGeometry } from "./geometries.js";
import { BOARD_TOP, tilePosition } from "./layout3d.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * The robber.
 *
 * It slides between hexes rather than teleporting, and hops slightly as it goes.
 * Which hex it sits on decides whether a player's best number pays out, so the
 * move is worth making legible.
 */
export function Robber({
  board,
  tile,
}: {
  readonly board: BoardGraph;
  readonly tile: TileId;
}): React.JSX.Element | null {
  const geometry = useMemo(() => createRobberGeometry(), []);
  const mesh = useRef<THREE.Mesh>(null);
  const from = useRef<THREE.Vector3 | null>(null);
  const to = useRef(new THREE.Vector3());
  const startedAt = useRef(0);

  const target = useMemo(() => {
    const hex = board.tiles[tile];
    if (hex === undefined) return null;
    const [x, , z] = tilePosition(hex.coord);
    return new THREE.Vector3(x, BOARD_TOP, z);
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

    const t = Math.min(1, (performance.now() - startedAt.current) / 520);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    current.position.lerpVectors(from.current, to.current, eased);
    // A single arc, highest halfway across.
    current.position.y = BOARD_TOP + Math.sin(eased * Math.PI) * 0.55;

    if (t >= 1) {
      startedAt.current = 0;
      current.position.copy(to.current);
    }
  });

  if (target === null) return null;

  return (
    <mesh ref={mesh} geometry={geometry} castShadow position={target}>
      <meshStandardMaterial color="#25221f" roughness={0.4} metalness={0.25} />
    </mesh>
  );
}
