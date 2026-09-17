import type { ResourceKind } from "@hexport/engine";
import { ResourceIcon } from "./icons.js";

/**
 * The one button.
 *
 * Four intents and two sizes. Every disabled button carries a `title` saying
 * why, because "greyed out with no explanation" is the single most common way a
 * game interface wastes someone's turn. Pass `data-action` for tests to find it.
 */
export function Button({
  intent = "default",
  size = "md",
  disabled = false,
  reason,
  hint,
  onClick,
  children,
  className = "",
  ...rest
}: {
  readonly intent?: "default" | "primary" | "danger" | "ghost";
  readonly size?: "sm" | "md";
  readonly disabled?: boolean;
  /** Shown on hover when disabled. Say what would make it possible. */
  readonly reason?: string | undefined;
  /** Trailing content, usually a cost. */
  readonly hint?: React.ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly children: React.ReactNode;
  readonly className?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "disabled"
>): React.JSX.Element {
  const base =
    "group/button inline-flex w-full items-center justify-between gap-2 rounded-[11px] border text-left transition-all duration-150 ease-[var(--ease-out-soft)] disabled:cursor-not-allowed disabled:opacity-45 enabled:active:translate-y-px";

  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm";

  const intents = {
    default:
      "border-gold/15 bg-surface-700/85 text-ink-100 enabled:hover:border-gold/40 enabled:hover:bg-surface-600",
    primary:
      "border-gold/70 bg-gradient-to-b from-gold to-accent font-semibold text-surface-900 shadow-lift enabled:hover:brightness-105",
    danger:
      "border-danger/60 bg-danger/15 font-medium text-danger enabled:hover:bg-danger/25",
    ghost:
      "border-transparent bg-transparent text-ink-500 enabled:hover:bg-surface-700 enabled:hover:text-ink-100",
  } as const;

  return (
    <button
      type="button"
      disabled={disabled}
      // A disabled control always says why. "Greyed out with no explanation" is
      // the commonest way a game interface wastes someone's turn, and a screen
      // reader gets nothing at all from it.
      title={disabled ? (reason ?? "Not available right now") : undefined}
      onClick={onClick}
      className={[base, sizing, intents[intent], className].join(" ")}
      {...rest}
    >
      <span className="truncate">{children}</span>
      {hint !== undefined && (
        <span className="shrink-0 text-[11px] font-normal opacity-90">{hint}</span>
      )}
    </button>
  );
}

const CHIP: Record<ResourceKind, string> = {
  brick: "bg-brick",
  lumber: "bg-lumber",
  wool: "bg-wool",
  grain: "bg-grain",
  ore: "bg-ore",
};

/** One small resource chip: the resource's colour with its glyph. */
export function ResourceChip({
  kind,
  className = "h-[18px] w-[18px]",
}: {
  readonly kind: ResourceKind;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-grid place-items-center rounded-[5px] text-surface-900 shadow-[0_1px_0_#ffffff55_inset,0_1px_2px_#00000066]",
        CHIP[kind],
        className,
      ].join(" ")}
    >
      <ResourceIcon kind={kind} className="h-[72%] w-[72%]" />
    </span>
  );
}

/**
 * A cost, shown the way the building-cost card shows it: one chip per card.
 * The words are there for screen readers.
 */
export function Cost({
  parts,
}: {
  readonly parts: readonly (readonly [ResourceKind, number])[];
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.flatMap(([kind, n]) =>
        Array.from({ length: n }, (_, i) => <ResourceChip key={`${kind}${String(i)}`} kind={kind} />),
      )}
      <span className="sr-only">
        {parts.map(([kind, n]) => `${String(n)} ${kind}`).join(", ")}
      </span>
    </span>
  );
}
