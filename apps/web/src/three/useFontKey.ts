import { useEffect, useState } from "react";

const FACE = `700 100px "Fraunces Variable"`;

function loaded(): boolean {
  try {
    return document.fonts.check(FACE);
  } catch {
    return false;
  }
}

/**
 * A key that changes once the display face has loaded.
 *
 * Number tokens and harbour signs are painted to canvas, and a canvas painted
 * before the web font arrives keeps its fallback serif forever. Textures are
 * cached by this key, so the first paint is replaced by the real one.
 */
export function useFontKey(): string {
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    if (ready) return;
    let live = true;
    document.fonts
      .load(FACE)
      .then(() => {
        if (live) setReady(true);
      })
      .catch(() => {
        /* keep the fallback face; the board is still legible */
      });
    return () => {
      live = false;
    };
  }, [ready]);

  return ready ? "fraunces" : "fallback";
}
