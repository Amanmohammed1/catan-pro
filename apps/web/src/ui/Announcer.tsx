import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@hexport/engine";
import { describeEvent } from "../game/describeEvent.js";

/**
 * Spoken commentary for screen readers.
 *
 * The board is a canvas and is marked decorative, so someone using a screen
 * reader learns what happened here. The region is polite, not assertive: it
 * should not interrupt a player mid-sentence while they read their own hand.
 *
 * Only the newest few events are announced. Replaying a whole game log every
 * time the component re-renders would be unusable.
 */
export function Announcer({
  log,
  names,
}: {
  readonly log: readonly GameEvent[];
  readonly names: readonly string[];
}): React.JSX.Element {
  const seen = useRef(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (log.length <= seen.current) {
      // The log was replaced wholesale, e.g. by a reconnect snapshot.
      if (log.length < seen.current) seen.current = log.length;
      return;
    }

    const fresh = log.slice(seen.current);
    seen.current = log.length;

    const lines = fresh
      .map((event) => describeEvent(event, names))
      .filter((line) => line !== "");

    if (lines.length === 0) return;
    // Cap it: a burst of production events should not read out for a minute.
    setMessage(lines.slice(-4).join(". "));
  }, [log, names]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
