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

### Island victory points are derived, not tracked

p.4 pays 2 VP for your first settlement on a small island, per player: "it does
not matter if other players have already built settlements on that island."

The obvious implementation is a tally updated when a settlement lands, but the
module has no way to see that happen — `reduce()` handles `buildSettlement` in
its own switch, so `moduleReduce` is never consulted, and `interceptAction` only
inspects. More to the point, a tally is unnecessary: the award is once per
island per player and nothing in Seafarers ever removes a settlement, so the
islands a player has built on _are_ the islands they have been paid for.
`scoreContribution` derives it from the board, which keeps one source of truth
instead of a counter that could drift from the pieces.

What the module does keep is `islandVp`, the per-island values copied out of the
scenario by `setupState`. The board graph records which island a tile belongs to
but not what it is worth, and the engine cannot read a scenario at runtime — the
same constraint that moved piece counts into `GameConfig`.

**Known limitation.** The Four Islands scenario (p.6) gives each player their
own home island, so "unexplored" is per player. A scenario pins one
`vpForFirstSettlement` per island, which fits Heading for New Shores and Through
the Desert but not Four Islands. Supporting it needs either a per-player home
island in the scenario format or a module that records each player's starting
island during setup. That is a Phase 2 decision and is not made here.

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

### What the fuzzer found once a Seafarers board existed

ADR 0008 originally recorded that the fuzzer could not reach any of this code,
because no registered scenario loaded the module. Registering the two Heading
for New Shores boards closed that gap, and the first run found three defects —
all of them things the unit tests had been written to confirm rather than to
challenge.

1. **Roads could be built onto edges already carrying a ship.** p.2's "ships and
   roads may not occupy the same coastal edge" is a mutual exclusion, and only
   the ship's half was implemented. The ship-placement invariant caught it on
   the first seed of the first board.

2. **A ship did not connect a settlement.** `canPlaceSettlement` consulted
   `roads` alone, so a player could sail anywhere and build nothing — which is
   the entire expansion. p.3 settles it ("a ship on an adjacent empty sea edge
   instead of a road"), as does the Longest Route example on p.2, where a
   settlement is built at the intersection joining a road run to a ship run.

   The symptom was not an exception but an unwinnable game: with the islands
   unsettleable, the six victory points they carry were unobtainable, and once
   the mainland saturated nobody could reach fourteen. Four-player games
   dead-ended this way 14% of the time, every ship spent and no island settled.

3. **The harness could not tell a stuck game from a long one.** `selfPlay`
   returned `stalled: state.winner === null` on its normal exit, so exhausting
   the action cap reported identically to a phase machine with no legal move.
   That is the difference between "the rules are broken" and "these bots are
   slow", and it very nearly led to the dead ends being written off. The two are
   now separate outcomes, and the cap is adjustable with `--max-actions`.

The second one deserves a note on method. The obvious response to games hitting
the action cap was to raise the cap, and doing so would have produced a green
gate. Running the same seeds at 150,000 actions instead showed the failure rate
unchanged at 15%, with games reaching thirty thousand turns — which is what
made it clear they were unwinnable rather than slow, and sent the search
towards the real bug.

## Consequences

The base game is untouched, and there is hard evidence for it rather than an
assurance: its 10,000-game fuzz returns 10,190,192 actions and the same win
distribution as the run that preceded the first slice of this milestone. Ships,
gold, the pirate, island scoring and the route rewrite all leave a board that
loads no module byte-for-byte identical, and the gate that produced each commit
asserted that figure rather than eyeballing it.

Golden rule 8 now holds for Seafarers as well, which it did not when this ADR
was first written:

| board                   | games  | stalled | exhausted |
| ----------------------- | ------ | ------- | --------- |
| classic-3-4, 4 players  | 10,000 | 0       | 0         |
| new-shores-4, 4 players | 300    | 0       | 0         |
| new-shores-3, 3 players | 500    | 0       | 0         |

Wins spread evenly across seats on both new boards, which is the signal that
neither the island bonuses nor the setup restriction favours a seat.

Deliberately still open: `hiddenStacks` remains unused, and Fog Islands is the
scenario that needs it — it is also the only one of the four requiring genuine
redaction, so it brings the `playerView` work with it. Two of the four
scenarios are not built. And nothing in the client draws a ship, a pirate or a
gold field yet, so these boards are for the moment playable only by bots and by
tests.
