# Rush Mode and Fog-Forest Map — Rulebook and Implementation Spec

Reference document for two Colonist.io designs we want to reproduce in our own
engine: the real-time **Rush** mode and the **Black Forest** map.

Source-quality note, read this first:

- **Rush** has an official rules page and two developer blog posts. Everything in
  Part 1 is documented by Colonist, except where marked *[inferred]*.
- **Black Forest** has **no official rules page**. Colonist ships it as a custom
  map, not a documented mode. Part 2 is assembled from Colonist's published
  fog-tile rule, their own feedback board, and creator/community descriptions.
  Treat it as a faithful reconstruction, not a transcription. Play two or three
  games and correct this document before implementing.

Everything below is written in our own words. Do not copy Colonist's rule text,
art, or naming into the repo. Mechanics are fine; expression is not.

---

# Part 1 — Rush Mode (real-time, no turns)

## 1.1 Design intent

Rush is base-game Catan rebuilt for simultaneous play. Colonist's stated guiding
principle during development was to never halt the game unless a rule made it
unavoidable. Everything in the design follows from that one line.

Target game length is under ten minutes, against one to two hours for a physical
game and about fifteen minutes for their ranked 1v1.

Rush cannot be played on a physical board. It depends on a shared roll timer,
resources landing for every player at the same instant, and automatic
bookkeeping.

## 1.2 Scope

| Item | Value |
|---|---|
| Base rules | Standard base game |
| Expansions | None. Base game only |
| Ranked player count | 4 |
| Private room player count | Up to 8 |
| Bots | Supported, can fill seats |
| Victory points | 10 (standard) |
| Default discard limit | **9** (not 7) |
| Default roll timer | **5 seconds** |
| Friendly Robber | On by default |
| Hotkeys | Deliberately absent |

## 1.3 Setup and initial placement

**Initial placement stays sequential.** This is the one deliberate exception to
the no-turns rule. Colonist tested simultaneous placement and found it flattened
the strategic depth of the opening, so they kept the standard snake draft
(1→N, then N→1) and instead shortened the per-placement clock.

Each player places two settlements and two roads. The second settlement pays out
the adjacent tiles as usual. All standard adjacency rules apply — the distance
rule (no settlement within one intersection of another) is unchanged.

Placement timer is short enough to demand attention but long enough to think.
*[inferred: exact value not published — 10–15s per placement is a sensible
starting point, make it a room setting.]*

## 1.4 The main phase — no turns

Once placement ends, there are no turns for the rest of the game.

At any moment, **every player may simultaneously**:

- build roads, settlements, and cities
- buy development cards
- play development cards
- propose, accept, and reject trades
- trade with the bank and at ports

Nobody waits for anybody. There is no "end turn" action and no current player.

**Contested locations resolve first-come, first-served.** If two players commit
to the same intersection or edge, whoever's build lands first gets it. The loser
gets a rejection. There is no tie-break, no queue, and no rollback.

**Per-turn limits become per-roll-interval limits.** Rules that the base game
phrases as "once per turn" have no turn to attach to. Our mapping:

| Base rule | Rush equivalent |
|---|---|
| One dev card per turn | One dev card per roll interval, per player |
| Dev card not playable the turn it was bought | Not playable until the next roll resolves |
| Knight before the roll | Any time |

*[inferred: Colonist has not published this mapping in detail. The dev-card
timing rules must be pinned down by observation before we ship. The strategy
guide does confirm knights are playable at any moment and that stacking them to
chain robber moves is a real tactic, which implies the per-interval limit is at
least loose.]*

## 1.5 Dice and production

Dice roll **automatically** on a fixed interval set in room settings. No player
rolls. When they land, production is distributed to **every player at the same
instant**.

**Vote to roll early.** Any player may vote to roll. Once every active player has
voted, the dice roll immediately without waiting out the timer. This exists so a
ready table is never idle.

**Timer values.** Colonist's published tuning history is worth copying directly:

| Interval | Verdict |
|---|---|
| 30s | Original prototype. Painfully slow |
| 8s | Easier for casual players. Was the original default |
| 5s | Preferred by competitive players. **Now the default** |
| 3–4s | Tested, described as nearly unplayable |

They moved the default from 8s to 5s after data showed players whose first Rush
game ran at 5s were *more* likely to play again than players who started at 8s.

## 1.6 Rolling a 7

A 7 does **not** stop the game. Robber handling and discards are handled
separately, and only one of them blocks.

**Robber rotation.** Players take turns moving the robber across successive 7s,
in a fixed rotation. A persistent indicator shows which player owns the *next* 7.
Knowing when your robber is coming is a core skill in the mode.

**The robber move does not block.** While the assigned player is choosing a tile
and a steal target, every other player keeps building, buying, and trading.

**Friendly Robber** is on by default: a player at 2 VP or below cannot be
targeted. This gives a deliberately quiet opening window for stockpiling.

## 1.7 Discarding — the only blocking event

Discarding is the single rule that stops the world.

When a 7 is rolled and one or more players exceed the hand limit:

1. Those players must discard.
2. **Every other player is locked out.** No builds, no buys, no trades.
3. The game resumes only once every required discard is complete.

Colonist calls these *forced actions*. The reason discards block and robber moves
don't: if others could act during a discard, someone could play Monopoly or steal
a card you were mid-way through selecting, and the outcome becomes undefined.
That ambiguity is a correctness problem, not a UX problem.

**Hand limit is 9, not 7.** This was a direct consequence of the fast timer. At
5–8 second intervals with a limit of 7, players discarded constantly, and every
discard froze the table. Raising the limit to 9 removed most interruptions while
keeping the robber meaningful. Their stated reasoning for 9 specifically: it
matched the limit their ranked 1v1 players already used, so it was familiar and
tested; and it was the smallest change that fixed the problem. A higher limit
would make hoarding risk-free.

## 1.8 Trading

Trading is continuous and simultaneous, which creates an offer-spam problem the
base game never has. Two filtering rules solve it:

1. **A rejected offer disappears immediately.** In the base game a "no" often
   means "not yet" — turns are slow and negotiation is iterative, so a rejected
   offer is worth keeping on screen. In Rush, offers arrive by the second and
   nobody revisits one. Once rejected, the offer has done its job.
2. **Offers you cannot afford are never shown.** If you do not hold the resources
   the offer asks for, it does not appear in your list at all.

An earlier attempt — making offers manually hide-able — helped but did not fix
the problem, because players wanted to see *useful* offers, just not all of them.
Both rules above ship together.

## 1.9 Hotkeys — deliberately absent

Rush creates more demand for hotkeys than any other mode, and Colonist still
decided against them, because keyboard shortcuts would give web players a
material speed advantage over mobile players. Cross-platform fairness was ranked
above raw speed.

**Our decision:** we are desktop-only among friends, so this trade-off does not
apply to us. Add hotkeys. Make them a room setting so we can turn them off if we
ever add mobile.

## 1.10 Victory

Standard: first to 10 points. Settlements 1, cities 2, Longest Road 2 (5+ roads),
Largest Army 2 (3+ knights), VP dev cards 1 each.

Win is checked continuously, not at end of turn. With simultaneous play, two
players could theoretically cross 10 in the same tick — resolve by server-side
event ordering, first event wins. *[inferred]*

## 1.11 Strategy consequences (useful for bot design)

From Colonist's own strategy guide:

- Raw production beats resource diversity. More rolls per minute means production
  rate dominates. A two-resource 6-5-9 opening beats a balanced 10-5-9.
- Aim expansion at uncontested space. A slightly worse spot nobody wants beats a
  contested one.
- Ore-wheat-sheep is stronger than usual.
- Ports are worth more, because a 2:1 port is an always-available trade that
  doesn't depend on an opponent noticing your offer in the noise.
- Friendly Robber below 3 VP makes an invisible early game viable: stockpile and
  buy dev cards while untargetable.
- First impressions stick. The mode is too fast for anyone to re-evaluate who the
  threat is. Looking strong early gets you robbed by all three opponents
  repeatedly, long after you've fallen behind.
- Monopoly is timed to the instant after a big number pays the table, before
  anyone can spend.

These map cleanly onto bot heuristics: weight production rate higher than
diversity in placement scoring, weight contested-ness negatively, and add a
threat-perception term that decays very slowly.

---

# Part 2 — Black Forest map

## 2.1 What it is

A custom base-game map, not a separate mode. Two features define it:

1. **The known board is almost entirely forest.** Every viable opening
   intersection produces lumber. Some brick, sheep, wheat, and ore exist on the
   starting board but they are scarce and contested.
2. **The board is ringed by fog tiles.** These are face-down hexes whose terrain
   is unknown at game start. You reveal them by expanding toward them.

The result inverts the normal opening. You cannot pick a balanced spot because
there isn't one. Lumber is nearly worthless because everyone has it. The real
resources are hidden, and getting to them costs roads — which you can afford,
because you have all the wood in the world.

Community consensus, including from Colonist's own interviewed players, is that
it forces a completely different strategy from the standard board, and that
exploration is the main axis of play.

## 2.2 Fog tiles

Colonist's published rule (from the Seafarers page, where fog tiles are also used)
is short and covers everything:

- A fog tile hides its contents until revealed.
- When revealed it becomes either a random land tile with a resource and number
  token, or a sea tile.
- **The player who reveals a fog tile immediately receives one free resource.**

Reconstructed details for Black Forest specifically, all *[inferred]*:

- **Reveal trigger:** building a road adjacent to a fog tile reveals it. Community
  descriptions consistently describe building roads toward the fog to uncover it.
  Verify this in-game before implementing — it may be settlement-based or may
  reveal on any adjacency.
- **Free resource identity:** most likely the resource of the revealed tile,
  matching the Seafarers gold/discovery pattern. Could also be a free choice.
  Verify.
- **Sea reveals:** a fog tile that turns out to be sea is a wasted road. This is
  the risk half of the exploration gamble. Whether a sea reveal still grants the
  free resource is unclear. Verify.
- **Number tokens** are assigned to revealed land tiles from a pool, not
  pre-placed.

## 2.3 Number balance

The fog region's numbers are **not** balanced the way the standard board is.
Colonist's own feedback board has a long-standing request to fix this, with
players reporting 6-ore adjacent to 6-wheat, and 6s and 8s bordering each other —
combinations the standard board's layout rules forbid. Colonist has left it
unimplemented, and some players argue the imbalance is the point: it makes the
unexplored territory worth gambling on instead of settling safely on the known
board.

**Our decision:** implement it unbalanced by default, matching Colonist, and
expose a room setting `fogNumberBalancing: 'none' | 'noAdjacentRed'` so we can
try both. This is a one-line difference in the generator and our group will have
opinions.

## 2.4 Everything else

Standard base game. 10 points to win. No ships. No expansion interaction. Works
with Rush (Colonist has run Black Forest in their Rush rotation).

---

# Part 3 — Implementation notes for our engine

## 3.1 Rush breaks our phase machine — read this before M4

Our `Phase` union in `packages/engine/src/phases/` assumes exactly one acting
player at a time. Rush has none. This is not a rule we can bolt on with a
`RuleModule` hook; it is a change to the shape of the state.

Colonist hit exactly this. Their codebase was built around turns on both client
and server, and the first month of Rush development was a refactor: **instead of
one current player, every player carries their own state at all times.** The
question changed from "whose turn is it" to "what is each player allowed to do
right now."

The lesson for us: make that change now, at M3, while the engine is still small.

**Concretely:**

```ts
// Before — global turn pointer
type GameState = {
  currentPlayer: PlayerId;
  phase: Phase;
  // ...
};

// After — per-player capability, plus a table-level gate
type GameState = {
  table: TableState;                        // roll timer, robber rotation, blocking gate
  players: Record<PlayerId, PlayerState>;   // each carries its own phase
  // ...
};

type PlayerState = {
  phase: PlayerPhase;   // 'idle' | 'placingSettlement' | 'mustDiscard' | 'movingRobber' | ...
  // ...
};

type TableState = {
  gate: null | { kind: 'discard'; pending: PlayerId[] };  // the ONLY global block
  robberQueue: PlayerId[];
  rollTimer: { intervalMs: number; nextRollAt: number; votes: Set<PlayerId> };
};
```

`legalMoves(state, playerId)` already takes a player id, so its signature does
not change — only its implementation. That is the payoff for the rule in
`CLAUDE.md` that made it the single source of truth.

Turn-based modes then become a degenerate case: exactly one player is non-idle at
a time, driven by a `TurnOrderModule`. Rush is a different module that leaves
everyone non-idle. Both run on the same state shape.

This decoupling is what lets us add 2v2, simultaneous variants, or anything else
later without touching the core.

## 3.2 The blocking gate

There is exactly one global block: discards. Model it as a single nullable field
on `TableState`, not as a phase.

```ts
// In legalMoves, before anything else:
if (state.table.gate?.kind === 'discard') {
  return state.table.gate.pending.includes(playerId)
    ? discardMoves(state, playerId)
    : [];   // everyone else is locked
}
```

Resist adding a second blocking condition. Every one you add costs the table
flow. Colonist shipped with one.

## 3.3 Timing and the server clock

The roll timer lives on the server. Clients render a countdown from a
server-provided `nextRollAt` timestamp, with clock-skew correction on connect.
Never let a client decide when a roll happens.

Roll resolution must be a single atomic reduce: roll dice → distribute to all
players → check hand limits → open the discard gate if needed → emit events.
No interleaving with player commands. Queue inbound commands during the reduce
and process them after.

**Command ordering is now a correctness issue.** In turn-based play, only one
player can act, so command ordering is trivial. In Rush, two players racing for
the same intersection need a defined winner. Use server receive order, single
threaded, no batching. Log the receive timestamp on every command so we can
settle arguments.

## 3.4 Fog tiles are hidden information

An unrevealed fog tile's contents must live only in server state.
`playerView()` must replace it with `{ kind: 'fog' }`. If the terrain and number
ship to the client on game start, anyone with devtools can plan their whole
expansion in the first ten seconds.

This is our first real test of the redaction layer from M2. Add a test that
asserts no unrevealed tile's terrain appears in any outbound message.

## 3.5 Scenario schema additions

Both features are data, if the schema in `packages/scenarios` is general enough:

```jsonc
{
  "id": "fog-forest",
  "baseTerrainWeights": { "lumber": 0.75, "brick": 0.08, "wool": 0.07, "grain": 0.06, "ore": 0.04 },
  "fogRing": {
    "enabled": true,
    "revealTrigger": "roadAdjacent",
    "revealReward": "tileResource",
    "seaChance": 0.2,
    "numberBalancing": "none"
  }
}
```

```jsonc
{
  "mode": "rush",
  "rollIntervalMs": 5000,
  "voteToRoll": true,
  "discardLimit": 9,
  "friendlyRobber": true,
  "robberRotation": "seatOrder",
  "initialPlacement": "sequential",
  "placementTimerMs": 12000,
  "hotkeys": true
}
```

If either of these needs a code change rather than a config entry, the scenario
schema is under-specified — fix the schema, not the call site.

## 3.6 Trade panel changes for Rush

Two rules, both in the engine, not the UI:

- On reject, the offer is removed from state entirely. No "rejected" status.
- `visibleOffers(state, playerId)` filters out any offer the player cannot
  currently afford. Recompute on every resource change.

## 3.7 What to build first

1. The per-player state refactor (§3.1). Do this before M4 polish.
2. The blocking gate (§3.2). One field.
3. Rush as a `RuleModule`: auto-roll timer, vote-to-roll, robber rotation.
4. Fog tiles in the scenario schema + redaction test (§3.4).
5. The Black Forest generator. Cheapest item on the list once fog works.

Steps 1 and 2 are the only hard ones. Everything else is a config entry or a
small module.
