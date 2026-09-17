/**
 * Create a new game from a scenario and a seed.
 *
 * Rules p.12 (Set-up Phase): each player takes 5 settlements, 4 cities and
 * 15 roads; resources are sorted into stacks; the development deck is shuffled
 * face down; the robber starts in the desert.
 *
 * Determinism (golden rule 4): the board layout, the development deck order and
 * every later dice roll all come from the one seed threaded through RngState.
 */

import { buildBoardGraph } from "../geometry/buildBoardGraph.js";
import { BASE_SUPPLY, resolveModules, supplyFor, type Supply } from "../modules/index.js";
import { seedRng, shuffle, type RngState } from "../rng/sfc32.js";
import type { Scenario } from "../scenario/types.js";
import type { TileId } from "../geometry/ids.js";
import {
  DEFAULT_CONFIG,
  emptyResources,
  type DevCardKind,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ResourceCounts,
} from "../state/types.js";
import { RESOURCE_KINDS } from "../state/types.js";

/**
 * Rules p.2: 95 resource cards, 19 of each of the five types.
 *
 * The base game's figure. A scenario that loads an expansion module can bring a
 * bigger bank — the 5–6 extension adds five of each (5–6 rules 2022 p.4) — so
 * the live figure is `supplyFor(modules).bankPerResource`, not this constant.
 */
export const BANK_PER_RESOURCE = BASE_SUPPLY.bankPerResource;

/**
 * Seat colours: red, blue, orange, white, green, purple. Presentation data the
 * server passes through to clients; apps/web/src/three/palette.ts mirrors it.
 */
export const DEFAULT_COLORS: readonly string[] = [
  "#d8412f",
  "#2f6fd0",
  "#f08a24",
  "#f3eee2",
  "#3c9a4c",
  "#8d5bd0",
];

export interface CreateGameOptions {
  readonly scenario: Scenario;
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly config?: Partial<GameConfig>;
}

function fullBank(supply: Supply): ResourceCounts {
  const bank = emptyResources();
  for (const kind of RESOURCE_KINDS) bank[kind] = supply.bankPerResource;
  return bank;
}

/**
 * The development deck, shuffled. Rules p.2 for the base game's 25 cards; the
 * loaded modules decide the real composition.
 */
export function buildDevDeck(
  rng: RngState,
  supply: Supply = BASE_SUPPLY,
): readonly [DevCardKind[], RngState] {
  const deck: DevCardKind[] = [];
  for (const [kind, count] of Object.entries(supply.devDeck)) {
    for (let i = 0; i < count; i++) deck.push(kind as DevCardKind);
  }
  const [shuffled, next] = shuffle(rng, deck);
  return [shuffled, next];
}

function makePlayer(id: PlayerId, name: string, scenario: Scenario): PlayerState {
  return {
    id,
    name,
    color: DEFAULT_COLORS[id % DEFAULT_COLORS.length] as string,
    resources: emptyResources(),
    devCards: [],
    knightsPlayed: 0,
    pieces: {
      roads: scenario.pieces.roads,
      settlements: scenario.pieces.settlements,
      cities: scenario.pieces.cities,
    },
    playedDevCardThisTurn: false,
  };
}

/** The desert hex, where the robber starts (p.11). Falls back to any tile. */
export function startingRobberTile(tiles: GameState["board"]["tiles"]): TileId {
  const ids = Object.keys(tiles);
  const desert = ids.find((id) => tiles[id]?.terrain === "desert");
  if (desert !== undefined) return desert;
  const first = ids[0];
  if (first === undefined) {
    throw new Error("Cannot start a game on a board with no tiles.");
  }
  return first;
}

export function createGame(options: CreateGameOptions): GameState {
  const { scenario, seed, playerNames } = options;

  if (playerNames.length < scenario.players.min) {
    throw new Error(
      `Scenario "${scenario.id}" needs at least ${String(scenario.players.min)} players, got ${String(playerNames.length)}.`,
    );
  }
  if (playerNames.length > scenario.players.max) {
    throw new Error(
      `Scenario "${scenario.id}" supports at most ${String(scenario.players.max)} players, got ${String(playerNames.length)}.`,
    );
  }

  const modules = resolveModules(scenario.modules);
  const supply = supplyFor(modules);

  const { board, rng: afterBoard } = buildBoardGraph(scenario, seedRng(seed));
  const [devDeck, afterDeck] = buildDevDeck(afterBoard, supply);

  const players = playerNames.map((name, index) => makePlayer(index, name, scenario));

  const order: PlayerId[] = players.map((seat) => seat.id);

  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    modules: scenario.modules,
    victoryPoints: scenario.victoryPoints,
    ...options.config,
  };

  return {
    scenarioId: scenario.id,
    board,
    config,
    rng: afterDeck,
    players,
    bank: fullBank(supply),
    devDeck,
    buildings: {},
    roads: {},
    robber: startingRobberTile(board.tiles),
    // Rules p.12: round one runs in seat order, settlement then road.
    phase: {
      k: "setup",
      round: 1,
      order,
      idx: 0,
      sub: "settlement",
      lastSettlement: null,
    },
    currentPlayer: order[0] as PlayerId,
    turn: 0,
    dice: null,
    longestRoad: { player: null, length: 0 },
    largestArmy: { player: null, length: 0 },
    winner: null,
  };
}

/**
 * Whose placement it is during setup.
 *
 * Rules p.12: "After the starting player builds, the other players follow
 * counterclockwise, so the starting player in round one places their second
 * settlement last."
 */
export function setupPlayerAt(
  order: readonly PlayerId[],
  round: 1 | 2,
  idx: number,
): PlayerId {
  const seat = round === 1 ? order[idx] : order[order.length - 1 - idx];
  if (seat === undefined) {
    throw new Error(`Setup index ${String(idx)} is out of range.`);
  }
  return seat;
}
