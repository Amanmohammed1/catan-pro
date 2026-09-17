import { useEffect, useMemo, useRef, useState } from "react";
import {
  RESOURCE_KINDS,
  type DevCardKind,
  type ResourceCounts,
  type ResourceKind,
} from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { RESOURCE_FIELD, RESOURCE_NAME, ResourceArt } from "./cards/ResourceArt.js";
import {
  DEV_CARD_FIELD,
  DEV_CARD_TEXT,
  DEV_CARD_TITLE,
  DevCardArt,
} from "./cards/DevCardArt.js";

/**
 * Your hand, docked at the bottom of the screen.
 *
 * Printed cards on parchment, one per resource, each with a large count. Not a
 * literal fan of individual cards: a fan looks the part but makes "how many
 * wool do I have?" a counting exercise, and that question gets asked on every
 * single turn. Cards you hold none of are faded rather than hidden, so the
 * shape of your hand stays stable and your eye keeps its place.
 */
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

  const gained = useGains(view.self.resources);

  const devCards = useMemo(() => {
    const counts = new Map<DevCardKind, { total: number; playable: number }>();
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
    <div className="flex w-full items-end justify-center gap-4 overflow-x-auto px-1 pt-2 pb-1">
      <ul className="flex items-end gap-2" aria-label="Your resource cards">
        {RESOURCE_KINDS.map((kind) => {
          const count = view.self.resources[kind];
          const just = gained[kind] ?? 0;
          return (
            <li
              key={kind}
              data-count={count}
              title={`${RESOURCE_NAME[kind]}: ${String(count)}`}
              className={[
                "parchment relative flex h-[92px] w-[66px] shrink-0 flex-col overflow-hidden rounded-[10px] border",
                "transition-[transform,opacity,filter] duration-200 ease-[var(--ease-out-soft)]",
                just > 0
                  ? "-translate-y-1 border-gold shadow-glow"
                  : "border-parchment-400/70",
                count === 0 ? "opacity-40 saturate-50" : "hover:-translate-y-1.5",
              ].join(" ")}
            >
              {just > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1 z-10 animate-[rise-in_0.35s_var(--ease-out-soft)] text-center font-num text-sm font-bold text-success drop-shadow"
                >
                  +{just}
                </span>
              )}
              <span
                className="m-1 mb-0 flex flex-1 items-center justify-center rounded-[7px] p-1"
                style={{ background: RESOURCE_FIELD[kind] }}
              >
                <ResourceArt kind={kind} className="h-full w-full" />
              </span>
              <span className="py-1 text-center text-[10px] font-semibold tracking-[0.12em] text-quill-700 uppercase">
                {RESOURCE_NAME[kind]}
              </span>
              <span
                className="absolute top-0.5 right-0.5 grid h-6 min-w-6 place-items-center rounded-full bg-quill-900 px-1.5 font-num text-sm leading-none font-bold text-parchment-50 tabular-nums shadow-lift"
                aria-hidden="true"
              >
                {count}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex shrink-0 flex-col items-center gap-1.5 self-center">
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold tabular-nums",
            overLimit
              ? "bg-danger/20 text-danger ring-1 ring-danger/50"
              : "bg-surface-700 text-ink-300",
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
      </div>

      {devCards.length > 0 && (
        <ul className="flex items-end gap-2" aria-label="Your development cards">
          {devCards.map(([kind, entry]) => (
            <li
              key={kind}
              title={`${DEV_CARD_TITLE[kind]} — ${DEV_CARD_TEXT[kind]}${
                entry.playable > 0
                  ? " Playable this turn."
                  : kind === "victoryPoint"
                    ? ""
                    : " Not playable yet: bought this turn, or you have already played a card."
              }`}
              className={[
                "parchment relative flex h-[92px] w-[66px] shrink-0 flex-col overflow-hidden rounded-[10px] border",
                entry.playable > 0
                  ? "animate-[glow-pulse_2.4s_ease-in-out_infinite] border-gold"
                  : "border-parchment-400/70",
              ].join(" ")}
            >
              <span
                className="m-1 mb-0 flex flex-1 items-center justify-center rounded-[7px] p-1"
                style={{ background: DEV_CARD_FIELD[kind] }}
              >
                <DevCardArt kind={kind} />
              </span>
              <span className="px-0.5 py-1 text-center text-[9px] leading-tight font-semibold tracking-[0.06em] text-quill-700 uppercase">
                {DEV_CARD_TITLE[kind]}
              </span>
              {entry.total > 1 && (
                <span className="absolute top-0.5 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-quill-900 px-1 font-num text-xs font-bold text-parchment-50">
                  ×{entry.total}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function devCardLabel(kind: string): string {
  return DEV_CARD_TITLE[kind as DevCardKind] ?? kind;
}

/**
 * Cards that have just arrived, so the dock can show what a roll paid you.
 *
 * Reads the server's own view rather than the event stream: production, a
 * trade, a theft and Year of Plenty all end in "your hand grew", and the view
 * is the authority on that. Losses are not flagged — a discard or a theft
 * already announces itself elsewhere, and two things flashing at once reads as
 * an error rather than as news.
 */
function useGains(
  resources: ResourceCounts,
): Partial<Record<ResourceKind, number>> {
  const previous = useRef<ResourceCounts | null>(null);
  const [gained, setGained] = useState<Partial<Record<ResourceKind, number>>>({});

  useEffect(() => {
    const before = previous.current;
    previous.current = resources;
    if (before === null) return;

    const delta: Partial<Record<ResourceKind, number>> = {};
    for (const kind of RESOURCE_KINDS) {
      const change = resources[kind] - before[kind];
      if (change > 0) delta[kind] = change;
    }
    if (Object.keys(delta).length === 0) return;

    setGained(delta);
    const handle = window.setTimeout(() => {
      setGained({});
    }, 1400);
    return () => {
      window.clearTimeout(handle);
    };
  }, [resources]);

  return gained;
}
