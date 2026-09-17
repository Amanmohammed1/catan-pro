import { useMemo } from "react";
import { prefersReducedMotion } from "./motion.js";

/**
 * Confetti for the winner.
 *
 * Deterministic rather than random, so a screenshot of the end of a game is
 * reproducible, and silent under reduced motion — a screen full of tumbling
 * paper is exactly what that setting is asking us not to do.
 */
export function Confetti({
  colors,
  pieces = 70,
}: {
  readonly colors: readonly string[];
  readonly pieces?: number;
}): React.JSX.Element | null {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        // A cheap hash keeps the scatter irregular but fixed.
        const h = (i * 2654435761) % 1000;
        return {
          left: (h % 100) + Math.sin(i) * 0.5,
          delay: ((h % 37) / 37) * 1.8,
          duration: 2.6 + ((h % 23) / 23) * 1.8,
          drift: ((h % 19) - 9) * 12,
          spin: 360 + (h % 5) * 220,
          width: 6 + (h % 3) * 3,
          height: 9 + (h % 4) * 3,
          color: colors[i % Math.max(1, colors.length)] ?? "var(--color-gold)",
        };
      }),
    [colors, pieces],
  );

  if (prefersReducedMotion()) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((bit, i) => (
        <span
          key={i}
          className="absolute top-0 block rounded-[2px] animate-[confetti-fall_linear_forwards]"
          style={{
            left: `${String(bit.left)}%`,
            width: bit.width,
            height: bit.height,
            background: bit.color,
            animationDelay: `${String(bit.delay)}s`,
            animationDuration: `${String(bit.duration)}s`,
            ["--drift" as string]: `${String(bit.drift)}px`,
            ["--spin" as string]: `${String(bit.spin)}deg`,
          }}
        />
      ))}
    </div>
  );
}
