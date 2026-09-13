import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion.js";

/**
 * The dice.
 *
 * CLAUDE.md, "Dice and fairness": the server rolls with the seeded generator and
 * the client plays a canned animation that lands on the server's result. It
 * never generates a number. What tumbles here is decoration; the values settle
 * on exactly what arrived over the wire.
 */
export function Dice({
  values,
}: {
  readonly values: readonly [number, number] | null;
}): React.JSX.Element | null {
  const [shown, setShown] = useState<readonly [number, number] | null>(values);
  const [rolling, setRolling] = useState(false);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (values === null) {
      setShown(null);
      previous.current = null;
      return;
    }

    const key = values.join(",");
    if (key === previous.current) return;
    previous.current = key;

    if (prefersReducedMotion()) {
      setShown(values);
      return;
    }

    setRolling(true);
    // Tumble through arbitrary faces, then settle on the real result.
    const timer = window.setInterval(() => {
      setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, 70);

    const stop = window.setTimeout(() => {
      window.clearInterval(timer);
      setShown(values);
      setRolling(false);
    }, 520);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [values]);

  if (shown === null) return null;
  const total = values === null ? null : values[0] + values[1];

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1.5" aria-hidden="true">
        <Die value={shown[0]} rolling={rolling} />
        <Die value={shown[1]} rolling={rolling} />
      </div>
      {total !== null && !rolling && (
        <span
          className={[
            "font-num text-sm font-semibold tabular-nums",
            total === 7 ? "text-danger" : "text-ink-300",
          ].join(" ")}
        >
          {total}
        </span>
      )}
      <span className="sr-only">
        {rolling || total === null ? "Rolling" : `Rolled ${String(total)}`}
      </span>
    </div>
  );
}

const PIP_LAYOUT: Record<number, readonly (readonly [number, number])[]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

function Die({
  value,
  rolling,
}: {
  readonly value: number;
  readonly rolling: boolean;
}): React.JSX.Element {
  const pips = PIP_LAYOUT[value] ?? [];

  return (
    <span
      className={[
        "grid h-7 w-7 grid-cols-3 grid-rows-3 place-items-center rounded-md bg-ink-100 p-1 shadow-lift",
        rolling ? "animate-[dice-shake_0.18s_linear_infinite]" : "",
      ].join(" ")}
    >
      {pips.map(([col, row]) => (
        <span
          key={`${String(col)}-${String(row)}`}
          className="h-1.5 w-1.5 rounded-full bg-surface-900"
          style={{ gridColumn: col + 1, gridRow: row + 1 }}
        />
      ))}
    </span>
  );
}
