/**
 * reduce(state, action) -> { state, events }
 *
 * The only way game state ever changes. Every mutation emits typed events
 * (golden rule 6), and every action is validated first (golden rule 3) using
 * the same predicates legalMoves() uses, so the two cannot drift apart.
 *
 * Rule references are to docs/rules/ (2020 base game).
 */

import { setupPlayerAt } from "../setup/createGame.js";
import {
  addResources,
  bestTradeRate,
  canAfford,
  countsFromList,
  isNonNegative,
  resourceList,
  singleResource,
  subtractResources,
} from "../state/helpers.js";
import {
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
} from "../queries/placement.js";
import { canPlayDevCard, discardCount } from "../queries/legalMoves.js";
import {
  interceptAction,
  moduleReduce,
  onDiceRoll,
  resolveModules,
  turnHandoff,
} from "../modules/index.js";
import { nextInt } from "../rng/sfc32.js";
import {
  applyProduction,
  computeProduction,
  returnToBank,
  setupYield,
} from "./production.js";
import { settle } from "./special.js";
import type { Action } from "../actions/types.js";
import type { GameEvent } from "../events/types.js";
import type { Phase } from "../phases/types.js";
import type { ResourceKind } from "../scenario/types.js";
import {
  COSTS,
  totalResources,
  type DevCardHolding,
  type DevCardKind,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ResourceCounts,
} from "../state/types.js";

export type ReduceResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
    }
  | { readonly ok: false; readonly reason: string; readonly action: Action };

function reject(action: Action, reason: string): ReduceResult {
  return { ok: false, reason, action };
}

function seatOf(state: GameState, player: PlayerId): PlayerState | undefined {
  return state.players[player];
}

function updateSeat(
  state: GameState,
  player: PlayerId,
  change: (seat: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: state.players.map((seat) => (seat.id === player ? change(seat) : seat)),
  };
}

function pay(state: GameState, player: PlayerId, cost: ResourceCounts): GameState {
  return {
    ...updateSeat(state, player, (seat) => ({
      ...seat,
      resources: subtractResources(seat.resources, cost),
    })),
    bank: addResources(state.bank, cost),
  };
}

/** Mark one unplayed copy of a development card as played (p.7). */
function consumeDevCard(
  seat: PlayerState,
  kind: DevCardKind,
  turn: number,
): readonly DevCardHolding[] {
  let done = false;
  return seat.devCards.map((card) => {
    if (done || card.played || card.kind !== kind) return card;
    if (card.boughtOnTurn >= turn) return card;
    done = true;
    return { ...card, played: true };
  });
}

/** Who acts next, and reset the per-turn development card flag (p.7). */
function beginNextTurn(state: GameState): GameState {
  const next = (state.currentPlayer + 1) % state.players.length;
  return {
    ...state,
    currentPlayer: next,
    turn: state.turn + 1,
    dice: null,
    phase: { k: "roll" },
    players: state.players.map((seat) => ({
      ...seat,
      playedDevCardThisTurn: false,
      movedShipThisTurn: false,
    })),
  };
}

/**
 * Enter the robber sequence: discards first if a 7 was rolled (p.5, p.11).
 */
function enterRobber(
  state: GameState,
  by: PlayerId,
  reason: "seven" | "knight",
  returnTo: "roll" | "main",
): { readonly state: GameState; readonly events: GameEvent[] } {
  const events: GameEvent[] = [];

  if (reason === "seven") {
    const pending = state.players
      .filter(
        (seat) =>
          discardCount(totalResources(seat.resources), state.config.handLimit) > 0,
      )
      .map((seat) => seat.id);

    if (pending.length > 0) {
      events.push({ e: "discardRequired", players: pending });
      return {
        state: { ...state, phase: { k: "discard", pending, reason: "seven" } },
        events,
      };
    }
  }

  return {
    state: { ...state, phase: { k: "moveRobber", by, reason, returnTo } },
    events,
  };
}

/** After the robber lands: choose a victim, or skip when there is none (p.5). */
function enterSteal(
  state: GameState,
  by: PlayerId,
  returnTo: "roll" | "main",
): { readonly state: GameState; readonly events: GameEvent[] } {
  const targets = new Set<PlayerId>();

  for (const nodeId of state.board.tiles[state.robber]?.nodes ?? []) {
    const building = state.buildings[nodeId];
    if (building === undefined) continue;
    if (building.player === by) continue;
    // p.8: "If that player has no cards, you get nothing!" A player with an
    // empty hand is not a useful target and is not offered.
    const seat = seatOf(state, building.player);
    if (seat === undefined || totalResources(seat.resources) === 0) continue;
    targets.add(building.player);
  }

  const list = [...targets].sort((a, b) => a - b);

  return {
    state: { ...state, phase: { k: "steal", by, targets: list, returnTo } },
    events: [],
  };
}

/** Return to the phase the robber interrupted. */
function resumeAfterRobber(state: GameState, returnTo: "roll" | "main"): Phase {
  return returnTo === "roll" ? { k: "roll" } : { k: "main" };
}

/**
 * Why this player may not build or buy right now, or null if they may.
 *
 * Two ways in: it is your turn and you are past the roll, or you hold the open
 * Special Building window of a 5–6 player game (ADR 0006). Trading and playing
 * development cards check the phase themselves and so stay shut out of a
 * window, which is the point of it.
 */
function whyNotBuilding(
  state: GameState,
  player: PlayerId,
  verb: "build" | "buy",
): string | null {
  const phase = state.phase;
  if (phase.k === "main") {
    return state.currentPlayer === player ? null : "Not your turn.";
  }
  if (phase.k === "specialBuild") {
    return phase.queue[0] === player ? null : "Not your building window.";
  }
  return `You cannot ${verb} right now.`;
}

// ---------------------------------------------------------------------------

export function reduce(state: GameState, action: Action): ReduceResult {
  if (state.winner !== null) {
    return reject(action, "The game is over.");
  }

  const seat = seatOf(state, action.player);
  if (seat === undefined) {
    return reject(action, `No such player: ${String(action.player)}.`);
  }

  // A module may narrow or refuse an action the base rules would allow, before
  // any of it is judged here (ADR 0007). Cities & Knights needs this for a
  // knight blocking a road; Seafarers for the pirate blocking ship placement.
  // A base game loads no module that intercepts, so `action` comes back as-is.
  const modules = resolveModules(state.config.modules);
  const intercepted = interceptAction(modules, state, action);
  if ("ok" in intercepted) {
    return { ok: false, reason: intercepted.reason, action: intercepted.action };
  }
  action = intercepted;

  const phase = state.phase;

  switch (action.t) {
    // ---- setup, p.12 ------------------------------------------------------
    case "setupSettlement": {
      if (phase.k !== "setup" || phase.sub !== "settlement") {
        return reject(action, "Not placing a setup settlement.");
      }
      if (setupPlayerAt(phase.order, phase.round, phase.idx) !== action.player) {
        return reject(action, "Not your placement.");
      }
      if (!canPlaceSettlement(state, action.player, action.node, { setup: true })) {
        return reject(action, "Illegal settlement placement.");
      }

      const placed: GameState = {
        ...updateSeat(state, action.player, (s) => ({
          ...s,
          pieces: { ...s.pieces, settlements: s.pieces.settlements - 1 },
        })),
        buildings: {
          ...state.buildings,
          [action.node]: { kind: "settlement", player: action.player },
        },
        phase: { ...phase, sub: "road", lastSettlement: action.node },
      };

      return {
        ok: true,
        state: placed,
        events: [
          {
            e: "buildingPlacedInSetup",
            player: action.player,
            node: action.node,
            kind: "settlement",
          },
        ],
      };
    }

    case "setupRoad": {
      if (phase.k !== "setup" || phase.sub !== "road") {
        return reject(action, "Not placing a setup road.");
      }
      if (setupPlayerAt(phase.order, phase.round, phase.idx) !== action.player) {
        return reject(action, "Not your placement.");
      }
      if (
        !canPlaceRoad(state, action.player, action.edge, {
          setup: true,
          mustTouch: phase.lastSettlement,
        })
      ) {
        return reject(action, "Setup road must touch the settlement just placed.");
      }

      const events: GameEvent[] = [
        { e: "builtRoad", player: action.player, edge: action.edge, free: true },
      ];

      let next: GameState = {
        ...updateSeat(state, action.player, (s) => ({
          ...s,
          pieces: { ...s.pieces, roads: s.pieces.roads - 1 },
        })),
        roads: { ...state.roads, [action.edge]: action.player },
      };

      // p.12: the second settlement pays out immediately.
      if (phase.round === 2 && phase.lastSettlement !== null) {
        const { gained, bank } = setupYield(next, phase.lastSettlement);
        next = {
          ...updateSeat(next, action.player, (s) => ({
            ...s,
            resources: addResources(s.resources, gained),
          })),
          bank,
        };
        events.push({
          e: "setupResourcesGranted",
          player: action.player,
          resources: gained,
        });
      }

      const count = phase.order.length;
      const nextIdx = phase.idx + 1;

      if (nextIdx < count) {
        const active = setupPlayerAt(phase.order, phase.round, nextIdx);
        next = {
          ...next,
          currentPlayer: active,
          phase: {
            k: "setup",
            round: phase.round,
            order: phase.order,
            idx: nextIdx,
            sub: "settlement",
            lastSettlement: null,
          },
        };
      } else if (phase.round === 1) {
        const active = setupPlayerAt(phase.order, 2, 0);
        next = {
          ...next,
          currentPlayer: active,
          phase: {
            k: "setup",
            round: 2,
            order: phase.order,
            idx: 0,
            sub: "settlement",
            lastSettlement: null,
          },
        };
      } else {
        // p.12: the starting player placed last and now takes the first turn.
        const first = phase.order[0] as PlayerId;
        next = {
          ...next,
          currentPlayer: first,
          turn: 1,
          phase: { k: "roll" },
        };
        events.push({ e: "turnStarted", player: first, turn: 1 });
      }

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [...events, ...settled.events],
      };
    }

    // ---- rolling, p.4 -----------------------------------------------------
    case "rollDice": {
      if (phase.k !== "roll") return reject(action, "Not the roll phase.");
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }

      const [a, afterA] = nextInt(state.rng, 6);
      const [b, afterB] = nextInt(afterA, 6);
      const dice: readonly [number, number] = [a + 1, b + 1];
      const total = dice[0] + dice[1];

      const events: GameEvent[] = [
        { e: "diceRolled", player: action.player, dice, total },
      ];

      let next: GameState = { ...state, rng: afterB, dice };

      // Modules see the roll before anything is paid out (ADR 0007). Cities &
      // Knights marches the barbarian ship here and may resolve an attack
      // (C&K p.6, p.11). No base-game module answers, so `next` is unchanged.
      const rolled = onDiceRoll(modules, next, { dice, total });
      next = rolled.state;
      events.push(...rolled.events);

      if (total === 7) {
        const robber = enterRobber(next, action.player, "seven", "main");
        return {
          ok: true,
          state: robber.state,
          events: [...events, ...robber.events],
        };
      }

      const production = computeProduction(next, total);
      next = applyProduction(next, production);
      events.push({
        e: "resourcesProduced",
        gains: production.gains,
        shortages: production.shortages,
      });

      next = { ...next, phase: { k: "main" } };
      return { ok: true, state: next, events };
    }

    // ---- the 7: discard, move, steal (p.5, p.11) --------------------------
    case "discard": {
      if (phase.k !== "discard") return reject(action, "Nothing to discard.");
      if (!phase.pending.includes(action.player)) {
        return reject(action, "You are not required to discard.");
      }
      if (!isNonNegative(action.resources)) {
        return reject(action, "Discard counts must not be negative.");
      }
      if (!canAfford(seat.resources, action.resources)) {
        return reject(action, "You cannot discard cards you do not hold.");
      }

      const need = discardCount(totalResources(seat.resources), state.config.handLimit);
      if (totalResources(action.resources) !== need) {
        return reject(action, `You must discard exactly ${String(need)} cards.`);
      }

      let next = returnToBank(state, action.player, action.resources);
      const pending = phase.pending.filter((id) => id !== action.player);
      const events: GameEvent[] = [
        { e: "discarded", player: action.player, resources: action.resources },
      ];

      if (pending.length > 0) {
        next = { ...next, phase: { ...phase, pending } };
        return { ok: true, state: next, events };
      }

      // p.11: after discarding, the roller moves the robber.
      next = {
        ...next,
        phase: {
          k: "moveRobber",
          by: state.currentPlayer,
          reason: "seven",
          returnTo: "main",
        },
      };
      return { ok: true, state: next, events };
    }

    case "moveRobber": {
      if (phase.k !== "moveRobber") return reject(action, "Not moving the robber.");
      if (phase.by !== action.player) return reject(action, "Not your robber move.");
      if (state.board.tiles[action.tile] === undefined) {
        return reject(action, "No such hex.");
      }
      // p.11: "You may not choose to leave the robber on the same hex."
      if (action.tile === state.robber) {
        return reject(action, "The robber must move to a different hex.");
      }

      const moved: GameState = { ...state, robber: action.tile };
      const events: GameEvent[] = [
        {
          e: "robberMoved",
          player: action.player,
          from: state.robber,
          to: action.tile,
        },
      ];

      const steal = enterSteal(moved, action.player, phase.returnTo);
      return {
        ok: true,
        state: steal.state,
        events: [...events, ...steal.events],
      };
    }

    case "steal": {
      if (phase.k !== "steal") return reject(action, "Not stealing.");
      if (phase.by !== action.player) return reject(action, "Not your steal.");

      const resumePhase = resumeAfterRobber(state, phase.returnTo);

      if (action.target === null) {
        if (phase.targets.length > 0) {
          return reject(action, "You must steal from an adjacent player.");
        }
        const settled = settle({ ...state, phase: resumePhase });
        return {
          ok: true,
          state: settled.state,
          events: [
            {
              e: "stealSkipped",
              player: action.player,
              why: "No adjacent opponent holds a card.",
            },
            ...settled.events,
          ],
        };
      }

      if (!phase.targets.includes(action.target)) {
        return reject(action, "That player is not adjacent to the robber.");
      }

      const victim = seatOf(state, action.target);
      if (victim === undefined) return reject(action, "No such player.");

      // p.5: "You then take 1 card at random."
      const hand = resourceList(victim.resources);
      if (hand.length === 0) return reject(action, "That player has no cards.");

      const [index, rng] = nextInt(state.rng, hand.length);
      const taken = hand[index] as ResourceKind;

      let next: GameState = { ...state, rng };
      next = updateSeat(next, action.target, (s) => ({
        ...s,
        resources: subtractResources(s.resources, singleResource(taken)),
      }));
      next = updateSeat(next, action.player, (s) => ({
        ...s,
        resources: addResources(s.resources, singleResource(taken)),
      }));
      next = { ...next, phase: resumePhase };

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          {
            e: "cardStolen",
            from: action.target,
            to: action.player,
            resource: taken,
          },
          ...settled.events,
        ],
      };
    }

    // ---- building, p.4-5 --------------------------------------------------
    case "buildRoad": {
      const isFree = phase.k === "roadBuilding";
      if (isFree) {
        if (state.currentPlayer !== action.player) {
          return reject(action, "Not your turn.");
        }
      } else {
        const refusal = whyNotBuilding(state, action.player, "build");
        if (refusal !== null) return reject(action, refusal);
      }
      if (!canPlaceRoad(state, action.player, action.edge, { setup: false })) {
        return reject(action, "Illegal road placement.");
      }
      if (!isFree && !canAfford(seat.resources, COSTS.road)) {
        return reject(action, "You cannot afford a road.");
      }

      let next: GameState = isFree ? state : pay(state, action.player, COSTS.road);
      next = {
        ...updateSeat(next, action.player, (s) => ({
          ...s,
          pieces: { ...s.pieces, roads: s.pieces.roads - 1 },
        })),
        roads: { ...next.roads, [action.edge]: action.player },
      };

      if (isFree) {
        // Road Building, p.10: two free roads, then back to whatever the card
        // interrupted — which may be the roll the player has not made yet.
        const remaining = phase.remaining - 1;
        next = {
          ...next,
          phase:
            remaining > 0
              ? { k: "roadBuilding", remaining: 1, returnTo: phase.returnTo }
              : resumeAfterRobber(next, phase.returnTo),
        };
      }

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          {
            e: "builtRoad",
            player: action.player,
            edge: action.edge,
            free: isFree,
          },
          ...settled.events,
        ],
      };
    }

    case "buildSettlement": {
      const refusal = whyNotBuilding(state, action.player, "build");
      if (refusal !== null) return reject(action, refusal);
      if (!canPlaceSettlement(state, action.player, action.node, { setup: false })) {
        return reject(action, "Illegal settlement placement.");
      }
      if (!canAfford(seat.resources, COSTS.settlement)) {
        return reject(action, "You cannot afford a settlement.");
      }

      let next = pay(state, action.player, COSTS.settlement);
      next = {
        ...updateSeat(next, action.player, (s) => ({
          ...s,
          pieces: { ...s.pieces, settlements: s.pieces.settlements - 1 },
        })),
        buildings: {
          ...next.buildings,
          [action.node]: { kind: "settlement", player: action.player },
        },
      };

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          {
            e: "builtSettlement",
            player: action.player,
            node: action.node,
            free: false,
          },
          ...settled.events,
        ],
      };
    }

    case "buildCity": {
      const refusal = whyNotBuilding(state, action.player, "build");
      if (refusal !== null) return reject(action, refusal);
      if (!canPlaceCity(state, action.player, action.node)) {
        return reject(action, "You can only upgrade your own settlement.");
      }
      if (!canAfford(seat.resources, COSTS.city)) {
        return reject(action, "You cannot afford a city.");
      }

      let next = pay(state, action.player, COSTS.city);
      // p.5: the settlement piece returns to your supply.
      next = {
        ...updateSeat(next, action.player, (s) => ({
          ...s,
          pieces: {
            ...s.pieces,
            settlements: s.pieces.settlements + 1,
            cities: s.pieces.cities - 1,
          },
        })),
        buildings: {
          ...next.buildings,
          [action.node]: { kind: "city", player: action.player },
        },
      };

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          { e: "builtCity", player: action.player, node: action.node },
          ...settled.events,
        ],
      };
    }

    case "buyDevCard": {
      const refusal = whyNotBuilding(state, action.player, "buy");
      if (refusal !== null) return reject(action, refusal);
      if (state.devDeck.length === 0) {
        return reject(action, "The development card deck is empty.");
      }
      if (!canAfford(seat.resources, COSTS.devCard)) {
        return reject(action, "You cannot afford a development card.");
      }

      const drawn = state.devDeck[0] as DevCardKind;
      let next = pay(state, action.player, COSTS.devCard);
      next = {
        ...updateSeat(next, action.player, (s) => ({
          ...s,
          devCards: [
            ...s.devCards,
            { kind: drawn, boughtOnTurn: state.turn, played: false },
          ],
        })),
        devDeck: state.devDeck.slice(1),
      };

      // p.7: a victory point card bought on the turn it wins the game counts
      // immediately, so the win check runs here like anywhere else.
      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          {
            e: "devCardBought",
            player: action.player,
            kind: drawn,
            remaining: next.devDeck.length,
          },
          ...settled.events,
        ],
      };
    }

    // ---- development cards, p.5 and p.10 ----------------------------------
    case "playKnight": {
      if (phase.k !== "roll" && phase.k !== "main") {
        return reject(action, "You cannot play a card right now.");
      }
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      if (!canPlayDevCard(state, action.player, "knight")) {
        return reject(action, "No playable knight.");
      }

      let next = updateSeat(state, action.player, (s) => ({
        ...s,
        devCards: consumeDevCard(s, "knight", state.turn),
        knightsPlayed: s.knightsPlayed + 1,
        playedDevCardThisTurn: true,
      }));

      const events: GameEvent[] = [
        { e: "devCardPlayed", player: action.player, kind: "knight" },
      ];

      // Largest Army can move the moment the knight is played (p.8).
      const cards = settle(next);
      next = cards.state;
      events.push(...cards.events);

      if (next.winner !== null) {
        return { ok: true, state: next, events };
      }

      const robber = enterRobber(
        next,
        action.player,
        "knight",
        phase.k === "roll" ? "roll" : "main",
      );
      return {
        ok: true,
        state: robber.state,
        events: [...events, ...robber.events],
      };
    }

    case "playRoadBuilding": {
      if (phase.k !== "main" && phase.k !== "roll") {
        return reject(action, "You cannot play a card right now.");
      }
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      if (!canPlayDevCard(state, action.player, "roadBuilding")) {
        return reject(action, "No playable Road Building card.");
      }

      const next = updateSeat(state, action.player, (s) => ({
        ...s,
        devCards: consumeDevCard(s, "roadBuilding", state.turn),
        playedDevCardThisTurn: true,
      }));

      // p.7 allows a card before the roll, so remember whether the dice are
      // still owed; otherwise the free roads would swallow the player's roll.
      const returnTo = phase.k === "roll" ? "roll" : "main";

      return {
        ok: true,
        state: { ...next, phase: { k: "roadBuilding", remaining: 2, returnTo } },
        events: [{ e: "devCardPlayed", player: action.player, kind: "roadBuilding" }],
      };
    }

    case "playYearOfPlenty": {
      if (phase.k !== "main" && phase.k !== "roll") {
        return reject(action, "You cannot play a card right now.");
      }
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      if (!canPlayDevCard(state, action.player, "yearOfPlenty")) {
        return reject(action, "No playable Year of Plenty card.");
      }

      const wanted = countsFromList(action.resources);
      if (!canAfford(state.bank, wanted)) {
        return reject(action, "The bank cannot supply those resources.");
      }

      let next = updateSeat(state, action.player, (s) => ({
        ...s,
        devCards: consumeDevCard(s, "yearOfPlenty", state.turn),
        resources: addResources(s.resources, wanted),
        playedDevCardThisTurn: true,
      }));
      next = { ...next, bank: subtractResources(next.bank, wanted) };

      const settled = settle(next);
      return {
        ok: true,
        state: settled.state,
        events: [
          { e: "devCardPlayed", player: action.player, kind: "yearOfPlenty" },
          {
            e: "yearOfPlentyTaken",
            player: action.player,
            resources: action.resources,
          },
          ...settled.events,
        ],
      };
    }

    case "playMonopoly": {
      if (phase.k !== "main" && phase.k !== "roll") {
        return reject(action, "You cannot play a card right now.");
      }
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      if (!canPlayDevCard(state, action.player, "monopoly")) {
        return reject(action, "No playable Monopoly card.");
      }

      // p.10: every other player hands over all cards of the named resource.
      const taken: Record<PlayerId, number> = {};
      let total = 0;
      for (const other of state.players) {
        if (other.id === action.player) continue;
        const amount = other.resources[action.resource];
        if (amount > 0) {
          taken[other.id] = amount;
          total += amount;
        }
      }

      let next: GameState = {
        ...state,
        players: state.players.map((s) => {
          if (s.id === action.player) {
            return {
              ...s,
              devCards: consumeDevCard(s, "monopoly", state.turn),
              resources: addResources(
                s.resources,
                singleResource(action.resource, total),
              ),
              playedDevCardThisTurn: true,
            };
          }
          const amount = s.resources[action.resource];
          if (amount === 0) return s;
          return {
            ...s,
            resources: subtractResources(
              s.resources,
              singleResource(action.resource, amount),
            ),
          };
        }),
      };

      const settled = settle(next);
      next = settled.state;

      return {
        ok: true,
        state: next,
        events: [
          { e: "devCardPlayed", player: action.player, kind: "monopoly" },
          {
            e: "monopolyResolved",
            player: action.player,
            resource: action.resource,
            taken,
          },
          ...settled.events,
        ],
      };
    }

    // ---- trade, p.4 and p.7 ------------------------------------------------
    case "bankTrade": {
      if (phase.k !== "main") return reject(action, "You cannot trade right now.");
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      // p.7: "you cannot ... trade matching resources."
      if (action.give === action.receive) {
        return reject(action, "You cannot trade a resource for itself.");
      }

      const rate = bestTradeRate(state, action.player, action.give);
      if (action.rate !== rate) {
        return reject(
          action,
          `Your best rate for ${action.give} is ${String(rate)}:1.`,
        );
      }
      if (seat.resources[action.give] < rate) {
        return reject(action, "Not enough cards to trade.");
      }
      if (state.bank[action.receive] < 1) {
        return reject(action, "The bank has none of that resource.");
      }

      let next = updateSeat(state, action.player, (s) => ({
        ...s,
        resources: addResources(
          subtractResources(s.resources, singleResource(action.give, rate)),
          singleResource(action.receive),
        ),
      }));
      next = {
        ...next,
        bank: addResources(
          subtractResources(next.bank, singleResource(action.receive)),
          singleResource(action.give, rate),
        ),
      };

      return {
        ok: true,
        state: next,
        events: [
          {
            e: "bankTraded",
            player: action.player,
            give: action.give,
            giveCount: rate,
            receive: action.receive,
          },
        ],
      };
    }

    case "offerTrade": {
      if (phase.k !== "main") return reject(action, "You cannot trade right now.");
      if (state.currentPlayer !== action.player) {
        return reject(action, "Only the active player may open a trade.");
      }
      if (!isNonNegative(action.give) || !isNonNegative(action.receive)) {
        return reject(action, "Trade amounts must not be negative.");
      }
      if (totalResources(action.give) === 0 || totalResources(action.receive) === 0) {
        return reject(action, "A trade must have something on both sides.");
      }
      if (!canAfford(seat.resources, action.give)) {
        return reject(action, "You do not hold what you are offering.");
      }

      const responses: Record<PlayerId, "pending"> = {};
      for (const other of state.players) {
        if (other.id !== action.player) responses[other.id] = "pending";
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: {
            k: "tradeOffer",
            offer: {
              from: action.player,
              give: action.give,
              receive: action.receive,
            },
            responses,
            counters: {},
          },
        },
        events: [
          {
            e: "tradeOffered",
            player: action.player,
            give: action.give,
            receive: action.receive,
          },
        ],
      };
    }

    case "respondTrade": {
      if (phase.k !== "tradeOffer") return reject(action, "No trade is open.");
      if (action.player === phase.offer.from) {
        return reject(action, "You cannot respond to your own offer.");
      }
      if (phase.responses[action.player] === undefined) {
        return reject(action, "You are not part of this trade.");
      }
      if (action.accept && !canAfford(seat.resources, phase.offer.receive)) {
        return reject(action, "You cannot pay for that trade.");
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: {
            ...phase,
            responses: {
              ...phase.responses,
              [action.player]: action.accept ? "accept" : "decline",
            },
          },
        },
        events: [{ e: "tradeResponded", player: action.player, accept: action.accept }],
      };
    }

    /**
     * Answer an offer with terms of your own (p.4: players haggle). Like
     * `offerTrade` this is validated rather than enumerated — ADR 0003 — and a
     * counter counts as that player's answer, so the offering player can
     * confirm it exactly as they would an acceptance.
     */
    case "counterTrade": {
      if (phase.k !== "tradeOffer") return reject(action, "No trade is open.");
      if (action.player === phase.offer.from) {
        return reject(action, "You cannot counter your own offer.");
      }
      if (phase.responses[action.player] === undefined) {
        return reject(action, "You are not part of this trade.");
      }
      if (!isNonNegative(action.give) || !isNonNegative(action.receive)) {
        return reject(action, "Trade amounts must not be negative.");
      }
      if (totalResources(action.give) === 0 || totalResources(action.receive) === 0) {
        return reject(action, "A trade must have something on both sides.");
      }
      if (!canAfford(seat.resources, action.give)) {
        return reject(action, "You do not hold what you are offering.");
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: {
            ...phase,
            responses: { ...phase.responses, [action.player]: "counter" },
            counters: {
              ...phase.counters,
              [action.player]: {
                from: action.player,
                give: action.give,
                receive: action.receive,
              },
            },
          },
        },
        events: [
          {
            e: "tradeCountered",
            player: action.player,
            give: action.give,
            receive: action.receive,
          },
        ],
      };
    }

    case "confirmTrade": {
      if (phase.k !== "tradeOffer") return reject(action, "No trade is open.");
      if (action.player !== phase.offer.from) {
        return reject(action, "Only the offering player may confirm.");
      }
      const answer = phase.responses[action.with];
      if (answer !== "accept" && answer !== "counter") {
        return reject(action, "That player has not accepted.");
      }

      // A counter is that player's own terms, stated from their side; flip it
      // to read from the offering player's side and the swap below is the same.
      const counter = phase.counters[action.with];
      const terms =
        answer === "counter" && counter !== undefined
          ? { give: counter.receive, receive: counter.give }
          : { give: phase.offer.give, receive: phase.offer.receive };

      const partner = seatOf(state, action.with);
      if (partner === undefined) return reject(action, "No such player.");
      if (!canAfford(seat.resources, terms.give)) {
        return reject(action, "You no longer hold what you offered.");
      }
      if (!canAfford(partner.resources, terms.receive)) {
        return reject(action, "They no longer hold what they offered.");
      }

      const next: GameState = {
        ...state,
        players: state.players.map((s) => {
          if (s.id === action.player) {
            return {
              ...s,
              resources: addResources(
                subtractResources(s.resources, terms.give),
                terms.receive,
              ),
            };
          }
          if (s.id === action.with) {
            return {
              ...s,
              resources: addResources(
                subtractResources(s.resources, terms.receive),
                terms.give,
              ),
            };
          }
          return s;
        }),
        phase: { k: "main" },
      };

      return {
        ok: true,
        state: next,
        events: [
          {
            e: "tradeCompleted",
            from: action.player,
            to: action.with,
            give: phase.offer.give,
            receive: phase.offer.receive,
          },
        ],
      };
    }

    case "endRoadBuilding": {
      if (phase.k !== "roadBuilding") {
        return reject(action, "You are not placing free roads.");
      }
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }
      // p.10 places the roads "according to normal building rules", which can
      // leave fewer than two legal spots. Ending early is then the only move.
      return {
        ok: true,
        state: { ...state, phase: resumeAfterRobber(state, phase.returnTo) },
        events: [
          {
            e: "roadBuildingEnded",
            player: action.player,
            placed: 2 - phase.remaining,
          },
        ],
      };
    }

    case "cancelTrade": {
      if (phase.k !== "tradeOffer") return reject(action, "No trade is open.");
      if (action.player !== phase.offer.from) {
        return reject(action, "Only the offering player may cancel.");
      }
      return {
        ok: true,
        state: { ...state, phase: { k: "main" } },
        events: [{ e: "tradeCancelled", player: action.player }],
      };
    }

    // ---- end of turn, p.4 -------------------------------------------------
    case "endTurn": {
      if (phase.k !== "main") return reject(action, "You cannot end your turn now.");
      if (state.currentPlayer !== action.player) {
        return reject(action, "Not your turn.");
      }

      // A module may interpose a phase between turns. The 5–6 extension puts
      // the Special Building Phase here; the base game puts nothing.
      const nextPlayer = (state.currentPlayer + 1) % state.players.length;
      const handoff = turnHandoff(modules, state, nextPlayer);
      if (handoff !== null) {
        return {
          ok: true,
          state: { ...state, phase: handoff.phase },
          events: handoff.events,
        };
      }

      const next = beginNextTurn(state);
      return {
        ok: true,
        state: next,
        events: [{ e: "turnStarted", player: next.currentPlayer, turn: next.turn }],
      };
    }

    // ---- the 5–6 Special Building Phase, ADR 0006 --------------------------
    case "passSpecialBuild": {
      if (phase.k !== "specialBuild") {
        return reject(action, "No building window is open.");
      }
      if (phase.queue[0] !== action.player) {
        return reject(action, "Not your building window.");
      }

      const rest = phase.queue.slice(1);
      const passed: GameEvent = { e: "specialBuildPassed", player: action.player };

      if (rest.length > 0) {
        return {
          ok: true,
          state: {
            ...state,
            phase: { k: "specialBuild", queue: rest, nextPlayer: phase.nextPlayer },
          },
          events: [passed],
        };
      }

      // The last window closes; the next player's turn begins.
      const resumed = beginNextTurn(state);
      return {
        ok: true,
        state: resumed,
        events: [
          passed,
          { e: "turnStarted", player: resumed.currentPlayer, turn: resumed.turn },
        ],
      };
    }

    default: {
      // Not a base-game action. A loaded module may own this kind — the
      // Seafarers ship actions and the Cities & Knights knight actions are
      // reduced by their own modules (ADR 0007). Falling through to a rejection
      // is still the answer when nobody claims it.
      const handled = moduleReduce(modules, state, action);
      if (handled === null) return reject(action, "Unknown action.");
      if ("ok" in handled) {
        return { ok: false, reason: handled.reason, action: handled.action };
      }
      // Special cards and the win check run here rather than inside the module:
      // `settle()` reaches queries/scores, which reaches the module registry, so
      // a module calling it would close an import cycle.
      const settled = settle(handled.state);
      return {
        ok: true,
        state: settled.state,
        events: [...handled.events, ...settled.events],
      };
    }
  }
}

/** Apply a sequence of actions, stopping at the first rejection. */
export function reduceMany(state: GameState, actions: readonly Action[]): ReduceResult {
  let current = state;
  const events: GameEvent[] = [];

  for (const action of actions) {
    const result = reduce(current, action);
    if (!result.ok) return result;
    current = result.state;
    events.push(...result.events);
  }

  return { ok: true, state: current, events };
}
