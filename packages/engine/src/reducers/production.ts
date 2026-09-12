/**
 * Resource production and the bank shortage rule.
 *
 * Rules p.10 ("Resource Production"), quoted because the shortage case is
 * unusual and frequently implemented wrong:
 *
 *   "It is possible that during the game there will not be enough resources in
 *    the bank to supply all of the yields. If there are not enough resource
 *    cards to give every player all the production they earn, then no player
 *    receives any of that resource that turn. Exception: If the shortage of
 *    resource cards only affects a single player, give that player as many of
 *    these resources as are left in the supply, and any extras are lost. In
 *    either case, production of other types of resources is not affected."
 */

import { addResources, subtractResources } from "../state/helpers.js";
import type { ResourceKind } from "../scenario/types.js";
import {
  RESOURCE_KINDS,
  emptyResources,
  type GameState,
  type PlayerId,
  type ResourceCounts,
} from "../state/types.js";

export interface ProductionResult {
  readonly gains: Record<PlayerId, ResourceCounts>;
  readonly bank: ResourceCounts;
  readonly shortages: ResourceKind[];
}

/**
 * What each player earns from a dice total, after the robber and the bank.
 *
 * Rules p.4: a settlement earns 1 card per adjacent producing hex, a city 2.
 * Rules p.5/p.11: the hex under the robber produces nothing.
 */
export function computeProduction(state: GameState, total: number): ProductionResult {
  // Step 1: what every player is owed, ignoring the bank.
  const owed = new Map<PlayerId, ResourceCounts>();
  for (const seat of state.players) owed.set(seat.id, emptyResources());

  for (const tile of Object.values(state.board.tiles)) {
    if (tile.number !== total) continue;
    if (tile.id === state.robber) continue; // p.5: the robber prevents it

    const resource = terrainResource(tile.terrain);
    if (resource === null) continue;

    for (const nodeId of tile.nodes) {
      const building = state.buildings[nodeId];
      if (building === undefined) continue;

      const amount = building.kind === "city" ? 2 : 1;
      const current = owed.get(building.player);
      if (current === undefined) continue;
      current[resource] += amount;
    }
  }

  // Step 2: apply the bank, one resource type at a time (p.10).
  const bank = { ...state.bank };
  const shortages: ResourceKind[] = [];
  const gains: Record<PlayerId, ResourceCounts> = {};
  for (const seat of state.players) gains[seat.id] = emptyResources();

  for (const kind of RESOURCE_KINDS) {
    let demand = 0;
    const claimants: PlayerId[] = [];
    for (const [player, counts] of owed) {
      if (counts[kind] <= 0) continue;
      demand += counts[kind];
      claimants.push(player);
    }
    if (demand === 0) continue;

    if (demand <= bank[kind]) {
      for (const player of claimants) {
        const amount = owed.get(player)?.[kind] ?? 0;
        (gains[player] as ResourceCounts)[kind] += amount;
        bank[kind] -= amount;
      }
      continue;
    }

    shortages.push(kind);

    if (claimants.length === 1) {
      // Exception: a single affected player takes whatever is left.
      const player = claimants[0] as PlayerId;
      const amount = bank[kind];
      (gains[player] as ResourceCounts)[kind] += amount;
      bank[kind] -= amount;
    }
    // Otherwise nobody receives any of this resource this turn.
  }

  return { gains, bank, shortages };
}

/** Apply a production result to the players and the bank. */
export function applyProduction(state: GameState, result: ProductionResult): GameState {
  return {
    ...state,
    bank: result.bank,
    players: state.players.map((seat) => {
      const gain = result.gains[seat.id];
      if (gain === undefined) return seat;
      return { ...seat, resources: addResources(seat.resources, gain) };
    }),
  };
}

/** What a terrain yields. Desert, sea and gold produce nothing on their own. */
export function terrainResource(terrain: string): ResourceKind | null {
  switch (terrain) {
    case "hill":
      return "brick";
    case "forest":
      return "lumber";
    case "pasture":
      return "wool";
    case "field":
      return "grain";
    case "mountain":
      return "ore";
    default:
      return null;
  }
}

/**
 * Resources a player takes for their second setup settlement.
 *
 * Rules p.12: "Each player receives their starting resources immediately after
 * building their second settlement. For each terrain hex adjacent to this
 * second settlement, take a corresponding resource card from the supply."
 */
export function setupYield(
  state: GameState,
  node: string,
): { readonly gained: ResourceCounts; readonly bank: ResourceCounts } {
  const gained = emptyResources();
  const bank = { ...state.bank };

  for (const tileId of state.board.nodes[node]?.tiles ?? []) {
    const tile = state.board.tiles[tileId];
    if (tile === undefined) continue;
    const resource = terrainResource(tile.terrain);
    if (resource === null) continue;
    if (bank[resource] <= 0) continue;
    gained[resource] += 1;
    bank[resource] -= 1;
  }

  return { gained, bank };
}

/** Move cards from a player to the bank, e.g. a discard. */
export function returnToBank(
  state: GameState,
  player: PlayerId,
  resources: ResourceCounts,
): GameState {
  return {
    ...state,
    bank: addResources(state.bank, resources),
    players: state.players.map((seat) =>
      seat.id === player
        ? { ...seat, resources: subtractResources(seat.resources, resources) }
        : seat,
    ),
  };
}
