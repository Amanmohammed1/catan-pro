import type { BoardGraph, EdgeId, NodeId, TileId } from "@hexport/engine";
import { TERRAIN_LABEL } from "../three/palette.js";

/**
 * Plain-language names for places on the board.
 *
 * Used by the placement list, which is the keyboard and screen-reader route to
 * every move. "Intersection v|-1,0|0,-1|0,0" is not a place anyone can picture;
 * "Forest 11, Hills 4 and Pasture 6" is the same spot described the way players
 * already talk about it.
 */

export function describeTile(board: BoardGraph, tile: TileId): string {
  const hex = board.tiles[tile];
  if (hex === undefined) return "an unknown hex";
  const terrain = TERRAIN_LABEL[hex.terrain].split(" — ")[0] ?? hex.terrain;
  return hex.number === null ? terrain : `${terrain} ${String(hex.number)}`;
}

/** An intersection, named by the hexes that meet there. */
export function describeNode(board: BoardGraph, node: NodeId): string {
  const tiles = board.nodes[node]?.tiles ?? [];
  if (tiles.length === 0) return "an isolated corner";

  const names = tiles.map((tile) => describeTile(board, tile));
  const port = board.nodes[node]?.port;
  const harbour = port == null ? "" : ` · ${describePort(board, port)}`;

  return `${joinList(names)}${harbour}`;
}

/** A path, named by the hexes it runs between. */
export function describeEdge(board: BoardGraph, edge: EdgeId): string {
  const tiles = board.edges[edge]?.tiles ?? [];
  if (tiles.length === 0) return "an isolated path";
  if (tiles.length === 1) {
    return `the coast of ${describeTile(board, tiles[0] as TileId)}`;
  }
  return `between ${joinList(tiles.map((tile) => describeTile(board, tile)))}`;
}

export function describePort(board: BoardGraph, portId: string): string {
  const port = board.ports[portId];
  if (port === undefined) return "a harbour";
  return port.kind === "generic"
    ? "3:1 harbour"
    : `2:1 ${port.resource ?? ""} harbour`.trim();
}

function joinList(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) as string}`;
}
