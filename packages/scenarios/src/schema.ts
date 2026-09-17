/**
 * The only place raw scenario JSON is trusted.
 *
 * The engine is pure and has no dependencies, so it cannot validate anything;
 * it takes an already-typed Scenario and assumes it is well formed. That makes
 * this file the boundary. Everything the engine would otherwise have to defend
 * against is rejected here, with a message that names the offending cell.
 */

import { z } from "zod";
import type { Scenario } from "@hexport/engine";

const axial = z.tuple([z.number().int(), z.number().int()]);

const terrain = z.enum([
  "hill",
  "forest",
  "pasture",
  "field",
  "mountain",
  "desert",
  "gold",
  "sea",
]);

const slot = z.enum(["land", "sea"]);
const resource = z.enum(["brick", "lumber", "wool", "grain", "ore"]);

const hexDirection = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const cell = z.object({
  coord: axial,
  slot,
  terrain: terrain.optional(),
  number: z.number().int().min(2).max(12).optional(),
  bag: z.string().min(1).optional(),
  island: z.string().min(1).optional(),
});

const terrainBag = z.object({
  terrain: z
    .array(
      z.object({
        terrain,
        count: z.number().int().min(0),
      }),
    )
    .min(1),
});

const numberConstraints = z
  .object({ noAdjacentRedNumbers: z.boolean().optional() })
  .optional();

const numbers = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("path"),
    sequence: z.array(z.number().int().min(2).max(12)),
    path: z.array(axial),
    skipTerrains: z.array(terrain),
    constraints: numberConstraints,
  }),
  z.object({
    mode: z.literal("bag"),
    tokens: z
      .array(
        z.object({
          value: z.number().int().min(2).max(12),
          count: z.number().int().min(0),
        }),
      )
      .min(1),
    path: z.array(axial),
    skipTerrains: z.array(terrain),
    constraints: numberConstraints,
  }),
]);

const port = z.object({
  at: axial,
  edgeDir: hexDirection,
  kind: z.enum(["generic", "resource"]),
  resource: resource.optional(),
  ratio: z.number().int().min(2).max(4),
});

const island = z.object({
  id: z.string().min(1),
  vpForFirstSettlement: z.number().int().min(0),
});

const hiddenStack = z.object({
  id: z.string().min(1),
  cells: z.array(axial),
  contents: z.array(terrain),
});

const startingPiece = z.object({
  player: z.number().int().min(0),
  kind: z.enum(["settlement", "city", "road", "ship"]),
  at: axial,
  corner: hexDirection.optional(),
  edgeDir: hexDirection.optional(),
});

const baseScenario = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  schemaVersion: z.literal(1),
  players: z.object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }),
  victoryPoints: z.number().int().min(1),
  modules: z.array(z.string().min(1)),
  layout: z.object({ orientation: z.enum(["pointy", "flat"]) }),
  cells: z.array(cell).min(1),
  bags: z.record(z.string(), terrainBag),
  numbers,
  ports: z.array(port),
  pieces: z.object({
    roads: z.number().int().min(0),
    settlements: z.number().int().min(0),
    cities: z.number().int().min(0),
    ships: z.number().int().min(0),
  }),
  setup: z.object({
    mode: z.literal("snakeDraft"),
    rounds: z.number().int().min(1),
    placeOn: z.array(slot).min(1),
  }),
  islands: z.array(island),
  hiddenStacks: z.array(hiddenStack),
  startingPieces: z.array(startingPiece),
});

type RawScenario = z.infer<typeof baseScenario>;

const coordKey = (coord: readonly [number, number]): string =>
  `${String(coord[0])},${String(coord[1])}`;

function bagNameFor(c: RawScenario["cells"][number]): string {
  return c.bag ?? c.slot;
}

/**
 * Cross-field checks. These are the failures that would otherwise surface deep
 * inside buildBoardGraph, or worse, as a board that builds but is subtly wrong.
 */
export const scenarioSchema = baseScenario.superRefine((value, ctx) => {
  // ---- cells must be unique -----------------------------------------------
  const seen = new Set<string>();
  for (const [index, c] of value.cells.entries()) {
    const k = coordKey(c.coord);
    if (seen.has(k)) {
      ctx.addIssue({
        code: "custom",
        path: ["cells", index, "coord"],
        message: `Duplicate cell at ${k}.`,
      });
    }
    seen.add(k);
  }

  // ---- players ------------------------------------------------------------
  if (value.players.max < value.players.min) {
    ctx.addIssue({
      code: "custom",
      path: ["players", "max"],
      message: `players.max (${String(value.players.max)}) is below players.min (${String(value.players.min)}).`,
    });
  }

  // ---- every bag a cell draws from must exist, and must be the right size --
  const drawCounts = new Map<string, number>();
  for (const c of value.cells) {
    if (c.terrain !== undefined) continue;
    const name = bagNameFor(c);
    drawCounts.set(name, (drawCounts.get(name) ?? 0) + 1);
  }

  for (const [name, count] of drawCounts) {
    const bag = value.bags[name];
    if (bag === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["bags"],
        message: `${String(count)} cell(s) draw from bag "${name}", which is not defined.`,
      });
      continue;
    }
    const total = bag.terrain.reduce((sum, entry) => sum + entry.count, 0);
    if (total !== count) {
      ctx.addIssue({
        code: "custom",
        path: ["bags", name],
        message: `Bag "${name}" holds ${String(total)} tiles but ${String(count)} cell(s) draw from it.`,
      });
    }
  }

  // ---- the number path must visit real cells, without repeating ------------
  const pathSeen = new Set<string>();
  for (const [index, coord] of value.numbers.path.entries()) {
    const k = coordKey(coord);
    if (!seen.has(k)) {
      ctx.addIssue({
        code: "custom",
        path: ["numbers", "path", index],
        message: `Number path visits ${k}, which is not a cell in this scenario.`,
      });
    }
    if (pathSeen.has(k)) {
      ctx.addIssue({
        code: "custom",
        path: ["numbers", "path", index],
        message: `Number path visits ${k} more than once.`,
      });
    }
    pathSeen.add(k);
  }

  // ---- the token sequence must be exactly long enough ---------------------
  // Only checked when it is knowable ahead of the shuffle: every bag-drawn cell
  // has to sit on the path, otherwise which cells get skipped depends on where
  // the skip terrains happen to land.
  const skip = new Set(value.numbers.skipTerrains);
  const cellByCoord = new Map(value.cells.map((c) => [coordKey(c.coord), c]));

  let pinnedNumbered = 0;
  let drawnOnPath = 0;
  let allDrawnCellsOnPath = true;

  for (const c of value.cells) {
    const onPath = pathSeen.has(coordKey(c.coord));
    if (c.terrain === undefined) {
      if (onPath) drawnOnPath++;
      else allDrawnCellsOnPath = false;
    }
  }

  for (const k of pathSeen) {
    const c = cellByCoord.get(k);
    if (c?.terrain === undefined) continue;
    if (!skip.has(c.terrain) && c.number === undefined) pinnedNumbered++;
  }

  if (allDrawnCellsOnPath) {
    let skipsInBags = 0;
    for (const [name] of drawCounts) {
      const bag = value.bags[name];
      if (bag === undefined) continue;
      for (const entry of bag.terrain) {
        if (skip.has(entry.terrain)) skipsInBags += entry.count;
      }
    }
    const expected = pinnedNumbered + drawnOnPath - skipsInBags;
    // A `path` board declares its tokens in order; a `bag` board declares how
    // many of each. Either way the count has to match the board exactly.
    const declared =
      value.numbers.mode === "bag"
        ? value.numbers.tokens.reduce((sum, token) => sum + token.count, 0)
        : value.numbers.sequence.length;

    if (expected !== declared) {
      ctx.addIssue({
        code: "custom",
        path: ["numbers", value.numbers.mode === "bag" ? "tokens" : "sequence"],
        message: `The scenario declares ${String(declared)} tokens but the board needs ${String(expected)}.`,
      });
    }
  }

  // ---- ports must anchor to a cell that exists ----------------------------
  const portAnchors = new Set<string>();
  for (const [index, p] of value.ports.entries()) {
    const k = coordKey(p.at);
    if (!seen.has(k)) {
      ctx.addIssue({
        code: "custom",
        path: ["ports", index, "at"],
        message: `Port is anchored to ${k}, which is not a cell in this scenario.`,
      });
    }
    const anchor = `${k}|${String(p.edgeDir)}`;
    if (portAnchors.has(anchor)) {
      ctx.addIssue({
        code: "custom",
        path: ["ports", index],
        message: `Two ports share the anchor ${anchor}.`,
      });
    }
    portAnchors.add(anchor);

    if (p.kind === "resource" && p.resource === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ports", index, "resource"],
        message: "A resource port must name its resource.",
      });
    }
    if (p.kind === "generic" && p.resource !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ports", index, "resource"],
        message: "A generic port must not name a resource.",
      });
    }
  }

  // ---- islands referenced by cells must be declared -----------------------
  const declared = new Set(value.islands.map((i) => i.id));
  for (const [index, c] of value.cells.entries()) {
    if (c.island !== undefined && !declared.has(c.island)) {
      ctx.addIssue({
        code: "custom",
        path: ["cells", index, "island"],
        message: `Cell references island "${c.island}", which is not declared.`,
      });
    }
  }
});

/** Parse and validate unknown JSON into a Scenario, or throw. */
export function parseScenario(input: unknown): Scenario {
  return scenarioSchema.parse(input) as Scenario;
}

/** Non-throwing variant, for callers that want to report many problems. */
export function safeParseScenario(input: unknown): z.ZodSafeParseResult<RawScenario> {
  return scenarioSchema.safeParse(input);
}
