import { useEffect, useMemo, useRef } from "react";
import {
  OrbitControls,
  ContactShadows,
  AdaptiveDpr,
  Environment,
  Lightformer,
} from "@react-three/drei";

/** The imperative handle drei's OrbitControls exposes. */
export type OrbitHandle = React.ComponentRef<typeof OrbitControls>;
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD_TOP, cameraPose, type BoardBounds } from "./layout3d.js";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * Lighting, camera and controls.
 *
 * CLAUDE.md: clamped polar angle, bounded pan, damping on, never free-fly. A
 * board game camera that can end up under the table is a bug, not a feature.
 *
 * The look is late-afternoon light on a table: a warm key light from the upper
 * left casting soft shadows, a cool fill from the right, and a small studio
 * environment built from light panels for the reflections. That environment is
 * rendered locally — drei's presets download an HDR from a CDN at runtime,
 * which is a network dependency the game has no business having.
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

const INTRO_MS = 1500;

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

  // How far away "the whole board" is at this window shape. Zoom limits are
  // measured from it, so a tall phone view is not clamped.
  const fitDistance = useMemo(() => {
    const pose = cameraPose(bounds, aspect);
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    return Math.hypot(px - tx, py - ty, pz - tz);
  }, [bounds, aspect]);

  const intro = useRef<{ start: number; from: THREE.Vector3; to: THREE.Vector3 } | null>(
    null,
  );
  const introduced = useRef(false);

  // Frame the board on first load, on a different board, and when the window
  // changes shape. The first time, sweep in from higher and further out.
  useEffect(() => {
    frameCamera(camera, controlsRef.current, bounds);
    if (introduced.current || prefersReducedMotion()) {
      introduced.current = true;
      return;
    }
    introduced.current = true;
    const to = camera.position.clone();
    const from = to.clone().sub(target).multiplyScalar(1.55).add(target);
    from.x += bounds.radius * 0.6;
    from.y += bounds.radius * 0.5;
    camera.position.copy(from);
    intro.current = { start: performance.now(), from, to };
  }, [bounds, camera, aspect, controlsRef, target]);

  useFrame(() => {
    const flight = intro.current;
    if (flight === null) return;
    const t = Math.min(1, (performance.now() - flight.start) / INTRO_MS);
    const eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(flight.from, flight.to, eased);
    camera.lookAt(target);
    controlsRef.current?.update();
    if (t >= 1) intro.current = null;
  });

  return (
    <>
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.4} color="#ffd9a6" position={[-4, 6, 3]} scale={[8, 5, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#bcd4ff" position={[6, 3, -2]} scale={[6, 4, 1]} />
        <Lightformer form="ring" intensity={0.6} color="#fff3dd" position={[0, 8, 0]} scale={4} />
      </Environment>

      <hemisphereLight args={["#ffe9c9", "#3a2618", 0.75]} />

      {/* Key: warm, from the upper left, the one that casts shadows. */}
      <directionalLight
        position={[bounds.centre[0] - 6, 11, bounds.centre[2] + 6]}
        intensity={2.3}
        color="#ffe2b8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
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

      {/* Fill: cool, weak, from the right, so shadowed sides are not black. */}
      <directionalLight
        position={[bounds.centre[0] + 8, 5, bounds.centre[2] - 2]}
        intensity={0.45}
        color="#c4d6ff"
      />

      <ContactShadows
        position={[bounds.centre[0], BOARD_TOP + 0.002, bounds.centre[2]]}
        scale={bounds.radius * 3}
        resolution={1024}
        blur={2.2}
        opacity={0.5}
        far={1.2}
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
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.4}
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
