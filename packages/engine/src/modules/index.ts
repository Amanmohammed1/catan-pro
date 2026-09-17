/**
 * The module registry.
 *
 * A scenario names the modules it plays with (`modules: ["base", "ext56"]`) and
 * this resolves those names to implementations. Adding an expansion means
 * adding a file here and naming it in a scenario — not editing the reducer
 * (CLAUDE.md golden rule 7).
 */

import { baseModule } from "./base.js";
import { ext56Module } from "./ext56.js";
import type { GameState, PlayerId } from "../state/types.js";
import type { Action } from "../actions/types.js";
import type { RuleModule, Supply, TurnHandoff } from "./types.js";

export type { RuleModule, Supply, TurnHandoff } from "./types.js";
export { BASE_SUPPLY, baseModule } from "./base.js";
export { ext56Module } from "./ext56.js";

const REGISTRY: Readonly<Record<string, RuleModule>> = {
  base: baseModule,
  ext56: ext56Module,
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
