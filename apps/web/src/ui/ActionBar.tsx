import { useState } from "react";
import {
  COSTS,
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Action,
  type ResourceCounts,
} from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { Button, Cost } from "./Button.js";
import { ResourceIcon } from "./icons.js";
import { devCardLabel } from "./HandDock.js";

/**
 * The contextual controls.
 *
 * Everything here comes from `view.legalMoves`. A control that is present but
 * disabled says why on hover; a control that is absent means the rules do not
 * allow that move at all right now. Nothing in this file decides legality
 * (CLAUDE.md golden rule 3).
 */

export type BuildMode = "none" | "settlement" | "city" | "road";

export interface ActionBarProps {
  readonly view: WireView;
  readonly mode: BuildMode;
  readonly onMode: (mode: BuildMode) => void;
  readonly onAction: (action: Action) => void;
}

export function ActionBar(props: ActionBarProps): React.JSX.Element | null {
  const { view } = props;
  const phase = view.phase;
  const waiting = view.legalMoves.length > 0;

  if (view.winner !== null) return null;

  if (!waiting) {
    return (
      <p className="rounded-card bg-surface-700/60 px-3 py-2 text-xs text-ink-500">
        Waiting for {view.players[view.currentPlayer]?.name ?? "another player"}…
      </p>
    );
  }

  switch (phase.k) {
    case "setup":
      return (
        <Hint>
          {phase.sub === "settlement"
            ? "Pick a highlighted intersection on the board."
            : "Pick a highlighted path touching your new settlement."}
        </Hint>
      );

    case "roll":
      return <RollControls {...props} />;

    case "discard":
      return <DiscardControls {...props} />;

    case "moveRobber":
      return <Hint>Choose a hex on the board to move the robber to.</Hint>;

    case "steal":
      return <StealControls {...props} />;

    case "roadBuilding":
      return <RoadBuildingControls {...props} />;

    case "tradeOffer":
      return <TradeOfferControls {...props} />;

    case "main":
      return <MainControls {...props} />;

    default:
      return null;
  }
}

function Hint({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="rounded-card border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
      {children}
    </p>
  );
}

function Group({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold tracking-[0.1em] text-ink-700 uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function RollControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  const roll = view.legalMoves.find((m) => m.t === "rollDice");
  return (
    <div className="flex flex-col gap-2">
      <Button
        intent="primary"
        disabled={roll === undefined}
        onClick={() => {
          if (roll !== undefined) onAction(roll);
        }}
      >
        Roll the dice
      </Button>
      <DevCardControls view={view} onAction={onAction} />
    </div>
  );
}

function MainControls({
  view,
  mode,
  onMode,
  onAction,
}: ActionBarProps): React.JSX.Element {
  const moves = view.legalMoves;
  const can = (t: Action["t"]): boolean => moves.some((m) => m.t === t);
  const find = (t: Action["t"]): Action | undefined => moves.find((m) => m.t === t);

  return (
    <div className="flex flex-col gap-3">
      <Group label="Build">
        <Button
          disabled={!can("buildRoad")}
          reason={whyNot(view, "road")}
          intent={mode === "road" ? "primary" : "default"}
          onClick={() => {
            onMode(mode === "road" ? "none" : "road");
          }}
          hint={<Cost parts={costOf("road")} />}
        >
          Road
        </Button>
        <Button
          disabled={!can("buildSettlement")}
          reason={whyNot(view, "settlement")}
          intent={mode === "settlement" ? "primary" : "default"}
          onClick={() => {
            onMode(mode === "settlement" ? "none" : "settlement");
          }}
          hint={<Cost parts={costOf("settlement")} />}
        >
          Settlement
        </Button>
        <Button
          disabled={!can("buildCity")}
          reason={whyNot(view, "city")}
          intent={mode === "city" ? "primary" : "default"}
          onClick={() => {
            onMode(mode === "city" ? "none" : "city");
          }}
          hint={<Cost parts={costOf("city")} />}
        >
          City
        </Button>
        <Button
          disabled={!can("buyDevCard")}
          reason={
            view.devDeckSize === 0
              ? "The development deck is empty"
              : whyNot(view, "devCard")
          }
          onClick={() => {
            const action = find("buyDevCard");
            if (action !== undefined) onAction(action);
          }}
          hint={
            <span className="font-num tabular-nums">
              1 ore · 1 wool · 1 grain · {view.devDeckSize} left
            </span>
          }
        >
          Development card
        </Button>
      </Group>

      <DevCardControls view={view} onAction={onAction} />
      <BankTrade view={view} onAction={onAction} />
      <OfferTrade view={view} onAction={onAction} />

      <Button
        intent="primary"
        onClick={() => {
          const action = find("endTurn");
          if (action !== undefined) onAction(action);
        }}
      >
        End turn
      </Button>
    </div>
  );
}

function DevCardControls({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  const moves = view.legalMoves;
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
    <Group label="Play a card">
      {knight !== undefined && (
        <Button
          onClick={() => {
            onAction(knight);
          }}
          hint="move the robber"
        >
          {devCardLabel("knight")}
        </Button>
      )}
      {roads !== undefined && (
        <Button
          onClick={() => {
            onAction(roads);
          }}
          hint="2 free roads"
        >
          {devCardLabel("roadBuilding")}
        </Button>
      )}
      {plenty.length > 0 && (
        <Disclosure label={devCardLabel("yearOfPlenty")} hint="take any 2">
          <div className="grid grid-cols-2 gap-1">
            {plenty.map((move) =>
              move.t === "playYearOfPlenty" ? (
                <Button
                  key={move.resources.join()}
                  size="sm"
                  onClick={() => {
                    onAction(move);
                  }}
                >
                  {move.resources.join(" + ")}
                </Button>
              ) : null,
            )}
          </div>
        </Disclosure>
      )}
      {monopoly.length > 0 && (
        <Disclosure label={devCardLabel("monopoly")} hint="name a resource">
          <div className="grid grid-cols-2 gap-1">
            {monopoly.map((move) =>
              move.t === "playMonopoly" ? (
                <Button
                  key={move.resource}
                  size="sm"
                  onClick={() => {
                    onAction(move);
                  }}
                >
                  {move.resource}
                </Button>
              ) : null,
            )}
          </div>
        </Disclosure>
      )}
    </Group>
  );
}

function BankTrade({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  const trades = view.legalMoves.filter((m) => m.t === "bankTrade");
  if (trades.length === 0) return null;

  // Group by what you give, so the panel reads "spend these, get anything".
  const byGive = new Map<string, { rate: number; actions: Action[] }>();
  for (const trade of trades) {
    if (trade.t !== "bankTrade") continue;
    const entry = byGive.get(trade.give) ?? { rate: trade.rate, actions: [] };
    entry.actions.push(trade);
    byGive.set(trade.give, entry);
  }

  return (
    <Group label="Trade with the bank">
      {[...byGive.entries()].map(([give, entry]) => (
        <Disclosure
          key={give}
          label={`Give ${String(entry.rate)} ${give}`}
          hint={entry.rate < 4 ? "harbour rate" : undefined}
        >
          <div className="grid grid-cols-2 gap-1">
            {entry.actions.map((action) =>
              action.t === "bankTrade" ? (
                <Button
                  key={action.receive}
                  size="sm"
                  onClick={() => {
                    onAction(action);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <ResourceIcon kind={action.receive} className="h-3.5 w-3.5" />
                    {action.receive}
                  </span>
                </Button>
              ) : null,
            )}
          </div>
        </Disclosure>
      ))}
    </Group>
  );
}

function OfferTrade({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  const [give, setGive] = useState<ResourceCounts>(emptyResources());
  const [want, setWant] = useState<ResourceCounts>(emptyResources());

  const canOffer =
    view.phase.k === "main" &&
    view.currentPlayer === view.you &&
    view.players.length > 1 &&
    totalResources(view.self.resources) > 0;

  if (!canOffer) return null;

  const ready = totalResources(give) > 0 && totalResources(want) > 0;
  const affordable = RESOURCE_KINDS.every(
    (kind) => give[kind] <= view.self.resources[kind],
  );

  return (
    <Group label="Offer a trade">
      <Disclosure label="Propose to the table" hint="players answer">
        <div className="flex flex-col gap-2">
          <Picker
            label="You give"
            value={give}
            max={view.self.resources}
            onChange={setGive}
          />
          <Picker label="You want" value={want} onChange={setWant} />
          <Button
            size="sm"
            intent="primary"
            disabled={!ready || !affordable}
            reason={
              !affordable ? "You do not hold that much" : "Put something on both sides"
            }
            onClick={() => {
              onAction({ t: "offerTrade", player: view.you, give, receive: want });
              setGive(emptyResources());
              setWant(emptyResources());
            }}
          >
            Send offer
          </Button>
        </div>
      </Disclosure>
    </Group>
  );
}

function TradeOfferControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  if (view.phase.k !== "tradeOffer") return <></>;
  const offer = view.phase.offer;
  const names = view.players.map((p) => p.name);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-card border border-surface-600 bg-surface-700/70 px-3 py-2 text-xs">
        <p className="mb-1 font-medium text-ink-100">{names[offer.from]} offers</p>
        <p className="text-ink-300">
          gives <Summary counts={offer.give} /> for <Summary counts={offer.receive} />
        </p>
      </div>

      {view.legalMoves.length === 0 && (
        <p className="text-xs text-ink-500">Waiting for the others to answer…</p>
      )}

      {view.legalMoves.map((move, index) => {
        if (move.t === "respondTrade") {
          return (
            <Button
              key={`r${String(index)}`}
              intent={move.accept ? "primary" : "default"}
              onClick={() => {
                onAction(move);
              }}
            >
              {move.accept ? "Accept" : "Decline"}
            </Button>
          );
        }
        if (move.t === "confirmTrade") {
          return (
            <Button
              key={`c${String(index)}`}
              intent="primary"
              onClick={() => {
                onAction(move);
              }}
            >
              Trade with {names[move.with]}
            </Button>
          );
        }
        if (move.t === "cancelTrade") {
          return (
            <Button
              key={`x${String(index)}`}
              intent="ghost"
              onClick={() => {
                onAction(move);
              }}
            >
              Withdraw offer
            </Button>
          );
        }
        return null;
      })}
    </div>
  );
}

function StealControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  if (view.phase.k !== "steal") return <></>;
  const targets = view.phase.targets;

  if (targets.length === 0) {
    const skip = view.legalMoves.find((m) => m.t === "steal");
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-500">
          Nobody next to the robber has a card to take.
        </p>
        <Button
          intent="primary"
          onClick={() => {
            if (skip !== undefined) onAction(skip);
          }}
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <Group label="Steal from">
      {targets.map((target) => (
        <Button
          key={target}
          onClick={() => {
            onAction({ t: "steal", player: view.you, target });
          }}
          hint={`${String(view.players[target]?.handSize ?? 0)} cards`}
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: view.players[target]?.color }}
            />
            {view.players[target]?.name}
          </span>
        </Button>
      ))}
    </Group>
  );
}

function RoadBuildingControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  if (view.phase.k !== "roadBuilding") return <></>;
  const stop = view.legalMoves.find((m) => m.t === "endRoadBuilding");

  return (
    <div className="flex flex-col gap-2">
      <Hint>
        Place {view.phase.remaining} free road
        {view.phase.remaining === 1 ? "" : "s"} on the board.
      </Hint>
      {stop !== undefined && (
        <Button
          onClick={() => {
            onAction(stop);
          }}
        >
          Nowhere left to build — continue
        </Button>
      )}
    </div>
  );
}

function DiscardControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  const [picked, setPicked] = useState<ResourceCounts>(emptyResources());
  const hand = view.self.resources;
  const required = Math.floor(totalResources(hand) / 2);
  const chosen = totalResources(picked);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-card border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-xs font-medium text-danger">
          A seven was rolled. Discard {required} of your {totalResources(hand)} cards.
        </p>
      </div>

      <Picker label="Discard" value={picked} max={hand} onChange={setPicked} />

      <Button
        intent="danger"
        disabled={chosen !== required}
        reason={
          chosen < required
            ? `Choose ${String(required - chosen)} more`
            : `Choose ${String(chosen - required)} fewer`
        }
        onClick={() => {
          onAction({ t: "discard", player: view.you, resources: picked });
          setPicked(emptyResources());
        }}
        hint={`${String(chosen)}/${String(required)}`}
      >
        Discard
      </Button>
    </div>
  );
}

/** A stepper per resource. Used for discarding and for building a trade. */
function Picker({
  label,
  value,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: ResourceCounts;
  readonly max?: ResourceCounts | undefined;
  readonly onChange: (next: ResourceCounts) => void;
}): React.JSX.Element {
  return (
    <fieldset className="rounded-card border border-surface-600 bg-surface-800/60 px-2 py-1.5">
      <legend className="px-1 text-[10px] tracking-wide text-ink-700 uppercase">
        {label}
      </legend>
      <div className="flex flex-col gap-0.5">
        {RESOURCE_KINDS.map((kind) => {
          const ceiling = max?.[kind];
          const atMax = ceiling !== undefined && value[kind] >= ceiling;
          return (
            <div key={kind} className="flex items-center gap-1.5">
              <span className="flex flex-1 items-center gap-1.5 text-xs text-ink-300">
                <ResourceIcon kind={kind} className="h-3.5 w-3.5" />
                {kind}
                {ceiling !== undefined && (
                  <span className="font-num text-[10px] text-ink-700">({ceiling})</span>
                )}
              </span>
              <Stepper
                label={`one fewer ${kind}`}
                disabled={value[kind] <= 0}
                reason={`No ${kind} selected`}
                onClick={() => {
                  onChange({ ...value, [kind]: value[kind] - 1 });
                }}
              >
                −
              </Stepper>
              <span className="w-5 text-center font-num text-sm tabular-nums">
                {value[kind]}
              </span>
              <Stepper
                label={`one more ${kind}`}
                disabled={atMax}
                reason={`You only hold ${String(ceiling ?? 0)} ${kind}`}
                onClick={() => {
                  onChange({ ...value, [kind]: value[kind] + 1 });
                }}
              >
                +
              </Stepper>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function Stepper({
  label,
  disabled,
  reason,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      title={disabled ? reason : label}
      onClick={onClick}
      className="h-6 w-6 rounded border border-surface-600 bg-surface-700 text-sm leading-none text-ink-300 transition-colors hover:bg-surface-600 hover:text-ink-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Disclosure({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="group rounded-card border border-surface-600 bg-surface-700/60">
      <summary className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-xs text-ink-300 marker:content-[''] hover:text-ink-100">
        <span>{label}</span>
        {hint !== undefined && <span className="text-[10px] text-ink-700">{hint}</span>}
      </summary>
      <div className="border-t border-surface-600 p-1.5">{children}</div>
    </details>
  );
}

function Summary({ counts }: { readonly counts: ResourceCounts }): React.JSX.Element {
  const parts = RESOURCE_KINDS.filter((k) => counts[k] > 0);
  if (parts.length === 0) return <span>nothing</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {parts.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-0.5 font-num">
          {counts[kind]}
          <ResourceIcon kind={kind} className="h-3 w-3" />
        </span>
      ))}
    </span>
  );
}

function costOf(
  kind: "road" | "settlement" | "city",
): readonly (readonly [string, number])[] {
  return RESOURCE_KINDS.flatMap((resource) => {
    const amount = COSTS[kind][resource];
    return amount > 0 ? [[resource, amount] as const] : [];
  });
}

/** Why a build button is unavailable, in the player's terms. */
function whyNot(
  view: WireView,
  kind: "road" | "settlement" | "city" | "devCard",
): string {
  const cost = COSTS[kind];
  const short = RESOURCE_KINDS.filter(
    (resource) => view.self.resources[resource] < cost[resource],
  );

  if (short.length > 0) {
    return `You need ${short.map((r) => `${String(cost[r] - view.self.resources[r])} more ${r}`).join(", ")}`;
  }

  switch (kind) {
    case "road":
      return "No path connects to your network";
    case "settlement":
      return "No intersection is both connected to your roads and two paths from any building";
    case "city":
      return "You have no settlement left to upgrade";
    default:
      return "Not available right now";
  }
}
