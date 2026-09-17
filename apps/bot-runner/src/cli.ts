/**
 * pnpm fuzz — headless self-play, the M1 acceptance gate.
 *
 * Usage:
 *   pnpm fuzz                       10,000 games on the classic board
 *   pnpm fuzz --games 500           fewer, for a quick check
 *   pnpm fuzz --players 4
 *   pnpm fuzz --scenario tiny-island
 *   pnpm fuzz --max-actions 150000  raise the infinite-game cap
 *   pnpm fuzz --fast                skip per-action invariant checks
 *
 * The cap is worth knowing about on the bigger boards. Its default suits the
 * classic island, where a game averages about a thousand actions against a
 * twenty-thousand ceiling. A Seafarers game runs several times longer, so the
 * same ceiling leaves far less room and healthy games start hitting it.
 */

import { loadScenario } from "@hexport/scenarios";
import { runFuzz, FuzzFailure } from "./selfPlay.js";

interface Options {
  games: number;
  players: number;
  scenario: string;
  checkEvery: boolean;
  maxActions: number | undefined;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    games: 10000,
    players: 4,
    scenario: "classic-3-4",
    checkEvery: true,
    maxActions: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--games":
        options.games = Number(argv[++i]);
        break;
      case "--players":
        options.players = Number(argv[++i]);
        break;
      case "--scenario":
        options.scenario = String(argv[++i]);
        break;
      case "--max-actions":
        options.maxActions = Number(argv[++i]);
        break;
      case "--fast":
        options.checkEvery = false;
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(options.games) || options.games < 1) {
    throw new Error("--games must be a positive number");
  }
  if (
    options.maxActions !== undefined &&
    (!Number.isFinite(options.maxActions) || options.maxActions < 1)
  ) {
    throw new Error("--max-actions must be a positive number");
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scenario = loadScenario(options.scenario);

  process.stdout.write(
    `self-play: ${String(options.games)} games, ${String(options.players)} players, scenario "${options.scenario}"\n`,
  );

  let lastPercent = -1;

  try {
    const summary = runFuzz({
      scenario,
      games: options.games,
      playerCount: options.players,
      checkEvery: options.checkEvery,
      ...(options.maxActions === undefined ? {} : { maxActions: options.maxActions }),
      onProgress: (done, total) => {
        const percent = Math.floor((done / total) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          lastPercent = percent;
          process.stdout.write(`  ${String(percent)}% (${String(done)} games)\n`);
        }
      },
    });

    const avgTurns = (summary.totalTurns / summary.games).toFixed(1);
    const perSecond = Math.round(summary.games / (summary.elapsedMs / 1000));

    process.stdout.write("\n");
    process.stdout.write(`games          ${String(summary.games)}\n`);
    process.stdout.write(`stalled        ${String(summary.stalled)}\n`);
    process.stdout.write(`exhausted      ${String(summary.exhausted)}\n`);
    process.stdout.write(`turns avg      ${avgTurns}\n`);
    process.stdout.write(
      `turns min/max  ${String(summary.shortestGame)} / ${String(summary.longestGame)}\n`,
    );
    process.stdout.write(`actions        ${String(summary.totalActions)}\n`);
    process.stdout.write(
      `elapsed        ${(summary.elapsedMs / 1000).toFixed(1)}s (${String(perSecond)} games/s)\n`,
    );
    process.stdout.write(`wins by seat   ${JSON.stringify(summary.wins)}\n`);

    // A stall is a rules bug: legalMoves() offered nothing to the player whose
    // turn it was, and no amount of patience would finish the game.
    if (summary.stalled > 0) {
      process.stderr.write(
        `\nFAIL: ${String(summary.stalled)} game(s) had no legal move and no winner.\n`,
      );
      process.exit(1);
    }

    /**
     * Running out of actions is a different animal, and used to be reported as
     * a stall, which made a long game look like a broken one.
     *
     * A few are expected: random bots spend most of their moves trading with
     * the bank and shuffling ships, and a Seafarers scenario wants 14 points
     * rather than 10, so games run several times longer than on the classic
     * board. Measured at about 3% there, and none at all on classic.
     *
     * A large share is another matter — it would mean the game cannot reliably
     * be finished, which is what golden rule 8's "no infinite game" is really
     * asking about. Hence a threshold rather than either ignoring it or
     * failing on the first one.
     */
    const exhaustedShare = summary.exhausted / summary.games;
    if (exhaustedShare > 0.1) {
      process.stderr.write(
        `\nFAIL: ${String(summary.exhausted)} of ${String(summary.games)} games ` +
          `(${(exhaustedShare * 100).toFixed(1)}%) ran out of actions before anyone won.\n`,
      );
      process.exit(1);
    }
    if (summary.exhausted > 0) {
      process.stdout.write(
        `\nnote: ${String(summary.exhausted)} game(s) hit the action cap without a winner ` +
          `(${(exhaustedShare * 100).toFixed(1)}%, allowed up to 10%).\n`,
      );
    }

    process.stdout.write("\nfuzz clean\n");
  } catch (error) {
    if (error instanceof FuzzFailure) {
      process.stderr.write(`\nFAIL on seed "${error.seed}"\n`);
      process.stderr.write(`${error.message}\n`);
      if (error.action !== null) {
        process.stderr.write(`action: ${JSON.stringify(error.action)}\n`);
      }
      process.stderr.write(`phase:  ${JSON.stringify(error.state.phase)}\n`);
      process.stderr.write(
        `reproduce: pnpm fuzz --games 1 --scenario ${options.scenario} # seed ${error.seed}\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}

main();
