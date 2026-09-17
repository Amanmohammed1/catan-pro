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
 * Kept deliberately small: a hook is added when a module needs it, not before.
 */

import type { Action } from "../actions/types.js";
import type { GameEvent } from "../events/types.js";
import type { Phase } from "../phases/types.js";
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

export interface RuleModule {
  readonly id: string;

  /** The cards this module puts in the box. A later module replaces an earlier one. */
  readonly supply?: Supply;

  /**
   * Called when the player whose turn it is ends it, before the next turn
   * begins. Return a phase to interpose one (the 5–6 Special Building Phase
   * does this), or null to let the next turn start normally.
   */
  readonly afterTurnEnd?: (
    state: GameState,
    nextPlayer: PlayerId,
  ) => TurnHandoff | null;

  /** Moves this module adds, in the phases it owns. */
  readonly extraLegalMoves?: (state: GameState, player: PlayerId) => Action[];
}
