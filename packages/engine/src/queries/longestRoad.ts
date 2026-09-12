/**
 * Longest Road.
 *
 * Rules p.4, p.9, and the almanac entry on p.9 which carries the tie-breaking
 * rules most implementations get wrong.
 *
 * The measurement, p.9:
 *   "If your road network branches, you may only count the single longest
 *    branch for purposes of the longest road."
 *   "You can break an opponent's road by building a settlement on an
 *    unoccupied intersection along that road."
 *
 * So the length of a player's road is the longest continuous run of their own
 * road segments where:
 *   - no segment is counted twice, and
 *   - the run does not pass *through* an intersection occupied by an opponent.
 *
 * A run may pass through the same intersection twice (a figure-eight counts in
 * full) as long as no segment repeats. It may also *end* on an opponent's
 * building; only passing through is blocked. That is why the search tests
 * blocking on the node it is about to leave, not the node it just entered.
 *
 * This is the longest edge-distinct trail, which is NP-hard in general. It is
 * fine here because a player owns at most 15 roads (p.5), and the search is
 * bounded by that.
 */

import type { BoardGraph } from "../geometry/types.js";
import type { EdgeId, NodeId } from "../geometry/ids.js";
import type { Building, PlayerId, SpecialCard } from "../state/types.js";

export interface RoadNetworkInput {
  readonly board: BoardGraph;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly buildings: Readonly<Record<NodeId, Building>>;
}

/**
 * Longest continuous road for one player.
 *
 * Returns 0 when the player has no roads.
 */
export function longestRoadFor(input: RoadNetworkInput, player: PlayerId): number {
  const { board, roads, buildings } = input;

  // Own roads, indexed by the nodes they touch.
  const incident = new Map<NodeId, EdgeId[]>();
  let ownRoadCount = 0;

  for (const [edgeId, owner] of Object.entries(roads)) {
    if (owner !== player) continue;
    const edge = board.edges[edgeId];
    if (edge === undefined) continue;
    ownRoadCount++;
    for (const nodeId of edge.nodes) {
      const list = incident.get(nodeId);
      if (list === undefined) incident.set(nodeId, [edgeId]);
      else list.push(edgeId);
    }
  }

  if (ownRoadCount === 0) return 0;

  /**
   * An intersection blocks the path when an opponent has built on it. Your own
   * settlements and cities never block your own road (p.9 speaks only of
   * breaking an *opponent's* road).
   */
  const blocked = (nodeId: NodeId): boolean => {
    const building = buildings[nodeId];
    return building !== undefined && building.player !== player;
  };

  const used = new Set<EdgeId>();
  let best = 0;

  const walk = (from: NodeId, length: number): void => {
    if (length > best) best = length;

    // Cannot continue out of an intersection an opponent holds. Arriving here
    // was legal and already counted; leaving is not.
    if (blocked(from)) return;

    for (const edgeId of incident.get(from) ?? []) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (edge === undefined) continue;
      const next = edge.nodes[0] === from ? edge.nodes[1] : edge.nodes[0];

      used.add(edgeId);
      walk(next, length + 1);
      used.delete(edgeId);
    }
  };

  // A run can start anywhere in the network, including on a node an opponent
  // holds, so every endpoint is tried.
  for (const nodeId of incident.keys()) {
    walk(nodeId, 0);
    if (best === ownRoadCount) break; // cannot do better than every road
  }

  return best;
}

/** Longest road length for every player, indexed by seat. */
export function longestRoadLengths(
  input: RoadNetworkInput,
  playerCount: number,
): number[] {
  const out: number[] = [];
  for (let player = 0; player < playerCount; player++) {
    out.push(longestRoadFor(input, player));
  }
  return out;
}

/**
 * Who holds the Longest Road card, given every player's length and the current
 * holder. Rules p.9, quoted in full because the tie cases are unusual:
 *
 *   "Special Case: If your longest road is broken and you are tied for longest
 *    road, you still keep the 'Longest Road' card. However, if you no longer
 *    have the longest road, but two or more players tie for the new longest
 *    road, set the 'Longest Road' card aside. Do the same if no one has a 5+
 *    segment road. The card comes into play again when only 1 player has the
 *    longest road (of at least 5 road pieces)."
 *
 * Which reduces to:
 *   - nobody reaches the minimum            -> nobody holds it
 *   - the current holder is still at the max -> holder keeps it, ties included
 *   - otherwise exactly one player is at max -> that player takes it
 *   - otherwise (several tie above the holder) -> set aside
 */
export function resolveLongestRoad(
  lengths: readonly number[],
  current: SpecialCard,
  minimum: number,
): SpecialCard {
  let max = 0;
  for (const length of lengths) if (length > max) max = length;

  if (max < minimum) {
    return { player: null, length: 0 };
  }

  const leaders: PlayerId[] = [];
  for (let player = 0; player < lengths.length; player++) {
    if (lengths[player] === max) leaders.push(player);
  }

  // The holder keeps the card while still tied at the top.
  if (current.player !== null && lengths[current.player] === max) {
    return { player: current.player, length: max };
  }

  if (leaders.length === 1) {
    return { player: leaders[0] as PlayerId, length: max };
  }

  // Two or more players tie ahead of the former holder: card goes aside.
  return { player: null, length: max };
}
