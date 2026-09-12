// @vitest-environment jsdom
import { it } from "vitest";
/**
 * Dev tool, not a test. Renders the board to an SVG file so a change to the
 * renderer can be looked at rather than only asserted on:
 *
 *   HEXPORT_SNAPSHOT_DIR=/tmp pnpm exec vitest run apps/web/src/game/__snapshot.test.tsx
 *
 * With the variable unset it returns immediately, so normal runs pay nothing.
 */
import { writeFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GameView } from "./GameView.js";

const OUT = process.env["HEXPORT_SNAPSHOT_DIR"] ?? "";

it("dumps the board svg for visual review", () => {
  if (OUT === "") return;

  window.history.replaceState({}, "", "/?seed=shot&players=4");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<GameView />);
  });

  const click = (el: Element | null): void => {
    if (el === null) return;
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  const button = (label: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
    );
  const text = (): string => container.textContent ?? "";

  // Setup.
  for (let i = 0; i < 40; i++) {
    const node = container.querySelector(".node-target");
    const edge = container.querySelector(".edge-target");
    if (node !== null) {
      click(node);
      continue;
    }
    if (edge !== null) {
      click(edge);
      continue;
    }
    break;
  }

  // Play a while so the board has roads, settlements and a city on it.
  const tryBuild = (label: string): boolean => {
    const b = button(label);
    if (b === undefined || b.disabled) return false;
    click(b);
    const target = container.querySelector(".node-target, .edge-target");
    if (target === null) {
      click(b);
      return false;
    }
    click(target);
    return true;
  };

  for (let step = 0; step < 4000; step++) {
    if (text().includes("wins")) break;
    const roll = button("Roll dice");
    if (roll !== undefined) {
      click(roll);
      continue;
    }
    if (text().includes("Discard")) {
      const confirm = container.querySelector<HTMLButtonElement>(
        ".actions button.primary",
      );
      if (confirm !== null && !confirm.disabled) {
        click(confirm);
        continue;
      }
      const plus = [...container.querySelectorAll(".picker-row button")].find(
        (b) => b.textContent === "+" && !(b as HTMLButtonElement).disabled,
      );
      if (plus !== undefined) {
        click(plus);
        continue;
      }
    }
    const tile = container.querySelector(".tile.targetable");
    if (tile !== null) {
      click(tile);
      continue;
    }
    if (text().includes("Choose someone to rob")) {
      const steal = container.querySelector(".actions button");
      if (steal !== null) {
        click(steal);
        continue;
      }
    }
    if (text().includes("free road")) {
      const edge = container.querySelector(".edge-target");
      if (edge !== null) {
        click(edge);
        continue;
      }
      const cont = button("continue");
      if (cont !== undefined) {
        click(cont);
        continue;
      }
    }
    if (text().includes("Trade and build")) {
      if (step > 300 && tryBuild("City")) continue;
      if (tryBuild("Settlement")) continue;
      if (tryBuild("Road")) continue;
      const end = button("End turn");
      if (end !== undefined) {
        click(end);
        continue;
      }
    }
    const end = button("End turn");
    if (end !== undefined) {
      click(end);
      continue;
    }
    const cont = button("continue");
    if (cont !== undefined) {
      click(cont);
      continue;
    }
    break;
  }

  const svg = container.querySelector("svg.board");
  if (svg === null) throw new Error("no board");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "900");

  const css = `
    text { text-anchor: middle; dominant-baseline: central;
           font-family: ui-monospace, Menlo, monospace; }
    text.token { font-size: 0.3px; font-weight: 700; }
    text.pips { font-size: 0.13px; }
    text.port-label { font-size: 0.15px; font-weight: 700; fill: #1f4d6d; }
    text.port-resource { font-size: 0.12px; fill: #1f4d6d; }
    .node-target { fill: #fff; stroke: #b00020; stroke-width: 0.05; opacity: .85; }
    .edge-target { stroke: #b00020; stroke-width: 0.12; stroke-linecap: round; opacity: .55; }
  `;
  const out = svg.outerHTML.replace(
    "<title>",
    `<style>${css}</style><rect x="-99" y="-99" width="999" height="999" fill="#f5f4f0"/><title>`,
  );

  writeFileSync(`${OUT}/game-board.svg`, out);
  act(() => {
    root.unmount();
  });
  container.remove();
}, 120000);
