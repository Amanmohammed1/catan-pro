#!/usr/bin/env node
/**
 * Generates the Seafarers boards:
 *   packages/scenarios/data/new-shores-3.json   35 hexes, 3 players
 *   packages/scenarios/data/new-shores-4.json   42 hexes, 4 players
 *
 * Run it again if a layout changes:
 *
 *   node scripts/generate-seafarers-scenarios.mjs
 *   pnpm exec prettier --ignore-path /dev/null --write packages/scenarios/data
 *
 * The second line matters: the data directory is in .prettierignore, but the
 * committed files are Prettier-formatted, so skipping it turns a regeneration
 * into a huge whitespace diff.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from, and where they do not
 *
 * Every scenario in the Seafarers rulebook is printed twice: a fixed map, which
 * exists only as a diagram, and a "Variable Setup", whose hex and number-disc
 * composition is given as a table. This generator implements the variable
 * setup, because a table can be read exactly and a diagram cannot (ADR 0008).
 *
 * Heading for New Shores, 4 players (p.5), in the rulebook's own words —
 * the engine spells these terrains in the singular (hill, field, mountain):
 *   hexes  14 sea, 2 gold, 5 hills, 5 forest, 5 pasture, 5 fields,
 *          5 mountains, 1 desert                                   42 total
 *   discs  2x2, 3x3, 3x4, 3x5, 3x6, 3x8, 3x9, 3x10, 3x11, 1x12     27 total
 *   ports  5x 2:1, 4x 3:1
 *   wins at 14 VP; 2 VP for a first settlement on each small island (p.4)
 *
 * Heading for New Shores, 3 players (p.4):
 *   hexes  13 sea, 2 gold, 4 hills, 3 forest, 5 pasture, 4 fields,
 *          4 mountains, no desert                                  35 total
 *   discs  1x2, 2x3, 3x4, 3x5, 2x6, 3x8, 2x9, 3x10, 2x11, 1x12     22 total
 *   ports  5x 2:1, 3x 3:1
 *
 * Both disc tables were read off the rendered page, not the extracted text:
 * the values are printed as disc icons and the text layer keeps only the
 * counts, so the column order had to be seen to be trusted.
 *
 * Two deliberate departures, both recorded in ADR 0008:
 *
 *   1. The island *shapes* are ours. The rulebook shows them only as diagrams,
 *      and transcribing eight maps by eye is the transcription-error problem
 *      this generator exists to avoid. The composition is exact; the outline
 *      is not a rule.
 *
 *   2. The sea count is whatever the layout needs (about 18), not the table's
 *      14. A printed board is bounded by a physical frame; ours is bounded by
 *      where the cells stop, so the water has to do that job instead. Sea is
 *      terrain-neutral, and hitting 14 exactly would mean an arbitrary
 *      outline. The land composition, which is what actually affects play, is
 *      honoured hex for hex.
 *
 * Small islands sit two hexes clear of the main island. At one hex they would
 * share corners with it, and a single settlement on the seam would collect an
 * island's victory points without a ship ever being built — the opposite of
 * what the scenario is for.
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

/** Hex centre in pointy-top world space, used only for ordering. */
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

/** A shape given as rows: [r, qStart, count]. */
function rowShape(rows) {
  const out = [];
  for (const [r, qStart, count] of rows) {
    for (let i = 0; i < count; i++) out.push([qStart + i, r]);
  }
  return out;
}

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

/** Every hex touching `cells` but not in it. */
function shell(cells) {
  const inside = new Set(cells.map(key));
  const out = new Map();
  for (const hex of cells) {
    for (const d of DIRS) {
      const n = add(hex, d);
      if (inside.has(key(n))) continue;
      out.set(key(n), n);
    }
  }
  return [...out.values()];
}

/**
 * An outside-in spiral over any shape: peel the outer layer, then the next.
 *
 * The rules lay tokens "along a spiral, starting on the outside hexes and
 * proceeding toward the centre", which is what peeling layers produces on an
 * irregular outline. On a `bag` board the order barely matters — the tokens
 * are shuffled first — but the path still has to visit every numbered hex.
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
 * Carve `sizes` clusters out of `candidates`, spread around `centre`.
 *
 * Candidates are walked in angular order, so a run of consecutive entries is a
 * connected chain of hexes — an island. Clusters are started evenly around the
 * circle and never placed adjacent to one another.
 */
function pickClusters(candidates, sizes, centre) {
  const [cx, cy] = centre;
  const ordered = [...candidates].sort((a, b) => {
    const [ax, ay] = hexToPixel(a);
    const [bx, by] = hexToPixel(b);
    return Math.atan2(ay - cy, ax - cx) - Math.atan2(by - cy, bx - cx);
  });

  const taken = new Set();
  const clusters = [];
  const stride = Math.floor(ordered.length / sizes.length);

  sizes.forEach((size, index) => {
    const cluster = [];
    let cursor = index * stride;
    while (cluster.length < size && cursor < ordered.length) {
      const hex = ordered[cursor];
      cursor++;
      if (hex === undefined) break;
      // Never butt one island against another.
      const touchesAnother = DIRS.some((d) => taken.has(key(add(hex, d))));
      if (touchesAnother && cluster.length === 0) continue;
      cluster.push(hex);
      taken.add(key(hex));
    }
    if (cluster.length !== size) {
      throw new Error(`could not carve a cluster of ${size}`);
    }
    clusters.push(cluster);
  });

  return clusters;
}

/** (hex, direction) pairs where a land hex faces water, in angular order. */
function shoreline(land, waterKeys, centre) {
  const [cx, cy] = centre;
  const coast = [];

  for (const hex of land) {
    for (let dir = 0; dir < 6; dir++) {
      const outside = add(hex, DIRS[dir]);
      if (!waterKeys.has(key(outside))) continue;
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

function portsAt(coast, kinds) {
  const offsets = kinds.map((_, i) => Math.round((i * coast.length) / kinds.length));
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

const GENERIC = { kind: "generic", ratio: 3 };
const two = (resource) => ({ kind: "resource", resource, ratio: 2 });

/** The terrains a bag may name. Mirrors the engine's `Terrain`, minus sea. */
const LAND_TERRAINS = [
  "hill",
  "forest",
  "pasture",
  "field",
  "mountain",
  "desert",
  "gold",
];

/**
 * Flatten a {terrain: count} map into the bag entries the schema wants.
 *
 * The key check is worth having: the terrains are singular in the engine but
 * plural in the rulebook's tables, and a stray "hills" produces a bag the
 * schema rejects at load with a message about the offending cell rather than
 * anything pointing back here.
 */
function bagOf(counts) {
  for (const terrain of Object.keys(counts)) {
    if (!LAND_TERRAINS.includes(terrain)) {
      throw new Error(
        `"${terrain}" is not a terrain; expected one of ${LAND_TERRAINS.join(", ")}`,
      );
    }
  }
  return {
    terrain: Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([terrain, count]) => ({ terrain, count })),
  };
}

function totalOf(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function buildIslandBoard({
  id,
  name,
  players,
  mainShape,
  clusterSizes,
  mainBag,
  smallBag,
  discs,
  ports,
  victoryPoints,
}) {
  const main = mainShape;
  const sea = shell(main);
  const seaKeys = new Set(sea.map(key));
  const centre = centroid(main);

  // Small islands live beyond the water, so they can only be reached by ship.
  const beyond = shell([...main, ...sea]).filter((h) => !seaKeys.has(key(h)));
  const clusters = pickClusters(beyond, clusterSizes, centre);

  const islands = [
    { id: "main", vpForFirstSettlement: 0 },
    ...clusters.map((_, i) => ({
      id: `isle-${String.fromCharCode(97 + i)}`,
      vpForFirstSettlement: 2,
    })),
  ];

  const cells = [
    ...main.map((coord) => ({ coord, slot: "land", bag: "main", island: "main" })),
    ...sea.map((coord) => ({ coord, slot: "sea", terrain: "sea" })),
    ...clusters.flatMap((cluster, i) =>
      cluster.map((coord) => ({
        coord,
        slot: "land",
        bag: "small",
        island: `isle-${String.fromCharCode(97 + i)}`,
      })),
    ),
  ];

  const land = cells.filter((c) => c.slot === "land").map((c) => c.coord);

  if (totalOf(mainBag) !== main.length) {
    throw new Error(
      `${id}: main bag holds ${totalOf(mainBag)} for ${main.length} hexes`,
    );
  }
  const smallCount = clusters.reduce((sum, c) => sum + c.length, 0);
  if (totalOf(smallBag) !== smallCount) {
    throw new Error(
      `${id}: small bag holds ${totalOf(smallBag)} for ${smallCount} hexes`,
    );
  }

  // Every land hex takes a disc except a desert, which is stepped over.
  const numbered = totalOf(mainBag) + totalOf(smallBag) - (mainBag.desert ?? 0);
  const discTotal = discs.reduce((sum, d) => sum + d.count, 0);
  if (numbered !== discTotal) {
    throw new Error(`${id}: ${discTotal} discs for ${numbered} numbered hexes`);
  }

  return {
    id,
    name,
    schemaVersion: 1,
    players,
    victoryPoints,
    modules: ["base", "seafarers"],
    layout: { orientation: "pointy" },
    cells,
    bags: { main: bagOf(mainBag), small: bagOf(smallBag) },
    numbers: {
      mode: "bag",
      tokens: discs,
      path: peelSpiral(land),
      skipTerrains: ["desert", "sea"],
      constraints: { noAdjacentRedNumbers: true },
    },
    ports: portsAt(shoreline(main, seaKeys, centre), ports),
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
    setup: {
      mode: "snakeDraft",
      rounds: 2,
      placeOn: ["land"],
      // p.4: the opening settlements stay on the main island.
      setupIslands: ["main"],
    },
    islands,
    hiddenStacks: [],
    startingPieces: [],
  };
}

// ---------------------------------------------------------------------------

const fourPlayer = buildIslandBoard({
  id: "new-shores-4",
  name: "Heading for New Shores",
  players: { min: 3, max: 4 },
  victoryPoints: 14,
  // 19 hexes: the classic island.
  mainShape: hexDisc(2),
  clusterSizes: [2, 5, 2],
  // Terrain names are the engine's singulars: hill, field, mountain.
  mainBag: { hill: 4, forest: 4, pasture: 4, field: 3, mountain: 3, desert: 1 },
  smallBag: { gold: 2, hill: 1, forest: 1, pasture: 1, field: 2, mountain: 2 },
  discs: [
    { value: 2, count: 2 },
    { value: 3, count: 3 },
    { value: 4, count: 3 },
    { value: 5, count: 3 },
    { value: 6, count: 3 },
    { value: 8, count: 3 },
    { value: 9, count: 3 },
    { value: 10, count: 3 },
    { value: 11, count: 3 },
    { value: 12, count: 1 },
  ],
  ports: [
    GENERIC,
    two("grain"),
    GENERIC,
    two("ore"),
    two("wool"),
    GENERIC,
    two("brick"),
    two("lumber"),
    GENERIC,
  ],
});

const threePlayer = buildIslandBoard({
  id: "new-shores-3",
  name: "Heading for New Shores, three players",
  players: { min: 3, max: 3 },
  victoryPoints: 14,
  // 14 hexes, rows of 3-4-4-3.
  mainShape: rowShape([
    [-1, 0, 3],
    [0, -1, 4],
    [1, -2, 4],
    [2, -2, 3],
  ]),
  clusterSizes: [2, 4, 2],
  mainBag: { hill: 3, forest: 2, pasture: 4, field: 3, mountain: 2 },
  smallBag: { gold: 2, hill: 1, forest: 1, pasture: 1, field: 1, mountain: 2 },
  discs: [
    { value: 2, count: 1 },
    { value: 3, count: 2 },
    { value: 4, count: 3 },
    { value: 5, count: 3 },
    { value: 6, count: 2 },
    { value: 8, count: 3 },
    { value: 9, count: 2 },
    { value: 10, count: 3 },
    { value: 11, count: 2 },
    { value: 12, count: 1 },
  ],
  ports: [
    GENERIC,
    two("grain"),
    two("ore"),
    GENERIC,
    two("wool"),
    two("brick"),
    GENERIC,
    two("lumber"),
  ],
});

// ---------------------------------------------------------------------------
// Through the Desert (p.10 fixed, p.11 variable).
//
// The same shape as New Shores as far as this generator is concerned: a main
// island the opening settlements must sit on, and unexplored regions worth 2 VP
// apiece for a first settlement. What differs is the composition — three
// deserts sit *in* the main island, splitting it, and the gold is out among the
// regions.
//
// One rule from p.11 is not modelled: "do not place red number discs on gold
// fields". The scenario format has no way to say "this terrain may not take
// these values", and inventing one for a single line would be a poor trade. It
// makes gold slightly better here than the printed board intends.
// ---------------------------------------------------------------------------

const desertFour = buildIslandBoard({
  id: "through-the-desert-4",
  name: "Through the Desert",
  players: { min: 3, max: 4 },
  victoryPoints: 14,
  mainShape: hexDisc(2),
  clusterSizes: [2, 4, 3, 2],
  // Land, exactly as p.11 lists it: 2 gold, 5 of each terrain, 3 deserts — 30
  // hexes. The rulebook also prints 12 sea, but that count belongs to its own
  // fixed island outline; ours are generated, so the frame of water around them
  // is whatever the shape needs and comes out larger (ADR 0008).
  mainBag: { desert: 3, hill: 4, forest: 4, pasture: 3, field: 3, mountain: 2 },
  smallBag: { gold: 2, hill: 1, forest: 1, pasture: 2, field: 2, mountain: 3 },
  discs: [
    { value: 2, count: 1 },
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
  ports: [
    GENERIC,
    two("grain"),
    GENERIC,
    two("ore"),
    two("wool"),
    GENERIC,
    two("brick"),
    two("lumber"),
    GENERIC,
  ],
});

const desertThree = buildIslandBoard({
  id: "through-the-desert-3",
  name: "Through the Desert, three players",
  players: { min: 3, max: 3 },
  victoryPoints: 14,
  mainShape: rowShape([
    [-1, 0, 3],
    [0, -1, 4],
    [1, -2, 4],
    [2, -2, 3],
  ]),
  clusterSizes: [2, 4, 3, 2],
  // Land, exactly as p.10 lists it: 2 gold, 3 hills, 5 forest, 4 pasture,
  // 4 fields, 4 mountains, 3 deserts — 25 hexes. The 10 sea it prints belongs
  // to the rulebook's own fixed outline, not to this generated one (ADR 0008).
  mainBag: { desert: 3, hill: 2, forest: 3, pasture: 2, field: 2, mountain: 2 },
  smallBag: { gold: 2, hill: 1, forest: 2, pasture: 2, field: 2, mountain: 2 },
  discs: [
    { value: 2, count: 1 },
    { value: 3, count: 2 },
    { value: 4, count: 3 },
    { value: 5, count: 3 },
    { value: 6, count: 3 },
    { value: 8, count: 3 },
    { value: 9, count: 3 },
    { value: 10, count: 2 },
    { value: 11, count: 1 },
    { value: 12, count: 1 },
  ],
  ports: [
    GENERIC,
    two("grain"),
    two("ore"),
    GENERIC,
    two("wool"),
    two("brick"),
    GENERIC,
    two("lumber"),
  ],
});

// ---------------------------------------------------------------------------
// The Four Islands is deliberately absent.
//
// p.6: "Your starting settlements may be placed on one island or two different
// islands. These location(s) are your home islands... Each player may have
// different home and unexplored islands."
//
// A scenario here pins one vpForFirstSettlement per island, the same for
// everyone, so a player who started on an island would be paid for settling it.
// Generating the board anyway would produce one that scores wrongly, which is
// worse than not having it. It needs per-player home islands first — derivable
// if a building recorded the turn it was placed, since setup is turn 0 — and
// that is a rules change, not a data one. ADR 0008 carries the note.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "scenarios", "data");
mkdirSync(outDir, { recursive: true });

for (const scenario of [threePlayer, fourPlayer, desertThree, desertFour]) {
  const outFile = join(outDir, `${scenario.id}.json`);
  writeFileSync(outFile, `${JSON.stringify(scenario, null, 2)}\n`);

  const land = scenario.cells.filter((c) => c.slot === "land").length;
  const sea = scenario.cells.filter((c) => c.slot === "sea").length;
  console.log(
    `wrote ${outFile}: ${scenario.cells.length} cells (${land} land, ${sea} sea), ` +
      `${scenario.islands.length - 1} small islands, ${scenario.ports.length} ports`,
  );
}
