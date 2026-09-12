/**
 * A board with a harbor the test can rely on.
 *
 * The generated classic board places harbors by coastline position, which makes
 * "give player 0 a 2:1 ore harbor" awkward to arrange. This builds a tiny board
 * with one harbor and puts a settlement of player 0 on it.
 */

import { createGame } from "../setup/createGame.js";
import { disc } from "./testHelpers.js";
import type { Scenario, ScenarioCell } from "../scenario/types.js";
import type { GameState } from "../state/types.js";

export function loadPortScenario(kind: "generic" | "ore"): GameState {
  const coords = disc(1);
  const cells: ScenarioCell[] = coords.map((coord) => ({
    coord,
    slot: "land" as const,
    terrain: "forest" as const,
  }));

  const scenario: Scenario = {
    id: `port-${kind}`,
    name: "Port Test",
    schemaVersion: 1,
    players: { min: 2, max: 4 },
    victoryPoints: 10,
    modules: ["base"],
    layout: { orientation: "pointy" },
    cells,
    bags: {},
    numbers: {
      mode: "path",
      sequence: cells.map((_, i) => (i % 10) + 2),
      path: coords,
      skipTerrains: ["desert", "sea"],
    },
    ports: [
      kind === "generic"
        ? { at: [0, -1], edgeDir: 2, kind: "generic", ratio: 3 }
        : { at: [0, -1], edgeDir: 2, kind: "resource", resource: "ore", ratio: 2 },
    ],
    pieces: { roads: 15, settlements: 5, cities: 4, ships: 0 },
    setup: { mode: "snakeDraft", rounds: 2, placeOn: ["land"] },
    islands: [],
    hiddenStacks: [],
    startingPieces: [],
  };

  const game = createGame({
    scenario,
    seed: "ports",
    playerNames: ["P0", "P1"],
  });

  // Put player 0 on one end of the harbor edge.
  const port = Object.values(game.board.ports)[0];
  if (port === undefined) throw new Error("fixture has no port");
  const node = port.nodes[0];

  return {
    ...game,
    phase: { k: "main" },
    currentPlayer: 0,
    turn: 5,
    buildings: { [node]: { kind: "settlement", player: 0 } },
    players: game.players.map((seat) =>
      seat.id === 0
        ? {
            ...seat,
            pieces: { ...seat.pieces, settlements: seat.pieces.settlements - 1 },
          }
        : seat,
    ),
  };
}
