# ADR 0008 — Seafarers: ships, and what the board knows about pieces

- **Status:** accepted
- **Date:** 2026-09-17
- **Milestone:** M6

## Context

Seafarers is the first expansion to go through the widened rule module
interface (ADR 0007). The scenario format was built for it in M0 — `sea` slots,
`gold` terrain, `islands[].vpForFirstSettlement`, `hiddenStacks`,
`pieces.ships`, and `edge.kind: "land" | "sea" | "coast"` — and none of it had
ever been used.

This records the decisions taken while implementing ships, the first slice.
Rule references are to `docs/rules/CN3083 CATAN–Seafarers Rulebook 2025`.

## Decisions

### Ships are a module-owned piece

`GameState.ships` maps an edge to `{ player, builtOnTurn }`. It is a record of
objects rather than of player ids — the shape `roads` uses — because p.2 says
"You may not move a ship you built this turn", so a ship has to remember when it
was placed. `PlayerState.movedShipThisTurn` carries the other half of that rule,
"You may move 1 ship during your Action phase", and resets with the dev-card
flag when the turn passes.

The two actions live in the engine's central `Action` union, and the `seafarers`
module owns their reducers. `reduce()` finds no case for them in its own switch
and consults the module registry, exactly as ADR 0007 describes. No base-game
rule changed to accommodate them.

### The open-end test subsumes the "two buildings" clause

p.2 lists four restrictions on moving a ship. Three are implemented directly.
The fourth — "You may not move a ship that is a part of a continuous line of
ships connecting two of your buildings, even if another player's building is
built on that line to interrupt it" — needs no separate check.

An open end is one "not next to one of your ships or buildings", so it leads
nowhere: a ship joining two of your buildings cannot have one. The clause exists
to say that an opponent's building interrupting the line does not free the ship,
which is what testing your _own_ pieces already does. Implementing it twice
would mean two definitions of the same rule that could drift apart.

### `settle()` runs in the reducer, not in the module

A module cannot call `settle()`. `reducers/special.ts` reaches
`queries/scores.ts`, which since ADR 0007 reaches the module registry to collect
`scoreContribution`. A module calling `settle()` would close that loop into a
runtime import cycle, and the const registry would land in a temporal dead zone.

So `reduce()` runs `settle()` itself on whatever a module hands back, and
appends the resulting events. Modules stay free of reducer plumbing, and there
is one place where the special cards and the win check are applied.

### Piece totals moved into `GameConfig`

`state/invariants.ts` checked piece stock against hardcoded 15 / 5 / 4. That was
already wrong in principle — a scenario declares its own `pieces` — and ships
made it wrong in practice.

The engine cannot read the scenario: it is a dependency-free leaf (golden rule
1), `packages/scenarios` depends on _it_, and `GameState` carries only a
`scenarioId`. `GameConfig` already exists to copy scenario facts into state so a
replayed game resolves the same rules, so the piece counts go there alongside
`victoryPoints` and `modules`, and the invariants read them back.

### The pirate is state now, movement later

`GameState.pirate` is a `TileId | null`, and ship placement already refuses the
edges of its hex (p.2). Nothing moves the pirate yet — that arrives with the
robber/pirate choice on a 7. The field is here now so the placement rule is
implemented and tested rather than left as a gap to remember later.

### Maps will come from the rulebook's Variable Setup

The scenario boards are printed only as diagrams. Transcribing eight of them
(3- and 4-player variants of four scenarios) by eye is the transcription-error
problem `scripts/generate-classic-scenario.mjs` was written to avoid. Every
scenario also documents a "Variable Setup" whose hex and number-disc
composition _is_ in the text, and that is what the generator will use. Fixed
layouts remain a data-only addition if they are ever wanted.

## Consequences

Ships are covered by 17 unit tests over a purpose-built sea board, and the base
game is untouched: 552 fast tests pass, all seven packages typecheck, and both
purity guards still report.

One gap is worth naming. **The fuzzer does not yet exercise ships**, because no
_registered_ scenario loads the `seafarers` module — the ships fixture is built
inside its test file. Golden rule 8 is therefore satisfied only for the base
game and the 5–6 board at this point. The scenario maps in the next slice are
what make a Seafarers fuzz run possible, and that run is the real acceptance
bar for this milestone.
