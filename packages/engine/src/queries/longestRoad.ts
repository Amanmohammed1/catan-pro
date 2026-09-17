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
import type { Building, PlayerId, Ship, SpecialCard } from "../state/types.js";

export interface RoadNetworkInput {
  readonly board: BoardGraph;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  /**
   * Seafarers ships, which count toward the route (Seafarers p.2). Required
   * rather than optional on purpose: a caller that forgot them would get a
   * quietly wrong answer, and this is the measurement that decides who wins.
   * An empty record is the base game's answer and says so explicitly.
   */
  readonly ships: Readonly<Record<EdgeId, Ship>>;
  readonly buildings: Readonly<Record<NodeId, Building>>;
}

/** What a player has on an edge, for the road/ship join rule. */
type Carrier = "road" | "ship" | null;

/**
 * Longest continuous route for one player: roads, ships, or both.
 *
 * Base game (p.9): the longest trail of your own road segments, no segment
 * counted twice, never passing *through* an intersection an opponent holds.
 *
 * Seafarers p.2 widens it: "The first player to have 5 continuous roads and/or
 * ships in play receives the Longest Route tile... Roads and ships are only
 * considered part of the same route if they connect to each other at one of
 * your buildings."
 *
 * So the walk is unchanged except at one point: stepping from a road onto a
 * ship, or the reverse, requires one of your own buildings at the intersection
 * between them. Two roads, or two ships, join anywhere as before — which is why
 * every base-game case still measures exactly what it used to.
 *
 * Returns 0 when the player has nothing on the board.
 */
export function longestRouteFor(input: RoadNetworkInput, player: PlayerId): number {
  const { board, roads, ships, buildings } = input;

  // Own pieces, indexed by the nodes they touch.
  const incident = new Map<NodeId, EdgeId[]>();
  const carrier = new Map<EdgeId, Carrier>();
  let ownCount = 0;

  const claim = (edgeId: EdgeId, kind: Exclude<Carrier, null>): void => {
    const edge = board.edges[edgeId];
    if (edge === undefined) return;
    ownCount++;
    carrier.set(edgeId, kind);
    for (const nodeId of edge.nodes) {
      const list = incident.get(nodeId);
      if (list === undefined) incident.set(nodeId, [edgeId]);
      else list.push(edgeId);
    }
  };

  for (const [edgeId, owner] of Object.entries(roads)) {
    if (owner !== player) continue;
    claim(edgeId, "road");
  }
  for (const [edgeId, ship] of Object.entries(ships)) {
    if (ship.player !== player) continue;
    claim(edgeId, "ship");
  }

  if (ownCount === 0) return 0;

  /**
   * An intersection blocks the path when an opponent has built on it. Your own
   * settlements and cities never block your own road (p.9 speaks only of
   * breaking an *opponent's* road).
   */
  const blocked = (nodeId: NodeId): boolean => {
    const building = buildings[nodeId];
    return building !== undefined && building.player !== player;
  };

  /** Your own building here, which is what lets a road meet a ship (p.2). */
  const ownBuilding = (nodeId: NodeId): boolean => buildings[nodeId]?.player === player;

  const used = new Set<EdgeId>();
  let best = 0;

  const walk = (from: NodeId, length: number, arrivedOn: Carrier): void => {
    if (length > best) best = length;

    // Cannot continue out of an intersection an opponent holds. Arriving here
    // was legal and already counted; leaving is not.
    if (blocked(from)) return;

    for (const edgeId of incident.get(from) ?? []) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (edge === undefined) continue;

      // Seafarers p.2: a road and a ship are one route only where they meet at
      // one of your own buildings. Same-kind steps are free, so the base game
      // never reaches this test.
      const next = carrier.get(edgeId) ?? null;
      if (arrivedOn !== null && next !== arrivedOn && !ownBuilding(from)) continue;

      const far = edge.nodes[0] === from ? edge.nodes[1] : edge.nodes[0];

      used.add(edgeId);
      walk(far, length + 1, next);
      used.delete(edgeId);
    }
  };

  // A run can start anywhere in the network, including on a node an opponent
  // holds, so every endpoint is tried. `null` as the arriving carrier means the
  // first segment is free to be either kind.
  for (const nodeId of incident.keys()) {
    walk(nodeId, 0, null);
    if (best === ownCount) break; // cannot do better than every piece
  }

  return best;
}

/** Longest route length for every player, indexed by seat. */
export function longestRouteLengths(
  input: RoadNetworkInput,
  playerCount: number,
): number[] {
  const out: number[] = [];
  for (let player = 0; player < playerCount; player++) {
    out.push(longestRouteFor(input, player));
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
