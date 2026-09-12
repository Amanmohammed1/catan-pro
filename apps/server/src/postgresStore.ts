/**
 * Postgres-backed MatchStore.
 *
 * Used when DATABASE_URL is set; otherwise the server runs on the in-memory
 * store. The interface is identical, so nothing else in the server knows or
 * cares which one is behind it.
 *
 * Append-only is enforced by the database, not by convention: the primary key
 * on (match_id, seq) means a replayed or out-of-order write fails loudly
 * instead of quietly overwriting history.
 */

import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PlayerId } from "@hexport/engine";
import { matchCommands, matches } from "./schema.js";
import type { CommandRecord, MatchRecord, MatchStore } from "./store.js";

/** Any Drizzle Postgres database: postgres-js, node-postgres or PGlite. */
type Database = PgDatabase<PgQueryResultHKT, Record<string, never>>;

export class PostgresMatchStore implements MatchStore {
  public constructor(private readonly db: Database) {}

  public async createMatch(record: MatchRecord): Promise<void> {
    await this.db.insert(matches).values({
      matchId: record.matchId,
      roomCode: record.roomCode,
      scenarioId: record.scenarioId,
      seed: record.seed,
      seedCommitment: record.seedCommitment,
      playerNames: [...record.playerNames],
      createdAt: new Date(record.createdAt),
      finishedAt: record.finishedAt === null ? null : new Date(record.finishedAt),
      winner: record.winner,
    });
  }

  public async appendCommand(record: CommandRecord): Promise<void> {
    // No upsert. A duplicate seq is a bug worth hearing about, not something to
    // paper over — it means two writers think they own the same position.
    await this.db.insert(matchCommands).values({
      matchId: record.matchId,
      seq: record.seq,
      actor: record.actor,
      action: record.action,
      events: [...record.events],
      at: record.at,
    });
  }

  public async finishMatch(
    matchId: string,
    winner: PlayerId | null,
    at: number,
  ): Promise<void> {
    await this.db
      .update(matches)
      .set({ winner, finishedAt: new Date(at) })
      .where(eq(matches.matchId, matchId));
  }

  public async loadMatch(matchId: string): Promise<MatchRecord | null> {
    const rows = await this.db
      .select()
      .from(matches)
      .where(eq(matches.matchId, matchId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toMatchRecord(row);
  }

  public async loadCommands(matchId: string): Promise<readonly CommandRecord[]> {
    const rows = await this.db
      .select()
      .from(matchCommands)
      .where(eq(matchCommands.matchId, matchId))
      .orderBy(asc(matchCommands.seq));

    return rows.map((row) => ({
      matchId: row.matchId,
      seq: row.seq,
      actor: row.actor,
      action: row.action,
      events: row.events,
      at: row.at,
    }));
  }

  public async findByRoomCode(code: string): Promise<MatchRecord | null> {
    const rows = await this.db
      .select()
      .from(matches)
      .where(and(eq(matches.roomCode, code)))
      .orderBy(asc(matches.createdAt))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toMatchRecord(row);
  }
}

function toMatchRecord(row: typeof matches.$inferSelect): MatchRecord {
  return {
    matchId: row.matchId,
    roomCode: row.roomCode,
    scenarioId: row.scenarioId,
    seed: row.seed,
    seedCommitment: row.seedCommitment,
    playerNames: row.playerNames,
    createdAt: row.createdAt.getTime(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.getTime(),
    winner: row.winner,
  };
}
