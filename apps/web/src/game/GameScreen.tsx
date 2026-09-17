import { useEffect, useMemo, useState } from "react";
import {
  totalResources,
  type Action,
  type EdgeId,
  type NodeId,
  type TileId,
} from "@hexport/engine";
import { BoardCanvas } from "../three/BoardCanvas.js";
import { ActionBar, type BuildMode } from "../ui/ActionBar.js";
import { Announcer } from "../ui/Announcer.js";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";
import { Confetti } from "../ui/Confetti.js";
import { Dice } from "../ui/Dice.js";
import { HandDock } from "../ui/HandDock.js";
import { LogPanel } from "../ui/LogPanel.js";
import { PlacementList } from "../ui/PlacementList.js";
import { PlayerStrip } from "../ui/PlayerStrip.js";
import { Wordmark } from "../ui/Wordmark.js";
import { useUi } from "../store/ui.js";
import {
  describePrompt,
  playerNames,
  seatColors,
  type GameSession,
} from "./session.js";

/**
 * The game screen.
 *
 * The board is the largest thing on screen because it is what the game is
 * about; everything else is arranged around it and stays out of its way.
 * Players and the log sit on the left, the controls on the right where a
 * right-handed player's attention already is, and the hand along the bottom.
 * Below 900px the same pieces stack into one scrolling column.
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
  const showStats = useUi((s) => s.showStats);

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

  useShortcuts({ moves, dispatch, mode, setMode });

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
  const actingSeat = waiting ? view.you : view.currentPlayer;

  return (
    <div className="flex min-h-screen flex-col gap-2 p-2 tab:h-screen tab:min-h-0">
      <Announcer log={log} names={names} />

      <TopBar session={session} yourTurn={yourTurn} waiting={waiting} />

      <div
        className={[
          "flex min-h-0 flex-1 flex-col gap-2",
          "tab:grid tab:grid-cols-[minmax(210px,240px)_minmax(0,1fr)_minmax(272px,300px)]",
          "tab:grid-rows-[minmax(0,1.4fr)_minmax(0,1fr)]",
          "tab:[grid-template-areas:'players_board_actions''players_board_log']",
          "xl:grid-cols-[286px_minmax(0,1fr)_330px] xl:grid-rows-[auto_minmax(0,1fr)]",
          "xl:[grid-template-areas:'players_board_actions''log_board_actions']",
        ].join(" ")}
      >
        <aside className="tab:[grid-area:players] tab:min-h-0 tab:overflow-y-auto tab:pr-0.5">
          <PlayerStrip view={view} />
        </aside>

        <main className="relative h-[56vh] min-h-[320px] overflow-hidden rounded-panel border border-gold/20 bg-surface-900 shadow-panel tab:h-auto tab:min-h-0 tab:[grid-area:board]">
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

          <PromptBanner
            phase={phase.k}
            // Waiting on someone else still says what the table is waiting
            // for, not just who: "Ana · Place settlement 1 of 2" tells you how
            // long you are likely to be waiting.
            text={
              waiting || session.hotSeat
                ? describePrompt(view, view.you)
                : `${names[view.currentPlayer] ?? "Someone"} · ${describePrompt(view, view.you)}`
            }
            seat={actingSeat}
            color={colors[actingSeat] ?? "#ffffff"}
            live={waiting}
          />

          {view.winner !== null && <WinnerOverlay session={session} />}
        </main>

        <aside
          data-panel="actions"
          aria-label="Your controls"
          className="panel min-h-0 overflow-y-auto p-3 tab:[grid-area:actions]"
        >
          <h2 className="mb-2.5 flex items-center gap-2 font-display text-[15px] font-semibold">
            <Avatar
              seat={view.currentPlayer}
              color={colors[view.currentPlayer] ?? "#888"}
              size={24}
            />
            {session.hotSeat
              ? names[view.currentPlayer]
              : yourTurn
                ? "Your turn"
                : names[view.currentPlayer]}
          </h2>

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

        <div className="min-h-[220px] tab:[grid-area:log] tab:min-h-0">
          <LogPanel
            log={log}
            names={names}
            colors={colors}
            {...(session.chat === undefined ? {} : { chat: session.chat })}
            onChat={session.onChat}
          />
        </div>
      </div>

      <footer className="panel shrink-0">
        <HandDock view={view} overLimit={handSize > 7} />
      </footer>

      {session.error !== null && (
        <ErrorToast message={session.error} onDismiss={session.dismissError} />
      )}
    </div>
  );
}

/**
 * Keyboard shortcuts for the moves a player makes every turn.
 *
 * Only ever dispatches a move that is already in `legalMoves`, so a shortcut
 * can do nothing the mouse could not (golden rule 3).
 */
function useShortcuts({
  moves,
  dispatch,
  mode,
  setMode,
}: {
  readonly moves: readonly Action[];
  readonly dispatch: (action: Action) => void;
  readonly mode: BuildMode;
  readonly setMode: (mode: BuildMode) => void;
}): void {
  const toggleListView = useUi((s) => s.toggleListView);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const find = (t: Action["t"]): Action | undefined => moves.find((m) => m.t === t);
      const arm = (next: BuildMode, kind: Action["t"]): void => {
        if (!moves.some((m) => m.t === kind)) return;
        setMode(mode === next ? "none" : next);
        event.preventDefault();
      };

      switch (event.key.toLowerCase()) {
        case "r": {
          const roll = find("rollDice");
          if (roll !== undefined) {
            dispatch(roll);
            event.preventDefault();
          }
          break;
        }
        case "e": {
          const end = find("endTurn");
          if (end !== undefined) {
            dispatch(end);
            event.preventDefault();
          }
          break;
        }
        case "q":
          arm("road", "buildRoad");
          break;
        case "s":
          arm("settlement", "buildSettlement");
          break;
        case "c":
          arm("city", "buildCity");
          break;
        case "l":
          toggleListView();
          event.preventDefault();
          break;
        case "escape":
          setMode("none");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [moves, dispatch, mode, setMode, toggleListView]);
}

function TopBar({
  session,
  yourTurn,
  waiting,
}: {
  readonly session: GameSession;
  readonly yourTurn: boolean;
  readonly waiting: boolean;
}): React.JSX.Element {
  const { view } = session;
  const listView = useUi((s) => s.listView);
  const toggleListView = useUi((s) => s.toggleListView);
  const showStats = useUi((s) => s.showStats);
  const toggleStats = useUi((s) => s.toggleStats);
  const effects = useUi((s) => s.effects);
  const setEffects = useUi((s) => s.setEffects);
  const current = view.players[view.currentPlayer];

  return (
    <header className="panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <Wordmark />

      <span
        className={[
          "flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
          waiting ? "bg-gold/20 text-gold" : "bg-surface-700 text-ink-300",
        ].join(" ")}
      >
        <Avatar seat={view.currentPlayer} color={current?.color ?? "#888"} size={20} />
        {session.hotSeat
          ? `${current?.name ?? ""} to act`
          : yourTurn
            ? "Your move"
            : `${current?.name ?? ""} is thinking`}
      </span>

      <span className="text-xs text-ink-500 tabular-nums">turn {view.turn}</span>

      <Dice values={view.dice} />

      {session.deadline != null && waiting && <Countdown deadline={session.deadline} />}

      <div className="ml-auto flex items-center gap-1">
        <Toggle pressed={listView} onClick={toggleListView} title="List every legal move (L)">
          List
        </Toggle>
        <Toggle
          pressed={effects === "auto"}
          onClick={() => {
            setEffects(effects === "auto" ? "off" : "auto");
          }}
          title="Bloom and vignette on the board"
        >
          Effects
        </Toggle>
        <Toggle pressed={showStats} onClick={toggleStats} title="Frame rate and draw calls">
          Stats
        </Toggle>
      </div>
    </header>
  );
}

function Toggle({
  pressed,
  onClick,
  title,
  children,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={[
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        pressed
          ? "bg-gold/20 text-gold"
          : "text-ink-700 hover:bg-surface-700 hover:text-ink-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * What the game is waiting for, over the board.
 *
 * Carries `data-prompt`, which is how the tests and the driver know the phase —
 * a data attribute, never a class name (CLAUDE.md, Conventions).
 */
function PromptBanner({
  phase,
  text,
  seat,
  color,
  live,
}: {
  readonly phase: string;
  readonly text: string;
  readonly seat: number;
  readonly color: string;
  readonly live: boolean;
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
      <p
        data-prompt={phase}
        className={[
          "flex animate-[banner-in_0.35s_var(--ease-out-soft)] items-center gap-2.5 rounded-full border px-4 py-2 backdrop-blur",
          "font-display text-[15px] font-semibold shadow-panel",
          live
            ? "border-gold/50 bg-surface-800/90 text-ink-100"
            : "border-gold/15 bg-surface-800/75 text-ink-500",
        ].join(" ")}
      >
        <Avatar seat={seat} color={color} size={22} />
        {text}
      </p>
    </div>
  );
}

function Countdown({ deadline }: { readonly deadline: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));

  return (
    <span
      className={[
        "rounded-full px-2.5 py-1 font-num text-xs font-semibold tabular-nums",
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
  const standings = [...view.players].sort((a, b) => b.publicPoints - a.publicPoints);

  return (
    <div
      data-winner={winner}
      role="status"
      className="absolute inset-0 z-20 grid place-items-center bg-surface-900/75 backdrop-blur-sm"
    >
      <Confetti colors={view.players.map((p) => p.color)} />

      <div className="panel relative w-[min(92%,380px)] animate-[rise-in_0.5s_var(--ease-out-soft)] p-6 text-center">
        <span className="mx-auto mb-3 block w-fit">
          <Avatar seat={winner} color={player?.color ?? "#888"} size={56} ring />
        </span>
        <p className="eyebrow">Victory</p>
        <h2 className="font-display text-[30px] leading-tight font-bold text-ink-100">
          {youWon ? "You win!" : `${player?.name ?? "Someone"} wins`}
        </h2>

        <ol className="mt-4 flex flex-col gap-1 text-left">
          {standings.map((seat) => (
            <li
              key={seat.id}
              className={[
                "flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5",
                seat.id === winner ? "bg-gold/15" : "bg-surface-700/50",
              ].join(" ")}
            >
              <Avatar seat={seat.id} color={seat.color} size={24} />
              <span className="flex-1 truncate text-sm text-ink-100">{seat.name}</span>
              <span className="font-num text-base font-bold text-gold tabular-nums">
                {seat.publicPoints}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-3 text-xs text-ink-500">
          Points on the board. Hidden victory cards count too.
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
    return () => {
      window.clearTimeout(handle);
    };
  }, [message, onDismiss]);

  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-3"
    >
      <div className="panel pointer-events-auto flex max-w-sm items-center gap-3 border-danger/50! px-3.5 py-2.5">
        <span className="text-xs text-ink-100">{message}</span>
        <Button size="sm" intent="ghost" className="w-auto" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
