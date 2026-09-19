/**
 * Where a piece may legally go.
 *
 * These are the geometric building rules, separated from legalMoves() so that
 * both the move generator and the reducers can share one definition. If a
 * placement check ever appears in the UI or the server, it belongs here
 * instead (CLAUDE.md golden rule 3).
 */

import { isLandTerrain } from "../scenario/types.js";
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

  if (options.setup) {
    // An opening settlement goes on land — never out on open water, and never
    // on a space nobody has explored yet.
    //
    // Every scenario has always declared this as `setup.placeOn`, and nothing
    // read it, because the gap could not show: the other boards are all land or
    // confine the opening to a named island, which is land. The Fog Islands
    // sets no island restriction (Seafarers p.8), and the fuzzer stalled all
    // twenty games on it at once — a settlement went up on an intersection
    // ringed by sea, where `canPlaceRoad` then refuses every edge for being
    // sea, leaving no legal move and no winner.
    const slots = state.config.setupSlots;
    const touchesAllowedSlot = (state.board.nodes[node]?.tiles ?? []).some((tileId) => {
      const slot = state.board.tiles[tileId]?.slot;
      return slot !== undefined && slots.includes(slot);
    });
    if (!touchesAllowedSlot) return false;

    // Seafarers p.4: the opening settlements stay on the main island. Null
    // means the scenario sets no restriction, which is every base-game board.
    const allowed = state.config.setupIslands;
    if (allowed === null) return true;

    for (const tileId of state.board.nodes[node]?.tiles ?? []) {
      const island = state.board.tiles[tileId]?.island;
      if (island != null && allowed.includes(island)) return true;
    }
    return false;
  }

  for (const edgeId of state.board.nodes[node]?.edges ?? []) {
    if (state.roads[edgeId] === player) return true;
    // A ship connects a settlement exactly as a road does (Seafarers p.2-3:
    // roads and ships are one route, and setup lets a coastal settlement take
    // "a ship on an adjacent empty sea edge instead of a road").
    //
    // Without this a player can sail anywhere and build nothing, which is the
    // whole expansion: the fuzzer found 4-player games dead-ending with every
    // ship spent, no island settled, and nobody able to reach 14 points.
    if (state.ships[edgeId]?.player === player) return true;
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
/**
 * True when every hex this edge borders is still face down.
 *
 * Such an edge does not exist as a place to build. On a physical board an empty
 * space holds no hex, so there is no edge between two of them to lay anything
 * along — Seafarers p.8 has you build "adjacent to an intersection with an
 * empty hex space", beside the unknown rather than inside it.
 *
 * This matters more than it sounds. An edge with fog on both sides classifies
 * as `coast`, because an unrevealed hex might turn out to be either land or
 * sea — so without this a road could be built there and then find itself on
 * open water when both neighbours revealed as sea, a position the rules refuse
 * and no invariant noticed. Fog Islands has eighteen such edges within reach of
 * land; a Black Forest fog ring is made of them.
 */
function bordersOnlyFog(state: GameState, edge: EdgeId): boolean {
  const tiles = state.board.edges[edge]?.tiles ?? [];
  return (
    tiles.length > 0 && tiles.every((id) => state.board.tiles[id]?.terrain === "fog")
  );
}

/**
 * True when no hex this edge borders is known to be land.
 *
 * The rule for a road, stated so it survives an unrevealed neighbour. In the
 * base game every legal road edge touches land: an inland edge has land both
 * sides, a coastal one has land on one. Treating "not yet turned over" as "not
 * yet land" extends that unchanged.
 *
 * Without it a road could go down on a fog-and-sea edge — legal at that
 * instant, because the fog might still be land — and be stranded on open water
 * in the *same action* when the reveal turned it to sea. The fuzzer hit this on
 * a setup road within one game of the check being added.
 *
 * Exploration is unaffected: a road from the known board into the fog always
 * borders the land it set out from.
 */
function bordersNoLand(state: GameState, edge: EdgeId): boolean {
  const tiles = state.board.edges[edge]?.tiles ?? [];
  return !tiles.some((id) => {
    const terrain = state.board.tiles[id]?.terrain;
    return terrain !== undefined && isLandTerrain(terrain);
  });
}

export function canPlaceRoad(
  state: GameState,
  player: PlayerId,
  edge: EdgeId,
  options: { readonly setup: boolean; readonly mustTouch?: NodeId | null },
): boolean {
  const graph = state.board.edges[edge];
  if (graph === undefined) return false;
  if (state.roads[edge] !== undefined) return false;
  // Seafarers p.2: "Ships and roads may not occupy the same coastal edge."
  // The exclusion runs both ways, and only checking it from the ship's side
  // let a road be built straight onto an occupied edge — found by the fuzzer
  // on the first seed of the first Seafarers board it was given.
  if (state.ships[edge] !== undefined) return false;

  const seat = state.players[player];
  if (seat === undefined || seat.pieces.roads <= 0) return false;

  // Roads go on land and along the coast, never out to open sea (p.2). A
  // coastal edge takes either a road or a ship, whichever gets there first.
  if (graph.kind === "sea") return false;

  // A road needs land beside it — and an unrevealed hex is not land yet.
  if (bordersNoLand(state, edge)) return false;

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

// ---------------------------------------------------------------------------
// Seafarers: ships (ADR 0008). Rule references are to the 2025 Seafarers
// rulebook in docs/rules/.
// ---------------------------------------------------------------------------

export interface ShipPlacementOptions {
  /** Setup placement: the ship stands alone beside the settlement just placed. */
  readonly setup?: boolean;
  /**
   * The edge a ship is moving off.
   *
   * That edge is ignored for both occupancy and connectivity, because the ship
   * is in the air: it must not count as its own support, and its old square is
   * free by the time it lands.
   */
  readonly movingFrom?: EdgeId | null;
}

/**
 * Can this player put a ship here?
 *
 * Seafarers p.2: "Ships are placed on the empty edges of sea hexes. Ships and
 * roads may not occupy the same coastal edge. A new ship must connect to one of
 * your existing ships or buildings (not roads). Like roads, you may not build a
 * ship past an opponent's building. Also, you may not place any new ships on an
 * edge of the hex occupied by the pirate."
 *
 * The "not roads" is the important asymmetry: a road network does not carry a
 * ship onward. Roads and ships only join at one of your own buildings, which is
 * the same rule that governs the Longest Route.
 */
export function canPlaceShip(
  state: GameState,
  player: PlayerId,
  edge: EdgeId,
  options: ShipPlacementOptions = {},
): boolean {
  const graph = state.board.edges[edge];
  if (graph === undefined) return false;

  // Sea and coast carry ships; a wholly inland edge never does.
  if (graph.kind === "land") return false;

  // Never between two hexes nobody has turned over yet — see bordersOnlyFog.
  if (bordersOnlyFog(state, edge)) return false;

  // One piece per edge, road or ship.
  if (state.roads[edge] !== undefined) return false;
  if (state.ships[edge] !== undefined) return false;

  const seat = state.players[player];
  if (seat === undefined) return false;
  // A ship in flight is already off the board, so it costs no stock to land.
  if (options.movingFrom == null && seat.pieces.ships <= 0) return false;

  if (state.pirate !== null && graph.tiles.includes(state.pirate)) return false;

  if (options.setup === true) return true;

  for (const nodeId of graph.nodes) {
    const building = state.buildings[nodeId];

    // Your own building always connects.
    if (building?.player === player) return true;

    // An opponent's building blocks a connection made through this corner.
    if (building !== undefined) continue;

    for (const otherEdge of state.board.nodes[nodeId]?.edges ?? []) {
      if (otherEdge === edge || otherEdge === options.movingFrom) continue;
      if (state.ships[otherEdge]?.player === player) return true;
    }
  }

  return false;
}

/**
 * Is this end of a ship "open"?
 *
 * Seafarers p.2: "A ship's end is 'open' when it is not next to one of your
 * ships or buildings."
 */
function shipEndIsOpen(
  state: GameState,
  player: PlayerId,
  edge: EdgeId,
  node: NodeId,
): boolean {
  if (state.buildings[node]?.player === player) return false;

  for (const other of state.board.nodes[node]?.edges ?? []) {
    if (other === edge) continue;
    if (state.ships[other]?.player === player) return false;
  }
  return true;
}

/**
 * May this player move this ship to that edge? Seafarers p.2.
 *
 * The rulebook lists four restrictions. Three are direct: not a ship built this
 * turn, at least one open end, and nothing to or from the pirate's hex.
 *
 * The fourth — "you may not move a ship that is a part of a continuous line of
 * ships connecting two of your buildings, even if another player's building is
 * built on that line to interrupt it" — needs no separate check, because it is
 * implied by the open-end test. An open end reaches neither your ship nor your
 * building, so it cannot lead on to a second building of yours; a ship joining
 * two of your buildings therefore has no open end. The clause is there to say
 * that an opponent's building interrupting the line does not free the ship,
 * which is exactly what the open-end test already does.
 */
export function canMoveShip(
  state: GameState,
  player: PlayerId,
  from: EdgeId,
  to: EdgeId,
): boolean {
  if (from === to) return false;

  const ship = state.ships[from];
  if (ship === undefined || ship.player !== player) return false;

  const seat = state.players[player];
  if (seat === undefined) return false;
  // p.2: one ship per Action phase.
  if (seat.movedShipThisTurn) return false;
  // p.2: "You may not move a ship you built this turn."
  if (ship.builtOnTurn >= state.turn) return false;

  const graph = state.board.edges[from];
  if (graph === undefined) return false;
  if (state.pirate !== null && graph.tiles.includes(state.pirate)) return false;

  const open = graph.nodes.some((node) => shipEndIsOpen(state, player, from, node));
  if (!open) return false;

  return canPlaceShip(state, player, to, { movingFrom: from });
}

/** Every edge where this player could legally build a ship. */
export function shipSpots(state: GameState, player: PlayerId): EdgeId[] {
  return Object.keys(state.board.edges).filter((edge) =>
    canPlaceShip(state, player, edge),
  );
}

/** Every ship move this player could legally make, as (from, to) pairs. */
export function shipMoves(
  state: GameState,
  player: PlayerId,
): { readonly from: EdgeId; readonly to: EdgeId }[] {
  const out: { from: EdgeId; to: EdgeId }[] = [];

  for (const [from, ship] of Object.entries(state.ships)) {
    if (ship.player !== player) continue;
    for (const to of Object.keys(state.board.edges)) {
      if (canMoveShip(state, player, from, to)) out.push({ from, to });
    }
  }

  return out;
}
