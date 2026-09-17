import { describe, it, expect } from "vitest";
import { buildBoardGraph, createGame, seedRng } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * The 5–6 player island.
 *
 * Components, 5–6 rules 2022 p.2 and the board on p.5: eleven hexes beyond the
 * base game's nineteen (one desert and two of each terrain), 28 number discs,
 * and two harbours beyond the base nine — a 2:1 wool and a 3:1 (p.3).
 *
 * The lettered order of the discs is not printed in either rulebook we hold, so
 * the scenario declares the multiset and the game shuffles it (ADR 0006). What
 * can be checked against the book is checked here.
 */

const scenario = loadScenario("classic-5-6");

function boardFor(seed: string) {
  return buildBoardGraph(scenario, seedRng(seed)).board;
}

describe("the scenario", () => {
  it("seats five or six players and loads the extension's rules", () => {
    expect(scenario.players).toEqual({ min: 5, max: 6 });
    expect(scenario.modules).toContain("ext56");
  });

  it("is 30 hexes in rows of 3-4-5-6-5-4-3", () => {
    const rows = new Map<number, number>();
    for (const cell of scenario.cells) {
      const r = cell.coord[1];
      rows.set(r, (rows.get(r) ?? 0) + 1);
    }
    const shape = [...rows.entries()].sort(([a], [b]) => a - b).map(([, n]) => n);
    expect(shape).toEqual([3, 4, 5, 6, 5, 4, 3]);
    expect(scenario.cells).toHaveLength(30);
  });

  it("holds the terrain the box does", () => {
    const bag = scenario.bags["land"];
    const counts = Object.fromEntries(
      (bag?.terrain ?? []).map((entry) => [entry.terrain, entry.count]),
    );
    expect(counts).toEqual({
      forest: 6,
      pasture: 6,
      field: 6,
      hill: 5,
      mountain: 5,
      desert: 2,
    });
  });

  it("holds 28 number discs: two 2s, two 12s, three of everything else", () => {
    expect(scenario.numbers.mode).toBe("bag");
    if (scenario.numbers.mode !== "bag") return;

    const counts = Object.fromEntries(
      scenario.numbers.tokens.map((token) => [token.value, token.count]),
    );
    expect(counts).toEqual({
      2: 2,
      3: 3,
      4: 3,
      5: 3,
      6: 3,
      8: 3,
      9: 3,
      10: 3,
      11: 3,
      12: 2,
    });
    const total = scenario.numbers.tokens.reduce((sum, t) => sum + t.count, 0);
    expect(total).toBe(28);
  });

  it("has eleven harbours: five generic and six at two to one, wool twice", () => {
    expect(scenario.ports).toHaveLength(11);
    const generic = scenario.ports.filter((p) => p.kind === "generic");
    expect(generic).toHaveLength(5);
    expect(generic.every((p) => p.ratio === 3)).toBe(true);

    const resources = scenario.ports
      .filter((p) => p.kind === "resource")
      .map((p) => p.resource);
    expect(resources.every((r) => r !== undefined)).toBe(true);
    expect([...resources].sort()).toEqual([
      "brick",
      "grain",
      "lumber",
      "ore",
      "wool",
      "wool",
    ]);
  });
});

describe("the built board", () => {
  const board = boardFor("five-six");

  it("builds 30 hexes, 80 intersections and 109 paths", () => {
    expect(Object.keys(board.tiles)).toHaveLength(30);
    expect(Object.keys(board.nodes)).toHaveLength(80);
    expect(Object.keys(board.edges)).toHaveLength(109);
    expect(Object.keys(board.ports)).toHaveLength(11);
  });

  it("lays 28 tokens and leaves both deserts bare", () => {
    const tiles = Object.values(board.tiles);
    expect(tiles.filter((t) => t.number !== null)).toHaveLength(28);
    expect(tiles.filter((t) => t.terrain === "desert")).toHaveLength(2);
    expect(tiles.every((t) => (t.terrain === "desert") === (t.number === null))).toBe(
      true,
    );
  });

  it("keeps the red numbers apart (p.10)", () => {
    // Two hexes are neighbours exactly when they share a path.
    for (const edge of Object.values(board.edges)) {
      const numbers = edge.tiles
        .map((id) => board.tiles[id]?.number)
        .filter((n): n is number => n === 6 || n === 8);
      expect(numbers.length).toBeLessThan(2);
    }
  });

  it("is the same board for the same seed, and a different one otherwise", () => {
    const again = boardFor("five-six");
    const other = boardFor("another");
    const terrains = (b: typeof board): string =>
      Object.keys(b.tiles)
        .sort()
        .map(
          (id) => `${b.tiles[id]?.terrain ?? ""}${String(b.tiles[id]?.number ?? "")}`,
        )
        .join("|");

    expect(terrains(again)).toBe(terrains(board));
    expect(terrains(other)).not.toBe(terrains(board));
  });
});

describe("a six player game", () => {
  const game = createGame({
    scenario,
    seed: "six",
    playerNames: ["A", "B", "C", "D", "E", "F"],
  });

  it("deals the extension's bigger supply", () => {
    // 19 + 5 of each resource, and 25 + 9 development cards.
    expect(game.bank.brick).toBe(24);
    expect(game.devDeck).toHaveLength(34);
  });

  it("gives every player the same pieces as the base game", () => {
    // The extension adds cards, not pieces (2022 p.2), and no ships: those are
    // Seafarers'. The stock now carries a ships figure for every scenario, so
    // the assertion names it rather than leaving it to chance.
    for (const seat of game.players) {
      expect(seat.pieces).toEqual({
        roads: 15,
        settlements: 5,
        cities: 4,
        ships: 0,
      });
    }
  });

  it("refuses to seat four", () => {
    expect(() =>
      createGame({ scenario, seed: "four", playerNames: ["A", "B", "C", "D"] }),
    ).toThrow();
  });
});
