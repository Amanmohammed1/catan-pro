import { describe, it, expect } from "vitest";
import { loadScenario, safeParseScenario, SCENARIO_IDS } from "./index.js";

/**
 * The schema is the boundary. The engine trusts whatever it is handed, so every
 * malformed scenario has to be caught here, with a message that names the
 * problem rather than surfacing later as a board that builds but plays wrong.
 */

const valid = {
  id: "unit",
  name: "Unit",
  schemaVersion: 1,
  players: { min: 3, max: 4 },
  victoryPoints: 10,
  modules: ["base"],
  layout: { orientation: "pointy" },
  cells: [
    { coord: [0, 0], slot: "land", terrain: "forest", island: "home" },
    { coord: [1, 0], slot: "land", terrain: "hill", island: "home" },
  ],
  bags: {},
  numbers: {
    mode: "path",
    sequence: [5, 9],
    path: [
      [0, 0],
      [1, 0],
    ],
    skipTerrains: ["desert", "sea"],
  },
  ports: [],
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [{ id: "home", vpForFirstSettlement: 0 }],
  hiddenStacks: [],
  startingPieces: [],
};

/** Deep clone so each case can mutate freely. Plain JSON data, so this is exact. */
function withScenario(mutate: (s: typeof valid) => void): unknown {
  const copy = JSON.parse(JSON.stringify(valid)) as typeof valid;
  mutate(copy);
  return copy;
}

function errorsFor(input: unknown): string[] {
  const result = safeParseScenario(input);
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

describe("the shipped scenarios", () => {
  it.each(SCENARIO_IDS)("%s parses", (id) => {
    expect(() => loadScenario(id)).not.toThrow();
  });

  it("caches repeated loads", () => {
    expect(loadScenario("classic-3-4")).toBe(loadScenario("classic-3-4"));
  });

  it("rejects an unknown id", () => {
    expect(() => loadScenario("no-such-board")).toThrow(/Unknown scenario/);
  });

  it("gives the classic board 19 cells, a 19 step path and 9 ports", () => {
    const classic = loadScenario("classic-3-4");
    expect(classic.cells).toHaveLength(19);
    expect(classic.numbers.path).toHaveLength(19);
    expect(classic.ports).toHaveLength(9);
    expect(classic.numbers.mode).toBe("path");
    if (classic.numbers.mode !== "path") return;
    expect(classic.numbers.sequence).toHaveLength(18);
  });
});

describe("the baseline fixture", () => {
  it("is valid", () => {
    expect(safeParseScenario(valid).success).toBe(true);
  });
});

describe("structural rejections", () => {
  it("rejects a duplicate cell", () => {
    const input = withScenario((s) => {
      s.cells.push({
        coord: [0, 0],
        slot: "land",
        terrain: "field",
        island: "home",
      });
      s.numbers.sequence = [5, 9, 4];
    });
    expect(errorsFor(input).join(" ")).toMatch(/Duplicate cell at 0,0/);
  });

  it("rejects a board with no cells", () => {
    const input = withScenario((s) => {
      s.cells = [];
    });
    expect(safeParseScenario(input).success).toBe(false);
  });

  it("rejects players.max below players.min", () => {
    const input = withScenario((s) => {
      s.players = { min: 4, max: 3 };
    });
    expect(errorsFor(input).join(" ")).toMatch(/below players.min/);
  });

  it("rejects an unknown schema version", () => {
    const input = withScenario((s) => {
      (s as { schemaVersion: number }).schemaVersion = 2;
    });
    expect(safeParseScenario(input).success).toBe(false);
  });

  it("rejects a non-integer coordinate", () => {
    const input = withScenario((s) => {
      (s.cells[0] as { coord: number[] }).coord = [0.5, 0];
    });
    expect(safeParseScenario(input).success).toBe(false);
  });
});

describe("bag rejections", () => {
  it("rejects a cell drawing from an undefined bag", () => {
    const input = withScenario((s) => {
      delete (s.cells[0] as { terrain?: string }).terrain;
    });
    expect(errorsFor(input).join(" ")).toMatch(/which is not defined/);
  });

  it("rejects a bag whose size does not match its cells", () => {
    const input = withScenario((s) => {
      delete (s.cells[0] as { terrain?: string }).terrain;
      (s.bags as Record<string, unknown>)["land"] = {
        terrain: [{ terrain: "forest", count: 3 }],
      };
    });
    expect(errorsFor(input).join(" ")).toMatch(
      /holds 3 tiles but 1 cell\(s\) draw from it/,
    );
  });
});

describe("number path rejections", () => {
  it("rejects a path step that is not a cell", () => {
    const input = withScenario((s) => {
      s.numbers.path = [
        [0, 0],
        [9, 9],
      ];
    });
    expect(errorsFor(input).join(" ")).toMatch(/visits 9,9, which is not a cell/);
  });

  it("rejects a path that visits a cell twice", () => {
    const input = withScenario((s) => {
      s.numbers.path = [
        [0, 0],
        [0, 0],
      ];
      s.numbers.sequence = [5];
    });
    expect(errorsFor(input).join(" ")).toMatch(/more than once/);
  });

  it("rejects a sequence that is too short", () => {
    const input = withScenario((s) => {
      s.numbers.sequence = [5];
    });
    expect(errorsFor(input).join(" ")).toMatch(/1 tokens but the board needs 2/);
  });

  it("rejects a sequence that is too long", () => {
    const input = withScenario((s) => {
      s.numbers.sequence = [5, 9, 4];
    });
    expect(errorsFor(input).join(" ")).toMatch(/3 tokens but the board needs 2/);
  });

  it("accounts for a desert in the bag when sizing the sequence", () => {
    const input = withScenario((s) => {
      delete (s.cells[0] as { terrain?: string }).terrain;
      delete (s.cells[1] as { terrain?: string }).terrain;
      (s.bags as Record<string, unknown>)["land"] = {
        terrain: [
          { terrain: "forest", count: 1 },
          { terrain: "desert", count: 1 },
        ],
      };
      s.numbers.sequence = [5];
    });
    expect(safeParseScenario(input).success).toBe(true);
  });

  it("rejects a number outside the dice range", () => {
    const input = withScenario((s) => {
      s.numbers.sequence = [5, 13];
    });
    expect(safeParseScenario(input).success).toBe(false);
  });
});

describe("port rejections", () => {
  it("rejects a port anchored off the board", () => {
    const input = withScenario((s) => {
      (s.ports as unknown[]).push({
        at: [9, 9],
        edgeDir: 0,
        kind: "generic",
        ratio: 3,
      });
    });
    expect(errorsFor(input).join(" ")).toMatch(/anchored to 9,9/);
  });

  it("rejects two ports on the same anchor", () => {
    const input = withScenario((s) => {
      (s.ports as unknown[]).push(
        { at: [0, 0], edgeDir: 0, kind: "generic", ratio: 3 },
        { at: [0, 0], edgeDir: 0, kind: "generic", ratio: 3 },
      );
    });
    expect(errorsFor(input).join(" ")).toMatch(/share the anchor/);
  });

  it("rejects a resource port with no resource", () => {
    const input = withScenario((s) => {
      (s.ports as unknown[]).push({
        at: [0, 0],
        edgeDir: 0,
        kind: "resource",
        ratio: 2,
      });
    });
    expect(errorsFor(input).join(" ")).toMatch(/must name its resource/);
  });

  it("rejects a generic port that names a resource", () => {
    const input = withScenario((s) => {
      (s.ports as unknown[]).push({
        at: [0, 0],
        edgeDir: 0,
        kind: "generic",
        resource: "ore",
        ratio: 3,
      });
    });
    expect(errorsFor(input).join(" ")).toMatch(/must not name a resource/);
  });

  it("rejects an out-of-range edge direction", () => {
    const input = withScenario((s) => {
      (s.ports as unknown[]).push({
        at: [0, 0],
        edgeDir: 6,
        kind: "generic",
        ratio: 3,
      });
    });
    expect(safeParseScenario(input).success).toBe(false);
  });
});

describe("island rejections", () => {
  it("rejects a cell referencing an undeclared island", () => {
    const input = withScenario((s) => {
      (s.cells[0] as { island: string }).island = "atlantis";
    });
    expect(errorsFor(input).join(" ")).toMatch(/island "atlantis"/);
  });
});
