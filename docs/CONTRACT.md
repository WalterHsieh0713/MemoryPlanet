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
World  = { version: 2, nextSlot /*unused*/, home: slot|null, heading: tangent vec|null, seed,
           memories: [], people: [], landscape: [] }
// Planned: version 3 adds planet: { frequency, unlocked } and theme; slots are indices into the
// grid for that frequency, so growing the planet remaps slots by direction.
```

## MI.ai  (owner: C)
- `classify(text) -> Promise<{ title, category, mood, people:[{name, relationship}], importance }>`
  Never rejects: on network/API failure resolves with the keyword-heuristic result.

## MI.store  (owner: C)
- `load() -> World` (localStorage key `memory-planet.world.v2`, else an empty world; no `data/seed.json`), `get()`, `save()`, `reset()`, `newId(prefix)`
- `addMemory(m)`, `addPerson(p)`, `addLandscape(entry)`, `findPerson(name) -> Person|null` (case-insensitive), `findMemoryBySlot(slot)`, `takenSlots()`, `occupiedSlots()`
- `exportJSON() -> string`, `importJSON(str)`
- **Planned:** `findSimilarPeople(name) -> Person[]` (ranked), `setTheme(id)`, v3 migration.

## MI.world  (owners: A = scene/planet/controls, B = spawn/assets/characters)
- `init(canvasEl) -> Promise` (resolves when models are loaded)
- `spawnMemory(memory, { animate })`, `spawnPerson(person, { animate })`
- `focus(slot, { instant })` — rotate planet so the tile faces the camera, dolly in
- `onPick(cb(slot | null))`
- `clear()`
- Also implemented: `spawnLandscape(entry, { animate })`, `respawnMemory(memory)`, `pickAssetFor`, `pickTerrainFor`, `buildingsFor`, `landscapeCountFor`, `personColor`, `setFlatView(on)` / `isFlatView()`, `computeRoadEdges` / `roadConnections` / `rebuildRoads`.
- Dropped (never built, not planned): `highlight`, `setTimeCutoff`, `onHover`.
- **Planned:** `setPlanetSize(frequency)`, `setTheme(id)`, wandering people (walkers) on person-linked roads.
- Sphere math (owner A, `src/world/sphere.js`, pure functions, no THREE scene state):
  `slotToDir(slot, homeDir) -> [x,y,z]`, `orientToSurface(object3d, dir, rotY, height)`,
  `terrainHeight(dir) -> radius at that direction` (terrain.js)

## MI.app  (owner: D)
- `addEntry(text, opts) -> Promise<Memory|null>` = classify -> resolve/create people -> assign slot/asset/placement -> store -> world.spawn* -> world.focus. `null` means the planet is full. Current opts: `occurredOn`, `source`, `animate`, `focus`, `instant`.
- `restore() -> Promise` replays the stored world (landscape, memories, people) without animation, then rebuilds roads.
- **Planned opts:** `people: [{ name, personId? }]` (explicit "who was there?") and `confirmPerson(name, candidates) -> Promise<Person|null>` (the "same person?" prompt; with no callback, an exact name reuses the person and a merely similar name creates a new one).

## Rules
- One owner per file; need a change in someone else's file? Ask them (or open a small PR to them).
- No build step: plain `<script>` tags, no `import`/`export`, attach to `MI.*`.
- Assets live in `assets/<pack>/`; one `LoadingManager` per pack (colormap is per pack).
