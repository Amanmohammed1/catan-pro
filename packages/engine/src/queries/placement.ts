/**
 * Where a piece may legally go.
 *
 * These are the geometric building rules, separated from legalMoves() so that
 * both the move generator and the reducers can share one definition. If a
 * placement check ever appears in the UI or the server, it belongs here
 * instead (CLAUDE.md golden rule 3).
 */

import type { EdgeId, NodeId } from "../geometry/ids.js";
import type { GameState, PlayerId } from "../state/types.js";

/**
 * Distance Rule, p.5 and p.7:
 *   "You may only build a settlement at an intersection if all 3 of the
 *    adjacent intersections are vacant (i.e., none are occupied by any
 *    settlements or cities — even yours)."
 */
export function satisfiesDistanceRule(state: GameState, node: NodeId): boolean {
  if (state.buildings[node] !== undefined) return false;

  const graph = state.board.nodes[node];
  if (graph === undefined) return false;

  for (const neighbour of graph.nodes) {
    if (state.buildings[neighbour] !== undefined) return false;
  }
  return true;
}

/**
 * Can this player put a settlement here right now?
 *
 * During setup the settlement stands alone (p.12). Afterwards it must also
 * touch one of the player's own roads (p.5, condition 1).
 */
export function canPlaceSettlement(
  state: GameState,
  player: PlayerId,
  node: NodeId,
  options: { readonly setup: boolean },
): boolean {
  if (state.board.nodes[node] === undefined) return false;
  if (!satisfiesDistanceRule(state, node)) return false;

  const seat = state.players[player];
  if (seat === undefined || seat.pieces.settlements <= 0) return false;

  if (options.setup) return true;

  for (const edgeId of state.board.nodes[node]?.edges ?? []) {
    if (state.roads[edgeId] === player) return true;
  }
  return false;
}

/**
 * Can this player put a road here?
 *
 * Rules p.4: "A new road must always connect to 1 of your existing roads,
 * settlements, or cities." Illustration K on p.11 adds the qualifier that a
 * connection running through an opponent's settlement does not count — the
 * blocked path in that illustration touches the player's road only at an
 * intersection the blue player occupies.
 */
export function canPlaceRoad(
  state: GameState,
  player: PlayerId,
  edge: EdgeId,
  options: { readonly setup: boolean; readonly mustTouch?: NodeId | null },
): boolean {
  const graph = state.board.edges[edge];
  if (graph === undefined) return false;
  if (state.roads[edge] !== undefined) return false;

  const seat = state.players[player];
  if (seat === undefined || seat.pieces.roads <= 0) return false;

  // Base game: roads go on land. Sea and coast edges are Seafarers (M6).
  if (graph.kind === "sea") return false;

  // During setup the road must attach to the settlement just placed (p.12).
  if (options.setup) {
    const anchor = options.mustTouch;
    if (anchor == null) return false;
    return graph.nodes.includes(anchor);
  }

  for (const nodeId of graph.nodes) {
    const building = state.buildings[nodeId];

    // Your own building always connects.
    if (building?.player === player) return true;

    // An opponent's building blocks a connection made through this corner.
    if (building !== undefined && building.player !== player) continue;

    for (const otherEdge of state.board.nodes[nodeId]?.edges ?? []) {
      if (otherEdge !== edge && state.roads[otherEdge] === player) return true;
    }
  }

  return false;
}

/** Rules p.5: cities only ever replace one of your own settlements. */
export function canPlaceCity(
  state: GameState,
  player: PlayerId,
  node: NodeId,
): boolean {
  const seat = state.players[player];
  if (seat === undefined || seat.pieces.cities <= 0) return false;

  const building = state.buildings[node];
  return building?.player === player && building.kind === "settlement";
}

/** Every node where this player could legally settle. */
export function settlementSpots(
  state: GameState,
  player: PlayerId,
  setup: boolean,
): NodeId[] {
  return Object.keys(state.board.nodes).filter((node) =>
    canPlaceSettlement(state, player, node, { setup }),
  );
}

/** Every edge where this player could legally build a road. */
export function roadSpots(
  state: GameState,
  player: PlayerId,
  options: { readonly setup: boolean; readonly mustTouch?: NodeId | null },
): EdgeId[] {
  return Object.keys(state.board.edges).filter((edge) =>
    canPlaceRoad(state, player, edge, options),
  );
}

/** Every settlement this player could upgrade. */
export function citySpots(state: GameState, player: PlayerId): NodeId[] {
  return Object.keys(state.buildings).filter((node) =>
    canPlaceCity(state, player, node),
  );
}
