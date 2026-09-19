# Memory Planet

24h hackathon project: a journaling app where each memory spawns a building/object (and each new person a character) on a low-poly, spherical, inspectable toy planet. Plan: see `docs/CONTRACT.md` for interfaces.

## Run
`node server.js` then open http://localhost:8000 (must be served over HTTP; `file://` blocks GLB loading). Optional `.env` with `ANTHROPIC_API_KEY=...` (never commit it).

## Conventions
- **Vanilla Three.js r128 from CDN, no build step, no ES modules.** Plain `<script>` tags in `index.html`, everything attached to the global `MI` namespace. Do not introduce npm packages, bundlers, React or R3F.
- `vendor/GLTFLoader.js` provides `THREE.GLTFLoader` (r128's CDN bundle doesn't include it).
- Kenney assets (CC0) in `assets/<pack>/`, keep each pack's `Textures/colormap.png` next to its GLBs. Colormap is per pack; if a GLB's texture URI fails, redirect via `LoadingManager.setURLModifier`.
- Placement and asset choice are **persisted** in the Memory (never `Math.random()` at spawn time) so reloads reproduce the world. Use `MI.world` sphere helpers, not ad-hoc trig.
- Keep the file-owner boundaries in `docs/CONTRACT.md`. Small commits, merge to `main` often.
- Style: toy-diorama, low-poly, flat shading, warm palette; Quicksand font; charm over realism.
- The demo runs live on one laptop, possibly offline: every network feature (Claude classify) needs a working fallback.
