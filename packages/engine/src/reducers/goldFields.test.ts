import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { computeProduction, goldQueue } from "./production.js";
import { createGame } from "../setup/createGame.js";
import { legalMoves } from "../queries/legalMoves.js";
import { assertInvariants } from "../state/invariants.js";
import { forceRoll, newGame } from "./testHelpers.js";
import type { NodeId } from "../geometry/ids.js";
import type { Scenario, ScenarioCell } from "../scenario/types.js";
import type { GameState, PlayerId } from "../state/types.js";

/**
 * Seafarers gold fields, p.2:
 *
 *   "Each player with a settlement on a gold field hex that produces this turn
 *    receives 1 resource card of their choice (brick, wood, wool, wheat, or
 *    ore). Similarly, a player receives 2 resource cards in any combination for
 *    each of their cities on that hex."
 *
 * A choice cannot be paid out silently, so production stops and `legalMoves()`
 * enumerates it. These live beside the reducer rather than with the Seafarers
 * module because the base reducer owns the phase: `rollDice` enters it, and
 * routing the exit through a module would split one flow across two owners.
 */

/** A radius-1 board with a single gold hex, its number pinned so rolls are aimed. */
function goldScenario(): Scenario {
  const cells: ScenarioCell[] = [
    { coord: [0, 0], slot: "land", terrain: "gold", number: 6 },
    { coord: [1, 0], slot: "land", terrain: "forest" },
    { coord: [0, 1], slot: "land", terrain: "pasture" },
    { coord: [-1, 1], slot: "land", terrain: "field" },
    { coord: [1, -1], slot: "land", terrain: "hill" },
    { coord: [0, -1], slot: "land", terrain: "mountain" },
    { coord: [-1, 0], slot: "land", terrain: "forest" },
  ];

  return {
    id: "gold-test",
    name: "Gold Test",
    schemaVersion: 1,
    players: { min: 2, max: 4 },
    victoryPoints: 10,
    modules: ["base", "seafarers"],
    layout: { orientation: "pointy" },
    cells,
    bags: {},
    numbers: {
      // The gold hex pins its own number and so consumes no token; the other
      // six take one each.
      mode: "path",
      sequence: [3, 4, 5, 8, 9, 10],
      path: cells.map((c) => c.coord),
      skipTerrains: ["desert", "sea"],
    },
    ports: [],
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [],
    hiddenStacks: [],
    startingPieces: [],
  };
}

/** Ready to roll: no setup played, so only the buildings a test places exist. */
function goldGame(): GameState {
  const game = createGame({
    scenario: goldScenario(),
    seed: "gold",
    playerNames: ["P0", "P1"],
  });
  return { ...game, phase: { k: "roll" }, currentPlayer: 0, turn: 5 };
}

/** The corners of the gold hex, in corner order. Non-adjacent pairs are 0 and 2. */
function goldCorners(state: GameState): readonly NodeId[] {
  const gold = Object.values(state.board.tiles).find((t) => t.terrain === "gold");
  if (gold === undefined) throw new Error("fixture has no gold hex");
  return gold.nodes;
}

/**
 * Put a building on the board with the stock kept straight.
 *
 * A city takes only a city from the stock, not a settlement as well. Rules p.5:
 * a city *replaces* a settlement, which goes back to your supply — which is
 * what `buildCity` does in the reducer (`settlements + 1, cities - 1`). So the
 * settled position is one city on the board and a full settlement stock, and
 * `checkInvariants` holds each player to exactly that.
 */
function place(
  state: GameState,
  player: PlayerId,
  node: NodeId,
  kind: "settlement" | "city" = "settlement",
): GameState {
  return {
    ...state,
    buildings: { ...state.buildings, [node]: { kind, player } },
    players: state.players.map((s) =>
      s.id === player
        ? {
            ...s,
            pieces: {
              ...s.pieces,
              settlements:
                kind === "city" ? s.pieces.settlements : s.pieces.settlements - 1,
              cities: kind === "city" ? s.pieces.cities - 1 : s.pieces.cities,
            },
          }
        : s,
    ),
  };
}

describe("what a gold field owes (p.2)", () => {
  it("owes one card for a settlement", () => {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    const production = computeProduction(state, 6);
    expect(production.goldOwed).toEqual({ 0: 1 });
  });

  it("owes two for a city", () => {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId, "city");
    expect(computeProduction(state, 6).goldOwed).toEqual({ 0: 2 });
  });

  it("owes nothing when the hex does not produce", () => {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    expect(computeProduction(state, 3).goldOwed).toEqual({});
  });

  it("owes nothing while the robber sits on it", () => {
    const base = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    const gold = Object.values(base.board.tiles).find((t) => t.terrain === "gold");
    const robbed = { ...base, robber: gold?.id ?? base.robber };
    expect(computeProduction(robbed, 6).goldOwed).toEqual({});
  });

  it("pays no ordinary resource for the gold hex itself", () => {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    const production = computeProduction(state, 6);
    // The only producing hex is gold, so nothing lands in the ordinary gains.
    expect(production.gains[0]).toEqual({
      brick: 0,
      lumber: 0,
      wool: 0,
      grain: 0,
      ore: 0,
    });
  });

  it("queues players in seat order", () => {
    const corners = goldCorners(goldGame());
    let state = place(goldGame(), 1, corners[0] as NodeId);
    state = place(state, 0, corners[2] as NodeId);
    expect(goldQueue(computeProduction(state, 6))).toEqual([
      { player: 0, count: 1 },
      { player: 1, count: 1 },
    ]);
  });
});

describe("taking the card", () => {
  function rolled(): GameState {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    return forceRoll(state, 6);
  }

  it("stops the turn in the gold phase rather than reaching main", () => {
    const state = rolled();
    expect(state.phase.k).toBe("gainGold");
    if (state.phase.k !== "gainGold") return;
    expect(state.phase.player).toBe(0);
    expect(state.phase.remaining).toBe(1);
  });

  it("offers one move per resource the bank can pay, and only to the holder", () => {
    const state = rolled();
    const mine = legalMoves(state, 0);
    expect(mine).toHaveLength(5);
    expect(new Set(mine.map((m) => m.t))).toEqual(new Set(["takeGold"]));
    expect(legalMoves(state, 1)).toEqual([]);
  });

  it("moves a card from the bank to the hand and resumes the turn", () => {
    const state = rolled();
    const bankBefore = state.bank.ore;

    const result = reduce(state, { t: "takeGold", player: 0, resource: "ore" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.players[0]?.resources.ore).toBe(1);
    expect(result.state.bank.ore).toBe(bankBefore - 1);
    expect(result.state.phase.k).toBe("main");
    expect(result.events.some((e) => e.e === "goldTaken")).toBe(true);
    assertInvariants(result.state, "takeGold");
  });

  it("asks twice for a city, then resumes", () => {
    const state = forceRoll(
      place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId, "city"),
      6,
    );
    expect(state.phase.k).toBe("gainGold");

    const first = reduce(state, { t: "takeGold", player: 0, resource: "brick" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.phase.k).toBe("gainGold");

    const second = reduce(first.state, { t: "takeGold", player: 0, resource: "wool" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.phase.k).toBe("main");
    expect(second.state.players[0]?.resources.brick).toBe(1);
    expect(second.state.players[0]?.resources.wool).toBe(1);
    assertInvariants(second.state, "takeGold twice");
  });

  it("hands the phase to a player whose turn it is not", () => {
    const corners = goldCorners(goldGame());
    let state = place(goldGame(), 0, corners[0] as NodeId);
    state = place(state, 1, corners[2] as NodeId);
    state = forceRoll(state, 6);

    // Seat 0 is owed first, then seat 1 — who is not the current player.
    const first = reduce(state, { t: "takeGold", player: 0, resource: "ore" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.state.phase.k).toBe("gainGold");
    if (first.state.phase.k !== "gainGold") return;
    expect(first.state.phase.player).toBe(1);
    expect(first.state.currentPlayer).toBe(0);
  });

  it("refuses a card the holder is not owed", () => {
    const state = rolled();
    expect(reduce(state, { t: "takeGold", player: 1, resource: "ore" }).ok).toBe(false);
  });

  it("refuses a resource the bank cannot pay", () => {
    const state = rolled();
    const dry = { ...state, bank: { ...state.bank, ore: 0 } };
    expect(reduce(dry, { t: "takeGold", player: 0, resource: "ore" }).ok).toBe(false);
  });

  it("refuses to take gold outside the phase", () => {
    const state = { ...goldGame(), phase: { k: "main" as const } };
    expect(reduce(state, { t: "takeGold", player: 0, resource: "ore" }).ok).toBe(false);
  });
});

describe("an empty bank", () => {
  /**
   * The stall this guards against: `legalMoves()` offers only resources the
   * bank holds, so a gold window opened over an empty bank would offer no move
   * at all and the turn could never end. Rules p.10 loses production the supply
   * cannot pay, and the same answer is applied to a choice.
   */
  it("never opens the phase at all", () => {
    const state = place(goldGame(), 0, goldCorners(goldGame())[0] as NodeId);
    const broke = {
      ...state,
      bank: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    };
    const rolledOut = forceRoll(broke, 6);
    expect(rolledOut.phase.k).toBe("main");
    expect(legalMoves(rolledOut, 0).length).toBeGreaterThan(0);
  });

  it("closes the phase once the last card empties it", () => {
    const corners = goldCorners(goldGame());
    let state = place(goldGame(), 0, corners[0] as NodeId);
    state = place(state, 1, corners[2] as NodeId);
    // One ore between them, and nothing else.
    state = { ...state, bank: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 } };
    state = forceRoll(state, 6);
    expect(state.phase.k).toBe("gainGold");

    const taken = reduce(state, { t: "takeGold", player: 0, resource: "ore" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;

    // Seat 1 is still owed a card, but there is nothing left to pay it with.
    expect(taken.state.phase.k).toBe("main");
    expect(legalMoves(taken.state, 0).length).toBeGreaterThan(0);
  });
});

describe("a base game", () => {
  it("never enters the gold phase, having no gold hexes", () => {
    let state = newGame(3);
    state = { ...state, phase: { k: "roll" }, currentPlayer: 0, turn: 5 };
    const after = forceRoll(state, 5);
    expect(after.phase.k).not.toBe("gainGold");
  });
});
