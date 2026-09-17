import { useMemo, useState } from "react";
import type { GameEvent } from "@hexport/engine";
import { describeEvent } from "../game/describeEvent.js";
import { hasTargets } from "../game/eventTargets.js";

/**
 * The game log, and chat when playing online.
 *
 * Newest first, so the thing that just happened is at the top rather than
 * requiring a scroll. Each line carries the colour of the player it is about,
 * and every turn opens with a divider naming whose turn it is, so the log reads
 * as a sequence of turns rather than an undifferentiated stream.
 */
export function LogPanel({
  log,
  names,
  colors,
  chat,
  onChat,
  onHighlight,
}: {
  readonly log: readonly GameEvent[];
  readonly names: readonly string[];
  readonly colors: readonly string[];
  /**
   * Show where a line happened, while the pointer or keyboard focus is on it.
   * Called with null when it leaves.
   */
  readonly onHighlight?: ((event: GameEvent | null) => void) | undefined;
  readonly chat?: readonly {
    from: string;
    player: number | null;
    text: string;
    at: number;
  }[];
  readonly onChat?: ((text: string) => void) | undefined;
}): React.JSX.Element {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [draft, setDraft] = useState("");
  const hasChat = onChat !== undefined;

  const lines = useMemo(
    () =>
      log
        .map((event, index) => ({
          index,
          text: describeEvent(event, names),
          event,
          actor: actorOf(event),
        }))
        .filter((line) => line.text !== "")
        .slice(-150)
        .reverse(),
    [log, names],
  );

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      {hasChat ? (
        <div className="flex shrink-0 gap-1 border-b border-gold/10 p-1.5" role="tablist">
          <TabButton
            active={tab === "log"}
            onClick={() => {
              setTab("log");
            }}
          >
            Log
          </TabButton>
          <TabButton
            active={tab === "chat"}
            onClick={() => {
              setTab("chat");
            }}
          >
            Chat
            {chat !== undefined && chat.length > 0 ? ` (${String(chat.length)})` : ""}
          </TabButton>
        </div>
      ) : (
        <h2 className="eyebrow shrink-0 border-b border-gold/10 px-3.5 py-2.5">Game log</h2>
      )}

      {tab === "log" || !hasChat ? (
        <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12.5px] leading-snug">
          {lines.length === 0 && (
            <li className="py-1 text-ink-500">Nothing has happened yet.</li>
          )}
          {lines.map((line) =>
            line.event.e === "turnStarted" ? (
              <li
                key={line.index}
                className="flex items-center gap-2 pt-3 pb-1 text-[10px] font-semibold tracking-[0.14em] text-ink-500 uppercase first:pt-1"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: colors[line.event.player] }}
                />
                <span className="shrink-0">{line.text.replace(/^— /, "")}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-gold/15" />
              </li>
            ) : (
              <li
                key={line.index}
                // Hovering a line lights up the spot it is about. Focus does
                // the same, so it is not a mouse-only affordance.
                tabIndex={hasTargets(line.event) ? 0 : undefined}
                onMouseEnter={() => {
                  onHighlight?.(line.event);
                }}
                onMouseLeave={() => {
                  onHighlight?.(null);
                }}
                onFocus={() => {
                  onHighlight?.(line.event);
                }}
                onBlur={() => {
                  onHighlight?.(null);
                }}
                className={[
                  "flex gap-2 rounded px-1 py-[3px] text-ink-300",
                  hasTargets(line.event)
                    ? "cursor-help hover:bg-gold/10 focus-visible:bg-gold/10"
                    : "",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: line.actor === null ? "var(--color-ink-700)" : colors[line.actor],
                  }}
                />
                <span className={line.event.e === "gameEnded" ? "font-semibold text-gold" : ""}>
                  {line.text}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12.5px] leading-snug">
            {(chat ?? []).length === 0 && (
              <li className="py-1 text-ink-500">No messages yet. Say hello.</li>
            )}
            {(chat ?? []).slice(-80).map((line, index) => (
              <li key={`${String(line.at)}-${String(index)}`} className="py-0.5">
                <span
                  className="font-semibold"
                  style={{
                    color: line.player === null ? undefined : colors[line.player],
                  }}
                >
                  {line.from}
                </span>
                <span className="text-ink-300">: {line.text}</span>
              </li>
            ))}
          </ol>

          <form
            className="shrink-0 border-t border-gold/10 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (text === "") return;
              onChat?.(text);
              setDraft("");
            }}
          >
            <input
              value={draft}
              maxLength={400}
              placeholder="Say something"
              aria-label="Chat message"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              className="w-full rounded-[9px] border border-gold/15 bg-surface-900/70 px-2.5 py-2 text-xs text-ink-100 placeholder:text-ink-700"
            />
          </form>
        </div>
      )}
    </div>
  );
}

/** The player an event is about, for colouring its line. */
function actorOf(event: GameEvent): number | null {
  switch (event.e) {
    case "cardStolen":
      return event.to;
    case "tradeCompleted":
      return event.from;
    case "gameEnded":
      return event.winner;
    case "longestRoadChanged":
    case "largestArmyChanged":
      return event.to;
    default:
      return "player" in event && typeof event.player === "number" ? event.player : null;
  }
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "flex-1 rounded-[8px] px-2 py-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase transition-colors",
        active
          ? "bg-surface-600 text-ink-100"
          : "text-ink-500 hover:bg-surface-700 hover:text-ink-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
