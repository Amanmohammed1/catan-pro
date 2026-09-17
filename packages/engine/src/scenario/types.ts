/**
 * Scenario definition types.
 *
 * These live in the engine rather than in packages/scenarios so that the
 * dependency runs scenarios -> engine, never the reverse. The engine stays a
 * leaf that imports nothing (golden rule 1); packages/scenarios owns the zod
 * schema and is the only place raw JSON is trusted.
 *
 * The shape is built to express an irregular Seafarers sea board, not the
 * classic 19-tile layout with islands bolted on later. Five choices carry that:
 *
 *   1. Cells are enumerated explicitly. Nothing derives from a board radius, so
 *      ragged coastlines and disjoint islands need no special case.
 *   2. A cell's slot (what may fill it) is separate from its terrain (what does
 *      fill it). Classic randomises every land slot; Seafarers pins most cells
 *      and randomises a few. One mechanism covers both.
 *   3. Number placement follows an explicit path, because a spiral over an
 *      irregular island cannot be computed generically.
 *   4. Ports anchor to a hex plus a direction 0-5, never to a node id. Node ids
 *      are derived, so authoring against them would be circular.
 *   5. Edge land/sea/coast classification is computed from slots, never authored.
 */

import type { Axial } from "../geometry/coords.js";

/** The five tradeable resources. */
export type ResourceKind = "brick" | "lumber" | "wool" | "grain" | "ore";

/** Terrain that can occupy a cell. */
export type Terrain =
  | "hill" // brick
  | "forest" // lumber
  | "pasture" // wool
  | "field" // grain
  | "mountain" // ore
  | "desert" // nothing
  | "gold" // any, Seafarers
  | "sea";

/** What kind of content a cell may hold. */
export type SlotKind = "land" | "sea";

/** Terrain to resource. Desert, sea and gold produce nothing on their own. */
export const TERRAIN_RESOURCE: Readonly<Record<Terrain, ResourceKind | null>> = {
  hill: "brick",
  forest: "lumber",
  pasture: "wool",
  field: "grain",
  mountain: "ore",
  desert: null,
  gold: null,
  sea: null,
};

export const LAND_TERRAINS: readonly Terrain[] = [
  "hill",
  "forest",
  "pasture",
  "field",
  "mountain",
  "desert",
  "gold",
];

export function isLandTerrain(terrain: Terrain): boolean {
  return terrain !== "sea";
}

/** One hex position the board contains. */
export interface ScenarioCell {
  readonly coord: Axial;
  readonly slot: SlotKind;
  /** Pinned terrain. Omitted means "draw from the bag named by `bag`". */
  readonly terrain?: Terrain;
  /** Pinned number token. Omitted means "take the next one off the path". */
  readonly number?: number;
  /** Which bag fills this cell when terrain is not pinned. Defaults to slot. */
  readonly bag?: string;
  /** Island grouping, used by Seafarers scoring. */
  readonly island?: string;
}

export interface TerrainBagEntry {
  readonly terrain: Terrain;
  readonly count: number;
}

export interface TerrainBag {
  readonly terrain: readonly TerrainBagEntry[];
}

export interface NumberConstraints {
  /** Forbid 6 and 8 on adjacent tiles. */
  readonly noAdjacentRedNumbers?: boolean;
}

export interface NumberBagEntry {
  readonly value: number;
  readonly count: number;
}

/**
 * How number tokens are laid down.
 *
 * `path` walks a fixed sequence, which is how the base game's lettered tokens
 * work: A to R in order along the spiral. `bag` shuffles a declared multiset of
 * tokens with the game's own generator first — used where the box's letter
 * order is not something we can cite (see ADR 0006), but the composition is.
 * Both walk the same path and skip the same terrains.
 */
export type ScenarioNumbers =
  | {
      readonly mode: "path";
      /** Tokens in the order they are laid down. */
      readonly sequence: readonly number[];
      /** Cell coordinates in the order they receive tokens. */
      readonly path: readonly Axial[];
      /** Terrains that are skipped without consuming a token. */
      readonly skipTerrains: readonly Terrain[];
      readonly constraints?: NumberConstraints;
    }
  | {
      readonly mode: "bag";
      /** The tokens in the box, shuffled before they are laid down. */
      readonly tokens: readonly NumberBagEntry[];
      readonly path: readonly Axial[];
      readonly skipTerrains: readonly Terrain[];
      readonly constraints?: NumberConstraints;
    };

export interface ScenarioPort {
  /** The hex the port sits against. */
  readonly at: Axial;
  /** Which of that hex's six edges carries the port. */
  readonly edgeDir: 0 | 1 | 2 | 3 | 4 | 5;
  readonly kind: "generic" | "resource";
  readonly resource?: ResourceKind;
  readonly ratio: number;
}

export interface ScenarioIsland {
  readonly id: string;
  /** Seafarers: victory points for the first settlement on this island. */
  readonly vpForFirstSettlement: number;
}

/** Seafarers face-down exploration tiles. Genuine hidden information. */
export interface HiddenStack {
  readonly id: string;
  readonly cells: readonly Axial[];
  readonly contents: readonly Terrain[];
}

export interface StartingPiece {
  readonly player: number;
  readonly kind: "settlement" | "city" | "road" | "ship";
  /** Node id for buildings, edge id for roads and ships, resolved at build time. */
  readonly at: Axial;
  readonly corner?: 0 | 1 | 2 | 3 | 4 | 5;
  readonly edgeDir?: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface PieceCounts {
  readonly roads: number;
  readonly settlements: number;
  readonly cities: number;
  readonly ships: number;
}

export interface ScenarioSetup {
  readonly mode: "snakeDraft";
  readonly rounds: number;
  readonly placeOn: readonly SlotKind[];
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly players: { readonly min: number; readonly max: number };
  readonly victoryPoints: number;
  readonly modules: readonly string[];
  readonly layout: { readonly orientation: "pointy" | "flat" };
  readonly cells: readonly ScenarioCell[];
  readonly bags: Readonly<Record<string, TerrainBag>>;
  readonly numbers: ScenarioNumbers;
  readonly ports: readonly ScenarioPort[];
  readonly pieces: PieceCounts;
  readonly setup: ScenarioSetup;
  readonly islands: readonly ScenarioIsland[];
  readonly hiddenStacks: readonly HiddenStack[];
  readonly startingPieces: readonly StartingPiece[];
}
