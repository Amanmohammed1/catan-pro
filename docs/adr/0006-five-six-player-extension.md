# ADR 0006 — The 5–6 player game: Special Building Phase, and tokens from a bag

- **Status:** accepted
- **Date:** 2026-09-17
- **Milestone:** M5

## Context

`docs/rules/` holds seven official rulebooks, including two editions of the 5–6
player extension (2022 and 2025). Both say the same thing about the turn:

> This edition has new paired player rules that **replace the special building
> phase** found in previous editions of CATAN 5–6.

Under paired players, the player three seats to the left of the active player
takes an Action phase after them, and may not trade with other players. Under
the older Special Building Phase, every other player in clockwise order gets a
window in which they may build. The user asked for the Special Building Phase:
it is what the reference implementation and colonist.io use, and it is what
people who play the 5–6 extension expect.

CLAUDE.md says to read the rulebooks and cite the page, and to ask rather than
invent when a rule is missing. Two things are genuinely missing from the books
we hold: the text of the Special Building Phase, and the value printed on each
lettered number disc (A to Zc).

## Decision

### The Special Building Phase

Implemented in `modules/ext56.ts` and the `specialBuild` phase, as follows. No
rulebook here states these; they are what the game does, and this ADR is the
specification:

- After a turn ends, every other player gets one window, in clockwise order
  starting with the player whose turn is next.
- In a window a player may build roads, settlements and cities, and buy
  development cards.
- They may **not** trade — with players or with the bank — and may **not** play
  a development card.
- `passSpecialBuild` closes a window. When the last one closes, the next
  player's turn begins with their roll.
- Reaching the victory threshold during a window does not win: victory is
  checked for the player whose turn it is (p.7, "you can only win during your
  turn"), and a window is not your turn.
- The server's existing turn timer auto-passes an idle window.

### Number tokens come from a bag

The extension's discs are lettered A to Y and ZA to ZC, and the rules lay them
in that order along a spiral from a corner. The *composition* of those 28 discs
is printed (2022 p.5's board and the 2025 component list): two 2s, two 12s, and
three each of 3, 4, 5, 6, 8, 9, 10 and 11. The **letter-to-value mapping is
not** in any book we hold, and inventing one would be exactly the guess
CLAUDE.md forbids.

So `classic-5-6.json` declares the multiset and the scenario format grew a
second mode: `numbers.mode: "bag"` shuffles the declared tokens with the game's
own seeded generator before laying them along the spiral. `classic-3-4` keeps
`mode: "path"` and its official A–R sequence, unchanged.

### Harbours

Eleven harbours: the base nine plus a 2:1 wool and a 3:1 (2022 p.3). They are
spaced evenly around the coastline by the generator, as the classic board's nine
already were, rather than transcribed from the frame's exact joints.

## Consequences

The 5–6 board is not a reproduction of the physical board: the token order and
the harbour positions are ours, the composition and the rules are the book's.
A game is still perfectly reproducible from its seed, which is what golden rule
4 actually requires.

Shuffling tokens made the red-number constraint much harder to satisfy — six red
tokens on a denser 30-hex board leave only about a 4% chance that a random
layout has no two touching, against roughly 40% for the classic board. The
retry cap in `buildBoardGraph` rose from 200 to 2000 attempts; at 4% a run of
2000 failures is vanishingly unlikely, and attempts are cheap. A board that is
genuinely infeasible still fails loudly rather than shipping a broken layout.

If the official disc order turns up — a scan, or the physical box — switching is
a data change: replace `tokens` with `sequence` and the mode with `path`. No
code changes.

Paired players is not implemented. If it is wanted later it is a second module
alongside `ext56`, and the host picks which one a room plays with; nothing in
the base game would change.
