import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardGraph } from "@hexport/engine";
import { createTokenGeometry } from "./geometries.js";
import { BOARD_TOP, pipCount, tilePosition } from "./layout3d.js";

/**
 * Number tokens.
 *
 * CLAUDE.md keeps interface text in the DOM overlay, not in WebGL. These are not
 * interface text — they are printed on the board, they rotate and shade with it,
 * and a DOM element per token would fight the depth buffer every frame.
 *
 * The face is drawn into a canvas once per value and used as a texture. That
 * avoids shipping a font and loading it at runtime, and gives exact control over
 * the red six and eight the rules call for (p.10).
 */

const FACE_SIZE = 192;
const textures = new Map<number, THREE.CanvasTexture>();

function faceTexture(value: number): THREE.CanvasTexture {
  const hit = textures.get(value);
  if (hit !== undefined) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const ctx = canvas.getContext("2d");

  if (ctx !== null) {
    const centre = FACE_SIZE / 2;
    const red = value === 6 || value === 8;

    ctx.fillStyle = "#f3ecd9";
    ctx.beginPath();
    ctx.arc(centre, centre, centre, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#00000022";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centre, centre, centre - 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = red ? "#b3261e" : "#2a2622";
    ctx.font = `700 ${String(red ? 92 : 84)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(value), centre, centre - 12);

    // Pips: the more likely the roll, the more dots (p.10).
    const pips = pipCount(value);
    const radius = 5.5;
    const gap = 15;
    const startX = centre - ((pips - 1) * gap) / 2;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(startX + i * gap, centre + 46, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(value, texture);
  return texture;
}

export function NumberTokens({
  board,
  blockedTile,
}: {
  readonly board: BoardGraph;
  /** The hex under the robber; its token is dimmed to show it is suppressed. */
  readonly blockedTile: string;
}): React.JSX.Element {
  // One instanced mesh per distinct value keeps the face texture uniform within
  // a draw call, which is what lets these be instanced at all.
  const groups = useMemo(() => {
    const byValue = new Map<number, { x: number; z: number; blocked: boolean }[]>();
    for (const tile of Object.values(board.tiles)) {
      if (tile.number === null) continue;
      const [x, , z] = tilePosition(tile.coord);
      const list = byValue.get(tile.number) ?? [];
      list.push({ x, z, blocked: tile.id === blockedTile });
      byValue.set(tile.number, list);
    }
    return [...byValue.entries()].sort(([a], [b]) => a - b);
  }, [board, blockedTile]);

  return (
    <>
      {groups.map(([value, placements]) => (
        <TokenGroup key={value} value={value} placements={placements} />
      ))}
    </>
  );
}

function TokenGroup({
  value,
  placements,
}: {
  readonly value: number;
  readonly placements: readonly { x: number; z: number; blocked: boolean }[];
}): React.JSX.Element {
  const geometry = useMemo(() => createTokenGeometry(), []);
  const texture = useMemo(() => faceTexture(value), [value]);
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;

    const matrix = new THREE.Matrix4();
    const dim = new THREE.Color("#8a8a8a");
    const lit = new THREE.Color("#ffffff");

    placements.forEach((p, index) => {
      matrix.makeTranslation(p.x, BOARD_TOP + 0.002, p.z);
      instanced.setMatrixAt(index, matrix);
      instanced.setColorAt(index, p.blocked ? dim : lit);
    });

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
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
      {/* The cylinder's side and rim take the flat colour; the cap takes the
          printed face. One material is enough because the face texture is
          mapped to the top only by the cylinder's own UVs. */}
      <meshStandardMaterial map={texture} roughness={0.72} metalness={0} />
    </instancedMesh>
  );
}
