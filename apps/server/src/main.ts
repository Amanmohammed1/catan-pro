/**
 * Entry point.
 *
 *   pnpm --filter @hexport/server dev
 *
 * PORT, HOST and TURN_TIMEOUT_MS come from the environment so the same build
 * runs locally and on Fly or Railway.
 */

import { GameServer } from "./server.js";

const port = Number(process.env["PORT"] ?? "8787");
const host = process.env["HOST"] ?? "127.0.0.1";
const turnTimeoutMs = Number(process.env["TURN_TIMEOUT_MS"] ?? "0");

const server = new GameServer({
  port,
  host,
  turnTimeoutMs,
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
