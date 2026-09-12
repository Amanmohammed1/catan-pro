#!/usr/bin/env node
/**
 * Generates packages/scenarios/data/classic-3-4.json.
 *
 * The scenario format wants an explicit cell list, an explicit number path and
 * explicit port anchors, because that is what makes irregular Seafarers boards
 * expressible. Typing 19 coordinates, a 19-step spiral and 9 port anchors by
 * hand is a transcription-error generator, so this derives them and writes the
 * data file. Run it again if the classic layout ever changes:
 *
 *   node scripts/generate-classic-scenario.mjs
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
const SQRT3 = Math.sqrt(3);

/** Hex centre in pointy-top world space, used only for ordering the coastline. */
function hexToPixel([q, r]) {
  return [SQRT3 * q + (SQRT3 / 2) * r, 1.5 * r];
}

/** All hexes within `radius` steps of the origin. */
function hexDisc(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r++) out.push([q, r]);
  }
  return out;
}

/** One ring at `radius`, walked in order. */
function hexRing(radius) {
  if (radius === 0) return [[0, 0]];
  const out = [];
  let hex = [DIRS[4][0] * radius, DIRS[4][1] * radius];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push(hex);
      hex = add(hex, DIRS[i]);
    }
  }
  return out;
}

/** Outside-in spiral: ring 2, then ring 1, then the centre. */
function spiral(radius) {
  const out = [];
  for (let r = radius; r >= 0; r--) out.push(...hexRing(r));
  return out;
}

const cells = hexDisc(2);
const cellKeys = new Set(cells.map(key));
const path = spiral(2);

if (path.length !== cells.length) {
  throw new Error(`spiral covers ${path.length} of ${cells.length} cells`);
}
for (const h of path) {
  if (!cellKeys.has(key(h))) throw new Error(`spiral left the board at ${key(h)}`);
}

// ---------------------------------------------------------------------------
// Coastline: every (hex, direction) whose neighbour is off the board, walked in
// angular order around the board centre so ports can be spaced evenly.
// ---------------------------------------------------------------------------
const coast = [];
for (const hex of cells) {
  for (let dir = 0; dir < 6; dir++) {
    const outside = add(hex, DIRS[dir]);
    if (cellKeys.has(key(outside))) continue;
    const [hx, hy] = hexToPixel(hex);
    const [ox, oy] = hexToPixel(outside);
    const mx = (hx + ox) / 2;
    const my = (hy + oy) / 2;
    coast.push({ at: hex, edgeDir: dir, angle: Math.atan2(my, mx) });
  }
}
coast.sort((a, b) => a.angle - b.angle);

if (coast.length !== 30) {
  throw new Error(`expected 30 coastline edges, found ${coast.length}`);
}

// Nine ports with gaps of 3,4,3,3,4,3,3,4,3 — sums to the 30 coast edges.
const PORT_OFFSETS = [0, 3, 7, 10, 13, 17, 20, 23, 27];
const PORT_KINDS = [
  { kind: "generic", ratio: 3 },
  { kind: "resource", resource: "grain", ratio: 2 },
  { kind: "resource", resource: "ore", ratio: 2 },
  { kind: "generic", ratio: 3 },
  { kind: "resource", resource: "wool", ratio: 2 },
  { kind: "generic", ratio: 3 },
  { kind: "resource", resource: "brick", ratio: 2 },
  { kind: "resource", resource: "lumber", ratio: 2 },
  { kind: "generic", ratio: 3 },
];

const ports = PORT_OFFSETS.map((offset, i) => {
  const anchor = coast[offset];
  const spec = PORT_KINDS[i];
  return {
    at: anchor.at,
    edgeDir: anchor.edgeDir,
    kind: spec.kind,
    ...(spec.resource ? { resource: spec.resource } : {}),
    ratio: spec.ratio,
  };
});

const scenario = {
  id: "classic-3-4",
  name: "Classic",
  schemaVersion: 1,
  players: { min: 3, max: 4 },
  victoryPoints: 10,
  modules: ["base"],
  layout: { orientation: "pointy" },
  cells: cells.map((coord) => ({ coord, slot: "land", island: "home" })),
  bags: {
    land: {
      terrain: [
        { terrain: "forest", count: 4 },
        { terrain: "pasture", count: 4 },
        { terrain: "field", count: 4 },
        { terrain: "hill", count: 3 },
        { terrain: "mountain", count: 3 },
        { terrain: "desert", count: 1 },
      ],
    },
  },
  numbers: {
    mode: "path",
    sequence: [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11],
    path,
    skipTerrains: ["desert", "sea"],
    constraints: { noAdjacentRedNumbers: true },
  },
  ports,
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [{ id: "home", vpForFirstSettlement: 0 }],
  hiddenStacks: [],
  startingPieces: [],
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "scenarios", "data");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "classic-3-4.json");
writeFileSync(outFile, `${JSON.stringify(scenario, null, 2)}\n`);

console.log(
  `wrote ${outFile}: ${cells.length} cells, ${path.length} path steps, ${ports.length} ports, ${coast.length} coast edges`,
);
