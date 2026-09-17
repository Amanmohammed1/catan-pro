import type { PlayerId } from "../state/types.js";
import type { RuleModule } from "./types.js";

/**
 * The 5–6 player extension.
 *
 * Two things beyond the larger board, which is scenario data:
 *
 * 1. More cards. The extension adds 25 resource cards (5 of each kind, so 24 in
 *    the bank) and 9 development cards — 6 knights and one of each progress
 *    card, giving a 34-card deck (5–6 rules 2022 p.4; component list, 2025 p.1).
 *
 * 2. The Special Building Phase. After each turn, every other player in
 *    clockwise order gets a window in which they may build and buy development
 *    cards, but not trade and not play a development card.
 *
 * The 2022 and 2025 rulebooks replace that phase with "paired players"; this
 * game implements the older phase deliberately, and no rulebook in docs/rules
 * describes it. ADR 0006 records exactly what is implemented and why.
 */
export const ext56Module: RuleModule = {
  id: "ext56",

  supply: {
    bankPerResource: 24,
    devDeck: {
      knight: 20,
      roadBuilding: 3,
      yearOfPlenty: 3,
      monopoly: 3,
      victoryPoint: 5,
    },
  },

  afterTurnEnd: (state, nextPlayer) => {
    // Everyone except the player who just finished, starting with the player
    // whose turn is next and going clockwise.
    const count = state.players.length;
    const queue: PlayerId[] = [];
    for (let i = 0; i < count - 1; i++) {
      queue.push((nextPlayer + i) % count);
    }
    if (queue.length === 0) return null;

    return {
      phase: { k: "specialBuild", queue, nextPlayer },
      events: [{ e: "specialBuildStarted", players: queue }],
    };
  },
};
