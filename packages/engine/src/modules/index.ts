/**
 * The module registry.
 *
 * A scenario names the modules it plays with (`modules: ["base", "ext56"]`) and
 * this resolves those names to implementations. Adding an expansion means
 * adding a file here and naming it in a scenario — not editing the reducer
 * (CLAUDE.md golden rule 7).
 *
 * Every function below fans one hook out across the loaded modules, in the
 * order the scenario listed them. That order is the only precedence rule there
 * is, and it is deliberate: a scenario that loads `["base", "ext56"]` gets the
 * 5–6 supply because `ext56` is named second. Callers never ask which module
 * answered.
 */

import { baseModule } from "./base.js";
import { ext56Module } from "./ext56.js";
import { fogIslandsModule } from "./fogIslands.js";
import { seafarersModule } from "./seafarers.js";
import type { Action, Rejection } from "../actions/types.js";
import type { GameEvent } from "../events/types.js";
import type { Phase } from "../phases/types.js";
import type { GameState, PlayerId } from "../state/types.js";
import type {
  DiceRoll,
  ModuleEffect,
  ModuleSetupCtx,
  ModuleState,
  RuleModule,
  Supply,
  TurnHandoff,
} from "./types.js";

export type {
  DiceRoll,
  ModuleEffect,
  ModuleReducer,
  ModuleSetupCtx,
  ModuleState,
  RuleModule,
  Supply,
  TurnHandoff,
} from "./types.js";
export { BASE_SUPPLY, baseModule } from "./base.js";
export { ext56Module } from "./ext56.js";
export {
  fogIslandsModule,
  fogIslandsStateOf,
  type FogIslandsState,
} from "./fogIslands.js";
export { seafarersModule, seafarersStateOf, type SeafarersState } from "./seafarers.js";

const REGISTRY: Readonly<Record<string, RuleModule>> = {
  base: baseModule,
  ext56: ext56Module,
  seafarers: seafarersModule,
  // The Fog Islands loads alongside `seafarers`, never instead of it: it adds
  // the face-down board (p.8) and takes nothing away, so a scenario names both.
  fogIslands: fogIslandsModule,
};

export class UnknownModuleError extends Error {}

/** Resolve module ids to implementations, in the order the scenario lists them. */
export function resolveModules(ids: readonly string[]): RuleModule[] {
  return ids.map((id) => {
    const module = REGISTRY[id];
    if (module === undefined) {
      throw new UnknownModuleError(
        `Unknown rule module "${id}". Known: ${Object.keys(REGISTRY).join(", ")}.`,
      );
    }
    return module;
  });
}

/** The supply the loaded modules describe; the last one to declare it wins. */
export function supplyFor(modules: readonly RuleModule[]): Supply {
  let supply = baseModule.supply;
  for (const module of modules) {
    if (module.supply !== undefined) supply = module.supply;
  }
  if (supply === undefined) {
    throw new UnknownModuleError("No module declares a supply.");
  }
  return supply;
}

/**
 * Every module's opening state slice, keyed by module id.
 *
 * A module that keeps no state contributes no key, so a base game carries an
 * empty record rather than a map of empty objects.
 */
export function initialModuleState(
  modules: readonly RuleModule[],
  ctx: ModuleSetupCtx,
): Readonly<Record<string, ModuleState>> {
  const out: Record<string, ModuleState> = {};
  for (const module of modules) {
    const slice = module.setupState?.(ctx);
    if (slice != null) out[module.id] = slice;
  }
  return out;
}

/** The first module that wants to interpose a phase when a turn ends. */
export function turnHandoff(
  modules: readonly RuleModule[],
  state: GameState,
  nextPlayer: PlayerId,
): TurnHandoff | null {
  for (const module of modules) {
    const handoff = module.afterTurnEnd?.(state, nextPlayer);
    if (handoff !== null && handoff !== undefined) return handoff;
  }
  return null;
}

/** Extra moves contributed by the loaded modules. */
export function extraLegalMoves(
  modules: readonly RuleModule[],
  state: GameState,
  player: PlayerId,
): Action[] {
  return modules.flatMap((module) => module.extraLegalMoves?.(state, player) ?? []);
}

/**
 * Run an action past every module before the reducer judges it.
 *
 * A module may rewrite the action or refuse it outright. The first refusal
 * wins and stops the chain; a rewrite is passed on to the modules after it, so
 * two modules can each narrow the same action.
 */
export function interceptAction(
  modules: readonly RuleModule[],
  state: GameState,
  action: Action,
): Action | Rejection {
  let current = action;
  for (const module of modules) {
    const result = module.interceptAction?.(state, current);
    if (result == null) continue;
    if ("ok" in result) return result;
    current = result;
  }
  return current;
}

/** Thread an effect-producing hook through every module in order. */
function fold(
  modules: readonly RuleModule[],
  state: GameState,
  run: (module: RuleModule, state: GameState) => ModuleEffect | null | undefined,
): ModuleEffect {
  let current = state;
  const events: GameEvent[] = [];

  for (const module of modules) {
    const effect = run(module, current);
    if (effect == null) continue;
    current = effect.state;
    events.push(...effect.events);
  }

  return { state: current, events };
}

/** Every module's response to a roll, applied in order. */
export function onDiceRoll(
  modules: readonly RuleModule[],
  state: GameState,
  roll: DiceRoll,
): ModuleEffect {
  return fold(modules, state, (module, current) => module.onDiceRoll?.(current, roll));
}

/** Every module's response to entering a phase, applied in order. */
export function onPhaseEnter(
  modules: readonly RuleModule[],
  state: GameState,
  phase: Phase,
): ModuleEffect {
  return fold(modules, state, (module, current) =>
    module.onPhaseEnter?.(current, phase),
  );
}

/**
 * Every module's response to an action that has just been reduced.
 *
 * Unlike `interceptAction`, which inspects a move before it is judged, this runs
 * once the move has been accepted — so a module sees the state the action
 * produced, which is the only place some rules can be written. The Fog Islands
 * turns a hex face up here, because a road or a ship landing beside an empty
 * space is what reveals it (Seafarers p.8), and that trigger spans a central
 * reducer case (`buildRoad`) and a module-owned one (`buildShip`) alike.
 *
 * The events of the action are passed through rather than merged, so a module
 * can read what happened without being able to rewrite it.
 */
export function afterAction(
  modules: readonly RuleModule[],
  state: GameState,
  action: Action,
  events: readonly GameEvent[],
): ModuleEffect {
  return fold(modules, state, (module, current) =>
    module.afterAction?.(current, action, events),
  );
}

/** Victory points the loaded modules grant this player, over and above the base. */
export function scoreContribution(
  modules: readonly RuleModule[],
  state: GameState,
  player: PlayerId,
): number {
  let total = 0;
  for (const module of modules) {
    total += module.scoreContribution?.(state, player) ?? 0;
  }
  return total;
}

/**
 * Let a module reduce an action it owns.
 *
 * Returns null when no module claims the action, which is the reducer's signal
 * to handle it as a base-game move. A module that claims the kind but finds the
 * move illegal returns a Rejection, exactly as `reduce()` would.
 */
export function moduleReduce(
  modules: readonly RuleModule[],
  state: GameState,
  action: Action,
): ModuleEffect | Rejection | null {
  for (const module of modules) {
    const reducer = module.reducers?.[action.t];
    if (reducer === undefined) continue;
    const result = reducer(state, action);
    if (result != null) return result;
  }
  return null;
}
