import { vi } from "vitest";

/**
 * Test environment shims.
 *
 * Runs for every test file, including the ones in the plain node environment,
 * so everything here checks for a DOM before touching one.
 */

// React 19 refuses to run act() unless the environment opts in.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hasDom = typeof window !== "undefined";

/**
 * jsdom implements the DOM, not a browser's rendering. ResizeObserver is used by
 * react-three-fiber to size its canvas and simply does not exist there.
 */
if (hasDom && !("ResizeObserver" in globalThis)) {
  class StubResizeObserver implements ResizeObserver {
    public observe(): void {
      /* nothing to measure without layout */
    }
    public unobserve(): void {
      /* nothing to measure without layout */
    }
    public disconnect(): void {
      /* nothing to measure without layout */
    }
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StubResizeObserver;
}

if (hasDom && !("matchMedia" in window)) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }),
  });
}
