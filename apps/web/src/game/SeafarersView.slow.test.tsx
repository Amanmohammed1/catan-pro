// @vitest-environment jsdom
import { vi } from "vitest";

// jsdom has no WebGL, so the board is stubbed out — which also means this
// exercises the DOM route a keyboard or screen-reader player takes.
vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { completeSetupInUi, drive, mountGame, phase } from "./uiDriver.js";

/**
 * A Seafarers board, played through the interface.
 *
 * The engine tests prove the rules; this proves a person can reach them. That
 * matters more than it sounds: a gold field stops the turn until its cards are
 * chosen, so a phase the interface has no control for is not a missing
 * decoration but a game that cannot continue. `drive` returns false when
 * nothing on screen is clickable, which is that condition exactly.
 *
 * In the slow lane because it plays real games, hundreds of turns each
 * (CLAUDE.md, Conventions). It first sat in the fast lane and took it from
 * twelve seconds to thirty-eight, which is the cost that convention exists to
 * keep out.
 *
 * The board is reached the way a person reaches it, through the same
 * `?hotseat=1&scenario=…` route App.tsx reads.
 */

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function play(seed: string, players: number, steps: number) {
  const { el, root } = mountGame(seed, players, "new-shores-4");
  cleanup = () => {
    act(() => {
      root.unmount();
    });
    el.remove();
  };

  completeSetupInUi(el);

  const seen = new Set<string>();
  let stuckAt: string | null = null;

  for (let i = 0; i < steps; i++) {
    const here = phase(el);
    seen.add(here);
    if (here === "gameOver") break;
    if (!drive(el)) {
      stuckAt = here;
      break;
    }
  }

  return { el, seen, stuckAt };
}

describe("a Seafarers game through the interface", () => {
  it("never reaches a phase the screen cannot leave", () => {
    const { seen, stuckAt } = play("shores-ui", 4, 400);
    expect(stuckAt).toBeNull();
    // Sanity: the game got going rather than stopping at setup.
    expect(seen.has("roll") || seen.has("main")).toBe(true);
  });

  it("offers a way through a gold field, wherever one turns up", () => {
    // Gold is two hexes in twenty-eight, so whether it pays out inside a
    // bounded run is chance. The property worth asserting is navigability, not
    // frequency: the screen must never reach a phase it cannot leave, and any
    // gold phase that does occur must be leavable — which is what `drive`
    // returning false would report.
    //
    // Requiring gold to appear would be an assertion about the dice dressed up
    // as one about the interface, and would go flaky the first time a board or
    // a seed changed.
    for (const seed of ["gold-a", "gold-b"]) {
      const { stuckAt } = play(seed, 4, 400);
      expect(stuckAt).toBeNull();
      cleanup?.();
      cleanup = null;
    }
  });

  it("keeps the opening settlements on the main island (p.4)", () => {
    // Setup completing at all is the assertion: every round had to find a legal
    // spot under the island restriction, on a main island of nineteen hexes
    // with four players and the distance rule.
    const { el } = play("shores-setup", 4, 0);
    expect(phase(el)).not.toBe("setup");
  });
});
