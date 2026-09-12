import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PostgresMatchStore } from "./postgresStore.js";
import { CREATE_TABLES_SQL } from "./schema.js";
import { Match } from "./match.js";
import { commitToSeed } from "./fairness.js";
import { loadScenario } from "@hexport/scenarios";
import { legalMoves, type Action } from "@hexport/engine";
import type { MatchRecord } from "./store.js";

/**
 * The Postgres store, tested against a real Postgres.
 *
 * PGlite runs the actual database in-process, so these exercise the real SQL
 * rather than a mock. Shipping untested queries behind a typed interface is how
 * a persistence layer looks fine until the day it has to restore something.
 */

let pg: PGlite | null = null;
let store: PostgresMatchStore | null = null;

function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: "m1",
    roomCode: "ABCDE",
    scenarioId: "classic-3-4",
    seed: "seed-value",
    seedCommitment: commitToSeed("seed-value"),
    playerNames: ["Ana", "Ben", "Cal"],
    createdAt: 1_700_000_000_000,
    finishedAt: null,
    winner: null,
    ...overrides,
  };
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(CREATE_TABLES_SQL);
  store = new PostgresMatchStore(drizzle(pg));
});

afterEach(async () => {
  await pg?.close();
  pg = null;
  store = null;
});

describe("matches", () => {
  it("round trips a match", async () => {
    const original = record();
    await store!.createMatch(original);

    const loaded = await store!.loadMatch("m1");
    expect(loaded).toEqual(original);
  });

  it("returns null for an unknown match", async () => {
    expect(await store!.loadMatch("nope")).toBeNull();
  });

  it("finds a match by room code", async () => {
    await store!.createMatch(record());
    const found = await store!.findByRoomCode("ABCDE");
    expect(found?.matchId).toBe("m1");
  });

  it("records the winner and finish time", async () => {
    await store!.createMatch(record());
    await store!.finishMatch("m1", 2, 1_700_000_100_000);

    const loaded = await store!.loadMatch("m1");
    expect(loaded?.winner).toBe(2);
    expect(loaded?.finishedAt).toBe(1_700_000_100_000);
  });

  it("keeps the seed and its commitment together", async () => {
    await store!.createMatch(record());
    const loaded = await store!.loadMatch("m1");
    expect(commitToSeed(loaded?.seed ?? "")).toBe(loaded?.seedCommitment);
  });
});

describe("the command log", () => {
  const command = (seq: number, action: Action) => ({
    matchId: "m1",
    seq,
    actor: action.player,
    action,
    events: [],
    at: 1_700_000_000_000 + seq,
  });

  beforeEach(async () => {
    await store!.createMatch(record());
  });

  it("stores and reloads commands in order", async () => {
    await store!.appendCommand(command(0, { t: "rollDice", player: 0 }));
    await store!.appendCommand(command(1, { t: "endTurn", player: 0 }));
    await store!.appendCommand(command(2, { t: "rollDice", player: 1 }));

    const loaded = await store!.loadCommands("m1");
    expect(loaded.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(loaded[0]?.action).toEqual({ t: "rollDice", player: 0 });
    expect(loaded[2]?.actor).toBe(1);
  });

  it("reloads them ordered by sequence, not insertion order", async () => {
    await store!.appendCommand(command(1, { t: "endTurn", player: 0 }));
    await store!.appendCommand(command(0, { t: "rollDice", player: 0 }));

    const loaded = await store!.loadCommands("m1");
    expect(loaded.map((c) => c.seq)).toEqual([0, 1]);
  });

  it("refuses to rewrite a sequence number", async () => {
    // Append-only, enforced by the primary key rather than by convention.
    await store!.appendCommand(command(0, { t: "rollDice", player: 0 }));
    await expect(
      store!.appendCommand(command(0, { t: "endTurn", player: 0 })),
    ).rejects.toThrow();
  });

  it("keeps logs for different matches apart", async () => {
    await store!.createMatch(record({ matchId: "m2", roomCode: "FGHIJ" }));
    await store!.appendCommand(command(0, { t: "rollDice", player: 0 }));
    await store!.appendCommand({
      ...command(0, { t: "rollDice", player: 1 }),
      matchId: "m2",
    });

    expect(await store!.loadCommands("m1")).toHaveLength(1);
    expect(await store!.loadCommands("m2")).toHaveLength(1);
  });

  it("preserves the events a command produced", async () => {
    await store!.appendCommand({
      ...command(0, { t: "rollDice", player: 0 }),
      events: [
        { e: "diceRolled", player: 0, dice: [3, 4], total: 7 },
        { e: "discardRequired", players: [1] },
      ],
    });

    const loaded = await store!.loadCommands("m1");
    expect(loaded[0]?.events).toHaveLength(2);
    expect(loaded[0]?.events[0]).toEqual({
      e: "diceRolled",
      player: 0,
      dice: [3, 4],
      total: 7,
    });
  });

  it("returns an empty log for a match with no commands", async () => {
    expect(await store!.loadCommands("m1")).toEqual([]);
  });
});

describe("replay from the database", () => {
  it("rebuilds an identical game from the seed and the stored commands", async () => {
    const scenario = loadScenario("classic-3-4");
    const seed = "replay-seed";
    const playerNames = ["Ana", "Ben", "Cal"];

    // Play a real game and persist every accepted command.
    const live = new Match({ scenario, seed, playerNames });
    await store!.createMatch(record({ matchId: "replay", seed }));

    for (let i = 0; i < 120; i++) {
      const actor = live
        .getState()
        .players.map((p) => p.id)
        .find((id) => legalMoves(live.getState(), id).length > 0);
      if (actor === undefined) break;

      const move = legalMoves(live.getState(), actor)[0];
      if (move === undefined) break;

      const seq = live.commandLog.length;
      const result = live.apply(actor, move);
      if (!result.ok) break;

      await store!.appendCommand({
        matchId: "replay",
        seq,
        actor,
        action: move,
        events: result.events,
        at: Date.now(),
      });
    }

    expect(live.commandLog.length).toBeGreaterThan(20);

    // Now rebuild from nothing but the seed and the log.
    const stored = await store!.loadMatch("replay");
    const commands = await store!.loadCommands("replay");
    expect(stored).not.toBeNull();

    const { match: rebuilt, failedAt } = Match.replay(
      { scenario, seed: stored?.seed ?? "", playerNames },
      commands.map((c) => ({ actor: c.actor, action: c.action })),
    );

    expect(failedAt).toBeNull();
    // Byte-identical, which is what golden rule 4 buys: no snapshot needed.
    expect(JSON.stringify(rebuilt.getState())).toBe(JSON.stringify(live.getState()));
  }, 60000);
});
