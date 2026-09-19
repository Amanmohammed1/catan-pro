/**
 * The game server: Fastify for HTTP, plain `ws` for the game socket.
 *
 * PLAN.md: "The transport is plain WebSocket with a zod-validated message
 * protocol in packages/protocol — do not pull in a game-server framework."
 *
 * Two rules shape everything here:
 *   - The actor is the socket's seat, never a field in the message. A client
 *     cannot act as another player by editing `action.player`.
 *   - Every outbound game message goes through Match.viewFor(), so a client only
 *     ever receives its own hand (golden rule 5).
 */

import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  decodeClientFrame,
  encode,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "@hexport/protocol";
import { loadScenario } from "@hexport/scenarios";
import type { PlayerId } from "@hexport/engine";
import { Room, generateRoomCode, type Connection, type Seat } from "./room.js";
import { MemoryMatchStore, type MatchStore } from "./store.js";

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly store?: MatchStore;
  readonly turnTimeoutMs?: number;
  /** Tick interval for the turn timer, and for bot seats. */
  readonly timerIntervalMs?: number;
  /** Milliseconds between a bot's moves. 0 makes them play as fast as ticks. */
  readonly botPaceMs?: number;
  readonly logger?: boolean;
}

interface Session {
  socket: WebSocket;
  room: Room | null;
  seat: Seat | null;
  /** Simple flood control: timestamps of recent messages. */
  recent: number[];
}

/**
 * Flood control, per socket.
 *
 * Generous by design: a person clicking as fast as they can manage sends a
 * handful of messages a second, so this only ever catches a runaway client or a
 * deliberate flood. Set it too low and a legitimate burst — placing two free
 * roads, then building — gets refused, which looks like the game is broken.
 */
const MAX_MESSAGES_PER_SECOND = 120;

export class GameServer {
  private readonly app: FastifyInstance;
  private readonly wss: WebSocketServer;
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Set<Session>();
  private readonly store: MatchStore;
  private readonly turnTimeoutMs: number;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private readonly timerIntervalMs: number;
  private readonly botPaceMs: number;

  public constructor(private readonly options: ServerOptions = {}) {
    this.app = Fastify({ logger: options.logger ?? false });
    this.wss = new WebSocketServer({ noServer: true });
    this.store = options.store ?? new MemoryMatchStore();
    this.turnTimeoutMs = options.turnTimeoutMs ?? 0;
    this.timerIntervalMs = options.timerIntervalMs ?? 1000;
    this.botPaceMs = options.botPaceMs ?? 700;

    this.app.get("/health", () => ({
      ok: true,
      rooms: this.rooms.size,
      sessions: this.sessions.size,
    }));

    // Handy for a player who wants to check a finished game's dice themselves.
    this.app.get<{ Params: { code: string } }>(
      "/room/:code",
      async (request, reply) => {
        const room = this.rooms.get(request.params.code.toUpperCase());
        if (room === undefined) {
          return reply.code(404).send({ error: "No such room" });
        }
        return {
          code: room.code,
          started: room.started,
          players: room.playerCount,
          maxPlayers: room.maxPlayers,
          seedCommitment: room.seedCommitment,
          // The seed itself is only ever revealed once the game is over.
          seed: room.getMatch()?.isOver === true ? room.seed : null,
        };
      },
    );

    this.app.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });

    this.wss.on("connection", (socket: WebSocket) => {
      this.onConnection(socket);
    });
  }

  // ---- lifecycle ---------------------------------------------------------

  public async listen(): Promise<string> {
    const address = await this.app.listen({
      port: this.options.port ?? 8787,
      host: this.options.host ?? "127.0.0.1",
    });
    // Always ticking: the turn timer is optional, but bot seats are not driven
    // by anything else, and a room full of bots with no tick never moves.
    this.timerHandle = setInterval(() => {
      this.runTimers();
    }, this.timerIntervalMs);
    this.timerHandle.unref?.();
    return address;
  }

  public async close(): Promise<void> {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    for (const session of this.sessions) session.socket.close();
    this.wss.close();
    await this.app.close();
  }

  public get port(): number {
    const address = this.app.server.address();
    if (address === null || typeof address === "string") return 0;
    return address.port;
  }

  // ---- sockets -----------------------------------------------------------

  private onConnection(socket: WebSocket): void {
    const session: Session = { socket, room: null, seat: null, recent: [] };
    this.sessions.add(session);

    socket.on("message", (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      if (this.isFlooding(session)) {
        this.fail(session, "rate-limited", "Slow down.");
        return;
      }

      const decoded = decodeClientFrame(text);
      if (!decoded.ok) {
        this.fail(session, "bad-message", decoded.reason);
        return;
      }

      try {
        this.handle(session, decoded.message);
      } catch (error) {
        this.fail(
          session,
          "internal",
          error instanceof Error ? error.message : "Unexpected error",
        );
      }
    });

    socket.on("close", () => {
      if (session.room !== null && session.seat !== null) {
        session.room.detach(session.seat);
        const room = session.room;
        // Tell the table someone dropped, so the UI can grey them out rather
        // than leaving people waiting on a player who is gone.
        room.broadcast((seat) => ({ t: "room", room: room.view(seat.player) }));
        this.reapIfEmpty(room);
      }
      this.sessions.delete(session);
    });

    this.send(session, {
      t: "welcome",
      version: PROTOCOL_VERSION,
      token: "",
    });
  }

  private isFlooding(session: Session): boolean {
    const now = Date.now();
    session.recent = session.recent.filter((t) => now - t < 1000);
    session.recent.push(now);
    return session.recent.length > MAX_MESSAGES_PER_SECOND;
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.socket.readyState !== session.socket.OPEN) return;
    session.socket.send(encode(message));
  }

  private fail(session: Session, code: ErrorCode, message: string): void {
    this.send(session, { t: "error", code, message });
  }

  private connectionFor(session: Session): Connection {
    return {
      send: (message) => {
        this.send(session, message);
      },
      close: () => {
        session.socket.close();
      },
    };
  }

  // ---- message handling --------------------------------------------------

  private handle(session: Session, message: ClientMessage): void {
    switch (message.t) {
      case "hello":
        this.onHello(session, message);
        return;
      case "createRoom":
        this.onCreateRoom(session, message);
        return;
      case "joinRoom":
        this.onJoinRoom(session, message);
        return;
      case "leaveRoom":
        this.onLeaveRoom(session);
        return;
      case "setReady":
        this.onSetReady(session, message.ready);
        return;
      case "startGame":
        this.onStartGame(session);
        return;
      case "command":
        this.onCommand(session, message.action);
        return;
      case "rematch":
        this.onRematch(session);
        return;
      case "addBot":
        this.onAddBot(session);
        return;
      case "removeBot":
        this.onRemoveBot(session, message.player);
        return;
      case "kick":
        this.onKick(session, message.player);
        return;
      case "chat":
        this.onChat(session, message.text);
        return;
      case "ping":
        this.send(session, { t: "pong" });
        return;
      default:
        this.fail(session, "bad-message", "Unknown message.");
    }
  }

  private onHello(
    session: Session,
    message: Extract<ClientMessage, { t: "hello" }>,
  ): void {
    if (message.version !== PROTOCOL_VERSION) {
      this.fail(
        session,
        "bad-version",
        `This server speaks protocol ${String(PROTOCOL_VERSION)}; you sent ${String(message.version)}. Reload the page.`,
      );
      return;
    }

    if (message.token === undefined) {
      this.send(session, { t: "welcome", version: PROTOCOL_VERSION, token: "" });
      return;
    }

    // Resume: find the seat this token belongs to and reattach.
    for (const room of this.rooms.values()) {
      const seat = room.seatOf(message.token);
      if (seat === undefined) continue;

      session.room = room;
      session.seat = seat;
      room.attach(seat, this.connectionFor(session));

      this.send(session, {
        t: "welcome",
        version: PROTOCOL_VERSION,
        token: seat.token,
      });
      this.send(session, { t: "room", room: room.view(seat.player) });
      this.sendSnapshot(session, room, seat.player);
      room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
      return;
    }

    this.fail(session, "no-room", "That session has expired.");
  }

  private onCreateRoom(
    session: Session,
    message: Extract<ClientMessage, { t: "createRoom" }>,
  ): void {
    // Three or four players share the classic island; five or six need the
    // larger board, which loads the 5–6 rule module with it (ADR 0006).
    const seats = message.playerCount;
    const scenarioId =
      message.scenarioId ??
      (seats !== undefined && seats > 4 ? "classic-5-6" : "classic-3-4");
    let scenario;
    try {
      scenario = loadScenario(scenarioId);
    } catch {
      this.fail(session, "bad-message", `Unknown scenario "${scenarioId}".`);
      return;
    }

    let code = generateRoomCode();
    for (let i = 0; i < 10 && this.rooms.has(code); i++) code = generateRoomCode();

    const matchId = `${code}-${String(Date.now())}`;
    const room = new Room({
      code,
      matchId,
      scenario,
      maxPlayers: message.playerCount ?? scenario.players.max,
      turnTimeoutMs: this.turnTimeoutMs,
      botPaceMs: this.botPaceMs,
      onCommand: (actor, action, events, seq) => {
        void this.store.appendCommand({
          matchId,
          seq,
          actor,
          action,
          events,
          at: Date.now(),
        });
      },
      onFinished: (winner) => {
        void this.store.finishMatch(matchId, winner, Date.now());
      },
    });

    this.rooms.set(code, room);
    this.seatInto(session, room, message.nickname);

    // Bots asked for at creation fill the seats behind the host, so a room is
    // playable the moment it exists rather than only once friends arrive.
    let seated = 0;
    for (let i = 0; i < (message.bots ?? 0); i += 1) {
      if (!room.addBot().ok) break;
      seated += 1;
    }
    if (seated > 0) {
      room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
    }
  }

  private onJoinRoom(
    session: Session,
    message: Extract<ClientMessage, { t: "joinRoom" }>,
  ): void {
    const room = this.rooms.get(message.code);
    if (room === undefined) {
      this.fail(session, "no-room", `No room with code ${message.code}.`);
      return;
    }
    this.seatInto(session, room, message.nickname);
  }

  private seatInto(session: Session, room: Room, nickname: string): void {
    const joined = room.join(nickname);
    if (!joined.ok) {
      this.fail(session, room.started ? "room-started" : "room-full", joined.reason);
      return;
    }

    session.room = room;
    session.seat = joined.seat;
    room.attach(joined.seat, this.connectionFor(session));

    this.send(session, {
      t: "welcome",
      version: PROTOCOL_VERSION,
      token: joined.seat.token,
    });
    room.broadcast((seat) => ({ t: "room", room: room.view(seat.player) }));
  }

  private onLeaveRoom(session: Session): void {
    const { room, seat } = session;
    if (room === null || seat === null) return;

    if (!room.started) {
      room.removeSeat(seat.player);
    } else {
      room.detach(seat);
    }
    session.room = null;
    session.seat = null;
    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
    this.reapIfEmpty(room);
  }

  private onSetReady(session: Session, ready: boolean): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    room.setReady(seat.player, ready);
    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
  }

  private onStartGame(session: Session): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    if (!room.isHost(seat.player)) {
      this.fail(session, "not-host", "Only the host can start the game.");
      return;
    }

    const started = room.start();
    if (!started.ok) {
      this.fail(session, "bad-message", started.reason);
      return;
    }

    void this.store.createMatch({
      matchId: room.matchId,
      roomCode: room.code,
      scenarioId: room.scenario.id,
      seed: room.seed,
      seedCommitment: room.seedCommitment,
      playerNames: room.allSeats().map((s) => s.nickname),
      createdAt: Date.now(),
      finishedAt: null,
      winner: null,
    });

    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
    this.broadcastSnapshot(room);
  }

  private onCommand(
    session: Session,
    action: Extract<ClientMessage, { t: "command" }>["action"],
  ): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }

    // The actor comes from the socket, not the payload.
    const result = room.command(seat.player, { ...action, player: seat.player });
    if (!result.ok) {
      this.fail(session, "illegal-move", result.reason);
      // Resync the offender: their view may be stale, which is often why they
      // sent something illegal in the first place.
      this.sendSnapshot(session, room, seat.player);
      return;
    }

    this.broadcastUpdate(room, result.events);
    this.maybeRevealSeed(room);
  }

  /**
   * Fill a seat with a bot the server plays itself.
   *
   * Host only, and only before the game starts — the seats are the table, and
   * changing them mid-game would renumber everyone's command log.
   */
  private onAddBot(session: Session): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    if (!room.isHost(seat.player)) {
      this.fail(session, "not-host", "Only the host can add bots.");
      return;
    }

    const added = room.addBot();
    if (!added.ok) {
      this.fail(session, "bad-message", added.reason);
      return;
    }

    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
  }

  /** Free a bot's seat again. Host only, before the game starts. */
  private onRemoveBot(session: Session, player: PlayerId): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    if (!room.isHost(seat.player)) {
      this.fail(session, "not-host", "Only the host can remove bots.");
      return;
    }

    const target = room.seatFor(player);
    if (target === undefined || !target.bot) {
      this.fail(session, "bad-message", "That seat is not a bot.");
      return;
    }
    if (!room.removeSeat(player)) {
      this.fail(session, "bad-message", "That game has already started.");
      return;
    }

    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
  }

  private onKick(session: Session, player: PlayerId): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    if (!room.isHost(seat.player)) {
      this.fail(session, "not-host", "Only the host can remove players.");
      return;
    }
    if (player === seat.player) {
      this.fail(session, "bad-message", "You cannot kick yourself.");
      return;
    }

    const target = room.seatFor(player);
    if (target === undefined) {
      this.fail(session, "bad-message", "No such seat.");
      return;
    }

    if (room.started) {
      // Mid-game removal would corrupt the seat numbering the command log is
      // keyed on, so a kicked player is disconnected and auto-passed instead.
      target.connection?.send({
        t: "error",
        code: "not-seated",
        message: "The host removed you from the game.",
      });
      target.connection?.close();
      room.detach(target);
    } else {
      room.removeSeat(player);
    }

    room.broadcast((other) => ({ t: "room", room: room.view(other.player) }));
  }

  private onChat(session: Session, text: string): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    const line = {
      from: seat.nickname,
      player: seat.player,
      text,
      at: Date.now(),
    };
    room.addChat(line);
    room.broadcast(() => ({ t: "chat", line }));
  }

  // ---- outbound ----------------------------------------------------------

  /**
   * Play the same people again on a new board.
   *
   * Host only, and only once the game is decided. The new match gets its own
   * id, so the command log of the game just finished stays intact and
   * replayable rather than being appended to.
   */
  private onRematch(session: Session): void {
    const { room, seat } = session;
    if (room === null || seat === null) {
      this.fail(session, "not-seated", "Join a room first.");
      return;
    }
    if (!room.isHost(seat.player)) {
      this.fail(session, "not-host", "Only the host can start a rematch.");
      return;
    }

    const started = room.rematch();
    if (!started.ok) {
      this.fail(session, "bad-message", started.reason);
      return;
    }

    void this.store.createMatch({
      matchId: room.matchId,
      roomCode: room.code,
      scenarioId: room.scenario.id,
      seed: room.seed,
      seedCommitment: room.seedCommitment,
      playerNames: room.allSeats().map((s) => s.nickname),
      createdAt: Date.now(),
      finishedAt: null,
      winner: null,
    });

    this.broadcastSnapshot(room);
  }

  private sendSnapshot(session: Session, room: Room, player: PlayerId): void {
    const match = room.getMatch();
    if (match === null) {
      this.send(session, { t: "room", room: room.view(player) });
      return;
    }
    const view = match.viewFor(player);
    const { board, ...rest } = view;
    this.send(session, {
      t: "snapshot",
      board,
      view: { ...rest, legalMoves: match.legalFor(player) },
      // The history is redacted the same way live updates are. Sending the raw
      // log here would hand a reconnecting player every stolen card and every
      // development card drawn since the game began.
      log: redactEvents(match.log, player),
      chat: room.chat,
      seedCommitment: room.seedCommitment,
      timer: room.timer,
    });
  }

  private broadcastSnapshot(room: Room): void {
    const match = room.getMatch();
    if (match === null) return;
    room.broadcast((seat) => {
      const view = match.viewFor(seat.player);
      const { board, ...rest } = view;
      return {
        t: "snapshot",
        board,
        view: { ...rest, legalMoves: match.legalFor(seat.player) },
        log: redactEvents(match.log, seat.player),
        chat: room.chat,
        seedCommitment: room.seedCommitment,
        timer: room.timer,
      };
    });
  }

  private broadcastUpdate(
    room: Room,
    events: readonly import("@hexport/engine").GameEvent[],
  ): void {
    const match = room.getMatch();
    if (match === null) return;

    // The board normally ships once, in the snapshot. The Fog Islands is the
    // exception: building beside an empty space turns a hex face up (Seafarers
    // p.8), which changes terrain, a number and six edge kinds. Sending it only
    // when a reveal actually happened keeps every other update the size it was.
    const boardChanged = events.some((event) => event.e === "hexRevealed");

    room.broadcast((seat) => {
      const view = match.viewFor(seat.player);
      const rest: Omit<typeof view, "board"> = view;
      return {
        t: "update",
        events: redactEvents(events, seat.player),
        view: { ...rest, legalMoves: match.legalFor(seat.player) },
        timer: room.timer,
        ...(boardChanged ? { board: view.board } : {}),
      };
    });
  }

  /** Publish the seed once the game is decided, so anyone can check the dice. */
  private maybeRevealSeed(room: Room): void {
    if (room.getMatch()?.isOver !== true) return;
    room.broadcast(() => ({ t: "seedRevealed", seed: room.seed }));
  }

  private reapIfEmpty(room: Room): void {
    if (!room.isEmpty) return;
    // Keep finished or in-progress games around briefly so a reload can rejoin.
    if (room.started) return;
    this.rooms.delete(room.code);
  }

  // ---- test helpers ------------------------------------------------------

  public getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  public runTimers(): void {
    for (const room of this.rooms.values()) {
      const passed = room.tickTimer();
      if (passed.length > 0) {
        this.broadcastSnapshot(room);
        this.maybeRevealSeed(room);
      }

      // Bots move on the same tick. Their moves go out as updates rather than
      // snapshots, so they carry their events and the table sees the dice roll,
      // the settlement landing and hears them, exactly as for a human's move.
      const botMoves = room.tickBots();
      if (botMoves.length === 0) continue;
      this.broadcastUpdate(
        room,
        botMoves.flatMap((move) => move.events),
      );
      this.maybeRevealSeed(room);
    }
  }
}

/**
 * Strip secrets from events before they leave the server.
 *
 * A stolen card's identity is known only to the thief and the victim (p.5: "you
 * take 1 of their cards at random"), and a drawn development card only to its
 * buyer. Everyone else sees that it happened, not what it was.
 */
export function redactEvents(
  events: readonly import("@hexport/engine").GameEvent[],
  viewer: PlayerId,
): import("@hexport/engine").GameEvent[] {
  return events.map((event) => {
    if (event.e === "cardStolen") {
      if (event.from === viewer || event.to === viewer) return event;
      return { ...event, resource: null };
    }
    if (event.e === "devCardBought") {
      if (event.player === viewer) return event;
      return { ...event, kind: null };
    }
    return event;
  });
}
