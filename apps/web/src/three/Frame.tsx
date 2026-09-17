import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardGraph } from "@hexport/engine";
import {
  BOARD_TOP,
  FRAME_WIDTH,
  SEA_LEVEL,
  SEA_WIDTH,
  islandOutline,
  offsetOutline,
} from "./layout3d.js";
import { tableTexture, waterTexture, woodTexture } from "./textures.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * The sea, its wooden frame, and the table the whole board sits on.
 *
 * Shaped from the island's own outline, so any board — the classic island, the
 * wider 5–6 player map, a Seafarers archipelago — gets a sea of even width and
 * a frame that fits. The sea drifts very slowly; under reduced motion it holds
 * still.
 */

type Point2 = readonly [number, number];

/** A THREE.Shape from XZ points. Shapes live in XY and are laid flat later. */
function shapeOf(points: readonly Point2[]): THREE.Shape {
  const shape = new THREE.Shape();
  // Rotating a shape -90° about X sends its y to world -z, so feed it -z.
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return shape;
}

function pathOf(points: readonly Point2[]): THREE.Path {
  const path = new THREE.Path();
  points.forEach(([x, z], index) => {
    if (index === 0) path.moveTo(x, -z);
    else path.lineTo(x, -z);
  });
  path.closePath();
  return path;
}

export function Frame({ board }: { readonly board: BoardGraph }): React.JSX.Element {
  const outline = useMemo(() => islandOutline(board), [board]);

  const { sea, shallows, frame } = useMemo(() => {
    const seaEdge = offsetOutline(outline, SEA_WIDTH);
    const frameOuter = offsetOutline(outline, SEA_WIDTH + FRAME_WIDTH);

    const seaGeometry = new THREE.ShapeGeometry(shapeOf(seaEdge), 1);
    seaGeometry.rotateX(-Math.PI / 2);

    const shallowGeometry = new THREE.ShapeGeometry(shapeOf(offsetOutline(outline, 0.32)), 1);
    shallowGeometry.rotateX(-Math.PI / 2);

    const ring = shapeOf(frameOuter);
    ring.holes.push(pathOf([...seaEdge].reverse()));
    const height = BOARD_TOP + 0.03;
    const bevel = 0.03;
    const frameGeometry = new THREE.ExtrudeGeometry(ring, {
      depth: height - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 2,
      curveSegments: 4,
    });
    frameGeometry.rotateX(-Math.PI / 2);
    frameGeometry.translate(0, bevel, 0);
    frameGeometry.computeVertexNormals();

    return { sea: seaGeometry, shallows: shallowGeometry, frame: frameGeometry };
  }, [outline]);

  useEffect(
    () => () => {
      sea.dispose();
      shallows.dispose();
      frame.dispose();
    },
    [sea, shallows, frame],
  );

  const water = useMemo(() => {
    const texture = waterTexture();
    texture.repeat.set(0.45, 0.45);
    return texture;
  }, []);
  const wood = useMemo(() => {
    const texture = woodTexture();
    texture.repeat.set(0.55, 1.6);
    return texture;
  }, []);
  const table = useMemo(() => {
    const texture = tableTexture();
    texture.repeat.set(10, 10);
    return texture;
  }, []);

  useFrame(({ clock }) => {
    if (prefersReducedMotion()) return;
    const t = clock.getElapsedTime();
    water.offset.set(t * 0.006, Math.sin(t * 0.1) * 0.02);
  });

  return (
    <group>
      {/* The table. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial map={table} roughness={0.7} metalness={0.05} />
      </mesh>

      {/* Open water, and the lighter shallows hugging the coast. */}
      <mesh geometry={sea} position={[0, SEA_LEVEL, 0]} receiveShadow raycast={() => null}>
        <meshStandardMaterial map={water} color="#cfe6f2" roughness={0.28} metalness={0.12} />
      </mesh>
      <mesh geometry={shallows} position={[0, SEA_LEVEL + 0.003, 0]} raycast={() => null}>
        <meshStandardMaterial
          color="#7cc0d8"
          transparent
          opacity={0.38}
          roughness={0.3}
          depthWrite={false}
        />
      </mesh>

      {/* The routed wooden frame. */}
      <mesh geometry={frame} castShadow receiveShadow raycast={() => null}>
        <meshStandardMaterial map={wood} roughness={0.62} metalness={0.02} />
      </mesh>
    </group>
  );
}
