/**
 * A match: the authoritative game plus its append-only command log.
 *
 * CLAUDE.md golden rule 2 — the server is the only authority. Clients send
 * commands; this decides what actually happened.
 *
 * Golden rule 6 — event sourced. Every accepted command is appended with the
 * events it produced. Because the engine is deterministic (golden rule 4), the
 * seed plus the command log reproduces the state exactly, which is what makes
 * reconnect and restart-from-database work without snapshotting.
 */

import {
  createGame,
  legalMoves,
  playerView,
  reduce,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerView,
  type Scenario,
} from "@hexport/engine";

export interface LoggedCommand {
  readonly seq: number;
  readonly actor: PlayerId;
  readonly action: Action;
  readonly events: readonly GameEvent[];
  readonly at: number;
}

export interface MatchOptions {
  readonly scenario: Scenario;
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly now?: () => number;
}

export type CommandResult =
  | { readonly ok: true; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: string };

export class Match {
  private state: GameState;
  private readonly commands: LoggedCommand[] = [];
  private readonly events: GameEvent[] = [];
  private readonly now: () => number;

  public readonly seed: string;
  public readonly scenario: Scenario;

  public constructor(options: MatchOptions) {
    this.scenario = options.scenario;
    this.seed = options.seed;
    this.now = options.now ?? (() => Date.now());
    this.state = createGame({
      scenario: options.scenario,
      seed: options.seed,
      playerNames: options.playerNames,
    });
  }

  /**
   * Apply a command from a player.
   *
   * The actor is taken from the connection, never from the message body, so a
   * client cannot act as someone else by setting `action.player`.
   */
  public apply(actor: PlayerId, action: Action): CommandResult {
    if (action.player !== actor) {
      return { ok: false, reason: "You may only act as yourself." };
    }

    const result = reduce(this.state, action);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    this.state = result.state;
    this.commands.push({
      seq: this.commands.length,
      actor,
      action,
      events: result.events,
      at: this.now(),
    });
    this.events.push(...result.events);

    return { ok: true, events: result.events };
  }

  /** The redacted view for one player. Never expose getState to a client. */
  public viewFor(player: PlayerId): PlayerView {
    return playerView(this.state, player);
  }

  public legalFor(player: PlayerId): Action[] {
    return legalMoves(this.state, player);
  }

  /** Everything the server itself needs. Never sent over the wire. */
  public getState(): GameState {
    return this.state;
  }

  public get winner(): PlayerId | null {
    return this.state.winner;
  }

  public get currentPlayer(): PlayerId {
    return this.state.currentPlayer;
  }

  public get isOver(): boolean {
    return this.state.winner !== null;
  }

  public get log(): readonly GameEvent[] {
    return this.events;
  }

  public get commandLog(): readonly LoggedCommand[] {
    return this.commands;
  }

  /**
   * Players the game is currently waiting on.
   *
   * Usually just the active player, but a 7 makes everyone over the hand limit
   * act, and a trade offer makes every opponent answer. The turn timer needs
   * this so it does not auto-pass someone who is not actually holding things up.
   */
  public waitingOn(): PlayerId[] {
    const out: PlayerId[] = [];
    for (const seat of this.state.players) {
      if (legalMoves(this.state, seat.id).length > 0) out.push(seat.id);
    }
    return out;
  }

  /**
   * Rebuild a match from its persisted seed and command log.
   *
   * This is the reconnect and restart path. It replays rather than restoring a
   * snapshot, which means a divergence between the log and the live state would
   * surface here as a rejected command instead of silently persisting.
   */
  public static replay(
    options: MatchOptions,
    commands: readonly { actor: PlayerId; action: Action }[],
  ): { match: Match; replayed: number; failedAt: number | null } {
    const match = new Match(options);

    for (let i = 0; i < commands.length; i++) {
      const entry = commands[i];
      if (entry === undefined) continue;
      const result = match.apply(entry.actor, entry.action);
      if (!result.ok) {
        return { match, replayed: i, failedAt: i };
      }
    }

    return { match, replayed: commands.length, failedAt: null };
  }
}
