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
island during setup.

That decision has now been taken, in the only direction that keeps the boards
honest: **Four Islands is not generated.** p.6 is explicit — "Your starting
settlements with roads/ships may be placed on one island or two different
islands. These location(s) are your home islands. The remaining islands are
unexplored for you. Each player may have different home and unexplored
islands." With one global value per island, a player who opened on an island
would be paid two points for settling it, and every player would be paid for the
same three islands regardless of where they began. The board would load, build,
fuzz clean and score wrongly, which is worse than not having it: a missing
scenario is visible, a mis-scoring one is not.

The cheapest honest route to it, when it is wanted, is to record on each
building the turn it was placed — setup is turn 0 — and let the Seafarers module
derive each player's home islands as the ones they hold a turn-0 building on.
That is a change to the building record and to `scoreContribution`, not to the
scenario format, and it is a rules change rather than the data change the other
three scenarios are.

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

### Through the Desert fits the model; one of its rules does not

Through the Desert (p.10 fixed, p.11 variable) needed no new mechanism. It is a
main island the opening settlements must sit on, plus unexplored regions worth
two points apiece — structurally the same board as Heading for New Shores, with
three deserts splitting the main island and both gold fields out among the
regions. It is data through the same generator.

One printed rule is **not** modelled: p.11's "Do not place red number discs on
gold fields." The scenario format can say which terrains take no number at all
(`numbers.skipTerrains`, which is how deserts stay bare) but not which values a
terrain may not take. Adding a per-terrain value exclusion for one line in one
scenario would be a new concept in the format earning its keep once. The
consequence is stated rather than hidden: gold is slightly stronger on our
Through the Desert than on the printed one, because a 6 or an 8 can land on it.

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

| board                           | games  | stalled | exhausted |
| ------------------------------- | ------ | ------- | --------- |
| classic-3-4, 4 players          | 10,000 | 0       | 0         |
| new-shores-4, 4 players         | 10,000 | 0       | 1         |
| new-shores-3, 3 players         | 10,000 | 0       | 0         |
| through-the-desert-4, 4 players | 10,000 | 0       | 2         |
| through-the-desert-3, 3 players | 10,000 | 0       | 0         |

Wins spread evenly across seats on every one of these boards, which is the
signal that neither the island bonuses nor the setup restriction favours a seat:
2543/2501/2435/2519 across four seats on Through the Desert, 3400/3271/3329
across three.

**The three exhausted games are recorded rather than rounded away.** Across
40,000 Seafarers games, three hit the 20,000-action cap with no winner — two on
Through the Desert at four players, one on New Shores at four. That is 0.0075%
against a harness threshold of 10%, and it is worth stating precisely because
exhaustion is exactly what the "ships do not connect settlements" bug looked
like. That bug ran at 14%, with games reaching thirty thousand turns; these
three peaked at 5,015 turns on fourteen-point boards. Long games, not unwinnable
ones. The distinction is only visible because `stalled` and `exhausted` are
separate outcomes — a harness that conflated them would report this identically
to a broken phase machine.

Both Heading for New Shores rows were originally 300- and 500-game runs, made
before the harness had a threshold at all. They have been re-run at 10,000, so
every board in this table now meets golden rule 8's figure rather than three of
five meeting it and two being grandfathered in.

The client now draws these boards: the sea renders as water rather than as
blue land, ships and the pirate are on the board, gold fields have controls,
and `?hotseat=1&scenario=new-shores-4` reaches one without a server.

Deliberately still open:

- **`hiddenStacks` is unused**, and Fog Islands is the scenario that needs it.
  It is also the only one of the four requiring genuine redaction, so it brings
  the `playerView` work with it.
- **`startingPieces` is inert.** The schema validates it and `Scenario`
  declares it, but `createGame` never reads it, so a scenario cannot begin with
  pieces on the board. Seafarers p.3 wants exactly that — "if you place a
  starting settlement on the coast, you may place a ship on an adjacent empty
  sea edge instead of a road" — so it will have to be implemented rather than
  removed. Worth knowing before trusting the field: it is declared, accepted
  and ignored.
- **Four Islands is not built**, and the section above says why it is a rules
  change rather than a data one. It is the only one of the four deliberately
  declined.

### A note on checking the picture

Ships appeared not to render for a long stretch, and the renderer was taken
apart looking for the cause. It was sound throughout. The boards being
photographed simply had no ships on them: `pnpm shots` stopped at the end of
setup, where a ship cannot yet exist, and once it played on, its loop wedged at
the first discard prompt because the Discard button stays disabled until cards
are chosen.

`pnpm shots --scenario <id> --turns <n>` now plays past setup and prints the
actions it took, so the next person can confirm in one line that the state
they are looking at contains the thing they are checking — which is the
question to ask first, not last.
