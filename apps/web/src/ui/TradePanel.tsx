import { useMemo, useState } from "react";
import {
  RESOURCE_KINDS,
  emptyResources,
  totalResources,
  type Action,
  type ResourceCounts,
  type ResourceKind,
} from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { Avatar } from "./Avatar.js";
import { Button, ResourceChip } from "./Button.js";
import { RESOURCE_NAME } from "./cards/ResourceArt.js";

/**
 * Trading, on the model colonist.io uses: click a card to put it on the table,
 * click it again to take it back. No steppers, no typing.
 *
 * Three things are on screen at once for the player holding an offer: what they
 * are giving, what they want, and what the bank would charge for the same
 * thing — because "four lumber for an ore" is the offer every player is
 * silently comparing against, and hiding it makes a trade panel feel like a
 * negotiation with missing information.
 *
 * Nothing here decides legality. The active player's right to open an offer and
 * a responder's right to counter are both predicates the engine exposes
 * (ADR 0003), and `reduce()` validates the contents either way.
 */

/** A row of resources you can click to add, with the count you hold. */
function Picker({
  label,
  value,
  held,
  onChange,
}: {
  readonly label: string;
  readonly value: ResourceCounts;
  /** What the player holds, when the side is limited by it. */
  readonly held?: ResourceCounts | undefined;
  readonly onChange: (next: ResourceCounts) => void;
}): React.JSX.Element {
  return (
    <fieldset className="rounded-[11px] border border-gold/15 bg-surface-800/70 px-2.5 py-2">
      <legend className="eyebrow px-1">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {RESOURCE_KINDS.map((kind) => {
          const picked = value[kind];
          const ceiling = held?.[kind];
          const full = ceiling !== undefined && picked >= ceiling;

          return (
            <button
              key={kind}
              type="button"
              data-trade-add={kind}
              disabled={full}
              title={
                full
                  ? `You hold ${String(ceiling)} ${kind}`
                  : `Add one ${kind}${ceiling === undefined ? "" : ` (you hold ${String(ceiling)})`}`
              }
              onClick={() => {
                onChange({ ...value, [kind]: picked + 1 });
              }}
              className={[
                "flex items-center gap-1.5 rounded-[9px] border px-2 py-1.5 text-xs transition-colors",
                picked > 0
                  ? "border-gold/60 bg-gold/15 text-gold"
                  : "border-gold/15 bg-surface-700/70 text-ink-300 enabled:hover:bg-surface-600",
                full ? "opacity-40" : "",
              ].join(" ")}
            >
              <ResourceChip kind={kind} className="h-4 w-4" />
              <span className="font-num tabular-nums">{picked}</span>
              <span className="sr-only">{RESOURCE_NAME[kind]}</span>
            </button>
          );
        })}
      </div>

      {totalResources(value) > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {RESOURCE_KINDS.filter((kind) => value[kind] > 0).map((kind) => (
            <button
              key={kind}
              type="button"
              data-trade-remove={kind}
              title={`Take back one ${kind}`}
              onClick={() => {
                onChange({ ...value, [kind]: Math.max(0, value[kind] - 1) });
              }}
              className="flex items-center gap-1 rounded-full bg-surface-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-surface-600 hover:text-ink-100"
            >
              −<ResourceChip kind={kind} className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            data-trade-clear=""
            onClick={() => {
              onChange(emptyResources());
            }}
            className="rounded-full px-2 py-0.5 text-[11px] text-ink-700 hover:text-ink-300"
          >
            clear
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** What the bank would charge for the same thing, at the player's best rate. */
function BankComparison({
  view,
  want,
}: {
  readonly view: WireView;
  readonly want: ResourceCounts;
}): React.JSX.Element | null {
  const rates = useMemo(() => {
    const best: Partial<Record<ResourceKind, number>> = {};
    for (const move of view.legalMoves) {
      if (move.t !== "bankTrade") continue;
      const current = best[move.give];
      if (current === undefined || move.rate < current) best[move.give] = move.rate;
    }
    return best;
  }, [view.legalMoves]);

  const wanted = RESOURCE_KINDS.filter((kind) => want[kind] > 0);
  if (wanted.length === 0) return null;

  const offers = RESOURCE_KINDS.filter(
    (kind) => (rates[kind] ?? 99) <= view.self.resources[kind],
  );
  if (offers.length === 0) return null;

  return (
    <p className="rounded-[9px] bg-surface-700/50 px-2.5 py-1.5 text-[11px] text-ink-500">
      The bank would take{" "}
      {offers
        .slice(0, 3)
        .map((kind) => `${String(rates[kind] ?? 4)} ${kind}`)
        .join(" or ")}{" "}
      for one card.
    </p>
  );
}

/** The active player, putting an offer on the table. */
export function OfferBuilder({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element {
  const [give, setGive] = useState<ResourceCounts>(emptyResources());
  const [want, setWant] = useState<ResourceCounts>(emptyResources());

  const ready = totalResources(give) > 0 && totalResources(want) > 0;
  const affordable = RESOURCE_KINDS.every(
    (kind) => give[kind] <= view.self.resources[kind],
  );

  return (
    <div className="flex flex-col gap-2">
      <Picker
        label="You give"
        value={give}
        held={view.self.resources}
        onChange={setGive}
      />
      <Picker label="You want" value={want} onChange={setWant} />
      <BankComparison view={view} want={want} />
      <Button
        size="sm"
        intent="primary"
        data-action="send-offer"
        disabled={!ready || !affordable}
        reason={!affordable ? "You do not hold that much" : "Put something on both sides"}
        onClick={() => {
          onAction({ t: "offerTrade", player: view.you, give, receive: want });
          setGive(emptyResources());
          setWant(emptyResources());
        }}
      >
        Offer it to the table
      </Button>
    </div>
  );
}

/**
 * A responder's side of an open offer: take it, refuse it, or say what you
 * would take instead.
 */
export function OfferResponse({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  const [countering, setCountering] = useState(false);
  const [give, setGive] = useState<ResourceCounts>(emptyResources());
  const [want, setWant] = useState<ResourceCounts>(emptyResources());

  if (view.phase.k !== "tradeOffer") return null;
  const offer = view.phase.offer;
  const answered = view.phase.responses[view.you];
  const accept = view.legalMoves.find((m) => m.t === "respondTrade" && m.accept);
  const decline = view.legalMoves.find((m) => m.t === "respondTrade" && !m.accept);

  const ready = totalResources(give) > 0 && totalResources(want) > 0;
  const affordable = RESOURCE_KINDS.every(
    (kind) => give[kind] <= view.self.resources[kind],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[11px] border border-gold/20 bg-surface-700/70 px-3 py-2.5 text-xs">
        <p className="mb-1.5 flex items-center gap-2 font-medium text-ink-100">
          <Avatar seat={offer.from} color={view.players[offer.from]?.color ?? "#888"} size={22} />
          {view.players[offer.from]?.name} offers
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-ink-300">
          you get <Counts counts={offer.give} /> for <Counts counts={offer.receive} />
        </p>
      </div>

      {answered === "counter" && (
        <p className="rounded-[9px] bg-gold/12 px-2.5 py-1.5 text-[11px] text-gold">
          Your counter is on the table. It is theirs to take.
        </p>
      )}

      {accept !== undefined && (
        <Button
          intent="primary"
          data-action="accept"
          onClick={() => {
            onAction(accept);
          }}
        >
          Accept
        </Button>
      )}

      {decline !== undefined && (
        <Button
          data-action="decline"
          onClick={() => {
            onAction(decline);
          }}
        >
          Decline
        </Button>
      )}

      {decline !== undefined && !countering && (
        <Button
          intent="ghost"
          data-action="open-counter"
          onClick={() => {
            setCountering(true);
          }}
        >
          Counter with your own terms
        </Button>
      )}

      {countering && (
        <div className="flex flex-col gap-2 rounded-[11px] border border-gold/20 p-2">
          <Picker
            label="You give"
            value={give}
            held={view.self.resources}
            onChange={setGive}
          />
          <Picker label="You want" value={want} onChange={setWant} />
          <Button
            size="sm"
            intent="primary"
            data-action="send-counter"
            disabled={!ready || !affordable}
            reason={
              !affordable ? "You do not hold that much" : "Put something on both sides"
            }
            onClick={() => {
              onAction({ t: "counterTrade", player: view.you, give, receive: want });
              setGive(emptyResources());
              setWant(emptyResources());
              setCountering(false);
            }}
          >
            Send counter
          </Button>
        </div>
      )}
    </div>
  );
}

/** The offering player's side: who has answered, and what closing costs. */
export function OfferStandings({
  view,
  onAction,
}: {
  readonly view: WireView;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  if (view.phase.k !== "tradeOffer") return null;
  const { offer, responses, counters } = view.phase;

  const confirms = view.legalMoves.filter((m) => m.t === "confirmTrade");
  const cancel = view.legalMoves.find((m) => m.t === "cancelTrade");

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[11px] border border-gold/20 bg-surface-700/70 px-3 py-2.5 text-xs">
        <p className="mb-1.5 font-medium text-ink-100">Your offer</p>
        <p className="flex flex-wrap items-center gap-1.5 text-ink-300">
          <Counts counts={offer.give} /> for <Counts counts={offer.receive} />
        </p>
      </div>

      <ul className="flex flex-col gap-1">
        {view.players
          .filter((player) => player.id !== view.you)
          .map((player) => {
            const answer = responses[player.id] ?? "pending";
            const counter = counters[player.id];
            return (
              <li
                key={player.id}
                className="flex items-center gap-2 rounded-[9px] bg-surface-700/50 px-2 py-1.5 text-xs"
              >
                <Avatar seat={player.id} color={player.color} size={20} />
                <span className="flex-1 truncate text-ink-300">{player.name}</span>
                {counter === undefined ? (
                  <span
                    className={[
                      "text-[10px] font-semibold tracking-[0.1em] uppercase",
                      answer === "accept"
                        ? "text-success"
                        : answer === "decline"
                          ? "text-ink-700"
                          : "text-ink-500",
                    ].join(" ")}
                  >
                    {answer === "pending" ? "thinking" : answer}
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1 text-[11px] text-gold">
                    wants <Counts counts={counter.receive} /> for{" "}
                    <Counts counts={counter.give} />
                  </span>
                )}
              </li>
            );
          })}
      </ul>

      {confirms.map((move) =>
        move.t === "confirmTrade" ? (
          <Button
            key={move.with}
            intent="primary"
            data-action="confirm-trade"
            onClick={() => {
              onAction(move);
            }}
          >
            Trade with {view.players[move.with]?.name}
          </Button>
        ) : null,
      )}

      {cancel !== undefined && (
        <Button
          intent="ghost"
          data-action="withdraw"
          onClick={() => {
            onAction(cancel);
          }}
        >
          Withdraw offer
        </Button>
      )}
    </div>
  );
}

function Counts({ counts }: { readonly counts: ResourceCounts }): React.JSX.Element {
  const parts = RESOURCE_KINDS.filter((kind) => counts[kind] > 0);
  if (parts.length === 0) return <span>nothing</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-0.5 font-num tabular-nums">
          {counts[kind]}
          <ResourceChip kind={kind} className="h-4 w-4" />
          <span className="sr-only">{RESOURCE_NAME[kind]}</span>
        </span>
      ))}
    </span>
  );
}
