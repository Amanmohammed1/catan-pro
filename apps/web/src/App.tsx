import { lazy, Suspense } from "react";
import { HotSeatGame } from "./game/HotSeatGame.js";
import { OnlineGame } from "./net/OnlineGame.js";
import { defaultServerUrl } from "./net/useConnection.js";

// Loaded on demand so its stylesheet never reaches the real game screens.
const DebugBoard = lazy(() =>
  import("./DebugBoard.js").then((module) => ({ default: module.DebugBoard })),
);

/**
 * Three screens, chosen by query string:
 *
 *   (default)   online play against a server
 *   ?hotseat=1  one screen, every seat — the M1 mode, kept for local testing
 *   ?debug=1    the M0 geometry renderer, as PLAN.md asks
 *
 * Hot-seat also takes `?players=`, `?seed=` and `?scenario=`. The last is how
 * a Seafarers board is reached without a server: `?hotseat=1&scenario=new-shores-4`.
 */
export function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);

  if (params.get("debug") === "1") {
    return (
      <Suspense fallback={null}>
        <DebugBoard />
      </Suspense>
    );
  }

  if (params.get("hotseat") === "1") {
    const players = Number(params.get("players") ?? "4");
    const scenario = params.get("scenario");
    return (
      <HotSeatGame
        seed={params.get("seed") ?? "hexport"}
        players={Number.isFinite(players) ? players : 4}
        scenarioId={scenario ?? undefined}
      />
    );
  }

  return <OnlineGame url={defaultServerUrl()} />;
}
