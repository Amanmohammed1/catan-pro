/**
 * The game's name, set in the display face over a hex.
 *
 * A placeholder codename (CLAUDE.md): nothing here borrows the published game's
 * name, logo or lettering.
 */
export function Wordmark({
  size = "sm",
}: {
  readonly size?: "sm" | "lg";
}): React.JSX.Element {
  const large = size === "lg";

  return (
    <span className="inline-flex items-center gap-2">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={large ? "h-8 w-8" : "h-5 w-5"}
      >
        <path
          d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z"
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M12 6.4 16.8 9.2v5.6L12 17.6 7.2 14.8V9.2z" fill="var(--color-accent)" opacity="0.85" />
      </svg>
      <span
        className={[
          "font-display font-semibold tracking-tight text-ink-100",
          large ? "text-[34px] leading-none" : "text-[17px]",
        ].join(" ")}
      >
        hexport
      </span>
    </span>
  );
}
