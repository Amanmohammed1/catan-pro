# CLAUDE.md — Project Constitution

Read this before every task. These rules are not negotiable.

**New session?** Read `docs/HANDOVER.md` first. This file says what the rules
are; that one says what is actually built, what is missing, and what has already
gone wrong once.

## What we are building

A web-based, online multiplayer hex-trading board game. Base game plus expansion
modules (Seafarers, Cities & Knights, Traders & Barbarians) and the 5–6 player
extension. 3D board, server-authoritative rules, 3–6 players, private rooms.

Reference for feel and UX quality: colonist.io. Reference for rules correctness:
the official rulebook PDFs in `docs/rules/`.

**Codename:** `hexport` (placeholder). Do not use the trademarked game name,
official artwork, logos, or card art anywhere in the repo, UI, or package names.
All art must be original or CC0/CC-BY. Card effect text must be written in our
own words, not copied from the rulebook. Game _mechanics_ are fine to implement;
the _expression_ (art, text, name, logo) is not ours to copy.

## Golden rules

1. **The engine is pure.** `packages/engine` has zero runtime dependencies.
   No React, no three.js, no `fs`, no `Date.now()`, no `Math.random()`, no
   network. Only pure functions over plain data. An ESLint boundary rule
   enforces this — do not disable it. Three mechanisms back it up, and all three
   run in `pnpm verify`: the `boundaries/dependencies` policies in
   `eslint.config.js`, `scripts/verify-engine-pure.mjs` (the manifest declares no
   dependencies), and `scripts/verify-boundary-fires.mjs` (the guard still
   reports every violation type). That last one exists because the policies were
   once silently disabled by a selector that matched nothing, and lint passed on
   an engine file importing `node:fs`. A guard nobody has watched fail is not a
   guard.
2. **The server is the only authority.** Clients send `Command`s. They never
   compute outcomes. Any client-side "prediction" is display-only and must be
   overwritten by server state.
3. **`legalMoves()` is the single source of truth.** The UI derives every
   enabled button and every highlighted board spot from it. Bots pick from it.
   Tests fuzz from it. The reducer rejects anything not in it. If you find
   yourself writing a legality check in the UI or the server, stop — it belongs
   in the engine.

   Online, the client cannot run it: a redacted view knows neither the deck nor
   the other hands nor the generator state. The server computes the list and
   sends it in `WireView.legalMoves`. One documented exception to enumeration,
   `offerTrade`, is validated by the reducer instead — ADR 0003.

4. **Determinism.** All randomness comes from a seeded PRNG stored inside
   `GameState`. Same seed + same action list = byte-identical state. Always.
5. **Hidden information is redacted server-side.** `playerView(state, playerId)`
   strips other players' hands, the dev/progress deck order, and face-down
   tiles. Never send full state to a client. Assume every player has devtools
   open.
6. **Event-sourced.** Every mutation emits typed `Event`s. The event log is the
   game log, the animation trigger, the replay format, and the reconnect
   mechanism. Append-only, persisted.
7. **Expansions are modules, not `if` statements.** No
   `if (config.expansion === 'ck')` scattered through the code. Rules plug in
   through the `RuleModule` hook interface. Even while only the base game
   exists, route base rules through the same interface.
8. **Tests before polish.** A milestone is not done until its fuzz test passes
   10,000 self-play games with no crash, no negative resource counts, no bank
   overdraft, no infinite game.

## Repo layout

```
apps/
  web/            React + Vite + react-three-fiber client        [exists]
  server/         Node + ws + Fastify, authoritative             [exists]
  bot-runner/     headless self-play harness                     [exists]
packages/
  engine/         PURE. rules, state, geometry, legalMoves       [exists]
  protocol/       zod schemas for the wire format                [exists]
  scenarios/      data-driven board definitions (JSON)           [exists]
  bots/           how a bot picks its move (server + harness)    [exists]
  ui/             shared DOM components                          [not yet]
  assets/         audio (CC0). Everything visual is generated
                  in code instead — ADR 0004                     [exists]
docs/
  HANDOVER.md     state of the project, read this first
  rules/          rulebook PDFs (reference only, gitignored)
  adr/            architecture decision records
  milestones/     one file per milestone, with acceptance criteria
```

Web client internals: `src/three/` the 3D board, `src/ui/` interface
components, `src/game/` screen composition and hot-seat, `src/net/` the socket
client and lobby. UI components live in `apps/web/src/ui/` rather than
`packages/ui/` until a second client needs them.

## Engine internals

```
packages/engine/src/
  geometry/     axial+cube hex math, board graph builder (tiles/nodes/edges)
  rng/          sfc32 seeded PRNG, serialized into state
  state/        GameState types + zod schemas
  actions/      Action discriminated union
  queries/      legalMoves, scores, longestRoad, largestArmy, playerView
  reducers/     reduce(state, action) => { state, events }
  phases/       explicit phase state machine (no boolean flags)
  modules/      base/, seafarers/, ck/, tb/, ext56/
```

Phase is an explicit tagged union, never a set of booleans:

```ts
type Phase =
  | { k: 'setup'; round: 1 | 2; order: PlayerId[]; idx: number; sub: 'settlement' | 'road' }
  | { k: 'roll' }
  | { k: 'discard'; pending: PlayerId[] }
  | { k: 'moveRobber'; by: PlayerId; reason: 'seven' | 'knight' }
  | { k: 'steal'; by: PlayerId; targets: PlayerId[] }
  | { k: 'main' }
  | { k: 'tradeOffer'; offer: TradeOffer; responses: Record<PlayerId, Response> }
  | { k: 'roadBuilding'; remaining: 1 | 2 }
  | { k: 'specialBuild'; player: PlayerId }
  | { k: 'ckBarbarianResolve'; ... }
  | { k: 'gameOver'; winner: PlayerId }
```

## Board geometry

Build the board graph **once** at game creation, then store it in state. Do not
do hex math at runtime.

- Tiles: axial coords `(q, r)`, terrain, number token, port refs.
- Nodes (intersections): identity is the canonical **sorted triple of the three
  hex coordinates** meeting at that corner — integer arithmetic, never a rounded
  world position. Each node stores adjacent tile ids, node ids, edge ids.
- Edges: identity is the sorted pair of the two node ids. Stores two node ids +
  adjacent tile ids + `kind: 'land' | 'sea' | 'coast'` (needed for Seafarers
  ships from day one — the field is populated now even though only `land` is used).

World positions are rendering output only (`geometry/layout.ts`). Nothing in the
identity path may read them: ids are persisted in the event log from M2 onward,
so changing hex size or orientation in the 3D client must not invalidate a saved
game. See `docs/adr/0001-vertex-edge-identity.md`.

Reference: Red Blob Games hex grid guide (redblobgames.com/grids/hexagons).

## RuleModule interface

```ts
interface RuleModule {
  id: string;
  setupState?(ctx: SetupCtx): void;
  interceptAction?(s: GameState, a: Action): Action | Rejection | null;
  onPhaseEnter?(s: GameState, p: Phase): Effect[];
  onDiceRoll?(s: GameState, roll: Roll): Effect[];
  extraLegalMoves?(s: GameState, p: PlayerId): Action[];
  scoreContribution?(s: GameState, p: PlayerId): number;
  reducers?: Partial<Record<ActionKind, Reducer>>;
}
```

Game config: `{ modules: ['base', 'seafarers', 'ck'], playerCount: 6, scenario: 'heading-for-new-shores' }`.
Cities & Knights sets the win threshold to 13 and swaps the dev deck for progress
cards — that is module data, not an `if`.

## Client rules

- 3D is a **view of engine state**. It holds no game logic.
- Zustand for client-only state (selected card, camera, panel open/closed).
- Server state lives in one store, replaced wholesale on each snapshot.
- All text, cards, chat, trade UI, and logs are **DOM overlay**, not WebGL text.
- Click targets are invisible proxy meshes (spheres at nodes, capsules at edges),
  ~1.5× the visual size, mounted only when a placement mode is active.
- Highlight every legal spot when entering a build mode. Show a translucent ghost
  piece on hover, tinted red when illegal.
- Use instancing for repeated meshes (roads, settlements, tiles). Never one
  draw call per piece.
- `OrbitControls` with clamped polar angle and bounded pan. Never free-fly.
- Target: 60 fps on a 5-year-old laptop with integrated graphics. Measure it.

## Dice and fairness

Server rolls with the seeded PRNG. It publishes `sha256(seed)` at game start and
reveals `seed` at game end so anyone can verify. The client plays a canned
animation that lands on the server's result — it never generates the number.

## Testing requirements

- `vitest` for unit tests. `fast-check` for property tests.
- Longest road gets its own dedicated suite of at least 30 cases, including
  branches, loops, and roads broken by an opponent settlement.
- Invariants asserted after every reduce in dev builds: resource conservation,
  bank never negative, piece stock never negative, VP recomputable from scratch.
- `pnpm fuzz` runs N headless random-legal games and must exit clean.
- `playwright` for one end-to-end happy-path game across 3 browser contexts.

## Commands

```bash
pnpm install
pnpm --filter @hexport/server dev   # game server on :8787
pnpm dev                            # client on :5173, proxies /ws

pnpm bots                           # a room of bots to play against
pnpm bots --players 6 --bots 5

pnpm verify                         # lint, typecheck, purity guards, both lanes
pnpm test                           # fast lane (~11s)
pnpm test:slow                      # whole-game runs over real sockets (~14s)
pnpm fuzz                           # 10,000 self-play games (~114s)
pnpm fuzz --games 500 --players 3
pnpm fuzz --games 10000 --players 6 --scenario classic-5-6
pnpm shots                          # headless screenshots into .shots/
pnpm shots --scenario new-shores-4  # a Seafarers board
pnpm shots --turns 400              # play past setup, so ships appear
```

Bots can also be added from the lobby when creating a room: the server plays
those seats itself, from the same legal-move list a player is sent.

**Look at what you changed.** `pnpm shots` renders the real client in a headless
browser. Tests check behaviour; nothing else checks the picture, and the client
once shipped with every number token buried inside the tiles and every heading
drawn black-on-black while 383 tests passed.

Client modes, by query string: default is online, `?hotseat=1` plays every seat
on one screen, `?debug=1` is the M0 geometry renderer.

Two browser _windows_ for two players. Tabs share a session, windows do not.

`pnpm verify` must pass before a milestone is done. It runs both purity guards:
one asserts the engine declares no runtime dependencies, the other asserts the
lint rule enforcing that still _reports_. The second exists because the rule was
once silently enforcing nothing.

## Pinned versions, and why

Check the registry before changing any of these. Three are pinned below latest
on purpose:

| Package          | Pinned | Why not latest                                            |
| ---------------- | ------ | --------------------------------------------------------- |
| typescript       | 6.0.3  | typescript-eslint 8.70.0 caps at `<6.1.0` (ADR 0002)      |
| react, react-dom | 19.2.8 | react-three-fiber 9.7.0 caps at `<19.3`                   |
| r3f-perf         | absent | still needs drei 9 / React 18; see `three/FrameMeter.tsx` |

Otherwise current: three 0.186, @react-three/fiber 9.7, drei 10.7.8, vite 8.3,
vitest 5, eslint 10.10, tailwindcss 4.3.3, zod 4.6.2, fastify 5.12.4, ws 8.21.3,
drizzle-orm 0.45.2, pnpm 12.4.1, node >= 22.13.

## Conventions

- **Test lanes.** Anything that plays a whole game or spawns a process is named
  `*.slow.test.ts` and runs in `pnpm test:slow`. The fast lane stays usable.
- **Test hooks are data attributes**, never class names: `data-prompt`,
  `data-panel`, `data-placement`, `data-winner`. Styling changes must not break
  tests.
- **Every disabled control says why**, via `title`. A test enforces it.
- **Colour is never the only signal.** Resources carry a glyph, players carry a
  name. Check `prefers-reduced-motion` in anything that animates.
- **Every legal move is reachable from the DOM**, not only by clicking the 3D
  board. `PlacementList` is that route, and the UI tests drive the game through
  it — so the keyboard and screen-reader path is exercised on every run.
- Design tokens live in `apps/web/src/theme.css`. No component invents a colour.

## Working style

- One milestone per branch. Read `docs/milestones/Mx.md` before starting.
- Use plan mode for anything touching more than 3 files. Show me the plan first.
- Write the test first for rules code. Rules bugs found by players are expensive.
- Check current versions of every package before pinning. Do not assume the
  versions in your training data are current.
- When a rule is ambiguous, read `docs/rules/` and cite the page in a code
  comment. Do not guess. If the PDFs are missing, ask me rather than inventing.
- Record any non-obvious decision as an ADR in `docs/adr/`.
- Never commit binary art assets without a `LICENSE.txt` next to them naming the
  source and license.
