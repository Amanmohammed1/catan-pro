# Handover

Written for a session with no memory of how any of this got here. Read this
before CLAUDE.md if you are picking the project up cold; CLAUDE.md says what the
rules are, this says what is actually true.

Branch: `m6-seafarers`, cut from `m4-polish`. `main` is at the end of M2. M3,
M4, M5 and most of M6 are complete and committed, but nothing has been merged.

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

Bots came with it, in two places at once: the lobby offers a bot count when you
create a room (the server plays those seats), and `pnpm bots` opens a room from
a terminal. Both use the same policy in `packages/bots`, so they cannot drift.

**Not done:**

- **Spectator mode.** `WireView.you` is a seat id that every panel reads;
  making it nullable touches the whole client. Deferred deliberately rather than
  half-built. The server side is the smaller half: let a socket join a started
  room without a seat and send it a view redacted for nobody.
- **Frame rate on a low-powered machine** has still never been measured.
- A stolen card does not physically fly between player cards; the theft is
  announced, sounded and logged.

### M6 — Seafarers: mostly complete

See `docs/milestones/M6.md`. The rule module interface was widened first
(ADR 0007), then the mechanics:
ships, the pirate, gold fields, island victory points, and a Longest Route that
counts roads and ships joined at your own buildings. Heading for New Shores and
Through the Desert are built for both player counts, generated from the
rulebook's Variable Setup tables rather than transcribed from its diagrams
(ADR 0008), and `packages/scenarios/src/seafarers-board.test.ts` checks each one
against the rulebook's own composition table rather than merely checking it
parses.

The client draws all of it — the sea renders as water rather than as blue land,
ships float on it, the pirate sails — and `?hotseat=1&scenario=new-shores-4`
reaches a board without a server.

Registering those boards let the fuzzer reach the Seafarers rules for the first
time and it found three defects at once: roads could be laid on edges already
carrying a ship, a ship did not connect a settlement (which made games
unwinnable rather than merely wrong), and the harness could not tell a stuck
game from a long one. All three are fixed; ADR 0008 records them.

The Fog Islands is built too, and it is the one that needed new machinery: a
board that changes during play. `hiddenStacks` is real hidden information now,
`playerView` sends counts alone, and the server's leak test plays a Fog Islands
board rather than a classic one — on the classic board that assertion would pass
over an empty set. ADR 0009 records the board-replacement decision and the
`afterAction` hook it needed.

It also found that **`setup.placeOn` had been declared, validated and ignored
since M0**. No earlier board could show it: they are all land, or they confine
the opening to a named island. Fog Islands sets no island restriction, and the
fuzzer stalled twenty games out of twenty on a settlement placed at an
intersection ringed by sea, where no setup road is legal.

**Not done:** Four Islands is **declined rather than pending**: p.6 gives every
player their own home islands, and a scenario pins one `vpForFirstSettlement`
per island for everyone, so generating it would produce a board that scores
wrongly while looking fine. ADR 0008 says what it would take. `startingPieces`
is declared, validated and ignored, and Seafarers p.3 needs it. Revealing a gold
field pays no card yet — ADR 0009 says why.

M7 (Cities & Knights) onward: not started.

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

Eight ADRs, in `docs/adr/`. The newest matter most:

- **0007** — widening the rule module interface, and why expansion actions stay
  in the engine's central unions rather than the unions being made open.
- **0008** — Seafarers as implemented: ships, the open-end rule, island points
  derived rather than tracked, the boards coming from the Variable Setup
  tables, and the three bugs the first fuzz run found.
- **0009** — The Fog Islands: why a reveal replaces the board rather than
  overlaying it, why an unrevealed neighbour makes an edge coastal (it is forced
  by p.8, not chosen), the `afterAction` hook, and the one rule the rulebooks do
  not settle — how many spaces a single placement uncovers.

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
those editions describe a _different_ turn rule from the one we implement.
Everything that could not be cited is written down in ADR 0006 instead of
quietly invented.

**Shuffled tokens made a constraint 10× harder.** The red-number rule cleared
about two attempts in five on the classic board but one in twenty-five on the
5–6 board, so one game in two thousand could not lay a board at all inside the
200-attempt cap. It is 2000 now.

**Generated data is Prettier-formatted, and the directory is Prettier-ignored.**
Regenerate the boards and you get a 200-line whitespace diff unless you follow
with `prettier --ignore-path /dev/null --write packages/scenarios/data`.

**A rule can be fully implemented and still be unplayable.** `moveShip` had an
engine reducer, a placement predicate, its own unit tests and ten thousand
fuzzed games — and no route to the DOM, so nobody could ever do it. The comment
where the control should have been claimed it was "reachable from the action
list", which is what kept anyone from checking. `apps/web/src/game/domRoutes.ts`
is now a compile-time `Record` over the whole `Action` union: a new action will
not build until somebody states how a player reaches it. Keep it honest — an
entry of `"none"` fails the suite on purpose.

**Check what the test driver never does.** `drive()` in `uiDriver.tsx` is what
every slow-lane UI test plays through, and for a whole milestone it never
clicked a ship control. Both Seafarers UI bugs lived in that blind spot. When
adding an expansion, teach the driver its new controls first — otherwise the
tests will keep passing over the parts nobody wrote a line for.

**An engine test cannot see a wire bug.** The Fog Islands reveal worked
perfectly in the engine, had twenty-one passing tests, and was invisible to
every player: the board shipped once in the snapshot and updates omitted it, so
a hex turned face up on the server and nowhere else. The test client cached it
the same way, so any test asserting on `client.board` would have passed on stale
data too. Anything that changes state the client caches needs a test that reads
the frames, not just the state — `server.test.ts` has one now.

**A rule can be wrong while everything is green.** Road Building offered only
roads for the whole of M6; Seafarers p.3 allows "2 roads, 2 ships, or 1 road and
1 ship". The card is base-game machinery and the ship is a module's, and no test
covered the seam. Fuzzing cannot find this class of bug: a game where the card
does less than it should still finishes cleanly.

**Never pipe a long background run through `tail`.** The fuzzer and
`pnpm shots` both print progress as they go, and `… | tail -16` buffers all of
it until the process exits — so an hour-long run looks identical to a wedged
one, and the only signals left are `ps` cpu-time and file mtimes. A Seafarers
fuzz at 10,000 games takes around an hour (they run at ~3 games/s against
classic's 34), which is long enough that the difference matters. Redirect
instead, and read the tail of the file when you want a checkpoint.

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
pnpm test          # fast lane, 679 tests, ~19s
pnpm test:slow     # whole-game runs over real sockets, ~26s
pnpm shots         # headless screenshots into .shots/ — then look at them
pnpm shots --scenario new-shores-4 --turns 400   # a Seafarers board, played on

# --turns matters: setup alone cannot show a ship, because ships are bought in
# the main phase. It prints the actions it took, so you can tell whether the
# state you are looking at contains the thing you are checking.
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
fast lane     679 tests in 27 files, ~19s
slow lane      17 tests in 6 files, ~26s
fuzz          classic  10,000 games, 10.19M actions, 0 stalled, ~114s
              5 players 10,000 games, 19.48M actions, 0 stalled, ~214s
              6 players 10,000 games, 22.39M actions, 0 stalled, ~278s
              new-shores-4   10,000 games, 17.14M actions, 0 stalled, 1 exhausted
              new-shores-3   10,000 games, 17.55M actions, 0 stalled
              desert-4       10,000 games, 18.83M actions, 0 stalled, 2 exhausted
              desert-3       10,000 games, 19.21M actions, 0 stalled
              fog-islands-4  10,000 games, 14.59M actions, 0 stalled
              fog-islands-3  10,000 games, 14.17M actions, 0 stalled
              wins spread evenly across every seat on all nine
              Seafarers boards run at ~3 games/s, so each takes about an hour
board         classic 19 tiles / 54 nodes / 72 edges / 9 harbours
              5-6     30 tiles / 80 nodes / 109 edges / 11 harbours
              new-shores-4   46 cells (28 land, 18 sea), 9 harbours
              desert-4       48 cells (30 land, 18 sea), 9 harbours
```

---

## 8. Where to pick up

Branches, oldest first. Each was cut from the one above it, and none is merged:

```
main            end of M2
m3-3d-client      the two visual bugs + pnpm shots; the warm-tabletop redesign
m5-five-six       rule modules, the 30-hex board, Special Building Phase
m4-polish         animation + sound, counter-offers, log highlighting,
                  rematch, and bots (lobby + pnpm bots)   <- newest
```

**Decisions waiting on the owner**

- **Merging.** `main` is still at M2. The three branches are linear, so
  fast-forwarding `main` to `m4-polish` is the whole job — but ask first.
- **The 5–6 number discs.** No rulebook in `docs/rules/` prints which value is
  on each lettered disc, so the game shuffles the printed composition instead
  (ADR 0006). If the physical box is to hand, reading off A→Zc turns that into a
  data-only change: swap `tokens` for `sequence` and the mode for `path`.

**The obvious next pieces of work**

1. **Spectator mode** (the one M4 item not done). `WireView.you` is a seat id
   every panel reads; making it nullable is the whole job. The server half is
   smaller: let a socket join a started room without a seat, and send it a view
   redacted for nobody.
2. **Measure the frame rate** on a low-powered machine. Never done. The meter is
   in the bar (Stats) and `PerformanceMonitor` already drops effects on decline.
3. **Rooms do not survive a server restart** — the M2 gap. `store.ts` and
   `Match.replay` are the two pieces to wire together. Note that `tsx watch`
   restarts on every save, so this bites during development too: a live room
   disappears the moment you edit a server file.
4. **M6, Seafarers.** The board format was built for it (ADR 0001, edge `kind`,
   islands, hidden stacks) and `RuleModule` now exists (ADR 0005). The first
   real test of whether that interface is right.

**Before calling any visual work done:** run `pnpm shots` and look at the
pictures. That is the check that was missing when the client shipped unreadable.
