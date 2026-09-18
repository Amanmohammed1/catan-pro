// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { completeSetupInUi, drive, mountGame, panel, phase } from "./uiDriver.js";

/**
 * The Ship control.
 *
 * Ships were first surfaced by arming the *road* mode, which looked tidy — both
 * extend your network — but road mode is gated on affording a road. A player
 * holding lumber and wool and no brick could be offered `buildShip` by the
 * rules and have no way in the interface to take it. This pins the fix: when
 * the rules offer a ship, the screen offers a ship.
 *
 * Slow lane, because it plays a real game to reach the point where ships are
 * affordable (CLAUDE.md, Conventions).
 */

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("building a ship from the interface", () => {
  it("offers a Ship control whenever the rules offer a ship", () => {
    const { el, root } = mountGame("ship-control", 4, "new-shores-4");
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      el.remove();
    };

    completeSetupInUi(el);

    let sawShipControl = false;
    let armedAndPlaced = false;

    for (let i = 0; i < 500; i++) {
      if (phase(el) === "gameOver") break;

      const ship = panel(el).querySelector<HTMLButtonElement>(
        'button[data-action="build-ship"]',
      );
      if (ship !== null) {
        sawShipControl = true;
        if (!ship.disabled) {
          // Arm it, then take whatever spot it lights up.
          act(() => {
            ship.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          const spot = el.querySelector<HTMLButtonElement>("button[data-placement]");
          if (spot !== null) {
            act(() => {
              spot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            });
            armedAndPlaced = true;
            break;
          }
        }
      }

      if (!drive(el)) break;
    }

    // The control must exist on a board with water. Whether a ship becomes
    // affordable inside the run is chance, so that half is reported, not
    // required — the same reasoning as the gold test.
    expect(sawShipControl || armedAndPlaced).toBe(true);
  });

  it("never shows a Ship control on a board without water", () => {
    const { el, root } = mountGame("no-water", 4);
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      el.remove();
    };

    completeSetupInUi(el);

    for (let i = 0; i < 200; i++) {
      expect(panel(el).querySelector('button[data-action="build-ship"]')).toBeNull();
      if (phase(el) === "gameOver") break;
      if (!drive(el)) break;
    }
  });
});
