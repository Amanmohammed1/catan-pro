# ADR 0004 — The board is painted in code, not shipped as art

- **Status:** accepted
- **Date:** 2026-09-17
- **Milestone:** M3

## Context

CLAUDE.md is strict about art: nothing trademarked, no official artwork or card
text, and no binary asset committed without a `LICENSE.txt` naming its source.
M3 still had to stop looking like a debug view — flat single-colour hexes, box
pieces, and a board a stranger would assume was unfinished.

The obvious route is an asset pack: Kenney's Hexagon Kit for terrain, a CC0
audio pack for sound, glTF models run through `gltf-transform`. That is what
PLAN.md suggested. It costs a download step, a licence file per pack, a larger
bundle, and a repository full of binaries that are tedious to review and easy to
get wrong.

drei's `<Environment preset="sunset">` has the same shape of problem in a
sharper form: it looks like a local API, but it fetches an HDR from a third-party
CDN at runtime. The game then does not work offline, and a stranger's server
decides whether our board lights up.

## Decision

Everything on the board is generated at runtime, in code:

- **Terrain, number tokens, harbour signs, wood and water** are painted to a
  canvas by `apps/web/src/three/textures.ts`, with a seeded generator so a board
  looks the same on every load and in every screenshot.
- **Tiles, pieces and props** are procedural geometry in `three/geometries.ts`.
- **Resource and development cards** are original inline SVG in
  `apps/web/src/ui/cards/`, with effect text written in our own words.
- **Lighting** uses a small studio of drei `<Lightformer>` panels rendered
  locally instead of a downloaded HDR.

Type is the one exception, because drawing letterforms is not a thing to
improvise: **Fraunces** and **Inter** are installed from npm under the SIL Open
Font Licence and bundled by Vite. No font is committed, and nothing is fetched
from a font CDN at runtime. `apps/web/src/assets/FONTS.md` records both.

## Consequences

The repository holds no binary art, so there is no licence bookkeeping and no
review burden. The game works entirely offline. Every surface is tunable by
changing a number rather than by re-exporting an asset, which is what made the
whole board's look adjustable in a single session.

The cost is fidelity: painted canvas and lathe geometry will not match a
sculpted, hand-textured model. If that ceiling is reached, a CC0 pack can be
added per piece type behind the same components — `createTreeGeometry()` becomes
a loaded mesh, and nothing else changes.

Sound in M4 faces this decision again and may answer it differently: recorded
audio is much harder to synthesise convincingly than a wood texture is to paint.
That is a separate choice, recorded separately when it is made.
