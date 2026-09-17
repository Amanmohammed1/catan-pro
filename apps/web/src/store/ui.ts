import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * Client-only interface settings (CLAUDE.md, "Client rules": Zustand for
 * client-only state).
 *
 * Only preferences live here — things that are the same for this person in
 * every game. Per-game state such as the armed build mode stays in the game
 * screen's React state: the online tests mount several clients in one
 * document, and a global store would have them share one another's mode.
 */

export type EffectsSetting = "auto" | "off";

export interface UiSettings {
  /** Show every legal placement as a list, not only on the board. */
  readonly listView: boolean;
  readonly showStats: boolean;
  /** Post-processing and ambient motion on the board. */
  readonly effects: EffectsSetting;
  /** The log drawer on narrower screens. */
  readonly logOpen: boolean;
  /** Set by the renderer when the frame rate cannot hold; not persisted. */
  readonly lowPower: boolean;

  readonly toggleListView: () => void;
  readonly toggleStats: () => void;
  readonly setEffects: (value: EffectsSetting) => void;
  readonly setLogOpen: (open: boolean) => void;
  readonly setLowPower: (value: boolean) => void;
}

/**
 * localStorage, or nothing. Private windows and locked-down browsers throw on
 * access; a preference that cannot be saved must never break the game.
 */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      /* not persisted; the setting still applies for this session */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* nothing to remove */
    }
  },
};

export const useUi = create<UiSettings>()(
  persist(
    (set) => ({
      listView: false,
      showStats: false,
      effects: "auto",
      logOpen: false,
      lowPower: false,

      toggleListView: () => {
        set((s) => ({ listView: !s.listView }));
      },
      toggleStats: () => {
        set((s) => ({ showStats: !s.showStats }));
      },
      setEffects: (value) => {
        set({ effects: value });
      },
      setLogOpen: (open) => {
        set({ logOpen: open });
      },
      setLowPower: (value) => {
        set({ lowPower: value });
      },
    }),
    {
      name: "hexport.ui",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ listView: s.listView, effects: s.effects }),
    },
  ),
);
