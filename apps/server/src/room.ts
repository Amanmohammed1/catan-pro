/**
 * A room: seats, lobby, and the match once it starts.
 *
 * Rooms own all mutable session state. The Match owns the rules. Keeping those
 * apart is what lets a player disconnect and rejoin without the game noticing.
 */

import { randomBytes } from "node:crypto";
import {
  ROOM_CODE_ALPHABET,
  type ChatLine,
  type RoomSeat,
  type RoomView,
  type ServerMessage,
  type TimerState,
} from "@hexport/protocol";
import type { Action, GameEvent, PlayerId, Scenario } from "@hexport/engine";
import { botName, chooseMove } from "@hexport/bots";
import { Match } from "./match.js";
import { commitToSeed, generateSeed } from "./fairness.js";

export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

export interface Seat {
  readonly player: PlayerId;
  nickname: string;
  /** Secret that lets this seat be resumed on a new socket. */
  readonly token: string;
  connection: Connection | null;
  ready: boolean;
  /**
   * A seat the server plays itself. It has no socket, is always ready, and
   * takes its turn from the same legal-move list a player would be sent.
   */
  readonly bot: boolean;
}

export interface RoomOptions {
  readonly code: string;
  readonly scenario: Scenario;
  readonly maxPlayers: number;
  readonly matchId: string;
  /** Milliseconds a player has to act before auto-pass. 0 disables. */
  readonly turnTimeoutMs?: number;
  /** Milliseconds between a bot's moves, so a table can follow what happened. */
  readonly botPaceMs?: number;
  readonly now?: () => number;
  readonly onCommand?: (
    actor: PlayerId,
    action: Action,
    events: readonly GameEvent[],
    seq: number,
  ) => void;
  readonly onFinished?: (winner: PlayerId | null) => void;
}

export function generateRoomCode(): string {
  const bytes = randomBytes(5);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export class Room {
  public readonly code: string;
  public readonly scenario: Scenario;
  public readonly maxPlayers: number;

  /**
   * A rematch is a new match in the same room: same people, same seats, a new
   * board and a new seed — so these three change while the room does not.
   */
  public matchId: string;
  public seed: string;
  public seedCommitment: string;

  private readonly seats: Seat[] = [];
  private readonly chatLog: ChatLine[] = [];
  private readonly now: () => number;
  private readonly turnTimeoutMs: number;
  private readonly botPaceMs: number;
  /** Earliest moment each bot seat may move again. */
  private readonly botNextMoveAt = new Map<PlayerId, number>();
  private readonly onCommand: RoomOptions["onCommand"];
  private readonly onFinished: RoomOptions["onFinished"];

  private match: Match | null = null;
  private hostPlayer: PlayerId | null = null;
  private timerDeadline: number | null = null;
  private timerPlayer: PlayerId | null = null;

  public constructor(options: RoomOptions) {
    this.code = options.code;
    this.matchId = options.matchId;
    this.scenario = options.scenario;
    this.maxPlayers = Math.min(options.maxPlayers, options.scenario.players.max);
    this.now = options.now ?? (() => Date.now());
    this.turnTimeoutMs = options.turnTimeoutMs ?? 0;
    this.botPaceMs = options.botPaceMs ?? 700;
    this.onCommand = options.onCommand;
    this.onFinished = options.onFinished;
    this.seed = generateSeed();
    this.seedCommitment = commitToSeed(this.seed);
  }

  // ---- seats -------------------------------------------------------------

  public get started(): boolean {
    return this.match !== null;
  }

  public get playerCount(): number {
    return this.seats.length;
  }

  public get isEmpty(): boolean {
    return this.seats.every((seat) => seat.connection === null);
  }

  public seatOf(token: string): Seat | undefined {
    return this.seats.find((seat) => seat.token === token);
  }

  public seatFor(player: PlayerId): Seat | undefined {
    return this.seats.find((seat) => seat.player === player);
  }

  public join(
    nickname: string,
  ): { ok: true; seat: Seat } | { ok: false; reason: string } {
    if (this.match !== null) {
      return { ok: false, reason: "That game has already started." };
    }
    if (this.seats.length >= this.maxPlayers) {
      return { ok: false, reason: "That room is full." };
    }

    const seat: Seat = {
      player: this.seats.length,
      nickname: this.uniqueNickname(nickname),
      token: randomBytes(18).toString("base64url"),
      connection: null,
      ready: false,
      bot: false,
    };
    this.seats.push(seat);
    if (this.hostPlayer === null) this.hostPlayer = seat.player;

    return { ok: true, seat };
  }

  /**
   * Seat a bot. Before the game starts only, and never as host — a room with
   * nobody in charge could not be started or ended by anyone.
   */
  public addBot(): { ok: true; seat: Seat } | { ok: false; reason: string } {
    if (this.match !== null) {
      return { ok: false, reason: "That game has already started." };
    }
    if (this.seats.length >= this.maxPlayers) {
      return { ok: false, reason: "That room is full." };
    }

    const seat: Seat = {
      player: this.seats.length,
      nickname: this.uniqueNickname(botName(this.seats.filter((s) => s.bot).length)),
      token: randomBytes(18).toString("base64url"),
      connection: null,
      // A bot never keeps a table waiting.
      ready: true,
      bot: true,
    };
    this.seats.push(seat);

    return { ok: true, seat };
  }

  /** Two players called "Sam" is a support ticket waiting to happen. */
  private uniqueNickname(wanted: string): string {
    const taken = new Set(this.seats.map((s) => s.nickname.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let i = 2; i < 20; i++) {
      const candidate = `${wanted} ${String(i)}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${wanted} ${randomBytes(2).toString("hex")}`;
  }

  public attach(seat: Seat, connection: Connection): void {
    // A second socket for the same seat replaces the first, rather than both
    // receiving updates. Otherwise a stale tab keeps acting as the player.
    seat.connection?.close();
    seat.connection = connection;
  }

  public detach(seat: Seat): void {
    seat.connection = null;
  }

  /** Remove a seat entirely. Only legal before the game starts. */
  public removeSeat(player: PlayerId): boolean {
    if (this.match !== null) return false;
    const index = this.seats.findIndex((seat) => seat.player === player);
    if (index < 0) return false;

    const [removed] = this.seats.splice(index, 1);
    removed?.connection?.close();

    // Seat numbers are positional, so close the gap.
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat !== undefined) {
        (seat as { player: PlayerId }).player = i;
      }
    }
    if (this.hostPlayer !== null && this.hostPlayer >= this.seats.length) {
      this.hostPlayer = this.seats.length > 0 ? 0 : null;
    }
    return true;
  }

  public isHost(player: PlayerId): boolean {
    return this.hostPlayer === player;
  }

  // ---- lobby -------------------------------------------------------------

  public setReady(player: PlayerId, ready: boolean): void {
    const seat = this.seatFor(player);
    if (seat !== undefined) seat.ready = ready;
  }

  public canStart(): { ok: true } | { ok: false; reason: string } {
    if (this.match !== null) return { ok: false, reason: "Already started." };
    if (this.seats.length < this.scenario.players.min) {
      return {
        ok: false,
        reason: `Needs at least ${String(this.scenario.players.min)} players.`,
      };
    }
    if (!this.seats.every((seat) => seat.ready)) {
      return { ok: false, reason: "Not everyone is ready." };
    }
    return { ok: true };
  }

  public start(): { ok: true } | { ok: false; reason: string } {
    const allowed = this.canStart();
    if (!allowed.ok) return allowed;

    this.match = new Match({
      scenario: this.scenario,
      seed: this.seed,
      playerNames: this.seats.map((seat) => seat.nickname),
      now: this.now,
    });
    this.resetTimer();
    return { ok: true };
  }

  /**
   * Play again: the same people in the same seats, on a new board.
   *
   * Only once the game is decided — a rematch mid-game would be a way for a
   * losing host to wipe the board. The seed is new, and so is the commitment
   * published with it, because the old seed has already been revealed.
   */
  public rematch(): { ok: true } | { ok: false; reason: string } {
    const match = this.match;
    if (match === null) return { ok: false, reason: "The game has not started." };
    if (!match.isOver) return { ok: false, reason: "That game is still going." };

    this.match = null;
    this.matchId = `${this.code}-${String(this.now())}`;
    this.seed = generateSeed();
    this.seedCommitment = commitToSeed(this.seed);
    for (const seat of this.seats) seat.ready = true;

    return this.start();
  }

  /** Restore an in-progress match, e.g. after a server restart. */
  public restore(
    match: Match,
    seats: readonly { nickname: string; token: string }[],
  ): void {
    this.seats.length = 0;
    seats.forEach((info, index) => {
      this.seats.push({
        player: index,
        nickname: info.nickname,
        token: info.token,
        connection: null,
        ready: true,
        // A restored match has no record of which seats were bots; they come
        // back as people, and the turn timer keeps the game moving.
        bot: false,
      });
    });
    this.hostPlayer = this.seats.length > 0 ? 0 : null;
    this.match = match;
    this.resetTimer();
  }

  // ---- play --------------------------------------------------------------

  public getMatch(): Match | null {
    return this.match;
  }

  public command(
    actor: PlayerId,
    action: Action,
  ): { ok: true; events: readonly GameEvent[] } | { ok: false; reason: string } {
    const match = this.match;
    if (match === null) return { ok: false, reason: "The game has not started." };

    const seq = match.commandLog.length;
    const result = match.apply(actor, action);
    if (!result.ok) return result;

    this.onCommand?.(actor, action, result.events, seq);
    this.resetTimer();

    if (match.isOver) {
      this.timerDeadline = null;
      this.timerPlayer = null;
      this.onFinished?.(match.winner);
    }

    return result;
  }

  // ---- turn timer --------------------------------------------------------

  public get timer(): TimerState | null {
    if (this.timerDeadline === null || this.timerPlayer === null) return null;
    return { player: this.timerPlayer, deadline: this.timerDeadline };
  }

  private resetTimer(): void {
    if (this.turnTimeoutMs <= 0 || this.match === null || this.match.isOver) {
      this.timerDeadline = null;
      this.timerPlayer = null;
      return;
    }
    const waiting = this.match.waitingOn();
    const next = waiting[0];
    if (next === undefined) {
      this.timerDeadline = null;
      this.timerPlayer = null;
      return;
    }
    this.timerPlayer = next;
    this.timerDeadline = this.now() + this.turnTimeoutMs;
  }

  /**
   * Auto-pass anyone who has run out of time.
   *
   * Called on a tick rather than a per-turn setTimeout so a paused or backgrounded
   * process cannot leave a game wedged. Returns the commands it played.
   */
  public tickTimer(): { actor: PlayerId; action: Action }[] {
    const played: { actor: PlayerId; action: Action }[] = [];
    const match = this.match;
    if (match === null || match.isOver) return played;
    if (this.turnTimeoutMs <= 0) return played;
    if (this.timerDeadline === null || this.now() < this.timerDeadline) return played;

    // Bounded: one expiry may unblock the next player, but never loop forever.
    for (let guard = 0; guard < 8; guard++) {
      if (match.isOver) break;
      const waiting = match.waitingOn();
      const actor = waiting[0];
      if (actor === undefined) break;

      const action = autoPassAction(match.legalFor(actor));
      if (action === null) break;

      const result = this.command(actor, action);
      if (!result.ok) break;
      played.push({ actor, action });

      if (this.timerDeadline === null || this.now() < this.timerDeadline) break;
    }

    return played;
  }

  // ---- bots ---------------------------------------------------------------

  public get hasBots(): boolean {
    return this.seats.some((seat) => seat.bot);
  }

  /**
   * Play for any bot seat the game is waiting on.
   *
   * A bot is handed exactly what a player would be — the legal moves for its
   * own seat and its own redacted view — so it can do nothing a player could
   * not, and sees nothing a player could not. Paced, because a table that
   * cannot see what the bots did might as well be playing alone.
   *
   * Returns what it played, so the caller can tell everyone.
   */
  public tickBots(): { actor: PlayerId; events: readonly GameEvent[] }[] {
    const played: { actor: PlayerId; events: readonly GameEvent[] }[] = [];
    const match = this.match;
    if (match === null || match.isOver || !this.hasBots) return played;

    // Bounded: one bot's move can unblock another, but never loop forever.
    for (let guard = 0; guard < 12; guard++) {
      if (match.isOver) break;

      const actor = match
        .waitingOn()
        .find((player) => this.seatFor(player)?.bot === true);
      if (actor === undefined) break;

      const now = this.now();
      if (now < (this.botNextMoveAt.get(actor) ?? 0)) break;

      const move = chooseMove({
        phase: match.viewFor(actor).phase,
        legalMoves: match.legalFor(actor),
      });
      if (move === null) break;

      const result = this.command(actor, move);
      if (!result.ok) break;

      played.push({ actor, events: result.events });
      this.botNextMoveAt.set(actor, now + this.botPaceMs);
    }

    return played;
  }

  // ---- chat --------------------------------------------------------------

  public addChat(line: ChatLine): void {
    this.chatLog.push(line);
    if (this.chatLog.length > 200) this.chatLog.shift();
  }

  public get chat(): readonly ChatLine[] {
    return this.chatLog;
  }

  // ---- views -------------------------------------------------------------

  public view(you: PlayerId | null): RoomView {
    const seats: RoomSeat[] = this.seats.map((seat) => ({
      player: seat.player,
      nickname: seat.nickname,
      connected: seat.connection !== null,
      ready: seat.ready,
      isHost: this.hostPlayer === seat.player,
      isBot: seat.bot,
    }));

    return {
      code: this.code,
      scenarioId: this.scenario.id,
      seats,
      started: this.started,
      you,
      hostPlayer: this.hostPlayer,
      maxPlayers: this.maxPlayers,
    };
  }

  public broadcast(build: (seat: Seat) => ServerMessage | null): void {
    for (const seat of this.seats) {
      if (seat.connection === null) continue;
      const message = build(seat);
      if (message !== null) seat.connection.send(message);
    }
  }

  public allSeats(): readonly Seat[] {
    return this.seats;
  }
}

/**
 * What to play on behalf of a player who has timed out.
 *
 * Prefers the least destructive option: ending the turn, or rolling so the game
 * can move on. Falls back to the first legal move for phases like discarding or
 * moving the robber, where doing nothing is not an option.
 */
export function autoPassAction(moves: readonly Action[]): Action | null {
  return (
    moves.find((m) => m.t === "endTurn") ??
    moves.find((m) => m.t === "rollDice") ??
    moves.find((m) => m.t === "endRoadBuilding") ??
    moves.find((m) => m.t === "cancelTrade") ??
    moves.find((m) => m.t === "respondTrade" && !m.accept) ??
    moves[0] ??
    null
  );
}
