# ADR 0009 — The Fog Islands: a board that changes

- **Status:** accepted
- **Date:** 2026-09-19
- **Milestone:** M6

## Context

Every board so far is dealt once and then fixed. CLAUDE.md states it plainly —
"Build the board graph once at game creation, then store it in state" — and
until now nothing has wanted otherwise.

The Fog Islands does. It deals part of its board face down and fills a space
only when someone builds next to it (Seafarers p.8):

> "When you place a ship or road adjacent to an intersection with an empty hex
> space, you discover a new location. Take the top hex from the facedown stack
> and place it face up in the empty space. If it is a land hex, take a random
> number disc from the facedown pile and place it on the hex. Take 1 resource
> card of the type produced by that hex. If the new hex is a sea hex, do not
> place a number disc and do not take a resource."

This is the first rule in the project that contradicts a stated invariant, so
it is recorded rather than quietly worked around.

## Decisions

### A reveal replaces the board, and the replacement is narrow

`revealHex()` returns a new `BoardGraph` in which exactly two things differ: the
revealed tile's `slot`, `terrain` and `number`, and the `kind` of the six edges
that tile touches. Nothing else moves. No id changes, no node or edge is added
or removed, and no adjacency is rewritten.

That last property is the whole argument. ADR 0001 made vertex and edge identity
the sorted triple of hex coordinates precisely so ids could be persisted in the
event log from M2 onward, and a fog cell is a real cell from the moment the
board is built — it has its nodes and edges before anyone knows what it holds.
So a reveal cannot invalidate an id that has already been written down.

**The edge reclassification is the part that is easy to miss.** An edge beside
an unrevealed hex is coastal; once the hex is known, the edge is whatever its
real neighbours say. A fog space that turns out to be sea converts its edges
from road-and-ship to ship-only. Forgetting this would leave a board whose
`edge.kind` slowly drifts out of step with its own tiles.

**Rejected: an overlay.** Keeping `board` literally immutable and holding
revealed terrain in a module-owned map would satisfy the letter of the rule and
break its spirit — every terrain read (production, the robber, ports, the
renderer) would have to consult two places, and "what is this tile?" would have
two answers that could disagree. One mutable field is easier to reason about
than two sources of truth.

### Unrevealed is a terrain and a slot, not a null

`Terrain` gained `"fog"` and `SlotKind` gained `"fog"`. The alternative was
`Tile.terrain: Terrain | null`, which pushes a null check into every read for
the sake of one scenario. Widening the union instead made the compiler name
every exhaustive site that had to decide what an unknown hex looks like — eight
of them, across the engine and both renderers — which is the kind of invasive
change worth having.

`isLandTerrain` was rewritten at the same time. It read `terrain !== "sea"`,
which was equivalent until there was a third answer; it now reads the explicit
`LAND_TERRAINS` list, because an unrevealed hex is not land and "anything that
is not sea" would have quietly said it was.

### A fog neighbour makes an edge coastal — forced, not chosen

p.8's trigger is "when you place a ship **or** road". `canPlaceRoad` refuses a
sea edge and `canPlaceShip` refuses a land one, so classifying an unrevealed
neighbour as either would make half of that sentence impossible to perform.
Coast carries both, so coast is the only classification that lets the rule
happen at all.

### `afterAction`, a new hook

Revealing fires on a road or a ship landing, and those live in different worlds:
`buildRoad` is a central case in `reduce()`, `buildShip` is owned by the
Seafarers module. `interceptAction` only inspects a move before it is judged and
cannot see the state it produced; `reducers` only covers kinds a module owns.

So `RuleModule` gained `afterAction`, called once an action has been accepted.
This is the third time a module has needed to observe a central action — ADR
0008 records `buildSettlement` as the second — which is what makes it a hook
rather than a special case, and Cities & Knights will want it too.

`reduce()` is wrapped rather than edited: the reducer returns from some
thirty-five places, and threading a call through each would be thirty-five
chances to forget one. The rules themselves moved into `reduceBase()` untouched.

### Every adjacent empty space is revealed

p.8 says "place it face up in **the** empty space", singular — but a road or
ship has two intersections and each touches up to three hexes, so one placement
can reach several at once. Neither rulebook resolves it: the discovery mechanic
appears exactly once across all twenty pages of the 2025 Seafarers book, and the
5–6 book mentions the scenario only to say the stacks exist.

With no citation available, this was settled with the project owner rather than
invented. Revealing all of them keeps the outcome a pure function of the seed,
needs no new choice phase to enumerate in `legalMoves`, and invents no tie-break
rule for which of two spaces would otherwise be skipped.

### The stacks are state; what is still hidden is derived

The face-down piles live in `GameState.hiddenStacks`, next to `devDeck`, which
already establishes where a shuffled secret pile belongs. `playerView` sends
counts and nothing else — a client that could read the piles would know what
every unexplored space holds before sailing to it, which is the entire scenario.

Which spaces are still hidden is deliberately **not** stored: a tile whose
terrain reads `fog` is unrevealed, and that is the same fact. ADR 0008 settled
this once for island victory points; a second copy is a second thing to keep in
step. What the board genuinely cannot say is which pile a given space draws
from, since that is static scenario data — so that mapping lives in the module's
own state slice, which is what module state is for.

### A changed board is resent

This decision was missing from the first version of this ADR, and its absence
was a bug rather than an omission.

`WireView` omitted the board and the server stripped it from every update,
because the board was static for a match. This ADR made that false and did not
follow the consequence through: the server revealed hexes correctly and no
client ever heard about it. The reveal was invisible in play while twenty-one
engine tests passed, because they assert on engine state and never cross the
wire.

The `update` message now carries an optional `board`, sent only when the events
of that update include a `hexRevealed`. Every other update is the size it always
was, and a base game never sends one. The test client had cached the board the
same way the real one did, so it was corrected too — otherwise a test asserting
on the client's board would have passed on stale data.

The lesson generalises beyond this ADR: a change that makes cached state mutable
has to be chased into every cache, and the test that proves it has to read the
frames rather than the state.

## Known limitation

**Revealing a gold field pays no resource card.** p.8 says the finder takes "1
resource card of the type produced by that hex", and a gold field produces a
card of the player's _choice_ (p.2) rather than a fixed type. Paying it properly
means routing into the existing `gainGold` phase — but a **setup** road can
trigger a discovery, and taking over the phase machine in the middle of setup
placement is not safe to do untested.

Two of the twelve face-down hexes are gold, so this is not negligible. It is
recorded here rather than hidden because the alternative was a phase transition
that could strand a game during setup, and a documented gap is easier to fix
than an unstable turn machine.

## Consequences

The base game is untouched, and there is evidence rather than assurance:

- `afterAction` folds nothing when no loaded module implements it, so `reduce()`
  returns the inner result by identity.
- `buildHiddenStacks()` iterates zero stacks for every board but this one, so it
  consumes no randomness and no existing board's generator state shifts by a
  step.

The gate is the same one every commit in this milestone has used: the classic
10,000-game fuzz must still return **10,190,192 actions**. It does — unchanged
to the action, with the same win distribution, after a change that wrapped
`reduce()` itself and altered `canPlaceSettlement`. Those are the two places
where a regression would have been widest, so the figure is worth more here than
it has been anywhere else in this milestone.

| board                    | games  | stalled | exhausted |
| ------------------------ | ------ | ------- | --------- |
| fog-islands-4, 4 players | 10,000 | 0       | 0         |
| fog-islands-3, 3 players | 10,000 | 0       | 0         |

Neither board produced an exhausted game, where the fourteen-point boards each
produced one or two. Twelve points is a lower bar, so games end before they can
run long. Wins spread evenly across seats on both — 2498/2440/2493/2569 and
3319/3299/3382 — which is the signal that discovery does not favour a position,
and it could have: the player who first builds toward the fog takes the cards.

`packages/scenarios/src/fog-islands.test.ts` carries what the fuzzer cannot say.
A scenario where nothing is ever revealed would fuzz perfectly cleanly while
being the wrong game entirely, so the reveal itself is asserted directly: the
hex turns over, a land hex takes a disc and pays a card while a sea hex takes
neither, both piles drain by exactly what was drawn, the board stays consistent
with itself afterwards, and `playerView` never carries the contents.
