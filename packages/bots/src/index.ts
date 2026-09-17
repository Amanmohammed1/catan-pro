import type { Action, Phase } from "@hexport/engine";

/**
 * How a bot picks its move.
 *
 * One implementation, shared by the server's lobby bots and the headless
 * harness in apps/bot-runner, so "how a bot plays" cannot drift between the
 * game you play in the browser and the one the tools play.
 *
 * A bot chooses only from moves it was handed — `legalMoves` for its own seat —
 * so it can do nothing a player could not, and it is given no more of the game
 * state than a player would see. That is the whole safety argument: the policy
 * below cannot cheat because it has nothing to cheat with.
 *
 * Not in packages/engine, deliberately: the engine is pure and has no
 * randomness (CLAUDE.md golden rule 4), and a bot that plays the same move
 * every time in the same position is a worse opponent than one that does not.
 */

export interface BotSight {
  readonly phase: Phase;
  readonly legalMoves: readonly Action[];
}

/**
 * The move to play, or null when there is nothing to do.
 *
 * Shaped to keep a game moving rather than to be clever: build the expensive
 * things first, because a bot that spends everything on roads never scores;
 * never open a trade, because haggling with something that cannot evaluate an
 * offer wastes the table's time; decline offers politely.
 */
export function chooseMove(
  sight: BotSight,
  random: () => number = Math.random,
): Action | null {
  const moves = sight.legalMoves;
  if (moves.length === 0) return null;

  const find = (kind: Action["t"]): Action | undefined =>
    moves.find((move) => move.t === kind);
  const any = (): Action | null => moves[Math.floor(random() * moves.length)] ?? null;

  switch (sight.phase.k) {
    case "setup":
      // Spread out: a random legal corner beats always taking the first, which
      // would give every bot the same opening on the same board.
      return any();

    case "discard":
      return moves[0] ?? null;

    case "moveRobber":
    case "steal":
      return any();

    case "roadBuilding":
      return any();

    case "tradeOffer":
      return (
        moves.find((move) => move.t === "respondTrade" && !move.accept) ??
        find("cancelTrade") ??
        moves[0] ??
        null
      );

    case "specialBuild":
      return (
        find("buildCity") ??
        find("buildSettlement") ??
        find("buyDevCard") ??
        find("passSpecialBuild") ??
        null
      );

    case "roll":
      return find("playKnight") ?? find("rollDice") ?? null;

    case "main": {
      const build =
        find("buildCity") ??
        find("buildSettlement") ??
        find("buyDevCard") ??
        // Roads are worth it about half the time; always taking them starves
        // the settlements that actually score.
        (random() < 0.5 ? find("buildRoad") : undefined);
      if (build !== undefined) return build;

      const card =
        find("playKnight") ?? find("playRoadBuilding") ?? find("playYearOfPlenty");
      if (card !== undefined && random() < 0.4) return card;

      // Convert a surplus rather than sitting on it.
      if (random() < 0.35) {
        const trade = find("bankTrade");
        if (trade !== undefined) return trade;
      }

      return find("endTurn") ?? null;
    }

    default:
      return find("endTurn") ?? moves[0] ?? null;
  }
}

const NAMES: readonly string[] = ["Ada", "Basil", "Cleo", "Dara", "Emre", "Fen"];

/** A name for the nth bot at a table. */
export function botName(index: number): string {
  return NAMES[index % NAMES.length] ?? `Bot ${String(index + 1)}`;
}
