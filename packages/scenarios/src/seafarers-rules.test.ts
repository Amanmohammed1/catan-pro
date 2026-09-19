import { describe, it, expect } from "vitest";
import { createGame, legalMoves, reduce } from "@hexport/engine";
import type { GameState, NodeId } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * Seafarers rules, checked one at a time against the rulebook.
 *
 * Citations are to CN3083 Seafarers 2025. These live here rather than in the
 * engine because they need a real scenario to play on — a board with sea on it
 * — and the engine is a leaf that cannot load one.
 *
 * This file exists because a rule can be wrong while everything is green. The
 * Road Building case below shipped broken: the card is base-game machinery, the
 * ship is a module's, and nothing tested the seam between them.
 */

const scenario = loadScenario("new-shores-4");

/** An intersection with land on one side and open water on the other. */
function coastalNode(state: GameState): NodeId {
  for (const node of Object.values(state.board.nodes)) {
    const terrains = node.tiles.map((id) => state.board.tiles[id]?.terrain);
    const hasLand = terrains.some((t) => t !== undefined && t !== "sea");
    if (hasLand && terrains.includes("sea")) return node.id;
  }
  throw new Error("no coastal intersection on this board");
}

/**
 * A game with one coastal settlement down, holding a played Road Building card.
 *
 * The phase is set directly rather than played into. Reaching it honestly means
 * drawing the card from a shuffled deck, which would make the test a test of
 * the shuffle; what is under examination is what the phase offers.
 */
function holdingRoadBuilding(seed: string): GameState {
  const start = createGame({
    scenario,
    seed,
    playerNames: ["A", "B", "C", "D"],
  });

  const settled = reduce(start, {
    t: "setupSettlement",
    player: 0,
    node: coastalNode(start),
  });
  if (!settled.ok) throw new Error(`settlement refused: ${settled.reason}`);

  return {
    ...settled.state,
    currentPlayer: 0,
    phase: { k: "roadBuilding", remaining: 2, returnTo: "main" },
  };
}

describe("Road Building builds ships too (p.3)", () => {
  /*
   * "You may use the Road Building card to build 2 roads, 2 ships, or 1 road
   * and 1 ship at no cost."
   *
   * Ours offered only roads. A player with lumber and wool and a coastal
   * settlement — the exact position the card is worth most in — could not spend
   * it on the sea at all.
   */

  it("offers ships as well as roads while the card is resolving", () => {
    const state = holdingRoadBuilding("road-building");
    const moves = legalMoves(state, 0);

    expect(moves.some((move) => move.t === "buildShip")).toBe(true);
    expect(moves.some((move) => move.t === "buildRoad")).toBe(true);
  });

  it("charges nothing for a ship built with the card", () => {
    const state = holdingRoadBuilding("road-building");
    const ship = legalMoves(state, 0).find((move) => move.t === "buildShip");
    if (ship === undefined) throw new Error("no ship offered");

    const before = state.players[0]?.resources;
    const built = reduce(state, ship);
    if (!built.ok) throw new Error(`ship refused: ${built.reason}`);

    // The player starts with nothing, so a charged ship would have been
    // refused outright — but assert the hand is untouched rather than relying
    // on that, because a later change could hand them a starting stock.
    expect(built.state.players[0]?.resources).toEqual(before);
    expect(built.state.bank).toEqual(state.bank);
  });

  it("spends one of the card's two placements on a ship", () => {
    const state = holdingRoadBuilding("road-building");
    const ship = legalMoves(state, 0).find((move) => move.t === "buildShip");
    if (ship === undefined) throw new Error("no ship offered");

    const built = reduce(state, ship);
    if (!built.ok) throw new Error(`ship refused: ${built.reason}`);

    // Still resolving: one placement left, and it may be either kind again.
    expect(built.state.phase.k).toBe("roadBuilding");
    if (built.state.phase.k !== "roadBuilding") return;
    expect(built.state.phase.remaining).toBe(1);

    const next = legalMoves(built.state, 0);
    expect(next.some((move) => move.t === "buildShip")).toBe(true);
  });

  it("takes the ship off the player's stock like any other", () => {
    const state = holdingRoadBuilding("road-building");
    const ship = legalMoves(state, 0).find((move) => move.t === "buildShip");
    if (ship === undefined) throw new Error("no ship offered");

    const before = state.players[0]?.pieces.ships ?? 0;
    const built = reduce(state, ship);
    if (!built.ok) throw new Error(`ship refused: ${built.reason}`);

    // Free of resources is not free of pieces: p.3 waives the cost, not the
    // fifteen ships in the box.
    expect(built.state.players[0]?.pieces.ships).toBe(before - 1);
    expect(built.state.ships[ship.edge]?.player).toBe(0);
  });

  it("returns to the interrupted phase once both placements are spent", () => {
    let state = holdingRoadBuilding("road-building");

    for (let i = 0; i < 2; i++) {
      const move = legalMoves(state, 0).find((m) => m.t === "buildShip");
      if (move === undefined) break;
      const built = reduce(state, move);
      if (!built.ok) throw new Error(`ship refused: ${built.reason}`);
      state = built.state;
    }

    // Two ships in, the card is done and play resumes where it left off.
    expect(state.phase.k).toBe("main");
  });
});
