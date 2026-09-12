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
export function OnlineGame({ url }: { readonly url: string }): React.JSX.Element {
  const net = useConnection(url);

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
      <div className="centered">
        <div className="panel-card">
          <h1>hexport</h1>
          <p className="sub">
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
