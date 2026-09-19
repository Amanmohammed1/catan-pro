import * as THREE from "three";
import type { ResourceKind, Terrain } from "@hexport/engine";
import { pipCount } from "./layout3d.js";
import { TERRAIN_COLOR } from "./palette.js";

/**
 * Textures, painted at runtime.
 *
 * Every surface on the board — terrain, number tokens, harbour signs, the
 * wooden frame, the sea, the table — is drawn to a canvas here rather than
 * shipped as an image. That keeps the repository free of binary art and its
 * licensing (CLAUDE.md), keeps the download small, and makes every surface
 * tunable in code.
 *
 * Each painter is deterministic (a seeded generator, not Math.random), so the
 * board looks the same on every load and in every screenshot. Results are
 * cached; nothing is repainted per frame.
 */

const cache = new Map<string, THREE.CanvasTexture>();

/** mulberry32: tiny, fast, good enough for scattering paint. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic generator keyed by a string, e.g. a tile id. */
export function seeded(text: string): () => number {
  return rng(seedOf(text));
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function canvas(width: number, height: number): {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return { el, ctx: el.getContext("2d") };
}

function finish(
  key: string,
  el: HTMLCanvasElement,
  options: { repeat?: boolean; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(el);
  texture.anisotropy = 8;
  if (options.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  if (options.repeat === true) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  cache.set(key, texture);
  return texture;
}

/** Speckle: many small soft dots, for the grain of a natural surface. */
function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  size: number,
  colours: readonly string[],
  count: number,
  radius: [number, number],
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[Math.floor(random() * colours.length)] ?? "#000";
    ctx.globalAlpha = 0.18 + random() * 0.35;
    ctx.beginPath();
    ctx.arc(
      random() * size,
      random() * size,
      radius[0] + random() * (radius[1] - radius[0]),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Terrain

const TERRAIN_SIZE = 512;

/**
 * The painted top of a terrain tile.
 *
 * The tile's top face takes UVs straight from its shape coordinates, which run
 * from -1 to 1 for a unit hex; the caller maps that onto this square with
 * repeat 0.5 and offset 0.5. Canvas "up" is the far edge of the board as the
 * default camera sees it.
 */
export function terrainTexture(terrain: Terrain): THREE.CanvasTexture {
  const key = `terrain:${terrain}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const S = TERRAIN_SIZE;
  const { el, ctx } = canvas(S, S);
  if (ctx !== null) {
    const random = rng(seedOf(key));
    ctx.fillStyle = TERRAIN_COLOR[terrain];
    ctx.fillRect(0, 0, S, S);
    PAINTERS[terrain](ctx, random, S);

    // A gentle vignette toward the rim, so each tile reads as a raised piece.
    const edge = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.56);
    edge.addColorStop(0, "#00000000");
    edge.addColorStop(1, "#00000038");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, S, S);
  }
  return finish(key, el);
}

type Painter = (ctx: CanvasRenderingContext2D, random: () => number, S: number) => void;

const PAINTERS: Record<Terrain, Painter> = {
  /**
   * An unrevealed hex (Seafarers p.8).
   *
   * Every other painter here says what a hex produces. This one has the
   * opposite job — to say that nobody knows yet — so it is deliberately
   * featureless: banked mist with no props, no grain and no silhouette to read
   * a terrain into. Guessing wrong from the art would be worse than guessing
   * nothing.
   */
  fog: (ctx, random, S) => {
    speckle(ctx, random, S, ["#c8d3d8", "#aebcc4"], 700, [3, 9]);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = "#d7e0e4";
      ctx.globalAlpha = 0.18 + random() * 0.16;
      ctx.beginPath();
      ctx.ellipse(
        random() * S,
        random() * S,
        S * (0.18 + random() * 0.2),
        8 + random() * 26,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  forest: (ctx, random, S) => {
    speckle(ctx, random, S, ["#244a22", "#3d7a37"], 900, [2, 6]);
    // Canopy: overlapping clumps of tree crowns, lit from the upper left.
    for (let i = 0; i < 150; i++) {
      const x = random() * S;
      const y = random() * S;
      const r = 14 + random() * 22;
      ctx.fillStyle = "#1c3a1b";
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(x + r * 0.25, y + r * 0.3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = ["#2f6b2c", "#3a7d34", "#2a5d28", "#46893c"][i % 4] ?? "#2f6b2c";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6fae55";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  pasture: (ctx, random, S) => {
    speckle(ctx, random, S, ["#7fb04c", "#a8d46c", "#6e9e3e"], 1400, [2, 7]);
    // Tufts of grass.
    ctx.lineCap = "round";
    for (let i = 0; i < 700; i++) {
      const x = random() * S;
      const y = random() * S;
      ctx.strokeStyle = random() > 0.5 ? "#6a9a3a" : "#b5dc78";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 5);
      ctx.lineTo(x, y - 4);
      ctx.lineTo(x + 4, y + 5);
      ctx.stroke();
    }
    // A scatter of wildflowers.
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = ["#fff8e1", "#ffe27a", "#f3b6c8"][i % 3] ?? "#fff";
      ctx.beginPath();
      ctx.arc(random() * S, random() * S, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  field: (ctx, random, S) => {
    speckle(ctx, random, S, ["#c79a2e", "#f0cf66"], 900, [2, 5]);
    // Ploughed rows of wheat running across the tile, gently curved.
    for (let row = -S; row < S * 2; row += 22) {
      ctx.strokeStyle = row % 44 === 0 ? "#f2d36e" : "#b98c27";
      ctx.lineWidth = 9;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 16) {
        const y = row + x * 0.45 + Math.sin(x / 70) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Ears catching the light.
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = random() > 0.5 ? "#fbe08a" : "#d6a93a";
      ctx.fillRect(random() * S, random() * S, 2, 5);
    }
  },

  hill: (ctx, random, S) => {
    speckle(ctx, random, S, ["#9d4f2b", "#d7875a", "#a85a33"], 1200, [2, 7]);
    // Clay furrows and a few exposed pits.
    ctx.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      const y = random() * S;
      const x = random() * S;
      ctx.strokeStyle = random() > 0.5 ? "#8e4526" : "#dc8c5c";
      ctx.lineWidth = 3 + random() * 4;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 60, y);
      ctx.quadraticCurveTo(x, y - 14, x + 60, y + 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 16; i++) {
      const x = random() * S;
      const y = random() * S;
      ctx.fillStyle = "#7a3a1e";
      ctx.beginPath();
      ctx.ellipse(x, y, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b35f36";
      ctx.beginPath();
      ctx.ellipse(x - 2, y - 2, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  mountain: (ctx, random, S) => {
    speckle(ctx, random, S, ["#737a83", "#a9b0b8"], 1200, [2, 6]);
    // Faceted scree: random light and shadow triangles.
    for (let i = 0; i < 260; i++) {
      const x = random() * S;
      const y = random() * S;
      const r = 10 + random() * 26;
      ctx.fillStyle = ["#9aa1aa", "#6b727b", "#b7bec6", "#5c636b"][i % 4] ?? "#888";
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.6);
      ctx.lineTo(x - r * 0.8, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  desert: (ctx, random, S) => {
    speckle(ctx, random, S, ["#d3bb83", "#f1e3bb"], 1500, [1.5, 4]);
    // Dune ridges.
    for (let i = 0; i < 26; i++) {
      const y = random() * S;
      ctx.strokeStyle = random() > 0.5 ? "#c8ad72" : "#f5e8c4";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 12) {
        const yy = y + Math.sin((x + i * 40) / 48) * 10;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  gold: (ctx, random, S) => {
    speckle(ctx, random, S, ["#fff2a8", "#c79c00"], 1400, [2, 6]);
  },

  sea: (ctx, random, S) => {
    speckle(ctx, random, S, ["#3f86b8", "#245d85"], 1000, [3, 8]);
  },
};

// ---------------------------------------------------------------------------
// Number tokens

const DISPLAY_FONT = `"Fraunces Variable", Georgia, "Times New Roman", serif`;

/**
 * The printed face of a number token.
 *
 * Cream disc, a serif numeral, and one pip per way to roll it (rules p.10). The
 * two most likely numbers, 6 and 8, are printed in red. 6 and 9 carry a small
 * bar beneath so they cannot be confused when the board is turned.
 *
 * `fontKey` changes once the display face has loaded, so the first frame's
 * fallback-font tokens are replaced rather than kept forever.
 */
export function tokenFaceTexture(value: number, fontKey: string): THREE.CanvasTexture {
  const key = `token:${String(value)}:${fontKey}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const S = 256;
  const { el, ctx } = canvas(S, S);
  if (ctx !== null) {
    const c = S / 2;
    const red = value === 6 || value === 8;

    const face = ctx.createRadialGradient(c - 30, c - 40, 10, c, c, c);
    face.addColorStop(0, "#fffaf0");
    face.addColorStop(0.7, "#f3e6c8");
    face.addColorStop(1, "#dcc79b");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#b89b66";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(c, c, c - 14, 0, Math.PI * 2);
    ctx.stroke();

    const ink = red ? "#b3261e" : "#2b1c11";
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${String(red ? 118 : 108)}px ${DISPLAY_FONT}`;
    ctx.fillText(String(value), c, c - 14);

    if (value === 6 || value === 9) {
      ctx.fillRect(c - 16, c + 40, 32, 5);
    }

    const pips = pipCount(value);
    const gap = 17;
    const start = c - ((pips - 1) * gap) / 2;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(start + i * gap, c + 66, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return finish(key, el);
}

// ---------------------------------------------------------------------------
// Harbour signs

/** Same strokes as ui/icons.tsx, so a harbour and a hand card match. */
const RESOURCE_GLYPH: Record<ResourceKind, string> = {
  brick: "M3 6h18v5H3zM3 13h18v5H3zM12 6v5M8 13v5M16 13v5",
  lumber: "M12 3 6 11h3l-4 6h14l-4-6h3zM12 17v4",
  wool: "M7 16a4 4 0 0 1-1-7.9A3.5 3.5 0 0 1 12 5a3.5 3.5 0 0 1 6 3.1A4 4 0 0 1 17 16zM9 16v3M15 16v3",
  grain:
    "M12 21V9M12 9c0-3 2-5 4-5 0 3-2 5-4 5zM12 9c0-3-2-5-4-5 0 3 2 5 4 5zM12 15c0-2.5 1.8-4 3.5-4 0 2.5-1.8 4-3.5 4zM12 15c0-2.5-1.8-4-3.5-4 0 2.5 1.8 4 3.5 4z",
  ore: "m12 3 7 5-2.6 11H7.6L5 8zM5 8h14M12 3v16",
};

const RESOURCE_INK: Record<ResourceKind, string> = {
  brick: "#a8461f",
  lumber: "#2f6b2c",
  wool: "#5f8f2e",
  grain: "#a47a12",
  ore: "#4f5a68",
};

/** The round sign on a harbour: its rate, and what it trades. */
export function harborSignTexture(
  resource: ResourceKind | null,
  ratio: number,
  fontKey: string,
): THREE.CanvasTexture {
  const key = `harbor:${resource ?? "any"}:${String(ratio)}:${fontKey}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const S = 256;
  const { el, ctx } = canvas(S, S);
  if (ctx !== null) {
    const c = S / 2;
    ctx.fillStyle = "#f6ead0";
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7a522b";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(c, c, c - 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#2b1c11";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 76px ${DISPLAY_FONT}`;
    ctx.fillText(`${String(ratio)}:1`, c, resource === null ? c - 22 : c - 34);

    if (resource === null) {
      ctx.font = `600 40px ${DISPLAY_FONT}`;
      ctx.fillStyle = "#6e5439";
      ctx.fillText("any", c, c + 46);
    } else {
      ctx.save();
      ctx.translate(c - 42, c + 4);
      ctx.scale(3.5, 3.5);
      ctx.strokeStyle = RESOURCE_INK[resource];
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(RESOURCE_GLYPH[resource]));
      ctx.restore();
    }
  }
  return finish(key, el);
}

// ---------------------------------------------------------------------------
// Wood, water, table

/** Planks of honey-coloured wood for the sea frame. Tiles horizontally. */
export function woodTexture(): THREE.CanvasTexture {
  const key = "wood";
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const W = 512;
  const H = 128;
  const { el, ctx } = canvas(W, H);
  if (ctx !== null) {
    const random = rng(seedOf(key));
    ctx.fillStyle = "#8a5630";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const y = random() * H;
      ctx.strokeStyle = random() > 0.5 ? "#6b3f20" : "#a86d3e";
      ctx.globalAlpha = 0.35 + random() * 0.4;
      ctx.lineWidth = 1 + random() * 2.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const yy = y + Math.sin((x + i * 31) / 60) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Plank joints.
    ctx.fillStyle = "#4d2c14";
    for (let x = 0; x < W; x += 128) ctx.fillRect(x, 0, 2, H);
  }
  return finish(key, el, { repeat: true });
}

/** Walnut table top. Tiles in both directions. */
export function tableTexture(): THREE.CanvasTexture {
  const key = "table";
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const S = 512;
  const { el, ctx } = canvas(S, S);
  if (ctx !== null) {
    const random = rng(seedOf(key));
    ctx.fillStyle = "#3a2416";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) {
      const y = random() * S;
      ctx.strokeStyle = random() > 0.55 ? "#2a190e" : "#4d311d";
      ctx.globalAlpha = 0.3 + random() * 0.4;
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 16) {
        const yy = y + Math.sin((x + i * 17) / 80) * 4;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1e120a";
    for (let y = 0; y < S; y += 128) ctx.fillRect(0, y, S, 2);
  }
  return finish(key, el, { repeat: true });
}

/** Soft ripples on open water. Tiles, and is scrolled slowly by the sea. */
export function waterTexture(): THREE.CanvasTexture {
  const key = "water";
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const S = 256;
  const { el, ctx } = canvas(S, S);
  if (ctx !== null) {
    const random = rng(seedOf(key));
    ctx.fillStyle = "#2a6a93";
    ctx.fillRect(0, 0, S, S);
    ctx.lineCap = "round";
    for (let i = 0; i < 120; i++) {
      const x = random() * S;
      const y = random() * S;
      const w = 10 + random() * 22;
      ctx.strokeStyle = random() > 0.4 ? "#4c93bf" : "#1f577c";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      // Draw each arc three times offset by the tile size so it wraps.
      for (const [dx, dy] of [
        [0, 0],
        [-S, 0],
        [0, -S],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, w, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  return finish(key, el, { repeat: true });
}
