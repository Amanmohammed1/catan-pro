/**
 * Resource arithmetic and small state lookups.
 *
 * All of these are pure and total. They never mutate their inputs, because
 * reducers rely on structural sharing to keep replays reproducible.
 */

import type { ResourceKind } from "../scenario/types.js";
import type { NodeId, TileId } from "../geometry/ids.js";
import type { BoardGraph } from "../geometry/types.js";
import {
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Building,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ResourceCounts,
} from "./types.js";

export function addResources(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  const out = emptyResources();
  for (const kind of RESOURCE_KINDS) out[kind] = a[kind] + b[kind];
  return out;
}

export function subtractResources(
  a: ResourceCounts,
  b: ResourceCounts,
): ResourceCounts {
  const out = emptyResources();
  for (const kind of RESOURCE_KINDS) out[kind] = a[kind] - b[kind];
  return out;
}

export function scaleResources(a: ResourceCounts, n: number): ResourceCounts {
  const out = emptyResources();
  for (const kind of RESOURCE_KINDS) out[kind] = a[kind] * n;
  return out;
}

/** True when `have` covers every entry of `need`. */
export function canAfford(have: ResourceCounts, need: ResourceCounts): boolean {
  for (const kind of RESOURCE_KINDS) {
    if (have[kind] < need[kind]) return false;
  }
  return true;
}

export function isNonNegative(counts: ResourceCounts): boolean {
  for (const kind of RESOURCE_KINDS) {
    if (counts[kind] < 0) return false;
  }
  return true;
}

export function singleResource(kind: ResourceKind, count = 1): ResourceCounts {
  const out = emptyResources();
  out[kind] = count;
  return out;
}

export function resourceList(counts: ResourceCounts): ResourceKind[] {
  const out: ResourceKind[] = [];
  for (const kind of RESOURCE_KINDS) {
    for (let i = 0; i < counts[kind]; i++) out.push(kind);
  }
  return out;
}

export function countsFromList(list: readonly ResourceKind[]): ResourceCounts {
  const out = emptyResources();
  for (const kind of list) out[kind] += 1;
  return out;
}

export function handSize(player: PlayerState): number {
  return totalResources(player.resources);
}

/** Replace one seat, leaving the rest of the array shared. */
export function withPlayer(
  state: GameState,
  player: PlayerId,
  update: (seat: PlayerState) => PlayerState,
): readonly PlayerState[] {
  return state.players.map((seat) => (seat.id === player ? update(seat) : seat));
}

/** The building on a node, or undefined. */
export function buildingAt(state: GameState, node: NodeId): Building | undefined {
  return state.buildings[node];
}

/**
 * Players with a settlement or city touching a tile.
 *
 * Used for stealing (p.5) and for production (p.10).
 */
export function playersAdjacentToTile(
  board: BoardGraph,
  buildings: Readonly<Record<NodeId, Building>>,
  tile: TileId,
): PlayerId[] {
  const found = new Set<PlayerId>();
  for (const node of board.tiles[tile]?.nodes ?? []) {
    const building = buildings[node];
    if (building !== undefined) found.add(building.player);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Best maritime trade rate a player can get for a resource. Rules p.4, p.9.
 *
 * 4:1 is always available. A settlement or city on a generic harbor gives 3:1,
 * and on a matching resource harbor 2:1.
 */
export function bestTradeRate(
  state: GameState,
  player: PlayerId,
  give: ResourceKind,
): number {
  let rate = 4;

  for (const [nodeId, building] of Object.entries(state.buildings)) {
    if (building.player !== player) continue;
    const node = state.board.nodes[nodeId];
    if (node?.port == null) continue;
    const port = state.board.ports[node.port];
    if (port === undefined) continue;

    if (port.kind === "generic") {
      rate = Math.min(rate, port.ratio);
    } else if (port.resource === give) {
      rate = Math.min(rate, port.ratio);
    }
  }

  return rate;
}

/** Every harbor a player controls, for display and for legalMoves. */
export function portRatesFor(
  state: GameState,
  player: PlayerId,
): Record<ResourceKind, number> {
  const out = {} as Record<ResourceKind, number>;
  for (const kind of RESOURCE_KINDS) {
    out[kind] = bestTradeRate(state, player, kind);
  }
  return out;
}
