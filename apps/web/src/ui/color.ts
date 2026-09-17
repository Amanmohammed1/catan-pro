/**
 * Colour arithmetic for colours that arrive as data — a seat colour from the
 * server — rather than as design tokens.
 */

/** Relative luminance of a #rrggbb colour, per WCAG. */
export function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return 0.5;
  const channel = (i: number): number => {
    const v = parseInt(clean.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** True when dark ink reads better than light ink on this colour. */
export function isLight(hex: string): boolean {
  return luminance(hex) > 0.36;
}
