import { describe, it, expect } from "vitest";
import {
  UnknownModuleError,
  baseModule,
  ext56Module,
  resolveModules,
  supplyFor,
  turnHandoff,
} from "./index.js";
import { completeSetup, fixedScenario, intoMainPhase, newGame } from "../reducers/testHelpers.js";

/**
 * The rule module registry (CLAUDE.md golden rule 7).
 *
 * The point of the interface is that an expansion changes what the box holds
 * and what happens between turns without a single `if` about which expansion is
 * loaded. These check both halves.
 */

describe("resolving modules", () => {
  it("resolves the ids a scenario names", () => {
    expect(resolveModules(["base"])).toEqual([baseModule]);
    expect(resolveModules(["base", "ext56"])).toEqual([baseModule, ext56Module]);
  });

  it("refuses an unknown id rather than ignoring it", () => {
    expect(() => resolveModules(["seafarers"])).toThrow(UnknownModuleError);
  });
});

describe("the supply", () => {
  it("is the base box by default: 19 of each resource, 25 development cards", () => {
    const supply = supplyFor(resolveModules(["base"]));
    expect(supply.bankPerResource).toBe(19);
    expect(Object.values(supply.devDeck).reduce((a, b) => a + b, 0)).toBe(25);
    expect(supply.devDeck.knight).toBe(14);
  });

  it("grows with the 5–6 extension: 24 each, 34 development cards", () => {
    // 5–6 rules 2022 p.4 (25 more resource cards, 9 more development cards);
    // the composition of those nine is listed in the 2025 edition, p.1.
    const supply = supplyFor(resolveModules(["base", "ext56"]));
    expect(supply.bankPerResource).toBe(24);
    expect(Object.values(supply.devDeck).reduce((a, b) => a + b, 0)).toBe(34);
    expect(supply.devDeck.knight).toBe(20);
    expect(supply.devDeck.roadBuilding).toBe(3);
    expect(supply.devDeck.yearOfPlenty).toBe(3);
    expect(supply.devDeck.monopoly).toBe(3);
    expect(supply.devDeck.victoryPoint).toBe(5);
  });

  it("reaches the game that loads it", () => {
    const scenario = {
      ...fixedScenario(),
      players: { min: 2, max: 6 },
      modules: ["base", "ext56"],
    };
    const game = newGame(5, scenario);
    expect(game.bank.brick).toBe(24);
    expect(game.devDeck).toHaveLength(34);
  });
});

describe("the turn handoff", () => {
  it("is nothing in a base game", () => {
    const state = intoMainPhase(completeSetup(newGame(3)), 0);
    expect(turnHandoff(resolveModules(["base"]), state, 1)).toBeNull();
  });

  it("is the building window with the 5–6 extension", () => {
    const state = intoMainPhase(completeSetup(newGame(3)), 0);
    const handoff = turnHandoff(resolveModules(["base", "ext56"]), state, 1);
    expect(handoff?.phase.k).toBe("specialBuild");
  });
});
