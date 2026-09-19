/**
 * Build the board graph from a scenario and a PRNG state.
 *
 * Runs once, at game creation. Every adjacency is precomputed and stored so no
 * hex math happens at runtime (CLAUDE.md, "Board geometry").
 *
 * Determinism (golden rule 4): the only entropy is the RngState passed in, and
 * the returned state is threaded back out. Same scenario plus same state gives a
 * byte-identical graph, which the test suite asserts by JSON comparison rather
 * than by eye.
 */

import {
  CORNER_INDICES,
  DIRECTION_INDICES,
  compareAxial,
  cornerHexes,
  edgeCornerIndices,
  neighbor,
  type Axial,
} from "./coords.js";
import {
  axialKey,
  edgeIdFromNodes,
  nodeIdAt,
  nodeIdFromHexes,
  tileId,
  type EdgeId,
  type NodeId,
  type TileId,
} from "./ids.js";
import type {
  BoardEdge,
  BoardGraph,
  BoardNode,
  EdgeKind,
  Port,
  PortId,
  Tile,
} from "./types.js";
import type { Scenario, ScenarioCell, SlotKind, Terrain } from "../scenario/types.js";
import { shuffle, type RngState } from "../rng/sfc32.js";

/** Numbers drawn in red on the board; the constraint below keeps them apart. */
const RED_NUMBERS: readonly number[] = [6, 8];

/**
 * How many reshuffles to try before giving up on the red-number constraint.
 * Deterministic: attempt N always uses the same state for a seed.
 *
 * Generous, because the difficulty varies enormously with the board. The
 * classic island clears the constraint about two attempts in five; the 5–6
 * board, with six red tokens drawn from a bag onto thirty denser hexes, clears
 * it about one in twenty-five — at 200 attempts roughly one game in two
 * thousand failed to lay a board at all. Attempts are cheap; a board that is
 * genuinely infeasible still fails loudly rather than shipping broken.
 */
const MAX_LAYOUT_ATTEMPTS = 2000;

export interface BuildBoardResult {
  readonly board: BoardGraph;
  readonly rng: RngState;
}

export class ScenarioError extends Error {
  public override readonly name = "ScenarioError";
}

/** Expand a bag's {terrain, count} entries into a flat, deterministic list. */
function expandBag(entries: readonly { terrain: Terrain; count: number }[]): Terrain[] {
  const out: Terrain[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry.count) || entry.count < 0) {
      throw new ScenarioError(
        `Bag entry for "${entry.terrain}" has a non-negative-integer count requirement, got ${String(entry.count)}`,
      );
    }
    for (let i = 0; i < entry.count; i++) {
      out.push(entry.terrain);
    }
  }
  return out;
}

/** Which bag fills a cell whose terrain is not pinned. */
function bagNameFor(cell: ScenarioCell): string {
  return cell.bag ?? cell.slot;
}

/**
 * Deal terrain into every cell, drawing from bags for cells that do not pin it.
 *
 * Cells are dealt in coordinate order so the mapping from a shuffled bag to the
 * board is fixed; the shuffle is the only thing that varies.
 */
function assignTerrain(
  scenario: Scenario,
  rng: RngState,
): readonly [Map<string, Terrain>, RngState] {
  const assigned = new Map<string, Terrain>();
  const needsDraw = new Map<string, ScenarioCell[]>();

  for (const cell of scenario.cells) {
    if (cell.terrain !== undefined) {
      assigned.set(axialKey(cell.coord), cell.terrain);
      continue;
    }
    const bag = bagNameFor(cell);
    const list = needsDraw.get(bag) ?? [];
    list.push(cell);
    needsDraw.set(bag, list);
  }

  let current = rng;

  for (const bagName of [...needsDraw.keys()].sort()) {
    const cells = (needsDraw.get(bagName) ?? [])
      .slice()
      .sort((a, b) => compareAxial(a.coord, b.coord));

    const bag = scenario.bags[bagName];
    if (bag === undefined) {
      throw new ScenarioError(
        `Cells reference bag "${bagName}" but the scenario defines no such bag.`,
      );
    }

    const contents = expandBag(bag.terrain);
    if (contents.length !== cells.length) {
      throw new ScenarioError(
        `Bag "${bagName}" holds ${String(contents.length)} tiles but ${String(cells.length)} cells draw from it.`,
      );
    }

    const [drawn, next] = shuffle(current, contents);
    current = next;

    for (let i = 0; i < cells.length; i++) {
      // Both arrays have the same length, checked above.
      assigned.set(axialKey((cells[i] as ScenarioCell).coord), drawn[i] as Terrain);
    }
  }

  return [assigned, current] as const;
}

/**
 * Lay number tokens along the scenario's path.
 *
 * Cells whose terrain is in skipTerrains are stepped over without consuming a
 * token, which is what makes a randomly placed desert shift the whole sequence.
 */
function assignNumbers(
  scenario: Scenario,
  terrain: Map<string, Terrain>,
  rng: RngState,
): readonly [Map<string, number>, RngState] {
  const byCoord = new Map<string, ScenarioCell>();
  for (const cell of scenario.cells) {
    byCoord.set(axialKey(cell.coord), cell);
  }

  // A `bag` scenario declares the tokens in the box; they are shuffled with the
  // game's own generator, so the same seed always lays the same board.
  let current = rng;
  let sequence: readonly number[];
  if (scenario.numbers.mode === "bag") {
    const drawn: number[] = [];
    for (const entry of scenario.numbers.tokens) {
      if (!Number.isInteger(entry.count) || entry.count < 0) {
        throw new ScenarioError(
          `Number bag entry ${String(entry.value)} has a bad count.`,
        );
      }
      for (let i = 0; i < entry.count; i++) drawn.push(entry.value);
    }
    const [shuffled, next] = shuffle(current, drawn);
    sequence = shuffled;
    current = next;
  } else {
    sequence = scenario.numbers.sequence;
  }

  const numbers = new Map<string, number>();
  const skip = new Set<Terrain>(scenario.numbers.skipTerrains);
  let tokenIndex = 0;

  for (const coord of scenario.numbers.path) {
    const key = axialKey(coord);
    const cell = byCoord.get(key);
    if (cell === undefined) {
      throw new ScenarioError(
        `Number path visits ${key}, which is not a cell in this scenario.`,
      );
    }

    const cellTerrain = terrain.get(key);
    if (cellTerrain === undefined || skip.has(cellTerrain)) {
      continue;
    }

    if (cell.number !== undefined) {
      numbers.set(key, cell.number);
      continue;
    }

    const token = sequence[tokenIndex];
    if (token === undefined) {
      throw new ScenarioError(
        `Number sequence has ${String(sequence.length)} tokens but the path needs more.`,
      );
    }
    numbers.set(key, token);
    tokenIndex++;
  }

  if (tokenIndex !== sequence.length) {
    throw new ScenarioError(
      `Number sequence has ${String(sequence.length)} tokens but only ${String(tokenIndex)} were placed.`,
    );
  }

  return [numbers, current] as const;
}

/** True when two tiles carrying red numbers share an edge. */
function violatesRedNumberRule(
  scenario: Scenario,
  numbers: Map<string, number>,
): boolean {
  const red = new Set(RED_NUMBERS);
  for (const cell of scenario.cells) {
    const key = axialKey(cell.coord);
    const value = numbers.get(key);
    if (value === undefined || !red.has(value)) {
      continue;
    }
    for (const dir of DIRECTION_INDICES) {
      const other = numbers.get(axialKey(neighbor(cell.coord, dir)));
      if (other !== undefined && red.has(other)) {
        return true;
      }
    }
  }
  return false;
}

/** Insert entries into a record in sorted key order, for stable serialization. */
function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out[key] = value;
  }
  return out;
}

/**
 * Classify an edge from the slots of the cells actually present beside it.
 *
 * Present land on both sides, or land on one side and nothing off-board, gives
 * a land edge — which is why the classic board, with no sea cells at all, is
 * entirely land edges and roads work everywhere. Land on one side and sea on
 * the other is coast, where Seafarers will allow both roads and ships.
 */
export function classifyEdge(slots: readonly SlotKind[]): EdgeKind {
  const hasLand = slots.includes("land");
  const hasSea = slots.includes("sea");

  // An unrevealed neighbour makes the edge coastal, because it may turn out to
  // be either (Seafarers p.8). This is forced rather than chosen: p.8's trigger
  // is "when you place a ship **or** road adjacent to an intersection with an
  // empty hex space". `canPlaceRoad` refuses a sea edge and `canPlaceShip`
  // refuses a land one, so calling fog either would make half of that rule
  // impossible to perform. Coast carries both.
  //
  // The edge is reclassified from real slots when the hex is turned face up,
  // which is part of what a reveal replaces (ADR 0009).
  if (slots.includes("fog")) return "coast";

  if (hasLand && hasSea) return "coast";
  if (hasSea) return "sea";
  return "land";
}

/**
 * Turn a face-down hex face up, returning the board that results.
 *
 * The Fog Islands fills an empty space the moment a player builds beside it
 * (Seafarers p.8). Everywhere else the board is built once at game creation and
 * never touched again — CLAUDE.md says so plainly — so this is the single
 * sanctioned exception, and ADR 0009 records why it is safe.
 *
 * What changes is deliberately narrow: the tile's slot, terrain and number, and
 * the classification of the six edges it touches. An edge beside an unrevealed
 * hex is coastal because the hex might turn out to be either; once it is known,
 * the edge is whatever the real slots say. That reclassification is the part
 * easy to forget, and it matters — a fog space revealing as sea turns its edges
 * from road-and-ship into ship-only.
 *
 * No id changes. No node or edge is added or removed, and no adjacency moves,
 * so every id already written to the event log still means exactly what it
 * meant when it was written (ADR 0001). That property is the whole reason
 * replacing the board is sound rather than reckless.
 */
export function revealHex(
  board: BoardGraph,
  tile: TileId,
  terrain: Terrain,
  number: number | null,
): BoardGraph {
  const existing = board.tiles[tile];
  if (existing === undefined) {
    throw new ScenarioError(`Cannot reveal "${tile}": no such tile on this board.`);
  }

  const tiles: Record<TileId, Tile> = {
    ...board.tiles,
    [tile]: { ...existing, slot: terrain === "sea" ? "sea" : "land", terrain, number },
  };

  const edges: Record<EdgeId, BoardEdge> = { ...board.edges };
  for (const edgeId of existing.edges) {
    const edge = edges[edgeId];
    if (edge === undefined) continue;
    const slots = edge.tiles
      .map((id) => tiles[id]?.slot)
      .filter((slot): slot is SlotKind => slot !== undefined);
    edges[edgeId] = { ...edge, kind: classifyEdge(slots) };
  }

  return { ...board, tiles, edges };
}

export function buildBoardGraph(scenario: Scenario, rng: RngState): BuildBoardResult {
  // ---- cells -------------------------------------------------------------
  const cellByKey = new Map<string, ScenarioCell>();
  for (const cell of scenario.cells) {
    const key = axialKey(cell.coord);
    if (cellByKey.has(key)) {
      throw new ScenarioError(`Duplicate cell at ${key}.`);
    }
    cellByKey.set(key, cell);
  }
  if (cellByKey.size === 0) {
    throw new ScenarioError("A scenario needs at least one cell.");
  }

  // ---- terrain and numbers, retried until the red-number rule holds -------
  let current = rng;
  let terrain: Map<string, Terrain> | null = null;
  let numbers: Map<string, number> | null = null;
  const enforceRed = scenario.numbers.constraints?.noAdjacentRedNumbers === true;

  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const [candidateTerrain, next] = assignTerrain(scenario, current);
    current = next;
    const [candidateNumbers, afterNumbers] = assignNumbers(
      scenario,
      candidateTerrain,
      current,
    );
    current = afterNumbers;

    if (!enforceRed || !violatesRedNumberRule(scenario, candidateNumbers)) {
      terrain = candidateTerrain;
      numbers = candidateNumbers;
      break;
    }
  }

  if (terrain === null || numbers === null) {
    throw new ScenarioError(
      `Could not satisfy the red-number constraint in ${String(MAX_LAYOUT_ATTEMPTS)} attempts for scenario "${scenario.id}".`,
    );
  }

  // ---- tiles, and the corners and edges they touch ------------------------
  const tiles = new Map<TileId, Tile>();
  const nodeTiles = new Map<NodeId, Set<TileId>>();
  const nodeEdges = new Map<NodeId, Set<EdgeId>>();
  const edgeTiles = new Map<EdgeId, Set<TileId>>();
  const edgeNodes = new Map<EdgeId, readonly [NodeId, NodeId]>();
  const edgeSlots = new Map<EdgeId, SlotKind[]>();

  const orderedCells = [...scenario.cells].sort((a, b) =>
    compareAxial(a.coord, b.coord),
  );

  for (const cell of orderedCells) {
    const key = axialKey(cell.coord);
    const id = tileId(cell.coord);

    const cornerIds = CORNER_INDICES.map((corner) => nodeIdAt(cell.coord, corner));
    const edgeIds = DIRECTION_INDICES.map((dir) => {
      const [ca, cb] = edgeCornerIndices(dir);
      return edgeIdFromNodes(nodeIdAt(cell.coord, ca), nodeIdAt(cell.coord, cb));
    });

    tiles.set(id, {
      id,
      coord: cell.coord,
      slot: cell.slot,
      terrain: terrain.get(key) ?? "sea",
      number: numbers.get(key) ?? null,
      island: cell.island ?? null,
      nodes: cornerIds,
      edges: edgeIds,
    });

    for (const nodeId of cornerIds) {
      const set = nodeTiles.get(nodeId) ?? new Set<TileId>();
      set.add(id);
      nodeTiles.set(nodeId, set);
    }

    for (const dir of DIRECTION_INDICES) {
      const edgeId = edgeIds[dir] as EdgeId;
      const [ca, cb] = edgeCornerIndices(dir);
      const a = nodeIdAt(cell.coord, ca);
      const b = nodeIdAt(cell.coord, cb);

      edgeNodes.set(edgeId, a < b ? [a, b] : [b, a]);

      const tset = edgeTiles.get(edgeId) ?? new Set<TileId>();
      tset.add(id);
      edgeTiles.set(edgeId, tset);

      const slots = edgeSlots.get(edgeId) ?? [];
      slots.push(cell.slot);
      edgeSlots.set(edgeId, slots);

      for (const endpoint of [a, b]) {
        const eset = nodeEdges.get(endpoint) ?? new Set<EdgeId>();
        eset.add(edgeId);
        nodeEdges.set(endpoint, eset);
      }
    }
  }

  // ---- edges --------------------------------------------------------------
  const edges = new Map<EdgeId, BoardEdge>();
  for (const [edgeId, endpoints] of edgeNodes) {
    edges.set(edgeId, {
      id: edgeId,
      kind: classifyEdge(edgeSlots.get(edgeId) ?? []),
      nodes: endpoints,
      tiles: [...(edgeTiles.get(edgeId) ?? new Set<TileId>())].sort(),
    });
  }

  // ---- ports --------------------------------------------------------------
  const ports = new Map<PortId, Port>();
  const nodePort = new Map<NodeId, PortId>();

  scenario.ports.forEach((port, index) => {
    const [ca, cb] = edgeCornerIndices(port.edgeDir);
    const a = nodeIdAt(port.at, ca);
    const b = nodeIdAt(port.at, cb);
    const edgeId = edgeIdFromNodes(a, b);

    if (!edges.has(edgeId)) {
      throw new ScenarioError(
        `Port ${String(index)} is anchored to ${axialKey(port.at)} direction ${String(port.edgeDir)}, which is not an edge on this board.`,
      );
    }
    if (port.kind === "resource" && port.resource === undefined) {
      throw new ScenarioError(
        `Port ${String(index)} is a resource port but names no resource.`,
      );
    }

    const id: PortId = `p|${axialKey(port.at)}|${String(port.edgeDir)}`;
    if (ports.has(id)) {
      throw new ScenarioError(`Duplicate port at ${id}.`);
    }

    const endpoints: readonly [NodeId, NodeId] = a < b ? [a, b] : [b, a];
    ports.set(id, {
      id,
      kind: port.kind,
      resource: port.resource ?? null,
      ratio: port.ratio,
      edge: edgeId,
      nodes: endpoints,
    });
    for (const endpoint of endpoints) {
      nodePort.set(endpoint, id);
    }
  });

  // ---- nodes --------------------------------------------------------------
  const nodes = new Map<NodeId, BoardNode>();
  for (const [nodeId, tileSet] of nodeTiles) {
    const incident = [...(nodeEdges.get(nodeId) ?? new Set<EdgeId>())].sort();
    const adjacent = new Set<NodeId>();
    for (const edgeId of incident) {
      const endpoints = edgeNodes.get(edgeId);
      if (endpoints === undefined) continue;
      adjacent.add(endpoints[0] === nodeId ? endpoints[1] : endpoints[0]);
    }
    adjacent.delete(nodeId);

    nodes.set(nodeId, {
      id: nodeId,
      tiles: [...tileSet].sort(),
      nodes: [...adjacent].sort(),
      edges: incident,
      port: nodePort.get(nodeId) ?? null,
    });
  }

  const board: BoardGraph = {
    scenarioId: scenario.id,
    orientation: scenario.layout.orientation,
    tiles: sortedRecord(tiles),
    nodes: sortedRecord(nodes),
    edges: sortedRecord(edges),
    ports: sortedRecord(ports),
  };

  return { board, rng: current };
}

/** Convenience wrapper for callers that only have a seed string. */
export function buildBoardFromSeed(
  scenario: Scenario,
  seed: string,
  seedRng: (seed: string) => RngState,
): BoardGraph {
  return buildBoardGraph(scenario, seedRng(seed)).board;
}

/** All hex positions meeting at a node, whether or not a tile occupies them. */
export function nodeCorners(hex: Axial): readonly NodeId[] {
  return CORNER_INDICES.map((corner) => nodeIdFromHexes(cornerHexes(hex, corner)));
}
