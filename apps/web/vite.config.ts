import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

/**
 * The client talks to the game server at /ws. In development Vite proxies that
 * to the separate server process; in production they are the same origin, so
 * the client needs no configuration either way.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: process.env["HEXPORT_SERVER"] ?? "ws://127.0.0.1:8787",
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ""),
      },
    },
  },
  build: {
    // three and the react tree are both large; splitting keeps the initial
    // parse down on a slow machine.
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("node_modules/three") ? "three" : undefined,
      },
    },
  },
});
