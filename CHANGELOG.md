# Changelog

Notable changes to Memory Planet, newest first.

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
