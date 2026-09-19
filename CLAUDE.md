# Memory Planet

24h hackathon project: a journaling app where each memory spawns a building/object (and each new person a character) on a low-poly, spherical, inspectable toy planet. Plan: see `docs/CONTRACT.md` for interfaces.

## Run
`node server.js` then open http://localhost:8000 (must be served over HTTP; `file://` blocks GLB loading). Optional `.env` with `ANTHROPIC_API_KEY=...` (never commit it).

## Conventions
- **Vanilla Three.js r128 from the local `three-r128.min.js`, no build step, no ES modules.** Plain `<script>` tags in `index.html`, everything attached to the global `MI` namespace. Do not introduce npm packages, bundlers, React or R3F.
- `vendor/GLTFLoader.js` provides `THREE.GLTFLoader` (r128's CDN bundle doesn't include it).
- Kenney assets (CC0) in `assets/<pack>/`, keep each pack's textures next to its GLBs. The hexagon kit uses `Textures/variation-a.png`; its GLBs' colormap URI is redirected with `LoadingManager.setURLModifier`.
- **Loading a texture or model from a pack for the first time? Delete that pack's line from `.vercelignore` in the same commit.** Only `kenney-hexagon-kit` is deployed; the other packs are ignored so deploys stay small (4.6MB, not 38MB). A pack left listed there loads fine locally and 404s in production, which you will not notice until after deploying. Each pack also has its own atlas, so it needs its own `LoadingManager` and won't pick up the theme recolouring.
- Placement and asset choice are **persisted** in the Memory (never `Math.random()` at spawn time) so reloads reproduce the world. Use `MI.world` sphere helpers, not ad-hoc trig.
- Keep the file-owner boundaries in `docs/CONTRACT.md`. Small commits, merge to `main` often.
- Style: toy-diorama, low-poly, flat shading, warm palette; Quicksand font; charm over realism.
- The demo runs live on one laptop, possibly offline: every network feature (Claude classify) needs a working fallback.

## Status (2026-09-19)
Core loop is built and working: journal text -> classify -> people/slot/asset -> persist -> spawn on a 1002-tile hex-sphere (frequency 10), with terrain/landscape tiles, roads, procedural minifigure people, a flat-map view toggle, building swap in the detail panel, demo seed and reset. Persistence reproduces the world on reload.

Progression (built 2026-09-19): worlds start on the smallest planet (42 tiles) and grow up the size ladder 42 -> 92 -> 162 -> 362 -> 642 -> 1002 once half the land is claimed (`src/world/growth.js`; grids in `data/grids/`, f=10 stays `data/hexgrid.json`). Growing remaps every saved slot and keeps tile size constant, so the island keeps its size while new ocean opens around it. Journaling earns shards (`src/game/economy.js`), spent in the shop on 4 themes, 4 pets and 5 character skins (visuals in `src/world/themes.js` and `src/world/cosmetics.js`, all procedural, no new assets). Store is v3 (`memory-planet.world.v3`, v2 saves migrate as frequency 10). Checks: `node scripts/test-growth.js`.

Planet <-> flat is animated: the island peels off the sphere and presses flat as the planet shrinks away (and the reverse), settling at a three-quarter view (`FLAT_VIEW_PHI`). Each flat piece is eased between its pose on the sphere cap and its flat pose (`makeFoldRig` in `world.js`); the sea is merged geometry, so it bends per vertex by the tile each vertex belongs to (`userData.morph`) and travels with the land. This relies on the flat layout keeping the sphere's winding (`hexDirection` lays direction k at -k*60 deg; `kitEdge` converts to the kit's edge index for road pieces) - the flat view used to be a mirror image of the planet.

Known gaps:
- Classifier mostly runs on the keyword heuristic (no `.env`, substring-matching bugs, weak people detection); the Claude path is untested live.
- Roads currently link ALL memories chronologically; people are static (no walking).
- Input method is still being decided; shards currently pay per entry via `MI.app.addEntry`, so any new input path that goes through it earns automatically.
- "Start over" wipes shards and unlocks along with the planet.
- `docs/CONTRACT.md` was stale (listed `highlight/setTimeCutoff/onHover` that were never built); now corrected, with the planned APIs marked as planned.

## Planned (not built yet, in build order)
1. **People, paths, NPCs + classifier.** Roads only between memories that share a person. If a new entry mentions a name similar to an earlier person, ask "is this the same person?". Same -> link the two buildings with a road and the existing figure walks between them like an NPC. Different -> new figure on the new tile that stays near its building until another memory mentions them. Fix the classifier (word-boundary matching, log Claude failures, show "classified by ...") and add an explicit "who was there?" input so people names are reliable.
2. ~~Flat island start, planet size ladder.~~ **Built**, starting on the 42-tile planet rather than a flat island (team call, 2026-09-19). If the flat-island start comes back, `MI.world.setFlatView(false)` already animates the island folding up into a planet. Still open: 1962 / 4002 tiles (the 4002 planet is multiplayer-only).
3. ~~Whole-planet themes.~~ **Built** as shop unlocks (meadow, frostfall, blossom, starlight), and themes recolour the kit atlas at runtime. Per-category building style picks are still deferred.

## Decisions / open questions for later
- ~~Planet radius per size~~: decided after the `/size-test` page — tile size is constant, so a bigger planet is a bigger ball (planet group scaled by frequency/10).
- Growth threshold is "half the hexagons are land" (`GROW_AT`), which works out to growing at roughly 5-7, 12, 21, 48 and 89 memories. Shard prices and rewards are one table each in `src/game/economy.js`.
- Whether to spend an API key on the Claude classifier for the demo, or ship heuristic-only.
- Multiplayer (gates the 4002 planet) has no design yet.
