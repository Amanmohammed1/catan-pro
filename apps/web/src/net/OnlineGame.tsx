import { useMemo } from "react";
import { GameScreen } from "../game/GameScreen.js";
import type { GameSession } from "../game/session.js";
import { Lobby } from "./Lobby.js";
import { useConnection } from "./useConnection.js";

/**
 * Online play.
 *
 * The client holds nothing but what the server sent it. Every command goes out
 * over the socket and comes back as a redacted view (golden rules 2 and 5).
 */
export function OnlineGame({
  url,
  storageKey,
}: {
  readonly url: string;
  /** Test-only: isolate each client's seat token. */
  readonly storageKey?: string;
}): React.JSX.Element {
  const net = useConnection(url, storageKey === undefined ? {} : { storageKey });

  const session: GameSession | null = useMemo(() => {
    if (net.board === null || net.view === null) return null;
    return {
      board: net.board,
      view: net.view,
      log: net.log,
      error: net.error,
      hotSeat: false,
      dispatch: net.command,
      dismissError: net.dismissError,
      deadline: net.deadline,
      onChat: net.sendChat,
      chat: net.chatLines,
    };
  }, [
    net.board,
    net.view,
    net.log,
    net.error,
    net.command,
    net.dismissError,
    net.deadline,
    net.sendChat,
    net.chatLines,
  ]);

  if (net.status !== "online") {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <div className="w-full max-w-[340px] rounded-panel border border-surface-700 bg-surface-800/85 p-5 text-center shadow-panel">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            hexport
          </h1>
          <p className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-500">
            <span
              aria-hidden="true"
              className="h-2 w-2 animate-pulse rounded-full bg-accent"
            />
            {net.status === "reconnecting"
              ? "Connection lost. Reconnecting…"
              : "Connecting to the server…"}
          </p>
        </div>
      </div>
    );
  }

  if (session === null) {
    return <Lobby net={net} />;
  }

  return <GameScreen session={session} />;
}
