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
 * Choosing a board when creating a room, against a real server.
 *
 * The lobby gained a board picker and nothing proved it arrived anywhere. The
 * server has accepted `scenarioId` on createRoom since M2, but until now the
 * client never sent one, so "the server honours it" was read from the source
 * rather than observed.
 *
 * The harness mirrors OnlineGame.slow.test.tsx: a real server process, real
 * sockets, and the `ws` client swapped in for the global, because jsdom's Event
 * class and Node's own WebSocket refuse each other.
 */

let server: ChildProcess | null = null;
let serverUrl = "";
const roots: { root: Root; el: HTMLDivElement }[] = [];
let clientSeq = 0;

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

async function startServer(): Promise<string> {
  const port = 22000 + Math.floor(Math.random() * 4000);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/main.ts"],
    {
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

function mount(url: string): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  const storageKey = `hexport.board.${String(clientSeq++)}`;
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
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.bind(el)(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(
  check: () => boolean,
  what: string,
  timeoutMs = 8000,
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
  await new Promise((resolve) => setTimeout(resolve, 50));
});

/** Fill in a name and open the create form. */
async function readyToCreate(el: HTMLElement): Promise<void> {
  await waitFor(() => (el.textContent ?? "").includes("Create a room"), "the lobby");
  type(el.querySelector("#nickname"), "Ana");
}

describe("choosing a board when creating a room", () => {
  it("puts the room on the board that was picked", async () => {
    const el = mount(serverUrl);
    await readyToCreate(el);

    const seafarers = el.querySelector<HTMLButtonElement>(
      'button[data-board="new-shores-4"]',
    );
    expect(seafarers).not.toBeNull();
    click(seafarers);

    click(el.querySelector('button[data-action="create-room"]'));
    await waitFor(() => el.querySelector("[data-room-board]") !== null, "a room");

    const shown = el
      .querySelector("[data-room-board]")
      ?.getAttribute("data-room-board");
    expect(shown).toBe("new-shores-4");
    // And the name, not the id, is what a person reads.
    expect(el.textContent).toContain("Heading for New Shores");
  }, 30000);

  it("falls back to the board that suits the seat count when none is picked", async () => {
    const el = mount(serverUrl);
    await readyToCreate(el);

    // No board chosen: the server's own default should apply, and the client
    // must not send a second copy of that rule.
    click(el.querySelector('button[data-action="create-room"]'));
    await waitFor(() => el.querySelector("[data-room-board]") !== null, "a room");

    expect(el.querySelector("[data-room-board]")?.getAttribute("data-room-board")).toBe(
      "classic-3-4",
    );
  }, 30000);

  it("still shows the board field when only one board fits the seat count", async () => {
    const el = mount(serverUrl);
    await readyToCreate(el);

    const six = [...el.querySelectorAll("button")].find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.trim() === "6",
    );
    click(six);
    await settle();

    // The field used to be hidden whenever fewer than two boards qualified, so
    // choosing five or six seats made it disappear altogether — which reads as
    // "no boards exist" rather than "one board does". A control that vanishes
    // cannot explain itself, and the test that should have caught this only
    // asserted which boards were *absent*, so it passed either way.
    expect(el.querySelector('button[data-board="classic-5-6"]')).not.toBeNull();
    expect(el.textContent).toContain("Board");
  }, 30000);

  it("offers only boards the chosen seat count can play", async () => {
    const el = mount(serverUrl);
    await readyToCreate(el);

    // Six seats: the Seafarers maps top out at four, the big island needs five.
    const six = [...el.querySelectorAll("button")].find(
      (b) => b.getAttribute("role") === "radio" && b.textContent?.trim() === "6",
    );
    click(six);
    await settle();

    expect(el.querySelector('button[data-board="new-shores-4"]')).toBeNull();
    expect(el.querySelector('button[data-board="new-shores-3"]')).toBeNull();
  }, 30000);
});
