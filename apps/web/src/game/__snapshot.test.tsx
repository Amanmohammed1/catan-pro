// @vitest-environment jsdom
import { vi } from "vitest";

// jsdom has no WebGL; see stubCanvas for why this is the right split.
vi.mock("../three/BoardCanvas.js", () => ({ BoardCanvas: () => null }));

import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { act } from "react";
import { completeSetupInUi, drive, mountGame, text } from "./uiDriver.js";

/**
 * Dev tool, not a test. Renders the board to an SVG file so a change to the
 * renderer can be looked at rather than only asserted on:
 *
 *   HEXPORT_SNAPSHOT_DIR=/tmp pnpm exec vitest run apps/web/src/game/__snapshot.test.tsx
 *
 * With the variable unset it returns immediately, so normal runs pay nothing.
 */

const OUT = process.env["HEXPORT_SNAPSHOT_DIR"] ?? "";

it("dumps the board svg for visual review", () => {
  if (OUT === "") return;

  const { el, root } = mountGame("shot", 4);
  completeSetupInUi(el);

  // Play a while so the board has roads, settlements and a city on it.
  for (let step = 0; step < 4000; step++) {
    if (text(el).includes("wins")) break;
    if (!drive(el)) break;
  }

  const svg = el.querySelector("svg.board");
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
  el.remove();
}, 120000);
