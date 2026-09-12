import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { canOfferTrade, legalMoves } from "../queries/legalMoves.js";
import { bestTradeRate } from "../state/helpers.js";
import { victoryPoints } from "../queries/scores.js";
import {
  apply,
  clearAllResources,
  completeSetup,
  giveResources,
  newGame,
} from "./testHelpers.js";
import { emptyResources, type GameState, type ResourceCounts } from "../state/types.js";
import { loadPortScenario } from "./portFixture.js";

/** Trading. Rules p.4, p.7, p.9 (maritime), p.11. */

function ready(playerCount = 3): GameState {
  const state = clearAllResources(completeSetup(newGame(playerCount)));
  return { ...state, phase: { k: "main" }, currentPlayer: 0, turn: 5 };
}

function counts(partial: Partial<ResourceCounts>): ResourceCounts {
  return { ...emptyResources(), ...partial };
}

describe("maritime trade (p.4)", () => {
  it("is always available at 4:1 without a harbor", () => {
    const state = giveResources(ready(), 0, { brick: 4 });
    expect(bestTradeRate(state, 0, "brick")).toBe(4);
    const after = apply(state, {
      t: "bankTrade",
      player: 0,
      give: "brick",
      receive: "ore",
      rate: 4,
    });
    expect(after.players[0]!.resources.brick).toBe(0);
    expect(after.players[0]!.resources.ore).toBe(1);
  });

  it("returns the traded cards to the bank", () => {
    const state = giveResources(ready(), 0, { brick: 4 });
    const bankBrick = state.bank.brick;
    const bankOre = state.bank.ore;
    const after = apply(state, {
      t: "bankTrade",
      player: 0,
      give: "brick",
      receive: "ore",
      rate: 4,
    });
    expect(after.bank.brick).toBe(bankBrick + 4);
    expect(after.bank.ore).toBe(bankOre - 1);
  });

  it("is refused below the rate", () => {
    const state = giveResources(ready(), 0, { brick: 3 });
    expect(
      reduce(state, {
        t: "bankTrade",
        player: 0,
        give: "brick",
        receive: "ore",
        rate: 4,
      }).ok,
    ).toBe(false);
  });

  it("refuses a claimed rate the player has not earned", () => {
    const state = giveResources(ready(), 0, { brick: 4 });
    const result = reduce(state, {
      t: "bankTrade",
      player: 0,
      give: "brick",
      receive: "ore",
      rate: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/best rate/);
  });

  it("refuses trading a resource for itself (p.7)", () => {
    const state = giveResources(ready(), 0, { brick: 8 });
    expect(
      reduce(state, {
        t: "bankTrade",
        player: 0,
        give: "brick",
        receive: "brick",
        rate: 4,
      }).ok,
    ).toBe(false);
    expect(
      legalMoves(state, 0).some((m) => m.t === "bankTrade" && m.give === m.receive),
    ).toBe(false);
  });

  it("refuses when the bank is out of the wanted resource", () => {
    const state = {
      ...giveResources(ready(), 0, { brick: 4 }),
      bank: counts({ brick: 10, ore: 0 }),
    };
    expect(
      reduce(state, {
        t: "bankTrade",
        player: 0,
        give: "brick",
        receive: "ore",
        rate: 4,
      }).ok,
    ).toBe(false);
  });

  it("uses a 3:1 generic harbor when the player owns one (p.9)", () => {
    const state = loadPortScenario("generic");
    expect(bestTradeRate(state, 0, "brick")).toBe(3);
    expect(bestTradeRate(state, 0, "ore")).toBe(3);
  });

  it("uses a 2:1 harbor only for its own resource (p.9)", () => {
    const state = loadPortScenario("ore");
    expect(bestTradeRate(state, 0, "ore")).toBe(2);
    expect(bestTradeRate(state, 0, "brick")).toBe(4);
  });

  it("gives a harbor to its owner only", () => {
    const state = loadPortScenario("ore");
    expect(bestTradeRate(state, 1, "ore")).toBe(4);
  });
});

describe("domestic trade (p.4, p.7)", () => {
  it("is offered only by the active player", () => {
    const state = giveResources(ready(), 0, { brick: 2 });
    expect(canOfferTrade(state, 0)).toBe(true);
    expect(canOfferTrade(state, 1)).toBe(false);
  });

  it("opens an offer that opponents can answer", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = giveResources(state, 1, { ore: 1 });

    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    expect(state.phase.k).toBe("tradeOffer");

    const theirMoves = legalMoves(state, 1);
    expect(theirMoves.some((m) => m.t === "respondTrade")).toBe(true);
  });

  it("completes a trade both sides can pay", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = giveResources(state, 1, { ore: 1 });

    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    state = apply(state, { t: "respondTrade", player: 1, accept: true });
    state = apply(state, { t: "confirmTrade", player: 0, with: 1 });

    expect(state.players[0]!.resources.brick).toBe(0);
    expect(state.players[0]!.resources.ore).toBe(1);
    expect(state.players[1]!.resources.brick).toBe(2);
    expect(state.players[1]!.resources.ore).toBe(0);
    expect(state.phase.k).toBe("main");
  });

  it("refuses an offer of cards the player does not hold", () => {
    const state = ready(3);
    expect(
      reduce(state, {
        t: "offerTrade",
        player: 0,
        give: counts({ brick: 2 }),
        receive: counts({ ore: 1 }),
      }).ok,
    ).toBe(false);
  });

  it("refuses an empty side (no gifts, p.7)", () => {
    const state = giveResources(ready(3), 0, { brick: 2 });
    expect(
      reduce(state, {
        t: "offerTrade",
        player: 0,
        give: counts({ brick: 2 }),
        receive: emptyResources(),
      }).ok,
    ).toBe(false);
  });

  it("stops a player accepting a trade they cannot pay", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    expect(reduce(state, { t: "respondTrade", player: 1, accept: true }).ok).toBe(
      false,
    );
  });

  it("does not let players trade among themselves (p.7)", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = giveResources(state, 1, { ore: 1 });
    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    state = apply(state, { t: "respondTrade", player: 1, accept: true });
    // Only the offering player may confirm.
    expect(reduce(state, { t: "confirmTrade", player: 2, with: 1 }).ok).toBe(false);
  });

  it("cannot confirm with a player who declined", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = giveResources(state, 1, { ore: 1 });
    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    state = apply(state, { t: "respondTrade", player: 1, accept: false });
    expect(reduce(state, { t: "confirmTrade", player: 0, with: 1 }).ok).toBe(false);
  });

  it("can be cancelled by the offering player", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    state = apply(state, { t: "cancelTrade", player: 0 });
    expect(state.phase.k).toBe("main");
  });

  it("conserves resources across a completed trade", () => {
    let state = giveResources(ready(3), 0, { brick: 2 });
    state = giveResources(state, 1, { ore: 1 });
    const before =
      state.players.reduce((sum, s) => sum + s.resources.brick + s.resources.ore, 0) +
      state.bank.brick +
      state.bank.ore;

    state = apply(state, {
      t: "offerTrade",
      player: 0,
      give: counts({ brick: 2 }),
      receive: counts({ ore: 1 }),
    });
    state = apply(state, { t: "respondTrade", player: 1, accept: true });
    state = apply(state, { t: "confirmTrade", player: 0, with: 1 });

    const after =
      state.players.reduce((sum, s) => sum + s.resources.brick + s.resources.ore, 0) +
      state.bank.brick +
      state.bank.ore;
    expect(after).toBe(before);
  });
});

describe("winning (p.7)", () => {
  it("ends the game at the target score", () => {
    let state = giveResources(ready(), 0, { ore: 3, grain: 2 });
    state = { ...state, config: { ...state.config, victoryPoints: 3 } };
    const mine = Object.entries(state.buildings).find(
      ([, b]) => b.player === 0 && b.kind === "settlement",
    )![0];
    // Two settlements = 2 points; upgrading one makes 3.
    state = apply(state, { t: "buildCity", player: 0, node: mine });
    expect(victoryPoints(state, 0)).toBe(3);
    expect(state.winner).toBe(0);
    expect(state.phase.k).toBe("gameOver");
  });

  it("refuses every action once the game is over", () => {
    let state = giveResources(ready(), 0, { ore: 3, grain: 2 });
    state = { ...state, config: { ...state.config, victoryPoints: 3 } };
    const mine = Object.entries(state.buildings).find(
      ([, b]) => b.player === 0 && b.kind === "settlement",
    )![0];
    state = apply(state, { t: "buildCity", player: 0, node: mine });

    expect(reduce(state, { t: "endTurn", player: 0 }).ok).toBe(false);
    expect(legalMoves(state, 0)).toHaveLength(0);
  });

  it("does not end the game below the target", () => {
    const state = ready();
    expect(state.winner).toBeNull();
    expect(victoryPoints(state, 0)).toBe(2);
  });
});
