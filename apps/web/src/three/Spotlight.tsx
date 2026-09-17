import { useMemo } from "react";
import * as THREE from "three";
import type { BoardGraph, EdgeId, NodeId, TileId } from "@hexport/engine";
import { ROAD_LENGTH } from "./geometries.js";
import { BOARD_TOP, edgeTransform, nodePosition, tilePosition } from "./layout3d.js";
import { ROAD_SPAN } from "./Pieces.js";

/**
 * Light up the places a log line is about.
 *
 * "Ana built a road" tells you what happened; hovering it should tell you
 * *where*. Drawn as bright outlines above the board rather than by recolouring
 * the pieces, so nothing about the board's own state appears to change.
 */
export interface Spotlit {
  readonly tiles: readonly TileId[];
  readonly nodes: readonly NodeId[];
  readonly edges: readonly EdgeId[];
}

const COLOR = "#ffe9a8";

export function Spotlight({
  board,
  targets,
}: {
  readonly board: BoardGraph;
  readonly targets: Spotlit | null;
}): React.JSX.Element | null {
  const marks = useMemo(() => {
    if (targets === null) return null;

    const tiles = targets.tiles.flatMap((id) => {
      const tile = board.tiles[id];
      if (tile === undefined) return [];
      const [x, , z] = tilePosition(tile.coord);
      return [{ id, x, z }];
    });

    const nodes = targets.nodes.flatMap((id) => {
      if (board.nodes[id] === undefined) return [];
      const [x, , z] = nodePosition(id, BOARD_TOP);
      return [{ id, x, z }];
    });

    const edges = targets.edges.flatMap((id) => {
      const transform = edgeTransform(board, id, BOARD_TOP);
      if (transform === null) return [];
      return [{ id, transform }];
    });

    return { tiles, nodes, edges };
  }, [board, targets]);

  if (marks === null) return null;

  return (
    <group>
      {marks.tiles.map((tile) => (
        <mesh
          key={`t-${tile.id}`}
          position={[tile.x, BOARD_TOP + 0.02, tile.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <ringGeometry args={[0.7, 0.92, 6, 1, Math.PI / 6]} />
          <Glow />
        </mesh>
      ))}

      {marks.nodes.map((node) => (
        <mesh
          key={`n-${node.id}`}
          position={[node.x, BOARD_TOP + 0.03, node.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <ringGeometry args={[0.16, 0.26, 28]} />
          <Glow />
        </mesh>
      ))}

      {marks.edges.map((edge) => (
        <mesh
          key={`e-${edge.id}`}
          position={[...edge.transform.position]}
          rotation={[-Math.PI / 2, 0, edge.transform.rotationY]}
          raycast={() => null}
        >
          <planeGeometry
            args={[(edge.transform.length * ROAD_SPAN) / ROAD_LENGTH / 1.6, 0.2]}
          />
          <Glow />
        </mesh>
      ))}
    </group>
  );
}

function Glow(): React.JSX.Element {
  return (
    <meshBasicMaterial
      color={COLOR}
      transparent
      opacity={0.75}
      side={THREE.DoubleSide}
      depthWrite={false}
      depthTest={false}
      toneMapped={false}
    />
  );
}
