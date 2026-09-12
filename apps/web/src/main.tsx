import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameView } from "./game/GameView.js";
import { DebugBoard } from "./DebugBoard.js";
import "./styles.css";

/**
 * The game is the app. The M0 geometry renderer stays reachable at ?debug=1,
 * as PLAN.md asks, and survives into M3 the same way when the 3D client lands.
 */
const debug = new URLSearchParams(window.location.search).get("debug") === "1";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("No #root element to mount into.");
}

createRoot(container).render(
  <StrictMode>{debug ? <DebugBoard /> : <GameView />}</StrictMode>,
);
