import type { GameEvent } from "@hexport/engine";

/**
 * Where on the board an event happened.
 *
 * The log says "Ana built a road"; this says *which* road, so hovering a line
 * can light the board up. Pure mapping over the event union — no lookups, no
 * state — which keeps it honest when the event union grows.
 *
 * Events that are not about a place (a trade, a discard, a card played) have no
 * targets, and hovering them highlights nothing rather than guessing.
 */
export interface EventTargets {
  readonly tiles: readonly string[];
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

const NOTHING: EventTargets = { tiles: [], nodes: [], edges: [] };

export function targetsOf(event: GameEvent): EventTargets {
  switch (event.e) {
    case "builtRoad":
      return { tiles: [], nodes: [], edges: [event.edge] };

    case "builtSettlement":
    case "builtCity":
    case "buildingPlacedInSetup":
      return { tiles: [], nodes: [event.node], edges: [] };

    case "robberMoved":
      return { tiles: [event.from, event.to], nodes: [], edges: [] };

    default:
      return NOTHING;
  }
}

/** True when hovering this event would light anything up. */
export function hasTargets(event: GameEvent): boolean {
  const targets = targetsOf(event);
  return (
    targets.tiles.length > 0 || targets.nodes.length > 0 || targets.edges.length > 0
  );
}
