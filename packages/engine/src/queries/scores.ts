/**
 * Victory points and the Largest Army card.
 *
 * Rules p.5, p.8 and the "Ending the Game" entry on p.7:
 *   settlement 1, city 2, Longest Road 2, Largest Army 2, victory point card 1.
 *
 * Victory point cards are hidden until they win the game (p.7), so scoring has
 * two flavours: what everyone can see, and the truth. Only the second decides a
 * winner, and only the server ever computes it.
 */

import type { GameState, PlayerId, SpecialCard } from "../state/types.js";

/** Points every player can see: buildings plus the two special cards. */
export function publicVictoryPoints(state: GameState, player: PlayerId): number {
  let points = 0;

  for (const building of Object.values(state.buildings)) {
    if (building.player !== player) continue;
    points += building.kind === "city" ? 2 : 1;
  }

  if (state.longestRoad.player === player) points += 2;
  if (state.largestArmy.player === player) points += 2;

  return points;
}

/** Hidden victory point development cards held by a player. */
export function victoryPointCards(state: GameState, player: PlayerId): number {
  const seat = state.players[player];
  if (seat === undefined) return 0;
  return seat.devCards.filter((card) => card.kind === "victoryPoint").length;
}

/**
 * True score, victory point cards included.
 *
 * Never send this for another player to a client; playerView() reports only
 * publicVictoryPoints for opponents.
 */
export function victoryPoints(state: GameState, player: PlayerId): number {
  return publicVictoryPoints(state, player) + victoryPointCards(state, player);
}

/**
 * Largest Army, p.8.
 *
 * "If you are the first player to play 3 knight cards, you receive this special
 *  card... If another player plays more knight cards than you have, they
 *  immediately take the special card."
 *
 * Note the asymmetry with Longest Road: this one has no set-aside case. The
 * holder keeps the card on a tie, because a challenger needs strictly *more*.
 */
export function resolveLargestArmy(
  knights: readonly number[],
  current: SpecialCard,
  minimum: number,
): SpecialCard {
  let max = 0;
  for (const count of knights) if (count > max) max = count;

  if (max < minimum) return { player: null, length: 0 };

  if (current.player !== null) {
    const held = knights[current.player] ?? 0;
    // Only a strictly larger army takes the card away.
    if (held >= max) return { player: current.player, length: held };
    for (let player = 0; player < knights.length; player++) {
      if (knights[player] === max) {
        return { player, length: max };
      }
    }
  }

  // No holder yet: the first player to reach the threshold takes it. When two
  // arrive at the same count, the lowest seat is first only because knights are
  // played one action at a time, so a genuine simultaneous tie cannot happen.
  for (let player = 0; player < knights.length; player++) {
    if (knights[player] === max) return { player, length: max };
  }

  return { player: null, length: 0 };
}

/** Public score for every seat, in seat order. */
export function publicScoreboard(state: GameState): number[] {
  return state.players.map((seat) => publicVictoryPoints(state, seat.id));
}

/**
 * The winner, if there is one.
 *
 * Rules p.7: "You can only win during your turn." The caller is responsible for
 * only asking on the active player's turn, which reduce() does after every
 * action that could change a score.
 */
export function findWinner(state: GameState, player: PlayerId): boolean {
  return victoryPoints(state, player) >= state.config.victoryPoints;
}
