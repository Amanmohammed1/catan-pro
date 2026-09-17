// @vitest-environment jsdom
import { vi } from "vitest";

// jsdom has no WebGL; see stubCanvas for why this is the right split.
vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";
import { click, completeSetupInUi, drive, mountGame, text } from "./uiDriver.js";

/**
 * A whole hot-seat game, played to a winner through the DOM.
 *
 * This is the M1 acceptance criterion and it still holds after the M2 refactor,
 * where the same screen renders from a redacted view rather than a GameState.
 * It lives in the slow lane because a random-ish game runs to a few hundred
 * turns.
 */

let mounted: { el: HTMLDivElement; root: Root } | null = null;

/** The turn counter the screen is showing, or -1 if it is not visible. */
function readTurn(el: HTMLElement): number {
  const found = /turn (\d+)/.exec(el.textContent ?? "");
  return found === null ? -1 : Number(found[1]);
}

afterEach(() => {
  if (mounted !== null) {
    act(() => {
      mounted?.root.unmount();
    });
    mounted.el.remove();
    mounted = null;
  }
});

describe("a complete game", () => {
  it("can be played to a winner entirely through the UI", () => {
    mounted = mountGame("ui-full", 3);
    const el = mounted.el;
    completeSetupInUi(el);

    // Fail on a stall rather than on the step budget: a driver that clicks
    // forever without the turn advancing is a different bug from a slow game,
    // and the message should say which one happened.
    let steps = 0;
    let lastTurn = -1;
    let sinceProgress = 0;

    for (; steps < 40000; steps++) {
      if (text(el).includes("wins")) break;

      const turn = readTurn(el);
      if (turn !== lastTurn) {
        lastTurn = turn;
        sinceProgress = 0;
      } else if (++sinceProgress > 600) {
        throw new Error(
          `Stuck on turn ${String(turn)} after ${String(steps)} clicks. Screen said: ${text(el).slice(0, 400)}`,
        );
      }

      if (drive(el)) continue;
      throw new Error(
        `UI offered no usable control. Screen said: ${text(el).slice(0, 400)}`,
      );
    }

    expect(steps).toBeLessThan(40000);
    expect(text(el)).toContain("wins");
    expect(el.querySelector("[data-winner]")).not.toBeNull();

    // "Play again" deals a new board to the same people (M4). Hot-seat does it
    // locally; online the host asks the server for it.
    const again = el.querySelector<HTMLButtonElement>('button[data-action="rematch"]');
    expect(again).not.toBeNull();
    click(again);

    expect(el.querySelector("[data-winner]")).toBeNull();
    expect(readTurn(el)).toBe(0);
    expect(el.querySelectorAll("button[data-placement]").length).toBeGreaterThan(0);
  }, 180000);
});
