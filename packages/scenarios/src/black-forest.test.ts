import { describe, it, expect } from "vitest";
import {
  buildBoardGraph,
  createGame,
  legalMoves,
  reduce,
  seedRng,
} from "@hexport/engine";
import type { GameState } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * The Black Forest, against its design.
 *
 * Source: docs/design/rush-and-black-forest.md. That document is a
 * reconstruction rather than a transcription — Colonist ships this as a custom
 * map with no rules page — so ADR 0010 records which parts are cited and which
 * are inferred. What this file pins is the shape of the design, so a slip in
 * the generator cannot quietly ship a board that plays like something else.
 *
 * The design in one line: everyone drowns in lumber, the scarce resources are
 * all hidden in the fog, and the only way out is to spend wood on roads.
 */

const scenario = loadScenario("black-forest");

describe("the known board", () => {
  it("is a base-game map, not a Seafarers one", () => {
    // Fog is a mechanic, not a Seafarers scenario. This board has no ships.
    expect(scenario.modules).toEqual(["base", "fog"]);
    expect(scenario.pieces.ships).toBe(0);
    expect(scenario.victoryPoints).toBe(10);
  });

  it("is forest and almost nothing else", () => {
    // The inversion the whole map rests on: every opening intersection pays
    // lumber, so no balanced starting spot exists and lumber is near worthless.
    const bag = scenario.bags["forest"];
    expect(bag?.terrain).toEqual([{ terrain: "forest", count: 30 }]);

    const pinned = scenario.cells.filter((cell) => cell.terrain !== undefined);
    const desert = pinned.filter((cell) => cell.terrain === "desert");
    expect(desert).toHaveLength(1);
  });

  it("puts the desert in the middle, inside a lake", () => {
    const heart = scenario.cells.find((cell) => cell.terrain === "desert");
    expect(heart?.coord).toEqual([0, 0]);

    // Six sea hexes ring it. The robber starts on the desert, so the centre is
    // both the harbour hub and the place the robber sits idle.
    const sea = scenario.cells.filter((cell) => cell.slot === "sea");
    expect(sea).toHaveLength(6);
  });

  it("faces every harbour inward onto the lake", () => {
    // Six 2:1 lumber harbours and nothing else. On a board where everyone has
    // wood, a harbour that takes it is the only dependable way to turn a
    // surplus into something else — and they all sit in the middle, so the
    // centre is worth fighting for.
    expect(scenario.ports).toHaveLength(6);
    for (const port of scenario.ports) {
      expect(port.kind).toBe("resource");
      expect(port.resource).toBe("lumber");
      expect(port.ratio).toBe(2);
    }
  });

  it("numbers every forest hex and leaves the desert bare", () => {
    expect(scenario.numbers.mode).toBe("bag");
    if (scenario.numbers.mode !== "bag") return;

    const discs = scenario.numbers.tokens.reduce((sum, t) => sum + t.count, 0);
    expect(discs).toBe(30);
    expect(scenario.numbers.skipTerrains).toContain("desert");
    expect(scenario.numbers.skipTerrains).toContain("fog");
  });

  it("leaves the numbers unbalanced on purpose", () => {
    // The source's §2.3 decision: the fog region's numbers are not laid out the
    // way a standard board's are, and leaving them alone is what makes the
    // unexplored ground worth gambling on instead of settling safely at home.
    expect(scenario.numbers.constraints?.noAdjacentRedNumbers).toBeUndefined();
  });
});

describe("the fog", () => {
  it("rings the board with twenty-four empty spaces", () => {
    const fog = scenario.cells.filter((cell) => cell.slot === "fog");
    expect(fog).toHaveLength(24);
    for (const cell of fog) expect(cell.terrain).toBe("fog");
  });

  it("hides every resource the known board lacks, and no forest at all", () => {
    // Inferred, and the one piece of composition that is purely ours: the
    // source gives weights for the known board and says nothing about the
    // stack. Forest is deliberately absent — exploration is the only route to
    // brick, wool, grain and ore, which is the point of the map.
    const stack = scenario.hiddenStacks[0];
    expect(stack).toBeDefined();

    const tally: Record<string, number> = {};
    for (const terrain of stack?.contents ?? []) {
      tally[terrain] = (tally[terrain] ?? 0) + 1;
    }
    expect(tally).toEqual({ sea: 4, hill: 5, pasture: 5, field: 5, mountain: 5 });
    expect(tally["forest"]).toBeUndefined();
  });

  it("carries a disc for every land hex in the stack and none for the sea", () => {
    const stack = scenario.hiddenStacks[0];
    const land = (stack?.contents ?? []).filter((t) => t !== "sea").length;
    expect(stack?.numbers).toHaveLength(land);
    expect(stack?.cells).toHaveLength(24);
  });
});

describe("playing it", () => {
  function opening(seed: string): GameState {
    return createGame({
      scenario,
      seed,
      playerNames: ["A", "B", "C", "D"],
    });
  }

  it("starts the robber on the desert in the middle", () => {
    const state = opening("bf-robber");
    expect(state.board.tiles[state.robber]?.terrain).toBe("desert");
  });

  it("offers no opening settlement that is not on land", () => {
    const state = opening("bf-setup");
    for (const move of legalMoves(state, state.currentPlayer)) {
      if (move.t !== "setupSettlement") continue;
      const touches = state.board.nodes[move.node]?.tiles ?? [];
      expect(
        touches.some((t) => state.board.tiles[t]?.slot === "land"),
        `settlement offered at ${move.node}, which touches no land`,
      ).toBe(true);
    }
  });

  it("turns fog over when a road reaches it", () => {
    // The map's engine, driven through the rules: build toward the fog and it
    // gives way. Without this the board is just a forest with a grey border.
    let state = opening("bf-reveal");
    let revealed = 0;

    for (let step = 0; step < 600 && revealed === 0; step++) {
      const moves = legalMoves(state, state.currentPlayer);
      if (moves.length === 0) break;
      const move = moves[step % moves.length];
      if (move === undefined) break;
      const out = reduce(state, move);
      if (!out.ok) continue;
      revealed += out.events.filter((e) => e.e === "hexRevealed").length;
      state = out.state;
      if (state.winner !== null) break;
    }

    expect(revealed).toBeGreaterThan(0);
  });

  it("deals the same board twice from one seed", () => {
    const a = buildBoardGraph(scenario, seedRng("bf-repeat")).board;
    const b = buildBoardGraph(scenario, seedRng("bf-repeat")).board;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
