#!/usr/bin/env node
/**
 * Generates the shipped board data:
 *   packages/scenarios/data/classic-3-4.json   19 hexes, 3-4 players
 *   packages/scenarios/data/classic-5-6.json   30 hexes, 5-6 players
 *
 * The scenario format wants an explicit cell list, an explicit number path and
 * explicit port anchors, because that is what makes irregular Seafarers boards
 * expressible. Typing 30 coordinates, a 30-step spiral and 11 port anchors by
 * hand is a transcription-error generator, so this derives them and writes the
 * data files. Run it again if a layout ever changes:
 *
 *   node scripts/generate-classic-scenario.mjs
 *   pnpm exec prettier --ignore-path /dev/null --write packages/scenarios/data
 *
 * The second line matters: the data directory is in .prettierignore, but the
 * committed files are Prettier-formatted, so skipping it turns a regeneration
 * into a 200-line whitespace diff.
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

/**
 * The 5-6 player island: rows of 3-4-5-6-5-4-3 hexes (30 in all).
 *
 * A radius-3 hexagon with the last hex of every row dropped, which gives the
 * shape the extension's frame makes: sides alternating three and four hexes.
 */
function stretchedHex() {
  const out = [];
  for (let r = -3; r <= 3; r++) {
    const lo = Math.max(-3, -r - 3);
    const hi = Math.min(3, -r + 3);
    for (let q = lo; q < hi; q++) out.push([q, r]);
  }
  return out;
}

/** Centre of a set of hexes, in world space. */
function centroid(hexes) {
  let x = 0;
  let y = 0;
  for (const h of hexes) {
    const [hx, hy] = hexToPixel(h);
    x += hx;
    y += hy;
  }
  return [x / hexes.length, y / hexes.length];
}

/**
 * An outside-in spiral over any shape: peel the outer layer, then the next.
 *
 * `spiral()` above only works on a regular disc. The rules lay tokens "along a
 * spiral, starting on the outside hexes and proceeding toward the centre"
 * (5-6 rules 2022 p.4), which is what peeling layers produces on any outline —
 * the 5-6 island, and the irregular Seafarers maps later.
 */
function peelSpiral(cells) {
  const remaining = new Map(cells.map((h) => [key(h), h]));
  const out = [];

  while (remaining.size > 0) {
    const layer = [...remaining.values()].filter((h) =>
      DIRS.some((d) => !remaining.has(key(add(h, d)))),
    );
    const [cx, cy] = centroid([...remaining.values()]);
    layer.sort((a, b) => {
      const [ax, ay] = hexToPixel(a);
      const [bx, by] = hexToPixel(b);
      return Math.atan2(ay - cy, ax - cx) - Math.atan2(by - cy, bx - cx);
    });
    for (const h of layer) {
      out.push(h);
      remaining.delete(key(h));
    }
  }

  return out;
}

/**
 * Every (hex, direction) whose neighbour is off the board, walked in angular
 * order around the board centre so ports can be spaced evenly around it.
 */
function coastline(cells) {
  const cellKeys = new Set(cells.map(key));
  const [cx, cy] = centroid(cells);
  const coast = [];

  for (const hex of cells) {
    for (let dir = 0; dir < 6; dir++) {
      const outside = add(hex, DIRS[dir]);
      if (cellKeys.has(key(outside))) continue;
      const [hx, hy] = hexToPixel(hex);
      const [ox, oy] = hexToPixel(outside);
      const mx = (hx + ox) / 2;
      const my = (hy + oy) / 2;
      coast.push({ at: hex, edgeDir: dir, angle: Math.atan2(my - cy, mx - cx) });
    }
  }

  coast.sort((a, b) => a.angle - b.angle);
  return coast;
}

function portsAt(coast, offsets, kinds) {
  return offsets.map((offset, i) => {
    const anchor = coast[offset];
    const spec = kinds[i];
    return {
      at: anchor.at,
      edgeDir: anchor.edgeDir,
      kind: spec.kind,
      ...(spec.resource ? { resource: spec.resource } : {}),
      ratio: spec.ratio,
    };
  });
}

function checkPath(path, cells, what) {
  const cellKeys = new Set(cells.map(key));
  if (path.length !== cells.length) {
    throw new Error(`${what}: path covers ${path.length} of ${cells.length} cells`);
  }
  for (const h of path) {
    if (!cellKeys.has(key(h))) throw new Error(`${what}: path left the board at ${key(h)}`);
  }
}

const GENERIC = { kind: "generic", ratio: 3 };
const two = (resource) => ({ kind: "resource", resource, ratio: 2 });

// ---------------------------------------------------------------------------
// Classic, three to four players. 19 hexes, the lettered A-R token sequence.
// ---------------------------------------------------------------------------
const cells = hexDisc(2);
const path = spiral(2);
checkPath(path, cells, "classic-3-4");

const coast = coastline(cells);
if (coast.length !== 30) {
  throw new Error(`expected 30 coastline edges, found ${coast.length}`);
}

// Nine ports with gaps of 3,4,3,3,4,3,3,4,3 — sums to the 30 coast edges.
const ports = portsAt(
  coast,
  [0, 3, 7, 10, 13, 17, 20, 23, 27],
  [
    GENERIC,
    two("grain"),
    two("ore"),
    GENERIC,
    two("wool"),
    GENERIC,
    two("brick"),
    two("lumber"),
    GENERIC,
  ],
);

const classic = {
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

// ---------------------------------------------------------------------------
// Classic, five to six players. The 5-6 extension: 30 hexes, 28 tokens, 11
// harbours, and a bigger supply (the ext56 rule module carries the cards).
//
// Components, 5-6 rules 2022 p.2 and the board on p.5: eleven more hexes (one
// desert, two each of the five terrains), 28 number discs, and two more
// harbours — a 2:1 wool and a 3:1 (p.3).
// ---------------------------------------------------------------------------
const bigCells = stretchedHex();
if (bigCells.length !== 30) {
  throw new Error(`5-6 board has ${bigCells.length} hexes, expected 30`);
}
const bigPath = peelSpiral(bigCells);
checkPath(bigPath, bigCells, "classic-5-6");

const bigCoast = coastline(bigCells);
const bigPortCount = 11;
const bigOffsets = Array.from({ length: bigPortCount }, (_, i) =>
  Math.round((i * bigCoast.length) / bigPortCount),
);

const big = {
  id: "classic-5-6",
  name: "Classic, five to six players",
  schemaVersion: 1,
  players: { min: 5, max: 6 },
  victoryPoints: 10,
  modules: ["base", "ext56"],
  layout: { orientation: "pointy" },
  cells: bigCells.map((coord) => ({ coord, slot: "land", island: "home" })),
  bags: {
    land: {
      terrain: [
        { terrain: "forest", count: 6 },
        { terrain: "pasture", count: 6 },
        { terrain: "field", count: 6 },
        { terrain: "hill", count: 5 },
        { terrain: "mountain", count: 5 },
        { terrain: "desert", count: 2 },
      ],
    },
  },
  numbers: {
    // The box's tokens, shuffled. The extension's lettered order is not printed
    // in any rulebook we hold, but the composition is (p.5); see ADR 0006.
    mode: "bag",
    tokens: [
      { value: 2, count: 2 },
      { value: 3, count: 3 },
      { value: 4, count: 3 },
      { value: 5, count: 3 },
      { value: 6, count: 3 },
      { value: 8, count: 3 },
      { value: 9, count: 3 },
      { value: 10, count: 3 },
      { value: 11, count: 3 },
      { value: 12, count: 2 },
    ],
    path: bigPath,
    skipTerrains: ["desert", "sea"],
    constraints: { noAdjacentRedNumbers: true },
  },
  ports: portsAt(bigCoast, bigOffsets, [
    GENERIC,
    two("grain"),
    GENERIC,
    two("ore"),
    two("wool"),
    GENERIC,
    two("brick"),
    two("wool"),
    GENERIC,
    two("lumber"),
    GENERIC,
  ]),
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [{ id: "home", vpForFirstSettlement: 0 }],
  hiddenStacks: [],
  startingPieces: [],
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "scenarios", "data");
mkdirSync(outDir, { recursive: true });

for (const scenario of [classic, big]) {
  const outFile = join(outDir, `${scenario.id}.json`);
  writeFileSync(outFile, `${JSON.stringify(scenario, null, 2)}\n`);
  console.log(
    `wrote ${outFile}: ${scenario.cells.length} cells, ${scenario.numbers.path.length} path steps, ${scenario.ports.length} ports`,
  );
}
