import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
// Self-hosted, OFL-licensed faces (see assets/FONTS.md). Bundled by Vite from
// node_modules, so nothing is fetched from a third party at runtime.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "./theme.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("No #root element to mount into.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
