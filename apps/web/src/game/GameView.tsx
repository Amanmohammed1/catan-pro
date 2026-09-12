import { useMemo, useState } from "react";
import {
  RESOURCE_KINDS,
  canOfferTrade,
  emptyResources,
  portRatesFor,
  publicVictoryPoints,
  totalResources,
  victoryPoints,
  type Action,
  type EdgeId,
  type GameState,
  type NodeId,
  type PlayerId,
  type ResourceCounts,
  type TileId,
} from "@hexport/engine";
import { BoardView } from "./BoardView.js";
import { describeEvent } from "./describeEvent.js";
import { useGame } from "./useGame.js";

/**
 * Hot-seat game screen.
 *
 * Every enabled control below is derived from legalMoves(); nothing here decides
 * whether a move is allowed (CLAUDE.md golden rule 3). If a button is missing,
 * the engine says the move is illegal, and that is the bug to fix.
 */

type BuildMode = "none" | "road" | "settlement" | "city";

export function GameView(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const initialSeed = params.get("seed") ?? "hexport";
  const initialPlayers = Number(params.get("players") ?? "4");

  const game = useGame({
    seed: initialSeed,
    players: Number.isFinite(initialPlayers) ? initialPlayers : 4,
  });
  const { state, moves, activePlayer, dispatch } = game;

  const [mode, setMode] = useState<BuildMode>("none");
  const [showIds, setShowIds] = useState(false);
  const [discard, setDiscard] = useState<ResourceCounts>(emptyResources());

  const phase = state.phase;

  /** Legal targets, grouped by what the player would be clicking. */
  const targets = useMemo(() => {
    const nodes = new Map<NodeId, Action>();
    const edges = new Map<EdgeId, Action>();
    const tiles = new Map<TileId, Action>();

    for (const move of moves) {
      switch (move.t) {
        case "setupSettlement":
        case "buildSettlement":
          nodes.set(move.node, move);
          break;
        case "buildCity":
          nodes.set(move.node, move);
          break;
        case "setupRoad":
        case "buildRoad":
          edges.set(move.edge, move);
          break;
        case "moveRobber":
          tiles.set(move.tile, move);
          break;
        default:
          break;
      }
    }
    return { nodes, edges, tiles };
  }, [moves]);

  /** Which of those the board should actually highlight right now. */
  const active = useMemo(() => {
    const emptyNodes = new Set<NodeId>();
    const emptyEdges = new Set<EdgeId>();
    const emptyTiles = new Set<TileId>();

    if (phase.k === "setup") {
      return phase.sub === "settlement"
        ? { nodes: new Set(targets.nodes.keys()), edges: emptyEdges, tiles: emptyTiles }
        : {
            nodes: emptyNodes,
            edges: new Set(targets.edges.keys()),
            tiles: emptyTiles,
          };
    }

    if (phase.k === "moveRobber") {
      return {
        nodes: emptyNodes,
        edges: emptyEdges,
        tiles: new Set(targets.tiles.keys()),
      };
    }

    if (phase.k === "roadBuilding") {
      return {
        nodes: emptyNodes,
        edges: new Set(targets.edges.keys()),
        tiles: emptyTiles,
      };
    }

    switch (mode) {
      case "road":
        return {
          nodes: emptyNodes,
          edges: new Set(targets.edges.keys()),
          tiles: emptyTiles,
        };
      case "settlement":
        return {
          nodes: new Set(
            moves
              .filter((m) => m.t === "buildSettlement")
              .map((m) => (m.t === "buildSettlement" ? m.node : "")),
          ),
          edges: emptyEdges,
          tiles: emptyTiles,
        };
      case "city":
        return {
          nodes: new Set(
            moves
              .filter((m) => m.t === "buildCity")
              .map((m) => (m.t === "buildCity" ? m.node : "")),
          ),
          edges: emptyEdges,
          tiles: emptyTiles,
        };
      default:
        return { nodes: emptyNodes, edges: emptyEdges, tiles: emptyTiles };
    }
  }, [phase, mode, targets, moves]);

  const play = (action: Action | undefined): void => {
    if (action === undefined) return;
    dispatch(action);
    setMode("none");
  };

  const has = (kind: Action["t"]): boolean => moves.some((m) => m.t === kind);
  const find = (kind: Action["t"]): Action | undefined =>
    moves.find((m) => m.t === kind);

  const seat = state.players[activePlayer];
  const prompt = describePrompt(state, activePlayer);

  return (
    <div className="game-root">
      <aside className="side left">
        <h1>hexport</h1>
        <p className="sub">Hot-seat. Base game rules.</p>

        <div className="players">
          {state.players.map((p) => {
            const isTurn = p.id === state.currentPlayer;
            const waiting = game.waitingOn.includes(p.id);
            return (
              <div
                key={p.id}
                className={`player${isTurn ? " turn" : ""}${waiting ? " waiting" : ""}`}
              >
                <span className="swatch" style={{ background: p.color }} />
                <span className="pname">{p.name}</span>
                <span className="pstat">{publicVictoryPoints(state, p.id)} vp</span>
                <span className="pstat dim">{totalResources(p.resources)} cards</span>
                <span className="pstat dim">
                  {p.devCards.filter((c) => !c.played).length} dev
                </span>
                {state.longestRoad.player === p.id && (
                  <span className="badge">road</span>
                )}
                {state.largestArmy.player === p.id && (
                  <span className="badge">army</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="log">
          {game.log
            .slice(-60)
            .reverse()
            .map((entry) => {
              const text = describeEvent(entry.event, state);
              if (text === "") return null;
              return (
                <div key={entry.id} className="log-line">
                  {text}
                </div>
              );
            })}
        </div>
      </aside>

      <main className="stage">
        <BoardView
          state={state}
          highlightNodes={active.nodes}
          highlightEdges={active.edges}
          highlightTiles={active.tiles}
          onNode={(node) => {
            play(targets.nodes.get(node));
          }}
          onEdge={(edge) => {
            play(targets.edges.get(edge));
          }}
          onTile={(tile) => {
            play(targets.tiles.get(tile));
          }}
          showIds={showIds}
        />
      </main>

      <aside className="side right">
        {state.winner !== null ? (
          <div className="winner">
            <h2>{state.players[state.winner]?.name} wins</h2>
            <p>{victoryPoints(state, state.winner)} victory points</p>
            <button
              onClick={() => {
                game.reset(
                  `${initialSeed}-${String(Date.now())}`,
                  state.players.length,
                );
              }}
            >
              New game
            </button>
          </div>
        ) : (
          <>
            <div className="turn-banner" style={{ borderColor: seat?.color }}>
              <strong>{seat?.name}</strong>
              <span>{prompt}</span>
              {state.dice !== null && (
                <span className="dice">
                  {state.dice[0]} + {state.dice[1]} = {state.dice[0] + state.dice[1]}
                </span>
              )}
            </div>

            {seat !== undefined && (
              <div className="hand">
                {RESOURCE_KINDS.map((kind) => (
                  <div key={kind} className={`card ${kind}`}>
                    <span className="kind">{kind}</span>
                    <span className="count">{seat.resources[kind]}</span>
                  </div>
                ))}
              </div>
            )}

            {phase.k === "discard" && seat !== undefined && (
              <DiscardPanel
                hand={seat.resources}
                selection={discard}
                required={Math.floor(totalResources(seat.resources) / 2)}
                onChange={setDiscard}
                onConfirm={() => {
                  dispatch({ t: "discard", player: activePlayer, resources: discard });
                  setDiscard(emptyResources());
                }}
              />
            )}

            {phase.k === "steal" && (
              <div className="actions">
                <h3>Steal from</h3>
                {phase.targets.length === 0 ? (
                  <button onClick={() => play(find("steal"))}>
                    No one to rob — continue
                  </button>
                ) : (
                  phase.targets.map((target) => (
                    <button
                      key={target}
                      onClick={() => {
                        dispatch({ t: "steal", player: activePlayer, target });
                      }}
                    >
                      {state.players[target]?.name}
                      {" ("}
                      {totalResources(
                        state.players[target]?.resources ?? emptyResources(),
                      )}
                      {" cards)"}
                    </button>
                  ))
                )}
              </div>
            )}

            {phase.k === "tradeOffer" && (
              <TradePanel state={state} moves={moves} onAction={play} />
            )}

            {phase.k === "roll" && (
              <div className="actions">
                <button className="primary" onClick={() => play(find("rollDice"))}>
                  Roll dice
                </button>
                <DevCardButtons moves={moves} onAction={play} />
              </div>
            )}

            {phase.k === "main" && (
              <div className="actions">
                <h3>Build</h3>
                <button
                  disabled={!has("buildRoad")}
                  className={mode === "road" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "road" ? "none" : "road");
                  }}
                >
                  Road <span className="cost">1 brick 1 lumber</span>
                </button>
                <button
                  disabled={!has("buildSettlement")}
                  className={mode === "settlement" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "settlement" ? "none" : "settlement");
                  }}
                >
                  Settlement{" "}
                  <span className="cost">1 brick 1 lumber 1 wool 1 grain</span>
                </button>
                <button
                  disabled={!has("buildCity")}
                  className={mode === "city" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "city" ? "none" : "city");
                  }}
                >
                  City <span className="cost">3 ore 2 grain</span>
                </button>
                <button
                  disabled={!has("buyDevCard")}
                  onClick={() => play(find("buyDevCard"))}
                >
                  Development card <span className="cost">1 ore 1 wool 1 grain</span>
                </button>

                <DevCardButtons moves={moves} onAction={play} />

                <BankTradePanel state={state} moves={moves} onAction={play} />

                {canOfferTrade(state, activePlayer) && (
                  <OfferTradePanel activePlayer={activePlayer} onAction={play} />
                )}

                <button className="primary end" onClick={() => play(find("endTurn"))}>
                  End turn
                </button>
              </div>
            )}

            {phase.k === "roadBuilding" && (
              <div className="actions">
                <h3>Road Building</h3>
                <p className="hint">
                  Place {phase.remaining} free road{phase.remaining === 1 ? "" : "s"}.
                </p>
                {!has("buildRoad") && (
                  <button onClick={() => play(find("endRoadBuilding"))}>
                    Nowhere to build — continue
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={showIds}
            onChange={(e) => {
              setShowIds(e.target.checked);
            }}
          />
          Show ids
        </label>

        {game.error !== null && (
          <div className="error" onClick={game.dismissError}>
            {game.error}
          </div>
        )}
      </aside>
    </div>
  );
}

function describePrompt(state: GameState, player: PlayerId): string {
  switch (state.phase.k) {
    case "setup":
      return state.phase.sub === "settlement"
        ? `Place settlement ${String(state.phase.round)} of 2`
        : "Place an adjoining road";
    case "roll":
      return "Roll the dice";
    case "discard":
      return "Discard half your hand";
    case "moveRobber":
      return "Move the robber";
    case "steal":
      return "Choose someone to rob";
    case "main":
      return "Trade and build";
    case "roadBuilding":
      return "Place your free roads";
    case "tradeOffer":
      return state.phase.offer.from === player
        ? "Waiting for answers"
        : "Answer the trade offer";
    case "gameOver":
      return "Game over";
    default:
      return "";
  }
}

function DevCardButtons({
  moves,
  onAction,
}: {
  readonly moves: readonly Action[];
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element | null {
  const knight = moves.find((m) => m.t === "playKnight");
  const roads = moves.find((m) => m.t === "playRoadBuilding");
  const plenty = moves.filter((m) => m.t === "playYearOfPlenty");
  const monopoly = moves.filter((m) => m.t === "playMonopoly");

  if (
    knight === undefined &&
    roads === undefined &&
    plenty.length === 0 &&
    monopoly.length === 0
  ) {
    return null;
  }

  return (
    <>
      <h3>Development cards</h3>
      {knight !== undefined && <button onClick={() => onAction(knight)}>Knight</button>}
      {roads !== undefined && (
        <button onClick={() => onAction(roads)}>Road Building</button>
      )}
      {plenty.length > 0 && (
        <details>
          <summary>Year of Plenty</summary>
          <div className="grid">
            {plenty.map((m) =>
              m.t === "playYearOfPlenty" ? (
                <button key={m.resources.join()} onClick={() => onAction(m)}>
                  {m.resources.join(" + ")}
                </button>
              ) : null,
            )}
          </div>
        </details>
      )}
      {monopoly.length > 0 && (
        <details>
          <summary>Monopoly</summary>
          <div className="grid">
            {monopoly.map((m) =>
              m.t === "playMonopoly" ? (
                <button key={m.resource} onClick={() => onAction(m)}>
                  {m.resource}
                </button>
              ) : null,
            )}
          </div>
        </details>
      )}
    </>
  );
}

function BankTradePanel({
  state,
  moves,
  onAction,
}: {
  readonly state: GameState;
  readonly moves: readonly Action[];
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element | null {
  const trades = moves.filter((m) => m.t === "bankTrade");
  if (trades.length === 0) return null;

  const rates = portRatesFor(state, state.currentPlayer);

  return (
    <details className="trade">
      <summary>Bank / harbor trade</summary>
      <div className="rates">
        {RESOURCE_KINDS.map((kind) => (
          <span key={kind}>
            {kind} {rates[kind]}:1
          </span>
        ))}
      </div>
      <div className="grid">
        {trades.map((m) =>
          m.t === "bankTrade" ? (
            <button key={`${m.give}-${m.receive}`} onClick={() => onAction(m)}>
              {m.rate} {m.give} → 1 {m.receive}
            </button>
          ) : null,
        )}
      </div>
    </details>
  );
}

function OfferTradePanel({
  activePlayer,
  onAction,
}: {
  readonly activePlayer: PlayerId;
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element {
  const [give, setGive] = useState<ResourceCounts>(emptyResources());
  const [receive, setReceive] = useState<ResourceCounts>(emptyResources());

  return (
    <details className="trade">
      <summary>Offer a trade</summary>
      <ResourcePicker label="You give" value={give} onChange={setGive} />
      <ResourcePicker label="You want" value={receive} onChange={setReceive} />
      <button
        disabled={totalResources(give) === 0 || totalResources(receive) === 0}
        onClick={() => {
          onAction({ t: "offerTrade", player: activePlayer, give, receive });
          setGive(emptyResources());
          setReceive(emptyResources());
        }}
      >
        Offer
      </button>
    </details>
  );
}

function TradePanel({
  state,
  moves,
  onAction,
}: {
  readonly state: GameState;
  readonly moves: readonly Action[];
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element {
  if (state.phase.k !== "tradeOffer") return <></>;
  const offer = state.phase.offer;

  return (
    <div className="actions">
      <h3>Trade offer</h3>
      <p className="hint">
        {state.players[offer.from]?.name} gives {summarise(offer.give)} for{" "}
        {summarise(offer.receive)}
      </p>

      {moves.map((m, i) => {
        if (m.t === "respondTrade") {
          return (
            <button key={`r${String(i)}`} onClick={() => onAction(m)}>
              {m.accept ? "Accept" : "Decline"}
            </button>
          );
        }
        if (m.t === "confirmTrade") {
          return (
            <button key={`c${String(i)}`} onClick={() => onAction(m)}>
              Trade with {state.players[m.with]?.name}
            </button>
          );
        }
        if (m.t === "cancelTrade") {
          return (
            <button key={`x${String(i)}`} onClick={() => onAction(m)}>
              Cancel offer
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}

function ResourcePicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: ResourceCounts;
  readonly onChange: (next: ResourceCounts) => void;
}): React.JSX.Element {
  return (
    <div className="picker">
      <span className="picker-label">{label}</span>
      {RESOURCE_KINDS.map((kind) => (
        <div key={kind} className="picker-row">
          <span>{kind}</span>
          <button
            onClick={() => {
              onChange({ ...value, [kind]: Math.max(0, value[kind] - 1) });
            }}
          >
            −
          </button>
          <span className="num">{value[kind]}</span>
          <button
            onClick={() => {
              onChange({ ...value, [kind]: value[kind] + 1 });
            }}
          >
            +
          </button>
        </div>
      ))}
    </div>
  );
}

function DiscardPanel({
  hand,
  selection,
  required,
  onChange,
  onConfirm,
}: {
  readonly hand: ResourceCounts;
  readonly selection: ResourceCounts;
  readonly required: number;
  readonly onChange: (next: ResourceCounts) => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const chosen = totalResources(selection);

  return (
    <div className="actions">
      <h3>Discard {required}</h3>
      <p className="hint">
        Selected {chosen} of {required}
      </p>
      {RESOURCE_KINDS.map((kind) => (
        <div key={kind} className="picker-row">
          <span>
            {kind} ({hand[kind]})
          </span>
          <button
            disabled={selection[kind] <= 0}
            onClick={() => {
              onChange({ ...selection, [kind]: selection[kind] - 1 });
            }}
          >
            −
          </button>
          <span className="num">{selection[kind]}</span>
          <button
            disabled={selection[kind] >= hand[kind] || chosen >= required}
            onClick={() => {
              onChange({ ...selection, [kind]: selection[kind] + 1 });
            }}
          >
            +
          </button>
        </div>
      ))}
      <button className="primary" disabled={chosen !== required} onClick={onConfirm}>
        Discard
      </button>
    </div>
  );
}

function summarise(counts: ResourceCounts): string {
  const parts = RESOURCE_KINDS.filter((k) => counts[k] > 0).map(
    (k) => `${String(counts[k])} ${k}`,
  );
  return parts.length === 0 ? "nothing" : parts.join(", ");
}
