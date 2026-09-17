import { useState } from "react";
import {
  COSTS,
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Action,
  type ResourceCounts,
  type ResourceKind,
} from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { Button, Cost, ResourceChip } from "./Button.js";
import { Avatar } from "./Avatar.js";
import { devCardLabel } from "./HandDock.js";
import { OfferBuilder, OfferResponse, OfferStandings } from "./TradePanel.js";
import { RESOURCE_NAME } from "./cards/ResourceArt.js";

/**
 * The contextual controls.
 *
 * Everything here comes from `view.legalMoves`. A control that is present but
 * disabled says why on hover; a control that is absent means the rules do not
 * allow that move at all right now. Nothing in this file decides legality
 * (CLAUDE.md golden rule 3).
 *
 * Every control carries a `data-action`, which is how the tests and the UI
 * driver find it — never a class name or a label (CLAUDE.md, Conventions).
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
      <p className="rounded-[11px] bg-surface-700/60 px-3 py-2.5 text-xs text-ink-500">
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

    case "specialBuild":
      return <SpecialBuildControls {...props} />;

    default:
      return null;
  }
}

/**
 * The 5–6 player Special Building window: build and buy, nothing else.
 *
 * No trade of any kind and no development card may be played, so those controls
 * are absent rather than disabled — the rules do not allow them at all here
 * (ADR 0006).
 */
function SpecialBuildControls({
  view,
  mode,
  onMode,
  onAction,
}: ActionBarProps): React.JSX.Element {
  const pass = view.legalMoves.find((m) => m.t === "passSpecialBuild");

  return (
    <div className="flex flex-col gap-3.5">
      <Hint>
        Your building window, between turns. You may build and buy cards, but
        not trade or play a development card.
      </Hint>

      <BuildGroup view={view} mode={mode} onMode={onMode} onAction={onAction} />

      <Button
        intent="primary"
        data-action="pass-special-build"
        onClick={() => {
          if (pass !== undefined) onAction(pass);
        }}
      >
        Done building
      </Button>
    </div>
  );
}

function Hint({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="flex items-start gap-2 rounded-[11px] border border-gold/30 bg-gold/10 px-3 py-2.5 text-[13px] text-ink-100">
      <span
        aria-hidden="true"
        className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-gold"
      />
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
      <h3 className="eyebrow">{label}</h3>
      {children}
    </section>
  );
}

/** A keyboard hint, shown next to the control it triggers. */
function Key({ children }: { readonly children: string }): React.JSX.Element {
  return (
    <kbd className="rounded border border-current/30 px-1 py-px font-ui text-[10px] opacity-70">
      {children}
    </kbd>
  );
}

function RollControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  const roll = view.legalMoves.find((m) => m.t === "rollDice");
  return (
    <div className="flex flex-col gap-3">
      <Button
        intent="primary"
        data-action="roll"
        disabled={roll === undefined}
        reason="It is not your roll"
        hint={<Key>R</Key>}
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
  const find = (t: Action["t"]): Action | undefined => moves.find((m) => m.t === t);

  return (
    <div className="flex flex-col gap-3.5">
      <BuildGroup view={view} mode={mode} onMode={onMode} onAction={onAction} />

      {mode !== "none" && (
        <p className="rounded-[10px] border border-gold/25 bg-gold/8 px-2.5 py-2 text-[12px] text-gold">
          Choose a glowing spot on the board, or from the list below. Press{" "}
          <Key>Esc</Key> to cancel.
        </p>
      )}

      <DevCardControls view={view} onAction={onAction} />
      <BankTrade view={view} onAction={onAction} />
      <OfferTrade view={view} onAction={onAction} />

      <Button
        intent="primary"
        data-action="end-turn"
        hint={<Key>E</Key>}
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

/** The four things you can spend on, with their costs. */
function BuildGroup({
  view,
  mode,
  onMode,
  onAction,
}: ActionBarProps): React.JSX.Element {
  const moves = view.legalMoves;
  const can = (t: Action["t"]): boolean => moves.some((m) => m.t === t);
  const find = (t: Action["t"]): Action | undefined => moves.find((m) => m.t === t);

  return (
    <>
      <Group label="Build">
        <Button
          data-action="build-road"
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
          data-action="build-settlement"
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
          data-action="build-city"
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
          data-action="buy-dev-card"
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
            <span className="flex items-center gap-1.5">
              <Cost parts={costOf("devCard")} />
              <span className="tabular-nums opacity-70">{view.devDeckSize} left</span>
            </span>
          }
        >
          Development card
        </Button>
      </Group>
    </>
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
          data-action="play-knight"
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
          data-action="play-road-building"
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
                  data-action="play-year-of-plenty"
                  onClick={() => {
                    onAction(move);
                  }}
                >
                  <span className="flex items-center gap-1">
                    {move.resources.map((kind, i) => (
                      <ResourceChip key={`${kind}${String(i)}`} kind={kind} className="h-4 w-4" />
                    ))}
                    <span className="sr-only">{move.resources.join(" and ")}</span>
                  </span>
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
                  data-action="play-monopoly"
                  onClick={() => {
                    onAction(move);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <ResourceChip kind={move.resource} className="h-4 w-4" />
                    {RESOURCE_NAME[move.resource]}
                  </span>
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
  const byGive = new Map<ResourceKind, { rate: number; actions: Action[] }>();
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
          chip={<ResourceChip kind={give} className="h-4 w-4" />}
          hint={entry.rate < 4 ? "harbour rate" : undefined}
        >
          <div className="grid grid-cols-2 gap-1">
            {entry.actions.map((action) =>
              action.t === "bankTrade" ? (
                <Button
                  key={action.receive}
                  size="sm"
                  data-action="bank-trade"
                  onClick={() => {
                    onAction(action);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <ResourceChip kind={action.receive} className="h-4 w-4" />
                    {RESOURCE_NAME[action.receive]}
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
  // ADR 0003: the space of offers is unbounded, so legalMoves does not list
  // them. Whether one may be opened at all is a question of phase and holdings.
  const canOffer =
    view.phase.k === "main" &&
    view.currentPlayer === view.you &&
    view.players.length > 1 &&
    totalResources(view.self.resources) > 0;

  if (!canOffer) return null;

  return (
    <Group label="Offer a trade">
      <Disclosure label="Propose to the table" hint="players answer">
        <OfferBuilder view={view} onAction={onAction} />
      </Disclosure>
    </Group>
  );
}

/**
 * An open offer, from whichever side of it you are on: the player who made it
 * watches the answers come in, everyone else takes it, refuses it, or says what
 * they would take instead.
 */
function TradeOfferControls({ view, onAction }: ActionBarProps): React.JSX.Element {
  if (view.phase.k !== "tradeOffer") return <></>;

  return view.phase.offer.from === view.you ? (
    <OfferStandings view={view} onAction={onAction} />
  ) : (
    <OfferResponse view={view} onAction={onAction} />
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
          data-action="continue"
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
          data-action="steal"
          onClick={() => {
            onAction({ t: "steal", player: view.you, target });
          }}
          hint={`${String(view.players[target]?.handSize ?? 0)} cards`}
        >
          <span className="flex items-center gap-2">
            <Avatar seat={target} color={view.players[target]?.color ?? "#888"} size={22} />
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
          data-action="continue"
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
      <div className="rounded-[11px] border border-danger/40 bg-danger/10 px-3 py-2.5">
        <p className="text-[13px] font-medium text-danger">
          A seven was rolled. Discard {required} of your {totalResources(hand)} cards.
        </p>
      </div>

      <Picker label="Discard" value={picked} max={hand} onChange={setPicked} />

      <Button
        intent="danger"
        data-action="discard"
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
    <fieldset className="rounded-[11px] border border-gold/15 bg-surface-800/70 px-2.5 py-2">
      <legend className="eyebrow px-1">{label}</legend>
      <div className="flex flex-col gap-1">
        {RESOURCE_KINDS.map((kind) => {
          const ceiling = max?.[kind];
          const atMax = ceiling !== undefined && value[kind] >= ceiling;
          const held = ceiling ?? 0;
          return (
            <div key={kind} className="flex items-center gap-1.5">
              <span className="flex flex-1 items-center gap-1.5 text-xs text-ink-300">
                <ResourceChip kind={kind} className="h-4 w-4" />
                {RESOURCE_NAME[kind]}
                {ceiling !== undefined && (
                  <span className="text-[10px] text-ink-700 tabular-nums">({held})</span>
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
              <span className="w-5 text-center font-num text-sm font-semibold tabular-nums">
                {value[kind]}
              </span>
              <Stepper
                label={`one more ${kind}`}
                disabled={atMax}
                reason={`You only hold ${String(held)} ${kind}`}
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
      className="h-7 w-7 rounded-[7px] border border-gold/20 bg-surface-700 text-sm leading-none text-ink-300 transition-colors enabled:hover:bg-surface-600 enabled:hover:text-ink-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Disclosure({
  label,
  hint,
  chip,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly chip?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="group overflow-hidden rounded-[11px] border border-gold/15 bg-surface-700/70">
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-xs text-ink-300 marker:content-[''] hover:text-ink-100">
        <span className="flex-1">{label}</span>
        {chip}
        {hint !== undefined && <span className="text-[10px] text-ink-700">{hint}</span>}
      </summary>
      <div className="border-t border-gold/10 p-1.5">{children}</div>
    </details>
  );
}

function costOf(
  kind: "road" | "settlement" | "city" | "devCard",
): readonly (readonly [ResourceKind, number])[] {
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
