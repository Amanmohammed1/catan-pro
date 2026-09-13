// @vitest-environment jsdom
import { vi } from "vitest";

// jsdom has no WebGL; see test/stubCanvas.ts for why this is the right split.
vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";
import {
  button,
  click,
  completeSetupInUi,
  drive,
  firstPlacement,
  mountGame,
  text,
} from "./uiDriver.js";

/**
 * The game interface.
 *
 * The board is a WebGL canvas and cannot mount in jsdom, so it is stubbed out.
 * What is asserted here is everything around it — and, deliberately, that the
 * whole game is playable without the canvas at all. That is the same path a
 * keyboard or screen-reader player takes, so these are accessibility tests as
 * much as they are interface tests.
 */

let mounted: { el: HTMLDivElement; root: Root } | null = null;

function render(seed = "ui-test", players = 3): HTMLDivElement {
  mounted = mountGame(seed, players);
  return mounted.el;
}

afterEach(() => {
  if (mounted === null) return;
  act(() => {
    mounted?.root.unmount();
  });
  mounted.el.remove();
  mounted = null;
});

describe("first render", () => {
  it("shows every player with a score and a hand size", () => {
    const el = render();
    const players = el.querySelectorAll('[aria-label="Players"] > li');
    expect(players).toHaveLength(3);
    expect(text(el)).toContain("Player 1");
    expect(text(el)).toContain("(you)");
  });

  it("says what the player has to do", () => {
    const el = render();
    expect(text(el)).toContain("Place settlement 1 of 2");
  });

  it("offers the legal placements in the DOM, not only on the canvas", () => {
    const el = render();
    const placements = el.querySelectorAll("button[data-placement]");
    // A fresh board has 54 intersections, every one of them legal.
    expect(placements.length).toBe(54);
  });

  it("describes each placement in terms of the hexes that meet there", () => {
    const el = render();
    const first = firstPlacement(el);
    expect(first).not.toBeNull();
    // e.g. "Forest 11, Hills 4 and Pasture 6"
    expect(first?.textContent ?? "").toMatch(/[A-Z][a-z]+/);
    expect(first?.textContent ?? "").not.toContain("v|");
  });

  it("has a live region for screen readers", () => {
    const el = render();
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

describe("placing pieces", () => {
  it("places a settlement, then asks for the road", () => {
    const el = render();
    click(firstPlacement(el));

    expect(text(el)).toContain("Place an adjoining road");
    // Only the paths touching the new settlement are on offer now.
    const offered = el.querySelectorAll("button[data-placement]").length;
    expect(offered).toBeGreaterThan(0);
    expect(offered).toBeLessThanOrEqual(3);
  });

  it("passes to the next player once the road is down", () => {
    const el = render();
    click(firstPlacement(el));
    click(firstPlacement(el));

    expect(text(el)).toContain("Place settlement 1 of 2");
    expect(text(el)).toContain("Player 2");
  });
});

describe("after setup", () => {
  it("offers the roll", () => {
    const el = render();
    completeSetupInUi(el);
    expect(button(el, "Roll the dice")).toBeDefined();
  });

  it("gives every player their starting resources", () => {
    const el = render();
    completeSetupInUi(el);
    const hand = el.querySelector('[aria-label="Your resource cards"]');
    expect(hand).not.toBeNull();
    const total = [...(hand?.querySelectorAll("li") ?? [])]
      .map((li) => Number(li.querySelector(".font-num")?.textContent ?? "0"))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("writes what happened to the log", () => {
    const el = render();
    completeSetupInUi(el);
    const entries = el.querySelectorAll("ol li");
    expect(entries.length).toBeGreaterThan(3);
  });

  it("moves into the build phase once the dice are rolled", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll the dice"));

    const body = text(el);
    expect(
      body.includes("Trade and build") ||
        body.includes("Move the robber") ||
        body.includes("Discard"),
    ).toBe(true);
  });
});

describe("controls follow legalMoves", () => {
  it("disables what the player cannot afford", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll the dice"));

    // A city is three ore and two grain; nobody has that on turn one.
    const city = button(el, "City");
    if (city !== undefined) expect(city.disabled).toBe(true);
  });

  it("explains why a disabled control is disabled", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll the dice"));

    // Every disabled button says what would make it possible, rather than
    // leaving the player to guess.
    const disabled = [...el.querySelectorAll("button")].filter((b) => b.disabled);
    for (const control of disabled) {
      expect(control.getAttribute("title") ?? "").not.toBe("");
    }
  });

  it("offers an end turn in the build phase", () => {
    const el = render();
    completeSetupInUi(el);
    click(button(el, "Roll the dice"));
    if (text(el).includes("Trade and build")) {
      expect(button(el, "End turn")).toBeDefined();
    }
  });
});

describe("several turns", () => {
  it("always leaves something usable on screen", () => {
    const el = render("ui-turns", 3);
    completeSetupInUi(el);

    // Not a full game — that runs in the slow lane. This checks the interface
    // never reaches a state with nothing to click, which is the failure that
    // would strand a real player.
    for (let step = 0; step < 400; step++) {
      if (text(el).includes("wins")) break;
      if (drive(el)) continue;
      throw new Error(`Nothing usable on screen. It said: ${text(el).slice(0, 300)}`);
    }

    expect(el.querySelectorAll("ol li").length).toBeGreaterThan(5);
  }, 60000);
});
