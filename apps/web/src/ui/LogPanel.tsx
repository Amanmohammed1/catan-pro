import { useMemo, useState } from "react";
import type { GameEvent } from "@hexport/engine";
import { describeEvent } from "../game/describeEvent.js";

/**
 * The game log, and chat when playing online.
 *
 * Collapsed by default on narrow screens: it is reference material, not
 * something to watch. Newest first, so the thing that just happened is at the
 * top rather than requiring a scroll.
 */
export function LogPanel({
  log,
  names,
  colors,
  chat,
  onChat,
}: {
  readonly log: readonly GameEvent[];
  readonly names: readonly string[];
  readonly colors: readonly string[];
  readonly chat?: readonly { from: string; player: number | null; text: string; at: number }[];
  readonly onChat?: ((text: string) => void) | undefined;
}): React.JSX.Element {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [draft, setDraft] = useState("");
  const hasChat = onChat !== undefined;

  const lines = useMemo(
    () =>
      log
        .map((event, index) => ({ index, text: describeEvent(event, names), event }))
        .filter((line) => line.text !== "")
        .slice(-120)
        .reverse(),
    [log, names],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-panel border border-surface-700 bg-surface-800/80 backdrop-blur">
      {hasChat ? (
        <div className="flex shrink-0 gap-1 border-b border-surface-700 p-1.5" role="tablist">
          <TabButton active={tab === "log"} onClick={() => { setTab("log"); }}>
            Log
          </TabButton>
          <TabButton active={tab === "chat"} onClick={() => { setTab("chat"); }}>
            Chat{chat !== undefined && chat.length > 0 ? ` (${String(chat.length)})` : ""}
          </TabButton>
        </div>
      ) : (
        <h2 className="shrink-0 border-b border-surface-700 px-3 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-500 uppercase">
          Game log
        </h2>
      )}

      {tab === "log" || !hasChat ? (
        <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
          {lines.length === 0 && (
            <li className="text-ink-700">Nothing has happened yet.</li>
          )}
          {lines.map((line) => (
            <li
              key={line.index}
              className="border-b border-surface-700/50 py-1 text-ink-300 last:border-0"
            >
              {line.text}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
            {(chat ?? []).length === 0 && (
              <li className="text-ink-700">No messages yet.</li>
            )}
            {(chat ?? []).slice(-80).map((line, index) => (
              <li key={`${String(line.at)}-${String(index)}`} className="py-0.5">
                <span
                  className="font-medium"
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
            className="shrink-0 border-t border-surface-700 p-1.5"
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
              onChange={(event) => { setDraft(event.target.value); }}
              className="w-full rounded-md border border-surface-600 bg-surface-900/70 px-2 py-1.5 text-xs placeholder:text-ink-700"
            />
          </form>
        </div>
      )}
    </div>
  );
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
        "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors",
        active
          ? "bg-surface-600 text-ink-100"
          : "text-ink-500 hover:bg-surface-700 hover:text-ink-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
