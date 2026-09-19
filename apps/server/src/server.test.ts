import { describe, it, expect, afterEach } from "vitest";
import { GameServer } from "./server.js";
import { TestClient, settle } from "./testClient.js";
import { commitToSeed, verifySeed } from "./fairness.js";
import type { Action } from "@hexport/engine";

/**
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

async function startServer(options?: {
  turnTimeoutMs?: number;
  botPaceMs?: number;
}): Promise<string> {
  server = new GameServer({
    port: 0,
    host: "127.0.0.1",
    ...(options?.turnTimeoutMs === undefined
      ? {}
      : { turnTimeoutMs: options.turnTimeoutMs }),
    ...(options?.botPaceMs === undefined ? {} : { botPaceMs: options.botPaceMs }),
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
  options?: { turnTimeoutMs?: number; scenarioId?: string },
): Promise<{ url: string; host: TestClient; all: TestClient[]; code: string }> {
  const url = await startServer(options);

  const host = await newClient(url);
  host.hello();
  host.send({
    t: "createRoom",
    nickname: "Host",
    playerCount: count,
    // Omitted rather than sent undefined, so the server's own default applies.
    ...(options?.scenarioId === undefined ? {} : { scenarioId: options.scenarioId }),
  });
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

/**
 * Play until `done` is satisfied, or the budget runs out.
 *
 * The hidden-information tests each audit one kind of event. Playing a fixed
 * few thousand commands to be sure of seeing one wastes most of the run; this
 * stops the moment the thing under test has actually happened.
 */
async function playUntil(
  all: readonly TestClient[],
  done: () => boolean,
  maxCommands = 3000,
): Promise<boolean> {
  const random = makeRandom(0xc0ffee);

  for (let played = 0; played < maxCommands; played++) {
    if (done()) return true;
    if (all.some((c) => c.view?.winner != null)) return done();

    const actor = all.find((c) => c.legalMoves.length > 0);
    if (actor === undefined) return done();

    const moves = actor.legalMoves;
    const preferred =
      moves.find((m) => m.t === "buyDevCard") ??
      moves.find((m) => m.t === "buildCity") ??
      moves.find((m) => m.t === "buildSettlement") ??
      moves.find((m) => m.t === "rollDice") ??
      moves[Math.floor(random() * moves.length)] ??
      moves[0];
    if (preferred === undefined) return done();

    const revisions = all.map((c) => c.revision);
    actor.play(preferred);
    await allCaughtUp(all, revisions);
  }

  return done();
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

describe("lobby", () => {
  it("creates a room and seats the host", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host" });
    await host.until(() => host.room !== null, "room");

    expect(host.room?.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(host.room?.seats).toHaveLength(1);
    expect(host.room?.you).toBe(0);
    expect(host.room?.seats[0]?.isHost).toBe(true);
    expect(host.token).not.toBe("");
  });

  it("seats four players and tells everyone", async () => {
    const { all } = await seatedGame(4);
    for (const client of all) {
      expect(client.room?.seats).toHaveLength(4);
    }
    expect(all.map((c) => c.seat)).toEqual([0, 1, 2, 3]);
  });

  it("rejects an unknown room code", async () => {
    const url = await startServer();
    const client = await newClient(url);
    client.hello();
    client.send({ t: "joinRoom", code: "ZZZZZ", nickname: "Nobody" });
    await client.until(() => client.errors.length > 0, "error");
    expect(client.errors[0]?.code).toBe("no-room");
  });

  it("refuses to start unless everyone is ready", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host" });
    await host.until(() => host.room !== null, "room");

    const other = await newClient(url);
    other.hello();
    other.send({ t: "joinRoom", code: host.room?.code ?? "", nickname: "Two" });
    await other.until(() => other.room !== null, "joined");

    const third = await newClient(url);
    third.hello();
    third.send({ t: "joinRoom", code: host.room?.code ?? "", nickname: "Three" });
    await third.until(() => third.room !== null, "joined");

    host.send({ t: "startGame" });
    await host.until(() => host.errors.length > 0, "error");
    expect(host.errors[0]?.message).toMatch(/ready/i);
  });

  it("lets only the host start the game", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host" });
    await host.until(() => host.room !== null, "room");
    const code = host.room?.code ?? "";

    const others: TestClient[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await newClient(url);
      c.hello();
      c.send({ t: "joinRoom", code, nickname: `P${String(i)}` });
      await c.until(() => c.room !== null, "joined");
      others.push(c);
    }
    for (const c of [host, ...others]) c.send({ t: "setReady", ready: true });
    await settle(50);

    const notHost = others[0] as TestClient;
    notHost.send({ t: "startGame" });
    await notHost.until(() => notHost.errors.length > 0, "error");
    expect(notHost.errors.at(-1)?.code).toBe("not-host");
  });

  it("makes nicknames unique", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Sam" });
    await host.until(() => host.room !== null, "room");

    const twin = await newClient(url);
    twin.hello();
    twin.send({ t: "joinRoom", code: host.room?.code ?? "", nickname: "Sam" });
    await twin.until(() => twin.room !== null, "joined");
    await settle(40);

    const names = twin.room?.seats.map((s) => s.nickname) ?? [];
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("protocol hardening", () => {
  it("rejects a malformed frame without dropping the socket", async () => {
    const url = await startServer();
    const client = await newClient(url);
    client.send({ t: "nonsense" } as never);
    await client.until(() => client.errors.length > 0, "error");
    expect(client.errors[0]?.code).toBe("bad-message");

    // The socket still works afterwards.
    client.hello();
    client.send({ t: "createRoom", nickname: "Still here" });
    await client.until(() => client.room !== null, "room");
  });

  it("rejects a protocol version mismatch", async () => {
    const url = await startServer();
    const client = await newClient(url);
    client.send({ t: "hello", version: 999 } as never);
    await client.until(() => client.errors.length > 0, "error");
    expect(client.errors[0]?.code).toBe("bad-version");
  });

  it("refuses commands from a client with no seat", async () => {
    const url = await startServer();
    const client = await newClient(url);
    client.hello();
    client.play({ t: "rollDice", player: 0 });
    await client.until(() => client.errors.length > 0, "error");
    expect(client.errors[0]?.code).toBe("not-seated");
  });

  it("will not let a player act as someone else", async () => {
    const { all } = await seatedGame(3);
    const impostor = all[1] as TestClient;

    // Player 0 is on the clock during setup; player 1 claims to be them.
    const victimMove = (all[0] as TestClient).legalMoves[0];
    expect(victimMove).toBeDefined();

    impostor.play({ ...(victimMove as Action), player: 0 });
    await impostor.until(() => impostor.errors.length > 0, "rejection");
    // Rewritten to the sender's own seat, then rejected by the rules.
    expect(impostor.errors.at(-1)?.code).toBe("illegal-move");
  });

  it("rejects an illegal move and resyncs the sender", async () => {
    const { all } = await seatedGame(3);
    const player = all[0] as TestClient;
    const before = player.view;

    player.play({ t: "rollDice", player: 0 });
    await player.until(() => player.errors.length > 0, "rejection");
    expect(player.errors.at(-1)?.code).toBe("illegal-move");
    await settle(40);
    // A fresh snapshot follows the rejection.
    expect(player.view).not.toBeNull();
    expect(player.view?.phase.k).toBe(before?.phase.k);
  });
});

describe("hidden information (golden rule 5)", () => {
  it("never sends another player's hand", async () => {
    const { all } = await seatedGame(4);
    await playToEnd(all, 120);

    for (const client of all) {
      const you = client.view?.you;
      expect(you).not.toBeUndefined();

      // Your own hand is exact.
      expect(client.view?.self.resources).toBeDefined();

      // Everyone else is a count, with no per-resource breakdown anywhere.
      for (const other of client.view?.players ?? []) {
        expect(typeof other.handSize).toBe("number");
        expect(other).not.toHaveProperty("resources");
        expect(other).not.toHaveProperty("devCards");
      }
    }
  }, 60000);

  it("never sends the deck order or the generator state", async () => {
    const { all } = await seatedGame(4);
    await playToEnd(all, 120);

    for (const client of all) {
      const raw = client.received.join("\n");
      // The draw pile is a count, never a list.
      expect(raw).not.toContain('"devDeck"');
      // The PRNG state would let a client predict every future roll.
      expect(raw).not.toContain('"rng"');
      expect(client.view).not.toHaveProperty("devDeck");
      expect(client.view).not.toHaveProperty("rng");
    }
  }, 60000);

  it("never sends what is still face down on The Fog Islands", async () => {
    // Deliberately on a Fog Islands board. The classic board declares no
    // face-down stacks at all, so this assertion would pass on it while
    // proving nothing — a green test over an empty set.
    const { all } = await seatedGame(4, { scenarioId: "fog-islands-4" });
    await playToEnd(all, 120);

    for (const client of all) {
      const raw = client.received.join("\n");
      // The piles say what every unexplored space holds. A client that could
      // read them would know the whole board before sailing anywhere.
      expect(raw).not.toContain('"contents"');
      expect(client.view?.hiddenStacks["fog"]).not.toHaveProperty("contents");

      // The counts are public, exactly as the development deck's size is.
      const stack = client.view?.hiddenStacks["fog"];
      expect(typeof stack?.hexes).toBe("number");
      expect(typeof stack?.numbers).toBe("number");
    }
  }, 60000);

  it("sends the board again when a hex is revealed", async () => {
    /*
     * The bug this exists for: the server revealed hexes correctly and no
     * client ever heard about it. `WireView` omitted the board and
     * `broadcastUpdate` stripped it, because the board "never changes for a
     * match" — true until The Fog Islands deals part of its board during play.
     *
     * Twenty-one engine tests passed throughout. They assert on engine state
     * and never cross the wire, so none of them could see it. This one has to
     * look at the frames.
     */
    const { all } = await seatedGame(4, { scenarioId: "fog-islands-4" });

    const fogCount = (client: TestClient): number =>
      Object.values(client.board?.tiles ?? {}).filter((t) => t.terrain === "fog")
        .length;

    const before = fogCount(all[0] as TestClient);
    expect(before).toBe(12);

    await playToEnd(all, 120);

    for (const client of all) {
      const updates = client.received
        .map(
          (raw) =>
            JSON.parse(raw) as {
              t: string;
              events?: readonly { e: string }[];
              board?: unknown;
            },
        )
        .filter((frame) => frame.t === "update");

      const reveals = updates.filter((frame) =>
        (frame.events ?? []).some((event) => event.e === "hexRevealed"),
      );

      // Four players building for 120 turns on a board with twelve empty
      // spaces reaches at least one of them.
      expect(reveals.length).toBeGreaterThan(0);

      // Every frame that revealed something carried the board it changed.
      for (const frame of reveals) expect(frame.board).toBeDefined();
    }

    // And the client actually applied it: fewer unexplored hexes than it
    // started with. Asserting only on the frames would pass even if the client
    // threw the board away, which is half of what went wrong.
    expect(fogCount(all[0] as TestClient)).toBeLessThan(before);
  }, 60000);

  it("hides the identity of a stolen card from everyone else", async () => {
    const { all } = await seatedGame(4);

    const sawBystanderSteal = (): boolean =>
      all.some((client) =>
        client.log.some(
          (e) =>
            e.e === "cardStolen" &&
            e.from !== client.view?.you &&
            e.to !== client.view?.you,
        ),
      );

    const observed = await playUntil(all, sawBystanderSteal);
    expect(observed).toBe(true);

    for (const client of all) {
      const you = client.view?.you;
      for (const event of client.log) {
        if (event.e !== "cardStolen") continue;
        if (event.from === you || event.to === you) continue;
        // A bystander learns that a card moved, not which one.
        expect(event.resource).toBeNull();
      }
    }
  }, 120000);

  it("hides which development card an opponent drew", async () => {
    const { all } = await seatedGame(4);

    const sawOpponentBuy = (): boolean =>
      all.some((client) =>
        client.log.some(
          (e) => e.e === "devCardBought" && e.player !== client.view?.you,
        ),
      );

    const observed = await playUntil(all, sawOpponentBuy);
    expect(observed).toBe(true);

    for (const client of all) {
      const you = client.view?.you;
      for (const event of client.log) {
        if (event.e !== "devCardBought") continue;
        if (event.player === you) continue;
        expect(event.kind).toBeNull();
      }
    }
  }, 120000);

  it("does not reveal the seed until the game is over", async () => {
    const { all } = await seatedGame(3);
    const host = all[0] as TestClient;

    expect(host.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(host.revealedSeed).toBeNull();
    for (const client of all) {
      expect(client.received.join("\n")).not.toContain('"seedRevealed"');
    }
  });
});

describe("dice fairness", () => {
  it("publishes a commitment before the game starts", async () => {
    const { all } = await seatedGame(3);
    for (const client of all) {
      expect(client.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
      expect(client.revealedSeed).toBeNull();
    }
  });

  it("rejects a seed that does not match its commitment", () => {
    expect(verifySeed("not-the-seed", "0".repeat(64))).toBe(false);
  });

  it("accepts a seed that does match", () => {
    const seed = "abc123";
    expect(verifySeed(seed, commitToSeed(seed))).toBe(true);
  });
});

describe("reconnect", () => {
  it("restores a player who drops mid-game", async () => {
    const { url, all } = await seatedGame(4);

    // Play a while so there is real state to restore.
    await playToEnd(all, 40);

    const dropped = all[2] as TestClient;
    const token = dropped.token;
    const before = JSON.stringify(dropped.view);
    expect(before).not.toBe("null");

    dropped.close();
    await settle(60);

    // The table is told they are gone.
    const stillHere = all[0] as TestClient;
    await stillHere.until(
      () => stillHere.room?.seats[2]?.connected === false,
      "disconnect visible to others",
    );

    // Reconnect with the resume token.
    const resumed = await newClient(url);
    resumed.hello(token);
    await resumed.until(() => resumed.view !== null, "resumed snapshot");

    const snapshotBefore = JSON.parse(before) as NonNullable<TestClient["view"]>;
    expect(resumed.view?.you).toBe(2);
    expect(JSON.stringify(resumed.view?.self.resources)).toBe(
      JSON.stringify(snapshotBefore.self.resources),
    );
    expect(resumed.view?.phase).toEqual(snapshotBefore.phase);
    expect(resumed.board).not.toBeNull();
    // The full history comes back, so the log is not lost.
    expect(resumed.log.length).toBeGreaterThan(0);

    await stillHere.until(
      () => stillHere.room?.seats[2]?.connected === true,
      "reconnect visible to others",
    );
  }, 60000);

  it("refuses a stale or invented token", async () => {
    const url = await startServer();
    const client = await newClient(url);
    client.hello("not-a-real-token");
    await client.until(() => client.errors.length > 0, "error");
    expect(client.errors[0]?.code).toBe("no-room");
  });

  it("keeps the game playable after a reconnect", async () => {
    const { url, all } = await seatedGame(3);

    const dropped = all[1] as TestClient;
    const token = dropped.token;
    dropped.close();
    await settle(50);

    const resumed = await newClient(url);
    resumed.hello(token);
    await resumed.until(() => resumed.view !== null, "resumed");

    const active = [all[0] as TestClient, resumed, all[2] as TestClient];
    const commands = await playToEnd(active, 60);
    expect(commands).toBeGreaterThan(5);
  }, 60000);
});

describe("turn timer", () => {
  it("auto-passes a player who runs out of time", async () => {
    const { all } = await seatedGame(3, { turnTimeoutMs: 40 });
    const before = JSON.stringify(all[0]?.view?.phase);

    // Nobody acts. The timer should move the game along on its own.
    await settle(120);
    server?.runTimers();
    await settle(60);

    const after = JSON.stringify(all[0]?.view?.phase);
    expect(after).not.toBe(before);
  }, 30000);

  it("sends a deadline everyone can count down against", async () => {
    const { all } = await seatedGame(3, { turnTimeoutMs: 5000 });
    await settle(40);
    // The snapshot carries the timer, so clients share one clock.
    const raw = (all[0] as TestClient).received.join("\n");
    expect(raw).toContain('"timer"');
  });
});

describe("chat and host controls", () => {
  it("relays chat to the table", async () => {
    const { all } = await seatedGame(3);
    (all[0] as TestClient).send({ t: "chat", text: "hello table" });
    await (all[1] as TestClient).until(
      () => (all[1] as TestClient).chat.length > 0,
      "chat",
    );
    expect((all[1] as TestClient).chat[0]?.text).toBe("hello table");
    expect((all[1] as TestClient).chat[0]?.from).toBe("Host");
  });

  it("lets the host remove a player before the game starts", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host" });
    await host.until(() => host.room !== null, "room");

    const guest = await newClient(url);
    guest.hello();
    guest.send({ t: "joinRoom", code: host.room?.code ?? "", nickname: "Guest" });
    await guest.until(() => guest.room !== null, "joined");
    await settle(40);

    host.send({ t: "kick", player: 1 });
    await host.until(() => (host.room?.seats.length ?? 0) === 1, "seat removed");
    expect(host.room?.seats).toHaveLength(1);
  });

  it("refuses a kick from a non-host", async () => {
    const { all } = await seatedGame(3);
    const notHost = all[1] as TestClient;
    notHost.send({ t: "kick", player: 0 });
    await notHost.until(() => notHost.errors.length > 0, "error");
    expect(notHost.errors.at(-1)?.code).toBe("not-host");
  });
});

/**
 * Bots the server plays itself.
 *
 * A bot seat has no socket: it is handed the same legal-move list a player
 * would be sent, for its own seat, and plays one of those. That is the whole
 * safety argument — it cannot do anything a player could not, and it is given
 * nothing a player would not see.
 */
describe("bots in a room", () => {
  it("seats the bots the room was created with", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host", playerCount: 4, bots: 3 });
    await host.until(() => (host.room?.seats.length ?? 0) === 4, "seats filled");

    const seats = host.room?.seats ?? [];
    expect(seats.filter((seat) => seat.isBot)).toHaveLength(3);
    // A bot never keeps a table waiting, and never holds the room.
    expect(seats.filter((seat) => seat.isBot).every((seat) => seat.ready)).toBe(true);
    expect(seats[0]?.isHost).toBe(true);
    expect(seats[0]?.isBot).toBe(false);
  });

  it("lets the host add and remove a bot while the room waits", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host", playerCount: 4 });
    await host.until(() => host.room !== null, "room");

    host.send({ t: "addBot" });
    await host.until(() => (host.room?.seats.length ?? 0) === 2, "bot added");
    expect(host.room?.seats[1]?.isBot).toBe(true);

    host.send({ t: "removeBot", player: 1 });
    await host.until(() => (host.room?.seats.length ?? 0) === 1, "bot removed");
  });

  it("refuses a bot from a player who is not the host", async () => {
    const { all } = await seatedGame(3);
    const notHost = all[1] as TestClient;

    notHost.send({ t: "addBot" });
    await notHost.until(() => notHost.errors.length > 0, "error");
    expect(notHost.errors.at(-1)?.code).toBe("not-host");
  });

  it("will not remove a person with removeBot", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host", playerCount: 4 });
    await host.until(() => host.room !== null, "room");

    const guest = await newClient(url);
    guest.hello();
    guest.send({ t: "joinRoom", code: host.room?.code ?? "", nickname: "Guest" });
    await guest.until(() => guest.room !== null, "joined");
    await settle(40);

    host.send({ t: "removeBot", player: 1 });
    await host.until(() => host.errors.length > 0, "error");
    expect(host.errors.at(-1)?.message).toMatch(/not a bot/);
    expect(host.room?.seats).toHaveLength(2);
  });

  it("refuses another bot once the room is full", async () => {
    const url = await startServer();
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host", playerCount: 3, bots: 2 });
    await host.until(() => (host.room?.seats.length ?? 0) === 3, "full");

    host.send({ t: "addBot" });
    await host.until(() => host.errors.length > 0, "error");
    expect(host.errors.at(-1)?.message).toMatch(/full/);
  });

  it("plays its own turns once the game starts", async () => {
    // No pacing in a test: bots move as fast as the tick.
    const url = await startServer({ botPaceMs: 0 });
    const host = await newClient(url);
    host.hello();
    host.send({ t: "createRoom", nickname: "Host", playerCount: 3, bots: 2 });
    await host.until(() => (host.room?.seats.length ?? 0) === 3, "seated");

    host.send({ t: "setReady", ready: true });
    host.send({ t: "startGame" });
    await host.until(() => host.view !== null, "game started");

    // Setup opens with the host; place a settlement and its road, then the two
    // bots should take their own placements with nobody touching them.
    for (let i = 0; i < 2; i += 1) {
      const move = host.legalMoves[0];
      if (move === undefined) break;
      host.play(move);
      await host.nextFrame(2000);
    }

    for (let i = 0; i < 60; i += 1) {
      server?.runTimers();
      await settle(10);
      if (host.log.some((e) => e.e === "buildingPlacedInSetup" && e.player !== 0)) {
        break;
      }
    }

    const botPlacements = host.log.filter(
      (e) => e.e === "buildingPlacedInSetup" && e.player !== 0,
    );
    expect(botPlacements.length).toBeGreaterThan(0);
  }, 30000);
});

/**
 * Rematch: the same people, the same seats, a new board (M4).
 *
 * The happy path runs in the slow lane, which plays a hot-seat game to a winner
 * and then presses the button. What matters here is that the two guards hold,
 * because both of them are ways to take a game away from the people playing it.
 */
describe("rematch", () => {
  it("refuses a rematch from a player who is not the host", async () => {
    const { all } = await seatedGame(3);
    const notHost = all[1] as TestClient;

    notHost.send({ t: "rematch" });
    await notHost.until(() => notHost.errors.length > 0, "error");
    expect(notHost.errors.at(-1)?.code).toBe("not-host");
  });

  it("refuses a rematch while the game is still going", async () => {
    // Otherwise a host losing badly could wipe the board and start again.
    const { host } = await seatedGame(3);

    host.send({ t: "rematch" });
    await host.until(() => host.errors.length > 0, "error");
    expect(host.errors.at(-1)?.message).toMatch(/still going/);
  });
});
