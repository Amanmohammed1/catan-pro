import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@hexport/engine";

/**
 * Turn the event log into short-lived cues.
 *
 * CLAUDE.md golden rule 6: the event log is the animation trigger. Everything
 * that moves — a card flying to a hand, a tile flashing as it produces, a sound
 * — is driven from here rather than from local state, so a spectator, a player
 * who just reconnected and the player who acted all see the same thing, and a
 * client cannot animate something the server did not say happened.
 *
 * A cue is an event plus the moment it arrived. Cues expire on their own, so a
 * component can render "what just happened" without bookkeeping.
 *
 * The log is replaced wholesale on a reconnect snapshot, which would otherwise
 * replay the whole game's worth of animation at once. Anything that arrives in
 * a batch bigger than a turn's worth is treated as history and passes silently.
 */

export interface Cue {
  /** Position in the log; stable, and unique per cue. */
  readonly id: number;
  readonly event: GameEvent;
  /** performance.now() when it arrived. */
  readonly at: number;
}

const DEFAULT_LIFETIME_MS = 1400;
/** More events than one action can produce means history, not news. */
const BATCH_IS_HISTORY = 24;

export function useEventCues(
  log: readonly GameEvent[],
  lifetimeMs = DEFAULT_LIFETIME_MS,
): readonly Cue[] {
  const seen = useRef(0);
  const [cues, setCues] = useState<readonly Cue[]>([]);

  useEffect(() => {
    // A shorter log than last time means a fresh game or a replaced snapshot.
    if (log.length < seen.current) {
      seen.current = log.length;
      setCues([]);
      return;
    }
    if (log.length === seen.current) return;

    const fresh = log.slice(seen.current);
    const startedAt = seen.current;
    seen.current = log.length;

    // The first snapshot, or a reconnect, delivers history in one go.
    if (startedAt === 0 || fresh.length > BATCH_IS_HISTORY) return;

    const now = typeof performance === "undefined" ? 0 : performance.now();
    const arrived: Cue[] = fresh.map((event, index) => ({
      id: startedAt + index,
      event,
      at: now,
    }));

    setCues((current) => [...current, ...arrived]);
  }, [log]);

  // Expire cues on a single timer rather than one per cue.
  useEffect(() => {
    if (cues.length === 0) return;
    const handle = window.setTimeout(() => {
      const now = typeof performance === "undefined" ? 0 : performance.now();
      setCues((current) => current.filter((cue) => now - cue.at < lifetimeMs));
    }, lifetimeMs);
    return () => {
      window.clearTimeout(handle);
    };
  }, [cues, lifetimeMs]);

  return cues;
}

/** The most recent cue of a kind, if it is still live. */
export function latestCue<K extends GameEvent["e"]>(
  cues: readonly Cue[],
  kind: K,
): Extract<GameEvent, { e: K }> | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i];
    if (cue?.event.e === kind) return cue.event as Extract<GameEvent, { e: K }>;
  }
  return null;
}

/** Tiles that just paid out, for a brief highlight on the board. */
export function producingTiles(
  cues: readonly Cue[],
  tilesFor: (roll: number) => readonly string[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const cue of cues) {
    if (cue.event.e !== "diceRolled") continue;
    for (const tile of tilesFor(cue.event.total)) out.add(tile);
  }
  return out;
}
