import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardBounds } from "./layout3d.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * The sea around the island.
 *
 * Two planes: a flat deep colour, and a lighter one just above it that drifts
 * very slowly. It reads as water without any of the cost of a real water shader,
 * and it gives the board an edge so it does not float in a void.
 */
export function Water({
  bounds,
}: {
  readonly bounds: BoardBounds;
}): React.JSX.Element {
  const shimmer = useRef<THREE.Mesh>(null);
  const size = bounds.radius * 6;

  useFrame(({ clock }) => {
    const mesh = shimmer.current;
    if (mesh === null || prefersReducedMotion()) return;
    const t = clock.getElapsedTime();
    mesh.position.x = bounds.centre[0] + Math.sin(t * 0.06) * 0.35;
    mesh.position.z = bounds.centre[2] + Math.cos(t * 0.045) * 0.35;
  });

  return (
    <group>
      <mesh
        position={[bounds.centre[0], -0.18, bounds.centre[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <circleGeometry args={[size, 64]} />
        <meshStandardMaterial color="#1b4a70" roughness={0.35} metalness={0.1} />
      </mesh>

      <mesh
        ref={shimmer}
        position={[bounds.centre[0], -0.14, bounds.centre[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[bounds.radius * 2.1, 64]} />
        <meshStandardMaterial
          color="#2f7ba8"
          roughness={0.2}
          metalness={0.25}
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
  );
}
