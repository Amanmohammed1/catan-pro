import { isLight } from "./color.js";

/**
 * A player's token: their colour, carrying a shape unique to their seat.
 *
 * Colour is never the only signal (CLAUDE.md). Six seats, six shapes — circle,
 * square, triangle, diamond, hexagon, star — so two players are told apart by
 * someone who cannot tell red from green, in the player list, the log and the
 * prompt banner alike.
 */

const SHAPES: readonly React.JSX.Element[] = [
  <circle key="c" cx="12" cy="12" r="5.2" />,
  <rect key="s" x="7" y="7" width="10" height="10" rx="1.6" />,
  <path key="t" d="M12 5.8 18.6 17H5.4z" />,
  <path key="d" d="M12 4.8 19.2 12 12 19.2 4.8 12z" />,
  <path key="h" d="M12 5.2 18 8.6v6.8L12 18.8 6 15.4V8.6z" />,
  <path key="st" d="m12 4.8 2.2 4.5 4.9.7-3.6 3.4.9 4.9-4.4-2.3-4.4 2.3.9-4.9-3.6-3.4 4.9-.7z" />,
];

export function seatShapeName(seat: number): string {
  return ["circle", "square", "triangle", "diamond", "hexagon", "star"][seat % 6] ?? "circle";
}

export function Avatar({
  seat,
  color,
  size = 36,
  ring = false,
}: {
  readonly seat: number;
  readonly color: string;
  readonly size?: number;
  /** A gold ring, for the player on turn. */
  readonly ring?: boolean;
}): React.JSX.Element {
  const ink = isLight(color) ? "var(--color-quill-900)" : "var(--color-parchment-50)";

  return (
    <span
      aria-hidden="true"
      className={[
        "relative inline-grid shrink-0 place-items-center rounded-full",
        ring ? "ring-2 ring-gold ring-offset-2 ring-offset-surface-800" : "",
      ].join(" ")}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, #ffffff55 0%, transparent 55%), ${color}`,
        boxShadow: "0 0 0 1.5px #00000066 inset, 0 2px 6px -2px #000000aa",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill={ink}>
        {SHAPES[seat % SHAPES.length]}
      </svg>
    </span>
  );
}
