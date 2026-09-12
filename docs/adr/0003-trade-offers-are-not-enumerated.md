# ADR 0003 — Trade offers are validated, not enumerated

- **Status:** accepted
- **Date:** 2026-09-12
- **Milestone:** M1

## Context

CLAUDE.md golden rule 3 makes `legalMoves()` the single source of truth: the UI
derives every enabled control from it, bots pick from it, the fuzzer draws from
it, and the reducer rejects anything not in it.

Domestic trade does not fit that shape. An offer is a pair of resource
multisets, so the number of distinct offers a player could make is in the
thousands even with a small hand, and almost all of them are noise. Enumerating
them would bury every other legal move in the list and make the fuzzer spend its
time proposing trades nobody would ever make.

## Decision

`legalMoves()` enumerates every action except `offerTrade`. For that one, the
engine exposes a predicate instead:

```ts
canOfferTrade(state, player): boolean
```

The UI asks the predicate to decide whether to show the trade panel, then sends
an `offerTrade` whose contents `reduce()` validates exactly as strictly as any
enumerated move: the offering player must hold what they are offering, both
sides must be non-empty, and only the active player may open an offer.

The responses to an offer — `respondTrade`, `confirmTrade`, `cancelTrade` — are
a small, bounded set and _are_ enumerated normally.

## Consequences

The reducer remains the only authority on legality, which is the part of golden
rule 3 that actually protects the game. What changes is that for this one action
the UI cannot ask "what may I do?" and must instead ask "may I do this?".

The cost is that the fuzzer never exercises `offerTrade`, since it only plays
enumerated moves. That gap is covered by the dedicated trade tests in
`packages/engine/src/reducers/trade.test.ts`, which drive the full offer,
respond, confirm and cancel cycle including the cases where a player's hand
changes underneath an open offer.

If a future module makes the offer space small and meaningful, this can be
revisited. It is a judgement about ergonomics, not a rule of the engine.
