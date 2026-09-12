# Build Plan

Ten milestones. Each one is a branch. Each one ends with something you can run.
Do not skip ahead — M3 (3D) is much cheaper after M1 because the engine is pure.

The single most important decision: **build an ugly 2D SVG debug renderer first.**
It takes half a day, it makes rules debugging ten times faster, and it stays in
the repo forever as a dev tool. The 3D client is then a pure view swap.

---

## M0 — Skeleton and geometry

**Goal:** a board graph you can look at.

- pnpm workspaces + Turborepo monorepo, TypeScript strict, ESLint boundary rule
  that fails the build if `packages/engine` imports React, three, or node builtins.
- `packages/engine/geometry`: axial/cube hex math, `buildBoardGraph(scenario)`
  returning `{ tiles, nodes, edges }` with full adjacency precomputed.
- `packages/scenarios`: classic 3–4 player board as JSON data — tile bag, number
  token sequence, port list, layout coordinates. Nothing hardcoded in code.
- Seeded PRNG (sfc32), serialized into state.
- Ugly 2D SVG renderer in `apps/web` that draws the graph with node/edge ids.

**Done when:** you can regenerate a random valid board, see it, and the same seed
always produces the same board.

**Prompt:**

> Read CLAUDE.md and docs/milestones/M0.md. Plan first, then implement M0. Use
> cube coordinates per the Red Blob Games guide. Dedupe vertex ids by rounding
> world coordinates. Edges must carry a `kind` field (`land`/`sea`/`coast`) even
> though only `land` is used now. Write unit tests asserting: 19 tiles, 54 nodes,
> 72 edges for the classic board; every node has 2–3 adjacent tiles; every edge
> has exactly 2 nodes; adjacency is symmetric. Then add the SVG debug renderer.

---

## M1 — Base game rules, complete

**Goal:** a correct, fully playable base game, hot-seat, in ugly 2D.

- `GameState`, `Action` union, `Event` union, zod schemas.
- Explicit phase machine. Setup snake draft, roll, discard on 7, robber, steal,
  build, bank/port trade, player trade, dev cards, end turn.
- `legalMoves(state, playerId)` covering every phase.
- Longest road (graph longest-path with opponent-settlement breaks), largest army,
  VP calculation, win check.
- All five dev card types with correct timing rules (one per turn, not the turn
  bought, knight-before-roll allowed).
- Invariant assertions in dev builds.
- Self-play fuzz harness: 10,000 random-legal games, clean exit.

**Done when:** `pnpm fuzz` passes 10k games and you can finish a full hot-seat
game in the 2D renderer without a rules dispute.

**Prompt:**

> Implement M1. Write tests before implementation for every rule. Start with the
> longest-road module and give it its own suite of at least 30 cases including
> branching roads, loops, and roads split by an opponent settlement. Then the
> phase machine, then legalMoves, then reducers. Add the fuzz harness in
> apps/bot-runner. After each sub-task run the full test suite and the fuzzer.
> Cite the rulebook page in a comment for any rule that is easy to get wrong.

---

## M2 — Online multiplayer

**Goal:** four people on four laptops play a real game. Still ugly 2D.

- Fastify + `ws` server. Room codes, nicknames, no accounts yet.
- `Command` in, `Event[]` + redacted snapshot out. zod-validated at the boundary.
- `playerView()` redaction. Verify by opening devtools and confirming you cannot
  see an opponent's hand.
- Reconnect: rejoin by room code, server replays the event log.
- Turn timer with auto-pass, and a host "kick" control.
- Postgres (Neon) + Drizzle. Append-only `events` table keyed by match id.
- Dice fairness: publish `sha256(seed)` at start, reveal at end.

**Done when:** four browsers, one full game, one deliberate mid-game refresh that
recovers cleanly, and no hidden info leaks in the network tab.

**Prompt:**

> Implement M2. The transport is plain WebSocket with a zod-validated message
> protocol in packages/protocol — do not pull in a game-server framework. Server
> holds full state; every outbound message goes through playerView(). Persist an
> append-only event log so reconnect replays rather than snapshots. Add an
> integration test that spins up the server, connects 4 clients, plays a scripted
> game, kills and reconnects one client mid-game, and asserts final state matches.

---

## M3 — The 3D client

**Goal:** it looks good.

- react-three-fiber + drei. `<Environment preset="sunset">` plus one directional
  light and `<ContactShadows>` — that combination alone gets you 80% of the look.
- Instanced hex tiles (extruded hexagon or a low-poly glTF per terrain), instanced
  roads / settlements / cities in player colours.
- Number tokens as flat discs with baked or troika text; red pips for 6 and 8.
- Invisible hit proxies at nodes and edges, mounted per placement mode.
- Ghost preview piece on hover, red when illegal, legal spots pulsing.
- Clamped OrbitControls, damping on, a reset-view button.
- DOM overlay: hand fan at the bottom, player strip, collapsible log + chat,
  action bar. Tailwind + shadcn/ui + `motion`.
- Perf budget: instancing everywhere, `<AdaptiveDpr>`, no per-piece realtime
  shadows. Verify 60 fps on integrated graphics.

**Done when:** a stranger can look at it and not ask "is this finished?"

**Prompt:**

> Implement M3. Read the frontend-design guidance first. Build the 3D scene as a
> pure function of engine state — zero game logic in the renderer. Use instanced
> meshes for tiles and pieces. Interaction goes through invisible proxy meshes
> sized 1.5x the visual geometry. Keep the 2D SVG renderer alive behind a
> `?debug=1` flag. Profile with r3f-perf and report the frame time before and
> after instancing.

---

## M4 — Polish

The part that separates a demo from a game people ask to play again.

- Dice animation landing on the server result. Card deal/draw/discard animations.
  Robber slide. Building placement with a small squash-and-stretch.
- Sound: dice, place, trade, steal, victory. Howler.js, CC0 packs.
- Trade UX, done properly: click resource icons to build an offer, one-click
  counter, bank/port rate auto-suggested at the best available rate, accept
  badges on player avatars. Copy the interaction model from colonist.io — this is
  where most clones fall apart.
- Game log with hover-to-highlight on the board. Spectator mode. Rematch button.

**Prompt:**

> Implement M4. Animations are driven by the server Event stream, never by local
> state. The dice animation must be a canned roll that lands on the server value.
> Build the trade panel as its own sub-state machine in the engine with a
> timeout. Add sounds with a global mute and volume control persisted in
> localStorage.

---

## M5 — 5–6 player extension

Mostly data plus one phase. Cheap win, do it early.

- Larger board scenario JSON, extra colours, extra piece stock.
- Special Building Phase between turns.
- Win threshold stays 10.

---

## M6 — Seafarers

- Ship pieces on sea/coast edges, ship movement rules, closed-route lock.
- Gold fields (choose any resource), the pirate, coastal settlement rules.
- Longest _trade route_ replacing longest road (roads + ships, with the rule that
  a route cannot switch between road and ship except at a settlement you own).
- Scenario VP rules: 2 VP for settling a new island, etc.
- Face-down exploration tiles — a genuine hidden-info case, must be redacted.
- Ship every scenario as JSON in `packages/scenarios`, starting with
  "Heading for New Shores".

---

## M7 — Cities & Knights

The largest single jump in complexity. Budget as much time as M1.

- Third event die. Barbarian track and attack resolution, including the
  strongest/weakest defender scoring and the Defender of Catan cards.
- Commodities (cloth, coin, paper) and commodity production from cities.
- City improvement tracks (trade / politics / science), aqueduct, metropolis.
- Knights: hire, activate, promote, displace, chase the robber, deactivate on
  barbarian attack.
- Progress card deck replacing dev cards, with all three suits.
- City walls, higher hand limit.
- Win threshold 13.

Do this as a `RuleModule` with no changes to base-game files. If you find
yourself editing base rules, the module interface is wrong — fix the interface.

---

## M8 — Traders & Barbarians

Pick the modules you actually play. Each is its own `RuleModule`:
Fishermen, Rivers, Caravans, Barbarian Attack, Traders & Barbarians scenario,
Event cards replacing dice.

---

## M9 — Bots, stats, replays

- Heuristic bot first: score placements by pip sum, resource diversity, port
  access; then weighted strategy for the main phase.
- MCTS over `legalMoves()` once the heuristic bot is beatable.
- Replay viewer built on the event log (you already have it — nearly free).
- Player stats, ELO for your friend group, seed verification page.

---

## Resources

**Rules** — get the official rulebook PDFs from catan.com and put them in
`docs/rules/`. Do not let Claude Code work from memory on rules. The Catan wiki
and BoardGameGeek rules forums resolve edge cases the rulebook leaves vague.

**Reference implementations to read** (read, don't copy — check licences):

- `bcollazo/catanatron` (Python) — the best-designed engine of the bunch. Study
  its action space, state representation, and feature vectors, especially for M9.
- `jdmonin/JSettlers2` (Java, GPLv3) — 20+ years old, has Seafarers, Cities &
  Knights and many scenarios with all rules. The best source for edge-case
  behaviour. GPL, so read it for understanding only, don't copy code into an
  MIT/private repo.
- `Viral-Doshi/catan` (React + Socket.io) — a modern web reference including the
  5–6 player extension and Special Building Phase.
- Browse `github.com/topics/catan` for more.

**Hex math** — redblobgames.com/grids/hexagons. The definitive guide, nothing else
comes close.

**3D assets (CC0, safe to use commercially)**

- kenney.nl — the Hexagon Kit is almost exactly what you need for terrain tiles,
  plus UI packs and audio packs.
- quaternius.com — low-poly buildings, props.
- poly.pizza — searchable CC0 model library.
- polyhaven.com — HDRIs and PBR textures, CC0.
- Run models through `gltf-transform` (Draco compression) and `gltfjsx` to get
  React components.

**Libraries** — check current versions before pinning; do not trust a model's
memory of version numbers.

- Client: react, vite, @react-three/fiber, @react-three/drei,
  @react-three/postprocessing, three, zustand, tailwindcss, shadcn/ui, motion,
  howler, troika-three-text
- Shared: typescript, zod
- Server: fastify, ws, drizzle-orm, postgres
- Tests: vitest, fast-check, @playwright/test
- Tooling: pnpm, turborepo, eslint-plugin-boundaries, r3f-perf

**Alternative transports** if you want to cut a week: Colyseus (rooms,
matchmaking, reconnect, binary state sync) or boardgame.io (turn order, phases,
secret state via `playerView`, built-in MCTS bots, debug panel). Both are real
options. The trade-off is less control over redaction and over complex phase
logic — which is exactly where Cities & Knights will hurt. For a base-game-only
build, boardgame.io would genuinely save you time.

**Deployment** — Fly.io or Railway, one Node process (sticky sessions for
WebSocket), Neon for Postgres, Cloudflare in front. At 6 players per room and a
handful of rooms, you will never need Redis or horizontal scaling.
