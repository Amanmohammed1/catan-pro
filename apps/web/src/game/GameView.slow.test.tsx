// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";
import { completeSetupInUi, drive, mountGame, text } from "./uiDriver.js";

/**
 * A whole hot-seat game, played to a winner through the DOM.
 *
 * This is the M1 acceptance criterion and it still holds after the M2 refactor,
 * where the same screen renders from a redacted view rather than a GameState.
 * It lives in the slow lane because a random-ish game runs to a few hundred
 * turns.
 */

let mounted: { el: HTMLDivElement; root: Root } | null = null;

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

    let steps = 0;
    for (; steps < 40000; steps++) {
      if (text(el).includes("wins")) break;
      if (drive(el)) continue;
      throw new Error(
        `UI offered no usable control. Screen said: ${text(el).slice(0, 400)}`,
      );
    }

    expect(steps).toBeLessThan(40000);
    expect(text(el)).toContain("wins");
    expect(el.querySelector(".winner")).not.toBeNull();
  }, 180000);
});
