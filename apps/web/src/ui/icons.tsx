import type { ResourceKind } from "@hexport/engine";

/**
 * Resource glyphs.
 *
 * Every resource carries a shape as well as a colour. Roughly one man in twelve
 * has some form of colour-vision deficiency, and brick against lumber is exactly
 * the red/green pair that collapses — so the glyph is the real identifier and
 * the colour is reinforcement.
 */

export function ResourceIcon({
  kind,
  className = "h-4 w-4",
}: {
  readonly kind: ResourceKind;
  readonly className?: string;
}): React.JSX.Element {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "brick":
      // Stacked courses.
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="5" rx="1" />
          <rect x="3" y="13" width="18" height="5" rx="1" />
          <path d="M12 6v5M8 13v5M16 13v5" />
        </svg>
      );
    case "lumber":
      // A conifer.
      return (
        <svg {...common}>
          <path d="M12 3 6 11h3l-4 6h14l-4-6h3z" />
          <path d="M12 17v4" />
        </svg>
      );
    case "wool":
      // A fleece.
      return (
        <svg {...common}>
          <path d="M7 16a4 4 0 0 1-1-7.9A3.5 3.5 0 0 1 12 5a3.5 3.5 0 0 1 6 3.1A4 4 0 0 1 17 16z" />
          <path d="M9 16v3M15 16v3" />
        </svg>
      );
    case "grain":
      // An ear of wheat.
      return (
        <svg {...common}>
          <path d="M12 21V9" />
          <path d="M12 9c0-3 2-5 4-5 0 3-2 5-4 5zM12 9c0-3-2-5-4-5 0 3 2 5 4 5z" />
          <path d="M12 15c0-2.5 1.8-4 3.5-4 0 2.5-1.8 4-3.5 4zM12 15c0-2.5-1.8-4-3.5-4 0 2.5 1.8 4 3.5 4z" />
        </svg>
      );
    case "ore":
      // A cut gem.
      return (
        <svg {...common}>
          <path d="m12 3 7 5-2.6 11H7.6L5 8z" />
          <path d="M5 8h14M12 3v16" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

export function VictoryIcon({
  className = "h-3.5 w-3.5",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m12 2 2.9 6.3 6.8.8-5 4.7 1.3 6.8L12 17.3 6 20.6l1.3-6.8-5-4.7 6.8-.8z" />
    </svg>
  );
}

export function RoadIcon({
  className = "h-3.5 w-3.5",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 19 10 5M14 19 20 5M7 12h10" />
    </svg>
  );
}

export function ArmyIcon({
  className = "h-3.5 w-3.5",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </svg>
  );
}

export function CardBackIcon({
  className = "h-4 w-4",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}
