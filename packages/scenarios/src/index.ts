/**
 * Scenario registry.
 *
 * Board and rule definitions are data, not code (CLAUDE.md, "Expansions are
 * modules, not if statements"). Adding a Seafarers map in M6 should mean adding
 * a JSON file and an entry here, and touching nothing in the engine.
 */

import type { Scenario } from "@hexport/engine";
import { parseScenario } from "./schema.js";

import classic34 from "../data/classic-3-4.json" with { type: "json" };
import classic56 from "../data/classic-5-6.json" with { type: "json" };
import newShores3 from "../data/new-shores-3.json" with { type: "json" };
import newShores4 from "../data/new-shores-4.json" with { type: "json" };
import desert3 from "../data/through-the-desert-3.json" with { type: "json" };
import desert4 from "../data/through-the-desert-4.json" with { type: "json" };
import tinyIsland from "../data/fixtures/tiny-island.json" with { type: "json" };
import twoIslands from "../data/fixtures/two-islands.json" with { type: "json" };

export { parseScenario, safeParseScenario, scenarioSchema } from "./schema.js";

const RAW: Readonly<Record<string, unknown>> = {
  "classic-3-4": classic34,
  "classic-5-6": classic56,
  "new-shores-3": newShores3,
  "new-shores-4": newShores4,
  "through-the-desert-3": desert3,
  "through-the-desert-4": desert4,
  "tiny-island": tinyIsland,
  "two-islands": twoIslands,
};

/**
 * Scenario ids that ship with the game, as opposed to test fixtures.
 *
 * The Seafarers boards are the first here to load a module beyond the base
 * game, which is also what finally lets the fuzzer exercise ships, gold, the
 * pirate and island scoring (ADR 0008).
 */
export const PLAYABLE_SCENARIO_IDS: readonly string[] = [
  "classic-3-4",
  "classic-5-6",
  "new-shores-3",
  "new-shores-4",
  "through-the-desert-3",
  "through-the-desert-4",
];

/** Every scenario id, fixtures included. */
export const SCENARIO_IDS: readonly string[] = Object.keys(RAW);

const cache = new Map<string, Scenario>();

/** Load and validate a scenario by id. Throws if the id is unknown or invalid. */
export function loadScenario(id: string): Scenario {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const raw = RAW[id];
  if (raw === undefined) {
    throw new Error(`Unknown scenario "${id}". Known: ${SCENARIO_IDS.join(", ")}.`);
  }

  const parsed = parseScenario(raw);
  cache.set(id, parsed);
  return parsed;
}
