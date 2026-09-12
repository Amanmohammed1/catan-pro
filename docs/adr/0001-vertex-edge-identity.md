# ADR 0001 — Vertex and edge identity from hex coordinates, not world positions

- **Status:** accepted
- **Date:** 2026-09-12
- **Milestone:** M0

## Context

The board graph needs stable ids for intersections (vertices) and paths (edges).
Every corner is shared by up to three tiles, so the builder has to recognise that
three different tiles are describing the same corner and dedupe them.

CLAUDE.md originally specified: "dedupe corners by rounding world position to 3
decimals and keying on that string." That is a common approach and it works, but
it ties identity to floating-point rendering output.

## Decision

Identity is derived from integer hex coordinates only.

- **Vertex id** is the canonical sorted triple of the three hex positions that
  meet at that corner, rendered as `v|q,r|q,r|q,r`.
- **Edge id** is the sorted pair of its two vertex ids, rendered as `e|<a>__<b>`.

Every corner in the hex plane is shared by exactly three hex _positions_, whether
or not a tile occupies them, so the triple is always defined. Sorting makes the
id independent of which tile derived it.

World positions still exist, in `packages/engine/src/geometry/layout.ts`, but only
for rendering. Nothing in the identity path reads them. A vertex's screen position
is the centroid of its three hex centres, which is exactly the shared corner,
because three mutually adjacent hex centres form an equilateral triangle.

## Consequences

Good:

- **Exact.** Integer comparison has no boundary case. Rounding has one: two
  corners whose true coordinates straddle a rounding step split into two
  vertices. The board gains a settlement spot nobody can reach, and the symptom
  shows up much later as a rules bug.
- **Stable under layout change.** From M2 the event log persists ids and replays
  against them, and M9 builds a replay viewer on that log. Ids derived from world
  position would change if hex size, orientation or origin changed, invalidating
  stored games. Changing the renderer in M3 must not break saved matches.
- **No epsilon to tune** as Seafarers boards grow and coordinates get larger.
- **Defined where tiles are not.** Rim corners of an irregular Seafarers board
  touch only one or two actual tiles. The triple names hex positions, not tiles,
  so it is well defined anyway.

Costs:

- Ids are longer and less human-friendly than a coordinate pair. The debug
  renderer truncates them for display.
- This deviates from the line in CLAUDE.md, which has been updated to match.

## Verification

`packages/engine/src/geometry/coords.test.ts` asserts that all three hexes
sharing a corner derive the same id, that the id is invariant under permutation
of the triple, and that ids do not change when the layout size, origin or
orientation changes.
