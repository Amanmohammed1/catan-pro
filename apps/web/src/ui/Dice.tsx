import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion.js";

/**
 * The dice: one red, one yellow, as in the box.
 *
 * CLAUDE.md, "Dice and fairness": the server rolls with the seeded generator and
 * the client plays a canned animation that lands on the server's result. It
 * never generates a number. What tumbles here is decoration; the faces settle
 * on exactly what arrived over the wire.
 */
export function Dice({
  values,
}: {
  readonly values: readonly [number, number] | null;
}): React.JSX.Element {
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
    // Tumble through arbitrary faces, then settle on the real result. These
    // faces are decoration only; the result is whatever the server sent.
    let face = 0;
    const timer = window.setInterval(() => {
      face += 1;
      setShown([1 + ((face * 5) % 6), 1 + ((face * 7 + 3) % 6)]);
    }, 70);

    const stop = window.setTimeout(() => {
      window.clearInterval(timer);
      setShown(values);
      setRolling(false);
    }, 560);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [values]);

  const total = values === null ? null : values[0] + values[1];

  // Before the first roll there is nothing to show; two blank dice in the bar
  // read as broken rather than as "not yet".
  if (shown === null) return <></>;

  return (
    <div className="flex items-center gap-2" title={total === null ? "No roll yet" : `Rolled ${String(total)}`}>
      <div className="flex gap-1.5" aria-hidden="true">
        <Die value={shown[0]} rolling={rolling} tone="red" />
        <Die value={shown[1]} rolling={rolling} tone="yellow" />
      </div>
      {total !== null && !rolling && (
        <span
          className={[
            "min-w-[1.6ch] font-num text-xl leading-none font-bold tabular-nums",
            total === 7 ? "text-danger" : "text-gold",
          ].join(" ")}
        >
          {total}
        </span>
      )}
      <span className="sr-only">
        {total === null ? "No roll yet" : rolling ? "Rolling" : `Rolled ${String(total)}`}
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

const TONES = {
  red: {
    face: "linear-gradient(145deg, #e0563f 0%, #b52f22 100%)",
    pip: "bg-parchment-100",
  },
  yellow: {
    face: "linear-gradient(145deg, #f9d977 0%, #e0aa33 100%)",
    pip: "bg-[#8a1f16]",
  },
} as const;

function Die({
  value,
  rolling,
  tone,
}: {
  readonly value: number;
  readonly rolling: boolean;
  readonly tone: keyof typeof TONES;
}): React.JSX.Element {
  const pips = PIP_LAYOUT[value] ?? [];
  const style = TONES[tone];

  return (
    <span
      className={[
        "grid h-9 w-9 grid-cols-3 grid-rows-3 place-items-center rounded-[9px] p-1.5",
        "shadow-[0_2px_0_#00000055,0_6px_12px_-4px_#000000aa,inset_0_1px_0_#ffffff66]",
        rolling ? "animate-[dice-tumble_0.56s_var(--ease-out-soft)]" : "",
      ].join(" ")}
      style={{ background: style.face }}
    >
      {pips.map(([col, row]) => (
        <span
          key={`${String(col)}-${String(row)}`}
          className={["h-[7px] w-[7px] rounded-full shadow-[inset_0_1px_1px_#00000055]", style.pip].join(" ")}
          style={{ gridColumn: col + 1, gridRow: row + 1 }}
        />
      ))}
    </span>
  );
}
