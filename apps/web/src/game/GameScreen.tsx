import { useEffect, useMemo, useState } from "react";
import {
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Action,
  type EdgeId,
  type NodeId,
  type PlayerId,
  type ResourceCounts,
  type TileId,
} from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { BoardView } from "./BoardView.js";
import { describeEvent } from "./describeEvent.js";
import {
  canOffer,
  describePrompt,
  playerNames,
  portRates,
  seatColors,
  type GameSession,
} from "./session.js";

/**
 * The game screen.
 *
 * Every control is derived from `view.legalMoves`. Nothing here decides whether
 * a move is allowed (CLAUDE.md golden rule 3) — online, the list is computed by
 * the server; hot-seat, by the engine locally. If a button is missing, the rules
 * say the move is illegal, and that is the bug to fix.
 */

type BuildMode = "none" | "road" | "settlement" | "city";

export function GameScreen({
  session,
}: {
  readonly session: GameSession;
}): React.JSX.Element {
  const { board, view, log, dispatch } = session;
  const [mode, setMode] = useState<BuildMode>("none");
  const [discard, setDiscard] = useState<ResourceCounts>(emptyResources());
  const [showIds, setShowIds] = useState(false);

  const names = useMemo(() => playerNames(view), [view]);
  const colors = useMemo(() => seatColors(view), [view]);
  const moves = view.legalMoves;
  const phase = view.phase;

  // A build mode is meaningless once the phase moves on.
  useEffect(() => {
    setMode("none");
  }, [phase.k, view.currentPlayer]);

  const targets = useMemo(() => {
    const nodes = new Map<NodeId, Action>();
    const edges = new Map<EdgeId, Action>();
    const tiles = new Map<TileId, Action>();

    for (const move of moves) {
      switch (move.t) {
        case "setupSettlement":
        case "buildSettlement":
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

  const active = useMemo(() => {
    const none = {
      nodes: new Set<NodeId>(),
      edges: new Set<EdgeId>(),
      tiles: new Set<TileId>(),
    };

    if (phase.k === "setup") {
      return phase.sub === "settlement"
        ? { ...none, nodes: new Set(targets.nodes.keys()) }
        : { ...none, edges: new Set(targets.edges.keys()) };
    }
    if (phase.k === "moveRobber") {
      return { ...none, tiles: new Set(targets.tiles.keys()) };
    }
    if (phase.k === "roadBuilding") {
      return { ...none, edges: new Set(targets.edges.keys()) };
    }

    switch (mode) {
      case "road":
        return { ...none, edges: new Set(targets.edges.keys()) };
      case "settlement":
        return {
          ...none,
          nodes: new Set(
            moves.flatMap((m) => (m.t === "buildSettlement" ? [m.node] : [])),
          ),
        };
      case "city":
        return {
          ...none,
          nodes: new Set(moves.flatMap((m) => (m.t === "buildCity" ? [m.node] : []))),
        };
      default:
        return none;
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

  const yourTurn = view.currentPlayer === view.you;
  const waiting = moves.length > 0;

  return (
    <div className="game-root">
      <aside className="side left">
        <TableHeader session={session} />

        <div className="players">
          {view.players.map((p) => {
            const isTurn = p.id === view.currentPlayer;
            return (
              <div key={p.id} className={`player${isTurn ? " turn" : ""}`}>
                <span className="swatch" style={{ background: p.color }} />
                <span className="pname">
                  {p.name}
                  {p.id === view.you ? " (you)" : ""}
                </span>
                <span className="pstat">{p.publicPoints} vp</span>
                <span className="pstat dim">{p.handSize} cards</span>
                <span className="pstat dim">{p.devCardCount} dev</span>
                {p.knightsPlayed > 0 && (
                  <span className="pstat dim">{p.knightsPlayed} kt</span>
                )}
                {view.longestRoad.player === p.id && (
                  <span className="badge">road</span>
                )}
                {view.largestArmy.player === p.id && (
                  <span className="badge">army</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="log">
          {log
            .slice(-80)
            .map((event, i) => ({ event, i }))
            .reverse()
            .map(({ event, i }) => {
              const text = describeEvent(event, names);
              if (text === "") return null;
              return (
                <div key={`${String(i)}-${event.e}`} className="log-line">
                  {text}
                </div>
              );
            })}
        </div>
      </aside>

      <main className="stage">
        <BoardView
          board={board}
          roads={view.roads}
          buildings={view.buildings}
          robber={view.robber}
          colors={colors}
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
        {view.winner !== null ? (
          <Winner session={session} />
        ) : (
          <>
            <div
              className="turn-banner"
              style={{ borderColor: colors[view.currentPlayer] }}
            >
              <strong>
                {session.hotSeat
                  ? names[view.currentPlayer]
                  : yourTurn
                    ? "Your turn"
                    : `${names[view.currentPlayer] ?? "Someone"}'s turn`}
              </strong>
              <span>{describePrompt(view, view.you)}</span>
              {view.dice !== null && (
                <span className="dice">
                  {view.dice[0]} + {view.dice[1]} = {view.dice[0] + view.dice[1]}
                </span>
              )}
              {session.deadline != null && waiting && (
                <Countdown deadline={session.deadline} />
              )}
            </div>

            <div className="hand">
              {RESOURCE_KINDS.map((kind) => (
                <div key={kind} className={`card ${kind}`}>
                  <span className="kind">{kind}</span>
                  <span className="count">{view.self.resources[kind]}</span>
                </div>
              ))}
            </div>

            <DevCardHand view={view} />

            {!waiting && (
              <p className="hint waiting">
                Waiting for {names[view.currentPlayer] ?? "another player"}…
              </p>
            )}

            {phase.k === "discard" && waiting && (
              <DiscardPanel
                hand={view.self.resources}
                selection={discard}
                required={Math.floor(totalResources(view.self.resources) / 2)}
                onChange={setDiscard}
                onConfirm={() => {
                  dispatch({
                    t: "discard",
                    player: view.you,
                    resources: discard,
                  });
                  setDiscard(emptyResources());
                }}
              />
            )}

            {phase.k === "steal" && waiting && (
              <div className="actions">
                <h3>Steal from</h3>
                {phase.targets.length === 0 ? (
                  <button onClick={() => play(find("steal"))}>
                    No one to rob — continue
                  </button>
                ) : (
                  phase.targets.map((target: PlayerId) => (
                    <button
                      key={target}
                      onClick={() => {
                        dispatch({ t: "steal", player: view.you, target });
                      }}
                    >
                      <span>{names[target]}</span>
                      <span className="cost">
                        {view.players[target]?.handSize ?? 0} cards
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {phase.k === "tradeOffer" && (
              <TradePanel view={view} names={names} moves={moves} onAction={play} />
            )}

            {phase.k === "roll" && waiting && (
              <div className="actions">
                <button className="primary" onClick={() => play(find("rollDice"))}>
                  Roll dice
                </button>
                <DevCardButtons moves={moves} onAction={play} />
              </div>
            )}

            {phase.k === "main" && waiting && (
              <div className="actions">
                <h3>Build</h3>
                <button
                  disabled={!has("buildRoad")}
                  className={mode === "road" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "road" ? "none" : "road");
                  }}
                >
                  <span>Road</span>
                  <span className="cost">1 brick 1 lumber</span>
                </button>
                <button
                  disabled={!has("buildSettlement")}
                  className={mode === "settlement" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "settlement" ? "none" : "settlement");
                  }}
                >
                  <span>Settlement</span>
                  <span className="cost">1 brick 1 lumber 1 wool 1 grain</span>
                </button>
                <button
                  disabled={!has("buildCity")}
                  className={mode === "city" ? "on" : ""}
                  onClick={() => {
                    setMode(mode === "city" ? "none" : "city");
                  }}
                >
                  <span>City</span>
                  <span className="cost">3 ore 2 grain</span>
                </button>
                <button
                  disabled={!has("buyDevCard")}
                  onClick={() => play(find("buyDevCard"))}
                >
                  <span>Development card</span>
                  <span className="cost">
                    1 ore 1 wool 1 grain · {view.devDeckSize} left
                  </span>
                </button>

                <DevCardButtons moves={moves} onAction={play} />
                <BankTradePanel
                  board={board}
                  view={view}
                  moves={moves}
                  onAction={play}
                />
                {canOffer(view) && <OfferTradePanel you={view.you} onAction={play} />}

                <button className="primary end" onClick={() => play(find("endTurn"))}>
                  End turn
                </button>
              </div>
            )}

            {phase.k === "roadBuilding" && waiting && (
              <div className="actions">
                <h3>Road Building</h3>
                <p className="hint">
                  Place {phase.remaining} free road
                  {phase.remaining === 1 ? "" : "s"}.
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

        {session.onChat !== undefined && (
          <ChatPanel chat={session.chat ?? []} onSend={session.onChat} />
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

        {session.error !== null && (
          <div className="error" onClick={session.dismissError}>
            {session.error}
          </div>
        )}
      </aside>
    </div>
  );
}

function TableHeader({
  session,
}: {
  readonly session: GameSession;
}): React.JSX.Element {
  return (
    <>
      <h1>hexport</h1>
      <p className="sub">
        {session.hotSeat ? "Hot-seat. Base game." : "Online. Base game."}
      </p>
    </>
  );
}

function Winner({ session }: { readonly session: GameSession }): React.JSX.Element {
  const { view } = session;
  const winner = view.winner;
  if (winner === null) return <></>;
  const name = view.players[winner]?.name ?? "Someone";

  return (
    <div className="winner">
      <h2>{name} wins</h2>
      <p>{view.players[winner]?.publicPoints ?? 0}+ victory points</p>
    </div>
  );
}

/** Shows how long is left before the turn timer auto-passes. */
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
  return <span className={left <= 10 ? "timer urgent" : "timer"}>{left}s</span>;
}

function DevCardHand({ view }: { readonly view: WireView }): React.JSX.Element | null {
  if (view.self.devCards.length === 0) return null;

  const counts = new Map<string, { total: number; playable: number }>();
  for (const card of view.self.devCards) {
    if (card.played) continue;
    const entry = counts.get(card.kind) ?? { total: 0, playable: 0 };
    entry.total += 1;
    if (card.playable) entry.playable += 1;
    counts.set(card.kind, entry);
  }
  if (counts.size === 0) return null;

  return (
    <div className="devhand">
      {[...counts.entries()].map(([kind, entry]) => (
        <span key={kind} className={entry.playable > 0 ? "dev ready" : "dev"}>
          {kind} ×{entry.total}
        </span>
      ))}
    </div>
  );
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
      <h3>Play a card</h3>
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
  board,
  view,
  moves,
  onAction,
}: {
  readonly board: GameSession["board"];
  readonly view: WireView;
  readonly moves: readonly Action[];
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element | null {
  const trades = moves.filter((m) => m.t === "bankTrade");
  if (trades.length === 0) return null;
  const rates = portRates(board, view);

  return (
    <details className="trade">
      <summary>Bank / harbour trade</summary>
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
  you,
  onAction,
}: {
  readonly you: PlayerId;
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
          onAction({ t: "offerTrade", player: you, give, receive });
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
  view,
  names,
  moves,
  onAction,
}: {
  readonly view: WireView;
  readonly names: readonly string[];
  readonly moves: readonly Action[];
  readonly onAction: (a: Action | undefined) => void;
}): React.JSX.Element {
  if (view.phase.k !== "tradeOffer") return <></>;
  const offer = view.phase.offer;

  return (
    <div className="actions">
      <h3>Trade offer</h3>
      <p className="hint">
        {names[offer.from]} gives {summarise(offer.give)} for {summarise(offer.receive)}
      </p>
      {moves.length === 0 && <p className="hint">Waiting…</p>}
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
              Trade with {names[m.with]}
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

function ChatPanel({
  chat,
  onSend,
}: {
  readonly chat: readonly { from: string; text: string; at: number }[];
  readonly onSend: (text: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");

  return (
    <details className="trade chat">
      <summary>Chat</summary>
      <div className="chat-log">
        {chat.slice(-30).map((line, i) => (
          <div key={`${String(line.at)}-${String(i)}`}>
            <strong>{line.from}:</strong> {line.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text === "") return;
          onSend(text);
          setDraft("");
        }}
      >
        <input
          value={draft}
          placeholder="Say something"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
      </form>
    </details>
  );
}

function summarise(counts: ResourceCounts): string {
  const parts = RESOURCE_KINDS.filter((k) => counts[k] > 0).map(
    (k) => `${String(counts[k])} ${k}`,
  );
  return parts.length === 0 ? "nothing" : parts.join(", ");
}
