import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.{ts,tsx}"],
    // Whole-game integration runs play a match end to end over real sockets and
    // take about a minute. They are part of `pnpm verify` via `pnpm test:slow`,
    // just not of the fast lane people run while working.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/*.slow.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
    },
  },
});
