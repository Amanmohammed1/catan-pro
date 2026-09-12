/**
 * pnpm fuzz — headless self-play, the M1 acceptance gate.
 *
 * Usage:
 *   pnpm fuzz                       10,000 games on the classic board
 *   pnpm fuzz --games 500           fewer, for a quick check
 *   pnpm fuzz --players 4
 *   pnpm fuzz --scenario tiny-island
 *   pnpm fuzz --fast                skip per-action invariant checks
 */

import { loadScenario } from "@hexport/scenarios";
import { runFuzz, FuzzFailure } from "./selfPlay.js";

interface Options {
  games: number;
  players: number;
  scenario: string;
  checkEvery: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    games: 10000,
    players: 4,
    scenario: "classic-3-4",
    checkEvery: true,
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
    process.stdout.write(`turns avg      ${avgTurns}\n`);
    process.stdout.write(
      `turns min/max  ${String(summary.shortestGame)} / ${String(summary.longestGame)}\n`,
    );
    process.stdout.write(`actions        ${String(summary.totalActions)}\n`);
    process.stdout.write(
      `elapsed        ${(summary.elapsedMs / 1000).toFixed(1)}s (${String(perSecond)} games/s)\n`,
    );
    process.stdout.write(`wins by seat   ${JSON.stringify(summary.wins)}\n`);

    if (summary.stalled > 0) {
      process.stderr.write(
        `\nFAIL: ${String(summary.stalled)} game(s) ended with no winner and no legal move.\n`,
      );
      process.exit(1);
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
