/**
 * Seafarers.
 *
 * Rule references are to the 2025 Seafarers rulebook in docs/rules/. ADR 0008
 * records what is implemented and what is deliberately left out.
 *
 * This module owns the ship: the piece, its two actions, and the state that
 * goes with them. Nothing in the base game changed to accommodate it —
 * `reduce()` consults the loaded modules for any action kind its own switch
 * does not handle, which is what golden rule 7 asks for (ADR 0007).
 */

import {
  canMoveShip,
  canPlaceShip,
  shipMoves,
  shipSpots,
} from "../queries/placement.js";
import { addResources, canAfford, subtractResources } from "../state/helpers.js";
import { COSTS, type GameState, type PlayerId } from "../state/types.js";
import type { Action } from "../actions/types.js";
import type { ModuleEffect, ModuleState, RuleModule } from "./types.js";

/**
 * Seafarers' slice of the game state.
 *
 * `settledIslands` drives the island victory points: p.4 pays 2 VP for each
 * player's *first* settlement on a small island, and "it does not matter if
 * other players have already built settlements on that island", so the record
 * is per player rather than global.
 */
export interface SeafarersState extends ModuleState {
  readonly m: "seafarers";
  readonly settledIslands: Readonly<Record<PlayerId, readonly string[]>>;
}

/** Narrow a module state slice to this module's own. */
export function seafarersStateOf(state: GameState): SeafarersState | null {
  const slice = state.moduleState["seafarers"];
  if (slice === undefined || slice.m !== "seafarers") return null;
  return slice as SeafarersState;
}

/**
 * Whether this player may build right now.
 *
 * The same two doors the base game's building actions use: it is your turn and
 * you are past the roll, or you hold an open Special Building window. Kept
 * local rather than imported because `reduce()` does not export it, and a
 * module reaching into the reducer's internals is the coupling this interface
 * exists to avoid.
 */
function whyNotBuilding(state: GameState, player: PlayerId): string | null {
  const phase = state.phase;
  if (phase.k === "main") {
    return state.currentPlayer === player ? null : "Not your turn.";
  }
  if (phase.k === "specialBuild") {
    return phase.queue[0] === player ? null : "Not your building window.";
  }
  return "You cannot build right now.";
}

export const seafarersModule: RuleModule = {
  id: "seafarers",

  setupState: (ctx): SeafarersState => ({
    m: "seafarers",
    settledIslands: Object.fromEntries(ctx.players.map((player) => [player, []])),
  }),

  extraLegalMoves: (state, player): Action[] => {
    // Ships are built and moved in the Action phase (p.2). A Special Building
    // window is not one, and the base game's own build actions are what that
    // window offers.
    if (state.phase.k !== "main") return [];
    if (state.currentPlayer !== player) return [];

    const seat = state.players[player];
    if (seat === undefined) return [];

    const out: Action[] = [];

    if (canAfford(seat.resources, COSTS.ship)) {
      for (const edge of shipSpots(state, player)) {
        out.push({ t: "buildShip", player, edge });
      }
    }

    for (const move of shipMoves(state, player)) {
      out.push({ t: "moveShip", player, from: move.from, to: move.to });
    }

    return out;
  },

  reducers: {
    buildShip: (state, action): ModuleEffect | ReturnType<typeof refuse> | null => {
      if (action.t !== "buildShip") return null;

      const refusal = whyNotBuilding(state, action.player);
      if (refusal !== null) return refuse(action, refusal);

      const seat = state.players[action.player];
      if (seat === undefined) return refuse(action, "No such player.");

      if (!canPlaceShip(state, action.player, action.edge)) {
        return refuse(action, "Illegal ship placement.");
      }
      if (!canAfford(seat.resources, COSTS.ship)) {
        return refuse(action, "You cannot afford a ship.");
      }

      const next: GameState = {
        ...state,
        bank: addResources(state.bank, COSTS.ship),
        players: state.players.map((s) =>
          s.id === action.player
            ? {
                ...s,
                resources: subtractResources(s.resources, COSTS.ship),
                pieces: { ...s.pieces, ships: s.pieces.ships - 1 },
              }
            : s,
        ),
        ships: {
          ...state.ships,
          [action.edge]: { player: action.player, builtOnTurn: state.turn },
        },
      };

      return {
        state: next,
        events: [
          { e: "builtShip", player: action.player, edge: action.edge, free: false },
        ],
      };
    },

    moveShip: (state, action): ModuleEffect | ReturnType<typeof refuse> | null => {
      if (action.t !== "moveShip") return null;

      const refusal = whyNotBuilding(state, action.player);
      if (refusal !== null) return refuse(action, refusal);

      if (!canMoveShip(state, action.player, action.from, action.to)) {
        return refuse(action, "That ship cannot move there.");
      }

      const moved = { ...state.ships };
      const ship = moved[action.from];
      if (ship === undefined) return refuse(action, "No ship there.");
      delete moved[action.from];
      moved[action.to] = ship;

      const next: GameState = {
        ...state,
        ships: moved,
        players: state.players.map((s) =>
          s.id === action.player ? { ...s, movedShipThisTurn: true } : s,
        ),
      };

      return {
        state: next,
        events: [
          { e: "shipMoved", player: action.player, from: action.from, to: action.to },
        ],
      };
    },
  },
};

/** A refusal in the shape `reduce()` expects back from a module. */
function refuse(action: Action, reason: string) {
  return { ok: false as const, reason, action };
}
