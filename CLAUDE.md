# CLAUDE.md — Project Constitution

Read this before every task. These rules are not negotiable.

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
  web/            React + Vite + react-three-fiber client
  server/         Node + ws + Fastify, authoritative
  bot-runner/     headless self-play harness
packages/
  engine/         PURE. rules, state, geometry, legalMoves, reducers
  protocol/       zod schemas for Command / Event / StateView
  scenarios/      data-driven board + rule definitions (JSON)
  ui/             shared DOM components
  assets/         glTF models, textures, audio (CC0 / original only)
docs/
  rules/          official rulebook PDFs (reference only, gitignored)
  adr/            architecture decision records
  milestones/     one file per milestone, with acceptance criteria
```

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
