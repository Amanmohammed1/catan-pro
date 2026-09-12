#!/usr/bin/env node
/**
 * Generates the small test-fixture scenarios.
 *
 * These exist to prove the format and the builder are not quietly specialised to
 * the classic 19-tile board:
 *
 *   tiny-island   3 land cells inside a full sea ring. The only fixture with
 *                 land, sea and coast edges all present, so it is what pins down
 *                 edge classification before Seafarers needs it in M6.
 *   two-islands   two land clusters with no connecting cells, which is the
 *                 disjoint case an irregular Seafarers map requires.
 *
 *   node scripts/generate-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIRS = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const key = (h) => `${h[0]},${h[1]}`;

/** Every off-cluster neighbour of the given cells. */
function ringAround(cells) {
  const inside = new Set(cells.map(key));
  const ring = new Map();
  for (const hex of cells) {
    for (const dir of DIRS) {
      const n = add(hex, dir);
      if (inside.has(key(n))) continue;
      ring.set(key(n), n);
    }
  }
  return [...ring.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---------------------------------------------------------------------------
// tiny-island: a mutually adjacent land triangle, fully enclosed by sea.
// ---------------------------------------------------------------------------
const islandLand = [
  [0, 0],
  [1, 0],
  [0, 1],
];
const islandSea = ringAround(islandLand);

const tinyIsland = {
  id: "tiny-island",
  name: "Tiny Island",
  schemaVersion: 1,
  players: { min: 3, max: 4 },
  victoryPoints: 10,
  modules: ["base"],
  layout: { orientation: "pointy" },
  cells: [
    { coord: islandLand[0], slot: "land", terrain: "forest", island: "home" },
    { coord: islandLand[1], slot: "land", terrain: "pasture", island: "home" },
    { coord: islandLand[2], slot: "land", terrain: "field", island: "home" },
    ...islandSea.map((coord) => ({ coord, slot: "sea", terrain: "sea" })),
  ],
  bags: {},
  numbers: {
    mode: "path",
    sequence: [5, 9, 4],
    path: islandLand,
    skipTerrains: ["desert", "sea"],
  },
  ports: [],
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [{ id: "home", vpForFirstSettlement: 0 }],
  hiddenStacks: [],
  startingPieces: [],
};

// ---------------------------------------------------------------------------
// two-islands: two land clusters that share no cell and touch nowhere.
// ---------------------------------------------------------------------------
const westLand = [
  [0, 0],
  [1, 0],
];
const eastLand = [
  [6, 0],
  [7, 0],
];

const twoIslands = {
  id: "two-islands",
  name: "Two Islands",
  schemaVersion: 1,
  players: { min: 3, max: 4 },
  victoryPoints: 10,
  modules: ["base"],
  layout: { orientation: "pointy" },
  cells: [
    { coord: westLand[0], slot: "land", terrain: "forest", island: "west" },
    { coord: westLand[1], slot: "land", terrain: "hill", island: "west" },
    { coord: eastLand[0], slot: "land", terrain: "field", island: "east" },
    { coord: eastLand[1], slot: "land", terrain: "mountain", island: "east" },
  ],
  bags: {},
  numbers: {
    mode: "path",
    sequence: [3, 11, 5, 9],
    path: [...westLand, ...eastLand],
    skipTerrains: ["desert", "sea"],
  },
  ports: [],
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [
    { id: "west", vpForFirstSettlement: 0 },
    { id: "east", vpForFirstSettlement: 2 },
  ],
  hiddenStacks: [],
  startingPieces: [],
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "scenarios", "data", "fixtures");
mkdirSync(outDir, { recursive: true });

for (const scenario of [tinyIsland, twoIslands]) {
  const file = join(outDir, `${scenario.id}.json`);
  writeFileSync(file, `${JSON.stringify(scenario, null, 2)}\n`);
  console.log(`wrote ${file}: ${scenario.cells.length} cells`);
}
