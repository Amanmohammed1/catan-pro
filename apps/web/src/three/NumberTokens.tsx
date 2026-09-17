import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph } from "@hexport/engine";
import { createTokenFaceGeometry, createTokenRimGeometry } from "./geometries.js";
import { BOARD_TOP, tilePosition } from "./layout3d.js";
import { tokenFaceTexture } from "./textures.js";
import { useFontKey } from "./useFontKey.js";

/**
 * Number tokens.
 *
 * CLAUDE.md keeps interface text in the DOM overlay, not in WebGL. These are not
 * interface text — they are printed on the board, they rotate and shade with it,
 * and a DOM element per token would fight the depth buffer every frame.
 *
 * Each token is two instanced meshes: a cream rim shared by every token, and a
 * printed face grouped by value so each group shares one texture. The face is
 * painted in the display face once it has loaded (see useFontKey).
 */

interface Placement {
  readonly value: number;
  readonly x: number;
  readonly z: number;
  readonly blocked: boolean;
}

const LIT = new THREE.Color("#ffffff");
/** Under the robber: the token is visibly suppressed, still readable. */
const DIM = new THREE.Color("#7a7064");

export function NumberTokens({
  board,
  blockedTile,
}: {
  readonly board: BoardGraph;
  /** The hex under the robber; its token is dimmed to show it is suppressed. */
  readonly blockedTile: string;
}): React.JSX.Element {
  const fontKey = useFontKey();
  const rim = useMemo(() => createTokenRimGeometry(), []);
  const face = useMemo(() => createTokenFaceGeometry(), []);

  const placements = useMemo(() => {
    const out: Placement[] = [];
    for (const tile of Object.values(board.tiles)) {
      if (tile.number === null) continue;
      const [x, , z] = tilePosition(tile.coord);
      out.push({ value: tile.number, x, z, blocked: tile.id === blockedTile });
    }
    return out;
  }, [board, blockedTile]);

  const byValue = useMemo(() => {
    const groups = new Map<number, Placement[]>();
    for (const p of placements) {
      const list = groups.get(p.value) ?? [];
      list.push(p);
      groups.set(p.value, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [placements]);

  return (
    <>
      <TokenLayer geometry={rim} placements={placements}>
        <meshStandardMaterial color="#e6d6b0" roughness={0.6} metalness={0} />
      </TokenLayer>
      {byValue.map(([value, list]) => (
        <TokenLayer key={value} geometry={face} placements={list}>
          <meshStandardMaterial
            map={tokenFaceTexture(value, fontKey)}
            roughness={0.55}
            metalness={0}
          />
        </TokenLayer>
      ))}
    </>
  );
}

function TokenLayer({
  geometry,
  placements,
  children,
}: {
  readonly geometry: THREE.BufferGeometry;
  readonly placements: readonly Placement[];
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;
    const matrix = new THREE.Matrix4();
    placements.forEach((p, index) => {
      matrix.makeTranslation(p.x, BOARD_TOP, p.z);
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, p.blocked ? DIM : LIT);
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor !== null) instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [placements]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, placements.length]}
      castShadow
      receiveShadow
      raycast={() => null}
    >
      {children}
    </instancedMesh>
  );
}
