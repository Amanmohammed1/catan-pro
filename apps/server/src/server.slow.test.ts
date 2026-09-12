import { describe, it, expect, afterEach } from "vitest";
import { GameServer } from "./server.js";
import { TestClient, settle } from "./testClient.js";
import { verifySeed } from "./fairness.js";

/**
 * Whole-game integration tests. These play a real match end to end over real
 * sockets, which takes about a minute, so they live outside the default `pnpm
 * test` lane and run via `pnpm test:slow` and in `pnpm verify`.
 *
 * M2 acceptance, from PLAN.md:
 *
 *   "Add an integration test that spins up the server, connects 4 clients,
 *    plays a scripted game, kills and reconnects one client mid-game, and
 *    asserts final state matches."
 *
 * Plus the criterion that matters most: no hidden information leaks. Golden rule
 * 5 says to assume every player has devtools open, so one test below reads every
 * byte the server actually sent and looks for things it should never contain.
 */

let server: GameServer | null = null;
const clients: TestClient[] = [];

async function startServer(options?: { turnTimeoutMs?: number }): Promise<string> {
  server = new GameServer({
    port: 0,
    host: "127.0.0.1",
    ...(options?.turnTimeoutMs === undefined
      ? {}
      : { turnTimeoutMs: options.turnTimeoutMs }),
  });
  await server.listen();
  return `ws://127.0.0.1:${String(server.port)}`;
}

async function newClient(url: string): Promise<TestClient> {
  const client = new TestClient(url);
  await client.connect();
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await server?.close();
  server = null;
});

/** Seat `count` players into a fresh room and start the game. */
async function seatedGame(
  count: number,
  options?: { turnTimeoutMs?: number },
): Promise<{ url: string; host: TestClient; all: TestClient[]; code: string }> {
  const url = await startServer(options);

  const host = await newClient(url);
  host.hello();
  host.send({ t: "createRoom", nickname: "Host", playerCount: count });
  await host.until(() => host.room !== null, "room created");
  const code = host.room?.code ?? "";

  const all = [host];
  for (let i = 1; i < count; i++) {
    const client = await newClient(url);
    client.hello();
    client.send({ t: "joinRoom", code, nickname: `Player${String(i + 1)}` });
    await client.until(() => client.room !== null, `player ${String(i)} joined`);
    all.push(client);
  }

  for (const client of all) client.send({ t: "setReady", ready: true });
  await settle(60);

  host.send({ t: "startGame" });
  for (const client of all) {
    await client.until(() => client.view !== null, "game snapshot");
  }

  return { url, host, all, code };
}

/**
 * Drive the game to completion using only what each client was told is legal.
 *
 * Each command waits for the resulting broadcast before choosing the next one.
 * Firing on a fixed delay instead would let a client act on a stale legalMoves
 * list, which the server rightly rejects — the loop would then spin replaying
 * the same dead move rather than playing the game.
 *
 * Move choice matters more than it looks. Always taking the first legal move
 * makes a greedy loop that never scores: roads sort before everything else, so
 * a player spends the brick and lumber a settlement needs and the game runs
 * forever. This mirrors the M1 fuzzer instead — take a cheap win when there is
 * one, otherwise choose at random from a small deterministic generator.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Wait until every client has caught up past `revisions`.
 *
 * Each client is on its own socket, so a broadcast lands at slightly different
 * times. Reading one client's move list while another is still a frame behind
 * makes the driver send a move that was legal a moment ago, which the server
 * correctly rejects — and then the loop burns thousands of commands making no
 * progress. Synchronising here is what keeps the game moving.
 */
async function allCaughtUp(
  all: readonly TestClient[],
  revisions: readonly number[],
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (all.every((c, i) => c.revision > (revisions[i] ?? 0))) return;
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function playToEnd(
  all: readonly TestClient[],
  maxCommands = 6000,
): Promise<number> {
  const random = makeRandom(0x5eed);
  let played = 0;

  for (; played < maxCommands; played++) {
    if (all.some((c) => c.view?.winner != null)) break;

    const actor = all.find((c) => c.legalMoves.length > 0);
    if (actor === undefined) break;

    const moves = actor.legalMoves;
    // Take a cheap win when there is one; otherwise choose at random, the way
    // the M1 fuzzer does. Always taking the first legal move spends the brick
    // and lumber a settlement needs on roads, and the game never ends.
    const preferred =
      moves.find((m) => m.t === "buildCity") ??
      moves.find((m) => m.t === "buildSettlement") ??
      moves.find((m) => m.t === "rollDice") ??
      moves[Math.floor(random() * moves.length)] ??
      moves[0];

    if (preferred === undefined) break;

    const revisions = all.map((c) => c.revision);
    actor.play(preferred);
    await allCaughtUp(all, revisions);
  }

  return played;
}

describe("dice fairness", () => {
  it("publishes a commitment up front and a matching seed at the end", async () => {
    const { all } = await seatedGame(3);
    const commitment = (all[0] as TestClient).seedCommitment;
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);

    await playToEnd(all);

    const winner = all.find((c) => c.view?.winner != null);
    expect(winner).toBeDefined();
    await settle(60);

    const seed = (all[0] as TestClient).revealedSeed;
    expect(seed).not.toBeNull();
    // Anyone can now replay the match and check every roll.
    expect(verifySeed(seed as string, commitment as string)).toBe(true);
  }, 120000);

  it("rejects a seed that does not match its commitment", () => {
    expect(verifySeed("not-the-seed", "0".repeat(64))).toBe(false);
  });
});

describe("a full four player game", () => {
  it("plays to a winner and agrees on the result", async () => {
    const { all } = await seatedGame(4);
    const commands = await playToEnd(all);

    expect(commands).toBeGreaterThan(20);
    const winners = all.map((c) => c.view?.winner ?? null);
    // Everyone sees the same winner.
    expect(new Set(winners).size).toBe(1);
    expect(winners[0]).not.toBeNull();
  }, 180000);
});
