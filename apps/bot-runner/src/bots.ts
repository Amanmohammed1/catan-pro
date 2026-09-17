#!/usr/bin/env node
/**
 * pnpm bots — seat a room with bots and wait for a human to join.
 *
 * The handover has asked for this since M2: there was a throwaway script that
 * opened a room and seated bot clients, and it was never committed. This is it,
 * committed.
 *
 *   pnpm bots                       a 4-seat room: 3 bots and you
 *   pnpm bots --players 6 --bots 5
 *   pnpm bots --server ws://127.0.0.1:8787
 *
 * A bot is deliberately as dumb as the test client: it knows the protocol and
 * nothing about the rules. It plays only what the server told it is legal
 * (`view.legalMoves`), which is the same contract the real UI works under — so
 * a bot cannot do anything a player could not, and cannot see anything a player
 * could not either, because it holds the same redacted view.
 */

import { botName, chooseMove } from "@hexport/bots";
import { PROTOCOL_VERSION, encode } from "@hexport/protocol";
import type { ClientMessage, RoomView, ServerMessage, WireView } from "@hexport/protocol";

interface Options {
  readonly server: string;
  readonly players: number;
  readonly bots: number;
  /** Milliseconds between a bot's moves, so a human can follow along. */
  readonly pace: number;
}

function parseArgs(argv: readonly string[]): Options {
  let server = "ws://127.0.0.1:8787";
  let players = 4;
  let bots = 3;
  let pace = 700;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--server" && value !== undefined) server = value;
    if (arg === "--players" && value !== undefined) players = Number(value);
    if (arg === "--bots" && value !== undefined) bots = Number(value);
    if (arg === "--pace" && value !== undefined) pace = Number(value);
  }

  if (!Number.isFinite(players) || players < 2 || players > 6) {
    throw new Error("--players must be between 2 and 6");
  }
  if (!Number.isFinite(bots) || bots < 1 || bots >= players) {
    throw new Error("--bots must be at least 1 and leave a seat for a human");
  }
  return { server, players, bots, pace };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// How a bot chooses is shared with the server's lobby bots (@hexport/bots), so
// the opponents you get from `pnpm bots` play exactly like the ones you add
// from the lobby.

class Bot {
  private socket: WebSocket | null = null;
  private view: WireView | null = null;
  private room: RoomView | null = null;
  private busy = false;
  private closed = false;

  public constructor(
    public readonly name: string,
    private readonly options: Options,
    /** The host bot creates the room; the others join it. */
    private readonly join: { code: string } | null,
    private readonly onRoom: (room: RoomView) => void,
  ) {}

  public async connect(): Promise<void> {
    const socket = new WebSocket(this.options.server);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => {
        resolve();
      });
      socket.addEventListener("error", () => {
        reject(new Error(`Could not reach the server at ${this.options.server}`));
      });
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      void this.onMessage(message);
    });
    socket.addEventListener("close", () => {
      this.closed = true;
    });

    this.send({ t: "hello", version: PROTOCOL_VERSION });
    this.send(
      this.join === null
        ? {
            t: "createRoom",
            nickname: this.name,
            playerCount: this.options.players,
          }
        : { t: "joinRoom", code: this.join.code, nickname: this.name },
    );
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encode(message));
  }

  private async onMessage(message: ServerMessage): Promise<void> {
    switch (message.t) {
      case "room":
        this.room = message.room;
        this.onRoom(message.room);
        // Bots are always ready; the game waits on the human.
        if (message.room.seats.some((seat) => seat.player === message.room.you && !seat.ready)) {
          this.send({ t: "setReady", ready: true });
        }
        this.maybeStart();
        return;

      case "snapshot":
      case "update":
        this.view = message.view;
        await this.maybeMove();
        return;

      case "error":
        // A refused move means the view moved on under us; the next update will
        // say what is legal now.
        if (message.code !== "illegal-move") {
          process.stdout.write(`  ${this.name}: ${message.message}\n`);
        }
        return;

      default:
        return;
    }
  }

  /** The host starts once every seat is filled and ready. */
  private maybeStart(): void {
    const room = this.room;
    if (room === null || this.join !== null || room.started) return;
    if (room.seats.length < room.maxPlayers) return;
    if (!room.seats.every((seat) => seat.ready)) return;
    this.send({ t: "startGame" });
  }

  private async maybeMove(): Promise<void> {
    const view = this.view;
    if (view === null || this.busy || this.closed) return;
    if (view.legalMoves.length === 0) return;

    this.busy = true;
    try {
      await sleep(this.options.pace);
      const current = this.view;
      if (current === null || current.legalMoves.length === 0) return;
      const move = chooseMove({
        phase: current.phase,
        legalMoves: current.legalMoves,
      });
      if (move !== null) this.send({ t: "command", action: move });
    } finally {
      this.busy = false;
    }

    // The same view can owe more than one move (a building window, say).
    if (this.view !== null && this.view.legalMoves.length > 0) {
      await this.maybeMove();
    }
  }

  /** Host only: deal a new board once the game is decided. */
  public rematch(): void {
    this.send({ t: "rematch" });
  }

  public get finished(): boolean {
    return this.view?.winner !== null && this.view?.winner !== undefined;
  }

  public close(): void {
    this.closed = true;
    this.socket?.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const humans = options.players - options.bots;

  let code = "";
  const host = new Bot(botName(0), options, null, (room) => {
    code = room.code;
  });

  process.stdout.write(`Connecting to ${options.server}…\n`);
  await host.connect();

  // Wait for the room, then seat the rest of the bots in it.
  for (let i = 0; i < 200 && code === ""; i += 1) await sleep(25);
  if (code === "") throw new Error("The server never sent a room code.");

  const bots: Bot[] = [host];
  for (let i = 1; i < options.bots; i += 1) {
    const bot = new Bot(botName(i), options, { code }, () => {
      /* only the host acts on room updates */
    });
    await bot.connect();
    bots.push(bot);
    await sleep(120);
  }

  process.stdout.write(
    [
      "",
      `  Room ${code} is open with ${String(options.bots)} bot${options.bots === 1 ? "" : "s"}.`,
      "",
      `  Open  http://localhost:5173/?join=${code}`,
      `  Type a name, press Join, then "I'm ready" — the bots start the game.`,
      `  ${String(humans)} seat${humans === 1 ? "" : "s"} left for people.`,
      "",
      "  Ctrl-C to stop the bots.",
      "",
    ].join("\n"),
  );

  // Keep the process alive, and deal another board a few seconds after a win so
  // the table can keep playing without anyone touching the terminal.
  for (;;) {
    await sleep(3000);
    if (host.finished) {
      await sleep(6000);
      process.stdout.write("  That game is over — dealing another board.\n");
      host.rematch();
      await sleep(4000);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
