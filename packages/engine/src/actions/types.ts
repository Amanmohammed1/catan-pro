/**
 * The Action union: everything a player can ask the game to do.
 *
 * Clients send these; the server validates them against legalMoves() and feeds
 * them to reduce(). Nothing here computes an outcome — an Action is a request,
 * and an Event is what actually happened.
 */

import type { EdgeId, NodeId, TileId } from "../geometry/ids.js";
import type { ResourceKind } from "../scenario/types.js";
import type { PlayerId, ResourceCounts } from "../state/types.js";

export type Action =
  // ---- setup (p.12) -------------------------------------------------------
  | { readonly t: "setupSettlement"; readonly player: PlayerId; readonly node: NodeId }
  | { readonly t: "setupRoad"; readonly player: PlayerId; readonly edge: EdgeId }

  // ---- turn flow (p.4) ----------------------------------------------------
  | { readonly t: "rollDice"; readonly player: PlayerId }
  | { readonly t: "endTurn"; readonly player: PlayerId }

  // ---- the 7 and the robber (p.5, p.11) -----------------------------------
  | {
      readonly t: "discard";
      readonly player: PlayerId;
      readonly resources: ResourceCounts;
    }
  | { readonly t: "moveRobber"; readonly player: PlayerId; readonly tile: TileId }
  | {
      readonly t: "steal";
      /** null when no adjacent opponent holds a card. */
      readonly player: PlayerId;
      readonly target: PlayerId | null;
    }

  // ---- building (p.4-5) ---------------------------------------------------
  | { readonly t: "buildRoad"; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly t: "buildSettlement"; readonly player: PlayerId; readonly node: NodeId }
  | { readonly t: "buildCity"; readonly player: PlayerId; readonly node: NodeId }
  | { readonly t: "buyDevCard"; readonly player: PlayerId }

  // ---- development cards (p.5, p.10) --------------------------------------
  | { readonly t: "playKnight"; readonly player: PlayerId }
  | { readonly t: "playRoadBuilding"; readonly player: PlayerId }
  /** Stop placing free roads early, when no legal spot is left (p.10). */
  | { readonly t: "endRoadBuilding"; readonly player: PlayerId }
  | {
      readonly t: "playYearOfPlenty";
      readonly player: PlayerId;
      readonly resources: readonly [ResourceKind, ResourceKind];
    }
  | {
      readonly t: "playMonopoly";
      readonly player: PlayerId;
      readonly resource: ResourceKind;
    }

  // ---- trade (p.4, p.7, p.9) ----------------------------------------------
  | {
      readonly t: "bankTrade";
      readonly player: PlayerId;
      readonly give: ResourceKind;
      readonly receive: ResourceKind;
      /** 4, 3 or 2 depending on harbor access. */
      readonly rate: number;
    }
  | {
      readonly t: "offerTrade";
      readonly player: PlayerId;
      readonly give: ResourceCounts;
      readonly receive: ResourceCounts;
    }
  | {
      readonly t: "respondTrade";
      readonly player: PlayerId;
      readonly accept: boolean;
    }
  /**
   * Answer an open offer with terms of your own. Amounts are from the
   * counter-offering player's point of view: what they give, what they want.
   * Validated rather than enumerated, like `offerTrade` — ADR 0003.
   */
  | {
      readonly t: "counterTrade";
      readonly player: PlayerId;
      readonly give: ResourceCounts;
      readonly receive: ResourceCounts;
    }
  | {
      readonly t: "confirmTrade";
      readonly player: PlayerId;
      readonly with: PlayerId;
    }
  | { readonly t: "cancelTrade"; readonly player: PlayerId }

  // ---- 5–6 player extension (ADR 0006) ------------------------------------
  /** Give up the rest of your Special Building window. */
  | { readonly t: "passSpecialBuild"; readonly player: PlayerId }

  // ---- Seafarers (ADR 0008) -----------------------------------------------
  /**
   * Build a ship on a sea or coast edge (Seafarers p.2).
   *
   * Owned by the `seafarers` rule module, which is why no base-game scenario
   * ever offers it: the module is only loaded when the scenario names it.
   */
  | { readonly t: "buildShip"; readonly player: PlayerId; readonly edge: EdgeId }
  /**
   * Move one ship with an open end to another legal edge (Seafarers p.2).
   *
   * At most one per turn, never a ship built this turn, and never one holding
   * together a route between two of your own buildings.
   */
  | {
      readonly t: "moveShip";
      readonly player: PlayerId;
      readonly from: EdgeId;
      readonly to: EdgeId;
    }
  /**
   * Take one card owed by a gold field (Seafarers p.2).
   *
   * One action per card rather than a single multi-card choice: it keeps the
   * enumeration in `legalMoves()` small and lets the bank be re-checked between
   * picks, since an earlier pick can empty it.
   */
  | {
      readonly t: "takeGold";
      readonly player: PlayerId;
      readonly resource: ResourceKind;
    };

export type ActionKind = Action["t"];

/** Why an action was refused. Returned by reduce rather than thrown. */
export interface Rejection {
  readonly ok: false;
  readonly reason: string;
  readonly action: Action;
}
