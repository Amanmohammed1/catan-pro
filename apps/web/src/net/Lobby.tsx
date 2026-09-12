import { useState } from "react";
import type { useConnection } from "./useConnection.js";

/**
 * Create or join a room, then wait for the host to start.
 *
 * Room codes and nicknames only — no accounts (PLAN.md, M2).
 */
export function Lobby({
  net,
}: {
  readonly net: ReturnType<typeof useConnection>;
}): React.JSX.Element {
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(4);

  const room = net.room;
  const you = room?.you ?? null;
  const me = room?.seats.find((s) => s.player === you);
  const isHost = me?.isHost === true;
  const everyoneReady =
    room !== null && room.seats.length > 0 && room.seats.every((s) => s.ready);

  if (room === null) {
    return (
      <div className="centered">
        <div className="panel-card">
          <h1>hexport</h1>
          <p className="sub">Base game. Three to four players.</p>

          <label>
            Your name
            <input
              value={nickname}
              maxLength={24}
              placeholder="Name"
              onChange={(e) => {
                setNickname(e.target.value);
              }}
            />
          </label>

          <label>
            Players
            <select
              value={seats}
              onChange={(e) => {
                setSeats(Number(e.target.value));
              }}
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>

          <button
            className="primary"
            disabled={nickname.trim() === ""}
            onClick={() => {
              net.createRoom(nickname.trim(), seats);
            }}
          >
            Create a room
          </button>

          <div className="divider">or join one</div>

          <label>
            Room code
            <input
              value={code}
              maxLength={5}
              placeholder="ABCDE"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
              }}
            />
          </label>
          <button
            disabled={nickname.trim() === "" || code.length !== 5}
            onClick={() => {
              net.joinRoom(code, nickname.trim());
            }}
          >
            Join
          </button>

          {net.error !== null && (
            <div className="error" onClick={net.dismissError}>
              {net.error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="centered">
      <div className="panel-card">
        <h1>Room {room.code}</h1>
        <p className="sub">
          Share this code. {room.seats.length} of {room.maxPlayers} seated.
        </p>

        <ul className="seats">
          {room.seats.map((seat) => (
            <li key={seat.player}>
              <span className={seat.connected ? "dot on" : "dot"} />
              <span className="pname">
                {seat.nickname}
                {seat.player === you ? " (you)" : ""}
              </span>
              {seat.isHost && <span className="badge">host</span>}
              <span className={seat.ready ? "ready yes" : "ready"}>
                {seat.ready ? "ready" : "waiting"}
              </span>
              {isHost && seat.player !== you && (
                <button
                  className="tiny-button"
                  onClick={() => {
                    net.kick(seat.player);
                  }}
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          className={me?.ready === true ? "on" : ""}
          onClick={() => {
            net.setReady(me?.ready !== true);
          }}
        >
          {me?.ready === true ? "Not ready" : "I'm ready"}
        </button>

        {isHost && (
          <button
            className="primary"
            disabled={!everyoneReady || room.seats.length < 3}
            onClick={net.startGame}
          >
            Start game
          </button>
        )}

        {!isHost && <p className="hint">Waiting for the host to start.</p>}

        <button onClick={net.leave}>Leave</button>

        {net.error !== null && (
          <div className="error" onClick={net.dismissError}>
            {net.error}
          </div>
        )}
      </div>
    </div>
  );
}
