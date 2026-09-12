# hexport

A web-based, online multiplayer hex-trading board game. Base game rules today;
Seafarers, Cities & Knights and the 5–6 player extension are planned as rule
modules.

`hexport` is a placeholder codename. See `CLAUDE.md` for what that means for
artwork and naming.

## Running it

```bash
corepack enable          # or install pnpm 12 another way
pnpm install

pnpm --filter @hexport/server dev    # game server on :8787
pnpm dev                             # client on :5173
```

Open `http://localhost:5173` in two windows. Create a room in one, join with the
code in the other.

Other modes:

- `?hotseat=1` — every seat on one screen, no server needed
- `?debug=1` — the geometry renderer, with node and edge ids

## Layout

```
packages/engine      pure rules and geometry. zero runtime dependencies
packages/protocol    zod schemas for the client/server wire format
packages/scenarios   board definitions as data, validated at the boundary
apps/server          authoritative server: Fastify + ws + Postgres
apps/web             the client
apps/bot-runner      headless self-play, `pnpm fuzz`
docs/adr             architecture decisions
docs/milestones      what each milestone delivered
```

## Checks

```bash
pnpm verify      # lint, typecheck, engine purity, both test lanes
pnpm test        # fast lane
pnpm test:slow   # whole-game runs over real sockets
pnpm fuzz        # 10,000 self-play games
```

`pnpm verify` also runs two guards on the engine's purity: one asserts it
declares no runtime dependencies, the other asserts the lint rule that enforces
it still reports violations. The second exists because that rule was once
silently enforcing nothing.

## Configuration

| Variable          | Default   | Meaning                                    |
| ----------------- | --------- | ------------------------------------------ |
| `PORT`            | 8787      | server port                                |
| `HOST`            | 127.0.0.1 | server bind address                        |
| `TURN_TIMEOUT_MS` | 0         | auto-pass after this long; 0 disables      |
| `DATABASE_URL`    | unset     | Postgres; without it matches are in memory |

## Rules

The engine implements the 2020 base game. Anything subtle carries a page
citation to the rulebook in `docs/rules/`, which is reference only and not
redistributed.
