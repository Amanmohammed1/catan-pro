import { useEffect, useMemo, useState } from "react";
import { totalResources, type Action, type EdgeId, type NodeId, type TileId } from "@hexport/engine";
import { BoardCanvas } from "../three/BoardCanvas.js";
import { ActionBar, type BuildMode } from "../ui/ActionBar.js";
import { Announcer } from "../ui/Announcer.js";
import { Dice } from "../ui/Dice.js";
import { HandDock } from "../ui/HandDock.js";
import { LogPanel } from "../ui/LogPanel.js";
import { PlayerStrip } from "../ui/PlayerStrip.js";
import { PlacementList } from "../ui/PlacementList.js";
import { Button } from "../ui/Button.js";
import { describePrompt, playerNames, seatColors, type GameSession } from "./session.js";

/**
 * The game screen.
 *
 * Layout is three columns over a docked hand: players and log on the left, the
 * board filling the middle, the controls on the right where a right-handed
 * player's attention already is. The board is the largest thing on screen
 * because it is what the game is about; everything else is arranged around it
 * and stays out of its way.
 *
 * Every control is derived from `view.legalMoves` (CLAUDE.md golden rule 3).
 * Online, the server computes that list; hot-seat, the engine does locally.
 */
export function GameScreen({
  session,
}: {
  readonly session: GameSession;
}): React.JSX.Element {
  const { board, view, log, dispatch } = session;
  const [mode, setMode] = useState<BuildMode>("none");
  const [showStats, setShowStats] = useState(false);

  const names = useMemo(() => playerNames(view), [view]);
  const colors = useMemo(() => seatColors(view), [view]);
  const moves = view.legalMoves;
  const phase = view.phase;
  const yourTurn = view.currentPlayer === view.you;
  const waiting = moves.length > 0;

  // A build mode only makes sense inside the phase that offered it.
  useEffect(() => {
    setMode("none");
  }, [phase.k, view.currentPlayer]);

  // Drop a mode the moment it stops being possible, so the board never shows
  // highlights for something you can no longer afford.
  useEffect(() => {
    if (mode === "none") return;
    const stillPossible = moves.some(
      (m) =>
        (mode === "road" && m.t === "buildRoad") ||
        (mode === "settlement" && m.t === "buildSettlement") ||
        (mode === "city" && m.t === "buildCity"),
    );
    if (!stillPossible) setMode("none");
  }, [mode, moves]);

  const targets = useMemo(() => {
    const nodes = new Map<NodeId, Action>();
    const edges = new Map<EdgeId, Action>();
    const tiles = new Map<TileId, Action>();

    for (const move of moves) {
      switch (move.t) {
        case "setupSettlement":
          nodes.set(move.node, move);
          break;
        case "setupRoad":
          edges.set(move.edge, move);
          break;
        case "buildSettlement":
          if (mode === "settlement") nodes.set(move.node, move);
          break;
        case "buildCity":
          if (mode === "city") nodes.set(move.node, move);
          break;
        case "buildRoad":
          // Road Building hands out free roads without a mode to arm.
          if (mode === "road" || phase.k === "roadBuilding") {
            edges.set(move.edge, move);
          }
          break;
        case "moveRobber":
          tiles.set(move.tile, move);
          break;
        default:
          break;
      }
    }

    return { nodes, edges, tiles };
  }, [moves, mode, phase.k]);

  const nodeGhost: "settlement" | "city" = mode === "city" ? "city" : "settlement";
  const youColor = colors[view.you] ?? "#ffffff";
  const handSize = totalResources(view.self.resources);

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-2">
      <Announcer log={log} names={names} />

      <TopBar
        session={session}
        yourTurn={yourTurn}
        waiting={waiting}
        showStats={showStats}
        onToggleStats={() => { setShowStats((s) => !s); }}
      />

      <div className="grid min-h-0 grid-cols-[minmax(210px,240px)_minmax(0,1fr)_minmax(250px,300px)] gap-2">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
          <PlayerStrip view={view} />
          <LogPanel
            log={log}
            names={names}
            colors={colors}
            {...(session.chat === undefined ? {} : { chat: session.chat })}
            onChat={session.onChat}
          />
        </aside>

        <main className="relative min-h-0 overflow-hidden rounded-panel border border-surface-700 bg-surface-900 shadow-panel">
          <BoardCanvas
            board={board}
            roads={view.roads}
            buildings={view.buildings}
            robber={view.robber}
            colors={colors}
            nodeTargets={targets.nodes}
            edgeTargets={targets.edges}
            tileTargets={targets.tiles}
            nodeGhost={nodeGhost}
            onAction={(action) => {
              dispatch(action);
              setMode("none");
            }}
            youColor={youColor}
            showStats={showStats}
          />

          {view.winner !== null && <WinnerOverlay session={session} />}
        </main>

        <aside className="min-h-0 overflow-y-auto rounded-panel border border-surface-700 bg-surface-800/80 p-2.5 backdrop-blur">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {session.hotSeat
                ? names[view.currentPlayer]
                : yourTurn
                  ? "Your turn"
                  : names[view.currentPlayer]}
            </h2>
            <span className="text-[11px] text-ink-500">
              turn {view.turn}
            </span>
          </div>

          <p
            className={[
              "mb-2.5 rounded-card px-2.5 py-1.5 text-xs",
              waiting
                ? "bg-accent/15 text-accent"
                : "bg-surface-700/60 text-ink-500",
            ].join(" ")}
          >
            {describePrompt(view, view.you)}
          </p>

          <ActionBar
            view={view}
            mode={mode}
            onMode={setMode}
            onAction={(action) => {
              dispatch(action);
              setMode("none");
            }}
          />

          <PlacementList
            board={board}
            nodes={targets.nodes}
            edges={targets.edges}
            tiles={targets.tiles}
            onAction={(action) => {
              dispatch(action);
              setMode("none");
            }}
          />
        </aside>
      </div>

      <footer className="flex items-center justify-center rounded-panel border border-surface-700 bg-surface-800/80 px-3 py-2 backdrop-blur">
        <HandDock view={view} overLimit={handSize > 7} />
      </footer>

      {session.error !== null && (
        <ErrorToast message={session.error} onDismiss={session.dismissError} />
      )}
    </div>
  );
}

function TopBar({
  session,
  yourTurn,
  waiting,
  showStats,
  onToggleStats,
}: {
  readonly session: GameSession;
  readonly yourTurn: boolean;
  readonly waiting: boolean;
  readonly showStats: boolean;
  readonly onToggleStats: () => void;
}): React.JSX.Element {
  const { view } = session;

  return (
    <header className="flex items-center gap-3 rounded-panel border border-surface-700 bg-surface-800/80 px-3 py-2 backdrop-blur">
      <span className="font-display text-sm font-semibold tracking-tight">
        hexport
      </span>

      <span
        className={[
          "rounded-md px-2 py-1 text-[11px] font-medium",
          waiting
            ? "bg-accent/20 text-accent"
            : "bg-surface-700 text-ink-500",
        ].join(" ")}
      >
        {session.hotSeat
          ? `${view.players[view.currentPlayer]?.name ?? ""} to act`
          : yourTurn
            ? "Your move"
            : `${view.players[view.currentPlayer]?.name ?? ""} is thinking`}
      </span>

      <Dice values={view.dice} />

      {session.deadline != null && waiting && (
        <Countdown deadline={session.deadline} />
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleStats}
          aria-pressed={showStats}
          className="rounded-md px-2 py-1 text-[11px] text-ink-700 transition-colors hover:bg-surface-700 hover:text-ink-300"
        >
          {showStats ? "Hide stats" : "Stats"}
        </button>
      </div>
    </header>
  );
}

function Countdown({ deadline }: { readonly deadline: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => { setNow(Date.now()); }, 500);
    return () => { window.clearInterval(handle); };
  }, []);

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));

  return (
    <span
      className={[
        "rounded-md px-2 py-1 font-num text-[11px] tabular-nums",
        left <= 10 ? "bg-danger/20 text-danger" : "bg-surface-700 text-ink-500",
      ].join(" ")}
      title="Time left before your turn is passed automatically"
    >
      {left}s
    </span>
  );
}

function WinnerOverlay({
  session,
}: {
  readonly session: GameSession;
}): React.JSX.Element {
  const { view } = session;
  const winner = view.winner;
  if (winner === null) return <></>;

  const player = view.players[winner];
  const youWon = winner === view.you;

  return (
    <div className="absolute inset-0 grid place-items-center bg-surface-900/75 backdrop-blur-sm">
      <div className="w-[300px] rounded-panel border border-surface-600 bg-surface-800 p-5 text-center shadow-panel">
        <span
          aria-hidden="true"
          className="mx-auto mb-3 block h-2 w-16 rounded-full"
          style={{ background: player?.color }}
        />
        <h2 className="font-display text-xl font-semibold">
          {youWon ? "You win" : `${player?.name ?? "Someone"} wins`}
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          {player?.publicPoints ?? 0} points on the board, plus any hidden cards.
        </p>
      </div>
    </div>
  );
}

function ErrorToast({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, 6000);
    return () => { window.clearTimeout(handle); };
  }, [message, onDismiss]);

  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center"
    >
      <div className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-panel border border-danger/50 bg-surface-800 px-3.5 py-2.5 shadow-panel">
        <span className="text-xs text-ink-100">{message}</span>
        <Button size="sm" intent="ghost" className="w-auto" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
