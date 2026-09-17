import { useMemo } from "react";
import * as THREE from "three";
import type { BoardGraph } from "@hexport/engine";
import { BOARD_TOP, SEA_LEVEL, edgeTransform, nodePosition, tilePosition } from "./layout3d.js";
import { harborSignTexture } from "./textures.js";
import { useFontKey } from "./useFontKey.js";

/**
 * Harbours.
 *
 * A wooden pier out on the water, with two gangplanks reaching the two
 * intersections that control it, so it is obvious *which* spots give you the
 * rate. A round sign on the pier prints the rate and the resource it trades,
 * laid face up and upright to the default camera, like a token.
 */

const WOOD = "#9a6a3c";
const WOOD_DARK = "#6b4424";
/** How far out on the water the pier sits, from the coastline. */
const REACH = 0.56;
const SIGN_RADIUS = 0.25;

export function Harbors({ board }: { readonly board: BoardGraph }): React.JSX.Element {
  const fontKey = useFontKey();
  const sign = useMemo(() => {
    const geometry = new THREE.CircleGeometry(SIGN_RADIUS, 40);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }, []);

  // Push piers away from the island's middle, whatever the board's shape.
  const centre = useMemo(() => {
    const tiles = Object.values(board.tiles);
    let x = 0;
    let z = 0;
    for (const tile of tiles) {
      const [tx, , tz] = tilePosition(tile.coord);
      x += tx;
      z += tz;
    }
    return new THREE.Vector3(x / Math.max(1, tiles.length), 0, z / Math.max(1, tiles.length));
  }, [board]);

  const piers = useMemo(
    () =>
      Object.values(board.ports).flatMap((port) => {
        const transform = edgeTransform(board, port.edge, BOARD_TOP);
        if (transform === null) return [];
        const [cx, , cz] = transform.position;
        const outward = new THREE.Vector3(cx - centre.x, 0, cz - centre.z)
          .normalize()
          .multiplyScalar(REACH);
        const deckY = SEA_LEVEL + 0.07;
        return [
          {
            id: port.id,
            deck: [cx + outward.x, deckY, cz + outward.z] as const,
            rotationY: transform.rotationY,
            a: nodePosition(port.nodes[0], BOARD_TOP),
            b: nodePosition(port.nodes[1], BOARD_TOP),
            texture: harborSignTexture(
              port.kind === "generic" ? null : port.resource,
              port.ratio,
              fontKey,
            ),
          },
        ];
      }),
    [board, centre, fontKey],
  );

  return (
    <group>
      {piers.map((pier) => (
        <group key={pier.id}>
          {/* Deck and the posts it stands on. */}
          <mesh position={[...pier.deck]} rotation={[0, pier.rotationY, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.6, 0.045, 0.56]} />
            <meshStandardMaterial color={WOOD} roughness={0.8} />
          </mesh>
          {[
            [-0.27, -0.24],
            [0.27, -0.24],
            [-0.27, 0.24],
            [0.27, 0.24],
          ].map(([dx, dz]) => {
            const c = Math.cos(pier.rotationY);
            const s = Math.sin(pier.rotationY);
            const x = pier.deck[0] + (dx ?? 0) * c + (dz ?? 0) * s;
            const z = pier.deck[2] - (dx ?? 0) * s + (dz ?? 0) * c;
            return (
              <mesh key={`${String(dx)}${String(dz)}`} position={[x, SEA_LEVEL + 0.02, z]}>
                <cylinderGeometry args={[0.022, 0.022, 0.12, 6]} />
                <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
              </mesh>
            );
          })}

          {/* The sign, painted with the rate. */}
          <mesh position={[pier.deck[0], pier.deck[1] + 0.024, pier.deck[2]]} geometry={sign}>
            <meshStandardMaterial map={pier.texture} roughness={0.6} />
          </mesh>

          <Gangplank from={pier.a} to={pier.deck} />
          <Gangplank from={pier.b} to={pier.deck} />
        </group>
      ))}
    </group>
  );
}

/** A plank from a harbour to one of the intersections that controls it. */
function Gangplank({
  from,
  to,
}: {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}): React.JSX.Element {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  const y = (BOARD_TOP + to[1]) / 2 - 0.02;
  const drop = Math.atan2(BOARD_TOP - to[1], length);

  return (
    <mesh
      position={[(from[0] + to[0]) / 2, y, (from[2] + to[2]) / 2]}
      rotation={[0, -Math.atan2(dz, dx), -drop]}
      castShadow
    >
      <boxGeometry args={[length, 0.025, 0.075]} />
      <meshStandardMaterial color={WOOD} roughness={0.85} />
    </mesh>
  );
}
