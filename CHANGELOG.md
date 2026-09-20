# Changelog

Notable changes to Memory Planet, newest first.

## Unreleased — land-walker-pets branch

### Added
- **Land-walker pets** — a second pet kind alongside the four procedural sky-orbiters, in
  `src/world/land-animals.js`. Eight of them (bunny, pig, dog, fox, cow, deer, lion,
  elephant), each a real GLB from `assets/standalone/animals/cube-pets/`, wandering tile to
  tile on land in both the planet and island views. The models have no walk animation, so a
  step is a position slide with a small hop.
- **Characters** — 12 residents from Kenney Mini Characters
  (`assets/standalone/characters/mini-characters/`), sold in their own **Characters** shop tab
  and held in their own equip slot, so a character and a pet can be out at the same time. They
  run the same wander FSM as the pets and differ only in what `src/world/world.js` injects:
  they keep to the road route, and they render at twice a pet's on-screen height.
  - Both packs are loaded per the repo's one-`LoadingManager`-per-pack rule, and both folders
    were removed from `.vercelignore` in the same change.
  - `unlocks.characters` / `equipped.character` are new store fields; `normalize()` backfills
    them, so no store version bump was needed.

### Notes for whoever touches this next
- `CHARACTER_*_SCALE` is ~4.7x `LAND_ANIMAL_*_SCALE`, not 2x. The two packs are modelled at
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
