import { describe, it, expect } from "vitest";
import type { Action } from "@hexport/engine";

/**
 * Every legal move must be reachable from the DOM.
 *
 * CLAUDE.md, Conventions: "Every legal move is reachable from the DOM, not only
 * by clicking the 3D board. `PlacementList` is that route, and the UI tests
 * drive the game through it — so the keyboard and screen-reader path is
 * exercised on every run."
 *
 * Nothing enforced that. `GameView.test.tsx` asserts the inverse — that controls
 * follow `legalMoves` — which passes perfectly while a legal move has no control
 * at all. Two bugs got through that gap: the Ship control rendered only when a
 * ship was already legal, and `moveShip` reached the DOM from nowhere while a
 * comment claimed it was "reachable from the action list".
 *
 * This table is the guard. It is a `Record` over the whole `Action` union, so it
 * is exhaustive at compile time: a new action — every one Cities & Knights adds
 * — will not build until somebody says how a player is supposed to reach it.
 * That forces the decision to be made deliberately rather than forgotten.
 */

type DomRoute =
  /** A `data-action` button: ActionBar, TradePanel, the dev card controls. */
  | "control"
  /** A `data-placement` button from PlacementList, keyed by node, edge or tile. */
  | "placement"
  /**
   * Deliberately not enumerated by `legalMoves` at all (ADR 0003): the space of
   * domestic trade offers is unbounded, so the reducer validates one instead of
   * the move generator listing them. The player reaches it through the trade
   * panel, which composes an offer rather than picking a listed move.
   */
  | "not-enumerated"
  /** Nothing in the interface reaches this. Always a bug. */
  | "none";

const ROUTES: Record<Action["t"], DomRoute> = {
  // Setup placements light up every legal spot directly.
  setupSettlement: "placement",
  setupRoad: "placement",

  // Turn flow: plain buttons.
  rollDice: "control",
  endTurn: "control",
  discard: "control",
  steal: "control",

  // Robber and pirate are both hex picks, offered together in the same phase
  // (Seafarers p.2: you may move the pirate instead of the robber).
  moveRobber: "placement",
  movePirate: "placement",

  // Building: arm a mode, then pick the highlighted spot.
  buildRoad: "placement",
  buildSettlement: "placement",
  buildCity: "placement",
  buildShip: "placement",

  /*
   * Seafarers p.2: "You may move 1 ship during your Action phase."
   *
   * A ship move names two edges, so a single click cannot express it. It is a
   * two-step gesture — pick a ship, then pick where it goes — but both halves
   * are ordinary placements, so the keyboard route works unchanged.
   *
   * This read "none" until the gesture existed, which is what this table is
   * for: the engine implemented, fuzzed and tested a rule no player could
   * perform, and a comment in the client wrongly claimed otherwise.
   */
  moveShip: "placement",

  // Development cards.
  buyDevCard: "control",
  playKnight: "control",
  playRoadBuilding: "control",
  endRoadBuilding: "control",
  playYearOfPlenty: "control",
  playMonopoly: "control",

  // Trade.
  bankTrade: "control",
  offerTrade: "not-enumerated",
  respondTrade: "control",
  counterTrade: "control",
  confirmTrade: "control",
  cancelTrade: "control",

  // Expansion turn structure.
  passSpecialBuild: "control",
  takeGold: "control",
};

describe("every legal move is reachable from the DOM", () => {
  it("leaves no action kind without a route", () => {
    const unreachable = (Object.entries(ROUTES) as [Action["t"], DomRoute][])
      .filter(([, route]) => route === "none")
      .map(([kind]) => kind)
      .sort();

    expect(unreachable).toEqual([]);
  });

  it("routes each kind through exactly one mechanism", () => {
    // A sanity check on the table itself: every value is one of the four known
    // routes, so a typo cannot quietly become a fifth category that the check
    // above then ignores.
    const known: readonly DomRoute[] = [
      "control",
      "placement",
      "not-enumerated",
      "none",
    ];
    for (const [kind, route] of Object.entries(ROUTES) as [Action["t"], DomRoute][]) {
      expect(known, `${kind} has an unknown route`).toContain(route);
    }
  });

  it("keeps the unbounded-offer exception to exactly one action", () => {
    // ADR 0003 carves out one exception to golden rule 3. If a second action
    // ever claims it, that is a decision worth making on purpose.
    const exempt = (Object.entries(ROUTES) as [Action["t"], DomRoute][])
      .filter(([, route]) => route === "not-enumerated")
      .map(([kind]) => kind);

    expect(exempt).toEqual(["offerTrade"]);
  });
});
