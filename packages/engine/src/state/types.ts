/**
 * Game state, players, and the resource economy.
 *
 * Rules references are to the 2020 Catan base game rules and almanac in
 * docs/rules/. Page numbers are cited wherever a rule is easy to get wrong.
 *
 * Everything here is plain, serializable data. GameState is the whole game: the
 * server holds it, playerView() redacts it, and reduce() returns a new one.
 */

import type { BoardGraph } from "../geometry/types.js";
import type { EdgeId, NodeId, TileId } from "../geometry/ids.js";
import type { ResourceKind } from "../scenario/types.js";
import type { RngState } from "../rng/sfc32.js";
import type { Phase } from "../phases/types.js";

/** Seat index, 0-based. Stable for the life of a match. */
export type PlayerId = number;

export const RESOURCE_KINDS = [
  "brick",
  "lumber",
  "wool",
  "grain",
  "ore",
] as const satisfies readonly ResourceKind[];

export type ResourceCounts = Record<ResourceKind, number>;

export function emptyResources(): ResourceCounts {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

export function totalResources(counts: ResourceCounts): number {
  let total = 0;
  for (const kind of RESOURCE_KINDS) total += counts[kind];
  return total;
}

/**
 * Building costs. Rules p.4-5.
 *   road       brick + lumber
 *   settlement brick + lumber + wool + grain
 *   city       3 ore + 2 grain
 *   dev card   ore + wool + grain
 */
export const COSTS = {
  road: { brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 },
  city: { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 },
  devCard: { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, ResourceCounts>;

export type BuildingKind = "settlement" | "city";

export interface Building {
  readonly kind: BuildingKind;
  readonly player: PlayerId;
}

/**
 * Development card deck. Rules p.2: 25 cards total — 14 knights, 6 progress
 * (2 each of the three kinds), 5 victory point.
 */
export type DevCardKind =
  "knight" | "roadBuilding" | "yearOfPlenty" | "monopoly" | "victoryPoint";

export const DEV_DECK_COMPOSITION: Readonly<Record<DevCardKind, number>> = {
  knight: 14,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
  victoryPoint: 5,
};

/**
 * A development card in a player's hand.
 *
 * `boughtOnTurn` exists to enforce the rule on p.5 and p.7: you may not play a
 * card you bought this turn. Victory point cards are exempt, which is why they
 * are never "played" at all, only counted.
 */
export interface DevCardHolding {
  readonly kind: DevCardKind;
  readonly boughtOnTurn: number;
  readonly played: boolean;
}

export interface PieceStock {
  readonly roads: number;
  readonly settlements: number;
  readonly cities: number;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  readonly resources: ResourceCounts;
  readonly devCards: readonly DevCardHolding[];
  /** Face-up knights. Drives Largest Army (p.8). */
  readonly knightsPlayed: number;
  readonly pieces: PieceStock;
  /** Rules p.7: at most one development card may be played per turn. */
  readonly playedDevCardThisTurn: boolean;
}

export interface SpecialCard {
  readonly player: PlayerId | null;
  readonly length: number;
}

export interface GameConfig {
  /** Rule modules in play, by id. Resolved through engine/modules. */
  readonly modules: readonly string[];
  readonly victoryPoints: number;
  /** Rules p.5: discard on more than 7 cards. */
  readonly handLimit: number;
  /** Rules p.4/p.9: minimum road length for the Longest Road card. */
  readonly minLongestRoad: number;
  /** Rules p.8: knights needed for Largest Army. */
  readonly minLargestArmy: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  modules: ["base"],
  victoryPoints: 10,
  handLimit: 7,
  minLongestRoad: 5,
  minLargestArmy: 3,
};

export interface GameState {
  readonly scenarioId: string;
  readonly board: BoardGraph;
  readonly config: GameConfig;
  readonly rng: RngState;

  readonly players: readonly PlayerState[];
  readonly bank: ResourceCounts;
  /** Face-down draw pile. Order is hidden information; playerView strips it. */
  readonly devDeck: readonly DevCardKind[];

  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly robber: TileId;

  readonly phase: Phase;
  readonly currentPlayer: PlayerId;
  /** Increments when the turn passes. Setup placements happen on turn 0. */
  readonly turn: number;
  readonly dice: readonly [number, number] | null;

  readonly longestRoad: SpecialCard;
  readonly largestArmy: SpecialCard;
  readonly winner: PlayerId | null;
}
