/**
 * Persistence for the append-only match log.
 *
 * PLAN.md asks for Postgres with Drizzle and an append-only `events` table keyed
 * by match id. The interface is here so the server never depends on a specific
 * database, and the in-memory implementation is what runs in tests and local
 * development.
 *
 * What is persisted is the *command* log plus the events each command produced.
 * The engine is deterministic, so seed plus commands reproduces the state
 * exactly; the events are kept because they are the game log, the animation
 * trigger and the audit trail (golden rule 6).
 */

import type { Action, GameEvent, PlayerId } from "@hexport/engine";

export interface MatchRecord {
  readonly matchId: string;
  readonly roomCode: string;
  readonly scenarioId: string;
  /** Withheld from clients until the game ends. */
  readonly seed: string;
  readonly seedCommitment: string;
  readonly playerNames: readonly string[];
  readonly createdAt: number;
  finishedAt: number | null;
  winner: PlayerId | null;
}

export interface CommandRecord {
  readonly matchId: string;
  readonly seq: number;
  readonly actor: PlayerId;
  readonly action: Action;
  readonly events: readonly GameEvent[];
  readonly at: number;
}

export interface MatchStore {
  createMatch(record: MatchRecord): Promise<void>;
  appendCommand(record: CommandRecord): Promise<void>;
  finishMatch(matchId: string, winner: PlayerId | null, at: number): Promise<void>;
  loadMatch(matchId: string): Promise<MatchRecord | null>;
  loadCommands(matchId: string): Promise<readonly CommandRecord[]>;
  findByRoomCode(code: string): Promise<MatchRecord | null>;
}

/** Default store. Everything lives for as long as the process does. */
export class MemoryMatchStore implements MatchStore {
  private readonly matches = new Map<string, MatchRecord>();
  private readonly commands = new Map<string, CommandRecord[]>();

  public createMatch(record: MatchRecord): Promise<void> {
    this.matches.set(record.matchId, record);
    this.commands.set(record.matchId, []);
    return Promise.resolve();
  }

  public appendCommand(record: CommandRecord): Promise<void> {
    const list = this.commands.get(record.matchId);
    if (list === undefined) {
      return Promise.reject(new Error(`Unknown match ${record.matchId}`));
    }
    // Append-only: a sequence number may never be rewritten.
    if (list.length !== record.seq) {
      return Promise.reject(
        new Error(
          `Out-of-order append for ${record.matchId}: expected seq ${String(list.length)}, got ${String(record.seq)}`,
        ),
      );
    }
    list.push(record);
    return Promise.resolve();
  }

  public finishMatch(
    matchId: string,
    winner: PlayerId | null,
    at: number,
  ): Promise<void> {
    const record = this.matches.get(matchId);
    if (record !== undefined) {
      record.winner = winner;
      record.finishedAt = at;
    }
    return Promise.resolve();
  }

  public loadMatch(matchId: string): Promise<MatchRecord | null> {
    return Promise.resolve(this.matches.get(matchId) ?? null);
  }

  public loadCommands(matchId: string): Promise<readonly CommandRecord[]> {
    return Promise.resolve(this.commands.get(matchId) ?? []);
  }

  public findByRoomCode(code: string): Promise<MatchRecord | null> {
    for (const record of this.matches.values()) {
      if (record.roomCode === code) return Promise.resolve(record);
    }
    return Promise.resolve(null);
  }
}
