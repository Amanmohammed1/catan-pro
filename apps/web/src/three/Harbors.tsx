import { useMemo } from "react";
import * as THREE from "three";
import type { BoardGraph } from "@hexport/engine";
import { BOARD_TOP, edgeTransform, nodePosition } from "./layout3d.js";

/**
 * Harbours.
 *
 * Drawn as a jetty on the water with two moorings reaching the intersections
 * that control it, so it is obvious *which* two spots give you the rate. The
 * ratio itself is labelled in the DOM inspector rather than in WebGL text.
 */
export function Harbors({
  board,
}: {
  readonly board: BoardGraph;
}): React.JSX.Element {
  const ports = useMemo(() => Object.values(board.ports), [board]);

  return (
    <group>
      {ports.map((port) => {
        const transform = edgeTransform(board, port.edge, BOARD_TOP);
        if (transform === null) return null;

        const [ax, , az] = nodePosition(port.nodes[0], BOARD_TOP);
        const [bx, , bz] = nodePosition(port.nodes[1], BOARD_TOP);
        const [cx, , cz] = transform.position;

        // Push the jetty away from the board centre so it sits on the water.
        const outward = new THREE.Vector3(cx, 0, cz).normalize().multiplyScalar(0.55);
        const jetty: [number, number, number] = [
          cx + outward.x,
          BOARD_TOP - 0.06,
          cz + outward.z,
        ];

        const generic = port.kind === "generic";
        const color = generic ? "#b08a4f" : "#c96a3c";

        return (
          <group key={port.id}>
            <mesh position={jetty} rotation={[0, transform.rotationY, 0]} castShadow>
              <boxGeometry args={[0.5, 0.07, 0.34]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
            <Mooring from={[ax, BOARD_TOP, az]} to={jetty} color={color} />
            <Mooring from={[bx, BOARD_TOP, bz]} to={jetty} color={color} />
          </group>
        );
      })}
    </group>
  );
}

/** A plank from a harbour to one of the intersections that controls it. */
function Mooring({
  from,
  to,
  color,
}: {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly color: string;
}): React.JSX.Element {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);

  return (
    <mesh
      position={[(from[0] + to[0]) / 2, BOARD_TOP - 0.05, (from[2] + to[2]) / 2]}
      rotation={[0, -Math.atan2(dz, dx), 0]}
    >
      <boxGeometry args={[length, 0.035, 0.07]} />
      <meshStandardMaterial color={color} roughness={0.8} opacity={0.85} transparent />
    </mesh>
  );
}
