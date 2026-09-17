import { describe, it, expect } from "vitest";
import { seafarersStateOf } from "./seafarers.js";
import { createGame } from "../setup/createGame.js";
import { reduce } from "../reducers/reduce.js";
import { legalMoves } from "../queries/legalMoves.js";
import { canMoveShip, canPlaceShip, shipSpots } from "../queries/placement.js";
import { assertInvariants } from "../state/invariants.js";
import {
  completeSetup,
  giveResources,
  intoMainPhase,
  newGame,
} from "../reducers/testHelpers.js";
import type { EdgeId, NodeId } from "../geometry/ids.js";
import type { Axial } from "../geometry/coords.js";
import type { Scenario, ScenarioCell } from "../scenario/types.js";
import type { GameState, PlayerId } from "../state/types.js";

/**
 * Seafarers: ships. Rule references are to the 2025 Seafarers rulebook.
 *
 * The board is built here rather than taken from the shipped fixtures because
 * `tiny-island` has the right geometry but declares `modules: ["base"]`, and
 * two other suites assert against it. This mirrors `portFixture.ts`: a small
 * board arranged so the rule under test is easy to name.
 */

const LAND: readonly Axial[] = [
  [0, 0],
  [1, 0],
  [0, 1],
];

/** A ring of sea around the three land hexes, so coast and sea edges both exist. */
const SEA: readonly Axial[] = [
  [-1, 0],
  [-1, 1],
  [-1, 2],
  [0, -1],
  [0, 2],
  [1, -1],
  [1, 1],
  [2, -1],
  [2, 0],
];

function seaScenario(): Scenario {
  // Written out rather than mapped over LAND: indexing a tuple gives
  // `Terrain | undefined` under noUncheckedIndexedAccess, and naming each hex
  // is clearer in a fixture anyway. The coords must match LAND, which is what
  // the number path walks.
  const cells: ScenarioCell[] = [
    { coord: [0, 0], slot: "land", terrain: "forest", island: "home" },
    { coord: [1, 0], slot: "land", terrain: "pasture", island: "home" },
    { coord: [0, 1], slot: "land", terrain: "field", island: "home" },
    ...SEA.map((coord) => ({
      coord,
      slot: "sea" as const,
      terrain: "sea" as const,
    })),
  ];

  return {
    id: "sea-test",
    name: "Sea Test",
    schemaVersion: 1,
    players: { min: 2, max: 4 },
    victoryPoints: 10,
    modules: ["base", "seafarers"],
    layout: { orientation: "pointy" },
    cells,
    bags: {},
    numbers: {
      mode: "path",
      sequence: [5, 9, 4],
      path: [...LAND],
      skipTerrains: ["desert", "sea"],
    },
    ports: [],
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [{ id: "home", vpForFirstSettlement: 0 }],
    hiddenStacks: [],
    startingPieces: [],
  };
}

function seaGame(): GameState {
  return createGame({
    scenario: seaScenario(),
    seed: "sea",
    playerNames: ["P0", "P1"],
  });
}

/** An intersection with at least one edge a ship could use. */
function coastalNode(state: GameState): NodeId {
  for (const [id, node] of Object.entries(state.board.nodes)) {
    if (node.edges.some((e) => state.board.edges[e]?.kind !== "land")) return id;
  }
  throw new Error("fixture has no coastal intersection");
}

/** A sea or coast edge touching `node`. */
function shipEdgeAt(
  state: GameState,
  node: NodeId,
  skip: readonly EdgeId[] = [],
): EdgeId {
  const found = state.board.nodes[node]?.edges.find(
    (e) => state.board.edges[e]?.kind !== "land" && !skip.includes(e),
  );
  if (found === undefined) throw new Error(`no ship edge at ${node}`);
  return found;
}

function withSettlement(state: GameState, player: PlayerId, node: NodeId): GameState {
  return {
    ...state,
    buildings: { ...state.buildings, [node]: { kind: "settlement", player } },
    players: state.players.map((s) =>
      s.id === player
        ? { ...s, pieces: { ...s.pieces, settlements: s.pieces.settlements - 1 } }
        : s,
    ),
  };
}

/** A game in the main phase, player 0 on the coast with a ship's worth of cards. */
function readyToSail(): { state: GameState; node: NodeId } {
  const base = intoMainPhase(seaGame(), 0);
  const node = coastalNode(base);
  const withHouse = withSettlement({ ...base, turn: 5 }, 0, node);
  return { state: giveResources(withHouse, 0, { lumber: 3, wool: 3 }), node };
}

describe("the module", () => {
  it("keeps a slice of state, which a base game does not", () => {
    const sea = seaGame();
    expect(seafarersStateOf(sea)?.settledIslands).toEqual({ 0: [], 1: [] });
    expect(seafarersStateOf(newGame(3))).toBeNull();
  });

  it("adds no ship moves to a base game", () => {
    const base = intoMainPhase(completeSetup(newGame(3)), 0);
    const kinds = new Set(legalMoves(base, 0).map((m) => m.t));
    expect(kinds.has("buildShip")).toBe(false);
    expect(kinds.has("moveShip")).toBe(false);
  });
});

describe("where a ship may go (p.2)", () => {
  it("refuses a wholly inland edge", () => {
    const { state, node } = readyToSail();
    const land = Object.values(state.board.edges).find((e) => e.kind === "land");
    expect(land).toBeDefined();
    expect(canPlaceShip(state, 0, land?.id ?? "")).toBe(false);
    expect(node).toBeTruthy();
  });

  it("allows a sea edge touching your own building", () => {
    const { state, node } = readyToSail();
    expect(canPlaceShip(state, 0, shipEdgeAt(state, node))).toBe(true);
  });

  it("refuses an edge with no connection to anything of yours", () => {
    const base = intoMainPhase({ ...seaGame(), turn: 5 }, 0);
    const state = giveResources(base, 0, { lumber: 3, wool: 3 });
    // No buildings at all, so nothing anywhere is connected.
    expect(shipSpots(state, 0)).toEqual([]);
  });

  it("refuses an edge that already carries a road", () => {
    const { state, node } = readyToSail();
    const edge = shipEdgeAt(state, node);
    const blocked = { ...state, roads: { ...state.roads, [edge]: 0 as PlayerId } };
    expect(canPlaceShip(blocked, 0, edge)).toBe(false);
  });

  it("refuses an edge of the pirate's hex", () => {
    const { state, node } = readyToSail();
    const edge = shipEdgeAt(state, node);
    const tile = state.board.edges[edge]?.tiles[0];
    expect(tile).toBeDefined();
    expect(canPlaceShip({ ...state, pirate: tile ?? null }, 0, edge)).toBe(false);
  });

  it("refuses when the player has no ships left in stock", () => {
    const { state, node } = readyToSail();
    const empty = {
      ...state,
      players: state.players.map((s) =>
        s.id === 0 ? { ...s, pieces: { ...s.pieces, ships: 0 } } : s,
      ),
    };
    expect(canPlaceShip(empty, 0, shipEdgeAt(empty, node))).toBe(false);
  });
});

describe("building a ship", () => {
  it("pays, takes a ship from stock and records the turn", () => {
    const { state, node } = readyToSail();
    const edge = shipEdgeAt(state, node);
    const before = state.players[0]?.pieces.ships ?? 0;

    const result = reduce(state, { t: "buildShip", player: 0, edge });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.ships[edge]).toEqual({ player: 0, builtOnTurn: 5 });
    expect(result.state.players[0]?.pieces.ships).toBe(before - 1);
    expect(result.state.players[0]?.resources.lumber).toBe(2);
    expect(result.state.players[0]?.resources.wool).toBe(2);
    expect(result.events.some((e) => e.e === "builtShip")).toBe(true);
    assertInvariants(result.state, "buildShip");
  });

  it("is offered by legalMoves once it is affordable", () => {
    const { state } = readyToSail();
    expect(legalMoves(state, 0).some((m) => m.t === "buildShip")).toBe(true);
  });

  it("is refused when the player cannot pay", () => {
    const { state, node } = readyToSail();
    const broke = {
      ...state,
      players: state.players.map((s) =>
        s.id === 0 ? { ...s, resources: { ...s.resources, lumber: 0, wool: 0 } } : s,
      ),
    };
    const result = reduce(broke, {
      t: "buildShip",
      player: 0,
      edge: shipEdgeAt(broke, node),
    });
    expect(result.ok).toBe(false);
  });

  it("is refused when it is not your turn", () => {
    const { state, node } = readyToSail();
    const result = reduce(state, {
      t: "buildShip",
      player: 1,
      edge: shipEdgeAt(state, node),
    });
    expect(result.ok).toBe(false);
  });
});

describe("moving a ship", () => {
  /** Build one ship off the settlement, so there is something to move. */
  function withOneShip(): { state: GameState; edge: EdgeId; node: NodeId } {
    const { state, node } = readyToSail();
    const edge = shipEdgeAt(state, node);
    const result = reduce(state, { t: "buildShip", player: 0, edge });
    if (!result.ok) throw new Error(result.reason);
    return { state: result.state, edge, node };
  }

  it("refuses a ship built this turn (p.2)", () => {
    const { state, edge, node } = withOneShip();
    const target = shipEdgeAt(state, node, [edge]);
    expect(canMoveShip(state, 0, edge, target)).toBe(false);
  });

  it("allows it on a later turn, and marks the move as used", () => {
    const { state, edge, node } = withOneShip();
    const later = { ...state, turn: state.turn + 1 };
    const target = shipEdgeAt(later, node, [edge]);

    expect(canMoveShip(later, 0, edge, target)).toBe(true);

    const result = reduce(later, { t: "moveShip", player: 0, from: edge, to: target });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.ships[edge]).toBeUndefined();
    expect(result.state.ships[target]?.player).toBe(0);
    expect(result.state.players[0]?.movedShipThisTurn).toBe(true);
    expect(result.events.some((e) => e.e === "shipMoved")).toBe(true);
    assertInvariants(result.state, "moveShip");
  });

  it("allows only one move per turn", () => {
    const { state, edge, node } = withOneShip();
    const later = { ...state, turn: state.turn + 1 };
    const target = shipEdgeAt(later, node, [edge]);
    const moved = reduce(later, { t: "moveShip", player: 0, from: edge, to: target });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const again = shipEdgeAt(moved.state, node, [edge, target]);
    expect(canMoveShip(moved.state, 0, target, again)).toBe(false);
  });

  it("does not change how many ships are on the board", () => {
    const { state, edge, node } = withOneShip();
    const later = { ...state, turn: state.turn + 1 };
    const target = shipEdgeAt(later, node, [edge]);
    const result = reduce(later, { t: "moveShip", player: 0, from: edge, to: target });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.state.ships)).toHaveLength(1);
    expect(result.state.players[0]?.pieces.ships).toBe(state.players[0]?.pieces.ships);
  });

  it("refuses to move another player's ship", () => {
    const { state, edge, node } = withOneShip();
    const later = { ...state, turn: state.turn + 1 };
    expect(canMoveShip(later, 1, edge, shipEdgeAt(later, node, [edge]))).toBe(false);
  });
});
