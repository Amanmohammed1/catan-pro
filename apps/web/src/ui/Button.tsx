/**
 * The one button.
 *
 * Three intents and two sizes. Every disabled button carries a `title` saying
 * why, because "greyed out with no explanation" is the single most common way a
 * game interface wastes someone's turn.
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
  /** Trailing text, usually a cost. */
  readonly hint?: React.ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly children: React.ReactNode;
  readonly className?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "disabled"
>): React.JSX.Element {
  const base =
    "inline-flex w-full items-center justify-between gap-2 rounded-card border text-left transition-all duration-150 ease-[var(--ease-out-soft)] disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px";

  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm";

  const intents = {
    default:
      "border-surface-600 bg-surface-700/80 hover:bg-surface-600 hover:border-surface-500",
    primary:
      "border-accent/60 bg-accent/85 text-surface-900 font-semibold hover:bg-accent shadow-lift",
    danger: "border-danger/55 bg-danger/20 text-danger hover:bg-danger/30",
    ghost:
      "border-transparent bg-transparent text-ink-500 hover:bg-surface-700 hover:text-ink-100",
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
        <span className="shrink-0 text-[11px] font-normal opacity-70">{hint}</span>
      )}
    </button>
  );
}

/** A cost, rendered compactly. */
export function Cost({
  parts,
}: {
  readonly parts: readonly (readonly [string, number])[];
}): React.JSX.Element {
  return (
    <span className="font-num tabular-nums">
      {parts.map(([kind, n]) => `${String(n)} ${kind}`).join(" · ")}
    </span>
  );
}
