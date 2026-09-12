import { describe, it, expect } from "vitest";
import { reduce } from "./reduce.js";
import { legalMoves } from "../queries/legalMoves.js";
import { checkInvariants } from "../state/invariants.js";
import { victoryPoints } from "../queries/scores.js";
import { seedRng, nextInt, type RngState } from "../rng/sfc32.js";
import { createGame } from "../setup/createGame.js";
import { fixedScenario } from "./testHelpers.js";
import type { Action } from "../actions/types.js";
import type { GameState } from "../state/types.js";

/**
 * A small self-play run inside the normal test suite.
 *
 * The full 10,000-game gate lives in apps/bot-runner (`pnpm fuzz`) because it
 * takes two minutes. This keeps a representative slice in `pnpm test` so a rules
 * regression fails fast rather than waiting for someone to run the fuzzer.
 */

function allMoves(state: GameState): Action[] {
  const out: Action[] = [];
  for (const seat of state.players) out.push(...legalMoves(state, seat.id));
  return out;
}

interface Result {
  readonly state: GameState;
  readonly actions: number;
  readonly stalled: boolean;
}

function playGame(seed: string, playerCount: number, maxActions = 8000): Result {
  let state = createGame({
    scenario: fixedScenario(),
    seed,
    playerNames: Array.from({ length: playerCount }, (_, i) => `bot${String(i)}`),
  });
  let rng: RngState = seedRng(`${seed}:bot`);
  let actions = 0;

  while (state.winner === null && actions < maxActions) {
    const moves = allMoves(state);
    if (moves.length === 0) return { state, actions, stalled: true };

    const [index, next] = nextInt(rng, moves.length);
    rng = next;
    const action = moves[index] as Action;

    const result = reduce(state, action);
    if (!result.ok) {
      throw new Error(
        `seed ${seed}: legalMoves offered ${action.t} but reduce said "${result.reason}"`,
      );
    }
    state = result.state;
    actions++;

    const problems = checkInvariants(state);
    if (problems.length > 0) {
      throw new Error(
        `seed ${seed}: invariants broken after ${action.t}: ` +
          problems.map((p) => `${p.rule} (${p.detail})`).join(", "),
      );
    }
  }

  return { state, actions, stalled: state.winner === null };
}

describe("self-play", () => {
  it.each([3, 4])("finishes a %i player game without breaking an invariant", (n) => {
    const result = playGame(`suite-${String(n)}`, n);
    expect(result.stalled).toBe(false);
    expect(result.state.winner).not.toBeNull();
  });

  it("runs 25 games clean", () => {
    for (let i = 0; i < 25; i++) {
      const result = playGame(`suite-batch-${String(i)}`, 4);
      expect(result.stalled).toBe(false);
    }
  });

  it("never lets a winner finish below the target score", () => {
    for (let i = 0; i < 10; i++) {
      const { state } = playGame(`suite-score-${String(i)}`, 3);
      expect(state.winner).not.toBeNull();
      const winner = state.winner as number;
      expect(victoryPoints(state, winner)).toBeGreaterThanOrEqual(
        state.config.victoryPoints,
      );
    }
  });

  it("only ever declares the active player the winner (p.7)", () => {
    for (let i = 0; i < 10; i++) {
      const { state } = playGame(`suite-turn-${String(i)}`, 4);
      expect(state.winner).toBe(state.currentPlayer);
    }
  });

  it("is deterministic: the same seed replays identically", () => {
    const a = playGame("suite-determinism", 4);
    const b = playGame("suite-determinism", 4);
    expect(a.actions).toBe(b.actions);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it("leaves the bank and hands consistent at the end", () => {
    const { state } = playGame("suite-bank", 4);
    expect(checkInvariants(state)).toEqual([]);
    for (const seat of state.players) {
      for (const kind of ["brick", "lumber", "wool", "grain", "ore"] as const) {
        expect(seat.resources[kind]).toBeGreaterThanOrEqual(0);
        expect(state.bank[kind]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
