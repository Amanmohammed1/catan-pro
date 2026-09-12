import { defineConfig } from "vitest/config";

/**
 * The slow lane: whole-game integration runs that play a match end to end over
 * real sockets. Kept out of `pnpm test` so the fast lane stays usable while
 * working, and run by `pnpm test:slow` and `pnpm verify`.
 */
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.slow.test.{ts,tsx}"],
    testTimeout: 180000,
    hookTimeout: 60000,
  },
});
