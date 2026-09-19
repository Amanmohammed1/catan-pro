import { describe, it, expect } from "vitest";
import {
  checkInvariants,
  createGame,
  legalMoves,
  reduce,
  revealHex,
} from "@hexport/engine";
import type { GameState } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * A road may never end up on open water, even by way of the fog.
 *
 * The bug this pins was the subtlest of the milestone: a road placed on an edge
 * between a fog space and a sea hex was legal at the instant it was placed —
 * `classifyEdge` calls such an edge `coast`, because the fog might still turn
 * out to be land — and illegal one line later, when the reveal fired in the
 * same action and turned that fog into sea. The edge became sea-and-sea with a
 * road standing on it.
 *
 * It survived 10,000-game fuzz runs on both Fog Islands boards and twenty-one
 * engine tests, because nothing asked whether a road's edge was still a legal
 * kind afterwards. The `road-placement` invariant asks now, and found this
 * within one game of being added — during *setup*, on the opening road.
 */

const BOARDS = ["fog-islands-3", "fog-islands-4"] as const;

/** Land as the rules mean it: not water, and not something still face down. */
function isKnownLand(state: GameState, tile: string): boolean {
  const terrain = state.board.tiles[tile]?.terrain;
  return terrain !== undefined && terrain !== "sea" && terrain !== "fog";
}

describe.each(BOARDS)("%s: roads and the fog", (id) => {
  const scenario = loadScenario(id);

  function freshGame(seed: string): GameState {
    return createGame({
      scenario,
      seed,
      playerNames: ["A", "B", "C", "D"].slice(0, scenario.players.max),
    });
  }

  it("never offers a road on an edge with no land beside it", () => {
    let state = freshGame(`${id}-offers`);

    // Walk the whole setup, checking every road the rules offer. Setup is where
    // the bug first appeared, and where a board is at its emptiest.
    for (let step = 0; step < 400 && state.phase.k === "setup"; step++) {
      const moves = legalMoves(state, state.currentPlayer);
      if (moves.length === 0) break;

      for (const move of moves) {
        if (move.t !== "setupRoad") continue;
        const tiles = state.board.edges[move.edge]?.tiles ?? [];
        expect(
          tiles.some((tile) => isKnownLand(state, tile)),
          `setupRoad offered on ${move.edge}, which borders no land`,
        ).toBe(true);
      }

      const first = moves[0];
      if (first === undefined) break;
      const out = reduce(state, first);
      if (!out.ok) break;
      state = out.state;
    }
  });

  it("catches a road left on water when the fog clears", () => {
    const start = freshGame(`${id}-strand`);

    // An edge between a fog space and the sea: legal for a road today, because
    // the fog might yet be land.
    const edge = Object.values(start.board.edges).find((candidate) => {
      const terrains = candidate.tiles.map((t) => start.board.tiles[t]?.terrain);
      return terrains.includes("fog") && terrains.includes("sea");
    });
    if (edge === undefined) throw new Error("no fog-and-sea edge on this board");

    const withRoad: GameState = {
      ...start,
      roads: { ...start.roads, [edge.id]: 0 },
    };

    // Turn the fog to sea, exactly as a reveal would.
    let board = withRoad.board;
    for (const tile of edge.tiles) {
      if (withRoad.board.tiles[tile]?.terrain !== "fog") continue;
      board = revealHex(board, tile, "sea", null);
    }

    const problems = checkInvariants({ ...withRoad, board });
    expect(problems.map((p) => p.rule)).toContain("road-placement");
  });

  it("still lets a road reach the fog from the land it starts on", () => {
    // The guard must not close off exploration: an edge with land on one side
    // and fog on the other is how a player pushes into the unknown, and it
    // stays legal because the land beside it is known.
    const state = freshGame(`${id}-reach`);

    const reaching = Object.values(state.board.edges).filter((candidate) => {
      const terrains = candidate.tiles.map((t) => state.board.tiles[t]?.terrain);
      return (
        terrains.includes("fog") && candidate.tiles.some((t) => isKnownLand(state, t))
      );
    });

    expect(reaching.length).toBeGreaterThan(0);
    for (const edge of reaching) expect(edge.kind).not.toBe("sea");
  });
});
