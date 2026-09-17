import { useMemo } from "react";
import { GameScreen } from "../game/GameScreen.js";
import type { GameSession } from "../game/session.js";
import { Lobby } from "./Lobby.js";
import { Wordmark } from "../ui/Wordmark.js";
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
      // The server refuses a rematch from anyone but the host, and only once
      // the game is decided; offering the button to everyone would mean
      // explaining a refusal instead.
      onRematch: net.room?.hostPlayer === net.view.you ? net.rematch : undefined,
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
    net.rematch,
    net.room,
  ]);

  if (net.status !== "online") {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <div className="panel w-full max-w-[340px] p-6 text-center">
          <Wordmark size="lg" />
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-500">
            <span
              aria-hidden="true"
              className="h-2 w-2 animate-pulse rounded-full bg-gold"
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
