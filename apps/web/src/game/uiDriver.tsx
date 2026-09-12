import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HotSeatGame } from "./HotSeatGame.js";

/**
 * Shared scaffolding for the UI tests.
 *
 * `drive` takes whatever the screen currently offers and clicks it, preferring
 * progress. It is the UI equivalent of the random-legal bot: if any phase fails
 * to expose a usable control, it returns false and the test fails.
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

export function text(el: HTMLElement): string {
  return el.textContent ?? "";
}

/** Drive the whole setup phase by clicking the first highlighted target. */
export function completeSetupInUi(el: HTMLElement): void {
  for (let i = 0; i < 60; i++) {
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

  const roll = button(el, "Roll dice");
  if (roll !== undefined) {
    click(roll);
    return true;
  }

  if (text(el).includes("Discard")) {
    const confirm = el.querySelector<HTMLButtonElement>(".actions button.primary");
    if (confirm !== null && !confirm.disabled) {
      click(confirm);
      return true;
    }
    const plus = [...el.querySelectorAll(".picker-row button")].find(
      (b) => b.textContent === "+" && !(b as HTMLButtonElement).disabled,
    );
    if (plus !== undefined) {
      click(plus);
      return true;
    }
  }

  const tile = el.querySelector(".tile.targetable");
  if (tile !== null) {
    click(tile);
    return true;
  }

  if (text(el).includes("Choose someone to rob")) {
    const steal = el.querySelector(".actions button");
    if (steal !== null) {
      click(steal);
      return true;
    }
  }

  if (text(el).includes("free road")) {
    const edge = el.querySelector(".edge-target");
    if (edge !== null) {
      click(edge);
      return true;
    }
    const cont = button(el, "continue");
    if (cont !== undefined) {
      click(cont);
      return true;
    }
  }

  if (text(el).includes("Trade and build")) {
    if (tryBuild("City")) return true;
    if (tryBuild("Settlement")) return true;
    if (tryBuild("Road")) return true;

    // Convert surplus into something useful before giving up on the turn.
    const bank = el.querySelector<HTMLElement>("details.trade");
    if (bank !== null) {
      (bank as HTMLDetailsElement).open = true;
      const trade = bank.querySelector<HTMLButtonElement>(".grid button");
      if (trade !== null) {
        click(trade);
        return true;
      }
    }

    const end = button(el, "End turn");
    if (end !== undefined) {
      click(end);
      return true;
    }
  }

  const end = button(el, "End turn");
  if (end !== undefined) {
    click(end);
    return true;
  }

  const cont = button(el, "continue");
  if (cont !== undefined) {
    click(cont);
    return true;
  }

  return false;
}
