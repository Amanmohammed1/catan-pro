/**
 * legalMoves() — the single source of truth (CLAUDE.md golden rule 3).
 *
 * The UI derives every enabled button and every highlighted spot from this.
 * Bots pick from it. The fuzzer draws from it. The reducer rejects anything not
 * in it. There is deliberately no second opinion anywhere else in the codebase.
 *
 * Rule references are to docs/rules/ (2020 base game).
 */

import { setupPlayerAt } from "../setup/createGame.js";
import { bestTradeRate, canAfford } from "../state/helpers.js";
import { citySpots, roadSpots, settlementSpots } from "./placement.js";
import type { Action } from "../actions/types.js";
import type { ResourceKind } from "../scenario/types.js";
import {
  COSTS,
  RESOURCE_KINDS,
  totalResources,
  type DevCardKind,
  type GameState,
  type PlayerId,
} from "../state/types.js";

/** Playable development cards, excluding victory point cards (p.7). */
const PLAYABLE_DEV_CARDS: readonly DevCardKind[] = [
  "knight",
  "roadBuilding",
  "yearOfPlenty",
  "monopoly",
];

/**
 * Does this player hold a playable copy of `kind`?
 *
 * Rules p.5 and p.7: one development card per turn, and never one bought on the
 * same turn. Victory point cards are exempt because they are revealed, not
 * played.
 */
export function canPlayDevCard(
  state: GameState,
  player: PlayerId,
  kind: DevCardKind,
): boolean {
  const seat = state.players[player];
  if (seat === undefined) return false;
  if (seat.playedDevCardThisTurn) return false;

  return seat.devCards.some(
    (card) => card.kind === kind && !card.played && card.boughtOnTurn < state.turn,
  );
}

function devCardActions(state: GameState, player: PlayerId): Action[] {
  const out: Action[] = [];

  for (const kind of PLAYABLE_DEV_CARDS) {
    if (!canPlayDevCard(state, player, kind)) continue;

    switch (kind) {
      case "knight":
        out.push({ t: "playKnight", player });
        break;

      case "roadBuilding": {
        // Rules p.10: the two roads follow normal building rules. There is no
        // point offering the card with nowhere to put a road.
        if (roadSpots(state, player, { setup: false }).length > 0) {
          out.push({ t: "playRoadBuilding", player });
        }
        break;
      }

      case "yearOfPlenty": {
        // Any two resources from the supply, same or different (p.10). The bank
        // must actually hold them.
        for (const a of RESOURCE_KINDS) {
          for (const b of RESOURCE_KINDS) {
            if (b < a) continue; // unordered pair
            const needed = a === b ? 2 : 1;
            if (state.bank[a] < needed) continue;
            if (a !== b && state.bank[b] < 1) continue;
            out.push({ t: "playYearOfPlenty", player, resources: [a, b] });
          }
        }
        break;
      }

      case "monopoly": {
        for (const resource of RESOURCE_KINDS) {
          out.push({ t: "playMonopoly", player, resource });
        }
        break;
      }

      default:
        break;
    }
  }

  return out;
}

function buildActions(state: GameState, player: PlayerId): Action[] {
  const out: Action[] = [];
  const seat = state.players[player];
  if (seat === undefined) return out;

  if (canAfford(seat.resources, COSTS.road)) {
    for (const edge of roadSpots(state, player, { setup: false })) {
      out.push({ t: "buildRoad", player, edge });
    }
  }

  if (canAfford(seat.resources, COSTS.settlement)) {
    for (const node of settlementSpots(state, player, false)) {
      out.push({ t: "buildSettlement", player, node });
    }
  }

  if (canAfford(seat.resources, COSTS.city)) {
    for (const node of citySpots(state, player)) {
      out.push({ t: "buildCity", player, node });
    }
  }

  // Rules p.5: "you cannot buy development cards if the supply is empty."
  if (canAfford(seat.resources, COSTS.devCard) && state.devDeck.length > 0) {
    out.push({ t: "buyDevCard", player });
  }

  return out;
}

function tradeActions(state: GameState, player: PlayerId): Action[] {
  const out: Action[] = [];
  const seat = state.players[player];
  if (seat === undefined) return out;

  // Maritime trade, p.4. 4:1 always; better with a harbor.
  for (const give of RESOURCE_KINDS) {
    const rate = bestTradeRate(state, player, give);
    if (seat.resources[give] < rate) continue;

    for (const receive of RESOURCE_KINDS) {
      // p.7 forbids trading a resource for itself.
      if (receive === give) continue;
      if (state.bank[receive] < 1) continue;
      out.push({ t: "bankTrade", player, give, receive, rate });
    }
  }

  return out;
}

/**
 * Can this player open a domestic trade offer? Rules p.4.
 *
 * Trade offers are the one action legalMoves() does not enumerate. The space of
 * offers is every pair of resource multisets, which is unbounded in practice,
 * so listing them is not useful to a UI or a bot. Instead the UI asks this, then
 * sends an `offerTrade` whose contents reduce() validates exactly as strictly as
 * any enumerated move. That keeps the reducer the only authority, which is what
 * golden rule 3 is protecting.
 */
/**
 * May this player answer an open offer with terms of their own?
 *
 * The same judgement as `canOfferTrade`, for the same reason: the space of
 * counter-offers is every pair of resource multisets, so the UI asks "may I do
 * this?" and `reduce()` validates the contents (ADR 0003).
 */
export function canCounterTrade(state: GameState, player: PlayerId): boolean {
  if (state.winner !== null) return false;
  if (state.phase.k !== "tradeOffer") return false;
  if (state.phase.offer.from === player) return false;
  if (state.phase.responses[player] === undefined) return false;
  const seat = state.players[player];
  if (seat === undefined) return false;
  return totalResources(seat.resources) > 0;
}

export function canOfferTrade(state: GameState, player: PlayerId): boolean {
  if (state.winner !== null) return false;
  if (state.phase.k !== "main") return false;
  if (state.currentPlayer !== player) return false;
  const seat = state.players[player];
  if (seat === undefined) return false;
  if (state.players.length < 2) return false;
  return totalResources(seat.resources) > 0;
}

/**
 * Every action `player` may legally take in the current state.
 *
 * Returns an empty list when it is not this player's turn to act, which is the
 * normal case for three of the four seats.
 */
export function legalMoves(state: GameState, player: PlayerId): Action[] {
  if (state.winner !== null) return [];
  const seat = state.players[player];
  if (seat === undefined) return [];

  const phase = state.phase;

  switch (phase.k) {
    case "setup": {
      const active = setupPlayerAt(phase.order, phase.round, phase.idx);
      if (active !== player) return [];

      if (phase.sub === "settlement") {
        return settlementSpots(state, player, true).map((node) => ({
          t: "setupSettlement" as const,
          player,
          node,
        }));
      }

      return roadSpots(state, player, {
        setup: true,
        mustTouch: phase.lastSettlement,
      }).map((edge) => ({ t: "setupRoad" as const, player, edge }));
    }

    case "roll": {
      if (state.currentPlayer !== player) return [];
      // Rules p.7: "You can play the card at any time, even before you roll."
      // Only a knight is useful before the roll, but the rule is general, so
      // every playable card is offered.
      return [{ t: "rollDice", player }, ...devCardActions(state, player)];
    }

    case "discard": {
      // Rules p.5: everyone over the limit discards, in any order.
      if (!phase.pending.includes(player)) return [];
      return discardOptions(state, player);
    }

    case "moveRobber": {
      if (phase.by !== player) return [];
      // p.11: "The robber must be moved. You may not choose to leave the robber
      // on the same hex."
      return Object.keys(state.board.tiles)
        .filter((tile) => tile !== state.robber)
        .map((tile) => ({ t: "moveRobber" as const, player, tile }));
    }

    case "steal": {
      if (phase.by !== player) return [];
      if (phase.targets.length === 0) {
        return [{ t: "steal", player, target: null }];
      }
      return phase.targets.map((target) => ({
        t: "steal" as const,
        player,
        target,
      }));
    }

    case "main": {
      if (state.currentPlayer !== player) return [];
      return [
        ...buildActions(state, player),
        ...tradeActions(state, player),
        ...devCardActions(state, player),
        { t: "endTurn", player },
      ];
    }

    case "roadBuilding": {
      if (state.currentPlayer !== player) return [];
      const spots = roadSpots(state, player, { setup: false });
      if (spots.length === 0) {
        // Nowhere left to build: p.10 places the roads "according to normal
        // building rules", which may allow fewer than two.
        return [{ t: "endRoadBuilding", player }];
      }
      return spots.map((edge) => ({ t: "buildRoad" as const, player, edge }));
    }

    case "tradeOffer": {
      if (phase.offer.from === player) {
        // Both an acceptance and a counter are terms the other player has
        // already agreed to, so both are confirmable.
        const accepted = Object.entries(phase.responses)
          .filter(([, response]) => response === "accept" || response === "counter")
          .map(([seatId]) => Number(seatId));

        return [
          ...accepted.map((other) => ({
            t: "confirmTrade" as const,
            player,
            with: other,
          })),
          { t: "cancelTrade", player },
        ];
      }

      if (phase.responses[player] !== "pending") return [];
      // Only a player who can actually pay may accept.
      const canPay = canAfford(seat.resources, phase.offer.receive);
      const out: Action[] = [{ t: "respondTrade", player, accept: false }];
      if (canPay) out.unshift({ t: "respondTrade", player, accept: true });
      return out;
    }

    case "specialBuild": {
      // The 5–6 Special Building Phase: build and buy, nothing else. No trade
      // of any kind and no development card may be played (ADR 0006).
      if (phase.queue[0] !== player) return [];
      return [...buildActions(state, player), { t: "passSpecialBuild", player }];
    }

    case "gameOver":
      return [];

    default:
      return [];
  }
}

/**
 * Legal discard selections. Rules p.5: discard half, rounded down.
 *
 * The full set of combinations is large for a big hand, so this enumerates them
 * lazily up to a cap; bots and the fuzzer only need a valid selection, and the
 * UI builds its own from the player's clicks. The reducer validates the exact
 * count independently, so a client is never trusted to pick correctly.
 */
export function discardCount(handSize: number, limit: number): number {
  return handSize > limit ? Math.floor(handSize / 2) : 0;
}

function discardOptions(state: GameState, player: PlayerId): Action[] {
  const seat = state.players[player];
  if (seat === undefined) return [];

  const total = totalResources(seat.resources);
  const need = discardCount(total, state.config.handLimit);
  if (need === 0) return [];

  const combos = enumerateDiscards(seat.resources, need, 200);
  return combos.map((resources) => ({
    t: "discard" as const,
    player,
    resources,
  }));
}

/** Distinct multisets of size `need` drawn from a hand, capped at `limit`. */
export function enumerateDiscards(
  hand: Readonly<Record<ResourceKind, number>>,
  need: number,
  limit: number,
): Record<ResourceKind, number>[] {
  const out: Record<ResourceKind, number>[] = [];
  const kinds = RESOURCE_KINDS;
  const current = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

  const walk = (index: number, remaining: number): void => {
    if (out.length >= limit) return;
    if (remaining === 0) {
      out.push({ ...current });
      return;
    }
    if (index >= kinds.length) return;

    const kind = kinds[index] as ResourceKind;
    const max = Math.min(hand[kind], remaining);
    for (let take = max; take >= 0; take--) {
      current[kind] = take;
      walk(index + 1, remaining - take);
      current[kind] = 0;
      if (out.length >= limit) return;
    }
  };

  walk(0, need);
  return out;
}
