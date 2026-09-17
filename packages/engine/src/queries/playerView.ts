/**
 * playerView(state, playerId) — what one player is allowed to see.
 *
 * CLAUDE.md golden rule 5: hidden information is redacted server-side, and the
 * full state never leaves the server. Assume every player has devtools open.
 *
 * Hidden in the base game:
 *   - other players' resource cards (count only)
 *   - other players' unplayed development cards (count only)
 *   - the order and contents of the development card draw pile
 *   - the PRNG state, which would let a client predict every future roll
 */

import { publicVictoryPoints } from "./scores.js";
import { totalResources, type GameState, type PlayerId } from "../state/types.js";
import type { BoardGraph } from "../geometry/types.js";
import type { EdgeId, NodeId, TileId } from "../geometry/ids.js";
import type {
  Building,
  DevCardKind,
  ResourceCounts,
  Ship,
  SpecialCard,
} from "../state/types.js";
import type { Phase } from "../phases/types.js";

export interface PublicPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  /** Exact hand size is public: p.8 says players must answer truthfully. */
  readonly handSize: number;
  readonly devCardCount: number;
  readonly knightsPlayed: number;
  readonly pieces: {
    readonly roads: number;
    readonly settlements: number;
    readonly cities: number;
    /** Seafarers only; zero in a base game. */
    readonly ships: number;
  };
  readonly publicPoints: number;
}

export interface SelfPlayer extends PublicPlayer {
  readonly resources: ResourceCounts;
  readonly devCards: readonly {
    readonly kind: DevCardKind;
    readonly playable: boolean;
    readonly played: boolean;
  }[];
}

export interface PlayerView {
  readonly you: PlayerId;
  readonly scenarioId: string;
  readonly board: BoardGraph;
  readonly players: readonly PublicPlayer[];
  readonly self: SelfPlayer;
  readonly bank: ResourceCounts;
  readonly devDeckSize: number;
  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  /** Ships are public: they sit on the board like any other piece. */
  readonly ships: Readonly<Record<EdgeId, Ship>>;
  readonly robber: TileId;
  readonly pirate: TileId | null;
  readonly phase: Phase;
  readonly currentPlayer: PlayerId;
  readonly turn: number;
  readonly dice: readonly [number, number] | null;
  readonly longestRoad: SpecialCard;
  readonly largestArmy: SpecialCard;
  readonly winner: PlayerId | null;
}

export function playerView(state: GameState, you: PlayerId): PlayerView {
  const seat = state.players[you];
  if (seat === undefined) {
    throw new Error(`No such player: ${String(you)}`);
  }

  const players: PublicPlayer[] = state.players.map((other) => ({
    id: other.id,
    name: other.name,
    color: other.color,
    handSize: totalResources(other.resources),
    devCardCount: other.devCards.filter((card) => !card.played).length,
    knightsPlayed: other.knightsPlayed,
    pieces: other.pieces,
    publicPoints: publicVictoryPoints(state, other.id),
  }));

  const self: SelfPlayer = {
    ...(players[you] as PublicPlayer),
    resources: seat.resources,
    devCards: seat.devCards.map((card) => ({
      kind: card.kind,
      // p.7: a card bought this turn cannot be played this turn.
      playable:
        !card.played &&
        card.boughtOnTurn < state.turn &&
        !seat.playedDevCardThisTurn &&
        card.kind !== "victoryPoint",
      played: card.played,
    })),
  };

  return {
    you,
    scenarioId: state.scenarioId,
    board: state.board,
    players,
    self,
    bank: state.bank,
    // The count is public (p.5 says you cannot buy when the supply is empty);
    // the order is not.
    devDeckSize: state.devDeck.length,
    buildings: state.buildings,
    roads: state.roads,
    ships: state.ships,
    robber: state.robber,
    pirate: state.pirate,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    turn: state.turn,
    dice: state.dice,
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    winner: state.winner,
  };
}
