import { describe, it, expect } from "vitest";
import { seafarersStateOf } from "./seafarers.js";
import { createGame } from "../setup/createGame.js";
import { reduce } from "../reducers/reduce.js";
import { legalMoves } from "../queries/legalMoves.js";
import { canMoveShip, canPlaceShip, shipSpots } from "../queries/placement.js";
import { publicVictoryPoints } from "../queries/scores.js";
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
    // The scenario's island values, copied in at setup: the engine cannot read
    // a scenario later, and the board graph records only which island a tile is.
    expect(seafarersStateOf(sea)?.islandVp).toEqual({ home: 0 });
    expect(seafarersStateOf(newGame(3))).toBeNull();
  });

  it("adds no ship moves to a base game", () => {
    const base = intoMainPhase(completeSetup(newGame(3)), 0);
    const kinds = new Set(legalMoves(base, 0).map((m) => m.t));
    expect(kinds.has("buildShip")).toBe(false);
    expect(kinds.has("moveShip")).toBe(false);
  });
});

describe("island victory points (p.4)", () => {
  /** The sea board, with a second island worth 2 VP for a first settlement. */
  function twoIslandGame(): GameState {
    const base = seaScenario();
    const scenario: Scenario = {
      ...base,
      cells: base.cells.map((cell) =>
        // Turn one ringing sea hex into a far island worth points.
        cell.coord[0] === 2 && cell.coord[1] === 0
          ? { coord: cell.coord, slot: "land", terrain: "mountain", island: "far" }
          : cell,
      ),
      numbers: {
        mode: "path",
        sequence: [5, 9, 4, 6],
        path: [...LAND, [2, 0]],
        skipTerrains: ["desert", "sea"],
      },
      islands: [
        { id: "home", vpForFirstSettlement: 0 },
        { id: "far", vpForFirstSettlement: 2 },
      ],
    };
    return createGame({ scenario, seed: "islands", playerNames: ["P0", "P1"] });
  }

  /** Every island an intersection touches, ignoring sea and empty space. */
  function islandsAt(state: GameState, node: NodeId): Set<string> {
    return new Set(
      (state.board.nodes[node]?.tiles ?? [])
        .map((t) => state.board.tiles[t]?.island)
        .filter((i): i is string => i != null),
    );
  }

  /**
   * An intersection touching `island` and no other.
   *
   * The distinction matters here. [2, 0] shares two corners with the main
   * island, so "touches far" would also match a corner of home. Such a corner
   * happens to score the same — home is worth nothing — but the test would then
   * be measuring a straddle rather than a settlement on a separate island,
   * which is the rule under test. That case gets its own test below.
   */
  function nodeOn(state: GameState, island: string): NodeId {
    for (const id of Object.keys(state.board.nodes)) {
      const islands = islandsAt(state, id);
      if (islands.size === 1 && islands.has(island)) return id;
    }
    throw new Error(`no intersection touching only ${island}`);
  }

  /** An intersection where two named islands meet. */
  function nodeOnBoth(state: GameState, a: string, b: string): NodeId {
    for (const id of Object.keys(state.board.nodes)) {
      const islands = islandsAt(state, id);
      if (islands.has(a) && islands.has(b)) return id;
    }
    throw new Error(`no intersection joining ${a} and ${b}`);
  }

  it("pays nothing for the home island", () => {
    const state = intoMainPhase(twoIslandGame(), 0);
    const home = withSettlement(state, 0, nodeOn(state, "home"));
    expect(publicVictoryPoints(home, 0)).toBe(1); // the settlement itself
  });

  it("pays for a first settlement on a scoring island", () => {
    const state = intoMainPhase(twoIslandGame(), 0);
    const far = withSettlement(state, 0, nodeOn(state, "far"));
    // One for the settlement, two for reaching the island.
    expect(publicVictoryPoints(far, 0)).toBe(3);
  });

  it("pays each player for the same island independently", () => {
    const state = intoMainPhase(twoIslandGame(), 0);
    const node = nodeOn(state, "far");
    const mine = withSettlement(state, 0, node);
    expect(publicVictoryPoints(mine, 0)).toBe(3);
    // p.4: "it does not matter if other players have already built
    // settlements on that island."
    expect(publicVictoryPoints(mine, 1)).toBe(0);
  });

  it("pays for every island a single settlement touches", () => {
    // A corner where the two islands meet is paid for both. Worth pinning
    // deliberately rather than leaving to chance, since the helper above goes
    // out of its way to avoid these corners elsewhere.
    const state = intoMainPhase(twoIslandGame(), 0);
    const join = nodeOnBoth(state, "home", "far");
    expect(islandsAt(state, join)).toEqual(new Set(["home", "far"]));
    // One for the settlement, nothing for home, two for far.
    expect(publicVictoryPoints(withSettlement(state, 0, join), 0)).toBe(3);
  });

  it("pays a base game nothing, because no module scores", () => {
    const base = intoMainPhase(completeSetup(newGame(3)), 0);
    const before = publicVictoryPoints(base, 0);
    expect(before).toBeGreaterThanOrEqual(2); // two setup settlements
    expect(seafarersStateOf(base)).toBeNull();
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

describe("the pirate (p.2)", () => {
  /** A game where seat 0 must move a piece and seat 1 has a ship and cards. */
  function pirateReady(): { state: GameState; seaTile: string; edge: EdgeId } {
    const base = intoMainPhase(seaGame(), 0);

    const sea = Object.values(base.board.tiles).find((t) => t.slot === "sea");
    if (sea === undefined) throw new Error("fixture has no sea hex");
    const edge = sea.edges[0] as EdgeId;

    let state: GameState = {
      ...base,
      turn: 5,
      // Seat 1 has a ship on that sea hex, and nothing else: the pirate steals
      // from ship owners, so a player with no building is still a target.
      ships: { [edge]: { player: 1, builtOnTurn: 0 } },
      players: base.players.map((s) =>
        s.id === 1 ? { ...s, pieces: { ...s.pieces, ships: s.pieces.ships - 1 } } : s,
      ),
      phase: { k: "moveRobber", by: 0, reason: "seven", returnTo: "main" },
    };
    state = giveResources(state, 1, { ore: 2 });
    return { state, seaTile: sea.id, edge };
  }

  it("is offered alongside the robber, which keeps to the land", () => {
    const { state } = pirateReady();
    const moves = legalMoves(state, 0);

    const pirate = moves.filter((m) => m.t === "movePirate");
    const robber = moves.filter((m) => m.t === "moveRobber");
    expect(pirate.length).toBeGreaterThan(0);
    expect(robber.length).toBeGreaterThan(0);

    // Every robber target is land, every pirate target is sea.
    for (const move of robber) {
      if (move.t !== "moveRobber") continue;
      expect(state.board.tiles[move.tile]?.slot).toBe("land");
    }
    for (const move of pirate) {
      if (move.t !== "movePirate") continue;
      expect(state.board.tiles[move.tile]?.slot).toBe("sea");
    }
  });

  it("is not offered in a base game", () => {
    const base = completeSetup(newGame(3));
    const robbing: GameState = {
      ...base,
      phase: { k: "moveRobber", by: 0, reason: "seven", returnTo: "main" },
    };
    expect(legalMoves(robbing, 0).some((m) => m.t === "movePirate")).toBe(false);
  });

  it("sails to a sea hex and takes a card from a ship there", () => {
    const { state, seaTile } = pirateReady();

    const moved = reduce(state, { t: "movePirate", player: 0, tile: seaTile });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    expect(moved.state.pirate).toBe(seaTile);
    expect(moved.state.phase.k).toBe("steal");
    if (moved.state.phase.k !== "steal") return;
    expect(moved.state.phase.from).toBe("pirate");
    // Seat 1 owns the only ship on that hex and holds cards.
    expect(moved.state.phase.targets).toEqual([1]);
    expect(moved.events.some((e) => e.e === "pirateMoved")).toBe(true);

    const stolen = reduce(moved.state, { t: "steal", player: 0, target: 1 });
    expect(stolen.ok).toBe(true);
    if (!stolen.ok) return;
    expect(stolen.state.players[0]?.resources.ore).toBe(1);
    expect(stolen.state.players[1]?.resources.ore).toBe(1);
    assertInvariants(stolen.state, "pirate steal");
  });

  it("refuses to sail onto the land", () => {
    const { state } = pirateReady();
    const land = Object.values(state.board.tiles).find((t) => t.slot === "land");
    const result = reduce(state, {
      t: "movePirate",
      player: 0,
      tile: land?.id ?? "",
    });
    expect(result.ok).toBe(false);
  });

  it("must actually move once it is on the board", () => {
    const { state, seaTile } = pirateReady();
    const parked: GameState = { ...state, pirate: seaTile };
    const result = reduce(parked, { t: "movePirate", player: 0, tile: seaTile });
    expect(result.ok).toBe(false);
    // ...and that hex is no longer offered.
    expect(
      legalMoves(parked, 0).some((m) => m.t === "movePirate" && m.tile === seaTile),
    ).toBe(false);
  });

  it("is not another player's move to make", () => {
    const { state, seaTile } = pirateReady();
    expect(reduce(state, { t: "movePirate", player: 1, tile: seaTile }).ok).toBe(false);
  });

  it("finds no victim on an empty stretch of water", () => {
    const { state } = pirateReady();
    const empty = Object.values(state.board.tiles).find(
      (t) => t.slot === "sea" && !t.edges.some((e) => state.ships[e] !== undefined),
    );
    const moved = reduce(state, {
      t: "movePirate",
      player: 0,
      tile: empty?.id ?? "",
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.state.phase.k).toBe("steal");
    if (moved.state.phase.k !== "steal") return;
    expect(moved.state.phase.targets).toEqual([]);
  });

  it("blocks ship building on its hex once it lands", () => {
    const { state, seaTile, edge } = pirateReady();
    const moved = reduce(state, { t: "movePirate", player: 0, tile: seaTile });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // p.2: no new ship on an edge of the pirate's hex.
    expect(canPlaceShip(moved.state, 1, edge)).toBe(false);
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
