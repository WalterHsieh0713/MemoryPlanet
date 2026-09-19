# Contract — single source of truth for module interfaces

Code against this, mock what you don't own. Change it only via a message to the whole team + a commit that touches this file.
Everything hangs off one global namespace: `window.MI = { ai, store, world, app, config }`.

## Data (see plan §4)
```js
Memory = {
  id, createdAt /*ISO*/, occurredOn /*ISO date*/, text, title,
  category: 'achievement'|'everyday'|'travel'|'home'|'social'|'other',
  mood: { label, valence /*-1..1*/, intensity /*0..1*/ },
  people: [personId], importance /*1..5*/,
  placement: { slot /*tile index in the hex grid*/, dir: [x,y,z] /*unit vector on sphere*/, rotY, scale },   // persisted
  asset: { pack, key },                                                       // persisted
  source: 'user'|'seed'
}
Person = { id, name, relationship, memoryIds: [], firstMemoryId,
           appearance: { color }, placement: { slot, dir, rotY } }
Landscape = { slot, asset, fromMemoryId }   // plain terrain tiles around memories
World  = { version: 3, nextSlot /*unused*/, home: slot|null, heading: tangent vec|null, seed,
           memories: [], people: [], landscape: [],
           planet: { frequency },                       // on MI.growth.LADDER; every slot indexes this grid
           wallet: { shards, lifetime, streak, lastDay /*YYYY-MM-DD*/ },
           unlocks: { themes: [id], pets: [id], skins: [id] },
           equipped: { theme: id, pet: id|null, skin: id } }
// localStorage key memory-planet.world.v3. A v2 save is migrated on load as frequency 10 (the
// original 1002-tile grid); the v2 key is left untouched. Landscape entries created when the
// planet grows carry source: 'growth' and fromMemoryId: null.
```

## MI.ai  (owner: C)
- `classify(text) -> Promise<{ title, category, mood, people:[{name, relationship}], importance }>`
  Never rejects: on network/API failure resolves with the keyword-heuristic result.

## MI.store  (owner: C)
- `load() -> World` (localStorage key `memory-planet.world.v3`, migrating a v2 save, else an empty world on the smallest planet), `get()`, `save()`, `reset()` (wipes shards and unlocks too), `newId(prefix)`
- `addMemory(m)`, `addPerson(p)`, `addLandscape(entry)`, `findPerson(name) -> Person|null` (case-insensitive), `findMemoryBySlot(slot)`, `takenSlots()`, `occupiedSlots()`
- `exportJSON() -> string`, `importJSON(str)` (normalized to v3)
- **Planned:** `findSimilarPeople(name) -> Person[]` (ranked).

## MI.growth  (`src/world/growth.js`, pure — runs under Node: `node scripts/test-growth.js`)
- `LADDER = [2, 3, 4, 6, 8, 10]` (42, 92, 162, 362, 642, 1002 tiles), `GROW_AT = 0.5`
- `gridUrl(f)`, `tierIndex(f)`, `nextFrequency(f) -> f|null`, `landSlots(world) -> Set`, `progress(world, tiles, f) -> { land, threshold, frequency, next }`
- `shouldGrow(world, tiles, f)` — true once half the hexagons are land and a bigger size exists
- `remap(world, oldTiles, newTiles, oldF, newF)` — mutates every saved slot onto the new grid, keeping tile size constant (island keeps its shape; new ocean appears around it) and bridging any gap so the island stays connected. Returns `{ mapping, added }`.

## MI.island  (`src/world/island.js`, pure — runs under Node: `node scripts/test-island.js`)
- `layout(landSlots, homeSlot, tiles) -> { cells: {slot: {i, j, ring}}, radius }` — coils the planet's land into a compact island on a flat hex grid (axial `i, j`; direction k is `DIRS[k]`, at -k*60 degrees, which `world.js` kitEdge() converts for the kit's road pieces)
- `roads(cells, pairs, buildingSlots) -> {slot: [direction indices]}` — cheapest paths joining each memory pair, reusing already-paved cells and staying off other buildings
- `toXZ(cell, spacing)`, `adjacent(a, b)`, `DIRS`

## MI.economy  (`src/game/economy.js`)
- `CATALOG = { themes, pets, skins }` (each item `{ id, name, price, icon, blurb }`), `REWARD` (all earning numbers)
- `balance()`, `rewardMemory(memory, { newPeople }) -> { total, lines, balance }`, `rewardGrowth(sizeIndex)`
- `owns(kind, id)`, `buy(kind, id) -> { ok, item } | { ok: false, reason, short }`, `equip(kind, id)` (records only; pet may be `null`), `equipped(kind)`

## MI.world  (owners: A = scene/planet/controls, B = spawn/assets/characters)
- `init(canvasEl, { frequency, theme, pet, skin }) -> Promise` (resolves when the planet is built; options from the saved world)
- `setPlanet(frequency, { animate }) -> Promise` — swap to that grid (planet group scaled by frequency/10, so tiles keep their world size); clears props, caller replays the remapped world. `loadGrid(f)`, `currentTiles()`, `planetInfo()`
- `setTheme(id)` (restyles tiles, water, sky, lights, kit atlas and foliage in place), `setPet(id|null)`, `setSkin(id)`. Visuals live in `src/world/themes.js` and `src/world/cosmetics.js`.
- `spawnMemory(memory, { animate })`, `spawnPerson(person, { animate })`
- `focus(slot, { instant })` — rotate planet so the tile faces the camera, dolly in
- `onPick(cb(slot | null))`
- `clear()`
- Also implemented: `spawnLandscape(entry, { animate })`, `respawnMemory(memory)`, `pickAssetFor`, `pickTerrainFor`, `buildingsFor`, `landscapeCountFor`, `personColor`, `setFlatView(on, { instant }) -> Promise` (the island view; animated lift-and-gather unless `instant`) / `isFlatView()` / `isTransitioning()` (input and view toggles are ignored while true), `computeRoadEdges` / `roadConnections` / `rebuildRoads`.
- The island's shape and roads come from `MI.island`; `world.js` draws it (`buildFlatView`, `buildIslandRock`) and animates the change of view (`makeFoldRig`). `MI.world.computeFlatLayout` / `computeRoads` are gone with the strip layout.
- Dropped (never built, not planned): `highlight`, `setTimeCutoff`, `onHover`.
- **Planned:** wandering people (walkers) on person-linked roads.
- Sphere math (owner A, `src/world/sphere.js`, pure functions, no THREE scene state):
  `slotToDir(slot, homeDir) -> [x,y,z]`, `orientToSurface(object3d, dir, rotY, height)`,
  `terrainHeight(dir) -> radius at that direction` (terrain.js)

## MI.app  (owner: D)
- `addEntry(text, opts) -> Promise<Memory|null>` = classify -> resolve/create people -> assign slot/asset/placement -> store -> world.spawn* -> world.focus. `null` means the planet is full. Current opts: `occurredOn`, `source`, `animate`, `focus`, `instant`.
- `restore() -> Promise` replays the stored world (landscape, memories, people) without animation, then rebuilds roads.
- `addEntry` also pays shards and, once `MI.growth.shouldGrow`, calls `growPlanet()` (after a short beat so the new building lands first). A full planet grows before placing rather than returning `null`; `null` now only means the biggest planet is full.
- `growPlanet({ animate, focus }) -> Promise<bool>`, `equip(kind, id)` (economy + world), `startOver() -> Promise` (reset to the smallest planet).
- `onEvent(cb)` — `{ type: 'reward', memory, reward }` as each memory lands; `{ type: 'grew', from, to, tiles, size, sizes, reward }`.
- **Planned opts:** `people: [{ name, personId? }]` (explicit "who was there?") and `confirmPerson(name, candidates) -> Promise<Person|null>` (the "same person?" prompt; with no callback, an exact name reuses the person and a merely similar name creates a new one).

## Rules
- One owner per file; need a change in someone else's file? Ask them (or open a small PR to them).
- No build step: plain `<script>` tags, no `import`/`export`, attach to `MI.*`.
- Assets live in `assets/<pack>/`; one `LoadingManager` per pack (colormap is per pack).
