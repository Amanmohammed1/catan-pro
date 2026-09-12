// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HotSeatGame } from "./HotSeatGame.js";
import { button, click, completeSetupInUi, drive, text } from "./uiDriver.js";

/**
 * The M1 acceptance criterion is a full hot-seat game played in this UI without
 * a rules dispute. Since M2 the same screen renders online play, driven by a
 * redacted view instead of a local GameState, so these also cover that path. Engine tests prove the rules; these prove the screen actually
 * exposes them — that the right controls appear in each phase, that clicking a
 * highlighted spot places a piece, and that a game can be driven to a winner
 * through the DOM alone.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(search = "?seed=ui-test&players=3"): HTMLDivElement {
  const params = new URLSearchParams(search);
  const seed = params.get("seed") ?? "ui-test";
  const players = Number(params.get("players") ?? "3");

  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(<HotSeatGame seed={seed} players={players} />);
  });
  return container;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe("first render", () => {
  it("shows the board, the players and the setup prompt", () => {
    const el = render();
    expect(el.querySelector("svg.board")).not.toBeNull();
    expect(el.querySelectorAll(".player")).toHaveLength(3);
    expect(text(el)).toContain("Place settlement 1 of 2");
  });

  it("highlights legal setup settlement spots and nothing else", () => {
    const el = render();
    expect(el.querySelectorAll(".node-target").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".edge-target")).toHaveLength(0);
  });

  it("starts every player on zero victory points shown as 0 vp", () => {
    const el = render();
    const stats = [...el.querySelectorAll(".player .pstat")].map((s) => s.textContent);
    expect(stats.filter((s) => s === "0 vp")).toHaveLength(3);
  });
});

describe("placing pieces", () => {
  it("places a settlement then asks for a road", () => {
    const el = render();
    click(el.querySelector(".node-target"));

    expect(text(el)).toContain("Place an adjoining road");
    expect(el.querySelectorAll(".edge-target").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".node-target")).toHaveLength(0);
    expect(el.querySelectorAll(".building").length).toBe(1);
  });

  it("places a road and passes to the next player", () => {
    const el = render();
    click(el.querySelector(".node-target"));
    click(el.querySelector(".edge-target"));

    expect(el.querySelectorAll(".road")).toHaveLength(1);
    expect(text(el)).toContain("Place settlement 1 of 2");
    // Player 2 is now on the clock.
    expect(text(el)).toContain("Player 2");
  });
});

describe("after setup", () => {
  it("offers the roll button", () => {
    const el = render();
    completeSetupInUi(el);
    expect(button(el, "Roll dice")).toBeDefined();
    expect(text(el)).toContain("Roll the dice");
  });

  it("places six settlements and six roads for three players", () => {
    const el = render();
    completeSetupInUi(el);
    expect(el.querySelectorAll(".building")).toHaveLength(6);
    expect(el.querySelectorAll(".road")).toHaveLength(6);
  });

  it("gives every player starting resources", () => {
    const el = render();
    completeSetupInUi(el);
    const counts = [...el.querySelectorAll(".hand .count")].map((c) =>
      Number(c.textContent),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("shows a game log", () => {
    const el = render();
    completeSetupInUi(el);
    expect(el.querySelectorAll(".log-line").length).toBeGreaterThan(0);
  });

  it("rolls the dice and moves into the build phase", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll dice"));

    const body = text(el);
    // Either production happened and we are building, or a 7 sent us to the
    // robber. Both are legal outcomes of one roll.
    expect(
      body.includes("Trade and build") ||
        body.includes("Move the robber") ||
        body.includes("Discard half"),
    ).toBe(true);
  });
});

describe("the build controls follow legalMoves", () => {
  it("disables buttons the player cannot afford", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll dice"));

    // Starting hands are 1-3 cards, so a city (3 ore + 2 grain) is never
    // affordable on the first turn.
    const city = button(el, "City");
    if (city !== undefined) {
      expect(city.disabled).toBe(true);
    }
  });

  it("shows an end turn button in the main phase", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll dice"));
    if (text(el).includes("Trade and build")) {
      expect(button(el, "End turn")).toBeDefined();
    }
  });
});

describe("several turns", () => {
  it("keeps offering usable controls turn after turn", () => {
    const el = render("?seed=ui-turns&players=3");
    completeSetupInUi(el);

    // Not a full game — that runs in the slow lane. This checks the screen
    // never gets into a state with nothing to click, which is the failure mode
    // that would strand a real player.
    for (let step = 0; step < 400; step++) {
      if (text(el).includes("wins")) break;
      if (drive(el)) continue;
      throw new Error(
        `UI offered no usable control. Screen said: ${text(el).slice(0, 300)}`,
      );
    }

    expect(el.querySelector("svg.board")).not.toBeNull();
    expect(el.querySelectorAll(".log-line").length).toBeGreaterThan(5);
  }, 60000);
});
