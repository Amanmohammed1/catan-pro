/**
 * The random-legal bot.
 *
 * It knows no strategy at all: it asks legalMoves() what it may do and picks
 * one. That is exactly what makes it useful as a fuzzer — it explores states a
 * thinking player would never reach, which is where rules bugs hide.
 *
 * CLAUDE.md golden rule 3 in practice: the bot has no rules knowledge of its
 * own, so if legalMoves() is wrong the fuzzer finds it.
 */

import {
  legalMoves,
  nextInt,
  type Action,
  type GameState,
  type PlayerId,
  type RngState,
} from "@hexport/engine";

export interface Choice {
  readonly action: Action;
  readonly rng: RngState;
}

/** Every (player, action) pair that is legal right now. */
export function allLegalMoves(state: GameState): Action[] {
  const out: Action[] = [];
  for (const seat of state.players) {
    out.push(...legalMoves(state, seat.id));
  }
  return out;
}

/**
 * Pick one legal action uniformly at random.
 *
 * The bot carries its own generator so it never disturbs the game's, which
 * would make a replay of the same seed diverge.
 */
export function chooseAction(state: GameState, rng: RngState): Choice | null {
  const moves = allLegalMoves(state);
  if (moves.length === 0) return null;

  const [index, next] = nextInt(rng, moves.length);
  return { action: moves[index] as Action, rng: next };
}

/** Seats that currently have something to do. Used for diagnostics. */
export function activePlayers(state: GameState): PlayerId[] {
  return state.players
    .filter((seat) => legalMoves(state, seat.id).length > 0)
    .map((seat) => seat.id);
}
