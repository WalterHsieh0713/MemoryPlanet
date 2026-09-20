# Handoff — progression, growing planet, island view

Written for the next session picking this up. `CLAUDE.md` is the standing project brief and
`docs/CONTRACT.md` is the module contract; this file covers what was built in the progression
work, why it is shaped that way, and what is still open. Everything below is on `main` and
pushed.

## Run and verify

```
node server.js                 # http://localhost:8000  (static files + /api/classify)
node scripts/test-growth.js    # planet size ladder + slot remap, no browser needed
node scripts/test-island.js    # island layout + road routing, no browser needed
```

- `/size-test` (a separate page) compares 42 / 92 / 162-tile spheres. It was used to settle
  the planet-size question and is not part of the app.
- No build step, no npm packages. Vanilla Three.js r128 from `three-r128.min.js`, plain
  `<script>` tags in `index.html`, everything hangs off the global `MI`.
- Deploy (teammates' work): Vercel serves the static files plus `api/` as serverless
  functions; `server.js` is the local equivalent.
- Without `ANTHROPIC_API_KEY` the classifier falls back to keyword matching. That is the
  normal local state: `/api/classify` returning 503 in the console is expected, not a bug.

**Browser checks.** There is no test runner for the 3D side. The approach that worked: drive
headless Chrome over the DevTools Protocol from Node (Node 24 has a global `WebSocket`, so no
packages), evaluate `MI.*` calls in the page, assert on returned state, and capture
screenshots to actually look at the result. Those drivers lived in the session scratchpad, not
the repo. Test hooks exist for it: `MI.world.__island()`, `__scale()`, `__camera(phi)`,
`__satellite()` (the sky orbiter), `__pet()` (the walking pet, `{ sphere, flat }` — one entry
per view, each with its current tile) and `__screen({x,y,z})`, which projects a world point to
canvas pixels so a screenshot can be cropped in on something small. The pets are only a few
pixels tall at the default framing, so crop before deciding one isn't there.
Screenshots caught several things state assertions passed straight over (a slab-shaped island
underside, a pet flying out of frame, pink grass), so look at the pictures, don't just assert.

## What was built

**Growing planet** (`src/world/growth.js`, pure). A world starts on the smallest planet and
grows when half its buildable tiles are land: 42 → 92 → 162 → 362 → 642 → 1002 tiles
(frequencies 2, 3, 4, 6, 8, 10; grids in `data/grids/`, f=10 is the original `data/hexgrid.json`).

- Growing **keeps tile size constant**, so a bigger planet is a bigger ball and your island
  keeps its size while new ocean opens around it. The planet group is scaled by
  `frequency / 10`; `world.js` multiplies the per-tile constants by `unit` (`10 / frequency`)
  to stay in proportion.
- `remap()` carries every saved slot onto the new grid: each slot slides toward home by
  `oldF / newF` along the great circle, snaps to the nearest free hexagon, and any gap that
  opens between tiles that used to touch is bridged so the island never splits.
- Roughly: growth lands at about 5-7, 12, 21, 48 and 89 memories.

**Shards and shop** (`src/game/economy.js`). Every memory pays 10, plus importance, new
people, a daily streak, a first-memory bonus, and a bonus per growth. Spent on 4 themes,
4 pets and 5 character skins. All the numbers are two tables at the top of that file.

**Cosmetics.** Themes (`src/world/themes.js`) restyle tiles, water, sky, lights, the Kenney
atlas and foliage **in place** — no respawn. The atlas is recoloured at runtime per theme
(HSL transform over the shipped texture), so no new art was needed. Pets and skins
(`src/world/cosmetics.js`) are procedural Three.js primitives for the same reason.

**Island view** (was the flat view). The land grows as a winding chain on the planet, so
unrolling it tile-for-tile gave a strip. `src/world/island.js` (pure) coils it into a compact
chunk instead: walk the land outward from home, place each tile beside a planet neighbour on
the free cell nearest the middle, then re-route roads across the island by cheapest path,
reusing already-paved cells so routes share one network. The island floats: no sea ring, a
thin band of earth under the grass and a block of moving sea below it (the planet's own water
shader, `aLand` 0), under a painted sky dome with clouds. Buttons read "island view" /
"planet view".

**Switching views** is a lift-and-gather: the camera turns to home, tiles lift off the sphere
and arc into the island (middle first) while the planet shrinks away, and the sea grows down
once they land. Reverse for the way back. The dithered cross-fade, lighting blend and
mid-transition input lock came from a teammate's fold work and were kept.

## Invariants worth not breaking

- **Slots index the grid for `world.planet.frequency`.** Slots and frequency must always be
  saved together, or a reload pairs old slots with a new grid. `MI.app.growPlanet` does both
  before touching the scene.
- **Nothing is re-rolled at spawn time.** Placement and asset choices are decided once and
  persisted, so a reload reproduces the world exactly. No `Math.random()` in spawn paths;
  there is a `hash()` helper for deterministic variation.
- **Store is v3** (`memory-planet.world.v3`). A v2 save migrates on load as frequency 10 and
  the v2 copy is left alone.
- **Themes own colour.** Read `currentTheme`, don't hardcode; `applyLighting()` /
  `applyViewLighting(mix)` are the single path for lights and sky, and `state.viewMix`
  (0 planet, 1 island) is what anything view-dependent should ride — that is how the pet keeps
  flying across the transition.
- Repo files are **CRLF**; new files written as LF are fine (git normalises), but string
  patches against existing files must match CRLF.
- `docs/CONTRACT.md` assigns **one owner per file**. This work touched world.js (A/B),
  store.js (C), app.js and ui.js (D). Tell the team when that happens.

## Tuning knobs

| What | Where |
|---|---|
| Prices, rewards, streaks | `REWARD` / `CATALOG` in `src/game/economy.js` |
| When the planet grows, the ladder | `GROW_AT`, `LADDER` in `src/world/growth.js` |
| Island compactness, road sharing | the score in `layout()`, `PAVED_COST` in `src/world/island.js` |
| Island underside depth and shape | `rockDepthAt`, `ROCK_DIRT` in `world.js` |
| Camera framing per planet size | `cameraRange()` in `world.js` |
| Island camera angle | `FLAT_VIEW_PHI`, `FLAT_PHI_LIMIT` |
| Pet orbit height, loop, speed | `PET_HEIGHT`, `PET_HEIGHT_CAP`, `PET_ISLAND_HEIGHT`, `PET_SPEED` |
| Transition timing | `UNFOLD_MS`, `FOLD_MS`, `TURN_MS`, `planetScaleAt` |

## Open, and decisions already made

- **Input method is still undecided** by the team. Rewards are paid inside `MI.app.addEntry`,
  so any new input path that goes through it earns shards automatically.
- **Start over wipes shards and unlocks** along with the planet. Deliberate, easy to change.
- **The island rearranges tiles**, so it is a portrait of your world, not a map of it. If the
  team wants geography preserved, the alternative is changing how land grows on the planet so
  it forms a blob there too.
- **Asked and unanswered:** the pre-existing palette fails contrast in places (`--ink-soft`
  text on cards, white on the orange buttons). New UI uses a darker `--ink-mid`; the old
  styles were left alone pending a decision.
- Accepted as fine: the small cyan patches on some tiles are the dock and harbour models,
  which carry their own water.
- Still open from `CLAUDE.md`: classifier quality without an API key, roads currently linking
  all memories chronologically, static (non-walking) people, the 1962 / 4002 planet sizes, and
  multiplayer.
