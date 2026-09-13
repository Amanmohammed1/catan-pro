import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardGraph, EdgeId, NodeId } from "@hexport/engine";
import {
  createCityGeometry,
  createRoadGeometry,
  createSettlementGeometry,
} from "./geometries.js";
import { BOARD_TOP, edgeTransform, nodePosition } from "./layout3d.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * Placement targets and the ghost piece.
 *
 * CLAUDE.md: "Click targets are invisible proxy meshes (spheres at nodes,
 * capsules at edges), ~1.5x the visual size, mounted only when a placement mode
 * is active." Both halves of that matter. The generous proxy makes a small
 * wooden house clickable without pixel-hunting; mounting only on demand keeps
 * every other click going to the board, so the camera still drags freely.
 *
 * What may be placed is decided entirely by the caller from legalMoves. This
 * component knows nothing about the distance rule or what a road costs.
 */

export type PlacementKind = "settlement" | "city" | "road";

export function NodePlacements({
  nodes,
  kind,
  color,
  onPick,
}: {
  readonly nodes: ReadonlySet<NodeId>;
  readonly kind: "settlement" | "city";
  readonly color: string;
  readonly onPick: (node: NodeId) => void;
}): React.JSX.Element | null {
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const list = useMemo(() => [...nodes], [nodes]);
  const ghost = useMemo(
    () => (kind === "city" ? createCityGeometry() : createSettlementGeometry()),
    [kind],
  );

  if (list.length === 0) return null;

  return (
    <group>
      {list.map((node) => {
        const [x, y, z] = nodePosition(node, BOARD_TOP);
        const isHovered = hovered === node;
        return (
          <group key={node} position={[x, y, z]}>
            <Pulse visible={!isHovered} color={color} />

            {isHovered && (
              <mesh geometry={ghost} scale={1}>
                <meshStandardMaterial
                  color={color}
                  transparent
                  opacity={0.62}
                  roughness={0.4}
                  emissive={color}
                  emissiveIntensity={0.35}
                />
              </mesh>
            )}

            {/* The proxy: invisible, generous, and the only thing that is
                actually clickable. */}
            <mesh
              onPointerOver={(event) => {
                event.stopPropagation();
                setHovered(node);
              }}
              onPointerOut={() => {
                setHovered((current) => (current === node ? null : current));
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onPick(node);
              }}
            >
              <sphereGeometry args={[0.3, 12, 10]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function EdgePlacements({
  board,
  edges,
  color,
  onPick,
}: {
  readonly board: BoardGraph;
  readonly edges: ReadonlySet<EdgeId>;
  readonly color: string;
  readonly onPick: (edge: EdgeId) => void;
}): React.JSX.Element | null {
  const [hovered, setHovered] = useState<EdgeId | null>(null);
  const list = useMemo(() => [...edges], [edges]);
  const ghost = useMemo(() => createRoadGeometry(), []);

  if (list.length === 0) return null;

  return (
    <group>
      {list.map((edge) => {
        const transform = edgeTransform(board, edge, BOARD_TOP + 0.01);
        if (transform === null) return null;
        const isHovered = hovered === edge;

        return (
          <group
            key={edge}
            position={[...transform.position]}
            rotation={[0, transform.rotationY, 0]}
          >
            <mesh
              geometry={ghost}
              scale={[
                transform.length / 0.62,
                isHovered ? 1 : 0.42,
                isHovered ? 1 : 0.5,
              ]}
            >
              <meshStandardMaterial
                color={color}
                transparent
                opacity={isHovered ? 0.75 : 0.34}
                emissive={color}
                emissiveIntensity={isHovered ? 0.45 : 0.2}
                roughness={0.4}
              />
            </mesh>

            {/* Capsule proxy, wider than the road so it is easy to hit. */}
            <mesh
              rotation={[0, 0, Math.PI / 2]}
              onPointerOver={(event) => {
                event.stopPropagation();
                setHovered(edge);
              }}
              onPointerOut={() => {
                setHovered((current) => (current === edge ? null : current));
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onPick(edge);
              }}
            >
              <capsuleGeometry args={[0.14, transform.length * 0.7, 4, 8]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** A slow ring pulse marking a spot you could take. */
function Pulse({
  visible,
  color,
}: {
  readonly visible: boolean;
  readonly color: string;
}): React.JSX.Element {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const current = mesh.current;
    if (current === null) return;
    if (prefersReducedMotion()) {
      current.scale.setScalar(1);
      return;
    }
    // Everything pulses on the same clock, so the board breathes together
    // rather than flickering at random.
    const t = clock.getElapsedTime();
    current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.13);
  });

  return (
    <mesh
      ref={mesh}
      visible={visible}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.02, 0]}
    >
      <ringGeometry args={[0.11, 0.17, 24]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.9}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
