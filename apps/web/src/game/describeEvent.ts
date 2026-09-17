import type { GameEvent } from "@hexport/engine";

/**
 * Turn an event into a line of game log.
 *
 * Takes only the player names, so the same formatter works from a redacted
 * view. An event whose secret has been stripped reads as "a card", which is
 * exactly what a bystander should see.
 *
 * The log is driven entirely by the event stream (CLAUDE.md golden rule 6), so
 * it stays correct for replays and, from M2, for a player who reconnects and
 * replays the log rather than receiving a snapshot.
 */
export function describeEvent(event: GameEvent, names: readonly string[]): string {
  const name = (id: number): string => names[id] ?? `Player ${String(id + 1)}`;

  switch (event.e) {
    case "gameStarted":
      return "Game started.";
    case "turnStarted":
      return `— ${name(event.player)}'s turn (${String(event.turn)})`;
    case "diceRolled":
      return `${name(event.player)} rolled ${String(event.total)} (${String(event.dice[0])}+${String(event.dice[1])})`;
    case "resourcesProduced": {
      const parts: string[] = [];
      for (const [player, gain] of Object.entries(event.gains)) {
        const items = Object.entries(gain)
          .filter(([, n]) => n > 0)
          .map(([kind, n]) => `${String(n)} ${kind}`);
        if (items.length > 0) {
          parts.push(`${name(Number(player))}: ${items.join(", ")}`);
        }
      }
      const shortage =
        event.shortages.length > 0
          ? ` (bank short of ${event.shortages.join(", ")})`
          : "";
      return parts.length === 0
        ? `No production${shortage}`
        : `${parts.join("; ")}${shortage}`;
    }
    case "discardRequired":
      return `Discard required: ${event.players.map(name).join(", ")}`;
    case "discarded": {
      const items = Object.entries(event.resources)
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => `${String(n)} ${kind}`);
      return `${name(event.player)} discarded ${items.join(", ")}`;
    }
    case "robberMoved":
      return `${name(event.player)} moved the robber`;
    case "cardStolen":
      return event.resource === null
        ? `${name(event.to)} stole a card from ${name(event.from)}`
        : `${name(event.to)} stole ${event.resource} from ${name(event.from)}`;
    case "stealSkipped":
      return `${name(event.player)} stole nothing`;
    case "builtRoad":
      return `${name(event.player)} built a road${event.free ? " (free)" : ""}`;
    case "builtSettlement":
      return `${name(event.player)} built a settlement`;
    case "builtCity":
      return `${name(event.player)} upgraded to a city`;
    case "devCardBought":
      return event.kind === null
        ? `${name(event.player)} bought a development card (${String(event.remaining)} left)`
        : `${name(event.player)} bought ${event.kind} (${String(event.remaining)} left)`;
    case "devCardPlayed":
      return `${name(event.player)} played ${event.kind}`;
    case "yearOfPlentyTaken":
      return `${name(event.player)} took ${event.resources.join(" and ")}`;
    case "monopolyResolved": {
      const total = Object.values(event.taken).reduce((a, b) => a + b, 0);
      return `${name(event.player)} monopolised ${event.resource} (${String(total)} cards)`;
    }
    case "bankTraded":
      return `${name(event.player)} traded ${String(event.giveCount)} ${event.give} for 1 ${event.receive}`;
    case "tradeOffered":
      return `${name(event.player)} offered a trade`;
    case "tradeResponded":
      return `${name(event.player)} ${event.accept ? "accepted" : "declined"}`;
    case "tradeCountered":
      return `${name(event.player)} countered with different terms`;
    case "tradeCompleted":
      return `${name(event.from)} traded with ${name(event.to)}`;
    case "tradeCancelled":
      return `Trade cancelled`;
    case "roadBuildingEnded":
      return `${name(event.player)} finished Road Building (${String(event.placed)} placed)`;
    case "longestRoadChanged":
      return event.to === null
        ? "Longest Road set aside"
        : `${name(event.to)} takes Longest Road (${String(event.length)})`;
    case "largestArmyChanged":
      return event.to === null
        ? "Largest Army set aside"
        : `${name(event.to)} takes Largest Army (${String(event.size)})`;
    case "buildingPlacedInSetup":
      return `${name(event.player)} placed a settlement`;
    case "setupResourcesGranted":
      return `${name(event.player)} collected starting resources`;
    case "specialBuildStarted":
      return `Special building: ${event.players.map(name).join(", ")}`;
    case "specialBuildPassed":
      return `${name(event.player)} finished building`;
    case "gameEnded":
      return `${name(event.winner)} wins with ${String(event.points)} points!`;
    default:
      return "";
  }
}
