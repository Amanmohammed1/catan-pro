import type { ResourceKind } from "@hexport/engine";

/**
 * Resource illustrations.
 *
 * Original art, drawn for this game (CLAUDE.md: nothing from the published
 * cards). Each is a small still life on a 60×60 canvas — a brick wall, stacked
 * logs, a sheep, a sheaf, a heap of ore — so a card is recognisable by its
 * picture alone, before colour or name.
 */
export function ResourceArt({
  kind,
  className = "h-full w-full",
}: {
  readonly kind: ResourceKind;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true">
      {ART[kind]}
    </svg>
  );
}

const ART: Record<ResourceKind, React.JSX.Element> = {
  brick: (
    <g>
      <ellipse cx="30" cy="50" rx="23" ry="4" fill="#00000022" />
      {/* Three courses, bonded, each brick with a lit top edge. */}
      {[
        [8, 36, 14],
        [23, 36, 14],
        [38, 36, 14],
        [15, 26, 14],
        [30, 26, 14],
        [22, 16, 14],
      ].map(([x, y, w]) => (
        <g key={`${String(x)}-${String(y)}`}>
          <rect x={x} y={y} width={w} height="9" rx="1.6" fill="#b4522c" />
          <rect x={x} y={y} width={w} height="3" rx="1.4" fill="#df7c4f" />
          <rect
            x={x}
            y={y}
            width={w}
            height="9"
            rx="1.6"
            fill="none"
            stroke="#6f2d14"
            strokeWidth="1.1"
          />
        </g>
      ))}
      <path d="M11 41h3M27 40h2M42 42h4M19 31h3M35 30h2" stroke="#8d3c1d" strokeWidth="1" />
    </g>
  ),

  lumber: (
    <g>
      <ellipse cx="30" cy="51" rx="24" ry="4" fill="#00000022" />
      {/* A young pine behind the pile. */}
      <path d="M44 8 35 22h5l-7 9h22l-7-9h5z" fill="#3f7a3a" />
      <path d="M44 8 40 14h8z" fill="#5c9a4c" />
      <rect x="42.6" y="31" width="3" height="6" fill="#6b4424" />
      {/* Log ends: two below, one above, each with growth rings. */}
      {[
        [18, 40],
        [33, 40],
        [25.5, 28],
      ].map(([cx, cy]) => (
        <g key={`${String(cx)}-${String(cy)}`}>
          <circle cx={cx} cy={cy} r="7.6" fill="#8a5a2e" />
          <circle cx={cx} cy={cy} r="6.4" fill="#e0b07a" />
          <circle cx={cx} cy={cy} r="4.2" fill="none" stroke="#b37c47" strokeWidth="1" />
          <circle cx={cx} cy={cy} r="2" fill="none" stroke="#b37c47" strokeWidth="1" />
          <circle cx={cx} cy={cy} r="0.8" fill="#8a5a2e" />
        </g>
      ))}
    </g>
  ),

  wool: (
    <g>
      <ellipse cx="30" cy="50" rx="20" ry="3.6" fill="#00000022" />
      {/* Legs first so the fleece sits over them. */}
      <path d="M20 38v10M26 39v10M35 39v10M41 38v10" stroke="#3a2f27" strokeWidth="2.6" strokeLinecap="round" />
      <g fill="#fbf7ec" stroke="#d6ccb6" strokeWidth="1.1">
        <circle cx="22" cy="31" r="7" />
        <circle cx="30" cy="27" r="8" />
        <circle cx="38" cy="30" r="7" />
        <circle cx="26" cy="37" r="7" />
        <circle cx="35" cy="37" r="7" />
      </g>
      {/* Head, looking out of the card. */}
      <ellipse cx="45.5" cy="27.5" rx="5" ry="6.2" fill="#3a2f27" />
      <ellipse cx="41" cy="23" rx="3" ry="1.6" fill="#3a2f27" transform="rotate(-25 41 23)" />
      <circle cx="46.8" cy="26" r="1" fill="#fbf7ec" />
    </g>
  ),

  grain: (
    <g>
      <ellipse cx="30" cy="52" rx="16" ry="3.4" fill="#00000022" />
      {/* Stalks fanning out from the tie. */}
      <g stroke="#b88a2a" strokeWidth="1.3" strokeLinecap="round">
        <path d="M30 50 30 16M30 50 22 18M30 50 38 18M30 50 16 22M30 50 44 22" />
      </g>
      {/* Ears of wheat. */}
      {(
        [
          [30, 14, 0],
          [21.5, 16, -18],
          [38.5, 16, 18],
          [15, 20.5, -34],
          [45, 20.5, 34],
        ] as const
      ).map(([cx, cy, r]) => (
        <g key={`${String(cx)}`} transform={`rotate(${String(r)} ${String(cx)} ${String(cy)})`}>
          <ellipse cx={cx} cy={cy} rx="3.2" ry="7" fill="#eec24c" stroke="#b88a2a" strokeWidth="1" />
          <path d={`M${String(cx)} ${String(cy - 5)}v10`} stroke="#c99a30" strokeWidth="0.8" />
        </g>
      ))}
      {/* The band holding the sheaf together. */}
      <rect x="25" y="38" width="10" height="4" rx="1.5" fill="#8a5a2e" />
    </g>
  ),

  ore: (
    <g>
      <ellipse cx="30" cy="50" rx="24" ry="4" fill="#00000022" />
      {/* A heap of faceted rock, lit from the upper left. */}
      <path d="M8 48 16 30l10-4 6 8-4 14z" fill="#6f7884" />
      <path d="M16 30 26 26l-3 9z" fill="#b8c1cc" />
      <path d="M26 48l4-14 10-12 12 10 2 16z" fill="#848e9b" />
      <path d="M30 34 40 22l4 10z" fill="#c9d1db" />
      <path d="M40 22l12 10-8 0z" fill="#9aa4b1" />
      <path d="M18 48l6-9 8 3 2 6z" fill="#5c6570" />
      {/* Glints of metal in the rock. */}
      <path d="M37 38l2-2 2 2-2 2zM21 38l1.5-1.5 1.5 1.5-1.5 1.5zM45 42l1.5-1.5 1.5 1.5-1.5 1.5z" fill="#eef4fb" />
    </g>
  ),
};

/** Card background tint per resource, printed behind the illustration. */
export const RESOURCE_FIELD: Record<ResourceKind, string> = {
  brick: "#f3cdb4",
  lumber: "#cfe3bb",
  wool: "#e3efc7",
  grain: "#f7e3a6",
  ore: "#d9dfe7",
};

export const RESOURCE_NAME: Record<ResourceKind, string> = {
  brick: "Brick",
  lumber: "Lumber",
  wool: "Wool",
  grain: "Grain",
  ore: "Ore",
};
