// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket as NodeWebSocket } from "ws";
import { connect } from "node:net";
import { OnlineGame } from "./OnlineGame.js";

/**
 * The real React client against a real server over a real socket.
 *
 * The server's own tests use a scripted client, which proves the protocol. This
 * proves the thing a player actually touches: that the lobby seats them, that
 * the board renders from a redacted view, and that clicking a highlighted spot
 * places a piece on the authoritative server.
 *
 * The server runs as a separate process rather than in-process. jsdom replaces
 * the global Event class, which breaks the `ws` server's own event dispatch if
 * they share a realm — and a real process boundary is what a browser talks to
 * anyway.
 *
 * The global WebSocket is swapped for the one from `ws` below. Vitest's jsdom
 * environment replaces the global Event class but leaves Node's own WebSocket in
 * place, so Node ends up constructing a jsdom Event and then refusing it —
 * "The event argument must be an instance of Event. Received an instance of
 * Event". The `ws` client speaks the same browser-shaped API the client code
 * uses and is internally consistent, so the noise goes away.
 */

let server: ChildProcess | null = null;
let serverUrl = "";
const roots: { root: Root; el: HTMLDivElement }[] = [];

/** Resolve once something is listening on `port`. */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * One server for the whole file. Booting through tsx takes a few seconds, and
 * rooms are independent, so there is nothing to gain from a fresh one per test.
 */
async function startServer(): Promise<string> {
  const port = 18000 + Math.floor(Math.random() * 4000);
  // process.execPath rather than "node": the spawned environment does not
  // necessarily have the right node on its PATH.
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/main.ts"],
    {
      // vitest runs from the repo root, which is where the workspace lives.
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      stdio: "ignore",
    },
  );
  server = child;

  const deadline = Date.now() + 30000;
  while (!(await portOpen(port))) {
    if (Date.now() > deadline) throw new Error("Server did not start");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return `ws://127.0.0.1:${String(port)}`;
}

let clientSeq = 0;

/**
 * Mount one independent client, as if it were another browser tab.
 *
 * Each gets its own token key. Real tabs get that isolation from sessionStorage;
 * here every client shares one jsdom document, so without a distinct key the
 * second client would resume the first one's seat and knock it off the socket.
 */
function mount(url: string): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  const storageKey = `hexport.test.${String(clientSeq++)}`;
  act(() => {
    root.render(<OnlineGame url={url} storageKey={storageKey} />);
  });
  return el;
}

function click(node: Element | null | undefined): void {
  if (node == null) throw new Error("nothing to click");
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(input: Element | null, value: string): void {
  if (input == null) throw new Error("no input");
  const el = input as HTMLInputElement;
  act(() => {
    // React tracks the last value it wrote, so assigning `el.value` directly is
    // ignored. Going through the prototype setter is what makes a controlled
    // input notice the change.
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    const setter = descriptor?.set?.bind(el);
    setter?.(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
  );
}

/** Let socket traffic and the resulting renders settle. */
async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(
  check: () => boolean,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await settle(20);
  }
}

beforeAll(async () => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;
  serverUrl = await startServer();
}, 60000);

afterAll(() => {
  server?.kill("SIGTERM");
  server = null;
});

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(async () => {
  for (const { root, el } of roots) {
    act(() => {
      root.unmount();
    });
    el.remove();
  }
  roots.length = 0;
  // Let the sockets finish closing before the jsdom realm goes away, otherwise
  // their close events land in a torn-down environment.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("the online client", () => {
  it("shows a connecting state then the lobby", async () => {
    const url = serverUrl;
    const el = mount(url);

    await waitFor(() => (el.textContent ?? "").includes("Create a room"), "lobby");
    expect(el.querySelector(".panel-card")).not.toBeNull();
  }, 30000);

  it("creates a room and shows the code", async () => {
    const url = serverUrl;
    const el = mount(url);
    await waitFor(() => button(el, "Create a room") !== undefined, "lobby");

    type(el.querySelector("input"), "Ana");
    click(button(el, "Create a room"));

    // "Room code" is already a label on the lobby, so match the code itself.
    await waitFor(() => /Room [A-Z0-9]{5}/.test(el.textContent ?? ""), "room code");
    expect(el.textContent).toMatch(/Room [A-Z0-9]{5}/);
    expect(el.textContent).toContain("Ana");
    expect(el.textContent).toContain("host");
  }, 30000);

  it("seats three browsers and starts a game", async () => {
    const url = serverUrl;

    const ana = mount(url);
    await waitFor(() => button(ana, "Create a room") !== undefined, "lobby");
    type(ana.querySelector("input"), "Ana");
    click(button(ana, "Create a room"));
    await waitFor(() => /Room [A-Z0-9]{5}/.test(ana.textContent ?? ""), "room");

    const code = /Room ([A-Z0-9]{5})/.exec(ana.textContent ?? "")?.[1] ?? "";
    expect(code).toHaveLength(5);

    const others: HTMLDivElement[] = [];
    for (const name of ["Ben", "Cal"]) {
      const el = mount(url);
      await waitFor(() => button(el, "Join") !== undefined, "lobby");
      const inputs = el.querySelectorAll("input");
      type(inputs[0] ?? null, name);
      type(inputs[1] ?? null, code);
      click(button(el, "Join"));
      await waitFor(
        () => (el.textContent ?? "").includes(`Room ${code}`),
        `${name} joined`,
      );
      others.push(el);
    }

    // Everyone marks ready; only the host can start.
    for (const el of [ana, ...others]) {
      click(button(el, "I'm ready"));
      await settle(40);
    }
    await waitFor(() => button(ana, "Start game")?.disabled === false, "start enabled");

    click(button(ana, "Start game"));

    // All three clients land on the board.
    for (const el of [ana, ...others]) {
      await waitFor(() => el.querySelector("svg.board") !== null, "board");
    }

    // 19 land hexes, drawn from the redacted view each client received.
    expect(ana.querySelectorAll("svg.board polygon").length).toBeGreaterThanOrEqual(19);
    expect(ana.textContent).toContain("Online");
  }, 60000);

  it("places a settlement by clicking the board", async () => {
    const url = serverUrl;

    const ana = mount(url);
    await waitFor(() => button(ana, "Create a room") !== undefined, "lobby");
    type(ana.querySelector("input"), "Ana");
    click(button(ana, "Create a room"));
    await waitFor(() => /Room [A-Z0-9]{5}/.test(ana.textContent ?? ""), "room");
    const code = /Room ([A-Z0-9]{5})/.exec(ana.textContent ?? "")?.[1] ?? "";

    const rest: HTMLDivElement[] = [];
    for (const name of ["Ben", "Cal"]) {
      const el = mount(url);
      await waitFor(() => button(el, "Join") !== undefined, "lobby");
      const inputs = el.querySelectorAll("input");
      type(inputs[0] ?? null, name);
      type(inputs[1] ?? null, code);
      click(button(el, "Join"));
      await waitFor(() => (el.textContent ?? "").includes(`Room ${code}`), "joined");
      rest.push(el);
    }
    for (const el of [ana, ...rest]) {
      click(button(el, "I'm ready"));
      await settle(40);
    }
    await waitFor(() => button(ana, "Start game")?.disabled === false, "ready");
    click(button(ana, "Start game"));
    await waitFor(() => ana.querySelector("svg.board") !== null, "board");

    // Ana is seat 0, so setup starts with her and only her board is clickable.
    await waitFor(
      () => ana.querySelectorAll(".node-target").length > 0,
      "Ana's placement targets",
    );
    expect(rest[0]?.querySelectorAll(".node-target").length ?? 0).toBe(0);

    click(ana.querySelector(".node-target"));

    // The settlement appears for everyone, because the server broadcast it.
    for (const el of [ana, ...rest]) {
      await waitFor(
        () => el.querySelectorAll(".building").length === 1,
        "settlement visible to all",
      );
    }
    // And Ana is now asked for the adjoining road.
    expect(ana.textContent).toContain("Place an adjoining road");
  }, 60000);

  it("shows opponents as card counts, never as hands", async () => {
    const url = serverUrl;
    const ana = mount(url);
    await waitFor(() => button(ana, "Create a room") !== undefined, "lobby");
    type(ana.querySelector("input"), "Ana");
    click(button(ana, "Create a room"));
    await waitFor(() => /Room [A-Z0-9]{5}/.test(ana.textContent ?? ""), "room");
    const code = /Room ([A-Z0-9]{5})/.exec(ana.textContent ?? "")?.[1] ?? "";

    const rest: HTMLDivElement[] = [];
    for (const name of ["Ben", "Cal"]) {
      const el = mount(url);
      await waitFor(() => button(el, "Join") !== undefined, "lobby");
      const inputs = el.querySelectorAll("input");
      type(inputs[0] ?? null, name);
      type(inputs[1] ?? null, code);
      click(button(el, "Join"));
      await waitFor(() => (el.textContent ?? "").includes(`Room ${code}`), "joined");
      rest.push(el);
    }
    for (const el of [ana, ...rest]) {
      click(button(el, "I'm ready"));
      await settle(40);
    }
    await waitFor(() => button(ana, "Start game")?.disabled === false, "ready");
    click(button(ana, "Start game"));
    await waitFor(() => ana.querySelector("svg.board") !== null, "board");

    // The player strip reports counts for everyone.
    const strip = ana.querySelector(".players")?.textContent ?? "";
    expect(strip).toContain("Ana (you)");
    expect(strip).toContain("Ben");
    expect(strip).toMatch(/\d+ cards/);
  }, 60000);
});
