/**
 * Entry point.
 *
 *   pnpm --filter @hexport/server dev
 *
 * Configuration comes from the environment so the same build runs locally and on
 * Fly or Railway:
 *
 *   PORT, HOST          where to listen
 *   TURN_TIMEOUT_MS     auto-pass after this long; 0 disables the timer
 *   DATABASE_URL        Postgres; without it, matches live in memory only
 */

import { GameServer } from "./server.js";
import { MemoryMatchStore, type MatchStore } from "./store.js";

const port = Number(process.env["PORT"] ?? "8787");
const host = process.env["HOST"] ?? "127.0.0.1";
const turnTimeoutMs = Number(process.env["TURN_TIMEOUT_MS"] ?? "0");
const databaseUrl = process.env["DATABASE_URL"];

async function buildStore(): Promise<MatchStore> {
  if (databaseUrl === undefined || databaseUrl === "") {
    process.stdout.write("no DATABASE_URL: matches will not survive a restart\n");
    return new MemoryMatchStore();
  }

  // Imported lazily so a local run never pays for the Postgres driver.
  const [{ drizzle }, postgres, { PostgresMatchStore }, { CREATE_TABLES_SQL }] =
    await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
      import("./postgresStore.js"),
      import("./schema.js"),
    ]);

  const sql = postgres.default(databaseUrl);
  await sql.unsafe(CREATE_TABLES_SQL);
  process.stdout.write("connected to Postgres\n");
  return new PostgresMatchStore(drizzle(sql));
}

const store = await buildStore();

const server = new GameServer({
  port,
  host,
  turnTimeoutMs,
  store,
  logger: true,
});

const address = await server.listen();
process.stdout.write(`hexport server listening on ${address}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => {
      process.exit(0);
    });
  });
}
