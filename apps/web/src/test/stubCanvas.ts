import { vi } from "vitest";

/**
 * Replace the 3D board in DOM tests.
 *
 * jsdom has no WebGL, so the real canvas cannot mount. That is not a gap in
 * coverage so much as a division of it: the board's maths is unit tested in
 * `three/layout3d.test.ts` against the engine's own geometry, the component
 * itself is covered by typecheck and the production build, and what these DOM
 * tests care about is that every move is reachable *without* the canvas — which
 * is exactly the path a keyboard or screen-reader player takes.
 */
export function stubBoardCanvas(): void {
  vi.mock("../three/BoardCanvas.js", () => ({
    BoardCanvas: () => null,
  }));
}
