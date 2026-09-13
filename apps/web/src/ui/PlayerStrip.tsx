import type { WireView } from "@hexport/protocol";
import { ArmyIcon, CardBackIcon, RoadIcon, VictoryIcon } from "./icons.js";

/**
 * The other players, at a glance.
 *
 * Shows only what the rules make public: victory points from buildings and the
 * special cards, hand size, development cards held, knights played. Hidden
 * victory point cards are not here, which is why a player can win from what
 * looks like eight points (p.7).
 *
 * The player on turn is marked by a coloured rail and a label, not by colour
 * alone.
 */
export function PlayerStrip({
  view,
  connected,
}: {
  readonly view: WireView;
  /** Seat to connection state, when playing online. */
  readonly connected?: ReadonlyMap<number, boolean> | undefined;
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Players">
      {view.players.map((player) => {
        const onTurn = player.id === view.currentPlayer;
        const isYou = player.id === view.you;
        const online = connected?.get(player.id);

        return (
          <li
            key={player.id}
            className={[
              "relative overflow-hidden rounded-panel border px-3 py-2 transition-colors duration-200",
              onTurn
                ? "border-accent/45 bg-surface-700/90"
                : "border-surface-700 bg-surface-800/70",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: player.color }}
            />

            <div className="flex items-baseline gap-2 pl-1.5">
              <span className="truncate text-sm font-medium">
                {player.name}
                {isYou && <span className="text-ink-500"> (you)</span>}
              </span>

              {online === false && (
                <span className="rounded bg-surface-600 px-1.5 py-0.5 text-[10px] text-ink-500">
                  away
                </span>
              )}

              {onTurn && (
                <span className="ml-auto rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                  On turn
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-3 pl-1.5 text-xs text-ink-500">
              <span
                className="flex items-center gap-1 font-num tabular-nums text-ink-300"
                title="Victory points everyone can see"
              >
                <VictoryIcon />
                {player.publicPoints}
              </span>
              <span
                className="flex items-center gap-1 font-num tabular-nums"
                title="Resource cards in hand"
              >
                <CardBackIcon className="h-3.5 w-3.5" />
                {player.handSize}
              </span>
              {player.devCardCount > 0 && (
                <span className="font-num tabular-nums" title="Development cards held">
                  {player.devCardCount} dev
                </span>
              )}
              {player.knightsPlayed > 0 && (
                <span
                  className="flex items-center gap-1 font-num tabular-nums"
                  title="Knights played"
                >
                  <ArmyIcon />
                  {player.knightsPlayed}
                </span>
              )}

              <span className="ml-auto flex items-center gap-1.5">
                {view.longestRoad.player === player.id && (
                  <span
                    className="flex items-center gap-1 rounded bg-surface-600 px-1.5 py-0.5 text-[10px] text-ink-300"
                    title={`Longest Road — ${String(view.longestRoad.length)} segments, worth 2 points`}
                  >
                    <RoadIcon />
                    {view.longestRoad.length}
                  </span>
                )}
                {view.largestArmy.player === player.id && (
                  <span
                    className="flex items-center gap-1 rounded bg-surface-600 px-1.5 py-0.5 text-[10px] text-ink-300"
                    title={`Largest Army — ${String(view.largestArmy.length)} knights, worth 2 points`}
                  >
                    <ArmyIcon />
                    {view.largestArmy.length}
                  </span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
