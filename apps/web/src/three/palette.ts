import * as THREE from "three";
import type { Terrain } from "@hexport/engine";

/**
 * Board colours.
 *
 * Tuned for the scene's warm key light rather than copied from theme.css: the
 * same hex reads several shades darker on a lit, textured tile than on a flat
 * DOM swatch. Colour is never the only signal — every tile also carries a
 * painted texture, props, its number token and a label in the placement list,
 * and every player is identified by name and avatar shape as well as hue.
 */
export const TERRAIN_COLOR: Record<Terrain, string> = {
  hill: "#c0683d",
  forest: "#356b33",
  pasture: "#93c35c",
  field: "#e3b945",
  mountain: "#8e959e",
  desert: "#e3cf9d",
  gold: "#f0c200",
  sea: "#2f6f9f",
};

/** The darker earth showing on a tile's bevelled sides. */
export const TERRAIN_SIDE: Record<Terrain, string> = {
  hill: "#7d3f22",
  forest: "#2a4a22",
  pasture: "#5b7f36",
  field: "#9c7a25",
  mountain: "#5a6068",
  desert: "#b39d68",
  gold: "#a88400",
  sea: "#1f4d70",
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  hill: "Hills — brick",
  forest: "Forest — lumber",
  pasture: "Pasture — wool",
  field: "Field — grain",
  mountain: "Mountains — ore",
  desert: "Desert — nothing",
  gold: "Gold field",
  sea: "Sea",
};

/**
 * Seat colours, the familiar board-game set. They stay distinguishable for the
 * common colour-vision deficiencies by leaning on lightness (white and blue
 * against red and orange) and by every piece carrying a dark outline; the DOM
 * adds a unique avatar shape per seat.
 *
 * Mirrors DEFAULT_COLORS in the engine, which is what the server sends.
 */
export const SEAT_COLORS: readonly string[] = [
  "#d8412f", // red
  "#2f6fd0", // blue
  "#f08a24", // orange
  "#f3eee2", // white
  "#3c9a4c", // green
  "#8d5bd0", // purple
];

const cache = new Map<string, THREE.Color>();

/** Cached THREE.Color, since instanced meshes set colours every frame. */
export function color(hex: string): THREE.Color {
  const hit = cache.get(hex);
  if (hit !== undefined) return hit;
  const made = new THREE.Color(hex);
  cache.set(hex, made);
  return made;
}

/** A slightly darker shade, for the sides of a piece. */
export function shade(hex: string, amount = 0.75): THREE.Color {
  const base = new THREE.Color(hex);
  base.multiplyScalar(amount);
  return base;
}
