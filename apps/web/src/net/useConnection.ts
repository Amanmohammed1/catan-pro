import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  encode,
  type ChatLine,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
  type WireView,
} from "@hexport/protocol";
import type { Action, BoardGraph, GameEvent } from "@hexport/engine";

/**
 * The WebSocket connection to the game server.
 *
 * Holds no game logic. It receives redacted views and sends commands; the server
 * decides everything (CLAUDE.md golden rule 2). The board arrives once in the
 * snapshot and is kept, because it never changes for a match.
 */

const TOKEN_KEY = "hexport.token";

export type ConnectionStatus = "connecting" | "online" | "reconnecting";

export interface NetState {
  readonly status: ConnectionStatus;
  readonly room: RoomView | null;
  readonly board: BoardGraph | null;
  readonly view: WireView | null;
  readonly log: readonly GameEvent[];
  readonly chatLines: readonly ChatLine[];
  readonly error: string | null;
  readonly seedCommitment: string | null;
  readonly revealedSeed: string | null;
  readonly deadline: number | null;
}

const EMPTY: NetState = {
  status: "connecting",
  room: null,
  board: null,
  view: null,
  log: [],
  chatLines: [],
  error: null,
  seedCommitment: null,
  revealedSeed: null,
  deadline: null,
};

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing. Resume simply will not work; everything else does.
    return null;
  }
}

function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function defaultServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("server");
  if (explicit !== null) return explicit;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Vite proxies /ws to the game server in development; in production they are
  // the same origin.
  return `${protocol}//${window.location.host}/ws`;
}

export function useConnection(url: string) {
  const [state, setState] = useState<NetState>(EMPTY);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encode(message));
  }, []);

  const onMessage = useCallback((message: ServerMessage) => {
    setState((previous) => {
      switch (message.t) {
        case "welcome":
          if (message.token !== "") writeToken(message.token);
          return { ...previous, status: "online", error: null };

        case "room":
          return { ...previous, room: message.room, error: null };

        case "snapshot":
          return {
            ...previous,
            board: message.board,
            view: message.view,
            log: message.log,
            chatLines: message.chat,
            seedCommitment: message.seedCommitment,
            deadline: message.timer?.deadline ?? null,
            error: null,
          };

        case "update":
          return {
            ...previous,
            view: message.view,
            log: [...previous.log, ...message.events],
            deadline: message.timer?.deadline ?? null,
            error: null,
          };

        case "chat":
          return {
            ...previous,
            chatLines: [...previous.chatLines, message.line],
          };

        case "seedRevealed":
          return { ...previous, revealedSeed: message.seed };

        case "error":
          return { ...previous, error: message.message };

        default:
          return previous;
      }
    });
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const connect = (): void => {
      if (closedRef.current) return;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setState((p) => ({ ...p, status: "online" }));
        // Resume a seat if we have one. The server answers with a snapshot, or
        // an error if the session has expired.
        const token = readToken();
        socket.send(
          encode(
            token === null || token === ""
              ? { t: "hello", version: PROTOCOL_VERSION }
              : { t: "hello", version: PROTOCOL_VERSION, token },
          ),
        );
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        onMessage(JSON.parse(event.data) as ServerMessage);
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (closedRef.current) return;
        setState((p) => ({ ...p, status: "reconnecting" }));
        // Back off, but stay responsive: dropped wifi should recover quickly.
        const delay = Math.min(500 * 2 ** retryRef.current, 8000);
        retryRef.current += 1;
        window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket === null) return;
      // Detach before closing. A close or error arriving after the component is
      // gone has nowhere useful to go, and under jsdom it lands in a realm that
      // is already being torn down.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, [url, onMessage]);

  const createRoom = useCallback(
    (nickname: string, playerCount: number) => {
      send({ t: "createRoom", nickname, playerCount });
    },
    [send],
  );

  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      send({ t: "joinRoom", code: code.toUpperCase(), nickname });
    },
    [send],
  );

  const setReady = useCallback(
    (ready: boolean) => {
      send({ t: "setReady", ready });
    },
    [send],
  );

  const startGame = useCallback(() => {
    send({ t: "startGame" });
  }, [send]);

  const command = useCallback(
    (action: Action) => {
      send({ t: "command", action });
    },
    [send],
  );

  const kick = useCallback(
    (player: number) => {
      send({ t: "kick", player });
    },
    [send],
  );

  const sendChat = useCallback(
    (text: string) => {
      send({ t: "chat", text });
    },
    [send],
  );

  const leave = useCallback(() => {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    send({ t: "leaveRoom" });
    setState((p) => ({
      ...p,
      room: null,
      view: null,
      board: null,
      log: [],
      chatLines: [],
    }));
  }, [send]);

  const dismissError = useCallback(() => {
    setState((p) => ({ ...p, error: null }));
  }, []);

  return {
    ...state,
    createRoom,
    joinRoom,
    setReady,
    startGame,
    command,
    kick,
    sendChat,
    leave,
    dismissError,
  };
}
