/**
 * Shared scaffolding for the rules tests.
 *
 * Not exported from the package index: this exists so rule tests can set up a
 * precise board position in a few lines instead of playing thirty turns to
 * reach it.
 */

import { buildBoardGraph } from "../geometry/buildBoardGraph.js";
import { seedRng } from "../rng/sfc32.js";
import { createGame } from "../setup/createGame.js";
import { reduce, type ReduceResult } from "./reduce.js";
import { nextInt, nextU32 } from "../rng/sfc32.js";
import { legalMoves } from "../queries/legalMoves.js";
import { assertInvariants } from "../state/invariants.js";
import type { Action } from "../actions/types.js";
import type { Axial } from "../geometry/coords.js";
import type { Scenario, ScenarioCell, Terrain } from "../scenario/types.js";
import type { GameState, PlayerId, ResourceCounts } from "../state/types.js";
import { emptyResources, RESOURCE_KINDS } from "../state/types.js";

export function disc(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r++) out.push([q, r]);
  }
  return out;
}

/**
 * A predictable board: every hex a known terrain and number, so a test can say
 * "roll a 5 and player 0 should gain one lumber" without hunting for a hex.
 */
export function fixedScenario(options?: {
  readonly terrains?: readonly Terrain[];
  readonly numbers?: readonly number[];
  readonly radius?: number;
}): Scenario {
  const radius = options?.radius ?? 2;
  const coords = disc(radius);
  const terrains = options?.terrains;
  const numbers = options?.numbers;

  // Terrain is pinned so tests can name a hex; numbers come from the token
  // sequence rather than being pinned per cell, because a cell that pins its
  // own number consumes no token and the two would contradict each other.
  const cells: ScenarioCell[] = coords.map((coord, i) => ({
    coord,
    slot: "land" as const,
    terrain: (terrains === undefined
      ? "forest"
      : terrains[i % terrains.length]) as Terrain,
  }));

  const skip = new Set<Terrain>(["desert", "sea"]);
  const sequence = cells
    .filter((cell) => !skip.has(cell.terrain as Terrain))
    .map((_, i) =>
      numbers === undefined ? (i % 10) + 2 : (numbers[i % numbers.length] as number),
    );

  return {
    id: "fixed-test",
    name: "Fixed Test Board",
    schemaVersion: 1,
    players: { min: 2, max: 4 },
    victoryPoints: 10,
    modules: ["base"],
    layout: { orientation: "pointy" },
    cells,
    bags: {},
    numbers: {
      mode: "path",
      sequence,
      path: coords,
      skipTerrains: ["desert", "sea"],
    },
    ports: [],
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [],
    hiddenStacks: [],
    startingPieces: [],
  };
}

export function newGame(
  playerCount = 3,
  scenario: Scenario = fixedScenario(),
  seed = "test",
): GameState {
  return createGame({
    scenario,
    seed,
    playerNames: Array.from({ length: playerCount }, (_, i) => `P${String(i)}`),
  });
}

/** Board graph on its own, for geometry-only assertions. */
export function boardOf(scenario: Scenario = fixedScenario()) {
  return buildBoardGraph(scenario, seedRng("board")).board;
}

/** Apply an action and fail loudly if it was rejected. */
export function apply(state: GameState, action: Action): GameState {
  const result = reduce(state, action);
  if (!result.ok) {
    throw new Error(`Action ${action.t} rejected: ${result.reason}`);
  }
  assertInvariants(result.state, action.t);
  return result.state;
}

/** Apply and return the full result, for tests that assert on events. */
export function applyResult(state: GameState, action: Action): ReduceResult {
  return reduce(state, action);
}

/** Hand a player exactly these resources, taking them from the bank. */
export function giveResources(
  state: GameState,
  player: PlayerId,
  resources: Partial<ResourceCounts>,
): GameState {
  const grant = { ...emptyResources(), ...resources };
  const bank = { ...state.bank };
  for (const kind of RESOURCE_KINDS) bank[kind] -= grant[kind];

  return {
    ...state,
    bank,
    players: state.players.map((seat) =>
      seat.id === player
        ? {
            ...seat,
            resources: {
              brick: seat.resources.brick + grant.brick,
              lumber: seat.resources.lumber + grant.lumber,
              wool: seat.resources.wool + grant.wool,
              grain: seat.resources.grain + grant.grain,
              ore: seat.resources.ore + grant.ore,
            },
          }
        : seat,
    ),
  };
}

/** Strip a player's hand back to nothing, returning the cards to the bank. */
export function clearResources(state: GameState, player: PlayerId): GameState {
  const seat = state.players[player];
  if (seat === undefined) return state;
  const bank = { ...state.bank };
  for (const kind of RESOURCE_KINDS) bank[kind] += seat.resources[kind];

  return {
    ...state,
    bank,
    players: state.players.map((s) =>
      s.id === player ? { ...s, resources: emptyResources() } : s,
    ),
  };
}

/**
 * Play through the whole setup phase, picking the first legal option each time.
 * Leaves the game in the `roll` phase on turn 1.
 */
export function completeSetup(state: GameState): GameState {
  let current = state;
  let guard = 0;

  while (current.phase.k === "setup") {
    if (guard++ > 200) throw new Error("Setup did not terminate.");
    const active = current.currentPlayer;
    const moves = legalMoves(current, active);
    const move = moves[0];
    if (move === undefined) {
      throw new Error(`No legal setup move for player ${String(active)}.`);
    }
    current = apply(current, move);
  }

  return current;
}

/** Force the game into the main phase for the given player, no dice involved. */
export function intoMainPhase(state: GameState, player: PlayerId = 0): GameState {
  return {
    ...state,
    phase: { k: "main" },
    currentPlayer: player,
    turn: Math.max(state.turn, 1),
  };
}

/**
 * Roll a specific total without playing extra turns to get there.
 *
 * Searches forward through the generator for a state whose next two draws give
 * the wanted total, then rolls once from there. Rolling repeatedly until the
 * number comes up would also work, but every discarded attempt pays out
 * production, which quietly changes the hands the test is trying to control.
 */
export function forceRoll(state: GameState, total: number): GameState {
  let rng = state.rng;
  for (let i = 0; i < 20000; i++) {
    const [a, afterA] = nextInt(rng, 6);
    const [b] = nextInt(afterA, 6);
    if (a + b + 2 === total) {
      const result = reduce(
        { ...state, rng },
        { t: "rollDice", player: state.currentPlayer },
      );
      if (!result.ok) throw new Error(result.reason);
      return result.state;
    }
    rng = nextU32(rng)[1];
  }
  throw new Error(`Could not find a generator state rolling ${String(total)}.`);
}

/** Put the robber somewhere that is not one of `avoid`. */
export function robberAway(state: GameState, avoid: readonly string[]): GameState {
  const spot = Object.keys(state.board.tiles).find((id) => !avoid.includes(id));
  if (spot === undefined) throw new Error("Nowhere to put the robber.");
  return { ...state, robber: spot };
}

/** Empty every player's hand, returning the cards to the bank. */
export function clearAllResources(state: GameState): GameState {
  let current = state;
  for (const seat of state.players) current = clearResources(current, seat.id);
  return current;
}
