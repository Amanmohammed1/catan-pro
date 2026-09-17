import { describe, it, expect } from "vitest";
import css from "./theme.css?raw";

/**
 * Legibility, enforced.
 *
 * The client once shipped with near-black headings on near-black panels. That
 * came from a stylesheet leak rather than a token, but the lesson stands: text
 * colour is too easy to get wrong by eye and too costly to get wrong at all.
 * This parses the real tokens and checks every pairing the interface uses
 * against WCAG 2.2 contrast minimums.
 */

function tokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) out.set(name, value);
  }
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const palette = tokens();
const get = (name: string): string => {
  const value = palette.get(name);
  if (value === undefined) throw new Error(`No --color-${name} in theme.css`);
  return value;
};

/** [foreground, background, minimum ratio, where it is used]. */
const PAIRS: [string, string, number, string][] = [];

for (const bg of ["surface-900", "surface-800", "surface-700"]) {
  for (const fg of ["ink-100", "ink-300", "ink-500", "ink-700"]) {
    PAIRS.push([fg, bg, 4.5, "body and secondary text on panels"]);
  }
  for (const fg of ["accent", "gold", "danger", "success"]) {
    PAIRS.push([fg, bg, 4.5, "status text on panels"]);
  }
  for (const fg of ["brick", "lumber", "wool", "grain", "ore"]) {
    PAIRS.push([fg, bg, 3, "resource glyphs on panels (graphics, 3:1)"]);
  }
}

for (const bg of ["parchment-50", "parchment-100", "parchment-200"]) {
  for (const fg of ["quill-900", "quill-700", "quill-500"]) {
    PAIRS.push([fg, bg, 4.5, "text printed on cards"]);
  }
}

PAIRS.push(["surface-900", "accent", 4.5, "label on a primary button"]);
PAIRS.push(["surface-900", "gold", 4.5, "label on a gold chip"]);

describe("theme tokens", () => {
  it("parses the palette", () => {
    expect(palette.size).toBeGreaterThan(30);
  });

  it.each(PAIRS)("%s on %s is at least %s:1 (%s)", (fg, bg, minimum) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(minimum);
  });
});
