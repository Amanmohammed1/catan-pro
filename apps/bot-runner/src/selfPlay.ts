/**
 * Headless self-play.
 *
 * CLAUDE.md: "A milestone is not done until its fuzz test passes 10,000
 * self-play games with no crash, no negative resource counts, no bank
 * overdraft, no infinite game."
 *
 * Every one of those four conditions is checked here: crashes propagate,
 * the first three are covered by assertInvariants after every reduce, and the
 * fourth is the action cap below.
 */

import {
  assertInvariants,
  checkInvariants,
  createGame,
  reduce,
  seedRng,
  victoryPoints,
  type Action,
  type GameState,
  type PlayerId,
  type Scenario,
} from "@hexport/engine";
import { chooseAction } from "./randomBot.js";

export interface GameOutcome {
  readonly seed: string;
  readonly winner: PlayerId | null;
  readonly turns: number;
  readonly actions: number;
  readonly scores: readonly number[];
  /**
   * Nobody could act and nobody had won: the phase machine is stuck.
   *
   * Distinct from `exhausted`, and deliberately so. Both leave a game without a
   * winner, but only this one is a bug in the rules: it means `legalMoves()`
   * offered nothing to the player whose turn it was. Reporting the two together
   * — as this did until a Seafarers board produced thirty long games and they
   * were all labelled stuck — teaches you to wave away the very signal the
   * check exists to raise.
   */
  readonly stalled: boolean;
  /**
   * The action cap was reached with the game still going.
   *
   * CLAUDE.md's "no infinite game", and on a big Seafarers board a real
   * possibility without anything being wrong: random bots spend most of their
   * moves shuffling ships and trading with the bank, and the scenario wants 14
   * points rather than 10.
   */
  readonly exhausted: boolean;
}

export interface SelfPlayOptions {
  readonly scenario: Scenario;
  readonly seed: string;
  readonly playerCount: number;
  /** Safety valve against an infinite game. */
  readonly maxActions?: number;
  /** Assert invariants after every single action. Slower, but thorough. */
  readonly checkEvery?: boolean;
}

export class FuzzFailure extends Error {
  public readonly seed: string;
  public readonly action: Action | null;
  public readonly state: GameState;

  public constructor(
    message: string,
    seed: string,
    action: Action | null,
    state: GameState,
  ) {
    super(message);
    this.name = "FuzzFailure";
    this.seed = seed;
    this.action = action;
    this.state = state;
  }
}

const DEFAULT_MAX_ACTIONS = 20000;

/** Play one game to completion with random-legal moves. */
export function playOneGame(options: SelfPlayOptions): GameOutcome {
  const maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
  const checkEvery = options.checkEvery ?? true;

  let state = createGame({
    scenario: options.scenario,
    seed: options.seed,
    playerNames: Array.from(
      { length: options.playerCount },
      (_, i) => `bot-${String(i)}`,
    ),
  });

  // The bot's generator is seeded separately from the game's, so bot choices
  // and game randomness cannot correlate.
  let botRng = seedRng(`${options.seed}:bot`);
  let actions = 0;

  while (state.winner === null && actions < maxActions) {
    const choice = chooseAction(state, botRng);
    if (choice === null) {
      // Nobody can act and nobody has won: the phase machine is stuck.
      return {
        seed: options.seed,
        winner: null,
        turns: state.turn,
        actions,
        scores: state.players.map((s) => victoryPoints(state, s.id)),
        stalled: true,
        exhausted: false,
      };
    }

    botRng = choice.rng;
    const result = reduce(state, choice.action);

    if (!result.ok) {
      throw new FuzzFailure(
        `legalMoves offered an action reduce rejected: ${choice.action.t} (${result.reason})`,
        options.seed,
        choice.action,
        state,
      );
    }

    state = result.state;
    actions++;

    if (checkEvery) {
      const problems = checkInvariants(state);
      if (problems.length > 0) {
        throw new FuzzFailure(
          `Invariants broken after ${choice.action.t}:\n` +
            problems.map((p) => `  [${p.rule}] ${p.detail}`).join("\n"),
          options.seed,
          choice.action,
          state,
        );
      }
    }
  }

  if (!checkEvery) assertInvariants(state, "end of game");

  // Reaching here means the loop ended on its own terms: either someone won or
  // the action cap ran out. A stuck machine has already returned above.
  return {
    seed: options.seed,
    winner: state.winner,
    turns: state.turn,
    actions,
    scores: state.players.map((s) => victoryPoints(state, s.id)),
    stalled: false,
    exhausted: state.winner === null,
  };
}

export interface FuzzSummary {
  readonly games: number;
  readonly wins: Record<string, number>;
  /** Games where the phase machine offered no move. Always a bug. */
  readonly stalled: number;
  /** Games still going when the action cap ran out. Long, not broken. */
  readonly exhausted: number;
  readonly totalTurns: number;
  readonly totalActions: number;
  readonly longestGame: number;
  readonly shortestGame: number;
  readonly elapsedMs: number;
}

/** Run many games. Throws a FuzzFailure with the offending seed on any problem. */
export function runFuzz(options: {
  readonly scenario: Scenario;
  readonly games: number;
  readonly playerCount: number;
  readonly seedPrefix?: string;
  readonly checkEvery?: boolean;
  readonly maxActions?: number;
  readonly onProgress?: (done: number, total: number) => void;
}): FuzzSummary {
  const started = Date.now();
  const wins: Record<string, number> = {};
  let stalled = 0;
  let exhausted = 0;
  let totalTurns = 0;
  let totalActions = 0;
  let longestGame = 0;
  let shortestGame = Number.POSITIVE_INFINITY;

  for (let i = 0; i < options.games; i++) {
    const seed = `${options.seedPrefix ?? "fuzz"}-${String(i)}`;
    const outcome = playOneGame({
      scenario: options.scenario,
      seed,
      playerCount: options.playerCount,
      checkEvery: options.checkEvery ?? true,
      ...(options.maxActions === undefined ? {} : { maxActions: options.maxActions }),
    });

    const key = outcome.winner === null ? "none" : String(outcome.winner);
    wins[key] = (wins[key] ?? 0) + 1;
    if (outcome.stalled) stalled++;
    if (outcome.exhausted) exhausted++;
    totalTurns += outcome.turns;
    totalActions += outcome.actions;
    longestGame = Math.max(longestGame, outcome.turns);
    shortestGame = Math.min(shortestGame, outcome.turns);

    options.onProgress?.(i + 1, options.games);
  }

  return {
    games: options.games,
    wins,
    stalled,
    exhausted,
    totalTurns,
    totalActions,
    longestGame,
    shortestGame: shortestGame === Number.POSITIVE_INFINITY ? 0 : shortestGame,
    elapsedMs: Date.now() - started,
  };
}
