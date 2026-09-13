import { useMemo } from "react";
import { RESOURCE_KINDS, type ResourceKind } from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { ResourceIcon, CardBackIcon } from "./icons.js";

/**
 * Your hand, docked at the bottom of the screen.
 *
 * Laid out as a row of counted cards rather than a literal fan of individual
 * cards. A fan looks the part but makes "how many wool do I have?" a counting
 * exercise, and that question gets asked on every single turn.
 *
 * Cards you cannot currently spend are dimmed rather than hidden, so the shape
 * of your hand stays stable and your eye keeps its place.
 */

const RESOURCE_STYLE: Record<ResourceKind, { bg: string; text: string; label: string }> = {
  brick: { bg: "bg-brick/18 border-brick/45", text: "text-brick", label: "Brick" },
  lumber: { bg: "bg-lumber/18 border-lumber/45", text: "text-lumber", label: "Lumber" },
  wool: { bg: "bg-wool/18 border-wool/45", text: "text-wool", label: "Wool" },
  grain: { bg: "bg-grain/18 border-grain/45", text: "text-grain", label: "Grain" },
  ore: { bg: "bg-ore/18 border-ore/45", text: "text-ore", label: "Ore" },
};

export function HandDock({
  view,
  overLimit,
}: {
  readonly view: WireView;
  /** True when a seven would force a discard, so the total is worth flagging. */
  readonly overLimit: boolean;
}): React.JSX.Element {
  const total = useMemo(
    () => RESOURCE_KINDS.reduce((sum, kind) => sum + view.self.resources[kind], 0),
    [view.self.resources],
  );

  const devCards = useMemo(() => {
    const counts = new Map<string, { total: number; playable: number }>();
    for (const card of view.self.devCards) {
      if (card.played) continue;
      const entry = counts.get(card.kind) ?? { total: 0, playable: 0 };
      entry.total += 1;
      if (card.playable) entry.playable += 1;
      counts.set(card.kind, entry);
    }
    return [...counts.entries()];
  }, [view.self.devCards]);

  return (
    <div className="flex flex-wrap items-end justify-center gap-2">
      <ul className="flex items-end gap-1.5" aria-label="Your resource cards">
        {RESOURCE_KINDS.map((kind) => {
          const count = view.self.resources[kind];
          const style = RESOURCE_STYLE[kind];
          return (
            <li
              key={kind}
              className={[
                "flex w-[58px] flex-col items-center gap-0.5 rounded-card border px-1.5 py-2",
                "transition-[transform,opacity] duration-200 ease-[var(--ease-out-soft)]",
                style.bg,
                count === 0 ? "opacity-35" : "opacity-100",
              ].join(" ")}
            >
              <span className={style.text}>
                <ResourceIcon kind={kind} className="h-5 w-5" />
              </span>
              <span className="font-num text-lg leading-none font-semibold tabular-nums">
                {count}
              </span>
              <span className="text-[10px] tracking-wide text-ink-500">
                {style.label}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-start gap-1 pb-1">
        <span
          className={[
            "rounded-md px-2 py-1 font-num text-xs tabular-nums",
            overLimit
              ? "bg-danger/20 text-danger"
              : "bg-surface-700/70 text-ink-500",
          ].join(" ")}
          title={
            overLimit
              ? "Over seven cards: a roll of seven costs you half of them"
              : "Cards in hand"
          }
        >
          {total} card{total === 1 ? "" : "s"}
          {overLimit ? " · at risk" : ""}
        </span>

        {devCards.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Your development cards">
            {devCards.map(([kind, entry]) => (
              <li
                key={kind}
                className={[
                  "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px]",
                  entry.playable > 0
                    ? "border-accent/55 bg-accent/12 text-accent"
                    : "border-surface-600 bg-surface-700/60 text-ink-500",
                ].join(" ")}
                title={
                  entry.playable > 0
                    ? "Playable this turn"
                    : "Bought this turn, or you have already played a card"
                }
              >
                <CardBackIcon className="h-3.5 w-3.5" />
                {devCardLabel(kind)}
                {entry.total > 1 ? ` ×${String(entry.total)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function devCardLabel(kind: string): string {
  switch (kind) {
    case "knight":
      return "Knight";
    case "roadBuilding":
      return "Road Building";
    case "yearOfPlenty":
      return "Year of Plenty";
    case "monopoly":
      return "Monopoly";
    case "victoryPoint":
      return "Victory Point";
    default:
      return kind;
  }
}
