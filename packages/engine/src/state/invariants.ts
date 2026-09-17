/**
 * Invariants asserted after every reduce in dev builds (CLAUDE.md, "Testing
 * requirements"): resource conservation, bank never negative, piece stock never
 * negative, victory points recomputable from scratch.
 *
 * These exist to make a rules bug fail loudly during a fuzz run instead of
 * quietly producing a wrong board three hundred turns later.
 */

import { resolveModules, supplyFor } from "../modules/index.js";
import { publicVictoryPoints, victoryPoints } from "../queries/scores.js";
import { RESOURCE_KINDS, type GameState } from "./types.js";

export interface InvariantViolation {
  readonly rule: string;
  readonly detail: string;
}

/** Every broken invariant in this state. Empty means the state is sound. */
export function checkInvariants(state: GameState): InvariantViolation[] {
  const problems: InvariantViolation[] = [];

  // What this game shipped with: the base box, or a bigger one when a module
  // such as the 5–6 extension is loaded.
  const supply = supplyFor(resolveModules(state.config.modules));

  // ---- the bank -----------------------------------------------------------
  for (const kind of RESOURCE_KINDS) {
    if (state.bank[kind] < 0) {
      problems.push({
        rule: "bank-non-negative",
        detail: `bank holds ${String(state.bank[kind])} ${kind}`,
      });
    }
  }

  // ---- resource conservation ---------------------------------------------
  // Cards only ever move between the bank and player hands, so every resource
  // type must always total what the box holds: 19 in the base game (p.2), 24
  // with the 5–6 extension (5–6 rules 2022 p.4).
  for (const kind of RESOURCE_KINDS) {
    let total = state.bank[kind];
    for (const seat of state.players) total += seat.resources[kind];
    if (total !== supply.bankPerResource) {
      problems.push({
        rule: "resource-conservation",
        detail: `${kind} totals ${String(total)}, expected ${String(supply.bankPerResource)}`,
      });
    }
  }

  // ---- player hands -------------------------------------------------------
  for (const seat of state.players) {
    for (const kind of RESOURCE_KINDS) {
      if (seat.resources[kind] < 0) {
        problems.push({
          rule: "hand-non-negative",
          detail: `player ${String(seat.id)} holds ${String(seat.resources[kind])} ${kind}`,
        });
      }
    }

    if (
      seat.pieces.roads < 0 ||
      seat.pieces.settlements < 0 ||
      seat.pieces.cities < 0 ||
      seat.pieces.ships < 0
    ) {
      problems.push({
        rule: "piece-stock-non-negative",
        detail: `player ${String(seat.id)} has negative piece stock`,
      });
    }
  }

  // ---- pieces on the board match pieces removed from stock ----------------
  for (const seat of state.players) {
    const roadsOnBoard = Object.values(state.roads).filter(
      (owner) => owner === seat.id,
    ).length;
    const buildings = Object.values(state.buildings).filter(
      (b) => b.player === seat.id,
    );
    const settlements = buildings.filter((b) => b.kind === "settlement").length;
    const cities = buildings.filter((b) => b.kind === "city").length;
    const shipsOnBoard = Object.values(state.ships).filter(
      (ship) => ship.player === seat.id,
    ).length;

    // Rules p.5: 15 roads, 5 settlements, 4 cities in the base box. The figures
    // come from the scenario rather than being hardcoded, because a scenario is
    // free to hand out a different number — Seafarers adds 15 ships, and these
    // checks would otherwise quietly assume the base box for every board.
    // A city returns its settlement to the supply, so settlements on board plus
    // stock is constant only when cities are accounted for.
    const expected = state.config.pieces;

    if (roadsOnBoard + seat.pieces.roads !== expected.roads) {
      problems.push({
        rule: "road-stock",
        detail: `player ${String(seat.id)}: ${String(roadsOnBoard)} on board + ${String(seat.pieces.roads)} in stock, expected ${String(expected.roads)}`,
      });
    }
    if (settlements + seat.pieces.settlements !== expected.settlements) {
      problems.push({
        rule: "settlement-stock",
        detail: `player ${String(seat.id)}: ${String(settlements)} on board + ${String(seat.pieces.settlements)} in stock, expected ${String(expected.settlements)}`,
      });
    }
    if (cities + seat.pieces.cities !== expected.cities) {
      problems.push({
        rule: "city-stock",
        detail: `player ${String(seat.id)}: ${String(cities)} on board + ${String(seat.pieces.cities)} in stock, expected ${String(expected.cities)}`,
      });
    }
    if (shipsOnBoard + seat.pieces.ships !== expected.ships) {
      problems.push({
        rule: "ship-stock",
        detail: `player ${String(seat.id)}: ${String(shipsOnBoard)} on board + ${String(seat.pieces.ships)} in stock, expected ${String(expected.ships)}`,
      });
    }
  }

  // ---- development cards --------------------------------------------------
  let devTotal = state.devDeck.length;
  for (const seat of state.players) devTotal += seat.devCards.length;
  const expectedDev = Object.values(supply.devDeck).reduce((sum, n) => sum + n, 0);
  if (devTotal !== expectedDev) {
    problems.push({
      rule: "dev-card-conservation",
      detail: `${String(devTotal)} development cards exist, expected ${String(expectedDev)}`,
    });
  }

  for (const seat of state.players) {
    const played = seat.devCards.filter(
      (card) => card.kind === "knight" && card.played,
    ).length;
    if (played !== seat.knightsPlayed) {
      problems.push({
        rule: "knight-count",
        detail: `player ${String(seat.id)} shows ${String(seat.knightsPlayed)} knights but ${String(played)} are marked played`,
      });
    }
  }

  // ---- victory points recomputable ---------------------------------------
  for (const seat of state.players) {
    const recomputed = victoryPoints(state, seat.id);
    if (recomputed < publicVictoryPoints(state, seat.id)) {
      problems.push({
        rule: "victory-points",
        detail: `player ${String(seat.id)} public score exceeds total`,
      });
    }
    if (recomputed < 0) {
      problems.push({
        rule: "victory-points",
        detail: `player ${String(seat.id)} has a negative score`,
      });
    }
  }

  // ---- the robber ---------------------------------------------------------
  if (state.board.tiles[state.robber] === undefined) {
    problems.push({
      rule: "robber-placement",
      detail: `robber is on ${state.robber}, which is not a hex`,
    });
  }

  // ---- one road per path, one building per intersection -------------------
  for (const edgeId of Object.keys(state.roads)) {
    if (state.board.edges[edgeId] === undefined) {
      problems.push({
        rule: "road-placement",
        detail: `road on ${edgeId}, which is not an edge`,
      });
    }
  }
  for (const edgeId of Object.keys(state.ships)) {
    if (state.board.edges[edgeId] === undefined) {
      problems.push({
        rule: "ship-placement",
        detail: `ship on ${edgeId}, which is not an edge`,
      });
    }
    // Seafarers p.2: one piece to an edge, road or ship, never both.
    if (state.roads[edgeId] !== undefined) {
      problems.push({
        rule: "ship-placement",
        detail: `edge ${edgeId} carries both a road and a ship`,
      });
    }
  }
  for (const nodeId of Object.keys(state.buildings)) {
    if (state.board.nodes[nodeId] === undefined) {
      problems.push({
        rule: "building-placement",
        detail: `building on ${nodeId}, which is not an intersection`,
      });
    }
  }

  // ---- the distance rule holds for every built settlement (p.5) -----------
  for (const [nodeId] of Object.entries(state.buildings)) {
    for (const neighbour of state.board.nodes[nodeId]?.nodes ?? []) {
      if (state.buildings[neighbour] !== undefined) {
        problems.push({
          rule: "distance-rule",
          detail: `buildings on adjacent intersections ${nodeId} and ${neighbour}`,
        });
      }
    }
  }

  return problems;
}

/** Throw if any invariant is broken. Used by tests and the fuzz harness. */
export function assertInvariants(state: GameState, context = ""): void {
  const problems = checkInvariants(state);
  if (problems.length === 0) return;

  const lines = problems.map((p) => `  [${p.rule}] ${p.detail}`).join("\n");
  throw new Error(
    `Game state invariants broken${context === "" ? "" : ` after ${context}`}:\n${lines}`,
  );
}
