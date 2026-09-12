/**
 * @hexport/engine — pure game rules and geometry.
 *
 * Zero runtime dependencies, by rule and by lint. Nothing in here touches the
 * network, the filesystem, the clock, the DOM, or Math.random. See CLAUDE.md
 * golden rules 1 and 4, enforced by eslint.config.js and scripts/verify-engine-pure.mjs.
 *
 * M0: coordinates, identity, the board graph, the seeded PRNG.
 * M1: GameState, actions, events, the phase machine, legalMoves and reducers.
 */

// ---- randomness -----------------------------------------------------------
export {
  seedRng,
  nextU32,
  nextFloat,
  nextInt,
  shuffle,
  type RngState,
} from "./rng/sfc32.js";

// ---- coordinates ----------------------------------------------------------
export {
  AXIAL_DIRECTIONS,
  CORNER_INDICES,
  DIRECTION_INDICES,
  addAxial,
  axialToCube,
  compareAxial,
  cornerHexes,
  cubeToAxial,
  edgeCornerIndices,
  edgeHexes,
  equalAxial,
  hexDistance,
  neighbor,
  neighbors,
  type Axial,
  type CornerIndex,
  type Cube,
  type DirectionIndex,
} from "./geometry/coords.js";

// ---- identity -------------------------------------------------------------
export {
  axialKey,
  edgeIdAt,
  edgeIdFromNodes,
  hexesFromNodeId,
  nodeIdAt,
  nodeIdFromHexes,
  nodesFromEdgeId,
  parseAxialKey,
  tileId,
  type EdgeId,
  type NodeId,
  type TileId,
} from "./geometry/ids.js";

// ---- board ----------------------------------------------------------------
export {
  ScenarioError,
  buildBoardGraph,
  buildBoardFromSeed,
  nodeCorners,
  type BuildBoardResult,
} from "./geometry/buildBoardGraph.js";

export type {
  BoardEdge,
  BoardGraph,
  BoardNode,
  EdgeKind,
  Port,
  PortId,
  Tile,
} from "./geometry/types.js";

// ---- rendering support (view only, never identity) ------------------------
export {
  DEFAULT_LAYOUT,
  hexCornerPixels,
  hexToPixel,
  nodeToPixel,
  type Layout,
} from "./geometry/layout.js";

// ---- scenario definitions -------------------------------------------------
export {
  LAND_TERRAINS,
  TERRAIN_RESOURCE,
  isLandTerrain,
  type HiddenStack,
  type PieceCounts,
  type ResourceKind,
  type Scenario,
  type ScenarioCell,
  type ScenarioIsland,
  type ScenarioNumbers,
  type ScenarioPort,
  type ScenarioSetup,
  type SlotKind,
  type StartingPiece,
  type Terrain,
  type TerrainBag,
  type TerrainBagEntry,
} from "./scenario/types.js";

// ---- game state (M1) ------------------------------------------------------
export {
  COSTS,
  DEFAULT_CONFIG,
  DEV_DECK_COMPOSITION,
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Building,
  type BuildingKind,
  type DevCardHolding,
  type DevCardKind,
  type GameConfig,
  type GameState,
  type PieceStock,
  type PlayerId,
  type PlayerState,
  type ResourceCounts,
  type SpecialCard,
} from "./state/types.js";

export {
  addResources,
  bestTradeRate,
  canAfford,
  countsFromList,
  handSize,
  isNonNegative,
  playersAdjacentToTile,
  portRatesFor,
  resourceList,
  scaleResources,
  singleResource,
  subtractResources,
} from "./state/helpers.js";

export {
  assertInvariants,
  checkInvariants,
  type InvariantViolation,
} from "./state/invariants.js";

export type { Phase, PhaseKind, TradeOffer, TradeResponse } from "./phases/types.js";
export type { Action, ActionKind, Rejection } from "./actions/types.js";
export type { EventKind, GameEvent } from "./events/types.js";

// ---- setup ----------------------------------------------------------------
export {
  BANK_PER_RESOURCE,
  DEFAULT_COLORS,
  buildDevDeck,
  createGame,
  setupPlayerAt,
  startingRobberTile,
  type CreateGameOptions,
} from "./setup/createGame.js";

// ---- queries --------------------------------------------------------------
export {
  longestRoadFor,
  longestRoadLengths,
  resolveLongestRoad,
  type RoadNetworkInput,
} from "./queries/longestRoad.js";

export {
  findWinner,
  publicScoreboard,
  publicVictoryPoints,
  resolveLargestArmy,
  victoryPointCards,
  victoryPoints,
} from "./queries/scores.js";

export {
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
  citySpots,
  roadSpots,
  satisfiesDistanceRule,
  settlementSpots,
} from "./queries/placement.js";

export {
  canOfferTrade,
  canPlayDevCard,
  discardCount,
  enumerateDiscards,
  legalMoves,
} from "./queries/legalMoves.js";

export {
  playerView,
  type PlayerView,
  type PublicPlayer,
  type SelfPlayer,
} from "./queries/playerView.js";

// ---- reducers -------------------------------------------------------------
export { reduce, reduceMany, type ReduceResult } from "./reducers/reduce.js";
export {
  applyProduction,
  computeProduction,
  setupYield,
  terrainResource,
  type ProductionResult,
} from "./reducers/production.js";
export { checkVictory, recomputeSpecialCards, settle } from "./reducers/special.js";
