import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { computeProduction, terrainResource } from "./production.js";
import { legalMoves, discardCount } from "../queries/legalMoves.js";
import { setupPlayerAt } from "../setup/createGame.js";
import {
  apply,
  clearAllResources,
  completeSetup,
  fixedScenario,
  forceRoll,
  giveResources,
  newGame,
  robberAway,
} from "./testHelpers.js";
import { totalResources, type GameState, type PlayerId } from "../state/types.js";
import type { NodeId, TileId } from "../geometry/ids.js";

/**
 * Base game rules. Page references are to docs/rules/catan_base_rules_2020.
 * Anything subtle enough that a player would argue about it gets a citation.
 */

// ---------------------------------------------------------------------------
// Setup, p.12
// ---------------------------------------------------------------------------

describe("setup phase (p.12)", () => {
  it("starts in round one, seat order, placing a settlement", () => {
    const game = newGame(3);
    expect(game.phase.k).toBe("setup");
    if (game.phase.k !== "setup") return;
    expect(game.phase.round).toBe(1);
    expect(game.phase.sub).toBe("settlement");
    expect(game.currentPlayer).toBe(0);
  });

  it("runs round one forwards and round two in reverse", () => {
    const order: PlayerId[] = [0, 1, 2];
    expect([0, 1, 2].map((i) => setupPlayerAt(order, 1, i))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((i) => setupPlayerAt(order, 2, i))).toEqual([2, 1, 0]);
  });

  it("requires a road immediately after each settlement", () => {
    const game = newGame(3);
    const first = legalMoves(game, 0)[0];
    expect(first?.t).toBe("setupSettlement");
    const afterSettlement = apply(game, first!);
    expect(legalMoves(afterSettlement, 0).every((m) => m.t === "setupRoad")).toBe(true);
  });

  it("only offers setup roads touching the settlement just placed", () => {
    const game = newGame(3);
    const settle = legalMoves(game, 0).find((m) => m.t === "setupSettlement");
    const afterSettlement = apply(game, settle!);
    if (afterSettlement.phase.k !== "setup") throw new Error("expected setup");
    const node = afterSettlement.phase.lastSettlement as NodeId;

    for (const move of legalMoves(afterSettlement, 0)) {
      if (move.t !== "setupRoad") continue;
      expect(afterSettlement.board.edges[move.edge]?.nodes.includes(node)).toBe(true);
    }
  });

  it("grants no resources for the first settlement", () => {
    const game = newGame(3);
    let state = apply(game, legalMoves(game, 0)[0]!);
    state = apply(state, legalMoves(state, 0)[0]!);
    expect(totalResources(state.players[0]!.resources)).toBe(0);
  });

  it("grants resources for the second settlement only (p.12)", () => {
    const game = newGame(3);
    const finished = completeSetup(game);
    for (const seat of finished.players) {
      // Each player's second settlement touches 1-3 land hexes.
      const total = totalResources(seat.resources);
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(3);
    }
  });

  it("gives every player exactly two settlements and two roads", () => {
    const finished = completeSetup(newGame(4));
    for (const seat of finished.players) {
      expect(seat.pieces.settlements).toBe(3);
      expect(seat.pieces.roads).toBe(13);
    }
    expect(Object.keys(finished.buildings)).toHaveLength(8);
    expect(Object.keys(finished.roads)).toHaveLength(8);
  });

  it("hands the first turn to the starting player (p.12)", () => {
    const finished = completeSetup(newGame(3));
    expect(finished.phase.k).toBe("roll");
    expect(finished.currentPlayer).toBe(0);
    expect(finished.turn).toBe(1);
  });

  it("enforces the distance rule during setup", () => {
    const game = newGame(3);
    const first = legalMoves(game, 0).find((m) => m.t === "setupSettlement");
    if (first?.t !== "setupSettlement") throw new Error("expected settlement");
    const afterFirst = apply(game, first);
    const taken = first.node;

    for (const neighbour of afterFirst.board.nodes[taken]?.nodes ?? []) {
      const result = reduce(
        { ...afterFirst, phase: { ...afterFirst.phase, sub: "settlement" } as never },
        { t: "setupSettlement", player: 1, node: neighbour },
      );
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a placement from the wrong player", () => {
    const game = newGame(3);
    const move = legalMoves(game, 0)[0];
    if (move?.t !== "setupSettlement") throw new Error("expected settlement");
    const result = reduce(game, { ...move, player: 1 });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Production, p.4 and p.10
// ---------------------------------------------------------------------------

describe("resource production (p.4, p.10)", () => {
  function withSettlement(
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
                  kind === "settlement"
                    ? s.pieces.settlements - 1
                    : s.pieces.settlements,
                cities: kind === "city" ? s.pieces.cities - 1 : s.pieces.cities,
              },
            }
          : s,
      ),
    };
  }

  it("maps each terrain to its resource", () => {
    expect(terrainResource("hill")).toBe("brick");
    expect(terrainResource("forest")).toBe("lumber");
    expect(terrainResource("pasture")).toBe("wool");
    expect(terrainResource("field")).toBe("grain");
    expect(terrainResource("mountain")).toBe("ore");
    expect(terrainResource("desert")).toBeNull();
    expect(terrainResource("sea")).toBeNull();
  });

  it("pays one card per settlement and two per city (p.4)", () => {
    const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
    let state = newGame(2, scenario);
    const tile = Object.values(state.board.tiles)[0]!;
    const node = tile.nodes[0] as NodeId;

    state = withSettlement(state, 0, node);
    const asSettlement = computeProduction(state, 5);
    expect(asSettlement.gains[0]?.lumber).toBeGreaterThanOrEqual(1);

    const cityState = {
      ...state,
      buildings: { [node]: { kind: "city" as const, player: 0 } },
    };
    const asCity = computeProduction(cityState, 5);
    expect(asCity.gains[0]?.lumber).toBe((asSettlement.gains[0]?.lumber ?? 0) * 2);
  });

  it("pays for every adjacent hex bearing the number", () => {
    const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
    let state = newGame(2, scenario);
    // An interior intersection touches three hexes, all forest/5 here.
    const interior = Object.values(state.board.nodes).find(
      (n) => n.tiles.length === 3,
    )!;
    state = withSettlement(state, 0, interior.id);
    // The robber starts on the first hex when there is no desert, which would
    // silently suppress one of the three.
    state = robberAway(state, interior.tiles);
    expect(computeProduction(state, 5).gains[0]?.lumber).toBe(3);
  });

  it("pays nothing on a hex under the robber (p.5)", () => {
    const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
    let state = newGame(2, scenario);
    const tile = Object.values(state.board.tiles)[0]!;
    state = withSettlement(state, 0, tile.nodes[0] as NodeId);

    const blocked = { ...state, robber: tile.id };
    const free = { ...state, robber: "t|99,99" as TileId };
    expect(computeProduction(blocked, 5).gains[0]?.lumber).toBeLessThan(
      computeProduction(free, 5).gains[0]?.lumber ?? 0,
    );
  });

  it("pays nothing when no hex shows the number", () => {
    const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
    let state = newGame(2, scenario);
    const tile = Object.values(state.board.tiles)[0]!;
    state = withSettlement(state, 0, tile.nodes[0] as NodeId);
    expect(computeProduction(state, 9).gains[0]?.lumber).toBe(0);
  });

  it("pays everyone who borders the hex, not just the roller", () => {
    const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
    let state = newGame(3, scenario);
    const tile = Object.values(state.board.tiles)[0]!;
    state = withSettlement(state, 0, tile.nodes[0] as NodeId);
    state = withSettlement(state, 1, tile.nodes[2] as NodeId);
    state = robberAway(state, [tile.id]);

    const result = computeProduction(state, 5);
    expect(result.gains[0]?.lumber).toBeGreaterThan(0);
    expect(result.gains[1]?.lumber).toBeGreaterThan(0);
  });

  describe("bank shortage (p.10)", () => {
    it("pays a single affected player whatever is left", () => {
      const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
      let state = newGame(2, scenario);
      const interior = Object.values(state.board.nodes).find(
        (n) => n.tiles.length === 3,
      )!;
      state = withSettlement(state, 0, interior.id, "city");
      state = robberAway(state, interior.tiles);
      // Only 2 lumber left but the city claims 6.
      state = { ...state, bank: { ...state.bank, lumber: 2 } };

      const result = computeProduction(state, 5);
      expect(result.gains[0]?.lumber).toBe(2);
      expect(result.bank.lumber).toBe(0);
      expect(result.shortages).toContain("lumber");
    });

    it("pays nobody when two or more players are affected", () => {
      const scenario = fixedScenario({ terrains: ["forest"], numbers: [5] });
      let state = newGame(3, scenario);
      const tile = Object.values(state.board.tiles)[0]!;
      state = withSettlement(state, 0, tile.nodes[0] as NodeId);
      state = withSettlement(state, 1, tile.nodes[2] as NodeId);
      state = robberAway(state, [tile.id]);
      state = { ...state, bank: { ...state.bank, lumber: 1 } };

      const result = computeProduction(state, 5);
      expect(result.gains[0]?.lumber).toBe(0);
      expect(result.gains[1]?.lumber).toBe(0);
      expect(result.bank.lumber).toBe(1);
      expect(result.shortages).toContain("lumber");
    });

    it("leaves other resource types unaffected by one shortage", () => {
      const scenario = fixedScenario({
        terrains: ["forest", "hill"],
        numbers: [5, 5],
      });
      let state = newGame(3, scenario);
      const forest = Object.values(state.board.tiles).find(
        (t) => t.terrain === "forest",
      )!;
      const hill = Object.values(state.board.tiles).find((t) => t.terrain === "hill")!;
      state = withSettlement(state, 0, forest.nodes[0] as NodeId);
      state = withSettlement(state, 1, forest.nodes[2] as NodeId);
      state = withSettlement(state, 2, hill.nodes[3] as NodeId);
      state = robberAway(state, [forest.id, hill.id]);
      state = { ...state, bank: { ...state.bank, lumber: 1 } };

      const result = computeProduction(state, 5);
      expect(result.gains[2]?.brick).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Rolling, the 7, and the robber. p.5, p.11
// ---------------------------------------------------------------------------

describe("rolling and the robber (p.5, p.11)", () => {
  it("produces two dice between 1 and 6", () => {
    let state = completeSetup(newGame(3));
    for (let i = 0; i < 40; i++) {
      const result = reduce(state, { t: "rollDice", player: state.currentPlayer });
      if (!result.ok) throw new Error(result.reason);
      const [a, b] = result.state.dice!;
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
      state = result.state;
      if (state.phase.k === "main") {
        state = apply(state, { t: "endTurn", player: state.currentPlayer });
      } else break;
    }
  });

  it("cannot roll twice in one turn", () => {
    let state = completeSetup(newGame(3));
    const result = reduce(state, { t: "rollDice", player: 0 });
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
    expect(reduce(state, { t: "rollDice", player: 0 }).ok).toBe(false);
  });

  it("refuses a roll from a player whose turn it is not", () => {
    const state = completeSetup(newGame(3));
    expect(reduce(state, { t: "rollDice", player: 1 }).ok).toBe(false);
  });

  it("computes the discard count as half, rounded down (p.11)", () => {
    expect(discardCount(7, 7)).toBe(0);
    expect(discardCount(8, 7)).toBe(4);
    expect(discardCount(9, 7)).toBe(4);
    expect(discardCount(11, 7)).toBe(5);
    expect(discardCount(12, 7)).toBe(6);
  });

  it("sends players over the limit to the discard phase on a 7", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = giveResources(state, 1, { brick: 9 });
    state = forceRoll(state, 7);

    expect(state.phase.k).toBe("discard");
    if (state.phase.k !== "discard") return;
    expect(state.phase.pending).toContain(1);
    expect(state.phase.pending).not.toContain(2);
  });

  it("rejects a discard of the wrong size", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = giveResources(state, 1, { brick: 9 });
    state = forceRoll(state, 7);

    const tooFew = reduce(state, {
      t: "discard",
      player: 1,
      resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
    expect(tooFew.ok).toBe(false);
    expect(tooFew.ok === false && tooFew.reason).toMatch(/exactly 4/);
  });

  it("rejects discarding cards the player does not hold", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = giveResources(state, 1, { brick: 9 });
    state = forceRoll(state, 7);

    const result = reduce(state, {
      t: "discard",
      player: 1,
      resources: { brick: 0, lumber: 4, wool: 0, grain: 0, ore: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("moves to the robber once every discard is in", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = giveResources(state, 1, { brick: 8 });
    state = forceRoll(state, 7);
    state = apply(state, {
      t: "discard",
      player: 1,
      resources: { brick: 4, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
    expect(state.phase.k).toBe("moveRobber");
  });

  it("skips discards entirely when nobody is over the limit", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);
    expect(state.phase.k).toBe("moveRobber");
  });

  it("refuses to leave the robber where it is (p.11)", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);
    const result = reduce(state, {
      t: "moveRobber",
      player: state.currentPlayer,
      tile: state.robber,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/different hex/);
  });

  it("never offers the current hex as a robber destination", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);
    const moves = legalMoves(state, state.currentPlayer);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      if (move.t === "moveRobber") expect(move.tile).not.toBe(state.robber);
    }
  });

  it("offers only adjacent opponents holding cards as steal targets (p.8)", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);

    // Find a hex with an opponent building, and give that opponent a card.
    const target = Object.values(state.board.tiles).find(
      (tile) =>
        tile.id !== state.robber &&
        tile.nodes.some((n) => {
          const b = state.buildings[n];
          return b !== undefined && b.player !== state.currentPlayer;
        }),
    );
    expect(target).toBeDefined();

    const victim = target!.nodes
      .map((n) => state.buildings[n])
      .find((b) => b !== undefined && b.player !== state.currentPlayer)!.player;

    state = giveResources(state, victim, { ore: 1 });
    state = apply(state, {
      t: "moveRobber",
      player: state.currentPlayer,
      tile: target!.id,
    });

    expect(state.phase.k).toBe("steal");
    if (state.phase.k !== "steal") return;
    expect(state.phase.targets).toContain(victim);
    expect(state.phase.targets).not.toContain(state.currentPlayer);
  });

  it("transfers exactly one card when stealing", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);

    const target = Object.values(state.board.tiles).find(
      (tile) =>
        tile.id !== state.robber &&
        tile.nodes.some((n) => {
          const b = state.buildings[n];
          return b !== undefined && b.player !== state.currentPlayer;
        }),
    )!;
    const victim = target.nodes
      .map((n) => state.buildings[n])
      .find((b) => b !== undefined && b.player !== state.currentPlayer)!.player;

    state = giveResources(state, victim, { ore: 3 });
    state = apply(state, {
      t: "moveRobber",
      player: state.currentPlayer,
      tile: target.id,
    });

    const thiefBefore = totalResources(state.players[state.currentPlayer]!.resources);
    const victimBefore = totalResources(state.players[victim]!.resources);

    const after = apply(state, {
      t: "steal",
      player: state.currentPlayer,
      target: victim,
    });

    expect(totalResources(after.players[after.currentPlayer]!.resources)).toBe(
      thiefBefore + 1,
    );
    expect(totalResources(after.players[victim]!.resources)).toBe(victimBefore - 1);
  });

  it("skips the steal when no adjacent opponent holds a card", () => {
    let state = clearAllResources(completeSetup(newGame(3)));
    state = forceRoll(state, 7);

    const empty = Object.values(state.board.tiles).find(
      (tile) =>
        tile.id !== state.robber &&
        !tile.nodes.some((n) => state.buildings[n] !== undefined),
    )!;
    state = apply(state, {
      t: "moveRobber",
      player: state.currentPlayer,
      tile: empty.id,
    });

    expect(state.phase.k).toBe("steal");
    if (state.phase.k !== "steal") return;
    expect(state.phase.targets).toHaveLength(0);

    const after = apply(state, {
      t: "steal",
      player: state.currentPlayer,
      target: null,
    });
    expect(after.phase.k).toBe("main");
  });
});
