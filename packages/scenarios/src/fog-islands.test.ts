import { describe, it, expect } from "vitest";
import { checkInvariants, createGame, playerView, reduce } from "@hexport/engine";
import type { GameState, NodeId } from "@hexport/engine";
import { loadScenario } from "./index.js";

/**
 * The Fog Islands, against the rulebook and against itself.
 *
 * Citations are to CN3083 Seafarers 2025, p.8 (3-player tables, the discovery
 * rule, 12 VP) and p.9 (4-player tables, variable setup). ADR 0009 records the
 * decisions the scenario forced.
 *
 * The fuzzer can only say a game finished without stalling. It cannot say the
 * board was ever turned face up — and a scenario where nothing is ever revealed
 * would fuzz perfectly cleanly while being the wrong game entirely. That is the
 * mistake ADR 0008 recorded once already (every measurement correct, the state
 * simply not containing the thing being measured), so this file checks the
 * thing itself.
 */

const FOG_BOARDS = ["fog-islands-3", "fog-islands-4"] as const;

describe.each(FOG_BOARDS)("%s composition", (id) => {
  const scenario = loadScenario(id);

  it("wins at twelve, not ten or fourteen", () => {
    // p.8: "If you have 12 or more VPs at any point during your turn..."
    expect(scenario.victoryPoints).toBe(12);
  });

  it("loads the fog rules on top of Seafarers", () => {
    expect(scenario.modules).toEqual(["base", "seafarers", "fogIslands"]);
  });

  it("leaves exactly twelve spaces empty", () => {
    const fog = scenario.cells.filter((cell) => cell.slot === "fog");
    expect(fog).toHaveLength(12);
    // Pinned, not drawn: a bag must never fill an empty space.
    for (const cell of fog) expect(cell.terrain).toBe("fog");
  });

  it("stacks twelve hexes and ten discs face down", () => {
    // p.8/p.9 component tables: the face-down pile is 2 sea, 2 gold, 2 hills,
    // 1 forest, 1 pasture, 2 fields, 2 mountains. Ten of those twelve are land,
    // and only land takes a disc — which is exactly the pile's size.
    expect(scenario.hiddenStacks).toHaveLength(1);
    const stack = scenario.hiddenStacks[0];
    expect(stack?.cells).toHaveLength(12);
    expect(stack?.contents).toHaveLength(12);
    expect(stack?.numbers).toHaveLength(10);

    const tally: Record<string, number> = {};
    for (const terrain of stack?.contents ?? []) {
      tally[terrain] = (tally[terrain] ?? 0) + 1;
    }
    expect(tally).toEqual({
      sea: 2,
      gold: 2,
      hill: 2,
      forest: 1,
      pasture: 1,
      field: 2,
      mountain: 2,
    });

    const land = (stack?.contents ?? []).filter((t) => t !== "sea").length;
    expect(stack?.numbers).toHaveLength(land);
  });

  it("allows adjacent red discs, which every other board forbids", () => {
    // p.9: "Red number discs (6s and 8s) are allowed to end up next to each
    // other in this case." The constraint is opt-in, so absence is the rule.
    expect(scenario.numbers.constraints?.noAdjacentRedNumbers).toBeUndefined();
  });

  it("pays no island victory points", () => {
    // p.8's additional rules are about discovery alone. This is also what keeps
    // the scenario clear of the per-player home-island problem that stopped The
    // Four Islands (ADR 0008): there is no island award to get wrong.
    for (const island of scenario.islands) {
      expect(island.vpForFirstSettlement).toBe(0);
    }
  });

  it("does not confine the opening settlements to one island", () => {
    // p.8: "may be placed on one island or two different islands".
    expect(scenario.setup.setupIslands).toBeUndefined();
    // They must still be on land, which is what `placeOn` is for.
    expect(scenario.setup.placeOn).toEqual(["land"]);
  });

  it("numbers every face-up land hex and nothing else", () => {
    const faceUpLand = scenario.cells.filter((cell) => cell.slot === "land").length;
    expect(scenario.numbers.mode).toBe("bag");
    if (scenario.numbers.mode !== "bag") return;
    const discs = scenario.numbers.tokens.reduce((sum, t) => sum + t.count, 0);
    expect(discs).toBe(faceUpLand);
    expect(scenario.numbers.skipTerrains).toContain("fog");
  });
});

/** A node touching both land (so it may be settled) and an unrevealed space. */
function nodeBesideFog(state: GameState): NodeId {
  for (const node of Object.values(state.board.nodes)) {
    const terrains = node.tiles.map((id) => state.board.tiles[id]?.terrain);
    if (terrains.includes("fog") && terrains.some((t) => t !== "fog" && t !== "sea")) {
      return node.id;
    }
  }
  throw new Error("no intersection touches both land and an empty space");
}

function fogCount(state: GameState): number {
  return Object.values(state.board.tiles).filter((t) => t.terrain === "fog").length;
}

describe("discovering a hex (p.8)", () => {
  /** Settle beside an empty space, then run a road out of it. */
  function playToFirstReveal(seed: string) {
    const scenario = loadScenario("fog-islands-4");
    const start = createGame({
      scenario,
      seed,
      playerNames: ["A", "B", "C", "D"],
    });

    const node = nodeBesideFog(start);
    const settled = reduce(start, { t: "setupSettlement", player: 0, node });
    if (!settled.ok) throw new Error(`settlement refused: ${settled.reason}`);

    // A road, not a ship: p.8 counts either, and only roads exist at setup.
    // An edge beside an unrevealed hex is coastal, so a road is legal there.
    const edge = (settled.state.board.nodes[node]?.edges ?? []).find(
      (id) => settled.state.board.edges[id]?.kind !== "sea",
    );
    if (edge === undefined) throw new Error("no road edge at that intersection");

    const built = reduce(settled.state, { t: "setupRoad", player: 0, edge });
    if (!built.ok) throw new Error(`road refused: ${built.reason}`);
    return { before: settled.state, after: built.state, events: built.events };
  }

  it("turns the hex face up when a road lands beside it", () => {
    const { before, after, events } = playToFirstReveal("reveal");

    const revealed = events.filter((e) => e.e === "hexRevealed");
    expect(revealed.length).toBeGreaterThan(0);
    // Every adjacent space, not one: ADR 0009 records why.
    expect(fogCount(after)).toBe(fogCount(before) - revealed.length);

    for (const event of revealed) {
      if (event.e !== "hexRevealed") continue;
      expect(after.board.tiles[event.tile]?.terrain).toBe(event.terrain);
      expect(event.terrain).not.toBe("fog");
    }
  });

  it("gives a land hex a disc and its finder a card, and a sea hex neither", () => {
    const { after, events } = playToFirstReveal("reveal");

    for (const event of events) {
      if (event.e !== "hexRevealed") continue;
      const tile = after.board.tiles[event.tile];

      if (event.terrain === "sea") {
        // p.8: "do not place a number disc and do not take a resource."
        expect(event.number).toBeNull();
        expect(tile?.number).toBeNull();
        expect(event.resource).toBeNull();
      } else {
        expect(event.number).not.toBeNull();
        expect(tile?.number).toBe(event.number);
        // Gold pays nothing today — a documented limitation, not an accident.
        if (event.terrain === "gold" || event.terrain === "desert") {
          expect(event.resource).toBeNull();
        }
      }
    }
  });

  it("draws what it revealed off the face-down piles", () => {
    const { before, after, events } = playToFirstReveal("reveal");
    const revealed = events.filter((e) => e.e === "hexRevealed");
    const land = revealed.filter((e) => e.e === "hexRevealed" && e.terrain !== "sea");

    const from = before.hiddenStacks["fog"];
    const to = after.hiddenStacks["fog"];
    expect(to?.contents.length).toBe((from?.contents.length ?? 0) - revealed.length);
    expect(to?.numbers.length).toBe((from?.numbers.length ?? 0) - land.length);
  });

  it("leaves the board consistent with itself", () => {
    // The invariant that matters here is edge classification: a reveal rewrites
    // a tile *and* the six edges it touches, and forgetting the second half
    // would let a piece stand somewhere the rules forbid (ADR 0009).
    const { after } = playToFirstReveal("reveal");
    expect(checkInvariants(after)).toEqual([]);
  });

  it("never shows a player what is still face down", () => {
    const { after } = playToFirstReveal("reveal");
    const view = playerView(after, 0);

    const stack = view.hiddenStacks["fog"];
    expect(stack).toBeDefined();
    expect(typeof stack?.hexes).toBe("number");
    expect(typeof stack?.numbers).toBe("number");
    // Counts only. The piles themselves would say what every unexplored space
    // holds before anyone sails to it.
    expect(JSON.stringify(view)).not.toContain('"contents"');
  });
});
