# Handover

Written for a session with no memory of how any of this got here. Read this
before CLAUDE.md if you are picking the project up cold; CLAUDE.md says what the
rules are, this says what is actually true.

Branch: `m5-five-six`, cut from `m3-3d-client`. `main` is at the end of M2. M3
and M5 are complete and committed, but nothing has been merged.

---

## 1. What exists, honestly

PLAN.md lists ten milestones. Six are done: M0, M1, M2, M3, M5, and the rule
module interface that M7 will need.

### M0 — geometry: complete

Board graph, seeded PRNG, scenario format, and a 2D SVG renderer (still alive at
`?debug=1`). Classic board builds 19 tiles, 54 nodes, 72 edges.

**One acceptance criterion in PLAN.md is wrong.** It says "every node has 2–3
adjacent tiles". A frameless 19-tile board has 18 rim nodes touching exactly
one. The real distribution is `{1: 18, 2: 12, 3: 24}` and the test asserts that
exact shape.

### M1 — base game rules: complete

Full rules with rulebook page citations in the code. `pnpm fuzz` passes 10,000
self-play games with invariants checked after every action.

### M2 — online multiplayer: complete except one thing

Server, wire protocol, redaction, reconnect, turn timer, host kick, chat,
Postgres persistence, dice fairness commitment.

**Gap:** rooms live in the process. A server restart loses the lobby. The
command log survives in Postgres and `Match.replay` rebuilds state from it, but
nothing reattaches a running room to a restarted process. `store.ts` and
`Match.replay` are the two pieces you would wire together.

### M3 — the 3D client: complete

See `docs/milestones/M3.md`. The board is a warm tabletop: painted terrain with
props, upright number tokens, outlined pieces, a wooden frame and sea, harbour
signs, warm light with bloom and vignette, and a camera that fits the board to
any window. The interface around it was rebuilt to match, with OFL fonts,
original card art and a layout that stacks below 900px.

**Not done, carried to M4:** no sound at all (howler is not installed), no
event-driven animation, and the frame rate has still never been measured on a
low-powered machine.

**No glTF models, on purpose.** ADR 0004: everything is generated in code, so
the repository holds no binary art and the game works offline.

### M5 — 5–6 players: complete

See `docs/milestones/M5.md`. Rule modules (ADR 0005), the 30-hex board, the
bigger supply, and the Special Building Phase (ADR 0006). Fuzzed 10,000 games at
both five and six players.

### M4 — polish: complete except spectators

See `docs/milestones/M4.md`. Animation and sound driven by the event stream,
counter-offers with a click-to-build trade panel, a log that lights up the board
when you hover a line, and rematch.

**Not done:**

- **Spectator mode.** `WireView.you` is a seat id that every panel reads;
  making it nullable touches the whole client. Deferred deliberately rather than
  half-built. The server side is the smaller half: let a socket join a started
  room without a seat and send it a view redacted for nobody.
- **Frame rate on a low-powered machine** has still never been measured.
- A stolen card does not physically fly between player cards; the theft is
  announced, sounded and logged.

M6 (Seafarers) onward: not started.

---

## 2. Where everything lives

```
packages/engine/        PURE. no runtime dependencies, enforced three ways
  src/geometry/         coords, ids, layout, buildBoardGraph, types
  src/rng/              sfc32, seeded and serializable
  src/state/            GameState, resource arithmetic, invariants
  src/actions/          the Action union
  src/events/           the Event union
  src/phases/           the phase machine (a tagged union, never booleans)
  src/modules/          rule modules: base, ext56, and the registry
  src/setup/            createGame
  src/queries/          legalMoves, longestRoad, scores, placement, playerView
  src/reducers/         reduce, production, special cards

packages/bots/          how a bot picks its move. shared by the server and the harness
packages/protocol/      zod schemas for the wire. depends on engine for types only
packages/scenarios/     board data as JSON + the zod schema that validates it
apps/server/            Fastify + ws + optional Postgres
apps/web/               the client
  src/three/            the 3D board: geometry, painted textures, scene, effects
  src/ui/               interface components, and cards/ for the card art
  src/store/            zustand, for saved interface settings only
  src/game/             screen composition, hot-seat session
  src/net/              WebSocket client, lobby, online session
apps/bot-runner/        headless self-play, `pnpm fuzz`
scripts/                board generation, purity guards, screenshots
```

### The files that matter

- `packages/engine/src/reducers/reduce.ts` (~1200 lines). Every rule that
  changes state. If a rule is wrong, it is wrong here.
- `packages/engine/src/queries/legalMoves.ts`. The single source of truth for
  what is possible. The UI, the bots, the fuzzer and the reducer all defer to it.
- `packages/engine/src/modules/`. Small, and the thing M6 and M7 hang off.
- `apps/web/src/game/GameScreen.tsx`. Composes the whole interface.
- `apps/web/src/three/textures.ts` and `geometries.ts`. Everything the board is
  made of, since none of it is a shipped asset.
- `apps/server/src/server.ts`. All socket handling and all redaction.

---

## 3. Decisions you would not guess from the code

Six ADRs, in `docs/adr/`. The three newest matter most:

- **0004** — the board is painted in code, not shipped as art. No binary assets,
  OFL fonts from npm, and a local Lightformer environment rather than drei's
  CDN-fetched HDR preset.
- **0005** — rule modules. A scenario names them; `GameConfig.modules` carries
  them into saved state; the base game is one too.
- **0006** — the 5–6 extension: the Special Building Phase as implemented (no
  rulebook we hold describes it), and why number tokens come from a bag rather
  than the box's lettered order.

Older ones: **0001** vertex identity is the sorted triple of hex coordinates,
never a rounded world position. **0002** the TypeScript 6 pin. **0003**
`offerTrade` is validated rather than enumerated, so the fuzzer never exercises
domestic trade and `reducers/trade.test.ts` carries that weight alone.

### Other choices

- **Hot-seat goes through `playerView()` too**, so a redaction bug cannot hide
  behind "it only matters online".
- **Seat tokens are in `sessionStorage`,** not localStorage: two tabs should be
  two players.
- **Number tokens and harbour signs are canvas textures**, repainted once the
  display font loads (`three/useFontKey.ts`).
- **Tile geometry is extruded from the engine's own corner offsets**, not a
  six-sided cylinder whose rotation would have to be guessed.
- **`PlacementList` is not a fallback.** Every legal placement is also a DOM
  button. The UI tests drive the game entirely through it, so the keyboard and
  screen-reader path is exercised on every run.
- **Tests find controls by `data-action` and `data-count`**, never by label or
  class name, so restyling cannot break them.

---

## 4. Bugs, hacks and loose ends

**Known issues**

- Rooms do not survive a server restart (see M2 above).
- A player kicked mid-game is disconnected and auto-passed rather than removed,
  because seat numbers key the command log.
- `apps/web/src/game/__snapshot.test.tsx` is a dev tool, not a test. It no-ops
  unless `HEXPORT_SNAPSHOT_DIR` is set.
- The Postgres path is tested against PGlite (real Postgres, in-process) but has
  never run against a real server with a `DATABASE_URL`.
- `three/Placement.tsx` mounts one `<group>` per legal spot. Fine at 54, worth
  instancing before the larger Seafarers boards.
- Paired players (the official replacement for the Special Building Phase) is
  not implemented — ADR 0006.

**Hacks worth knowing**

- `~/.local/bin/pnpm` on this machine is a hand-written shim, and that directory
  is not on `PATH` by default. corepack 0.30.0 cannot launch pnpm ≥ 11.
- `pnpm-workspace.yaml` approves builds for `unrs-resolver` and `esbuild`.
- The jsdom WebSocket tests inject `ws` as the global.
- `vitest.config.ts` has a `css.include` for `theme.css` alone, because vitest
  blanks CSS it does not process and `theme.test.ts` reads the tokens as text.

---

## 5. Things that went wrong once

Read this section. Each of these cost real time.

**The engine purity guard was enforcing nothing.** A `categories.noneOf`
selector matched no file that had no category at all, so every boundary policy
silently stopped applying and lint passed on an engine file importing
`node:fs`. `scripts/verify-boundary-fires.mjs` now fails the build if the guard
stops reporting. **Never trust a guard you have not watched fail.**

**Road Building before the roll swallowed the dice.** Found by reading the phase
machine, not by fuzzing: 10,000 games missed it because nothing about it breaks
an invariant. Fuzzing finds crashes and invariant breaks, not rules that are
merely wrong.

**The initial snapshot leaked the whole game history.** `sendSnapshot` sent
`match.log` raw. Caught by a test that greps the actual bytes sent for
`devDeck`, `rng` and opponent hands. Keep that test.

**The client shipped looking broken while every test passed.** A stylesheet leak
painted text near-black on near-black, and a height mismatch buried every number
token and road inside the tiles. 383 tests were green. Tests check behaviour;
nothing checked the picture. `pnpm shots` exists for that now — run it and
actually look at the output.

**A guessed rulebook is worse than a missing one.** The 5–6 extension's lettered
number discs are not printed in either edition in `docs/rules/`, and both of
those editions describe a *different* turn rule from the one we implement.
Everything that could not be cited is written down in ADR 0006 instead of
quietly invented.

**Shuffled tokens made a constraint 10× harder.** The red-number rule cleared
about two attempts in five on the classic board but one in twenty-five on the
5–6 board, so one game in two thousand could not lay a board at all inside the
200-attempt cap. It is 2000 now.

**Generated data is Prettier-formatted, and the directory is Prettier-ignored.**
Regenerate the boards and you get a 200-line whitespace diff unless you follow
with `prettier --ignore-path /dev/null --write packages/scenarios/data`.

**Test drivers that match text against the whole screen will wedge.** Scope to
`[data-panel="actions"]` and key off `[data-prompt]`.

**A greedy test driver never finishes a game.** Always taking the first legal
move spends brick and lumber on roads — exactly what settlements need. Take
cheap wins first, then choose randomly, and let it bank-trade.

**Two clients sharing one jsdom document share storage.** Each mounted client
needs its own `storageKey`.

---

## 6. How to run it

```bash
corepack enable                      # see the pnpm shim note above
export PATH="$HOME/.local/bin:$PATH"
pnpm install
```

**Play it**

```bash
pnpm --filter @hexport/server dev    # game server on :8787
pnpm dev                             # client on :5173, proxies /ws
```

Open two _windows_ (not tabs — tabs share a session). Create a room in one, join
with the code in the other.

- `http://localhost:5173/` — online play, 3 to 6 seats
- `?hotseat=1` — every seat on one screen, no server needed
- `?hotseat=1&players=6` — the larger island, with special building
- `?debug=1` — the M0 geometry renderer with node and edge ids
- `?fx=1` — force post-processing on, even on a software renderer

**Bots to play against**

Two ways, one brain (`packages/bots`), so they play the same either way:

- **From the lobby.** Creating a room offers a bot count, and the host can add
  or remove bots while the room waits. The server plays those seats itself, on
  the same tick the turn timer runs on, from the same legal-move list a player
  would be sent — a bot can do nothing a player could not, and sees nothing a
  player could not.
- **From a terminal.** `pnpm bots` opens a room, seats three bots, prints a
  join link, and deals another board a few seconds after each win.

```bash
pnpm bots                       # 3 bots and a seat for you
pnpm bots --players 6 --bots 5
```

**Checks**

```bash
pnpm verify        # lint, typecheck, both purity guards, both test lanes
pnpm test          # fast lane, 513 tests, ~11s
pnpm test:slow     # whole-game runs over real sockets, ~14s
pnpm shots         # headless screenshots into .shots/ — then look at them
pnpm shots --players 6
```

**Fuzzer**

```bash
pnpm fuzz                                              # 10,000 classic games
pnpm fuzz --games 10000 --players 6 --scenario classic-5-6
pnpm fuzz --games 500 --players 3
pnpm fuzz --fast                                       # skip invariant checks
```

A failure prints the seed. Reproduce with `--games 1` and that seed.

**Regenerating board data**

```bash
node scripts/generate-classic-scenario.mjs
pnpm exec prettier --ignore-path /dev/null --write packages/scenarios/data
```

---

## 7. Current numbers

```
fast lane     513 tests in 22 files, ~11s
slow lane       9 tests, ~14s
fuzz          classic  10,000 games, 10.19M actions, 0 stalled, ~114s
              5 players 10,000 games, 19.48M actions, 0 stalled, ~214s
              6 players 10,000 games, 22.39M actions, 0 stalled, ~278s
              wins spread evenly across every seat in all three
board         classic 19 tiles / 54 nodes / 72 edges / 9 harbours
              5-6     30 tiles / 80 nodes / 109 edges / 11 harbours
```
