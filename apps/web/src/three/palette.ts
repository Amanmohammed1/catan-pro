import * as THREE from "three";
import type { Terrain } from "@hexport/engine";

/**
 * Board colours.
 *
 * These mirror the terrain tokens in theme.css so the 3D board and the DOM
 * legend cannot drift apart. Colour is never the only signal: every tile also
 * carries its number token and a label in the inspector, and every player piece
 * is identified by name in the strip as well as by hue.
 */
export const TERRAIN_COLOR: Record<Terrain, string> = {
  hill: "#b4653a",
  forest: "#2f6b3f",
  pasture: "#86c169",
  field: "#e0bd4d",
  mountain: "#8e939b",
  desert: "#ddcd9f",
  gold: "#f0c200",
  sea: "#2f6f9f",
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
 * Seat colours.
 *
 * Chosen to stay distinct under deuteranopia and protanopia: the red and green
 * of a normal board-game palette collapse together, so this leans on lightness
 * and on blue/orange separation instead of red/green.
 */
export const SEAT_COLORS: readonly string[] = [
  "#e2574c", // vermilion
  "#3f86d9", // azure
  "#eda43a", // amber
  "#f2f0ea", // bone
  "#2fa37a", // teal
  "#9b6dd6", // violet
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
