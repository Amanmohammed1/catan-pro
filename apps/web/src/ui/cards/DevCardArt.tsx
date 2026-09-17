import type { DevCardKind } from "@hexport/engine";

/**
 * Development card illustrations and effect text.
 *
 * Original art and our own wording (CLAUDE.md: mechanics are fine to implement,
 * the published expression is not ours to copy). The text says what the card
 * does in this game, in plain terms, so a new player can decide without opening
 * the rules.
 */
export function DevCardArt({
  kind,
  className = "h-full w-full",
}: {
  readonly kind: DevCardKind;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true">
      {ART[kind]}
    </svg>
  );
}

export const DEV_CARD_TITLE: Record<DevCardKind, string> = {
  knight: "Knight",
  roadBuilding: "Road Building",
  yearOfPlenty: "Year of Plenty",
  monopoly: "Monopoly",
  victoryPoint: "Victory Point",
};

export const DEV_CARD_TEXT: Record<DevCardKind, string> = {
  knight: "Send the robber to a new hex and take one card from a neighbour there.",
  roadBuilding: "Lay two roads at no cost, following the usual building rules.",
  yearOfPlenty: "Take any two resource cards from the bank.",
  monopoly: "Name a resource. Everyone else hands you every card of it they hold.",
  victoryPoint: "Worth one point. Keep it face down until it wins you the game.",
};

export const DEV_CARD_FIELD: Record<DevCardKind, string> = {
  knight: "#dcd3ea",
  roadBuilding: "#e8d8b8",
  yearOfPlenty: "#e6efc4",
  monopoly: "#f3d9b0",
  victoryPoint: "#f5e3a1",
};

const ART: Record<DevCardKind, React.JSX.Element> = {
  knight: (
    <g>
      <ellipse cx="30" cy="52" rx="17" ry="3.4" fill="#00000022" />
      {/* Plume. */}
      <path d="M30 8c8 0 13 4 14 10-5-3-9-3-14-1z" fill="#c0392b" />
      {/* Great helm with a visor slit and breathing holes. */}
      <path d="M18 22c0-7 5-11 12-11s12 4 12 11v14c0 4-5 8-12 8s-12-4-12-8z" fill="#8f99a6" />
      <path d="M18 22c0-7 5-11 12-11v33c-7 0-12-4-12-8z" fill="#aab3bf" />
      <rect x="20" y="25" width="20" height="3.2" rx="1.2" fill="#2a2f36" />
      <path d="M30 29v13" stroke="#6d7682" strokeWidth="1.4" />
      <g fill="#2a2f36">
        <circle cx="25" cy="35" r="0.9" />
        <circle cx="25" cy="38.5" r="0.9" />
        <circle cx="35" cy="35" r="0.9" />
        <circle cx="35" cy="38.5" r="0.9" />
      </g>
      <path d="M22 46h16l-2 4H24z" fill="#6d7682" />
    </g>
  ),

  roadBuilding: (
    <g>
      <ellipse cx="30" cy="52" rx="22" ry="3.4" fill="#00000022" />
      {/* Two fresh planks laid end to end across the land. */}
      <path d="M6 46 22 30l5 3-16 16z" fill="#b9854f" stroke="#7a522b" strokeWidth="1" />
      <path d="M24 29 40 13l5 3-16 16z" fill="#c9965e" stroke="#7a522b" strokeWidth="1" />
      {/* A signpost pointing onward. */}
      <rect x="43" y="26" width="2.6" height="24" fill="#7a522b" />
      <path d="M36 27h17l3 3-3 3H36z" fill="#e3c38e" stroke="#7a522b" strokeWidth="1" />
      <path d="M40 30h10" stroke="#7a522b" strokeWidth="1" />
      {/* A hammer, for the work. */}
      <path d="M10 18l8 8" stroke="#6b4424" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="6" y="11" width="9" height="5" rx="1" transform="rotate(45 10.5 13.5)" fill="#8f99a6" />
    </g>
  ),

  yearOfPlenty: (
    <g>
      <ellipse cx="30" cy="52" rx="20" ry="3.4" fill="#00000022" />
      {/* Produce heaped over the rim. */}
      <circle cx="22" cy="26" r="6" fill="#c0392b" />
      <circle cx="38" cy="25" r="6" fill="#e3a23a" />
      <circle cx="30" cy="22" r="6.5" fill="#6aa84f" />
      <path d="M17 18c3-4 5-7 5-10M40 16c1-3 4-6 7-7" stroke="#b88a2a" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="46" cy="10" rx="2.4" ry="4.4" fill="#eec24c" transform="rotate(40 46 10)" />
      {/* A woven basket. */}
      <path d="M12 30h36l-5 18H17z" fill="#b9854f" />
      <path d="M12 30h36" stroke="#7a522b" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 36h28M18 42h24M22 30l2 18M30 30v18M38 30l-2 18" stroke="#7a522b" strokeWidth="1.1" />
    </g>
  ),

  monopoly: (
    <g>
      <ellipse cx="30" cy="52" rx="20" ry="3.4" fill="#00000022" />
      {/* A stack of coins... */}
      {[46, 42, 38, 34].map((y) => (
        <g key={y}>
          <ellipse cx="30" cy={y + 2} rx="13" ry="4" fill="#b98a36" />
          <ellipse cx="30" cy={y} rx="13" ry="4" fill="#f2cd7a" stroke="#b98a36" strokeWidth="1" />
        </g>
      ))}
      {/* ...under a crown. */}
      <path d="M17 26 14 12l9 7 7-10 7 10 9-7-3 14z" fill="#e9b858" stroke="#8a5f1c" strokeWidth="1.2" />
      <circle cx="30" cy="18" r="2" fill="#c0392b" />
      <circle cx="21" cy="21" r="1.4" fill="#2f6fd0" />
      <circle cx="39" cy="21" r="1.4" fill="#2f6fd0" />
    </g>
  ),

  victoryPoint: (
    <g>
      <ellipse cx="30" cy="52" rx="16" ry="3.4" fill="#00000022" />
      {/* Laurel branches. */}
      <g fill="#6aa84f">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <ellipse cx={17 - i * 0.6} cy={40 - i * 6} rx="2.2" ry="4.6" transform={`rotate(${String(-40 + i * 8)} ${String(17 - i * 0.6)} ${String(40 - i * 6)})`} />
            <ellipse cx={43 + i * 0.6} cy={40 - i * 6} rx="2.2" ry="4.6" transform={`rotate(${String(40 - i * 8)} ${String(43 + i * 0.6)} ${String(40 - i * 6)})`} />
          </g>
        ))}
      </g>
      {/* A gold star in the wreath. */}
      <path d="m30 14 4.4 9 9.9 1.4-7.2 7 1.7 9.8L30 36.6l-8.8 4.6 1.7-9.8-7.2-7 9.9-1.4z" fill="#f2cd7a" stroke="#b98a36" strokeWidth="1.2" />
      <path d="M24 48h12" stroke="#b98a36" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
};
