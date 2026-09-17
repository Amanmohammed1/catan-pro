import { useCallback, useMemo, useReducer } from "react";
import {
  createGame,
  legalMoves,
  reduce,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "@hexport/engine";
import { loadScenario } from "@hexport/scenarios";

/**
 * Client-side game store for hot-seat play.
 *
 * The client holds a real GameState only because this is hot-seat — everyone is
 * at the same screen, so there is nothing to hide yet. From M2 the server holds
 * the state and this store is replaced wholesale by each redacted snapshot
 * (CLAUDE.md, "Client rules"). Keeping all mutation behind dispatch() now means
 * that swap touches this file and nothing else.
 */

export interface GameStore {
  readonly state: GameState;
  readonly log: readonly LogEntry[];
  readonly error: string | null;
}

export interface LogEntry {
  readonly id: number;
  readonly event: GameEvent;
}

type StoreAction =
  | { readonly t: "dispatch"; readonly action: Action }
  | {
      readonly t: "reset";
      readonly seed: string;
      readonly players: number;
      /** Carried through, or a rematch on a Seafarers board deals a classic one. */
      readonly scenarioId?: string | undefined;
    }
  | { readonly t: "dismissError" };

export interface NewGameOptions {
  readonly seed: string;
  readonly players: number;
  readonly scenarioId?: string;
}

export function startGame(options: NewGameOptions): GameStore {
  // Three or four players share the classic island; five or six need the
  // larger board, which brings the extension's rules with it (ADR 0006). The
  // server makes the same choice for online games.
  const scenario = loadScenario(
    options.scenarioId ?? (options.players > 4 ? "classic-5-6" : "classic-3-4"),
  );
  const state = createGame({
    scenario,
    seed: options.seed,
    playerNames: Array.from(
      { length: options.players },
      (_, i) => `Player ${String(i + 1)}`,
    ),
  });
  return { state, log: [], error: null };
}

function storeReducer(store: GameStore, action: StoreAction): GameStore {
  switch (action.t) {
    case "dispatch": {
      const result = reduce(store.state, action.action);
      if (!result.ok) {
        return { ...store, error: result.reason };
      }
      const nextId = store.log.length;
      const entries = result.events.map((event, i) => ({
        id: nextId + i,
        event,
      }));
      return {
        state: result.state,
        log: [...store.log, ...entries],
        error: null,
      };
    }

    case "reset":
      return startGame({
        seed: action.seed,
        players: action.players,
        ...(action.scenarioId === undefined ? {} : { scenarioId: action.scenarioId }),
      });

    case "dismissError":
      return { ...store, error: null };

    default:
      return store;
  }
}

export function useGame(initial: NewGameOptions) {
  const [store, send] = useReducer(storeReducer, initial, (options: NewGameOptions) =>
    startGame(options),
  );

  const dispatch = useCallback((action: Action) => {
    send({ t: "dispatch", action });
  }, []);

  const reset = useCallback((seed: string, players: number, scenarioId?: string) => {
    send({ t: "reset", seed, players, scenarioId });
  }, []);

  const dismissError = useCallback(() => {
    send({ t: "dismissError" });
  }, []);

  /**
   * Whose input the screen is waiting for.
   *
   * Usually the player whose turn it is, but on a 7 every player over the hand
   * limit has to discard, and during a trade offer every opponent has to answer.
   * Hot-seat means the screen simply follows whoever owes an action.
   */
  const waitingOn: PlayerId[] = useMemo(() => {
    const out: PlayerId[] = [];
    for (const seat of store.state.players) {
      if (legalMoves(store.state, seat.id).length > 0) out.push(seat.id);
    }
    return out;
  }, [store.state]);

  const activePlayer: PlayerId = useMemo(() => {
    if (waitingOn.includes(store.state.currentPlayer)) {
      return store.state.currentPlayer;
    }
    return waitingOn[0] ?? store.state.currentPlayer;
  }, [waitingOn, store.state.currentPlayer]);

  const moves = useMemo(
    () => legalMoves(store.state, activePlayer),
    [store.state, activePlayer],
  );

  return {
    state: store.state,
    log: store.log,
    error: store.error,
    dispatch,
    reset,
    dismissError,
    waitingOn,
    activePlayer,
    moves,
  };
}
