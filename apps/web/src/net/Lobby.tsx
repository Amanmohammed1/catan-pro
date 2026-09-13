import { useState } from "react";
import { Button } from "../ui/Button.js";
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
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            hexport
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Settle, trade, build. Three to four players.
          </p>
        </div>

        {room === null ? <JoinForm net={net} /> : <RoomPanel net={net} />}

        {net.error !== null && (
          <p
            role="alert"
            className="mt-3 rounded-card border border-danger/45 bg-danger/12 px-3 py-2 text-xs text-danger"
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

function JoinForm({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(4);

  const named = nickname.trim() !== "";

  return (
    <div className="rounded-panel border border-surface-700 bg-surface-800/85 p-4 shadow-panel backdrop-blur">
      <Field label="Your name" htmlFor="nickname">
        <input
          id="nickname"
          value={nickname}
          maxLength={24}
          autoComplete="nickname"
          placeholder="Who are you?"
          onChange={(event) => { setNickname(event.target.value); }}
          className="w-full rounded-card border border-surface-600 bg-surface-900/70 px-2.5 py-2 text-sm placeholder:text-ink-700"
        />
      </Field>

      <Field label="Players" htmlFor="seats">
        <div className="flex gap-1.5" role="radiogroup" aria-labelledby="seats-label">
          {[3, 4].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={seats === n}
              onClick={() => { setSeats(n); }}
              className={[
                "flex-1 rounded-card border px-3 py-2 text-sm transition-colors",
                seats === n
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-surface-600 bg-surface-700/60 text-ink-300 hover:bg-surface-600",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Button
        intent="primary"
        disabled={!named}
        reason="Enter a name first"
        onClick={() => { net.createRoom(nickname.trim(), seats); }}
        className="justify-center"
      >
        Create a room
      </Button>

      <div className="my-3 flex items-center gap-2 text-[10px] tracking-[0.12em] text-ink-700 uppercase">
        <span className="h-px flex-1 bg-surface-600" />
        or join one
        <span className="h-px flex-1 bg-surface-600" />
      </div>

      <Field label="Room code" htmlFor="code">
        <input
          id="code"
          value={code}
          maxLength={5}
          placeholder="ABCDE"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => { setCode(event.target.value.toUpperCase()); }}
          className="w-full rounded-card border border-surface-600 bg-surface-900/70 px-2.5 py-2 text-center font-num text-lg tracking-[0.3em] uppercase placeholder:tracking-[0.3em] placeholder:text-ink-700"
        />
      </Field>

      <Button
        disabled={!named || code.length !== 5}
        reason={named ? "A room code is five characters" : "Enter a name first"}
        onClick={() => { net.joinRoom(code, nickname.trim()); }}
        className="justify-center"
      >
        Join
      </Button>
    </div>
  );
}

function RoomPanel({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const room = net.room;
  if (room === null) return <></>;

  const you = room.you;
  const me = room.seats.find((seat) => seat.player === you);
  const isHost = me?.isHost === true;
  const everyoneReady =
    room.seats.length >= 3 && room.seats.every((seat) => seat.ready);

  return (
    <div className="rounded-panel border border-surface-700 bg-surface-800/85 p-4 shadow-panel backdrop-blur">
      <div className="mb-4 text-center">
        <p className="text-[10px] tracking-[0.12em] text-ink-700 uppercase">
          Room code
        </p>
        <p className="font-num text-3xl font-semibold tracking-[0.25em] text-accent">
          {room.code}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {room.seats.length} of {room.maxPlayers} seated
        </p>
      </div>

      <ul className="mb-4 flex flex-col gap-1" aria-label="Players in this room">
        {room.seats.map((seat) => (
          <li
            key={seat.player}
            className="flex items-center gap-2 rounded-card border border-surface-700 bg-surface-700/40 px-2.5 py-2"
          >
            <span
              aria-hidden="true"
              className={[
                "h-2 w-2 shrink-0 rounded-full",
                seat.connected ? "bg-success" : "bg-surface-500",
              ].join(" ")}
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
            <span
              className={[
                "text-[10px] tracking-wide uppercase",
                seat.ready ? "text-success" : "text-ink-700",
              ].join(" ")}
            >
              {seat.ready ? "ready" : "waiting"}
            </span>
            {isHost && seat.player !== you && (
              <button
                type="button"
                onClick={() => { net.kick(seat.player); }}
                className="rounded px-1.5 py-0.5 text-[10px] text-ink-700 transition-colors hover:bg-danger/20 hover:text-danger"
              >
                remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        <Button
          intent={me?.ready === true ? "default" : "primary"}
          onClick={() => { net.setReady(me?.ready !== true); }}
          className="justify-center"
        >
          {me?.ready === true ? "Not ready" : "I'm ready"}
        </Button>

        {isHost && (
          <Button
            intent="primary"
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
            Waiting for {room.seats.find((s) => s.isHost)?.nickname ?? "the host"}{" "}
            to start.
          </p>
        )}

        <Button intent="ghost" onClick={net.leave} className="justify-center">
          Leave
        </Button>
      </div>
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
      <label
        htmlFor={htmlFor}
        id={`${htmlFor}-label`}
        className="mb-1 block text-[10px] tracking-[0.1em] text-ink-700 uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
