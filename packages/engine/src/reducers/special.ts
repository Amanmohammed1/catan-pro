/**
 * Recompute the two special cards and the win condition.
 *
 * Called after every action that can change them, because both cards move
 * "immediately" (p.4, p.8) rather than at any particular point in the turn.
 */

import { longestRouteLengths, resolveLongestRoad } from "../queries/longestRoad.js";
import { resolveLargestArmy, victoryPoints } from "../queries/scores.js";
import type { GameEvent } from "../events/types.js";
import type { GameState } from "../state/types.js";

export interface Recomputed {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Refresh Longest Road and Largest Army, emitting events when they move. */
export function recomputeSpecialCards(state: GameState): Recomputed {
  const events: GameEvent[] = [];

  const lengths = longestRouteLengths(
    {
      board: state.board,
      roads: state.roads,
      ships: state.ships,
      buildings: state.buildings,
    },
    state.players.length,
  );
  const longestRoad = resolveLongestRoad(
    lengths,
    state.longestRoad,
    state.config.minLongestRoad,
  );

  const knights = state.players.map((seat) => seat.knightsPlayed);
  const largestArmy = resolveLargestArmy(
    knights,
    state.largestArmy,
    state.config.minLargestArmy,
  );

  if (longestRoad.player !== state.longestRoad.player) {
    events.push({
      e: "longestRoadChanged",
      from: state.longestRoad.player,
      to: longestRoad.player,
      length: longestRoad.length,
    });
  }

  if (largestArmy.player !== state.largestArmy.player) {
    events.push({
      e: "largestArmyChanged",
      from: state.largestArmy.player,
      to: largestArmy.player,
      size: largestArmy.length,
    });
  }

  return { state: { ...state, longestRoad, largestArmy }, events };
}

/**
 * End the game if the active player has reached the target.
 *
 * Rules p.7: "You can only win during your turn. If somehow you find you have
 * 10 victory points during another player's turn, you must wait until your next
 * turn to claim victory." Only the player who just acted is checked, which
 * enforces that without any extra bookkeeping.
 */
export function checkVictory(state: GameState): Recomputed {
  if (state.winner !== null) return { state, events: [] };
  if (state.phase.k === "setup") return { state, events: [] };
  // A Special Building window is not your turn: reaching the target while
  // building in one does not win until your own turn comes round (ADR 0006).
  if (state.phase.k === "specialBuild") return { state, events: [] };

  const player = state.currentPlayer;
  const points = victoryPoints(state, player);
  if (points < state.config.victoryPoints) return { state, events: [] };

  return {
    state: {
      ...state,
      winner: player,
      phase: { k: "gameOver", winner: player },
    },
    events: [{ e: "gameEnded", winner: player, points }],
  };
}

/** Special cards, then the win check, in that order. */
export function settle(state: GameState): Recomputed {
  const cards = recomputeSpecialCards(state);
  const victory = checkVictory(cards.state);
  return {
    state: victory.state,
    events: [...cards.events, ...victory.events],
  };
}
