import {
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Action,
  type BoardGraph,
  type GameEvent,
  type PlayerId,
  type ResourceCounts,
} from "@hexport/engine";
import type { ChatLine, WireView } from "@hexport/protocol";

/**
 * What the game screen needs, however the game is being played.
 *
 * Hot-seat builds this locally from a GameState; online play receives it from
 * the server. Both go through the same redacted shape, which means the hot-seat
 * path exercises playerView() too — redaction bugs cannot hide behind "it only
 * matters online".
 */
export interface GameSession {
  readonly board: BoardGraph;
  readonly view: WireView;
  readonly log: readonly GameEvent[];
  readonly error: string | null;
  /** True when one screen is playing every seat. */
  readonly hotSeat: boolean;
  readonly dispatch: (action: Action) => void;
  readonly dismissError: () => void;
  /** Present online only. */
  readonly deadline?: number | null;
  readonly onChat?: ((text: string) => void) | undefined;
  readonly chat?: readonly ChatLine[] | undefined;
  /**
   * Play the same people again on a new board. Online this is the host's to
   * offer; hot-seat, anyone at the screen can start another.
   */
  readonly onRematch?: (() => void) | undefined;
}

export function seatColors(view: WireView): string[] {
  return view.players.map((p) => p.color);
}

export function playerNames(view: WireView): string[] {
  return view.players.map((p) => p.name);
}

/**
 * Best maritime rate per resource, derived from public board data.
 *
 * Harbours and buildings are public (p.9), so this is safe to compute on the
 * client. It is display only — the server still validates the rate on every
 * trade, and legalMoves already carries the rate it will accept.
 */
export function portRates(board: BoardGraph, view: WireView): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const kind of RESOURCE_KINDS) rates[kind] = 4;

  for (const [nodeId, building] of Object.entries(view.buildings)) {
    if (building.player !== view.you) continue;
    const portId = board.nodes[nodeId]?.port;
    if (portId == null) continue;
    const port = board.ports[portId];
    if (port === undefined) continue;

    if (port.kind === "generic") {
      for (const kind of RESOURCE_KINDS) {
        rates[kind] = Math.min(rates[kind] ?? 4, port.ratio);
      }
    } else if (port.resource !== null) {
      rates[port.resource] = Math.min(rates[port.resource] ?? 4, port.ratio);
    }
  }

  return rates;
}

/** Whether this player may open a domestic trade offer (p.4). See ADR 0003. */
export function canOffer(view: WireView): boolean {
  if (view.winner !== null) return false;
  if (view.phase.k !== "main") return false;
  if (view.currentPlayer !== view.you) return false;
  if (view.players.length < 2) return false;
  return totalResources(view.self.resources) > 0;
}

export function emptyHand(): ResourceCounts {
  return emptyResources();
}

/** Seats the game is waiting on, from this player's point of view. */
export function isWaitingOnYou(view: WireView): boolean {
  return view.legalMoves.length > 0;
}

export function describePrompt(view: WireView, you: PlayerId): string {
  switch (view.phase.k) {
    case "setup":
      return view.phase.sub === "settlement"
        ? `Place settlement ${String(view.phase.round)} of 2`
        : "Place an adjoining road";
    case "roll":
      return "Roll the dice";
    case "discard":
      return "Discard half your hand";
    case "moveRobber":
      return "Move the robber";
    case "steal":
      return "Choose someone to rob";
    case "main":
      return "Trade and build";
    case "specialBuild":
      return "Special building — build or buy";
    case "roadBuilding":
      return "Place your free roads";
    case "tradeOffer":
      return view.phase.offer.from === you
        ? "Waiting for answers"
        : "Answer the trade offer";
    case "gameOver":
      return "Game over";
    default:
      return "";
  }
}
