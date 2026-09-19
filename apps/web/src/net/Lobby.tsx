import { useMemo, useState } from "react";
import { PLAYABLE_SCENARIO_IDS, loadScenario } from "@hexport/scenarios";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";
import { Wordmark } from "../ui/Wordmark.js";
import { SEAT_COLORS } from "../three/palette.js";
import type { useConnection } from "./useConnection.js";

/**
 * Create or join a room, then wait for the host to start.
 *
 * Room codes and nicknames only, no accounts (PLAN.md, M2). The code is the
 * thing people read aloud to each other, so it gets to be the largest element
 * on the screen once a room exists.
 */
export function Lobby({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const room = net.room;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden p-4">
      <Backdrop />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <Wordmark size="lg" />
          <p className="mt-2 text-sm text-ink-300">
            Settle an island. Trade shrewdly. Most points wins.
          </p>
          <p className="mt-1 text-xs text-ink-700">
            Three to six players, online or around one screen.
          </p>
        </div>

        {room === null ? <JoinForm net={net} /> : <RoomPanel net={net} />}

        {net.error !== null && (
          <p
            role="alert"
            className="mt-3 rounded-[11px] border border-danger/45 bg-danger/12 px-3 py-2 text-xs text-danger"
          >
            {net.error}{" "}
            <button
              type="button"
              onClick={net.dismissError}
              className="underline underline-offset-2"
            >
              dismiss
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The name of a board, from its id.
 *
 * Falls back to the id rather than throwing: a server may be running a scenario
 * this client does not know about, and a room that shows a bare id is far
 * better than a lobby that will not render.
 */
function boardName(scenarioId: string): string {
  try {
    return loadScenario(scenarioId).name;
  } catch {
    return scenarioId;
  }
}

/** A faint field of hexes behind the panel. Decorative. */
function Backdrop(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.07]"
    >
      <svg width="100%" height="100%">
        <defs>
          <pattern id="hexes" width="56" height="97" patternUnits="userSpaceOnUse">
            <path
              d="M28 0 56 16v32L28 64 0 48V16z"
              fill="none"
              stroke="var(--color-gold)"
              strokeWidth="1.5"
            />
            <path
              d="M0 48 28 64v33M56 48 28 64"
              fill="none"
              stroke="var(--color-gold)"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hexes)" />
      </svg>
    </div>
  );
}

function JoinForm({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const [nickname, setNickname] = useState("");
  // `?join=ABCDE` fills the code in, so a room can be shared as a link — which
  // is how `pnpm bots` hands you its room.
  const [code, setCode] = useState(() => {
    try {
      return (new URLSearchParams(window.location.search).get("join") ?? "")
        .toUpperCase()
        .slice(0, 5);
    } catch {
      return "";
    }
  });
  const [seats, setSeats] = useState(4);
  const [bots, setBots] = useState(0);
  const [board, setBoard] = useState<string | null>(null);

  /**
   * Boards this seat count can actually play.
   *
   * Filtered rather than listed flat, because the ranges genuinely differ: the
   * Seafarers three-player map seats exactly three, the 5–6 island needs five.
   * Offering a board the server would refuse is worse than not offering it.
   */
  const boards = useMemo(
    () =>
      PLAYABLE_SCENARIO_IDS.map((id) => ({ id, scenario: loadScenario(id) })).filter(
        ({ scenario }) =>
          seats >= scenario.players.min && seats <= scenario.players.max,
      ),
    [seats],
  );

  // A board chosen for one seat count may not survive a change of mind.
  const chosen = boards.some((b) => b.id === board) ? board : null;

  const named = nickname.trim() !== "";
  // You take one seat; the rest can be bots, or left open for people.
  const maxBots = seats - 1;
  const wanted = Math.min(bots, maxBots);

  return (
    <div className="panel p-4">
      <Field label="Your name" htmlFor="nickname">
        <input
          id="nickname"
          value={nickname}
          maxLength={24}
          autoComplete="nickname"
          placeholder="Who are you?"
          onChange={(event) => {
            setNickname(event.target.value);
          }}
          className="w-full rounded-[11px] border border-gold/20 bg-surface-900/70 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-700"
        />
      </Field>

      <Field label="Players" htmlFor="seats">
        <div className="flex gap-1.5" role="radiogroup" aria-labelledby="seats-label">
          {[3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={seats === n}
              // Five and six seat the larger island, with a building window
              // between turns for everyone else.
              title={
                n > 4
                  ? `${String(n)} players — the larger island, with special building`
                  : `${String(n)} players`
              }
              onClick={() => {
                setSeats(n);
              }}
              className={[
                "flex-1 rounded-[11px] border py-2.5 font-num text-base font-semibold transition-colors",
                seats === n
                  ? "border-gold/60 bg-gold/15 text-gold"
                  : "border-gold/15 bg-surface-700/60 text-ink-300 hover:bg-surface-600",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Bots" htmlFor="bots">
        <div className="flex gap-1.5" role="radiogroup" aria-labelledby="bots-label">
          {Array.from({ length: seats }, (_, n) => n).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={wanted === n}
              data-bots={n}
              title={
                n === 0
                  ? "People only — share the code and wait for them"
                  : `${String(n)} seat${n === 1 ? "" : "s"} played by the server`
              }
              onClick={() => {
                setBots(n);
              }}
              className={[
                "flex-1 rounded-[11px] border py-2 font-num text-sm font-semibold transition-colors",
                wanted === n
                  ? "border-gold/60 bg-gold/15 text-gold"
                  : "border-gold/15 bg-surface-700/60 text-ink-300 hover:bg-surface-600",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-700">
          {wanted === 0
            ? `${String(seats)} seats for people.`
            : `${String(wanted)} bot${wanted === 1 ? "" : "s"}, ${String(seats - wanted - 1)} seat${
                seats - wanted - 1 === 1 ? "" : "s"
              } left for people besides you. You can add more in the room.`}
        </p>
      </Field>

      {/* Always shown, even when the seat count leaves only one board. It used
          to be hidden below two options, which meant picking five or six seats
          made the whole field vanish — reading as "no boards" rather than "one
          board". A control that disappears cannot explain itself. */}
      <Field label="Board" htmlFor="board">
        {boards.length === 1 && (
          <p className="mb-1.5 text-[11px] text-ink-700">
            The only board built for this many seats. The Seafarers maps seat three or
            four; their five and six player versions are a separate expansion we have
            not built yet.
          </p>
        )}
        <div
          className="flex flex-col gap-1.5"
          role="radiogroup"
          aria-labelledby="board-label"
        >
          {boards.map(({ id, scenario }) => {
            const picked = chosen === null ? boards[0]?.id === id : chosen === id;
            const seafaring = scenario.modules.includes("seafarers");
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={picked}
                data-board={id}
                title={
                  seafaring
                    ? `${scenario.name} — ships, gold fields and the pirate; ${String(scenario.victoryPoints)} points to win`
                    : `${scenario.name} — ${String(scenario.victoryPoints)} points to win`
                }
                onClick={() => {
                  setBoard(id);
                }}
                className={[
                  "rounded-[11px] border px-3 py-2 text-left text-sm transition-colors",
                  picked
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-gold/15 bg-surface-700/60 text-ink-300 hover:bg-surface-600",
                ].join(" ")}
              >
                {scenario.name}
                <span className="ml-2 text-[11px] opacity-70">
                  {scenario.victoryPoints} points
                  {seafaring ? " · ships" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Button
        intent="primary"
        data-action="create-room"
        disabled={!named}
        reason="Enter a name first"
        onClick={() => {
          // Null means "whatever suits this seat count", which is the server's
          // own default — so it is sent as nothing at all.
          net.createRoom(nickname.trim(), seats, wanted, chosen ?? undefined);
        }}
        className="justify-center"
      >
        Create a room
      </Button>

      <Divider>or join one</Divider>

      <Field label="Room code" htmlFor="code">
        <input
          id="code"
          value={code}
          maxLength={5}
          placeholder="ABCDE"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
          }}
          className="w-full rounded-[11px] border border-gold/20 bg-surface-900/70 px-3 py-2.5 text-center font-num text-xl font-semibold tracking-[0.3em] text-ink-100 uppercase placeholder:text-ink-700"
        />
      </Field>

      <Button
        data-action="join-room"
        disabled={!named || code.length !== 5}
        reason={named ? "A room code is five characters" : "Enter a name first"}
        onClick={() => {
          net.joinRoom(code, nickname.trim());
        }}
        className="justify-center"
      >
        Join
      </Button>

      <Divider>on your own</Divider>

      <Button
        intent="ghost"
        data-action="hot-seat"
        onClick={() => {
          window.location.href = `?hotseat=1&players=${String(seats)}`;
        }}
        className="justify-center"
      >
        Play on this screen
      </Button>
    </div>
  );
}

function RoomPanel({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const room = net.room;
  if (room === null) return <></>;

  const you = room.you;
  const me = room.seats.find((seat) => seat.player === you);
  const isHost = me?.isHost === true;
  const everyoneReady =
    room.seats.length >= 3 && room.seats.every((seat) => seat.ready);

  return (
    <div className="panel p-4">
      <div className="mb-4 text-center">
        <p className="eyebrow">Room code</p>
        <p className="font-display text-4xl font-bold tracking-[0.22em] text-gold">
          {room.code}
        </p>
        {/* Which board this room is on. The host chose it before the room
            existed and everyone else never saw that choice, so without this a
            joiner has no way to know they are about to play Seafarers. */}
        <p data-room-board={room.scenarioId} className="mt-1 text-xs text-ink-500">
          {boardName(room.scenarioId)}
        </p>
        <div className="mt-1.5 flex items-center justify-center gap-2 text-xs text-ink-500">
          <span>
            {room.seats.length} of {room.maxPlayers} seated
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(room.code).then(
                () => {
                  setCopied(true);
                },
                () => {
                  /* clipboard blocked; the code is on screen anyway */
                },
              );
            }}
            className="rounded px-1.5 py-0.5 text-gold/80 underline underline-offset-2 hover:text-gold"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>

      <ul className="mb-4 flex flex-col gap-1.5" aria-label="Players in this room">
        {room.seats.map((seat) => (
          <li
            key={seat.player}
            className="flex items-center gap-2.5 rounded-[11px] border border-gold/12 bg-surface-700/50 px-2.5 py-2"
          >
            <Avatar
              seat={seat.player}
              color={SEAT_COLORS[seat.player % SEAT_COLORS.length] ?? "#888"}
              size={26}
            />
            <span className="flex-1 truncate text-sm">
              {seat.nickname}
              {seat.player === you && <span className="text-ink-500"> (you)</span>}
            </span>
            {seat.isHost && (
              <span className="rounded bg-surface-600 px-1.5 py-0.5 text-[10px] text-ink-300">
                host
              </span>
            )}
            {seat.isBot && (
              <span
                className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold"
                title="Played by the server"
              >
                bot
              </span>
            )}
            <span
              className={[
                "text-[10px] font-semibold tracking-[0.1em] uppercase",
                seat.ready ? "text-success" : "text-ink-700",
              ].join(" ")}
            >
              {seat.ready ? "ready" : "waiting"}
            </span>
            {!seat.connected && (
              <span className="text-[10px] text-ink-700" title="Not connected">
                away
              </span>
            )}
            {isHost && seat.player !== you && (
              <button
                type="button"
                data-action={seat.isBot ? "remove-bot" : "kick"}
                onClick={() => {
                  if (seat.isBot) net.removeBot(seat.player);
                  else net.kick(seat.player);
                }}
                className="rounded px-1.5 py-0.5 text-[10px] text-ink-700 transition-colors hover:bg-danger/20 hover:text-danger"
              >
                remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        {isHost && room.seats.length < room.maxPlayers && (
          <Button data-action="add-bot" onClick={net.addBot} className="justify-center">
            Add a bot
          </Button>
        )}

        <Button
          intent={me?.ready === true ? "default" : "primary"}
          data-action="ready"
          onClick={() => {
            net.setReady(me?.ready !== true);
          }}
          className="justify-center"
        >
          {me?.ready === true ? "Not ready" : "I'm ready"}
        </Button>

        {isHost && (
          <Button
            intent="primary"
            data-action="start-game"
            disabled={!everyoneReady}
            reason={
              room.seats.length < 3
                ? "Needs at least three players"
                : "Everyone has to be ready"
            }
            onClick={net.startGame}
            className="justify-center"
          >
            Start the game
          </Button>
        )}

        {!isHost && (
          <p className="py-1 text-center text-xs text-ink-500">
            Waiting for {room.seats.find((s) => s.isHost)?.nickname ?? "the host"} to
            start.
          </p>
        )}

        <Button
          intent="ghost"
          data-action="leave"
          onClick={net.leave}
          className="justify-center"
        >
          Leave
        </Button>
      </div>
    </div>
  );
}

function Divider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="my-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-ink-700 uppercase">
      <span className="h-px flex-1 bg-gold/15" />
      {children}
      <span className="h-px flex-1 bg-gold/15" />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-3">
      <label htmlFor={htmlFor} id={`${htmlFor}-label`} className="eyebrow mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  );
}
