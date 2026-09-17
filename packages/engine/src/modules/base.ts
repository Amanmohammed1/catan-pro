import { DEV_DECK_COMPOSITION } from "../state/types.js";
import type { RuleModule, Supply } from "./types.js";

/**
 * The base game.
 *
 * Carries what the base box holds and nothing else: the turn structure, the
 * phases and the rules themselves live in the reducer, because they are the
 * game rather than an addition to it. Routing the base supply through the same
 * interface an expansion uses is what keeps the interface honest — see
 * CLAUDE.md golden rule 7.
 *
 * Rules p.2: 95 resource cards, 19 of each of the five kinds, and a 25-card
 * development deck.
 */
export const BASE_SUPPLY: Supply = {
  bankPerResource: 19,
  devDeck: DEV_DECK_COMPOSITION,
};

export const baseModule: RuleModule = {
  id: "base",
  supply: BASE_SUPPLY,
};
