import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { canPlayDevCard, legalMoves } from "../queries/legalMoves.js";
import { resolveLargestArmy, victoryPoints } from "../queries/scores.js";
import {
  apply,
  clearAllResources,
  completeSetup,
  giveResources,
  newGame,
} from "./testHelpers.js";
import {
  DEV_DECK_COMPOSITION,
  type DevCardKind,
  type GameState,
  type PlayerId,
} from "../state/types.js";

/** Development cards. Rules p.5, p.7, p.8, p.10. */

function ready(playerCount = 3): GameState {
  const state = clearAllResources(completeSetup(newGame(playerCount)));
  return { ...state, phase: { k: "main" }, currentPlayer: 0, turn: 5 };
}

/**
 * Move a specific card from the deck into a player's hand, as if bought on an
 * earlier turn. It has to come out of the deck, or the dev-card conservation
 * invariant correctly objects that cards were minted from nowhere.
 */
function giveCard(
  state: GameState,
  player: PlayerId,
  kind: DevCardKind,
  boughtOnTurn = 1,
): GameState {
  const index = state.devDeck.indexOf(kind);
  if (index < 0) throw new Error(`No ${kind} left in the deck.`);
  const devDeck = [...state.devDeck.slice(0, index), ...state.devDeck.slice(index + 1)];

  return {
    ...state,
    devDeck,
    players: state.players.map((s) =>
      s.id === player
        ? { ...s, devCards: [...s.devCards, { kind, boughtOnTurn, played: false }] }
        : s,
    ),
  };
}

/** Put a specific card on top of the deck without changing the deck's contents. */
function stackDeck(state: GameState, kind: DevCardKind): GameState {
  const index = state.devDeck.indexOf(kind);
  if (index < 0) throw new Error(`No ${kind} left in the deck.`);
  return {
    ...state,
    devDeck: [
      kind,
      ...state.devDeck.slice(0, index),
      ...state.devDeck.slice(index + 1),
    ],
  };
}

describe("the deck (p.2)", () => {
  it("holds 25 cards in the published mix", () => {
    const total = Object.values(DEV_DECK_COMPOSITION).reduce((a, b) => a + b, 0);
    expect(total).toBe(25);
    expect(DEV_DECK_COMPOSITION.knight).toBe(14);
    expect(DEV_DECK_COMPOSITION.victoryPoint).toBe(5);
    expect(DEV_DECK_COMPOSITION.roadBuilding).toBe(2);
    expect(DEV_DECK_COMPOSITION.yearOfPlenty).toBe(2);
    expect(DEV_DECK_COMPOSITION.monopoly).toBe(2);
  });

  it("starts shuffled with all 25 present", () => {
    const state = newGame(3);
    expect(state.devDeck).toHaveLength(25);
    const counts: Record<string, number> = {};
    for (const card of state.devDeck) counts[card] = (counts[card] ?? 0) + 1;
    expect(counts).toEqual(DEV_DECK_COMPOSITION);
  });

  it("deals from the top and shrinks", () => {
    let state = giveResources(ready(), 0, { ore: 1, wool: 1, grain: 1 });
    const top = state.devDeck[0];
    const before = state.devDeck.length;
    state = apply(state, { t: "buyDevCard", player: 0 });
    expect(state.devDeck).toHaveLength(before - 1);
    expect(state.players[0]!.devCards.at(-1)?.kind).toBe(top);
  });

  it("cannot be bought when empty (p.5)", () => {
    const state = {
      ...giveResources(ready(), 0, { ore: 1, wool: 1, grain: 1 }),
      devDeck: [],
    };
    expect(reduce(state, { t: "buyDevCard", player: 0 }).ok).toBe(false);
    expect(legalMoves(state, 0).some((m) => m.t === "buyDevCard")).toBe(false);
  });

  it("cannot be bought without ore, wool and grain", () => {
    const state = giveResources(ready(), 0, { ore: 1, wool: 1 });
    expect(reduce(state, { t: "buyDevCard", player: 0 }).ok).toBe(false);
  });
});

describe("timing (p.5, p.7)", () => {
  it("refuses a card bought this turn", () => {
    let state = giveResources(ready(), 0, { ore: 1, wool: 1, grain: 1 });
    state = stackDeck(state, "knight");
    state = apply(state, { t: "buyDevCard", player: 0 });

    expect(canPlayDevCard(state, 0, "knight")).toBe(false);
    expect(reduce(state, { t: "playKnight", player: 0 }).ok).toBe(false);
  });

  it("allows the same card on a later turn", () => {
    const state = giveCard(ready(), 0, "knight", 1);
    expect(canPlayDevCard(state, 0, "knight")).toBe(true);
  });

  it("allows only one development card per turn (p.7)", () => {
    let state = giveCard(giveCard(ready(), 0, "monopoly"), 0, "yearOfPlenty");
    state = apply(state, { t: "playMonopoly", player: 0, resource: "ore" });
    expect(state.players[0]!.playedDevCardThisTurn).toBe(true);
    expect(canPlayDevCard(state, 0, "yearOfPlenty")).toBe(false);
    expect(
      reduce(state, {
        t: "playYearOfPlenty",
        player: 0,
        resources: ["ore", "wool"],
      }).ok,
    ).toBe(false);
  });

  it("resets the one-card limit at the start of the next turn", () => {
    let state = giveCard(ready(), 0, "monopoly");
    state = apply(state, { t: "playMonopoly", player: 0, resource: "ore" });
    state = apply(state, { t: "endTurn", player: 0 });
    expect(state.players[0]!.playedDevCardThisTurn).toBe(false);
  });

  it("allows a knight before the roll (p.7)", () => {
    const state: GameState = {
      ...giveCard(ready(), 0, "knight"),
      phase: { k: "roll" },
    };
    expect(legalMoves(state, 0).some((m) => m.t === "playKnight")).toBe(true);
    const after = apply(state, { t: "playKnight", player: 0 });
    expect(after.phase.k).toBe("moveRobber");
  });

  it("returns to the roll phase after a pre-roll knight", () => {
    let state: GameState = {
      ...giveCard(ready(), 0, "knight"),
      phase: { k: "roll" },
    };
    state = apply(state, { t: "playKnight", player: 0 });
    const target = Object.keys(state.board.tiles).find((t) => t !== state.robber)!;
    state = apply(state, { t: "moveRobber", player: 0, tile: target });
    if (state.phase.k !== "steal") throw new Error("expected steal");
    const victim = state.phase.targets[0] ?? null;
    state = apply(state, { t: "steal", player: 0, target: victim });
    expect(state.phase.k).toBe("roll");
  });

  it("does not let a player play a card they do not hold", () => {
    const state = ready();
    expect(reduce(state, { t: "playKnight", player: 0 }).ok).toBe(false);
    expect(reduce(state, { t: "playMonopoly", player: 0, resource: "ore" }).ok).toBe(
      false,
    );
  });

  it("never offers a victory point card as playable", () => {
    const state = giveCard(ready(), 0, "victoryPoint");
    expect(legalMoves(state, 0).some((m) => m.t.startsWith("play"))).toBe(false);
  });
});

describe("knights and Largest Army (p.8)", () => {
  it("moves the robber and counts towards the army", () => {
    let state = giveCard(ready(), 0, "knight");
    expect(state.players[0]!.knightsPlayed).toBe(0);
    state = apply(state, { t: "playKnight", player: 0 });
    expect(state.players[0]!.knightsPlayed).toBe(1);
    expect(state.phase.k).toBe("moveRobber");
  });

  it("awards Largest Army at the third knight", () => {
    let state = ready();
    for (let i = 0; i < 3; i++) {
      state = giveCard(state, 0, "knight");
      state = {
        ...state,
        players: state.players.map((s) =>
          s.id === 0 ? { ...s, playedDevCardThisTurn: false } : s,
        ),
      };
      state = apply(state, { t: "playKnight", player: 0 });
      const target = Object.keys(state.board.tiles).find((t) => t !== state.robber)!;
      state = apply(state, { t: "moveRobber", player: 0, tile: target });
      if (state.phase.k === "steal") {
        state = apply(state, {
          t: "steal",
          player: 0,
          target: state.phase.targets[0] ?? null,
        });
      }
    }
    expect(state.players[0]!.knightsPlayed).toBe(3);
    expect(state.largestArmy.player).toBe(0);
  });

  it("needs strictly more knights to take the card", () => {
    const held = { player: 0, length: 3 };
    expect(resolveLargestArmy([3, 3, 0], held, 3).player).toBe(0);
    expect(resolveLargestArmy([3, 4, 0], held, 3).player).toBe(1);
  });

  it("gives nobody the card below three knights", () => {
    expect(
      resolveLargestArmy([2, 2, 1], { player: null, length: 0 }, 3).player,
    ).toBeNull();
  });

  it("is worth two victory points", () => {
    const base = ready();
    const withArmy: GameState = { ...base, largestArmy: { player: 0, length: 3 } };
    expect(victoryPoints(withArmy, 0)).toBe(victoryPoints(base, 0) + 2);
  });
});

describe("Road Building (p.10)", () => {
  it("places two free roads", () => {
    let state = giveCard(ready(), 0, "roadBuilding");
    const before = state.players[0]!.pieces.roads;
    const handBefore = state.players[0]!.resources;

    state = apply(state, { t: "playRoadBuilding", player: 0 });
    expect(state.phase.k).toBe("roadBuilding");

    for (let i = 0; i < 2; i++) {
      const move = legalMoves(state, 0).find((m) => m.t === "buildRoad");
      if (move === undefined) break;
      state = apply(state, move);
    }

    expect(state.players[0]!.pieces.roads).toBe(before - 2);
    expect(state.players[0]!.resources).toEqual(handBefore);
    expect(state.phase.k).toBe("main");
  });

  it("follows normal placement rules", () => {
    let state = giveCard(ready(), 0, "roadBuilding");
    state = apply(state, { t: "playRoadBuilding", player: 0 });
    const occupied = Object.keys(state.roads)[0] as string;
    expect(reduce(state, { t: "buildRoad", player: 0, edge: occupied }).ok).toBe(false);
  });

  it("returns to the roll phase when played before the dice (p.7)", () => {
    // Regression: playing a card before rolling is legal, so Road Building must
    // hand the turn back to the roll phase. Returning to the main phase instead
    // would silently skip the player's dice roll, costing everyone production.
    let state: GameState = {
      ...giveCard(ready(), 0, "roadBuilding"),
      phase: { k: "roll" },
    };
    state = apply(state, { t: "playRoadBuilding", player: 0 });
    expect(state.phase.k).toBe("roadBuilding");

    for (let i = 0; i < 2; i++) {
      const move = legalMoves(state, 0).find((m) => m.t === "buildRoad");
      if (move === undefined) break;
      state = apply(state, move);
    }

    expect(state.phase.k).toBe("roll");
    expect(legalMoves(state, 0).some((m) => m.t === "rollDice")).toBe(true);
  });

  it("returns to the main phase when played after the roll", () => {
    let state = giveCard(ready(), 0, "roadBuilding");
    state = apply(state, { t: "playRoadBuilding", player: 0 });
    for (let i = 0; i < 2; i++) {
      const move = legalMoves(state, 0).find((m) => m.t === "buildRoad");
      if (move === undefined) break;
      state = apply(state, move);
    }
    expect(state.phase.k).toBe("main");
  });

  it("can be ended early, returning to the interrupted phase", () => {
    let state: GameState = {
      ...giveCard(ready(), 0, "roadBuilding"),
      phase: { k: "roll" },
    };
    state = apply(state, { t: "playRoadBuilding", player: 0 });
    state = apply(state, { t: "endRoadBuilding", player: 0 });
    expect(state.phase.k).toBe("roll");
  });

  it("offers an explicit end action when no road spot is left", () => {
    let state = giveCard(ready(), 0, "roadBuilding");
    state = apply(state, { t: "playRoadBuilding", player: 0 });
    state = {
      ...state,
      players: state.players.map((s) =>
        s.id === 0 ? { ...s, pieces: { ...s.pieces, roads: 0 } } : s,
      ),
    };
    const moves = legalMoves(state, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.t).toBe("endRoadBuilding");
  });

  it("ends early when there is nowhere left to build", () => {
    let state = giveCard(ready(), 0, "roadBuilding");
    state = {
      ...state,
      players: state.players.map((s) =>
        s.id === 0 ? { ...s, pieces: { ...s.pieces, roads: 0 } } : s,
      ),
    };
    // With no road pieces the card offers only the exit action.
    expect(legalMoves(state, 0).some((m) => m.t === "playRoadBuilding")).toBe(false);
  });
});

describe("Year of Plenty (p.10)", () => {
  it("takes any two resources from the bank", () => {
    let state = giveCard(ready(), 0, "yearOfPlenty");
    const bankOre = state.bank.ore;
    const bankWool = state.bank.wool;
    state = apply(state, {
      t: "playYearOfPlenty",
      player: 0,
      resources: ["ore", "wool"],
    });
    expect(state.players[0]!.resources.ore).toBe(1);
    expect(state.players[0]!.resources.wool).toBe(1);
    expect(state.bank.ore).toBe(bankOre - 1);
    expect(state.bank.wool).toBe(bankWool - 1);
  });

  it("may take two of the same resource", () => {
    let state = giveCard(ready(), 0, "yearOfPlenty");
    state = apply(state, {
      t: "playYearOfPlenty",
      player: 0,
      resources: ["grain", "grain"],
    });
    expect(state.players[0]!.resources.grain).toBe(2);
  });

  it("is refused when the bank cannot supply it", () => {
    const state = {
      ...giveCard(ready(), 0, "yearOfPlenty"),
      bank: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 },
    };
    expect(
      reduce(state, {
        t: "playYearOfPlenty",
        player: 0,
        resources: ["ore", "ore"],
      }).ok,
    ).toBe(false);
  });

  it("only offers pairs the bank can actually pay", () => {
    // One ore and nothing else: no pair is payable, so the card offers nothing.
    const state = {
      ...giveCard(ready(), 0, "yearOfPlenty"),
      bank: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 },
    };
    const offers = legalMoves(state, 0).filter((m) => m.t === "playYearOfPlenty");
    expect(offers).toHaveLength(0);
  });

  it("offers a mixed pair when the bank holds one of each", () => {
    const state = {
      ...giveCard(ready(), 0, "yearOfPlenty"),
      bank: { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 1 },
    };
    const offers = legalMoves(state, 0).filter((m) => m.t === "playYearOfPlenty");
    expect(offers).toHaveLength(1);
    // Pairs are emitted unordered, in a canonical (alphabetical) order.
    const pair =
      offers[0]?.t === "playYearOfPlenty" ? [...offers[0].resources].sort() : [];
    expect(pair).toEqual(["ore", "wool"]);
  });
});

describe("Monopoly (p.10)", () => {
  it("takes every card of one type from every opponent", () => {
    let state = giveCard(ready(3), 0, "monopoly");
    state = giveResources(state, 1, { wool: 3 });
    state = giveResources(state, 2, { wool: 2, ore: 4 });

    state = apply(state, { t: "playMonopoly", player: 0, resource: "wool" });

    expect(state.players[0]!.resources.wool).toBe(5);
    expect(state.players[1]!.resources.wool).toBe(0);
    expect(state.players[2]!.resources.wool).toBe(0);
    // Other resources untouched.
    expect(state.players[2]!.resources.ore).toBe(4);
  });

  it("takes nothing when nobody holds the resource", () => {
    let state = giveCard(ready(3), 0, "monopoly");
    state = apply(state, { t: "playMonopoly", player: 0, resource: "wool" });
    expect(state.players[0]!.resources.wool).toBe(0);
  });

  it("does not touch the player's own cards or the bank", () => {
    let state = giveCard(ready(3), 0, "monopoly");
    state = giveResources(state, 0, { wool: 2 });
    state = giveResources(state, 1, { wool: 1 });
    const bankBefore = state.bank.wool;
    state = apply(state, { t: "playMonopoly", player: 0, resource: "wool" });
    expect(state.players[0]!.resources.wool).toBe(3);
    expect(state.bank.wool).toBe(bankBefore);
  });
});

describe("victory point cards (p.7)", () => {
  it("count towards the true score but not the public one", () => {
    const state = giveCard(ready(), 0, "victoryPoint");
    expect(victoryPoints(state, 0)).toBeGreaterThan(0);
  });

  it("can win the game on the turn they are bought", () => {
    // p.7: "If you buy a card and it is a victory point card that brings you to
    // 10 points, you may immediately reveal this card and win the game."
    let state = giveResources(ready(), 0, { ore: 1, wool: 1, grain: 1 });
    state = stackDeck(state, "victoryPoint");
    state = { ...state, config: { ...state.config, victoryPoints: 3 } };
    // Player 0 holds two settlements from setup, so the card is the third point.
    state = apply(state, { t: "buyDevCard", player: 0 });
    expect(state.winner).toBe(0);
    expect(state.phase.k).toBe("gameOver");
  });
});
