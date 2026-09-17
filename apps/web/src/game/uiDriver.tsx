import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HotSeatGame } from "./HotSeatGame.js";

/**
 * Shared scaffolding for the UI tests.
 *
 * `drive` takes whatever the screen currently offers and clicks it, preferring
 * progress. It is the UI equivalent of the random-legal bot: if any phase fails
 * to expose a usable control, it returns false and the test fails.
 *
 * Controls are found by `data-action`, never by label or class name, so
 * restyling and rewording the interface cannot break the tests (CLAUDE.md,
 * Conventions).
 */

export function mountGame(
  seed: string,
  players: number,
): { el: HTMLDivElement; root: Root } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<HotSeatGame seed={seed} players={players} />);
  });
  return { el, root };
}

export function click(el: Element | null | undefined): void {
  if (el == null) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
  );
}

/** A control by its data-action, within the controls panel. */
export function action(el: HTMLElement, name: string): HTMLButtonElement | null {
  return panel(el).querySelector<HTMLButtonElement>(`button[data-action="${name}"]`);
}

export function text(el: HTMLElement): string {
  return el.textContent ?? "";
}

/**
 * The controls panel, excluding the game log.
 *
 * Matching phase names against the whole screen looks fine until the log fills
 * up with the history of the game: "Discard required: Player 3" scrolls past and
 * every check for "Discard" starts matching forever. Scope to the panel that
 * actually reflects the current phase.
 */
export function panel(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('[data-panel="actions"]') ?? el;
}

/** The phase the screen is currently showing. */
export function phase(el: HTMLElement): string {
  return el.querySelector("[data-prompt]")?.getAttribute("data-prompt") ?? "";
}

/**
 * The first legal placement offered in the DOM.
 *
 * Since the board became a WebGL canvas, clicking a mesh is unavailable to
 * jsdom — and to anyone using a keyboard. Both use the placement list, which is
 * the accessible route to exactly the same moves.
 */
export function firstPlacement(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>("button[data-placement]");
}

/** Drive the whole setup phase by taking the first offered placement. */
export function completeSetupInUi(el: HTMLElement): void {
  for (let i = 0; i < 60; i++) {
    const placement = firstPlacement(el);
    if (placement === null) return;
    click(placement);
  }
  throw new Error("setup did not finish");
}

/**
 * Take whatever the screen currently offers, preferring progress.
 *
 * Returns false when nothing is clickable, which is the condition the tests care
 * about: a phase the UI cannot get out of.
 *
 * Bank trading matters here. Without it the driver hoards resources it can never
 * spend, hits the seven-card limit constantly, and a game drags on for thousands
 * of turns — which is what a real player stuck without a trade button would also
 * experience.
 */
export function drive(el: HTMLElement): boolean {
  const take = (name: string): boolean => {
    const control = action(el, name);
    if (control === null || control.disabled) return false;
    click(control);
    return true;
  };

  const tryBuild = (name: string): boolean => {
    const control = action(el, name);
    if (control === null || control.disabled) return false;
    click(control);
    const target = firstPlacement(el);
    if (target === null) {
      click(control); // nothing offered; switch the mode back off
      return false;
    }
    click(target);
    return true;
  };

  const here = phase(el);

  if (take("roll")) return true;

  if (here === "discard") {
    if (take("discard")) return true;
    const plus = [...el.querySelectorAll("button")].find(
      (b) => (b.getAttribute("aria-label") ?? "").startsWith("one more") && !b.disabled,
    );
    if (plus !== undefined) {
      click(plus);
      return true;
    }
  }

  if (here === "moveRobber") {
    const tile = firstPlacement(el);
    if (tile !== null) {
      click(tile);
      return true;
    }
  }

  if (here === "steal") {
    if (take("steal")) return true;
    if (take("continue")) return true;
  }

  if (here === "roadBuilding") {
    const edge = firstPlacement(el);
    if (edge !== null) {
      click(edge);
      return true;
    }
    if (take("continue")) return true;
  }

  if (here === "tradeOffer") {
    if (take("decline")) return true;
    if (take("withdraw")) return true;
  }

  if (here === "main") {
    if (tryBuild("build-city")) return true;
    if (tryBuild("build-settlement")) return true;
    if (tryBuild("build-road")) return true;
    // Convert surplus into something useful before giving up on the turn.
    if (take("bank-trade")) return true;
    if (take("end-turn")) return true;
  }

  if (take("end-turn")) return true;
  if (take("continue")) return true;

  return false;
}
