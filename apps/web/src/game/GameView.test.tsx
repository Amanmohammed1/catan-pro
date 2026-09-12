// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameView } from "./GameView.js";

/**
 * The M1 acceptance criterion is a full hot-seat game played in this UI without
 * a rules dispute. Engine tests prove the rules; these prove the screen actually
 * exposes them — that the right controls appear in each phase, that clicking a
 * highlighted spot places a piece, and that a game can be driven to a winner
 * through the DOM alone.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(search = "?seed=ui-test&players=3"): HTMLDivElement {
  window.history.replaceState({}, "", `/${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(<GameView />);
  });
  return container;
}

function click(el: Element | null | undefined): void {
  if (el == null) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
  );
}

function text(el: HTMLElement): string {
  return el.textContent ?? "";
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

/** Drive the whole setup phase by clicking the first highlighted target. */
function completeSetupInUi(el: HTMLElement): void {
  for (let i = 0; i < 40; i++) {
    const node = el.querySelector(".node-target");
    const edge = el.querySelector(".edge-target");
    if (node !== null) {
      click(node);
      continue;
    }
    if (edge !== null) {
      click(edge);
      continue;
    }
    return;
  }
  throw new Error("setup did not finish");
}

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

describe("a complete game", () => {
  it("can be played to a winner entirely through the UI", () => {
    const el = render("?seed=ui-full&players=3");
    completeSetupInUi(el);

    /**
     * Drive the game through the DOM only, preferring to build whenever a build
     * button is enabled. This is the UI equivalent of the random-legal bot: if
     * any phase fails to expose a usable control the loop throws, and if the
     * build controls are wired up wrong nobody ever scores and the test fails
     * on the step budget instead.
     */
    const tryBuild = (label: string): boolean => {
      const b = button(el, label);
      if (b === undefined || b.disabled) return false;
      click(b);
      const target = el.querySelector(".node-target, .edge-target");
      if (target === null) {
        click(b); // nothing highlighted; switch the mode back off
        return false;
      }
      click(target);
      return true;
    };

    let steps = 0;
    for (; steps < 20000; steps++) {
      if (text(el).includes("wins")) break;

      const roll = button(el, "Roll dice");
      if (roll !== undefined) {
        click(roll);
        continue;
      }

      if (text(el).includes("Discard")) {
        const confirm = el.querySelector<HTMLButtonElement>(".actions button.primary");
        if (confirm !== null && !confirm.disabled) {
          click(confirm);
          continue;
        }
        const plus = [...el.querySelectorAll(".picker-row button")].find(
          (b) => b.textContent === "+" && !(b as HTMLButtonElement).disabled,
        );
        if (plus !== undefined) {
          click(plus);
          continue;
        }
      }

      const tile = el.querySelector(".tile.targetable");
      if (tile !== null) {
        click(tile);
        continue;
      }

      if (text(el).includes("Choose someone to rob")) {
        const steal = el.querySelector(".actions button");
        if (steal !== null) {
          click(steal);
          continue;
        }
      }

      if (text(el).includes("free road")) {
        const edge = el.querySelector(".edge-target");
        if (edge !== null) {
          click(edge);
          continue;
        }
        const cont = button(el, "continue");
        if (cont !== undefined) {
          click(cont);
          continue;
        }
      }

      if (text(el).includes("Trade and build")) {
        // Cities first: they are the fastest route to ten points.
        if (tryBuild("City")) continue;
        if (tryBuild("Settlement")) continue;
        if (tryBuild("Road")) continue;

        const dev = button(el, "Development card");
        if (dev !== undefined && !dev.disabled) {
          click(dev);
          continue;
        }

        const end = button(el, "End turn");
        if (end !== undefined) {
          click(end);
          continue;
        }
      }

      const end = button(el, "End turn");
      if (end !== undefined) {
        click(end);
        continue;
      }

      const cont = button(el, "continue");
      if (cont !== undefined) {
        click(cont);
        continue;
      }

      throw new Error(
        `UI offered no usable control. Screen said: ${text(el).slice(0, 400)}`,
      );
    }

    expect(steps).toBeLessThan(20000);
    expect(text(el)).toContain("wins");
    expect(el.querySelector(".winner")).not.toBeNull();
  }, 180000);
});
