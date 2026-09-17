import { describe, it, expect } from "vitest";
import {
  initialModuleState,
  interceptAction,
  moduleReduce,
  onDiceRoll,
  onPhaseEnter,
  scoreContribution,
} from "./index.js";
import type { ModuleEffect, RuleModule } from "./types.js";
import {
  completeSetup,
  fixedScenario,
  intoMainPhase,
  newGame,
} from "../reducers/testHelpers.js";
import type { Action } from "../actions/types.js";
import type { GameState } from "../state/types.js";

/**
 * The hooks added in M6 (ADR 0007).
 *
 * `modules.test.ts` covers the registry and the two hooks that predate this
 * widening. These check the new ones, using purpose-built fake modules rather
 * than the real ones: the point is that the *interface* fans out correctly, and
 * a test that leaned on Seafarers would stop testing that the moment Seafarers'
 * own rules changed.
 */

function baseState(): GameState {
  return intoMainPhase(completeSetup(newGame(3)), 0);
}

/** A module that records the order it was called in, via a shared array. */
function recorder(id: string, log: string[]): RuleModule {
  return {
    id,
    setupState: () => ({ m: id }),
    onDiceRoll: (state) => {
      log.push(`${id}:roll`);
      return { state, events: [] };
    },
    onPhaseEnter: (state) => {
      log.push(`${id}:phase`);
      return { state, events: [] };
    },
    scoreContribution: () => 1,
  };
}

describe("setupState", () => {
  it("collects a slice from every module that keeps one", () => {
    const log: string[] = [];
    const state = initialModuleState([recorder("alpha", log), recorder("beta", log)], {
      scenario: fixedScenario(),
      players: [0, 1, 2],
    });
    expect(Object.keys(state).sort()).toEqual(["alpha", "beta"]);
  });

  it("gives a base game an empty record rather than empty slices", () => {
    // Neither `base` nor `ext56` keeps state, so nothing should appear.
    const game = newGame(3);
    expect(game.moduleState).toEqual({});
  });
});

describe("interceptAction", () => {
  const action: Action = { t: "endTurn", player: 0 };

  it("passes an action through untouched when no module objects", () => {
    const result = interceptAction([], baseState(), action);
    expect(result).toBe(action);
  });

  it("lets a module refuse an action the base rules would allow", () => {
    const blocker: RuleModule = {
      id: "blocker",
      interceptAction: (_state, a) => ({
        ok: false,
        reason: "A knight stands in the way.",
        action: a,
      }),
    };
    const result = interceptAction([blocker], baseState(), action);
    expect("ok" in result && !result.ok).toBe(true);
  });

  it("feeds one module's rewrite to the next, so both can narrow it", () => {
    const seen: string[] = [];
    const first: RuleModule = {
      id: "first",
      interceptAction: (_s, a) => ({ ...a, player: 1 }),
    };
    const second: RuleModule = {
      id: "second",
      interceptAction: (_s, a) => {
        seen.push(String(a.player));
        return null;
      },
    };
    interceptAction([first, second], baseState(), action);
    expect(seen).toEqual(["1"]);
  });

  it("stops at the first refusal", () => {
    const reached: string[] = [];
    const refuse: RuleModule = {
      id: "refuse",
      interceptAction: (_s, a) => ({ ok: false, reason: "no", action: a }),
    };
    const after: RuleModule = {
      id: "after",
      interceptAction: () => {
        reached.push("after");
        return null;
      },
    };
    interceptAction([refuse, after], baseState(), action);
    expect(reached).toEqual([]);
  });
});

describe("fan-out order", () => {
  it("runs onDiceRoll in the order the scenario named the modules", () => {
    const log: string[] = [];
    onDiceRoll([recorder("alpha", log), recorder("beta", log)], baseState(), {
      dice: [3, 4],
      total: 7,
    });
    expect(log).toEqual(["alpha:roll", "beta:roll"]);
  });

  it("runs onPhaseEnter in that same order", () => {
    const log: string[] = [];
    onPhaseEnter([recorder("alpha", log), recorder("beta", log)], baseState(), {
      k: "main",
    });
    expect(log).toEqual(["alpha:phase", "beta:phase"]);
  });

  it("threads state through the chain, so a later module sees an earlier change", () => {
    const bump: RuleModule = {
      id: "bump",
      onDiceRoll: (state) => ({
        state: { ...state, turn: state.turn + 1 },
        events: [],
      }),
    };
    const observed: number[] = [];
    const watch: RuleModule = {
      id: "watch",
      onDiceRoll: (state) => {
        observed.push(state.turn);
        return null;
      },
    };
    const start = baseState();
    const result = onDiceRoll([bump, watch], start, { dice: [1, 1], total: 2 });
    expect(observed).toEqual([start.turn + 1]);
    expect(result.state.turn).toBe(start.turn + 1);
  });

  it("collects events from every module in order", () => {
    const emit = (id: string): RuleModule => ({
      id,
      onDiceRoll: (state): ModuleEffect => ({
        state,
        events: [{ e: "specialBuildPassed", player: 0 }],
      }),
    });
    const result = onDiceRoll([emit("a"), emit("b")], baseState(), {
      dice: [2, 2],
      total: 4,
    });
    expect(result.events).toHaveLength(2);
  });
});

describe("scoreContribution", () => {
  it("is zero when no module scores, which is every base game", () => {
    expect(scoreContribution([], baseState(), 0)).toBe(0);
  });

  it("sums across modules", () => {
    const log: string[] = [];
    expect(
      scoreContribution(
        [recorder("alpha", log), recorder("beta", log)],
        baseState(),
        0,
      ),
    ).toBe(2);
  });
});

describe("moduleReduce", () => {
  /**
   * `endTurn` stands in for a module-owned kind here. The real ones —
   * `buildShip`, `recruitKnight` — arrive with the modules that own them, and
   * what is under test is the fan-out contract rather than any one action.
   * `reduce()` only ever consults a module for a kind its own switch does not
   * handle, which is what the `default` arm does.
   */
  const action: Action = { t: "endTurn", player: 0 };

  it("returns null when no module claims the action", () => {
    expect(moduleReduce([], baseState(), action)).toBeNull();
  });

  it("lets the owning module handle it", () => {
    const owner: RuleModule = {
      id: "owner",
      reducers: {
        endTurn: (state): ModuleEffect => ({ state, events: [] }),
      },
    };
    const result = moduleReduce([owner], baseState(), action);
    expect(result).not.toBeNull();
    expect(result !== null && "ok" in result).toBe(false);
  });

  it("reports a module's refusal as a rejection", () => {
    const owner: RuleModule = {
      id: "owner",
      reducers: {
        endTurn: (_state, a) => ({ ok: false, reason: "not now", action: a }),
      },
    };
    const result = moduleReduce([owner], baseState(), action);
    expect(result !== null && "ok" in result).toBe(true);
  });
});
