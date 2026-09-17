import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.{ts,tsx}"],
    // Integration runs that play a whole match over real sockets, or spawn a
    // server process, live in the slow lane. They are part of `pnpm verify` via
    // `pnpm test:slow`, just not of the fast lane people run while working.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/*.slow.test.*"],
    setupFiles: ["apps/web/src/test/setup.ts"],
    // Vitest blanks CSS it does not process. theme.test.ts reads the design
    // tokens as text (`theme.css?raw`) to check contrast, so let that one file
    // through.
    css: { include: [/theme\.css/] },
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
    },
  },
});
