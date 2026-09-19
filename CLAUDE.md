# Memory Planet

24h hackathon project: a journaling app where each memory spawns a building/object (and each new person a character) on a low-poly, spherical, inspectable toy planet. Plan: see `docs/CONTRACT.md` for interfaces.

## Run
`node server.js` then open http://localhost:8000 (must be served over HTTP; `file://` blocks GLB loading). Optional `.env` with `ANTHROPIC_API_KEY=...` (never commit it).

## Conventions
- **Vanilla Three.js r128 from the local `three-r128.min.js`, no build step, no ES modules.** Plain `<script>` tags in `index.html`, everything attached to the global `MI` namespace. Do not introduce npm packages, bundlers, React or R3F.
- `vendor/GLTFLoader.js` provides `THREE.GLTFLoader` (r128's CDN bundle doesn't include it).
- Kenney assets (CC0) in `assets/<pack>/`, keep each pack's textures next to its GLBs. The hexagon kit uses `Textures/variation-a.png`; its GLBs' colormap URI is redirected with `LoadingManager.setURLModifier`.
- Placement and asset choice are **persisted** in the Memory (never `Math.random()` at spawn time) so reloads reproduce the world. Use `MI.world` sphere helpers, not ad-hoc trig.
- Keep the file-owner boundaries in `docs/CONTRACT.md`. Small commits, merge to `main` often.
- Style: toy-diorama, low-poly, flat shading, warm palette; Quicksand font; charm over realism.
- The demo runs live on one laptop, possibly offline: every network feature (Claude classify) needs a working fallback.

## Status (2026-09-19)
Core loop is built and working: journal text -> classify -> people/slot/asset -> persist -> spawn on a 1002-tile hex-sphere (frequency 10), with terrain/landscape tiles, roads, procedural minifigure people, a flat-map view toggle, building swap in the detail panel, demo seed and reset. Persistence reproduces the world on reload.

Known gaps:
- Classifier mostly runs on the keyword heuristic (no `.env`, substring-matching bugs, weak people detection); the Claude path is untested live.
- Roads currently link ALL memories chronologically; people are static (no walking).
- Single fixed planet size; saved slots are indices into `data/hexgrid.json` and no grid/size is stored.
- One theme only (Kenney `variation-a`; `variation-b` texture is unused).
- `docs/CONTRACT.md` was stale (listed `highlight/setTimeCutoff/onHover` that were never built); now corrected, with the planned APIs marked as planned.

## Planned (not built yet, in build order)
1. **People, paths, NPCs + classifier.** Roads only between memories that share a person. If a new entry mentions a name similar to an earlier person, ask "is this the same person?". Same -> link the two buildings with a road and the existing figure walks between them like an NPC. Different -> new figure on the new tile that stays near its building until another memory mentions them. Fix the classifier (word-boundary matching, log Claude failures, show "classified by ...") and add an explicit "who was there?" input so people names are reliable.
2. **Flat island start, planet size ladder.** Start on a small flat island (the existing flat view); at ~5 memories unlock a real planet; more memories unlock larger planets. Sizes are hex grids from `scripts/generate-hexgrid.js [frequency]` (10*f^2+2 tiles: f=6 -> 362, 8 -> 642, 10 -> 1002, 14 -> 1962, 20 -> 4002). The 4002 planet is multiplayer-only (later). Needs: store `version` 3 with the grid size saved, remap of saved slots by direction when the grid grows, `world.js` refactored so the planet can be rebuilt at runtime.
3. **Whole-planet themes.** Texture (`variation-a`/`variation-b`), water/land/sky colours and lighting, stored on the world. Per-category building style picks are deferred.

## Decisions / open questions for later
- Planet radius per size: keep tile size constant (bigger planet = bigger radius) or keep radius 5 (tiles shrink)? Decide after seeing the size tests.
- Exact memory-count thresholds for each size unlock (5 for the first planet is the only fixed number).
- Whether to spend an API key on the Claude classifier for the demo, or ship heuristic-only.
- Multiplayer (gates the 4002 planet) has no design yet.
