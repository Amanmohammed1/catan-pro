/**
 * Database schema. Drizzle over Postgres (Neon in production, per PLAN.md).
 *
 * Two tables, both append-only in spirit:
 *
 *   matches        one row per game, holding the seed and its commitment
 *   match_commands the ordered log of accepted commands, keyed by match id
 *
 * PLAN.md asks for an "append-only events table keyed by match id". What is
 * stored is the *command* that was accepted plus the events it produced. The
 * engine is deterministic (golden rule 4), so seed plus commands reproduces the
 * state exactly; keeping the events too means the game log, the animations and
 * the audit trail survive without replaying anything.
 *
 * The seed column is withheld from clients until the game ends, at which point
 * it is published so anyone can verify every roll against sha256(seed).
 */

import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Action, GameEvent } from "@hexport/engine";

export const matches = pgTable(
  "matches",
  {
    matchId: text("match_id").primaryKey(),
    roomCode: text("room_code").notNull(),
    scenarioId: text("scenario_id").notNull(),
    /** Secret until the match finishes. */
    seed: text("seed").notNull(),
    seedCommitment: text("seed_commitment").notNull(),
    playerNames: jsonb("player_names").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    winner: integer("winner"),
  },
  (table) => [index("matches_room_code_idx").on(table.roomCode)],
);

export const matchCommands = pgTable(
  "match_commands",
  {
    matchId: text("match_id").notNull(),
    /** Position in the log. Gaps or rewrites mean corruption. */
    seq: integer("seq").notNull(),
    actor: integer("actor").notNull(),
    action: jsonb("action").$type<Action>().notNull(),
    events: jsonb("events").$type<GameEvent[]>().notNull(),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.seq] }),
    // The primary key already enforces this; naming it makes the intent
    // explicit: a sequence number is written once and never updated.
    uniqueIndex("match_commands_append_only").on(table.matchId, table.seq),
  ],
);

/** DDL for environments without a migration step. Matches the schema above. */
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS matches (
  match_id        text PRIMARY KEY,
  room_code       text NOT NULL,
  scenario_id     text NOT NULL,
  seed            text NOT NULL,
  seed_commitment text NOT NULL,
  player_names    jsonb NOT NULL,
  created_at      timestamptz NOT NULL,
  finished_at     timestamptz,
  winner          integer
);

CREATE INDEX IF NOT EXISTS matches_room_code_idx ON matches (room_code);

CREATE TABLE IF NOT EXISTS match_commands (
  match_id text    NOT NULL,
  seq      integer NOT NULL,
  actor    integer NOT NULL,
  action   jsonb   NOT NULL,
  events   jsonb   NOT NULL,
  at       bigint  NOT NULL,
  PRIMARY KEY (match_id, seq)
);
`;
