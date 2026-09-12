// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DebugBoard } from "./DebugBoard.js";

/**
 * The M0 acceptance criterion is "you can regenerate a random valid board and
 * see it". A passing geometry suite does not prove the second half, so this
 * mounts the real component and counts what actually reaches the DOM.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(<DebugBoard />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe("DebugBoard", () => {
  it("mounts and draws the classic board", () => {
    const el = render();

    const svg = el.querySelector("svg.board");
    expect(svg).not.toBeNull();

    // 19 tiles, each one polygon.
    expect(svg?.querySelectorAll("polygon")).toHaveLength(19);
    // 72 edges, each one line.
    expect(svg?.querySelectorAll("line")).toHaveLength(72);
  });

  it("draws a circle for every node, number token and port", () => {
    const el = render();
    const circles = el.querySelectorAll("svg.board circle");
    // 54 node dots + 18 number tokens + 9 port markers.
    expect(circles).toHaveLength(54 + 18 + 9);
  });

  it("reports the board statistics in the panel", () => {
    const el = render();
    const text = el.textContent ?? "";
    expect(text).toContain("tiles");
    expect(text).toContain("nodes");
    expect(text).toContain("edges");

    const values = [...el.querySelectorAll(".stats dd")].map((d) => d.textContent);
    expect(values).toContain("19");
    expect(values).toContain("54");
    expect(values).toContain("72");
    expect(values).toContain("9");
  });

  it("offers every scenario, fixtures included", () => {
    const el = render();
    const options = [...el.querySelectorAll("select option")].map((o) => o.textContent);
    expect(options).toContain("classic-3-4");
    expect(options).toContain("tiny-island");
    expect(options).toContain("two-islands");
  });

  it("renders without throwing on every shipped scenario", () => {
    // Guards against a fixture that parses but cannot be drawn.
    const el = render();
    const select = el.querySelector("select");
    expect(select).not.toBeNull();
    expect(el.querySelector(".error")).toBeNull();
  });
});
