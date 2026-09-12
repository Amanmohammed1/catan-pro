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
import { seedRng, shuffle, type RngState } from "../rng/sfc32.js";
import type { Scenario } from "../scenario/types.js";
import type { TileId } from "../geometry/ids.js";
import {
  DEFAULT_CONFIG,
  DEV_DECK_COMPOSITION,
  emptyResources,
  type DevCardKind,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ResourceCounts,
} from "../state/types.js";
import { RESOURCE_KINDS } from "../state/types.js";

/** Rules p.2: 95 resource cards, 19 of each of the five types. */
export const BANK_PER_RESOURCE = 19;

export const DEFAULT_COLORS: readonly string[] = [
  "#d94f4f",
  "#3f7fd9",
  "#e8a13a",
  "#ffffff",
  "#37a169",
  "#8b5cf6",
];

export interface CreateGameOptions {
  readonly scenario: Scenario;
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly config?: Partial<GameConfig>;
}

function fullBank(): ResourceCounts {
  const bank = emptyResources();
  for (const kind of RESOURCE_KINDS) bank[kind] = BANK_PER_RESOURCE;
  return bank;
}

/** The 25-card development deck, shuffled. Rules p.2. */
export function buildDevDeck(rng: RngState): readonly [DevCardKind[], RngState] {
  const deck: DevCardKind[] = [];
  for (const [kind, count] of Object.entries(DEV_DECK_COMPOSITION)) {
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

  const { board, rng: afterBoard } = buildBoardGraph(scenario, seedRng(seed));
  const [devDeck, afterDeck] = buildDevDeck(afterBoard);

  const players = playerNames.map((name, index) => makePlayer(index, name, scenario));

  const order: PlayerId[] = players.map((seat) => seat.id);

  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    victoryPoints: scenario.victoryPoints,
    ...options.config,
  };

  return {
    scenarioId: scenario.id,
    board,
    config,
    rng: afterDeck,
    players,
    bank: fullBank(),
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
