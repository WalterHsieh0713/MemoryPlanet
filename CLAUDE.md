# Memory Planet

24h hackathon project: a journaling app where each memory spawns a building/object (and each new person a character) on a low-poly, spherical, inspectable toy planet. Plan: see `docs/CONTRACT.md` for interfaces.

## Run
`node server.js` then open http://localhost:8000 (must be served over HTTP; `file://` blocks GLB loading). Optional `.env` with `ANTHROPIC_API_KEY=...` (never commit it).

## Deploy
Live on Vercel from `main`: it serves the repo as static files and runs `api/` as serverless functions, so **`server.js` is local-only** and is not deployed. The Claude call lives in `api/_classify.js`, shared by `server.js` and `api/classify.js` — change it in one place. `vercel.json` states outright that there is no framework, no build and no install step (without it a deploy answered the page itself with `FUNCTION_INVOCATION_FAILED`, having read `server.js` as a server entrypoint). Set `ANTHROPIC_API_KEY` in the Vercel project's environment variables; without it the endpoint 503s and the browser falls back to the keyword classifier.

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

Island view (was the flat view): the planet's land is coiled into a compact floating island rather than unrolled tile-for-tile, because the land grows as a winding chain and pressing it flat gave a strip. `src/world/island.js` (pure, `node scripts/test-island.js`) places each tile outward from home beside a planet neighbour, on the free cell nearest the middle, and re-routes the roads across the island (cheapest path, reusing paved cells). The land sits on a block of sea built per tile in `buildIslandUnderside` (deepest in the middle, a thin band of earth under the grass, the rest running the planet’s own water shader with `aLand` 0), with a soft shadow far below. The island hangs in a painted sky dome (`makeSky`/`makeSkyTexture`, per-theme `skyTop`/`skyBottom`/`clouds`, drawn wider than the starfield) that fades in with the view. Switching views is animated: the camera turns to home, tiles lift off the sphere and gather into the island while the planet shrinks away, and the sea grows down once they land (`makeFoldRig`, `unfoldToFlat`/`foldToPlanet`); the dithered cross-fade, lighting blend and mid-flight input lock are unchanged. Buttons read "island view" / "planet view".

Assets (merged 2026-09-19 from `asset_packs_and_textures`): six more Kenney packs — fantasy town, factory, holiday, castle, pirate, cube pets — plus `assets/standalone/`, a staging area of individual objects sorted by kind. GLB and textures only; the `.fbx`/`.obj`/`.mtl` copies were dropped since only `vendor/GLTFLoader.js` reads models, and they were 40MB of the 74MB. **No code loads any of them yet** — see the `.vercelignore` rule above before you do.

The journal (built 2026-09-19): a memory's fields are **asked for, not guessed**. The tag row under the entry box takes who was there (chips autocompleting from `world.people`, carrying `personId` so the same name is the same person), how it felt (five faces -> the stored `mood` shape), what kind (the six categories) and a big-day toggle (`importance` 4). `MI.ai.guess(text)` — the keyword heuristic, now word-boundary matched, `node scripts/test-guess.js` — only pre-selects, and never overwrites a control the writer touched. `MI.app.addEntry(text, { tags })` takes them, falling back to the guess per missing field. Titles are the first sentence, editable in place in the detail card. The book (`#book`, `renderBook`) lists every entry newest first and is two-way linked with the planet: hover a row to mark its tile, click to open it, click a tile to flash its row. `MI.world.highlightSlot/clearHighlight` marks a tile — vertex tint on the planet, gold rim plus a lift on the island — and `onHover` drives the pointer cursor.

Known gaps:
- Claude is no longer on the entry path: it only backs the detail card's "suggest a title" button, which hides itself when no key is configured. It has still never been seen answering — there is no local `.env` and the deployed key may not be set.
- Roads currently link ALL memories chronologically; people are static (no walking).
- Input method is still being decided; shards currently pay per entry via `MI.app.addEntry`, so any new input path that goes through it earns automatically.
- "Start over" wipes shards and unlocks along with the planet.
- `docs/CONTRACT.md` was stale (listed `highlight/setTimeCutoff/onHover` that were never built); now corrected, with the planned APIs marked as planned.

## Planned (not built yet, in build order)
1. **People, paths, NPCs.** Roads only between memories that share a person (delete the chronological chain in `roadConnections`), and the figure walks between their buildings like an NPC. The "is this the same person?" prompt this needed is no longer necessary — the tag row's chips carry `personId`. ~~Classifier fix and an explicit "who was there?" input~~ **built**.
2. ~~Flat island start, planet size ladder.~~ **Built**, starting on the 42-tile planet rather than a flat island (team call, 2026-09-19). If the flat-island start comes back, `MI.world.setFlatView(false)` already animates the island folding up into a planet. Still open: 1962 / 4002 tiles (the 4002 planet is multiplayer-only).
3. ~~Whole-planet themes.~~ **Built** as shop unlocks (meadow, frostfall, blossom, starlight), and themes recolour the kit atlas at runtime. Per-category building style picks are still deferred.

## Decisions / open questions for later
- ~~Planet radius per size~~: decided after the `/size-test` page — tile size is constant, so a bigger planet is a bigger ball (planet group scaled by frequency/10).
- Growth threshold is "half the hexagons are land" (`GROW_AT`), which works out to growing at roughly 5-7, 12, 21, 48 and 89 memories. Shard prices and rewards are one table each in `src/game/economy.js`.
- Whether to spend an API key on the Claude classifier for the demo, or ship heuristic-only.
- Multiplayer (gates the 4002 planet) has no design yet.
