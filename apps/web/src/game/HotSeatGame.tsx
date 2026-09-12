import { useMemo } from "react";
import { legalMoves, playerView, type PlayerId } from "@hexport/engine";
import type { WireView } from "@hexport/protocol";
import { GameScreen } from "./GameScreen.js";
import { useGame } from "./useGame.js";
import type { GameSession } from "./session.js";

/**
 * Hot-seat: one screen, every seat.
 *
 * The view handed to the screen still goes through playerView(), even though
 * nothing is really hidden when everyone shares a monitor. That keeps one code
 * path for both modes, and means a redaction bug shows up here too rather than
 * only online.
 */
export function HotSeatGame({
  seed,
  players,
}: {
  readonly seed: string;
  readonly players: number;
}): React.JSX.Element {
  const game = useGame({ seed, players });

  const session: GameSession = useMemo(() => {
    const seat: PlayerId = game.activePlayer;
    const full = playerView(game.state, seat);
    const { board, ...rest } = full;
    const view: WireView = {
      ...rest,
      legalMoves: legalMoves(game.state, seat),
    };

    return {
      board,
      view,
      log: game.log.map((entry) => entry.event),
      error: game.error,
      hotSeat: true,
      dispatch: game.dispatch,
      dismissError: game.dismissError,
    };
  }, [
    game.state,
    game.log,
    game.error,
    game.activePlayer,
    game.dispatch,
    game.dismissError,
  ]);

  return <GameScreen session={session} />;
}
