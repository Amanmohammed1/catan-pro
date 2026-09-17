import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { prefersReducedMotion } from "../ui/motion.js";

/**
 * Animate newly appeared keys from nothing to full size.
 *
 * A piece that pops into existence at full scale is hard to notice on a busy
 * board, especially when it is someone else's. Growing it over a few frames
 * draws the eye to what changed, which is the whole job of an animation here.
 *
 * Returns a map of key to scale in [0, 1]. Keys already present stay at 1, so
 * nothing re-animates when an unrelated part of the board changes.
 */
export function useGrowIn(keys: readonly string[], durationMs = 260) {
  const started = useRef(new Map<string, number>());
  const seen = useRef(new Set<string>());
  const first = useRef(true);
  const [, force] = useState(0);
  const scales = useRef(new Map<string, number>());

  const now = typeof performance === "undefined" ? 0 : performance.now();
  const reduced = prefersReducedMotion();

  // Note new keys. On the very first pass everything is "new", but a board
  // that grows itself on load would be noise rather than feedback.
  for (const key of keys) {
    if (seen.current.has(key)) continue;
    seen.current.add(key);
    if (first.current || reduced) {
      scales.current.set(key, 1);
    } else {
      started.current.set(key, now);
      scales.current.set(key, 0);
    }
  }
  first.current = false;

  // Forget keys that are gone, so a long game does not accumulate them.
  if (seen.current.size > keys.length) {
    const live = new Set(keys);
    for (const key of [...seen.current]) {
      if (live.has(key)) continue;
      seen.current.delete(key);
      started.current.delete(key);
      scales.current.delete(key);
    }
  }

  useFrame(() => {
    if (started.current.size === 0) return;
    const t = performance.now();
    let changed = false;

    for (const [key, at] of [...started.current]) {
      const progress = Math.min(1, (t - at) / durationMs);
      // Back-out easing: a small overshoot reads as weight.
      const eased = overshoot(progress);
      scales.current.set(key, eased);
      changed = true;
      if (progress >= 1) {
        started.current.delete(key);
        scales.current.set(key, 1);
      }
    }

    if (changed) force((n) => n + 1);
  });

  return scales.current;
}

function overshoot(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}
