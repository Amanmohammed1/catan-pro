/**
 * The Event union: the record of what actually happened.
 *
 * CLAUDE.md golden rule 6 — the event log is the game log, the animation
 * trigger, the replay format and the reconnect mechanism. Events are therefore
 * append-only, fully self-describing, and never contain information a client
 * should not see. Anything secret (a stolen card's kind, a drawn dev card) is
 * carried in a redactable field that playerView() strips.
 */

import type { EdgeId, NodeId, TileId } from "../geometry/ids.js";
import type { ResourceKind } from "../scenario/types.js";
import type {
  BuildingKind,
  DevCardKind,
  PlayerId,
  ResourceCounts,
} from "../state/types.js";

export type GameEvent =
  | {
      readonly e: "gameStarted";
      readonly players: readonly PlayerId[];
      readonly seedHash: string;
    }
  | { readonly e: "turnStarted"; readonly player: PlayerId; readonly turn: number }
  | {
      readonly e: "diceRolled";
      readonly player: PlayerId;
      readonly dice: readonly [number, number];
      readonly total: number;
    }
  | {
      readonly e: "resourcesProduced";
      /** Per player, what they actually received after any bank shortage. */
      readonly gains: Readonly<Record<PlayerId, ResourceCounts>>;
      /** Resources the bank could not pay in full. Rules p.10. */
      readonly shortages: readonly ResourceKind[];
    }
  | { readonly e: "discardRequired"; readonly players: readonly PlayerId[] }
  | {
      readonly e: "discarded";
      readonly player: PlayerId;
      readonly resources: ResourceCounts;
    }
  | {
      readonly e: "robberMoved";
      readonly player: PlayerId;
      readonly from: TileId;
      readonly to: TileId;
    }
  | {
      readonly e: "cardStolen";
      readonly from: PlayerId;
      readonly to: PlayerId;
      /** Hidden from everyone except the two players involved. */
      readonly resource: ResourceKind | null;
    }
  | { readonly e: "stealSkipped"; readonly player: PlayerId; readonly why: string }
  | {
      readonly e: "builtRoad";
      readonly player: PlayerId;
      readonly edge: EdgeId;
      readonly free: boolean;
    }
  | {
      readonly e: "builtSettlement";
      readonly player: PlayerId;
      readonly node: NodeId;
      readonly free: boolean;
    }
  | { readonly e: "builtCity"; readonly player: PlayerId; readonly node: NodeId }
  | {
      readonly e: "devCardBought";
      readonly player: PlayerId;
      /** Hidden from other players. */
      readonly kind: DevCardKind | null;
      readonly remaining: number;
    }
  | {
      readonly e: "devCardPlayed";
      readonly player: PlayerId;
      readonly kind: DevCardKind;
    }
  | {
      readonly e: "yearOfPlentyTaken";
      readonly player: PlayerId;
      readonly resources: readonly ResourceKind[];
    }
  | {
      readonly e: "monopolyResolved";
      readonly player: PlayerId;
      readonly resource: ResourceKind;
      readonly taken: Readonly<Record<PlayerId, number>>;
    }
  | {
      readonly e: "bankTraded";
      readonly player: PlayerId;
      readonly give: ResourceKind;
      readonly giveCount: number;
      readonly receive: ResourceKind;
    }
  | {
      readonly e: "tradeOffered";
      readonly player: PlayerId;
      readonly give: ResourceCounts;
      readonly receive: ResourceCounts;
    }
  | {
      readonly e: "tradeResponded";
      readonly player: PlayerId;
      readonly accept: boolean;
    }
  | {
      readonly e: "tradeCountered";
      readonly player: PlayerId;
      /** From the counter-offering player's point of view. */
      readonly give: ResourceCounts;
      readonly receive: ResourceCounts;
    }
  | {
      readonly e: "tradeCompleted";
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly give: ResourceCounts;
      readonly receive: ResourceCounts;
    }
  | { readonly e: "tradeCancelled"; readonly player: PlayerId }
  | {
      readonly e: "roadBuildingEnded";
      readonly player: PlayerId;
      readonly placed: number;
    }
  | {
      readonly e: "longestRoadChanged";
      readonly from: PlayerId | null;
      readonly to: PlayerId | null;
      readonly length: number;
    }
  | {
      readonly e: "largestArmyChanged";
      readonly from: PlayerId | null;
      readonly to: PlayerId | null;
      readonly size: number;
    }
  | {
      readonly e: "buildingPlacedInSetup";
      readonly player: PlayerId;
      readonly node: NodeId;
      readonly kind: BuildingKind;
    }
  | {
      readonly e: "setupResourcesGranted";
      readonly player: PlayerId;
      readonly resources: ResourceCounts;
    }
  | {
      readonly e: "specialBuildStarted";
      /** Seats offered a window, in the order they get one. */
      readonly players: readonly PlayerId[];
    }
  | { readonly e: "specialBuildPassed"; readonly player: PlayerId }
  | {
      readonly e: "builtShip";
      readonly player: PlayerId;
      readonly edge: EdgeId;
      readonly free: boolean;
    }
  | {
      readonly e: "shipMoved";
      readonly player: PlayerId;
      readonly from: EdgeId;
      readonly to: EdgeId;
    }
  | {
      readonly e: "goldOwed";
      /** Cards each player may choose, from gold fields that produced (p.2). */
      readonly owed: Readonly<Record<PlayerId, number>>;
    }
  | {
      readonly e: "goldTaken";
      readonly player: PlayerId;
      readonly resource: ResourceKind;
    }
  | { readonly e: "gameEnded"; readonly winner: PlayerId; readonly points: number };

export type EventKind = GameEvent["e"];
