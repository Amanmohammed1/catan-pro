# ADR 0005 — Rule modules carry what an expansion changes

- **Status:** accepted
- **Date:** 2026-09-17
- **Milestone:** M5

## Context

CLAUDE.md golden rule 7: expansions are modules, not `if` statements, and even
while only the base game exists, base rules should route through the same
interface. Until M5 that was aspirational — `packages/engine/src/modules/` did
not exist, the bank size was a constant in `createGame.ts`, and the development
deck was a constant in `state/types.ts`.

The 5–6 player extension is the first thing to test that. It changes two kinds
of thing: what the box holds (more resource cards, more development cards) and
what happens between turns (a building window for everyone else).

## Decision

`packages/engine/src/modules/` holds a small interface:

```ts
interface RuleModule {
  id: string;
  supply?: Supply;                                  // what the box holds
  afterTurnEnd?(state, nextPlayer): TurnHandoff | null;  // interpose a phase
  extraLegalMoves?(state, player): Action[];
}
```

A scenario names the modules it plays with (`modules: ["base", "ext56"]`), and
that list is copied into `GameConfig` so a saved game resolves the same rules
when it is replayed. `resolveModules()` turns ids into implementations and
throws on an unknown id rather than silently playing the base game.

The base game is a module (`modules/base.ts`) and declares the base supply, so
the interface is exercised on every single game rather than only when an
expansion is loaded. The turn structure and the rules themselves stay in the
reducer: they are the game, not an addition to it.

A hook is added when a module needs it. `afterTurnEnd` exists because the
Special Building Phase needs it (ADR 0006); `extraLegalMoves` exists because
Seafarers will.

## Consequences

Adding the 5–6 extension touched no base-game rule. `reduce()` gained one call
at end of turn and a phase case; `legalMoves()` gained one case; `createGame()`
and the invariants ask the modules for the supply instead of reading a constant.

`BANK_PER_RESOURCE` survives as the base game's figure, but it is no longer the
truth for a running game — `supplyFor(resolveModules(config.modules))` is. The
invariant that resources are conserved now checks against that, which is what
lets a 5–6 game with 24 cards per resource pass the same check.

If Cities & Knights cannot be expressed through this interface without editing
base-game files, the interface is wrong and should be widened — that is the test
CLAUDE.md sets, and it is deliberately not answered in advance here.
