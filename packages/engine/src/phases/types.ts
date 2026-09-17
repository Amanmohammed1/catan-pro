/**
 * The phase state machine.
 *
 * CLAUDE.md golden rule: phase is an explicit tagged union, never a set of
 * boolean flags. Every legal move in the game is a function of the phase tag
 * plus the player, which is what keeps legalMoves() honest.
 *
 * Turn structure, rules p.4:
 *   roll -> (discard -> moveRobber -> steal, on a 7) -> main -> endTurn
 * A knight may be played before the roll (p.7), which enters moveRobber from
 * the `roll` phase and returns to it afterwards.
 */

import type { PlayerId, ResourceCounts } from "../state/types.js";

/** An offer on the table during the tradeOffer phase. */
export interface TradeOffer {
  readonly from: PlayerId;
  readonly give: ResourceCounts;
  readonly receive: ResourceCounts;
}

/**
 * How a player answered an open offer.
 *
 * "counter" means they answered with terms of their own, held in the phase's
 * `counters`. The offering player may then confirm either an acceptance or a
 * counter — both are a deal that player has already agreed to.
 */
export type TradeResponse = "pending" | "accept" | "decline" | "counter";

export type Phase =
  /**
   * Setup, rules p.12. Two rounds. Round one runs in seat order; round two runs
   * in reverse, so the starting player places last and plays first. Each
   * placement is a settlement followed by an adjoining road. The second
   * settlement pays out its adjacent hexes immediately.
   */
  | {
      readonly k: "setup";
      readonly round: 1 | 2;
      readonly order: readonly PlayerId[];
      readonly idx: number;
      readonly sub: "settlement" | "road";
      /** Node just placed, so the road must attach to it. */
      readonly lastSettlement: string | null;
    }
  /** Start of turn. The player must roll, but may play a knight first (p.7). */
  | { readonly k: "roll" }
  /** A 7 was rolled. Everyone over the hand limit discards (p.5). */
  | {
      readonly k: "discard";
      readonly pending: readonly PlayerId[];
      readonly reason: "seven";
    }
  /** Robber must move to a different hex (p.11). */
  | {
      readonly k: "moveRobber";
      readonly by: PlayerId;
      readonly reason: "seven" | "knight";
      /** Phase to return to once the robber resolves. */
      readonly returnTo: "roll" | "main";
    }
  /** Choose a victim among players with a building on the robber's hex (p.5). */
  | {
      readonly k: "steal";
      readonly by: PlayerId;
      readonly targets: readonly PlayerId[];
      readonly returnTo: "roll" | "main";
    }
  /** Trade and build freely (p.4). */
  | { readonly k: "main" }
  /**
   * Seafarers gold fields: take the resources you have earned, one at a time.
   *
   * Seafarers p.2: "Each player with a settlement on a gold field hex that
   * produces this turn receives 1 resource card of their choice... a player
   * receives 2 resource cards in any combination for each of their cities on
   * that hex." A choice cannot be paid out silently, so it becomes a phase and
   * `legalMoves()` enumerates it, exactly as Year of Plenty is enumerated.
   *
   * `remaining` counts the cards still owed to `player`. `queue` holds the
   * other players owed picks from the same roll, in seat order — production is
   * not limited to the player whose turn it is.
   */
  | {
      readonly k: "gainGold";
      readonly player: PlayerId;
      readonly remaining: number;
      readonly queue: readonly { readonly player: PlayerId; readonly count: number }[];
    }
  /** A domestic trade offer is open for responses (p.4, p.7). */
  | {
      readonly k: "tradeOffer";
      readonly offer: TradeOffer;
      readonly responses: Readonly<Record<PlayerId, TradeResponse>>;
      /**
       * Terms proposed back by a responder, keyed by that player. `give` and
       * `receive` are from the counter-offering player's point of view.
       */
      readonly counters: Readonly<Record<PlayerId, TradeOffer>>;
    }
  /**
   * Road Building progress card: two free roads (p.10).
   *
   * `returnTo` exists because p.7 allows a development card to be played before
   * the dice are rolled. Without it, playing this card pre-roll would drop the
   * player into the main phase afterwards and skip their roll entirely.
   */
  | {
      readonly k: "roadBuilding";
      readonly remaining: 1 | 2;
      readonly returnTo: "roll" | "main";
    }
  /**
   * The Special Building Phase of the 5–6 player game.
   *
   * After a turn ends, every other player in clockwise order gets one window in
   * which they may build and buy development cards — but not trade, and not
   * play a development card. Provided by the `ext56` rule module; a base game
   * never enters this phase. See ADR 0006.
   */
  | {
      readonly k: "specialBuild";
      /** Seats still owed a window, in clockwise order. The first is acting. */
      readonly queue: readonly PlayerId[];
      /** Whose turn begins once the queue empties. */
      readonly nextPlayer: PlayerId;
    }
  | { readonly k: "gameOver"; readonly winner: PlayerId };

export type PhaseKind = Phase["k"];
