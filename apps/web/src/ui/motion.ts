/**
 * Motion preferences.
 *
 * Everything that moves checks this. Someone who has asked their system for
 * reduced motion gets a game that still plays identically — pieces appear, the
 * robber moves, the dice show a result — it simply stops animating between
 * states. Vestibular triggers are not a style choice.
 */

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    cached = false;
    return cached;
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  cached = query.matches;
  // The setting can change while the page is open.
  query.addEventListener("change", (event) => {
    cached = event.matches;
  });
  return cached;
}

/** Duration in milliseconds, collapsed to nothing when motion is reduced. */
export function duration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
