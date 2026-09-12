import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The client talks to the game server at /ws. In development Vite proxies that
 * to the separate server process; in production they are the same origin, so
 * the client needs no configuration either way.
 */
export default defineConfig({
  plugins: [react()],
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
});
