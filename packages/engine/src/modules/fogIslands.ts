/**
 * The Fog Islands.
 *
 * Rule references are to the 2025 Seafarers rulebook in docs/rules/, p.8–9.
 * ADR 0009 records the decisions this module forced.
 *
 * The scenario deals part of its board face down. Spaces start empty, and one
 * is filled the moment a player builds beside it:
 *
 *   "When you place a ship or road adjacent to an intersection with an empty
 *    hex space, you discover a new location. Take the top hex from the facedown
 *    stack and place it face up in the empty space. If it is a land hex, take a
 *    random number disc from the facedown pile and place it on the hex. Take 1
 *    resource card of the type produced by that hex. If the new hex is a sea
 *    hex, do not place a number disc and do not take a resource." (p.8)
 *
 * This is the only rule in the project that changes the board after it is
 * built, which is why it needed its own hook and its own ADR.
 */

import { revealHex } from "../geometry/buildBoardGraph.js";
import { tileId } from "../geometry/ids.js";
import {
  addResources,
  singleResource,
  subtractResources,
  withPlayer,
} from "../state/helpers.js";
import { TERRAIN_RESOURCE, type Terrain } from "../scenario/types.js";
import type { TileId } from "../geometry/ids.js";
import type { GameEvent } from "../events/types.js";
import type { GameState, HiddenStackState, PlayerId } from "../state/types.js";
import type { ModuleEffect, ModuleState, RuleModule } from "./types.js";

/**
 * This scenario's slice of state.
 *
 * Only the part the board cannot answer. Which spaces are still hidden is not
 * here — a tile whose terrain reads `fog` is unrevealed, and duplicating that
 * would be a second copy to keep in step (the same reasoning ADR 0008 applied
 * to island victory points). What the board genuinely cannot say is which
 * face-down pile a given space draws from, because that is scenario data and
 * the engine cannot read a scenario at runtime (golden rule 1).
 */
export interface FogIslandsState extends ModuleState {
  readonly m: "fogIslands";
  readonly stackOf: Readonly<Record<TileId, string>>;
}

/** Narrow a module state slice to this module's own. */
export function fogIslandsStateOf(state: GameState): FogIslandsState | null {
  const slice = state.moduleState["fogIslands"];
  if (slice === undefined || slice.m !== "fogIslands") return null;
  return slice as FogIslandsState;
}

/** The edge an action put a piece on, or null if it placed none. */
function placedEdge(action: { readonly t: string; readonly edge?: string }): string | null {
  // p.8 says "a ship or road", and says nothing about settlements, so only the
  // three actions that lay an edge piece can uncover anything. `setupRoad` is
  // included deliberately: a setup road is still a road being placed.
  if (action.t === "buildRoad" || action.t === "buildShip" || action.t === "setupRoad") {
    return action.edge ?? null;
  }
  return null;
}

/**
 * Every unrevealed hex this edge has just brought a player next to.
 *
 * p.8 keys off the *intersection*, not the edge: "adjacent to an intersection
 * with an empty hex space". An edge has two intersections and each touches up
 * to three hexes, so one placement can uncover several at once. Sorted, because
 * the order decides which hex comes off the stack and the whole game has to
 * follow from the seed (golden rule 4).
 */
function fogTilesBeside(state: GameState, edge: string): TileId[] {
  const graph = state.board.edges[edge];
  if (graph === undefined) return [];

  const found = new Set<TileId>();
  for (const nodeId of graph.nodes) {
    for (const tile of state.board.nodes[nodeId]?.tiles ?? []) {
      if (state.board.tiles[tile]?.terrain === "fog") found.add(tile);
    }
  }
  return [...found].sort();
}

/** Take the top hex, and a disc if it is land. Returns what was drawn. */
function draw(
  stack: HiddenStackState,
  terrain: Terrain,
): { readonly number: number | null; readonly rest: HiddenStackState } {
  // p.8: only a land hex takes a disc. A sea hex takes none — and the pile is
  // sized on that assumption, so drawing one anyway would run it short.
  if (terrain === "sea") {
    return { number: null, rest: { ...stack, contents: stack.contents.slice(1) } };
  }
  return {
    number: stack.numbers[0] ?? null,
    rest: {
      ...stack,
      contents: stack.contents.slice(1),
      numbers: stack.numbers.slice(1),
    },
  };
}

/**
 * Pay the finder for what they uncovered.
 *
 * p.8: "Take 1 resource card of the type produced by that hex." Sea pays
 * nothing, and neither does gold — see the note on the module below.
 */
function payFinder(
  state: GameState,
  player: PlayerId,
  terrain: Terrain,
): { readonly state: GameState; readonly resource: ReturnType<typeof resourceFor> } {
  const resource = resourceFor(terrain);
  if (resource === null) return { state, resource: null };

  // Rules p.10: the bank can run dry, and a card it cannot pay is simply not
  // paid. Taking one anyway would break resource conservation, which the
  // invariants check after every action.
  if (state.bank[resource] <= 0) return { state, resource: null };

  const card = singleResource(resource);
  const paid: GameState = {
    ...state,
    players: withPlayer(state, player, (seat) => ({
      ...seat,
      resources: addResources(seat.resources, card),
    })),
    bank: subtractResources(state.bank, card),
  };
  return { state: paid, resource };
}

function resourceFor(terrain: Terrain) {
  return TERRAIN_RESOURCE[terrain];
}

export const fogIslandsModule: RuleModule = {
  id: "fogIslands",

  setupState: (ctx): FogIslandsState => {
    const stackOf: Record<TileId, string> = {};
    for (const stack of ctx.scenario.hiddenStacks) {
      for (const coord of stack.cells) stackOf[tileId(coord)] = stack.id;
    }
    return { m: "fogIslands", stackOf };
  },

  /**
   * Uncover every empty space the placement has just reached (p.8).
   *
   * Runs after the action was accepted, because a hex is revealed by a piece
   * that is actually on the board — `interceptAction` sees the move before it
   * is judged and could not tell a legal placement from a refused one.
   *
   * Every adjacent space is revealed, not one: a road or ship has two
   * intersections and can reach several at once, and the rulebook's singular
   * "the empty space" does not say which would be skipped. Revealing all of
   * them keeps the outcome a function of the seed, with no player choice to
   * enumerate and no tie-break to invent.
   */
  afterAction: (state, action): ModuleEffect | null => {
    const edge = placedEdge(action);
    if (edge === null) return null;

    const hidden = fogTilesBeside(state, edge);
    if (hidden.length === 0) return null;

    const fog = fogIslandsStateOf(state);
    if (fog === null) return null;

    let current = state;
    const events: GameEvent[] = [];

    for (const tile of hidden) {
      const stackId = fog.stackOf[tile];
      if (stackId === undefined) continue;

      const stack = current.hiddenStacks[stackId];
      const terrain = stack?.contents[0];
      // An exhausted pile leaves the space empty rather than throwing: the
      // composition is meant to cover every space, but a scenario that got that
      // wrong should misdeal a board, not crash a live game.
      if (stack === undefined || terrain === undefined) continue;

      const { number, rest } = draw(stack, terrain);
      const revealed: GameState = {
        ...current,
        board: revealHex(current.board, tile, terrain, number),
        hiddenStacks: { ...current.hiddenStacks, [stackId]: rest },
      };

      const { state: paid, resource } = payFinder(revealed, action.player, terrain);
      current = paid;

      events.push({
        e: "hexRevealed",
        player: action.player,
        tile,
        terrain,
        number,
        resource,
      });
    }

    if (events.length === 0) return null;
    return { state: current, events };
  },
};
