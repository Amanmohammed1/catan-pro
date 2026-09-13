# Handover

Written for a session with no memory of how any of this got here. Read this
before CLAUDE.md if you are picking the project up cold; CLAUDE.md says what the
rules are, this says what is actually true.

Branch: `m3-3d-client`. `main` is at the end of M2. M3 is complete and committed
but not merged.

---

## 1. What exists, honestly

PLAN.md lists ten milestones. Four are done.

### M0 — geometry: complete

Board graph, seeded PRNG, scenario format, and a 2D SVG renderer (still alive at
`?debug=1`). Classic board builds 19 tiles, 54 nodes, 72 edges.

**One acceptance criterion in PLAN.md is wrong.** It says "every node has 2–3
adjacent tiles". A frameless 19-tile board has 18 rim nodes touching exactly
one. The real distribution is `{1: 18, 2: 12, 3: 24}` and the test asserts that
exact shape. Adding the Seafarers sea ring in M6 turns all 54 into 3-cell nodes.

### M1 — base game rules: complete

Full rules with rulebook page citations in the code. `pnpm fuzz` passes 10,000
self-play games, invariants checked after all 10.19M actions.

Implemented: setup snake draft, production with the bank-shortage rule, the 7
(discard/robber/steal), building and the distance rule, all five development
cards with correct timing, Longest Road including the almanac's tie rules,
Largest Army, maritime and domestic trade, win-on-your-turn-only.

### M2 — online multiplayer: complete except one thing

Server, wire protocol, redaction, reconnect, turn timer, host kick, chat,
Postgres persistence, dice fairness commitment.

**Gap:** rooms live in the process. A server restart loses the lobby. The
command log survives in Postgres and `Match.replay` rebuilds state from it, but
nothing reattaches a running room to a restarted process. `store.ts` and
`Match.replay` are the two pieces you would wire together.

### M3 — 3D client: mostly complete

3D board, instanced pieces, lighting, animations, a redesigned interface,
accessibility work.

**Not done, from PLAN.md's M3 list:**

- No sound at all. Howler is not installed.
- No postprocessing effects. `@react-three/postprocessing` is installed but
  unused — I pinned it and never reached for it.
- No glTF models. Every piece is procedural geometry built in
  `three/geometries.ts`. Kenney's Hexagon Kit is still the plan.
- `zustand` and `motion` are installed but **unused**. Client state is
  `useState` and `useReducer`; animation is `useFrame` and CSS. Either adopt
  them or remove them — right now they are dead weight in the lockfile.
- No narrow-screen layout. The grid assumes a desktop width.
- Frame rate has not been measured on a low-powered machine. The meter exists
  (Stats button, top bar) but nobody has run it on integrated graphics.

### M4 onward: not started.

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
  src/setup/            createGame
  src/queries/          legalMoves, longestRoad, scores, placement, playerView
  src/reducers/         reduce, production, special cards

packages/protocol/      zod schemas for the wire. depends on engine for types only
packages/scenarios/     board data as JSON + the zod schema that validates it
apps/server/            Fastify + ws + optional Postgres
apps/web/               the client
  src/three/            the 3D board
  src/ui/               interface components
  src/game/             screen composition, hot-seat session
  src/net/              WebSocket client, lobby, online session
apps/bot-runner/        headless self-play, `pnpm fuzz`
```

### The files that matter

Big and central, read these first:

- `packages/engine/src/reducers/reduce.ts` (~1100 lines). Every rule that
  changes state. One switch over the Action union. If a rule is wrong, it is
  wrong here.
- `packages/engine/src/queries/legalMoves.ts`. The single source of truth for
  what is possible. The UI, the bots, the fuzzer and the reducer all defer to it.
- `packages/engine/src/queries/longestRoad.ts`. Small but subtle. 52 tests.
- `apps/web/src/game/GameScreen.tsx`. Composes the whole interface.
- `apps/web/src/ui/ActionBar.tsx` (~700 lines). Every contextual control.
- `apps/server/src/server.ts`. All socket handling and all redaction.

Small and easy to skip:

- `three/palette.ts`, `ui/icons.tsx`, `ui/Button.tsx` — presentational only.
- `three/Water.tsx`, `three/Harbors.tsx` — decoration, no logic.
- `engine/src/state/helpers.ts` — arithmetic.
- `apps/web/src/debug.css` — styles for the `?debug=1` view only. Untouched by
  the design system on purpose.

---

## 3. Decisions you would not guess from the code

### Deviations from CLAUDE.md

**Vertex identity.** CLAUDE.md originally said to dedupe corners by rounding
world position to 3 decimals. It now says the opposite, because I changed it.
Identity is the sorted triple of the three hex coordinates meeting at a corner —
integer-exact, and stable when rendering constants change. That matters because
ids are persisted in the command log from M2 onward, so a camera or hex-size
tweak in M3 must not invalidate saved games. ADR 0001. **The user approved this
before I wrote it.**

**`legalMoves` does not enumerate everything.** `offerTrade` is the one
exception: the space of offers is every pair of resource multisets. There is a
`canOfferTrade()` predicate instead, and `reduce()` validates the contents just
as strictly. ADR 0003. Consequence: the fuzzer never exercises domestic trade,
so `reducers/trade.test.ts` carries that weight alone.

**The server sends `legalMoves` over the wire.** A client holds a redacted view
and _cannot_ compute legal moves — it does not know the deck, the other hands,
or the generator state. `WireView.legalMoves` is computed server-side. Golden
rule 3 survives the network; the UI still derives every control from the list, it
just no longer produces it.

### Version pins that are not arbitrary

- **TypeScript 6.0.3, not 7.0.2.** typescript-eslint 8.70.0 caps at `<6.1.0`.
  Taking 7 would mean no type-aware linting and a degraded purity guard. ADR 0002.
- **React 19.2.8, not 19.3.0.** react-three-fiber 9.7.0 declares
  `react: >=19 <19.3`. There is no newer fiber.
- **r3f-perf is deliberately absent.** PLAN.md names it; 7.2.3 still depends on
  drei 9, which wants React 18. `three/FrameMeter.tsx` replaces it.

### Other choices

- **Hot-seat goes through `playerView()` too.** It does not need redaction —
  everyone shares a screen — but routing both modes through one shape means a
  leak cannot hide behind "it only matters online".
- **Seat tokens are in `sessionStorage`, not `localStorage`.** localStorage is
  shared across tabs, so a second tab resumed the first tab's seat and kicked it
  off the socket. Two tabs should be two players.
- **Number token faces are canvas textures**, not a font. Avoids shipping and
  loading a webfont, and gives exact control over the red 6 and 8.
- **Tile geometry is extruded from the engine's own corner offsets**, not a
  six-sided cylinder. A cylinder needs its rotation guessed and a guess 30° out
  puts every settlement on the wrong corner.
- **`PlacementList` is not a fallback.** The board is WebGL, so clicking a mesh
  is unreachable by keyboard and invisible to a screen reader. Every legal
  placement is also a DOM button, described as "Forest 11, Hills 4 and Pasture
  6". It is offered to everyone because it is often more precise.

---

## 4. Bugs, hacks and loose ends

**Known issues**

- Rooms do not survive a server restart (see M2 above).
- A player kicked mid-game is disconnected and auto-passed rather than removed,
  because seat numbers key the command log.
- `apps/web/src/game/__snapshot.test.tsx` is a dev tool, not a test. It no-ops
  unless `HEXPORT_SNAPSHOT_DIR` is set. It dumps the board to SVG for visual
  review.
- The Postgres path is tested against PGlite (real Postgres, in-process) but has
  never run against a real server with a `DATABASE_URL`.
- `three/Placement.tsx` mounts one `<group>` per legal spot. Fine at 54, likely
  worth instancing before the larger Seafarers boards.

**Hacks worth knowing**

- `~/.local/bin/pnpm` on this machine is a hand-written shim, not corepack's.
  corepack 0.30.0 cannot launch pnpm ≥11 — it hardcodes `bin/pnpm.cjs`, which
  pnpm renamed to `.mjs`. Upgrade corepack and the shim can go.
- `pnpm-workspace.yaml` approves builds for `unrs-resolver` (native resolver the
  lint boundary needs) and `esbuild` (backs tsx, which runs the fuzzer).
- The jsdom WebSocket tests inject `ws` as the global. Vitest's jsdom replaces
  the global `Event` class but leaves Node's WebSocket, so Node builds a jsdom
  Event and then refuses it.

---

## 5. Things that went wrong once

Read this section. Each of these cost real time.

**The engine purity guard was enforcing nothing.** I wrote the test-file
exemption as a `from.file.categories.noneOf: ["test"]` selector. That selector
matches no file which has _no_ category at all — so every policy silently
stopped applying and `pnpm lint` passed on an engine file importing `node:fs`
and `zod`. It only surfaced because the plan called for deliberately watching
the guard fail. `scripts/verify-boundary-fires.mjs` now fails the build if the
guard stops reporting. **Never trust a guard you have not watched fail.**

**Road Building before the roll swallowed the dice.** A development card is
legal before rolling (p.7), but the phase returned to `main` when the free roads
were placed, skipping the roll and everyone's production. 10,000 fuzz games
missed it because nothing about it breaks an invariant. Found by reading the
phase machine. The lesson: fuzzing finds crashes and invariant breaks, not rules
that are merely _wrong_.

**The initial snapshot leaked the whole game history.** Live updates were
redacted; `sendSnapshot` sent `match.log` raw. Any reconnecting player received
every stolen card and every development card drawn. Caught by a test that greps
the actual bytes sent for `devDeck`, `rng` and opponent hands, rather than
asserting on the shape of the view. Keep that test.

**Test drivers that match text against the whole screen will wedge.** The UI
driver decided its phase by `text(el).includes("Discard")`. Once "Discard
required: Player 3" scrolled into the game log, that matched forever and the
game stuck on turn 105. Scope to `[data-panel="actions"]` and key off
`[data-prompt]`.

**A greedy test driver never finishes a game.** Always taking the first legal
move spends brick and lumber on roads — exactly what settlements need — so
nobody ever scores. 19,000 clicks, no winner. Take cheap wins first, then choose
randomly, and let it bank-trade.

**Two clients sharing one jsdom document share storage.** Multiple mounted
clients each need their own `storageKey`, or the second resumes the first's
seat. This is the same bug as the real localStorage one, which is how I found it.

**Prettier reformats config files between edits.** More than one scripted
`str.replace` silently did nothing because the target had been re-wrapped. Check
the file after patching, not just the exit code.

---

## 6. How to run it

```bash
corepack enable            # see the pnpm shim note above
pnpm install
```

**Play it**

```bash
pnpm --filter @hexport/server dev     # game server on :8787
pnpm dev                              # client on :5173, proxies /ws
```

Open two _windows_ (not tabs — tabs share a session). Create a room in one, join
with the code in the other.

- `http://localhost:5173/` — online play
- `?hotseat=1` — every seat on one screen, no server needed
- `?debug=1` — the M0 geometry renderer with node and edge ids
- `?hotseat=1&seed=foo&players=3` — a specific board

**Checks**

```bash
pnpm verify        # lint, typecheck, both purity guards, both test lanes
pnpm test          # fast lane, 383 tests, ~11s
pnpm test:slow     # whole-game runs over real sockets, ~80s
pnpm typecheck
pnpm lint
```

**Fuzzer**

```bash
pnpm fuzz                                  # 10,000 games, ~114s
pnpm fuzz --games 500 --players 3
pnpm fuzz --scenario tiny-island
pnpm fuzz --fast                           # skip per-action invariant checks
```

A failure prints the seed. Reproduce with `--games 1` and that seed.

**Bots to play against**

There is no committed bot harness for the server. During development I used a
throwaway script that opened a room, seated two bot clients, and waited for a
human. If you need it again, it is ~80 lines: connect over `ws`, `createRoom`,
`joinRoom`, `setReady`, then play `view.legalMoves[0]` whenever the list is
non-empty. Worth committing properly under `apps/bot-runner` next time.

**Board snapshot**

```bash
HEXPORT_SNAPSHOT_DIR=/tmp pnpm exec vitest run apps/web/src/game/__snapshot.test.tsx
```

---

## 7. Current numbers

```
fast lane     383 tests, ~11s
slow lane       9 tests, ~80s
fuzzer      10,000 games, 10.19M actions, 0 stalled, ~114s
            wins by seat {0: 2510, 1: 2433, 2: 2546, 3: 2511}
build       three 782 kB, app 580 kB (202 kB + 176 kB gzipped)
```
