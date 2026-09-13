import { useEffect, useMemo } from "react";
import {
  OrbitControls,
  ContactShadows,
  AdaptiveDpr,
  Environment,
} from "@react-three/drei";

/** The imperative handle drei's OrbitControls exposes. */
export type OrbitHandle = React.ComponentRef<typeof OrbitControls>;
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD_TOP, cameraPose, type BoardBounds } from "./layout3d.js";

/**
 * Lighting, camera and controls.
 *
 * CLAUDE.md: clamped polar angle, bounded pan, damping on, never free-fly. A
 * board game camera that can end up under the table is a bug, not a feature.
 *
 * The look is a preset environment for soft ambient colour, one directional key
 * light for shadows with direction, and contact shadows to sit the pieces on the
 * board. Per-piece realtime shadows are deliberately not used: they are the
 * single biggest cost on integrated graphics and buy almost nothing here.
 */

export interface CameraHandle {
  reset: () => void;
}

/**
 * Put the camera where the whole board fits the current viewport.
 *
 * Shared by the first framing and the "Reset view" button, so both agree on what
 * "the whole board" means at any window shape, a phone included.
 */
export function frameCamera(
  camera: THREE.Camera,
  controls: OrbitHandle | null,
  bounds: BoardBounds,
): void {
  const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1.5;
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : undefined;
  const pose = cameraPose(bounds, aspect, fov);

  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  if (controls !== null) {
    controls.target.set(...pose.target);
    controls.update();
  }
}

export function Scene({
  bounds,
  controlsRef,
}: {
  readonly bounds: BoardBounds;
  readonly controlsRef: React.RefObject<OrbitHandle | null>;
}): React.JSX.Element {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const target = useMemo(
    () => new THREE.Vector3(bounds.centre[0], 0, bounds.centre[2]),
    [bounds],
  );

  // How far away "the whole board" is at this window shape. Zoom limits and fog
  // are measured from it, so a tall phone view is not clamped or fogged out.
  const fitDistance = useMemo(() => {
    const pose = cameraPose(bounds, aspect);
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    return Math.hypot(px - tx, py - ty, pz - tz);
  }, [bounds, aspect]);

  // Frame the board on first load, on a different board, and when the window
  // changes shape.
  useEffect(() => {
    frameCamera(camera, controlsRef.current, bounds);
  }, [bounds, camera, aspect, controlsRef]);

  return (
    <>
      <fog attach="fog" args={["#0d1b28", fitDistance * 1.6, fitDistance * 3.2]} />
      <Environment preset="sunset" environmentIntensity={0.55} />

      <hemisphereLight args={["#cfe4ff", "#3a2f26", 0.55]} />

      <directionalLight
        position={[bounds.centre[0] + 7, 12, bounds.centre[2] + 5]}
        intensity={2.1}
        color="#fff2dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      >
        {/* A tight shadow frustum around the board keeps the map crisp without
            paying for a large one. */}
        <orthographicCamera
          attach="shadow-camera"
          args={[
            -bounds.radius - 3,
            bounds.radius + 3,
            bounds.radius + 3,
            -bounds.radius - 3,
            1,
            40,
          ]}
        />
      </directionalLight>

      <ContactShadows
        position={[bounds.centre[0], BOARD_TOP + 0.002, bounds.centre[2]]}
        scale={bounds.radius * 3}
        resolution={1024}
        blur={2.4}
        opacity={0.42}
        far={4}
        frames={1}
      />

      <OrbitControls
        ref={controlsRef}
        target={target}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.65}
        zoomSpeed={0.8}
        panSpeed={0.7}
        // Never below the horizon, never straight down: both make the board
        // unreadable and are easy to reach by accident on a trackpad.
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2.35}
        minDistance={Math.max(4, bounds.radius * 0.8)}
        maxDistance={Math.max(bounds.radius * 4, fitDistance * 1.35)}
        // Pan across the table, not up out of it.
        screenSpacePanning={false}
        makeDefault
      />

      {/* Drop resolution rather than frames when the GPU is struggling. */}
      <AdaptiveDpr pixelated />
    </>
  );
}
