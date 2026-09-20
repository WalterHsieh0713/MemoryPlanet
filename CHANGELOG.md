# Changelog

Notable changes to Memory Planet, newest first.

## Unreleased — the pirate fleet

### Added
- **Ships that sail the ocean**, hostile until you earn them. A world gets one ship on the
  smallest planet and up to four as it grows; each has a hull, a name and one thing it wants.
  `src/world/ships.js` is pure and covered by `node scripts/test-ships.js`.
- **They are won by writing, never bought.** A ship asks for a journalling milestone — 3 travel
  memories, one day with 2 people in it, a 3-day streak, 6 memories, 4 people met — and says so
  on its card, with a progress bar. When it is met, a toast points at the ship and the player
  claims it themselves: the black flag comes down, the hull swaps from pirate to civilian, and
  the ship sails in to the coast.
- Click a ship on the ocean to open its card (`#ship-card`); ships are picked before tiles, so
  clicking one never selects the water underneath it.

### Notes for whoever touches this next
- A ship is **a walker whose walkable set is water**. `walkers.js` gained a `ship` kind and
  `makeWalkerSolo` (one instance rather than a sphere/island pair); world.js passes water tiles
  where it passes land tiles for a pet. There is no ship movement code.
- **Hostile is implemented as distance**: an unclaimed ship may only occupy open sea (water with
  no land neighbour), a claimed one any water. Measured — unclaimed ships spent 0 of 400 sampled
  frames on a coastal tile, a claimed one 35 of 72.
- **Ships sit in the water, not on it.** Three things go into that, and missing any one of them
  reads as floating: `SHIP_DRAFT` sinks the hull to its waterline (1.3 model units, measured
  off the mesh — keel at 0, full beam at 1.75, which is the deck); `shipHeight` recomputes
  `animateWater`'s wave so a ship rides the same swell as the tile under it instead of holding
  a fixed radius over the troughs; and ships pass `hop: 0`, because a walker with no animation
  clips otherwise gets the little bob that stands in for a walk cycle, which on a ship is
  skipping across the sea.
- Ships are planet-only: the island view has no open water around it, so they hide during the
  fold rather than freeze, or one would be left sitting on grass.
- Only `{id, hull, name, goal, claimed}` is stored; position and identity are rebuilt from the
  world seed. `normalize()` backfills `ships`, so there is no store version bump.
- Announce **one ship per entry**. Two toasts in a row means the player sees the second only.

## Unreleased — building variety

### Changed
- **A category no longer owns its buildings.** The kit's eighteen were partitioned three or
  four to a category, and the keyword guess sends most entries to `other`, so a planet showed
  the same three models over and over. A memory now takes one of its category's own buildings
  60% of the time and any building the rest of the time: 17-18 distinct models per category
  instead of 3, with the signature ones still dominant. Saved worlds are untouched — a
  memory's building is persisted, so only new entries draw from the wider pool.
- The detail card's swap list offers every building (this category's first) rather than only
  the three or four it used to.

### Added
- **Four buildings from the pirate kit** — the large and small complete towers, the watch
  tower and the castle gate, each one rendered and checked before being catalogued. `PACKS` in
  `world.js` maps a pack name to its folder; `MI.world.assetFor(key)` stamps the right pack
  onto a Memory, which is what the long-unused `{pack, key}` shape was for.
  `assets/standalone/buildings/` came out of `.vercelignore` in the same change.
- **`/asset-sheet/`** — a local contact sheet that draws every GLB in a folder with its real
  dimensions underneath, so a pack can be eyeballed before anything is wired up. Served like
  `/size-test/`; the folder listing comes from a new dev-only `GET /api/assets` in `server.js`,
  which is not deployed. Both are kept out of the build (`.vercelignore`).
- `spawnMemory` re-picks and re-saves a building whose model has left the catalogue, so
  retiring one cannot leave a saved world with an empty tile.

### Fixed
- **Three of the models added above were not buildings.** The fantasy-town "windmill" is its
  sails alone — two crossed poles, no mill — and both "watermills" are a bare wheel; they were
  catalogued from the folder name and planted on real islands before anyone rendered them.
  Removed, along with the `fantasy-town` pack entry. The hexagon kit's own `building-mill` and
  `building-watermill` were the real mills all along. `/asset-sheet/` is the guardrail.

### Notes for whoever touches this next
- **Render a model before cataloguing it.** `assets/standalone/` is sorted by folder name, not
  by inspection, and contains component parts as well as whole objects. `/asset-sheet/` makes
  it a ten-second check.
- One `GLTFLoader` per pack, keyed by the url's directory (`loaderFor`) — each pack ships its
  own `colormap.png`, so a single manager pointed at the hexagon kit's atlas would paint a
  pirate tower in hexagon-kit colours.
- A hexagon-kit building model **includes the hexagon of ground it stands on**; a foreign one
  is only the building. On the island its tile is laid as grass with the model set on top, or
  it would stand over a hole. The planet needs none of that - the cell is the ground there.
- Scale these by measuring **what lands on the tile**, not the raw GLB box: a box counts parts
  that never read as height (the windmill's sails sweep a circle wider than the mill is tall).
  A hexagon-kit building stands 0.52 model units above its tile and these aim at 1.1-1.5x
  that; the pirate tower scaled to fit the tile by footprint came out 2.9x.
- The five foreign models do not follow the theme — recolouring is an HSL pass over the
  hexagon kit's atlas, and each pack has its own.

## Unreleased — residents and shared walkers

### Added
- **Land-walker pets** — eight choices in the separate Pets shop tab, in
  `src/world/walkers.js`: bunny, pig, dog, fox, cow, deer, lion,
  elephant), each a real GLB from `assets/standalone/animals/cube-pets/`, wandering tile to
  tile on land in both the planet and island views. The models have no walk animation, so a
  step is a position slide with a small hop.
- **Residents** — people from journal memories now walk in planet and island views, using
  stable models assigned from the 12 Kenney Mini Characters GLBs. The controllable avatar
  uses models from the same pack and remains a permanent inhabitant in every view. Residents
  share the pet walking logic and prefer the road route when it exists.
  - Both packs are loaded per the repo's one-`LoadingManager`-per-pack rule, and both folders
    were removed from `.vercelignore` in the same change.
  - Residents come from saved memory people, with no shop tab or equip slot.

### Notes for whoever touches this next
- `RESIDENT_*_SCALE` is ~4.7x `PET_*_SCALE`, not 2x. The two packs are modelled at
  very different raw sizes (mean height 0.72 against 1.71), so the constants are not
  comparable numbers — don't tidy them toward each other.
- A character's walkable set **includes the buildings a road runs through**. Memories land two
  tiles apart, so a road segment is usually a single tile with a building either side:
  counting only tiles carrying a road model left all 5 road tiles on a 9-memory world stranded
  with no road neighbour, and the character could never take a step.
- Characters step about every 3-5s and stand slightly to the side of a tile rather than dead
  centre. Both matter: over half the road route is building tiles (6 of 11 on a 9-memory
  world), so the first attempt — a 7-16s idle at the tile centre — spent most of its time
  standing invisibly inside a house and read as broken.

## Unreleased — asset_packs_and_textures branch

### Added
- Six new raw Kenney CC0 asset packs under `assets/`, downloaded for evaluation as
  alternatives/additions to the current `kenney-hexagon-kit` visuals:
  `kenney_castle-kit`, `kenney_cube-pets_1.0`, `kenney_factory-kit_3.0`,
  `kenney_fantasy-town-kit_2.0`, `kenney_holiday-kit`, `kenney_pirate-kit`.
- `assets/standalone/` — a curated, category-sorted subset of the *standalone* (drop-in,
  no-assembly-required) objects pulled from those packs, ready to reference directly:
  - `animals/cube-pets/` (24) — cat, dog, fox, panda, penguin, etc.
  - `buildings/` — `fantasy-town-kit/` (windmill, watermill, watermill-wide),
    `pirate-kit/` (tower-complete-large/small)
  - `ships/pirate-kit/` (10) — pirate ships, ghost ship, wreck, rowboats
  - `siege-weapons/castle-kit/` (10) — ballista, catapult, ram, trebuchet, siege tower
    (+ demolished variants)
  - `vehicles/holiday-kit/` (13) — toy train set (locomotive/wagons/rails)
  - `machinery/factory-kit/` (57) — cranes, robot arms, screens, cogs, gauges
  - `nature/`, `decor/` (castle/fantasy-town/holiday/pirate kits) — trees, rocks, palm
    trees, flags, lanterns, carts, market stalls, bridges, gates, crates
  - `holiday-decor/holiday-kit/` (40) — presents, snowmen, gingerbread, wreaths,
    menorah/kinara

  Each `<category>/<kit>/` folder is self-contained with its own `Textures/variation-a.png`
  (renamed from the kit's native `colormap.png` to match this repo's existing texture-naming
  convention — see `kenney-hexagon-kit`). 269 GLBs total, ~12MB.

  Deliberately **excluded** from `assets/standalone/`: every architectural/connective piece
  from each kit — walls, roofs, doors, fences, conveyors, pipes, catwalks, structure-wall
  segments, road/rail-connector pieces. Those still exist in each pack's own raw folder for a
  future building-composition feature; they just aren't standalone drop-in objects today.

### Not included
- `kenney_nature-kit` and `kenney_space-kit` downloads were evaluated and **not** added —
  both turned out to be 2D isometric PNG sprite packs, not 3D GLB models, and are
  incompatible with this project's Three.js/GLTFLoader pipeline as-is.

### Not yet done
- None of this is wired into the running game — `assets/standalone/` is a staging area for
  picking what to actually use, not live content yet.
