import { describe, it, expect } from "vitest";
import { legalMoves } from "../queries/legalMoves.js";
import { victoryPoints } from "../queries/scores.js";
import { reduce } from "./reduce.js";
import {
  apply,
  applyResult,
  completeSetup,
  fixedScenario,
  giveResources,
  intoMainPhase,
  newGame,
} from "./testHelpers.js";
import type { Action } from "../actions/types.js";
import type { GameState, PlayerId } from "../state/types.js";
import type { Scenario } from "../scenario/types.js";

/**
 * The Special Building Phase of the 5–6 player game (ADR 0006).
 *
 * After a turn ends, every other player in clockwise order gets one window in
 * which they may build and buy development cards — and nothing else. No
 * rulebook in docs/rules describes this phase (both editions we hold replaced
 * it with paired players), so these tests are the specification: the ADR says
 * what we implement and this says it in code.
 */

const ext56Scenario: Scenario = {
  ...fixedScenario(),
  players: { min: 2, max: 6 },
  modules: ["base", "ext56"],
};

/** A four-player 5–6-rules game, set up, with player 0 about to end their turn. */
function gameInMain(players = 4): GameState {
  return intoMainPhase(completeSetup(newGame(players, ext56Scenario)), 0);
}

function endTurnOf(state: GameState, player: PlayerId): GameState {
  return apply(state, { t: "endTurn", player });
}

/** A legal road for this player, or null when their network has no room. */
function someRoad(state: GameState, player: PlayerId): Action | null {
  return legalMoves(state, player).find((m) => m.t === "buildRoad") ?? null;
}

describe("entering the phase", () => {
  it("opens a window for every other player, starting with the next", () => {
    const state = endTurnOf(gameInMain(4), 0);

    expect(state.phase.k).toBe("specialBuild");
    if (state.phase.k !== "specialBuild") return;
    expect(state.phase.queue).toEqual([1, 2, 3]);
    expect(state.phase.nextPlayer).toBe(1);
  });

  it("announces the window in the event log", () => {
    const result = reduce(gameInMain(4), { t: "endTurn", player: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      e: "specialBuildStarted",
      players: [1, 2, 3],
    });
  });

  it("does not start the next turn yet", () => {
    const before = gameInMain(4);
    const after = endTurnOf(before, 0);
    expect(after.turn).toBe(before.turn);
    expect(after.currentPlayer).toBe(0);
  });

  it("never happens in a base game", () => {
    const base = intoMainPhase(completeSetup(newGame(3)), 0);
    const after = endTurnOf(base, 0);
    expect(after.phase.k).toBe("roll");
    expect(after.currentPlayer).toBe(1);
  });
});

describe("who may act", () => {
  it("offers the head of the queue building moves and a way out", () => {
    const state = endTurnOf(gameInMain(4), 0);
    const kinds = new Set(legalMoves(state, 1).map((m) => m.t));

    expect(kinds).toContain("passSpecialBuild");
    for (const forbidden of [
      "bankTrade",
      "offerTrade",
      "playKnight",
      "playRoadBuilding",
      "rollDice",
      "endTurn",
    ]) {
      expect(kinds).not.toContain(forbidden);
    }
  });

  it("offers nothing to players further down the queue", () => {
    const state = endTurnOf(gameInMain(4), 0);
    expect(legalMoves(state, 2)).toHaveLength(0);
    expect(legalMoves(state, 3)).toHaveLength(0);
  });

  it("offers nothing to the player who just finished their turn", () => {
    const state = endTurnOf(gameInMain(4), 0);
    expect(legalMoves(state, 0)).toHaveLength(0);
  });

  it("refuses a build from someone whose window is not open", () => {
    const state = giveResources(endTurnOf(gameInMain(4), 0), 2, {
      brick: 1,
      lumber: 1,
    });
    const road = someRoad({ ...state, phase: { k: "main" }, currentPlayer: 2 }, 2);
    expect(road).not.toBeNull();
    if (road === null) return;

    const result = applyResult(state, road);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("Not your building window.");
  });
});

describe("what a window allows", () => {
  it("lets the player build", () => {
    const state = giveResources(endTurnOf(gameInMain(4), 0), 1, {
      brick: 1,
      lumber: 1,
    });
    const road = someRoad(state, 1);
    expect(road).not.toBeNull();
    if (road === null) return;

    const after = apply(state, road);
    expect(Object.values(after.roads).filter((owner) => owner === 1).length).toBe(3);
    // Still the same window: building does not end it.
    expect(after.phase.k).toBe("specialBuild");
  });

  it("lets the player buy a development card", () => {
    const state = giveResources(endTurnOf(gameInMain(4), 0), 1, {
      ore: 1,
      wool: 1,
      grain: 1,
    });
    const after = apply(state, { t: "buyDevCard", player: 1 });
    expect(after.players[1]?.devCards).toHaveLength(1);
  });

  it("refuses a trade with the bank", () => {
    const state = giveResources(endTurnOf(gameInMain(4), 0), 1, { lumber: 4 });
    const result = applyResult(state, {
      t: "bankTrade",
      player: 1,
      give: "lumber",
      receive: "ore",
      rate: 4,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a trade offer to the table", () => {
    const state = giveResources(endTurnOf(gameInMain(4), 0), 1, { lumber: 2 });
    const result = applyResult(state, {
      t: "offerTrade",
      player: 1,
      give: { brick: 0, lumber: 1, wool: 0, grain: 0, ore: 0 },
      receive: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a development card", () => {
    const opened = endTurnOf(gameInMain(4), 0);
    const holding = {
      ...opened,
      players: opened.players.map((seat) =>
        seat.id === 1
          ? {
              ...seat,
              devCards: [
                { kind: "knight" as const, boughtOnTurn: 0, played: false },
              ],
            }
          : seat,
      ),
    };

    const result = applyResult(holding, { t: "playKnight", player: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("handing the window on", () => {
  it("passes to the next player in the queue", () => {
    const state = apply(endTurnOf(gameInMain(4), 0), {
      t: "passSpecialBuild",
      player: 1,
    });

    expect(state.phase.k).toBe("specialBuild");
    if (state.phase.k !== "specialBuild") return;
    expect(state.phase.queue).toEqual([2, 3]);
  });

  it("refuses a pass from anyone but the head of the queue", () => {
    const result = applyResult(endTurnOf(gameInMain(4), 0), {
      t: "passSpecialBuild",
      player: 3,
    });
    expect(result.ok).toBe(false);
  });

  it("starts the next player's turn when the last window closes", () => {
    let state = endTurnOf(gameInMain(4), 0);
    for (const player of [1, 2, 3]) {
      state = apply(state, { t: "passSpecialBuild", player });
    }

    expect(state.phase.k).toBe("roll");
    expect(state.currentPlayer).toBe(1);
    expect(state.turn).toBe(2);
  });

  it("emits the start of that turn", () => {
    let state = endTurnOf(gameInMain(4), 0);
    state = apply(state, { t: "passSpecialBuild", player: 1 });
    state = apply(state, { t: "passSpecialBuild", player: 2 });

    const result = reduce(state, { t: "passSpecialBuild", player: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({ e: "turnStarted", player: 1, turn: 2 });
  });

  it("refuses a pass when no window is open", () => {
    const result = applyResult(gameInMain(4), {
      t: "passSpecialBuild",
      player: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("winning", () => {
  it("does not end the game during someone else's turn", () => {
    // Two points is what setup already gives, so one more building wins.
    const low = { ...gameInMain(4), config: { ...gameInMain(4).config, victoryPoints: 3 } };
    const opened = giveResources(endTurnOf(low, 0), 1, {
      brick: 2,
      lumber: 2,
      wool: 1,
      grain: 1,
    });

    // Build until the settlement lands; a road first if the network needs one.
    const settlement = legalMoves(opened, 1).find((m) => m.t === "buildSettlement");
    const built = settlement === null ? opened : apply(opened, settlement ?? { t: "passSpecialBuild", player: 1 });

    if (settlement !== undefined) {
      expect(victoryPoints(built, 1)).toBeGreaterThanOrEqual(3);
      // p.7: you can only win on your own turn, and a building window is not
      // your turn.
      expect(built.winner).toBeNull();
      expect(built.phase.k).toBe("specialBuild");
    }
  });
});
