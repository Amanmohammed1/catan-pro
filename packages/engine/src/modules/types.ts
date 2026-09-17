/**
 * The rule module interface.
 *
 * CLAUDE.md golden rule 7: expansions are modules, not `if` statements. A
 * module contributes data (what is in the box) and hooks (what happens at a
 * point in the turn); nothing outside `modules/` asks which expansion is in
 * play. The base game goes through the same interface as everything else, so
 * the interface is exercised from day one rather than discovered to be wrong
 * when Seafarers arrives.
 *
 * Widened in M6. ADR 0005 set the test explicitly — "if Cities & Knights cannot
 * be expressed through this interface without editing base-game files, the
 * interface is wrong and should be widened" — and reading the two expansion
 * rulebooks answered it: three hooks are not enough. ADR 0007 records what was
 * added and why.
 *
 * The discipline from ADR 0005 still holds: a hook is added when a module needs
 * it, not before. Every member below names the expansion that requires it.
 */

import type { Action, ActionKind, Rejection } from "../actions/types.js";
import type { GameEvent } from "../events/types.js";
import type { Phase } from "../phases/types.js";
import type { Scenario } from "../scenario/types.js";
import type { DevCardKind, GameState, PlayerId } from "../state/types.js";

/** What the box holds: resource cards per kind, and the development deck. */
export interface Supply {
  readonly bankPerResource: number;
  readonly devDeck: Readonly<Record<DevCardKind, number>>;
}

/** A module's answer to "the turn just ended; what now?" */
export interface TurnHandoff {
  readonly phase: Phase;
  readonly events: readonly GameEvent[];
}

/**
 * A module's own slice of the game state, held in `GameState.moduleState` under
 * the module's id.
 *
 * Deliberately typed rather than `unknown`: this data is serialized into the
 * event log, redacted by `playerView()` and validated at the wire boundary, and
 * all three need a real type. Each module declares an interface extending this
 * one and narrows on `m`, exactly as `Action` and `Phase` are narrowed on their
 * own tags.
 *
 * Neither `base` nor `ext56` carries state — they are supply data plus one
 * hook — so today the record is always empty. Seafarers adds the first member
 * in M6.
 */
export interface ModuleState {
  /** The id of the module that owns this slice. */
  readonly m: string;
}

/** What a module saw fit to change, and what happened as a result. */
export interface ModuleEffect {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** The roll a module is told about, before production is worked out. */
export interface DiceRoll {
  readonly dice: readonly [number, number];
  readonly total: number;
}

/** What `setupState` is given when a game is created. */
export interface ModuleSetupCtx {
  readonly scenario: Scenario;
  readonly players: readonly PlayerId[];
}

/**
 * A module's reducer for an action kind it owns.
 *
 * Returns the effect when it handled the action, a Rejection when the action
 * was its to judge and was illegal, or null to say "not mine".
 */
export type ModuleReducer = (
  state: GameState,
  action: Action,
) => ModuleEffect | Rejection | null;

export interface RuleModule {
  readonly id: string;

  /** The cards this module puts in the box. A later module replaces an earlier one. */
  readonly supply?: Supply;

  /**
   * This module's initial state slice, or null if it keeps none.
   *
   * Seafarers tracks which islands each player has settled; Cities & Knights
   * tracks the improvement levels, the barbarian position and the knights.
   */
  readonly setupState?: (ctx: ModuleSetupCtx) => ModuleState | null;

  /**
   * Called when the player whose turn it is ends it, before the next turn
   * begins. Return a phase to interpose one (the 5–6 Special Building Phase
   * does this), or null to let the next turn start normally.
   */
  readonly afterTurnEnd?: (
    state: GameState,
    nextPlayer: PlayerId,
  ) => TurnHandoff | null;

  /**
   * Inspect an action before the reducer judges it.
   *
   * Returns a replacement action, a Rejection to refuse it, or null to pass.
   * Cities & Knights needs this: a knight on an intersection blocks a road the
   * base rules would allow (C&K p.9). Seafarers needs it for the pirate, which
   * forbids ship placement on the edges of its hex (Seafarers p.2).
   */
  readonly interceptAction?: (
    state: GameState,
    action: Action,
  ) => Action | Rejection | null;

  /**
   * Called on every roll, before production is paid out.
   *
   * Cities & Knights rolls a third event die here and may march the barbarian
   * ship a step closer, resolving an attack when it lands (C&K p.6, p.11).
   */
  readonly onDiceRoll?: (state: GameState, roll: DiceRoll) => ModuleEffect | null;

  /**
   * Called when a phase is entered, after the state carries it.
   *
   * Cities & Knights restructures the roll phase around the event die and the
   * progress-card draw (C&K p.6).
   */
  readonly onPhaseEnter?: (state: GameState, phase: Phase) => ModuleEffect | null;

  /** Moves this module adds, in the phases it owns. */
  readonly extraLegalMoves?: (state: GameState, player: PlayerId) => Action[];

  /**
   * Victory points this module grants, beyond buildings and the special cards.
   *
   * Seafarers pays for the first settlement on an island and for VP tokens
   * collected by ship (Seafarers p.4, p.12); Cities & Knights pays for a
   * metropolis and for defending against the barbarians (C&K p.8, p.11).
   */
  readonly scoreContribution?: (state: GameState, player: PlayerId) => number;

  /** Reducers for the action kinds this module owns. */
  readonly reducers?: Partial<Record<ActionKind, ModuleReducer>>;
}
