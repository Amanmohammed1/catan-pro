/**
 * The board graph: built once at game creation, then stored in state.
 *
 * CLAUDE.md: "Build the board graph once at game creation, then store it in
 * state. Do not do hex math at runtime." Every adjacency a rule could want is
 * precomputed here, so legalMoves() and the renderer are lookups, not geometry.
 */

import type { Axial } from "./coords.js";
import type { EdgeId, NodeId, TileId } from "./ids.js";
import type { ResourceKind, SlotKind, Terrain } from "../scenario/types.js";

export type PortId = string;

/** Whether an edge can carry a road, a ship, or both. */
export type EdgeKind = "land" | "sea" | "coast";

export interface Tile {
  readonly id: TileId;
  readonly coord: Axial;
  readonly slot: SlotKind;
  readonly terrain: Terrain;
  /** Dice number, or null for desert, sea and unnumbered cells. */
  readonly number: number | null;
  readonly island: string | null;
  /** Six corners, in corner-index order. */
  readonly nodes: readonly NodeId[];
  /** Six edges, in direction order. */
  readonly edges: readonly EdgeId[];
}

export interface BoardNode {
  readonly id: NodeId;
  /** Tiles present on this board that touch this corner. One to three. */
  readonly tiles: readonly TileId[];
  /** Adjacent corners reachable along a present edge. */
  readonly nodes: readonly NodeId[];
  /** Edges present on this board that end here. */
  readonly edges: readonly EdgeId[];
  readonly port: PortId | null;
}

export interface BoardEdge {
  readonly id: EdgeId;
  readonly kind: EdgeKind;
  readonly nodes: readonly [NodeId, NodeId];
  /** Tiles present on this board that this edge borders. One or two. */
  readonly tiles: readonly TileId[];
}

export interface Port {
  readonly id: PortId;
  readonly kind: "generic" | "resource";
  readonly resource: ResourceKind | null;
  readonly ratio: number;
  readonly edge: EdgeId;
  readonly nodes: readonly [NodeId, NodeId];
}

export interface BoardGraph {
  readonly scenarioId: string;
  readonly orientation: "pointy" | "flat";
  readonly tiles: Readonly<Record<TileId, Tile>>;
  readonly nodes: Readonly<Record<NodeId, BoardNode>>;
  readonly edges: Readonly<Record<EdgeId, BoardEdge>>;
  readonly ports: Readonly<Record<PortId, Port>>;
}
