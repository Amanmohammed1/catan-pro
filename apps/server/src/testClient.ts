/**
 * A scripted WebSocket client, for the integration tests.
 *
 * Deliberately dumb: it knows the protocol and nothing about the rules. It plays
 * only what the server told it is legal, which is the same contract the real UI
 * works under.
 */

import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  encode,
  type ChatLine,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
  type WireView,
} from "@hexport/protocol";
import type { Action, GameEvent, PlayerView } from "@hexport/engine";

export class TestClient {
  private socket: WebSocket | null = null;

  public token = "";
  public room: RoomView | null = null;
  public view: WireView | null = null;
  public board: PlayerView["board"] | null = null;
  public log: GameEvent[] = [];
  public chat: ChatLine[] = [];
  public errors: { code: string; message: string }[] = [];
  public seedCommitment: string | null = null;
  public revealedSeed: string | null = null;
  /** Every raw frame, so a test can audit exactly what crossed the wire. */
  public received: string[] = [];
  /** Bumped whenever the server sends new game state. */
  public revision = 0;
  private waiters: (() => void)[] = [];

  public constructor(public readonly url: string) {}

  public async connect(): Promise<void> {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        resolve();
      });
      socket.once("error", reject);
    });

    socket.on("message", (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      this.received.push(text);
      this.onMessage(JSON.parse(text) as ServerMessage);
      // Wake anyone awaiting the next frame. Polling on a timer instead would
      // add milliseconds per command, which dominates a multi-thousand-command
      // game and turns a fast test into a slow one.
      const waiting = this.waiters;
      this.waiters = [];
      for (const wake of waiting) wake();
    });
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case "welcome":
        if (message.token !== "") this.token = message.token;
        break;
      case "room":
        this.room = message.room;
        break;
      case "snapshot":
        this.revision++;
        this.board = message.board;
        this.view = message.view;
        this.log = [...message.log];
        this.chat = [...message.chat];
        this.seedCommitment = message.seedCommitment;
        break;
      case "update":
        this.revision++;
        // Kept unless this update changed it — only a Fog Islands reveal does
        // (ADR 0009). This mirrored the real client's bug: both assumed the
        // board was fixed for a match, so a revealed hex never arrived and a
        // test asserting on `board` would have passed on stale data.
        if (message.board !== undefined) this.board = message.board;
        this.view = message.view;
        this.log.push(...message.events);
        break;
      case "chat":
        this.chat.push(message.line);
        break;
      case "error":
        this.revision++;
        this.errors.push({ code: message.code, message: message.message });
        break;
      case "seedRevealed":
        this.revealedSeed = message.seed;
        break;
      default:
        break;
    }
  }

  public send(message: ClientMessage): void {
    this.socket?.send(encode(message));
  }

  public hello(token?: string): void {
    this.send(
      token === undefined
        ? { t: "hello", version: PROTOCOL_VERSION }
        : { t: "hello", version: PROTOCOL_VERSION, token },
    );
  }

  public get seat(): number | null {
    return this.room?.you ?? null;
  }

  public get legalMoves(): readonly Action[] {
    return this.view?.legalMoves ?? [];
  }

  public play(action: Action): void {
    this.send({ t: "command", action });
  }

  public close(): void {
    this.socket?.close();
    this.socket = null;
  }

  /** Resolve on the next frame from the server, or after `timeoutMs`. */
  public nextFrame(timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Wait until `predicate` holds, or fail with a useful message. */
  public async until(
    predicate: () => boolean,
    what: string,
    timeoutMs = 4000,
  ): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${what}. Last errors: ${JSON.stringify(this.errors.slice(-3))}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

/** Let queued socket traffic settle. */
export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
