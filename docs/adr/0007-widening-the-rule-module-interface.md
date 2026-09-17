# ADR 0007 — Widening the rule module interface

- **Status:** accepted
- **Date:** 2026-09-17
- **Milestone:** M6

## Context

ADR 0005 built `RuleModule` with three members — `supply`, `afterTurnEnd`,
`extraLegalMoves` — and closed with an explicit test:

> If Cities & Knights cannot be expressed through this interface without editing
> base-game files, the interface is wrong and should be widened — that is the
> test CLAUDE.md sets, and it is deliberately not answered in advance here.

Reading the two expansion rulebooks answers it. Three hooks are not enough.

**Seafarers** (CN3083) adds ships on sea edges, a pirate that blocks ship
placement, gold fields that pay a resource of the player's choice, a Longest
Route that spans roads and ships, and victory points for settling an island —
none of which is "what is in the box" or "what happens between turns".

**Cities & Knights** (CN3087) is further out still: it replaces the development
deck with 54 progress cards in three stacks, adds three commodities, a 3×5
improvement track with metropolises, six knights per player with five distinct
actions, city walls, a barbarian track driven by a third event die, and a
restructured turn in which the barbarians move _before_ production (p.6). It
also carries per-player state that has nowhere to live: improvement levels,
knight positions and activation, the barbarian ship's position.

## Decision

### The hooks

`RuleModule` gains the members CLAUDE.md already sketched. Each is justified by
a named expansion, keeping ADR 0005's discipline that a hook is added when a
module needs it, not before:

| Hook                | Added for                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `setupState`        | Seafarers' settled islands; C&K's improvement tracks and barbarian position |
| `interceptAction`   | C&K knights blocking a road (p.9); Seafarers' pirate blocking ships (p.2)   |
| `onDiceRoll`        | C&K's event die and barbarian advance (p.6, p.11)                           |
| `onPhaseEnter`      | C&K's restructured roll phase (p.6)                                         |
| `scoreContribution` | Seafarers island VPs (p.4); C&K metropolis and Defender VPs (p.8, p.11)     |
| `reducers`          | module-owned action kinds in both                                           |

`modules/index.ts` fans each one out across the loaded modules **in the order
the scenario named them**. That order is the only precedence rule there is, and
it is why `["base", "ext56"]` yields the 5–6 supply. Callers never ask which
module answered.

### Module-owned state

`GameState.moduleState` is a record keyed by module id. Slices are typed, not
`unknown`, because this data is serialized into the event log, redacted by
`playerView()` and validated at the wire boundary — all three need a real type.
Each module declares an interface extending `ModuleState` and narrows on `m`,
exactly as `Action` and `Phase` are narrowed on their own tags.

`ModuleState` is seeded as a discriminated base (`{ readonly m: string }`)
rather than as an empty union. An empty union is `never`, which would make
`setupState` impossible to implement — a function returning `never` can only
throw. Seafarers adds the first real member in M6.

### The unions stay central; behaviour moves into modules

Expansion actions, events and phases are added to the engine's existing unions
rather than the unions being made open. This is the load-bearing choice here,
and it is deliberate:

- `packages/protocol/src/action.ts` carries a compile-time proof
  (`ActionSchemaMatchesEngine`) that the wire schema covers the engine's action
  union exactly. An open union silently discards it, and that check is the
  security boundary between an untrusted client and the reducer.
- `legalMoves()` and `reduce()` are exhaustive switches. Exhaustiveness is what
  makes "add an action, the compiler shows you every place that must handle it"
  true.

Golden rule 7 says expansions are modules, not `if` statements. It is satisfied
by _dispatch_ going through the registry — `reduce()` consults modules for any
kind its own switch does not handle — not by the union being open. No file
outside `modules/` asks which expansion is loaded.

## Consequences

The base game is unchanged in behaviour: 534 fast tests pass, every package
typechecks, both purity guards still report, and a base game carries an empty
`moduleState` because neither `base` nor `ext56` keeps state.

`reduce()` gained three call sites: `interceptAction` before the dispatch
switch, `onDiceRoll` inside `rollDice` before production, and `moduleReduce` in
the `default` arm so a module-owned kind is handled rather than rejected.
`publicVictoryPoints` folds in `scoreContribution`; module-granted points are
public by nature, since a settlement on a new island and a metropolis are both
on the board.

Two gaps are left open deliberately, recorded here so they are known rather than
forgotten:

1. **`onPhaseEnter` is declared but never called.** Its only consumer is C&K's
   roll-phase restructure in M7. Wiring a hook that nothing calls would be the
   speculation ADR 0005 warned against, so the call site lands with the module
   that needs it.
2. **`moduleState` is not yet passed through `playerView()`.** With no module
   keeping state there is nothing to redact, and an unredacted passthrough now
   would be a leak waiting for Fog Islands' face-down tile stack. It is added in
   M6 alongside the first slice that needs redacting, and the server's existing
   leak test is extended at the same time.
