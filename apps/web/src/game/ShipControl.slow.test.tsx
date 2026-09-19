// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { completeSetupInUi, drive, mountGame, panel, phase, text } from "./uiDriver.js";

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
            break;
          }
        }
      }

      if (!drive(el)) break;
    }

    // The control must exist on a board with water — required, not reported.
    // This used to read `sawShipControl || armedAndPlaced`, which passed as
    // long as the control turned up at some point; under the old code that
    // only happened once a ship was already legal, so the assertion could
    // never have caught the control being hidden while illegal.
    // Whether a ship becomes affordable and gets placed inside the run is
    // chance, so the loop takes the opportunity when it comes but nothing is
    // asserted about it — the same reasoning as the gold test.
    expect(sawShipControl).toBe(true);
  });

  it("keeps the Ship control visible and explained when no ship is placeable", () => {
    /*
     * The bug this exists for: the control rendered only when a ship was
     * already legal, so on a Seafarers board with every settlement inland it
     * vanished entirely. A player could not tell whether the board had ships or
     * the game had forgotten them — and because the row was hidden rather than
     * disabled, the reason string written for exactly this case was
     * unreachable.
     *
     * CLAUDE.md: "Every disabled control says why, via `title`."
     */
    const { el, root } = mountGame("ship-explained", 4, "through-the-desert-4");
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      el.remove();
    };

    completeSetupInUi(el);

    let sawDisabled = false;

    for (let i = 0; i < 120; i++) {
      // Keyed off the Road control rather than asserted unconditionally: the
      // build group only exists during your own main phase, so on someone
      // else's turn — or while rolling, discarding or moving the robber —
      // there is no Road either, and demanding a Ship there proves nothing.
      //
      // Wherever Road is offered, Ship must be offered too. That is exactly
      // what was broken: Road rendered always and greyed out, Ship vanished.
      const road = panel(el).querySelector<HTMLButtonElement>(
        'button[data-action="build-road"]',
      );

      if (road !== null) {
        const ship = panel(el).querySelector<HTMLButtonElement>(
          'button[data-action="build-ship"]',
        );
        expect(ship).not.toBeNull();

        if (ship !== null && ship.disabled) {
          sawDisabled = true;
          expect(ship.title.trim()).not.toBe("");
        }
      }

      if (phase(el) === "gameOver") break;
      if (!drive(el)) break;
    }

    // Straight after setup nobody can launch a ship, so the disabled state is
    // reached every run rather than by chance.
    expect(sawDisabled).toBe(true);
  });

  it("moves a ship end to end, through the DOM alone", () => {
    /*
     * Seafarers p.2: "You may move 1 ship during your Action phase."
     *
     * The engine implemented, fuzzed and tested this rule while no player could
     * perform it: `moveShip` reached the DOM from nowhere, and a comment in
     * GameScreen claimed otherwise. `domRoutes.test.ts` now stops an action
     * having no route at all — but a declared route is not a working one, so
     * this drives the gesture itself.
     *
     * A ship move takes two clicks: pick a ship up, then put it down. Both are
     * ordinary placements, so this is also the keyboard and screen-reader path.
     */
    const { el, root } = mountGame("ship-move", 4, "new-shores-4");
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      el.remove();
    };

    completeSetupInUi(el);

    for (let i = 0; i < 800; i++) {
      if (text(el).includes("moved a ship")) break;
      if (phase(el) === "gameOver") break;
      if (!drive(el)) break;
    }

    // Required, not reported. If a driven game cannot reach a ship move, that
    // is worth failing over: it would mean the gesture is unreachable in
    // practice even though the route table says it exists.
    expect(text(el)).toContain("moved a ship");
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
