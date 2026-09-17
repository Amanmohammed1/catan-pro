import { Howl, Howler } from "howler";
import buildUrl from "@hexport/assets/audio/build.ogg";
import cardUrl from "@hexport/assets/audio/card.ogg";
import cityUrl from "@hexport/assets/audio/city.ogg";
import clickUrl from "@hexport/assets/audio/click.ogg";
import diceUrl from "@hexport/assets/audio/dice.ogg";
import stealUrl from "@hexport/assets/audio/steal.ogg";
import tradeUrl from "@hexport/assets/audio/trade.ogg";
import turnUrl from "@hexport/assets/audio/turn.ogg";
import victoryUrl from "@hexport/assets/audio/victory.ogg";

/**
 * Sound.
 *
 * Short CC0 recordings from Kenney, vendored in `packages/assets/audio` with
 * the licence beside them, imported by URL so Vite bundles and fingerprints
 * them. Nothing is fetched from anyone else's server at runtime.
 *
 * Playback is triggered from the event stream (`useEventCues`), never from a
 * click handler, so what you hear matches what the server said happened.
 *
 * Every clip is optional: a file that will not load degrades to silence rather
 * than an error, because none of this is load-bearing. Browsers also refuse to
 * start audio before a gesture — anything asked for before the first click is
 * dropped rather than queued, since a burst of stale dice the moment someone
 * clicks is worse than silence.
 */

export type SoundName =
  | "dice"
  | "build"
  | "city"
  | "card"
  | "trade"
  | "steal"
  | "turn"
  | "victory"
  | "click";

const SOURCES: Record<SoundName, string> = {
  dice: diceUrl,
  build: buildUrl,
  city: cityUrl,
  card: cardUrl,
  trade: tradeUrl,
  steal: stealUrl,
  turn: turnUrl,
  victory: victoryUrl,
  click: clickUrl,
};

/** Per-clip gain, so one pack's loud dice do not drown a quieter click. */
const GAIN: Record<SoundName, number> = {
  dice: 0.9,
  build: 0.85,
  city: 0.9,
  card: 0.6,
  trade: 0.7,
  steal: 0.8,
  turn: 0.45,
  victory: 1,
  click: 0.3,
};

const loaded = new Map<SoundName, Howl>();
let unlocked = false;
let enabled = true;

/** Mark audio as usable. Called on the first real interaction. */
export function unlockAudio(): void {
  unlocked = true;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    Howler.mute(!on);
  } catch {
    /* no audio context yet; the next play() will respect `enabled` anyway */
  }
}

export function setSoundVolume(level: number): void {
  try {
    Howler.volume(Math.min(1, Math.max(0, level)));
  } catch {
    /* as above */
  }
}

function clip(name: SoundName): Howl | null {
  const existing = loaded.get(name);
  if (existing !== undefined) return existing;

  try {
    const howl = new Howl({
      src: [SOURCES[name]],
      format: ["ogg"],
      volume: GAIN[name],
      preload: true,
      // A clip that will not load is not worth reporting every time it is asked
      // for; the game is fully playable in silence.
      onloaderror: () => {
        loaded.delete(name);
      },
    });
    loaded.set(name, howl);
    return howl;
  } catch {
    return null;
  }
}

/** Play a clip, if sound is on and the browser has let us start. */
export function play(name: SoundName): void {
  if (!enabled || !unlocked) return;
  try {
    clip(name)?.play();
  } catch {
    /* silence is an acceptable outcome for a sound effect */
  }
}

/** Warm the cache for the clips a game uses constantly. */
export function preloadCommon(): void {
  if (!enabled) return;
  for (const name of ["dice", "build", "card", "turn"] as const) clip(name);
}
