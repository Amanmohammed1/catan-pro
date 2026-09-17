import type { WireView } from "@hexport/protocol";
import { Avatar } from "./Avatar.js";
import { ArmyIcon, CardBackIcon, RoadIcon, VictoryIcon } from "./icons.js";

/**
 * The players, at a glance.
 *
 * Shows only what the rules make public: victory points from buildings and the
 * special cards, hand size, development cards held, knights played. Hidden
 * victory point cards are not here, which is why a player can win from what
 * looks like eight points (p.7).
 *
 * The player on turn gets a gold ring and an "On turn" label — never colour
 * alone. With five or six players the cards tighten up so all of them fit.
 * On a narrow screen the list scrolls sideways across the top.
 */
export function PlayerStrip({
  view,
  connected,
}: {
  readonly view: WireView;
  /** Seat to connection state, when playing online. */
  readonly connected?: ReadonlyMap<number, boolean> | undefined;
}): React.JSX.Element {
  const compact = view.players.length > 4;

  return (
    <ul
      className="flex gap-2 overflow-x-auto tab:flex-col tab:overflow-visible"
      aria-label="Players"
    >
      {view.players.map((player) => {
        const onTurn = player.id === view.currentPlayer;
        const isYou = player.id === view.you;
        const online = connected?.get(player.id);
        const road = view.longestRoad.player === player.id;
        const army = view.largestArmy.player === player.id;

        return (
          <li
            key={player.id}
            data-seat={player.id}
            className={[
              "panel relative min-w-[210px] shrink-0 tab:min-w-0",
              compact ? "px-2.5 py-2" : "px-3 py-2.5",
              onTurn ? "border-gold/60! shadow-glow" : "",
              online === false ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-2.5">
              <Avatar seat={player.id} color={player.color} size={compact ? 30 : 36} ring={onTurn} />

              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-1.5">
                  <span
                    className={[
                      "truncate font-display font-semibold text-ink-100",
                      compact ? "text-[14px]" : "text-[15px]",
                    ].join(" ")}
                  >
                    {player.name}
                  </span>
                  {isYou && <span className="shrink-0 text-xs text-ink-500">(you)</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-500">
                  <span className="flex items-center gap-1 tabular-nums" title="Resource cards in hand">
                    <CardBackIcon className="h-3.5 w-3.5" />
                    {player.handSize}
                  </span>
                  <span
                    className="flex items-center gap-1 tabular-nums"
                    title="Development cards held"
                  >
                    <span aria-hidden="true" className="inline-block h-3 w-2.5 rounded-[2px] border border-current" />
                    {player.devCardCount}
                  </span>
                  {player.knightsPlayed > 0 && (
                    <span className="flex items-center gap-1 tabular-nums" title="Knights played">
                      <ArmyIcon />
                      {player.knightsPlayed}
                    </span>
                  )}
                  {online === false && (
                    <span className="rounded bg-surface-600 px-1.5 py-px text-[10px] text-ink-300">
                      away
                    </span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end" title="Victory points everyone can see">
                <span
                  className={[
                    "font-num leading-none font-bold text-gold tabular-nums",
                    compact ? "text-xl" : "text-2xl",
                  ].join(" ")}
                >
                  {player.publicPoints}
                </span>
                <span className="flex items-center gap-0.5 text-[9px] font-semibold tracking-[0.14em] text-ink-500 uppercase">
                  <VictoryIcon className="h-2.5 w-2.5" />
                  VP
                </span>
              </div>
            </div>

            {(onTurn || road || army) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {onTurn && (
                  <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
                    On turn
                  </span>
                )}
                {road && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-surface-600 px-2 py-0.5 text-[10px] font-medium text-ink-300"
                    title={`Longest Road — ${String(view.longestRoad.length)} segments, worth 2 points`}
                  >
                    <RoadIcon className="h-3 w-3" />
                    Longest road · {view.longestRoad.length}
                  </span>
                )}
                {army && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-surface-600 px-2 py-0.5 text-[10px] font-medium text-ink-300"
                    title={`Largest Army — ${String(view.largestArmy.length)} knights, worth 2 points`}
                  >
                    <ArmyIcon className="h-3 w-3" />
                    Largest army · {view.largestArmy.length}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
