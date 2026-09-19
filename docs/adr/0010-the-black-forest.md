# ADR 0010 — The Black Forest, and building from a reconstruction

- **Status:** accepted
- **Date:** 2026-09-19
- **Milestone:** M6

## Context

Every board so far came from a rulebook we hold. The Black Forest does not.
Colonist ships it as a custom map with no rules page, so our source is
`docs/design/rush-and-black-forest.md` — a document written for this repo that
is explicit about its own reliability, marking the parts it infers.

That honesty is the reason this ADR exists. CLAUDE.md says not to guess a rule,
and the source says, of its own Black Forest section: "Treat it as a faithful
reconstruction, not a transcription. Play two or three games and correct this
document before implementing." Building anyway means recording exactly which
parts rest on what.

## What is cited, and what is ours

**From the source, and implemented as stated:**

- The known board is almost entirely forest, so no balanced opening exists and
  lumber is nearly worthless (§2.1).
- Fog rings the board; you reveal it by expanding toward it (§2.1, §2.2).
- A revealed fog tile becomes either land with a resource and a number, or sea
  (§2.2).
- The finder takes a free resource on reveal (§2.2).
- The numbers are deliberately **not** balanced the way a standard board's are,
  and leaving them that way is what makes the unexplored ground worth gambling
  on (§2.3). The scenario simply omits `numbers.constraints`.
- Standard base game otherwise: ten points, no ships, no expansion interaction
  (§2.4).

**Inferred by the source, and resolved by reusing rules we already hold:**

The source marks the reveal trigger, the reward's identity, and whether a sea
reveal still pays as unverified. Rather than invent three answers, the project
owner chose to reuse the Seafarers p.8 semantics already built, tested and
fuzzed for The Fog Islands (ADR 0009):

- building a road beside an empty space reveals it;
- a land hex takes a disc from a second face-down pile and pays its finder one
  card of that hex's resource;
- a sea hex takes neither.

That is reusing a cited rule rather than inventing one, and it is why the `fog`
module needed no Black Forest special case at all. It should still be corrected
against real play, and the source says so.

**Ours outright, and the weakest part of this board:**

The **contents of the fog stack** — 4 sea, 5 hills, 5 pasture, 5 fields, 5
mountains, and no forest. The source gives terrain weights for the known board
and says nothing about what is hidden. The intent is not in doubt (exploration
is the only route to brick, wool, grain and ore), but the exact mix is a
judgement, and the ratio of sea to land sets how punishing exploration feels.
Correcting it is a line in the generator.

The **outline** is ours too, as it is for every board here: a desert at the
centre inside a six-hex lake, thirty forest hexes around it, twenty-four fog
spaces ringing the whole thing. The source has a picture, not coordinates, and
transcribing a diagram by eye is the error the generator exists to avoid
(ADR 0008). The composition is what matters and is asserted in
`black-forest.test.ts`.

## Decisions

### The fog module is named for the mechanic

It was `fogIslands`, after the scenario that introduced it. The Black Forest is
a base-game map with no ships, and a scenario file naming a module called
"fogIslands" would read as a mistake. It is `fog` now — module, state slice and
accessor together, because a half-rename is worse than either name alone.

The module never depended on Seafarers. The Fog Islands names it beside
`seafarers`; the Black Forest names it without, which is the first proof the
separation is real rather than asserted.

### The harbours face inward

Six 2:1 lumber harbours, all on the lake shore at the centre. On a board where
everyone holds wood, a harbour that takes wood is the only dependable way to
convert a surplus — so putting them all in the middle makes the centre worth
contesting, and gives the lake a reason to exist beyond decoration.

This is an inference from the source's picture, not a stated rule.

### Red numbers may sit together

`numbers.constraints` is omitted, so `buildBoardGraph` does not reshuffle to
separate 6s and 8s. This is the source's §2.3 decision followed exactly. The
source also proposes a room setting to try it both ways; the scenario format
already supports that by adding the constraint, so it is a data change when
somebody wants it.

## Consequences

The board is 61 cells: one desert, six sea, thirty forest, twenty-four fog. It
seats three or four, wins at ten, and loads `["base", "fog"]`.

Its first fuzz run is also the first evidence that two things hold which were
previously only asserted: the `fog` module runs correctly **without** Seafarers,
and `bordersNoLand` — the guard added hours earlier to keep a road off water the
fog was hiding — holds on a board that is one continuous fog frontier rather
than a few inland pockets.

What this ADR does not claim: that the board plays like Colonist's. It plays
like the design as reconstructed, with the stack composition and the outline
ours. Both are cheap to correct once somebody has played the real thing, and
`black-forest.test.ts` will say loudly which numbers changed.
