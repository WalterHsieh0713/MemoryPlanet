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
  placement: { slot, dir: [x,y,z] /*unit vector on sphere*/, rotY, scale },   // persisted
  asset: { pack, key },                                                       // persisted
  source: 'user'|'seed'
}
Person = { id, name, relationship, memoryIds: [], firstMemoryId,
           appearance: { model, shirt, skin, hat }, placement: { dir, rotY } }
World  = { version: 2, nextSlot, home: [x,y,z], seed, memories: [], people: [] }
```

## MI.ai  (owner: C)
- `classify(text) -> Promise<{ title, category, mood, people:[{name, relationship}], importance }>`
  Never rejects: on network/API failure resolves with the keyword-heuristic result.

## MI.store  (owner: C)
- `load() -> World` (localStorage, else `data/seed.json`), `save()`
- `addMemory(m)`, `addPerson(p)`, `findPerson(name) -> Person|null` (case-insensitive)
- `exportJSON() -> string`, `importJSON(str)`

## MI.world  (owners: A = scene/planet/controls, B = spawn/assets/characters)
- `init(canvasEl) -> Promise` (resolves when models are loaded)
- `spawnMemory(memory, { animate })`, `spawnPerson(person, { animate })`
- `focus(id, { instant })` — rotate planet so the object faces the camera, dolly in
- `highlight(ids | null)` — glow the given ids, dim the rest; `null` clears
- `setTimeCutoff(date | null)` — hide memories with `occurredOn` after date
- `onPick(cb(id | null))`, `onHover(cb(id | null))`
- `clear()`
- Sphere math (owner A, `src/world/sphere.js`, pure functions, no THREE scene state):
  `slotToDir(slot, homeDir) -> [x,y,z]`, `orientToSurface(object3d, dir, rotY, height)`,
  `terrainHeight(dir) -> radius at that direction` (terrain.js)

## MI.app  (owner: D)
- `addEntry(text) -> Promise<Memory>` = classify -> resolve/create people -> assign slot/asset/placement -> store -> world.spawn* -> world.focus

## Rules
- One owner per file; need a change in someone else's file? Ask them (or open a small PR to them).
- No build step: plain `<script>` tags, no `import`/`export`, attach to `MI.*`.
- Assets live in `assets/<pack>/`; one `LoadingManager` per pack (colormap is per pack).
