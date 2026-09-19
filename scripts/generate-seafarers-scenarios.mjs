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

// ---------------------------------------------------------------------------
// The Fog Islands (p.8 fixed and component tables, p.9 variable setup).
//
// The one scenario that deals part of its board face down. Twelve spaces start
// empty and are filled only when a player builds beside one (p.8); ADR 0009
// records what that cost the engine.
//
// Three things differ from every other board here:
//
//   1. Red discs may sit next to each other. p.9 says so outright — "Red number
//      discs (6s and 8s) are allowed to end up next to each other in this case"
//      — so the constraint is omitted rather than enforced.
//   2. No island pays victory points. p.8's additional rules are about
//      discovery alone, and the scenario wins at 12 VP. That is also what keeps
//      it clear of the per-player home-island problem that stopped The Four
//      Islands (ADR 0008), because there is no island award to get wrong.
//   3. The opening settlements are not confined. p.8: "Your starting
//      settlements with roads/ships may be placed on one island or two
//      different islands." So `setupIslands` is omitted.
//
// The face-down pile is not a terrain bag: it holds 2 sea hexes, and a bag is
// land-only. It is a flat, ordered list that `createGame` shuffles.
// ---------------------------------------------------------------------------

/** Flatten {terrain: count} into a list. Unlike a bag, this may hold sea. */
function expandTerrains(counts) {
  const out = [];
  for (const [terrain, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) out.push(terrain);
  }
  return out;
}

/** Flatten disc entries into the flat list a face-down pile wants. */
function expandDiscs(discs) {
  const out = [];
  for (const disc of discs) {
    for (let i = 0; i < disc.count; i++) out.push(disc.value);
  }
  return out;
}

function buildFogBoard({
  id,
  name,
  players,
  islandA,
  islandB,
  fogShape,
  faceUpBag,
  faceDown,
  faceUpDiscs,
  faceDownDiscs,
  ports,
}) {
  const land = [...islandA, ...islandB];
  const occupied = [...land, ...fogShape];
  const sea = shell(occupied);
  const seaKeys = new Set(sea.map(key));
  const centre = centroid(occupied);

  const cells = [
    ...islandA.map((coord) => ({
      coord,
      slot: "land",
      bag: "faceUp",
      island: "isle-a",
    })),
    ...islandB.map((coord) => ({
      coord,
      slot: "land",
      bag: "faceUp",
      island: "isle-b",
    })),
    // Terrain is pinned to `fog` so no bag fills these: what they hold comes off
    // the face-down stack when somebody builds alongside (p.8).
    ...fogShape.map((coord) => ({
      coord,
      slot: "fog",
      terrain: "fog",
      island: "unexplored",
    })),
    ...sea.map((coord) => ({ coord, slot: "sea", terrain: "sea" })),
  ];

  if (totalOf(faceUpBag) !== land.length) {
    throw new Error(
      `${id}: face-up bag holds ${totalOf(faceUpBag)} for ${land.length} hexes`,
    );
  }
  if (totalOf(faceDown) !== fogShape.length) {
    throw new Error(
      `${id}: face-down pile holds ${totalOf(faceDown)} for ${fogShape.length} spaces`,
    );
  }

  // No desert is dealt face up here, so every face-up land hex takes a disc.
  const faceUpTotal = faceUpDiscs.reduce((sum, d) => sum + d.count, 0);
  if (faceUpTotal !== land.length) {
    throw new Error(`${id}: ${faceUpTotal} face-up discs for ${land.length} hexes`);
  }

  // p.8: a revealed sea hex takes no disc, so the pile is sized to the land in
  // it. Getting this wrong would strand a reveal with nothing to draw.
  const faceDownLand = totalOf(faceDown) - (faceDown.sea ?? 0);
  const faceDownTotal = faceDownDiscs.reduce((sum, d) => sum + d.count, 0);
  if (faceDownTotal !== faceDownLand) {
    throw new Error(
      `${id}: ${faceDownTotal} face-down discs for ${faceDownLand} land hexes in the pile`,
    );
  }

  return {
    id,
    name,
    schemaVersion: 1,
    players,
    victoryPoints: 12,
    modules: ["base", "seafarers", "fog"],
    layout: { orientation: "pointy" },
    cells,
    bags: { faceUp: bagOf(faceUpBag) },
    numbers: {
      mode: "bag",
      tokens: faceUpDiscs,
      // Only the face-up land is numbered at setup; a revealed hex takes its
      // disc off the face-down pile instead.
      path: peelSpiral(land),
      skipTerrains: ["desert", "sea", "fog"],
      // No constraints: p.9 allows adjacent red discs on this board.
    },
    ports: portsAt(shoreline(land, seaKeys, centre), ports),
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 15 },
    setup: {
      mode: "snakeDraft",
      rounds: 2,
      // `fog` is not in the list, so no opening settlement lands on an empty
      // space. p.8 puts no island restriction on where they go otherwise.
      placeOn: ["land"],
    },
    islands: [
      { id: "isle-a", vpForFirstSettlement: 0 },
      { id: "isle-b", vpForFirstSettlement: 0 },
      { id: "unexplored", vpForFirstSettlement: 0 },
    ],
    hiddenStacks: [
      {
        id: "fog",
        cells: fogShape,
        contents: expandTerrains(faceDown),
        numbers: expandDiscs(faceDownDiscs),
      },
    ],
    startingPieces: [],
  };
}

// p.9: 13 sea, 17 face-up land (3 hills, 4 forest, 4 pasture, 3 fields,
// 3 mountains), 12 face down. Sea count is ours, per ADR 0008.
const fogFour = buildFogBoard({
  id: "fog-islands-4",
  name: "The Fog Islands",
  players: { min: 3, max: 4 },
  islandA: rowShape([
    [-2, -1, 3],
    [-1, -2, 3],
    [0, -2, 3],
  ]),
  islandB: rowShape([
    [4, -3, 3],
    [5, -4, 3],
    [6, -4, 2],
  ]),
  fogShape: rowShape([
    [1, -2, 4],
    [2, -2, 4],
    [3, -3, 4],
  ]),
  faceUpBag: { hill: 3, forest: 4, pasture: 4, field: 3, mountain: 3 },
  faceDown: { sea: 2, gold: 2, hill: 2, forest: 1, pasture: 1, field: 2, mountain: 2 },
  faceUpDiscs: [
    { value: 2, count: 1 },
    { value: 3, count: 2 },
    { value: 4, count: 2 },
    { value: 5, count: 2 },
    { value: 6, count: 2 },
    { value: 8, count: 2 },
    { value: 9, count: 2 },
    { value: 10, count: 2 },
    { value: 11, count: 1 },
    { value: 12, count: 1 },
  ],
  faceDownDiscs: [
    { value: 3, count: 1 },
    { value: 4, count: 1 },
    { value: 5, count: 1 },
    { value: 6, count: 1 },
    { value: 8, count: 1 },
    { value: 9, count: 1 },
    { value: 10, count: 1 },
    { value: 11, count: 2 },
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

// p.8: 16 sea, 14 face-up land (2 hills, 4 forest, 4 pasture, 2 fields,
// 2 mountains), 12 face down.
const fogThree = buildFogBoard({
  id: "fog-islands-3",
  name: "The Fog Islands, three players",
  players: { min: 3, max: 3 },
  islandA: rowShape([
    [-1, -1, 3],
    [0, -2, 4],
  ]),
  islandB: rowShape([
    [4, -4, 4],
    [5, -4, 3],
  ]),
  fogShape: rowShape([
    [1, -2, 4],
    [2, -3, 4],
    [3, -3, 4],
  ]),
  faceUpBag: { hill: 2, forest: 4, pasture: 4, field: 2, mountain: 2 },
  faceDown: { sea: 2, gold: 2, hill: 2, forest: 1, pasture: 1, field: 2, mountain: 2 },
  faceUpDiscs: [
    { value: 3, count: 1 },
    { value: 4, count: 1 },
    { value: 5, count: 2 },
    { value: 6, count: 2 },
    { value: 8, count: 2 },
    { value: 9, count: 2 },
    { value: 10, count: 1 },
    { value: 11, count: 2 },
    { value: 12, count: 1 },
  ],
  faceDownDiscs: [
    { value: 3, count: 2 },
    { value: 4, count: 1 },
    { value: 5, count: 1 },
    { value: 6, count: 1 },
    { value: 8, count: 1 },
    { value: 9, count: 1 },
    { value: 10, count: 1 },
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
// The Black Forest.
//
// Not a Seafarers scenario at all: a base-game map that borrows the fog. It has
// no ships, no islands worth points, and wins at ten. Source is
// docs/design/rush-and-black-forest.md, which is a reconstruction rather than a
// transcription — Colonist ships this as a custom map with no rules page — so
// ADR 0010 records which parts are cited and which are inferred.
//
// The shape of it, and why:
//
//   - The known board is almost entirely forest. Every opening intersection
//     produces lumber, so lumber is nearly worthless and no balanced starting
//     spot exists. That inversion is the whole design.
//   - A desert sits at the centre with the robber on it, inside a small lake.
//     The 2:1 lumber harbours face *inward* onto that lake, which makes the
//     middle the only place to convert the wood everyone is drowning in.
//   - Fog rings the outside. The scarce resources — brick, wool, grain, ore —
//     are all in there, so the only route to a balanced economy is to spend the
//     wood you have on roads and go looking.
//
// The outline is ours, as it is for every board here: the source has a picture,
// not coordinates, and transcribing a diagram by eye is the error this
// generator exists to avoid (ADR 0008). The composition is what matters and is
// stated exactly below.
// ---------------------------------------------------------------------------

function buildBlackForest() {
  const heart = [0, 0];
  const lake = shell([heart]);
  const lakeKeys = new Set(lake.map(key));

  const core = hexDisc(3);
  const inner = new Set([key(heart), ...lakeKeys]);
  const forest = core.filter((hex) => !inner.has(key(hex)));

  // One ring of fog around everything. Each hex is a road's worth of gamble.
  const fog = shell(core);
  const centre = centroid(core);

  // Every hex on the known board is forest but the one desert in the middle.
  const forestBag = { forest: forest.length };

  // What the fog is hiding: everything the known board lacks, and no forest at
  // all. Inferred — the source gives weights for the known board and says
  // nothing about the stack — but the intent is not in doubt: exploration is
  // the only route to brick, wool, grain and ore. The sea hexes are the risk
  // half of the gamble, a road spent on open water.
  const fogStack = { sea: 4, hill: 5, pasture: 5, field: 5, mountain: 5 };

  // Thirty numbered forest hexes; the desert takes none.
  const discs = [
    { value: 2, count: 2 },
    { value: 3, count: 3 },
    { value: 4, count: 3 },
    { value: 5, count: 4 },
    { value: 6, count: 3 },
    { value: 8, count: 3 },
    { value: 9, count: 4 },
    { value: 10, count: 3 },
    { value: 11, count: 3 },
    { value: 12, count: 2 },
  ];

  // Twenty discs for the twenty land hexes in the stack.
  const fogDiscs = [
    { value: 2, count: 1 },
    { value: 3, count: 2 },
    { value: 4, count: 2 },
    { value: 5, count: 3 },
    { value: 6, count: 2 },
    { value: 8, count: 2 },
    { value: 9, count: 3 },
    { value: 10, count: 2 },
    { value: 11, count: 2 },
    { value: 12, count: 1 },
  ];

  const cells = [
    { coord: heart, slot: "land", terrain: "desert", island: "heart" },
    ...lake.map((coord) => ({ coord, slot: "sea", terrain: "sea" })),
    ...forest.map((coord) => ({
      coord,
      slot: "land",
      bag: "forest",
      island: "forest",
    })),
    ...fog.map((coord) => ({
      coord,
      slot: "fog",
      terrain: "fog",
      island: "unexplored",
    })),
  ];

  if (totalOf(forestBag) !== forest.length) {
    throw new Error(`black forest: bag ${totalOf(forestBag)} for ${forest.length}`);
  }
  if (totalOf(fogStack) !== fog.length) {
    throw new Error(
      `black forest: stack ${totalOf(fogStack)} for ${fog.length} spaces`,
    );
  }
  const discTotal = discs.reduce((sum, d) => sum + d.count, 0);
  if (discTotal !== forest.length) {
    throw new Error(`black forest: ${discTotal} discs for ${forest.length} forest`);
  }
  const fogLand = totalOf(fogStack) - (fogStack.sea ?? 0);
  const fogDiscTotal = fogDiscs.reduce((sum, d) => sum + d.count, 0);
  if (fogDiscTotal !== fogLand) {
    throw new Error(`black forest: ${fogDiscTotal} fog discs for ${fogLand} land`);
  }

  return {
    id: "black-forest",
    name: "The Black Forest",
    schemaVersion: 1,
    players: { min: 3, max: 4 },
    victoryPoints: 10,
    // No ships, no Seafarers. Only the fog, which is a mechanic of its own.
    modules: ["base", "fog"],
    layout: { orientation: "pointy" },
    cells,
    bags: { forest: bagOf(forestBag) },
    numbers: {
      mode: "bag",
      tokens: discs,
      path: peelSpiral([heart, ...forest]),
      skipTerrains: ["desert", "sea", "fog"],
      // Deliberately unbalanced, per the source: the fog region's numbers are
      // not laid out the way a standard board's are, and the argument for
      // keeping it that way is that it makes the unexplored ground worth
      // gambling on rather than settling safely at home.
    },
    // Lumber harbours, facing inward onto the lake. On a board where everyone
    // has wood, a 2:1 that takes it is the only reliable way to turn a surplus
    // into anything else.
    ports: portsAt(shoreline(forest, lakeKeys, centre), [
      two("lumber"),
      two("lumber"),
      two("lumber"),
      two("lumber"),
      two("lumber"),
      two("lumber"),
    ]),
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [
      { id: "forest", vpForFirstSettlement: 0 },
      { id: "heart", vpForFirstSettlement: 0 },
      { id: "unexplored", vpForFirstSettlement: 0 },
    ],
    hiddenStacks: [
      {
        id: "fog",
        cells: fog,
        contents: expandTerrains(fogStack),
        numbers: expandDiscs(fogDiscs),
      },
    ],
    startingPieces: [],
  };
}

const blackForest = buildBlackForest();

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "scenarios", "data");
mkdirSync(outDir, { recursive: true });

for (const scenario of [
  threePlayer,
  fourPlayer,
  desertThree,
  desertFour,
  fogThree,
  fogFour,
  blackForest,
]) {
  const outFile = join(outDir, `${scenario.id}.json`);
  writeFileSync(outFile, `${JSON.stringify(scenario, null, 2)}\n`);

  const land = scenario.cells.filter((c) => c.slot === "land").length;
  const sea = scenario.cells.filter((c) => c.slot === "sea").length;
  console.log(
    `wrote ${outFile}: ${scenario.cells.length} cells (${land} land, ${sea} sea), ` +
      `${scenario.islands.length - 1} small islands, ${scenario.ports.length} ports`,
  );
}
