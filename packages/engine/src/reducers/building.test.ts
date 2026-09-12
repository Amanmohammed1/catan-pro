import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { legalMoves } from "../queries/legalMoves.js";
import { canPlaceRoad, satisfiesDistanceRule } from "../queries/placement.js";
import { publicVictoryPoints } from "../queries/scores.js";
import {
  apply,
  clearAllResources,
  completeSetup,
  giveResources,
  newGame,
} from "./testHelpers.js";
import { COSTS, type GameState, type PlayerId } from "../state/types.js";
import type { EdgeId, NodeId } from "../geometry/ids.js";

/** Building and upgrading. Rules p.4-5. */

function readyToBuild(playerCount = 3): GameState {
  const state = clearAllResources(completeSetup(newGame(playerCount)));
  return { ...state, phase: { k: "main" }, currentPlayer: 0 };
}

/** An edge this player may legally build on right now. */
function openRoad(state: GameState, player: PlayerId): EdgeId {
  const edge = Object.keys(state.board.edges).find((e) =>
    canPlaceRoad(state, player, e, { setup: false }),
  );
  if (edge === undefined) throw new Error("no legal road");
  return edge;
}

describe("roads (p.4)", () => {
  it("costs one brick and one lumber", () => {
    let state = giveResources(readyToBuild(), 0, { brick: 1, lumber: 1 });
    const edge = openRoad(state, 0);
    const before = state.players[0]!.resources;
    state = apply(state, { t: "buildRoad", player: 0, edge });
    expect(state.players[0]!.resources.brick).toBe(before.brick - 1);
    expect(state.players[0]!.resources.lumber).toBe(before.lumber - 1);
  });

  it("is refused without the resources", () => {
    const state = readyToBuild();
    const edge = openRoad(state, 0);
    const result = reduce(state, { t: "buildRoad", player: 0, edge });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/afford/);
  });

  it("returns the cost to the bank", () => {
    let state = giveResources(readyToBuild(), 0, { brick: 1, lumber: 1 });
    const bankBefore = state.bank.brick;
    state = apply(state, { t: "buildRoad", player: 0, edge: openRoad(state, 0) });
    expect(state.bank.brick).toBe(bankBefore + 1);
  });

  it("allows only one road per path", () => {
    let state = giveResources(readyToBuild(), 0, { brick: 2, lumber: 2 });
    const edge = openRoad(state, 0);
    state = apply(state, { t: "buildRoad", player: 0, edge });
    const again = reduce(state, { t: "buildRoad", player: 0, edge });
    expect(again.ok).toBe(false);
  });

  it("must connect to the player's own network", () => {
    const state = giveResources(readyToBuild(), 0, { brick: 1, lumber: 1 });
    const disconnected = Object.keys(state.board.edges).find(
      (e) => !canPlaceRoad(state, 0, e, { setup: false }),
    )!;
    expect(reduce(state, { t: "buildRoad", player: 0, edge: disconnected }).ok).toBe(
      false,
    );
  });

  it("cannot connect through an opponent's settlement (p.11, Illus. K)", () => {
    const state = readyToBuild();
    // Find one of player 0's road endpoints, put an opponent building there,
    // and confirm the far-side edges stop being legal.
    const myRoad = Object.entries(state.roads).find(([, p]) => p === 0)![0];
    const [a, b] = state.board.edges[myRoad]!.nodes;
    const junction = state.buildings[a] === undefined ? a : b;

    const throughEdges = (state.board.nodes[junction]?.edges ?? []).filter(
      (e) => e !== myRoad && state.roads[e] === undefined,
    );
    const openBefore = throughEdges.filter((e) =>
      canPlaceRoad(state, 0, e, { setup: false }),
    );
    expect(openBefore.length).toBeGreaterThan(0);

    const blocked: GameState = {
      ...state,
      buildings: {
        ...state.buildings,
        [junction]: { kind: "settlement", player: 1 },
      },
    };
    for (const edge of openBefore) {
      // Still legal only if it also touches some other road of mine.
      const alsoElsewhere = (blocked.board.edges[edge]?.nodes ?? []).some(
        (n) =>
          n !== junction &&
          (blocked.board.nodes[n]?.edges ?? []).some(
            (e2) => e2 !== edge && blocked.roads[e2] === 0,
          ),
      );
      if (!alsoElsewhere) {
        expect(canPlaceRoad(blocked, 0, edge, { setup: false })).toBe(false);
      }
    }
  });

  it("runs out at fifteen roads (p.5)", () => {
    let state = giveResources(readyToBuild(), 0, { brick: 20, lumber: 20 });
    state = {
      ...state,
      players: state.players.map((s) =>
        s.id === 0 ? { ...s, pieces: { ...s.pieces, roads: 0 } } : s,
      ),
    };
    expect(legalMoves(state, 0).some((m) => m.t === "buildRoad")).toBe(false);
  });
});

describe("settlements (p.5)", () => {
  /**
   * Straight after setup a player has no legal settlement spot at all: both of
   * their roads end on an intersection adjacent to their own settlement, which
   * the distance rule forbids. So extend the network by one road first, which
   * is what a real player has to do too.
   */
  function extendedNetwork(): { state: GameState; node: NodeId } {
    let state = giveResources(readyToBuild(), 0, { brick: 4, lumber: 4 });

    for (let step = 0; step < 4; step++) {
      const node = Object.keys(state.board.nodes).find(
        (n) =>
          satisfiesDistanceRule(state, n) &&
          (state.board.nodes[n]?.edges ?? []).some((e) => state.roads[e] === 0),
      );
      if (node !== undefined) return { state, node };
      state = apply(state, { t: "buildRoad", player: 0, edge: openRoad(state, 0) });
    }
    throw new Error("no legal settlement after extending the network");
  }

  it("costs brick, lumber, wool and grain", () => {
    const { state: base, node } = extendedNetwork();
    let state = giveResources(base, 0, { wool: 1, grain: 1 });
    const before = state.players[0]!.resources;
    state = apply(state, { t: "buildSettlement", player: 0, node });
    const after = state.players[0]!.resources;
    expect(after.brick).toBe(before.brick - 1);
    expect(after.lumber).toBe(before.lumber - 1);
    expect(after.wool).toBe(before.wool - 1);
    expect(after.grain).toBe(before.grain - 1);
    expect(after.ore).toBe(before.ore);
  });

  it("has no legal spot immediately after setup (distance rule, p.5)", () => {
    // Both setup roads end next to the player's own settlement, so every
    // reachable intersection is blocked until the network is extended.
    const state = giveResources(readyToBuild(), 0, {
      brick: 1,
      lumber: 1,
      wool: 1,
      grain: 1,
    });
    expect(legalMoves(state, 0).some((m) => m.t === "buildSettlement")).toBe(false);
  });

  it("is worth one victory point", () => {
    const { state: base, node } = extendedNetwork();
    const state = giveResources(base, 0, { wool: 1, grain: 1 });
    const before = publicVictoryPoints(state, 0);
    const after = apply(state, { t: "buildSettlement", player: 0, node });
    expect(publicVictoryPoints(after, 0)).toBe(before + 1);
  });

  it("obeys the distance rule", () => {
    const state = readyToBuild();
    for (const [node] of Object.entries(state.buildings)) {
      for (const neighbour of state.board.nodes[node]?.nodes ?? []) {
        expect(satisfiesDistanceRule(state, neighbour)).toBe(false);
      }
    }
  });

  it("needs one of the player's own roads", () => {
    const state = giveResources(readyToBuild(), 0, {
      brick: 1,
      lumber: 1,
      wool: 1,
      grain: 1,
    });
    const noRoad = Object.keys(state.board.nodes).find(
      (n) =>
        satisfiesDistanceRule(state, n) &&
        !(state.board.nodes[n]?.edges ?? []).some((e) => state.roads[e] === 0),
    )!;
    expect(reduce(state, { t: "buildSettlement", player: 0, node: noRoad }).ok).toBe(
      false,
    );
  });

  it("cannot be built on an occupied intersection", () => {
    const state = giveResources(readyToBuild(), 0, {
      brick: 1,
      lumber: 1,
      wool: 1,
      grain: 1,
    });
    const taken = Object.keys(state.buildings)[0] as NodeId;
    expect(reduce(state, { t: "buildSettlement", player: 0, node: taken }).ok).toBe(
      false,
    );
  });
});

describe("cities (p.5)", () => {
  it("cost three ore and two grain and are worth two points", () => {
    let state = giveResources(readyToBuild(), 0, { ore: 3, grain: 2 });
    const mine = Object.entries(state.buildings).find(
      ([, b]) => b.player === 0 && b.kind === "settlement",
    )![0];

    const before = publicVictoryPoints(state, 0);
    state = apply(state, { t: "buildCity", player: 0, node: mine });

    expect(state.buildings[mine]?.kind).toBe("city");
    expect(publicVictoryPoints(state, 0)).toBe(before + 1); // 1 -> 2
    expect(state.players[0]!.resources.ore).toBe(0);
    expect(state.players[0]!.resources.grain).toBe(0);
  });

  it("return the settlement piece to the supply (p.5)", () => {
    let state = giveResources(readyToBuild(), 0, { ore: 3, grain: 2 });
    const mine = Object.entries(state.buildings).find(
      ([, b]) => b.player === 0 && b.kind === "settlement",
    )![0];
    const before = state.players[0]!.pieces;
    state = apply(state, { t: "buildCity", player: 0, node: mine });
    expect(state.players[0]!.pieces.settlements).toBe(before.settlements + 1);
    expect(state.players[0]!.pieces.cities).toBe(before.cities - 1);
  });

  it("cannot upgrade an opponent's settlement", () => {
    const state = giveResources(readyToBuild(), 0, { ore: 3, grain: 2 });
    const theirs = Object.entries(state.buildings).find(([, b]) => b.player !== 0)![0];
    expect(reduce(state, { t: "buildCity", player: 0, node: theirs }).ok).toBe(false);
  });

  it("cannot upgrade a city again", () => {
    let state = giveResources(readyToBuild(), 0, { ore: 6, grain: 4 });
    const mine = Object.entries(state.buildings).find(
      ([, b]) => b.player === 0 && b.kind === "settlement",
    )![0];
    state = apply(state, { t: "buildCity", player: 0, node: mine });
    expect(reduce(state, { t: "buildCity", player: 0, node: mine }).ok).toBe(false);
  });
});

describe("costs table matches the rulebook (p.4-5)", () => {
  it("has the published costs", () => {
    expect(COSTS.road).toEqual({ brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 });
    expect(COSTS.settlement).toEqual({
      brick: 1,
      lumber: 1,
      wool: 1,
      grain: 1,
      ore: 0,
    });
    expect(COSTS.city).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 });
    expect(COSTS.devCard).toEqual({
      brick: 0,
      lumber: 0,
      wool: 1,
      grain: 1,
      ore: 1,
    });
  });
});

describe("turn flow (p.4)", () => {
  it("passes the turn to the next seat", () => {
    const state = readyToBuild(3);
    const next = apply(state, { t: "endTurn", player: 0 });
    expect(next.currentPlayer).toBe(1);
    expect(next.phase.k).toBe("roll");
    expect(next.turn).toBe(state.turn + 1);
  });

  it("wraps around the table", () => {
    let state = readyToBuild(3);
    for (let i = 0; i < 3; i++) {
      state = apply(state, { t: "endTurn", player: state.currentPlayer });
      state = { ...state, phase: { k: "main" } };
    }
    expect(state.currentPlayer).toBe(0);
  });

  it("refuses an end turn from the wrong player", () => {
    const state = readyToBuild(3);
    expect(reduce(state, { t: "endTurn", player: 1 }).ok).toBe(false);
  });

  it("clears the dice when the turn passes", () => {
    const state = { ...readyToBuild(3), dice: [3, 4] as [number, number] };
    expect(apply(state, { t: "endTurn", player: 0 }).dice).toBeNull();
  });
});
