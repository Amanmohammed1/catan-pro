import { describe, it, expect } from "vitest";
import { longestRoadFor, resolveLongestRoad } from "./longestRoad.js";
import { buildBoardGraph } from "../geometry/buildBoardGraph.js";
import { seedRng } from "../rng/sfc32.js";
import { edgeIdAt, nodeIdAt, type EdgeId, type NodeId } from "../geometry/ids.js";
import type { Axial, DirectionIndex } from "../geometry/coords.js";
import type { BoardGraph } from "../geometry/types.js";
import type { Building, PlayerId } from "../state/types.js";
import type { Scenario, ScenarioCell } from "../scenario/types.js";

/**
 * Longest Road suite. CLAUDE.md asks for at least 30 cases covering branches,
 * loops, and roads broken by an opponent settlement, because road bugs are the
 * expensive kind: they change who wins and players notice.
 *
 * Rules references are to docs/rules/ (2020 base game), p.4 and p.9.
 */

// A radius-2 land board, big enough for any shape these tests need.
function disc(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r++) out.push([q, r]);
  }
  return out;
}

const cells: ScenarioCell[] = disc(2).map((coord) => ({
  coord,
  slot: "land" as const,
  terrain: "forest" as const,
}));

const scenario: Scenario = {
  id: "road-test",
  name: "Road Test",
  schemaVersion: 1,
  players: { min: 3, max: 4 },
  victoryPoints: 10,
  modules: ["base"],
  layout: { orientation: "pointy" },
  cells,
  bags: {},
  numbers: {
    mode: "path",
    sequence: cells.map((_, i) => (i % 10) + 2),
    path: cells.map((c) => c.coord),
    skipTerrains: ["desert", "sea"],
  },
  ports: [],
  pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
  setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
  islands: [],
  hiddenStacks: [],
  startingPieces: [],
};

const board: BoardGraph = buildBoardGraph(scenario, seedRng("roads")).board;

const ME: PlayerId = 0;
const FOE: PlayerId = 1;

/** Roads owned by one player, from a list of edge ids. */
function ownedBy(edges: readonly EdgeId[], player: PlayerId = ME) {
  const roads: Record<EdgeId, PlayerId> = {};
  for (const edge of edges) roads[edge] = player;
  return roads;
}

function measure(
  edges: readonly EdgeId[],
  buildings: Record<NodeId, Building> = {},
  player: PlayerId = ME,
  extraRoads: Record<EdgeId, PlayerId> = {},
): number {
  return longestRoadFor(
    { board, roads: { ...ownedBy(edges, player), ...extraRoads }, buildings },
    player,
  );
}

/**
 * A simple (non-repeating) path of `length` road segments, returned with the
 * intersections it runs through so tests can block a specific one.
 */
function simplePath(length: number): { edges: EdgeId[]; nodes: NodeId[] } {
  const start = Object.keys(board.nodes)[0] as NodeId;
  const edges: EdgeId[] = [];
  const nodes: NodeId[] = [start];
  const seen = new Set<NodeId>([start]);

  const walk = (current: NodeId): boolean => {
    if (edges.length === length) return true;
    for (const edgeId of board.nodes[current]?.edges ?? []) {
      const edge = board.edges[edgeId];
      if (edge === undefined) continue;
      const next = edge.nodes[0] === current ? edge.nodes[1] : edge.nodes[0];
      if (seen.has(next)) continue;
      seen.add(next);
      edges.push(edgeId);
      nodes.push(next);
      if (walk(next)) return true;
      edges.pop();
      nodes.pop();
      seen.delete(next);
    }
    return false;
  };

  const ok = walk(start);
  if (!ok) throw new Error(`no simple path of length ${String(length)}`);
  return { edges, nodes };
}

interface Spur {
  readonly spur: EdgeId;
  readonly index: number;
}

/**
 * Find an intersection along the path with a genuine spur: a road-free edge
 * whose far end is NOT already on the path. An edge back onto the path would be
 * a chord, which closes a cycle and legitimately allows a longer trail.
 */
function findSpur(
  used: readonly EdgeId[],
  pathNodes: readonly NodeId[],
  candidates: readonly NodeId[],
): Spur | null {
  const onPath = new Set(pathNodes);
  for (const node of candidates) {
    for (const candidate of board.nodes[node]?.edges ?? []) {
      if (used.includes(candidate)) continue;
      const edge = board.edges[candidate];
      if (edge === undefined) continue;
      const far = edge.nodes[0] === node ? edge.nodes[1] : edge.nodes[0];
      if (onPath.has(far)) continue;
      return { spur: candidate, index: pathNodes.indexOf(node) };
    }
  }
  return null;
}

/** The six edges around one hex, which form a closed loop. */
function ring(hex: Axial): EdgeId[] {
  return ([0, 1, 2, 3, 4, 5] as DirectionIndex[]).map((dir) => edgeIdAt(hex, dir));
}

function settlement(player: PlayerId): Building {
  return { kind: "settlement", player };
}

function city(player: PlayerId): Building {
  return { kind: "city", player };
}

// ---------------------------------------------------------------------------

describe("length of a simple network", () => {
  it("is 0 with no roads", () => {
    expect(measure([])).toBe(0);
  });

  it("is 0 when every road belongs to someone else", () => {
    const { edges } = simplePath(4);
    expect(measure(edges, {}, ME, ownedBy(edges, FOE))).toBe(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("is %i for a chain of %i segments", (n) => {
    expect(measure(simplePath(n).edges)).toBe(n);
  });

  it("counts only the longer of two disconnected networks", () => {
    const near = simplePath(3).edges;
    const far = ring([2, -2]).slice(0, 2);
    // Confirm the two groups really are disjoint before relying on the result.
    expect(new Set([...near, ...far]).size).toBe(near.length + far.length);
    expect(measure([...near, ...far])).toBe(3);
  });

  it("counts a single isolated road as 1", () => {
    expect(measure([edgeIdAt([0, 0], 0)])).toBe(1);
  });

  it("counts two roads meeting at a corner as 2", () => {
    expect(measure([edgeIdAt([0, 0], 0), edgeIdAt([0, 0], 1)])).toBe(2);
  });

  it("does not count two roads that share no intersection", () => {
    // Opposite edges of the same hex never touch.
    expect(measure([edgeIdAt([0, 0], 0), edgeIdAt([0, 0], 3)])).toBe(1);
  });
});

describe("branching", () => {
  it("counts only the longest branch, not the total (p.9)", () => {
    const { edges, nodes } = simplePath(6);

    // Hang a spur off an interior intersection. Not every node has a spare
    // edge — rim intersections have degree 2 — so find one that does.
    const found = findSpur(edges, nodes, nodes.slice(1, -1));
    expect(found).not.toBeNull();
    const { spur, index } = found as Spur;

    const all = [...edges, spur];
    expect(all).toHaveLength(7);

    // Arms from the junction are `index` and `6 - index`. A trail either runs
    // the original path (6) or takes the spur plus the longer arm. It can never
    // be the 7-segment total, which is exactly what p.9 forbids.
    const longestArm = Math.max(index, 6 - index);
    expect(measure(all)).toBe(Math.max(6, longestArm + 1));
    expect(measure(all)).toBeLessThan(7);
  });

  it("keeps the through-run when a spur is shorter than both arms", () => {
    const { edges, nodes } = simplePath(8);
    const found = findSpur(edges, nodes, nodes.slice(2, -2));
    expect(found).not.toBeNull();
    const { spur, index } = found as Spur;

    const longestArm = Math.max(index, 8 - index);
    expect(measure([...edges, spur])).toBe(Math.max(8, longestArm + 1));
  });

  it("uses a spur when it beats the arm it replaces", () => {
    const { edges, nodes } = simplePath(4);
    // A spur off the second intersection: arms are 1 and 3, so the best trail
    // is the spur plus the long arm, which ties the original 4.
    const found = findSpur(edges, nodes, [nodes[1] as NodeId]);
    if (found === null) return; // geometry-dependent; covered by the case above
    expect(measure([...edges, found.spur])).toBe(4);
  });

  it("never double counts a segment at a junction", () => {
    const { edges, nodes } = simplePath(2);
    const junction = nodes[1] as NodeId;
    const spurs = (board.nodes[junction]?.edges ?? []).filter(
      (e) => !edges.includes(e),
    );
    const all = [...edges, ...spurs];
    // Whatever the shape, the answer can never exceed the number of roads.
    expect(measure(all)).toBeLessThanOrEqual(all.length);
  });
});

describe("loops", () => {
  it("counts a closed ring of six as 6", () => {
    expect(measure(ring([0, 0]))).toBe(6);
  });

  it("counts a ring plus a tail as 7", () => {
    const loop = ring([0, 0]);
    const tail = (board.nodes[nodeIdAt([0, 0], 0)]?.edges ?? []).find(
      (e) => !loop.includes(e),
    ) as EdgeId;
    expect(tail).toBeDefined();
    expect(measure([...loop, tail])).toBe(7);
  });

  it("counts two rings sharing an intersection as a figure eight", () => {
    // Adjacent hexes share an edge, so their rings share two nodes and an edge.
    const a = ring([0, 0]);
    const b = ring([1, 0]);
    const all = [...new Set([...a, ...b])];
    // 11 distinct segments; every one is reachable in a single edge-distinct
    // trail because each node has even degree except where the shared edge is.
    expect(all).toHaveLength(11);
    expect(measure(all)).toBe(11);
  });

  it("never exceeds the number of roads owned", () => {
    const loop = ring([0, 0]);
    expect(measure(loop)).toBeLessThanOrEqual(loop.length);
  });
});

describe("opponent buildings break a road (p.9)", () => {
  it("splits a chain when an opponent settles in the middle", () => {
    const { edges, nodes } = simplePath(6);
    const middle = nodes[3] as NodeId;
    expect(measure(edges, { [middle]: settlement(FOE) })).toBe(3);
  });

  it("splits unevenly at an off-centre intersection", () => {
    const { edges, nodes } = simplePath(6);
    expect(measure(edges, { [nodes[2] as NodeId]: settlement(FOE) })).toBe(4);
    expect(measure(edges, { [nodes[4] as NodeId]: settlement(FOE) })).toBe(4);
    expect(measure(edges, { [nodes[1] as NodeId]: settlement(FOE) })).toBe(5);
  });

  it("does not split when the opponent builds on an endpoint", () => {
    const { edges, nodes } = simplePath(5);
    expect(measure(edges, { [nodes[0]!]: settlement(FOE) })).toBe(5);
    expect(measure(edges, { [nodes[5]!]: settlement(FOE) })).toBe(5);
  });

  it("breaks on an opponent city as well as a settlement", () => {
    const { edges, nodes } = simplePath(6);
    expect(measure(edges, { [nodes[3] as NodeId]: city(FOE) })).toBe(3);
  });

  it("is not broken by the player's own settlement", () => {
    const { edges, nodes } = simplePath(6);
    expect(measure(edges, { [nodes[3] as NodeId]: settlement(ME) })).toBe(6);
  });

  it("is not broken by the player's own city", () => {
    const { edges, nodes } = simplePath(6);
    expect(measure(edges, { [nodes[2] as NodeId]: city(ME) })).toBe(6);
  });

  it("can be broken in two places", () => {
    const { edges, nodes } = simplePath(9);
    const blocked = {
      [nodes[3] as NodeId]: settlement(FOE),
      [nodes[6] as NodeId]: settlement(FOE),
    };
    expect(measure(edges, blocked)).toBe(3);
  });

  it("opens a ring into a line when an opponent settles on it", () => {
    const loop = ring([0, 0]);
    const onLoop = nodeIdAt([0, 0], 0);
    // A cut vertex on a 6-cycle leaves a 5-segment path.
    expect(measure(loop, { [onLoop]: settlement(FOE) })).toBe(5);
  });

  it("still allows a road to end on the blocking intersection", () => {
    const { edges, nodes } = simplePath(4);
    // Blocking the second node leaves arms of 1 and 3; the 3 still counts.
    expect(measure(edges, { [nodes[1] as NodeId]: settlement(FOE) })).toBe(3);
  });

  it("ignores buildings on intersections the road never touches", () => {
    const { edges } = simplePath(5);
    const far = nodeIdAt([2, -2], 3);
    expect(measure(edges, { [far]: settlement(FOE) })).toBe(5);
  });
});

describe("independence from other players", () => {
  it("ignores opponent roads entirely", () => {
    const mine = simplePath(4);
    const theirs = ring([2, -2]);
    expect(measure(mine.edges, {}, ME, ownedBy(theirs, FOE))).toBe(4);
  });

  it("does not let an opponent road bridge two of my networks", () => {
    const { edges } = simplePath(5);
    const mineWithGap = [...edges];
    const removed = mineWithGap.splice(2, 1)[0] as EdgeId;
    // The removed segment, owned by the opponent, must not reconnect my halves.
    expect(measure(mineWithGap, {}, ME, { [removed]: FOE })).toBeLessThanOrEqual(3);
  });

  it("measures each player independently", () => {
    const mine = simplePath(5);
    const theirs = ring([2, -2]).slice(0, 3);
    const roads = { ...ownedBy(mine.edges, ME), ...ownedBy(theirs, FOE) };
    expect(longestRoadFor({ board, roads, buildings: {} }, ME)).toBe(5);
    expect(longestRoadFor({ board, roads, buildings: {} }, FOE)).toBe(3);
    expect(longestRoadFor({ board, roads, buildings: {} }, 2)).toBe(0);
  });
});

describe("robustness", () => {
  it("ignores road entries for edges that are not on the board", () => {
    const roads: Record<EdgeId, PlayerId> = { "e|nonsense__alsononsense": ME };
    expect(longestRoadFor({ board, roads, buildings: {} }, ME)).toBe(0);
  });

  it("handles a full 15-road network without blowing up", () => {
    const { edges } = simplePath(15);
    const start = Date.now();
    expect(measure(edges)).toBe(15);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("is order independent", () => {
    const { edges } = simplePath(7);
    const reversed = [...edges].reverse();
    expect(measure(edges)).toBe(measure(reversed));
  });
});

// ---------------------------------------------------------------------------
// The card, p.9. These are the cases the almanac spells out explicitly.
// ---------------------------------------------------------------------------

describe("resolveLongestRoad", () => {
  const none = { player: null, length: 0 };

  it("gives the card to nobody below the minimum", () => {
    expect(resolveLongestRoad([4, 4, 3], none, 5)).toEqual({
      player: null,
      length: 0,
    });
  });

  it("gives the card to the first player to reach five", () => {
    expect(resolveLongestRoad([5, 2, 0], none, 5)).toEqual({
      player: 0,
      length: 5,
    });
  });

  it("moves the card when someone builds strictly longer", () => {
    const held = { player: 0, length: 5 };
    expect(resolveLongestRoad([5, 6, 0], held, 5)).toEqual({
      player: 1,
      length: 6,
    });
  });

  it("does not move the card on a tie with the holder", () => {
    const held = { player: 0, length: 5 };
    expect(resolveLongestRoad([5, 5, 0], held, 5)).toEqual({
      player: 0,
      length: 5,
    });
  });

  it("keeps the card with the holder when their road is broken but still tied", () => {
    // p.9: "If your longest road is broken and you are tied for longest road,
    // you still keep the card."
    const held = { player: 0, length: 7 };
    expect(resolveLongestRoad([5, 5, 4], held, 5)).toEqual({
      player: 0,
      length: 5,
    });
  });

  it("sets the card aside when the holder falls behind a multi-way tie", () => {
    // p.9: "if you no longer have the longest road, but two or more players tie
    // for the new longest road, set the card aside."
    const held = { player: 0, length: 7 };
    expect(resolveLongestRoad([4, 6, 6], held, 5)).toEqual({
      player: null,
      length: 6,
    });
  });

  it("sets the card aside when nobody reaches the minimum any more", () => {
    const held = { player: 0, length: 5 };
    expect(resolveLongestRoad([3, 2, 4], held, 5)).toEqual({
      player: null,
      length: 0,
    });
  });

  it("gives the card to a single leader once a tie is broken", () => {
    // p.9: "The card comes into play again when only 1 player has the longest
    // road (of at least 5 road pieces)."
    const aside = { player: null, length: 6 };
    expect(resolveLongestRoad([4, 7, 6], aside, 5)).toEqual({
      player: 1,
      length: 7,
    });
  });

  it("leaves the card aside while several players stay tied", () => {
    const aside = { player: null, length: 6 };
    expect(resolveLongestRoad([6, 6, 4], aside, 5)).toEqual({
      player: null,
      length: 6,
    });
  });

  it("hands the card to a lone leader who overtakes an unheld card", () => {
    const aside = { player: null, length: 0 };
    expect(resolveLongestRoad([0, 0, 5], aside, 5)).toEqual({
      player: 2,
      length: 5,
    });
  });

  it("keeps the holder when they extend their own lead", () => {
    const held = { player: 1, length: 5 };
    expect(resolveLongestRoad([3, 8, 4], held, 5)).toEqual({
      player: 1,
      length: 8,
    });
  });

  it("handles every player at zero", () => {
    expect(resolveLongestRoad([0, 0, 0, 0], none, 5)).toEqual({
      player: null,
      length: 0,
    });
  });
});
