// MI.world — scene/render/spawn (owners A + B, per docs/CONTRACT.md).
// The planet is one merged polygon mesh built from data/hexgrid.json — the same technique
// validated in tools/hexsphere-inspector.js. Every tile starts water; claiming a tile recolors
// it to land and shifts its UVs to the grass half of the atlas. Buildings and people are
// separate Kenney GLB props placed on top. Nothing here decides *what* to place — that comes
// from persisted Memory/Person records, so a reload reproduces the planet exactly.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  // The planet mesh is always built at RADIUS in its own space; the planet group is scaled
  // by frequency / 10 (see setPlanet), so every size keeps the same world-space tile size —
  // a bigger planet is a bigger ball, not a finer one. Anything measured "per tile" below is
  // tuned at frequency 10 and multiplied by `unit` (10 / frequency) to stay in proportion.
  var RADIUS = 5;
  var REFERENCE_FREQUENCY = 10;
  var GAP_AMOUNT = 0; // 0 = tiles share exact edges, no gaps — a seamless connected sphere

  // Palette comes from the active theme (src/world/themes.js); applyThemeColors() writes
  // into these in place, so everything that reads them picks the theme up.
  var WATER_COLOR = new THREE.Color(0x3f8fc4);
  var LAND_COLOR = new THREE.Color(0x8fc75a);
  var LAND_SIDE_COLOR = new THREE.Color(0x8a6239);  // dirt under the grass
  var WATER_SIDE_COLOR = new THREE.Color(0x24668c); // deep water below the surface
  var currentTheme = null; // set in init()
  // Deep enough that a bobbing tile never separates from its neighbours far enough to
  // show a crack through to the background (waves peak at WAVE_AMPLITUDE either way).
  var BASE_TILE_DEPTH = 0.16;
  // How far a claimed tile rises out of the sea. Everything standing on land (buildings,
  // people) is offset by the same amount so it doesn't sink into the raised surface.
  // Kept just clear of WAVE_AMPLITUDE so water never washes over land, but low enough that
  // the planet reads like the flat view rather than a plateau.
  var BASE_LAND_LIFT = 0.07;
  var BASE_WAVE_AMPLITUDE = 0.035; // subtle — a fraction of the tile spacing
  // Scaled copies of the above for the current planet size (set by applyPlanetScale).
  var TILE_DEPTH = BASE_TILE_DEPTH;
  var LAND_LIFT = BASE_LAND_LIFT;
  var WAVE_AMPLITUDE = BASE_WAVE_AMPLITUDE;
  var WAVE_SPEED = 1.3;
  // Pattern size relative to the planet. Tuned against this grid's ~0.6-unit tile spacing;
  // the sandbox in tools/water-tile.js used 1.0 for tiles ~3.5x larger.
  var WATER_PATTERN_SCALE = 0.32;

  // The cube-pets models are modeled much larger in their own local units (~1.5 tall) than
  // the hex-kit's people/buildings, so walking pets need their own, much smaller,
  // fraction of the usual tile-relative scale — measured against animal-dog.glb's own
  // bounding box, tuned to land a bit smaller than a person.
  var PET_SPHERE_SCALE = 0.07;
  var PET_FLAT_SCALE = 0.09;

  // Characters render at twice a pet's on-screen height. These are NOT 2x the numbers above,
  // and shouldn't be "tidied" to match them: the Mini Characters pack is modelled at about
  // 0.42x the Cube Pets' raw size (mean height 0.72 against 1.71), so hitting a true 2x takes
  // roughly 4.7x the constant. Measured from the packs' own bounding boxes.
  var RESIDENT_SPHERE_SCALE = 0.33;
  var RESIDENT_FLAT_SCALE = 0.27; // same as PLAYER_FLAT_SCALE: a person is about a third of a house
  // Where a friend stands on the road, and where a memory's building is on the planet, both in
  // tile-widths from the tile's centre. On the island the building is a measured footprint box
  // (state.island.blockers) instead, and RESIDENT_CLEARANCE, in world units, keeps them off its walls.
  var RESIDENT_REST_SPHERE = 0.3, RESIDENT_REST_FLAT = 0.26;
  var RESIDENT_CORE = 0.25;
  var RESIDENT_CLEARANCE = 0.05;

  var HEX_PACK = 'assets/kenney-hexagon-kit/';
  // The kit's tiles are 1.0 unit flat-to-flat; props are scaled to whatever the grid's real
  // tile spacing turns out to be, so changing the hexgrid frequency doesn't break the fit.
  var KIT_TILE_WIDTH = 1.0;

  // Terrain seeded around a memory, so a biome grows out of what you wrote. `grand` is
  // reserved for important entries — that's what finally makes `importance` visible.
  //
  // The world should read as GREEN. `other` is the keyword guess's catch-all and takes a
  // large share of entries, so whatever it plants sets the tone of the whole island: it was
  // dirt, and a planet of dirt is what you got. Keep the brown tiles for a memory that is
  // actually about stone or sand.
  //
  // `grass-forest` is a whole copse on one tile and the character walks through, not around,
  // so a forest on every other tile leaves the follow camera inside the branches. It is one
  // feature among several rather than the only one, and FEATURE_CHANCE keeps features rare.
  var CATEGORY_TERRAIN = {
    achievement: { plain: ['stone.glb'], feature: ['stone-rocks.glb'], grand: ['stone-mountain.glb', 'stone-hill.glb'] },
    travel: { plain: ['sand.glb'], feature: ['sand-rocks.glb', 'sand-desert.glb'], grand: ['sand-desert.glb'] },
    home: { plain: ['grass.glb'], feature: ['grass-hill.glb', 'grass-forest.glb'], grand: ['grass-hill.glb'] },
    everyday: { plain: ['grass.glb'], feature: ['grass-hill.glb', 'grass-forest.glb'], grand: ['grass-hill.glb'] },
    social: { plain: ['grass.glb'], feature: ['grass-hill.glb', 'grass-forest.glb'], grand: ['grass-hill.glb'] },
    other: { plain: ['grass.glb'], feature: ['grass-hill.glb', 'grass-forest.glb'], grand: ['grass-hill.glb'] }
  };

  // How often a seeded tile is a feature (trees, rocks, dunes) rather than plain ground.
  var FEATURE_CHANCE = 0.3;

  // The sphere can't place whole kit tiles on its irregular cells, so terrain shows up
  // there as the cell's own colour instead — each theme's `tint` table (themes.js).

  // Where a building model comes from. The hexagon kit is the default and needs no entry;
  // anything drawn from another pack names its folder here. Packs are kept apart rather than
  // pooled into one because each ships its own texture atlas — see loaderFor().
  var PACKS = {
    'kenney-hexagon-kit': HEX_PACK,
    'pirate': 'assets/standalone/buildings/pirate-kit/'
  };
  var DEFAULT_PACK = 'kenney-hexagon-kit';

  function packPath(pack) {
    return PACKS[pack] || PACKS[DEFAULT_PACK];
  }

  // Buildings from the other packs. The hexagon kit's models are authored to sit on a tile of
  // KIT_TILE_WIDTH, so they need no correction; these are modelled at their own sizes and
  // carry a measured factor instead. Measure a new one against a hexagon-kit house rather
  // than guessing — the numbers are not close.
  //
  // These do NOT follow the theme. Theme recolouring is an HSL pass over the hexagon kit's
  // atlas (themes.js), and each pack has its own, so under Frostfall these stay summery. A
  // handful of models is worth that; a hundred would not be.
  // LOOK AT A MODEL BEFORE PUTTING IT IN HERE. `assets/standalone/` is sorted by folder name,
  // not by inspection, and `buildings/` contains component parts: the fantasy-town "windmill"
  // is its sails alone (two crossed poles, no mill) and both "watermills" are a bare wheel.
  // All three were catalogued as buildings and planted on the island before anyone rendered
  // them. `/asset-sheet/` exists to make that a ten-second check. The hexagon kit's own
  // building-mill and building-watermill are the real mills.
  //
  // Scales are set by measuring what LANDS ON THE TILE, not from the raw GLB box — a box
  // counts parts that never read as height. Reference: a hexagon-kit building stands 0.52 in
  // model units above its tile, and these aim at 1.1-1.5x that, so a foreign building reads as
  // a landmark without towering over the street. The pirate tower at its "footprint fits the
  // tile" scale came out 2.9x and had to come down by half.
  var FOREIGN_BUILDINGS = {
    'tower-complete-large.glb': { pack: 'pirate', scale: 0.073 }, // -> 0.75 (1.4x)
    'tower-complete-small.glb': { pack: 'pirate', scale: 0.103 }, // -> 0.70 (1.3x)
    'tower-watch.glb': { pack: 'pirate', scale: 0.25 },           // -> 0.70 (1.3x)
    'castle-gate.glb': { pack: 'pirate', scale: 0.17 }            // -> 0.75 (1.4x)
  };

  function buildingSpec(key) {
    return FOREIGN_BUILDINGS[key] || { pack: DEFAULT_PACK, scale: 1 };
  }

  // What a category is KNOWN for. It is no longer all a category can have: six categories
  // splitting the kit's eighteen buildings three or four ways, with the keyword guess sending
  // most entries to `other`, meant you saw the same three models over and over. A memory now
  // takes its category's own building most of the time and any building the rest of the time,
  // so a street varies without a farm ceasing to mean home.
  var CATEGORY_BUILDINGS = {
    achievement: ['building-castle.glb', 'building-tower.glb', 'building-wizard-tower.glb',
      'building-walls.glb', 'tower-complete-large.glb', 'castle-gate.glb'],
    everyday: ['building-house.glb', 'building-cabin.glb', 'building-mill.glb'],
    travel: ['building-dock.glb', 'building-port.glb', 'tower-complete-small.glb',
      'tower-watch.glb'],
    home: ['building-farm.glb', 'building-sheep.glb', 'building-watermill.glb'],
    social: ['building-village.glb', 'building-market.glb', 'building-archery.glb'],
    other: ['building-mine.glb', 'building-smelter.glb', 'building-wall.glb']
  };

  // How often a memory gets one of its own category's buildings rather than any building.
  var SIGNATURE_CHANCE = 0.6;

  // Every building there is, category order, no repeats — the pool for the other 40%, and the
  // list the detail card offers when you want to swap one out by hand.
  var ALL_BUILDINGS = (function () {
    var seen = {}, all = [];
    Object.keys(CATEGORY_BUILDINGS).forEach(function (category) {
      CATEGORY_BUILDINGS[category].forEach(function (key) {
        if (!seen[key]) { seen[key] = true; all.push(key); }
      });
    });
    return all;
  })();

  var PERSON_COLORS = [0xff9f68, 0x7ec8e3, 0xf7b7d2, 0xa5d86e, 0xc3a5f0, 0xffd97d, 0x6fd8c0, 0xf2836b];

  // Prototype: one grayscale atlas multiplies the live vertex colors. Water is
  // on the left, grass on the right; generated once, with no external assets.
  function makeSurfaceTexture() {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    var ctx = canvas.getContext('2d');
    var seed = 17;
    function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    // Broad, low-contrast mottling survives zooming out. Grayscale keeps the
    // palette in WATER_COLOR / LAND_COLOR instead of baking it into the atlas.
    var pixels = ctx.createImageData(256, 128);
    for (var y = 0; y < 128; y++) {
      for (var x = 0; x < 256; x++) {
        var shade = 222 + 5 * Math.sin(x * 0.08 + Math.sin(y * 0.06))
          + 4 * Math.cos(y * 0.11 - x * 0.03);
        var p = (y * 256 + x) * 4;
        pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = shade;
        pixels.data[p + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    ctx.lineCap = 'round';
    // Small, broken glints avoid the visible seams of full-width ripple lines.
    for (var ripple = 0; ripple < 18; ripple++) {
      var rx = 10 + random() * 94;
      var ry = 10 + random() * 108;
      var length = 5 + random() * 10;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(rx + length * 0.5, ry + 2, rx + length, ry);
      ctx.stroke();
    }
    for (var i = 0; i < 85; i++) {
      var gx = 138 + random() * 108;
      var gy = 10 + random() * 108;
      var height = 2 + random() * 4;
      ctx.strokeStyle = random() < 0.5 ? 'rgba(70, 70, 70, 0.16)' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx - 2, gy - height);
      ctx.lineTo(gx, gy);
      ctx.lineTo(gx + 2, gy - height * 0.7);
      ctx.stroke();
    }
    var texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // Procedural water, ported from the flat sandbox in tools/water-tile.js. Two changes for
  // the sphere: surface coordinates come from a triplanar projection off the sphere normal
  // (the sandbox could use world .xz because every tile lay in one plane), and it's injected
  // into MeshStandardMaterial via onBeforeCompile rather than being its own ShaderMaterial,
  // so land tiles in the same merged mesh keep real lighting and shadows.
  var WATER_GLSL = [
    'uniform float uTime, uWaterScale, uShimmer;',
    'uniform vec3 uDeep, uShallow, uFoam;',
    'varying vec3 vWorldPos;',
    'varying float vLandMix;',
    'varying vec3 vSurfaceNormal;',
    '',
    'vec2 mp_hash2(vec2 p) {',
    '  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);',
    '}',
    'float mp_noise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 s = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mp_hash2(i).x, mp_hash2(i + vec2(1, 0)).x, s.x),',
    '             mix(mp_hash2(i + vec2(0, 1)).x, mp_hash2(i + vec2(1, 1)).x, s.x), s.y);',
    '}',
    '// Moving Voronoi cells warped into curved, interlocking caustic ribbons. The',
    '// second-nearest distance gives an edge without a sampled texture.',
    'float mp_caustic(vec2 p, float t) {',
    '  vec2 cell = floor(p), f = fract(p);',
    '  float first = 8.0, second = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 offset = vec2(float(x), float(y));',
    '      vec2 seed = mp_hash2(cell + offset);',
    '      vec2 point = 0.5 + 0.40 * sin(t * 0.65 + 6.283185 * seed);',
    '      float d = length(offset + point - f);',
    '      second = max(first, min(second, d));',
    '      first = min(first, d);',
    '    }',
    '  }',
    '  float edge = second - first;',
    '  float aa = max(fwidth(edge), 0.006);',
    '  return 1.0 - smoothstep(0.035 - aa, 0.075 + aa, edge);',
    '}',
    'vec2 mp_flow(vec2 p, float t) {',
    '  vec2 flow = p + vec2(t * 0.12, -t * 0.075);',
    '  vec2 warp = vec2(sin(p.y * 2.3 + t * 0.7), cos(p.x * 2.0 - t * 0.55)) * 0.19;',
    '  return flow + warp;',
    '}',
    'vec3 mp_water(vec3 worldPos, vec3 n, float t) {',
    '  // Concentrated blend weights mean usually only one or two planes are evaluated.',
    '  vec3 blend = pow(abs(n), vec3(4.0));',
    '  blend /= max(blend.x + blend.y + blend.z, 0.0001);',
    '  vec3 p3 = worldPos / uWaterScale;',
    '',
    '  float depth = 0.0, ribbon = 0.0, pool = 0.0;',
    '  if (blend.x > 0.01) {',
    '    vec2 p = p3.zy; vec2 fw = mp_flow(p, t);',
    '    depth += blend.x * mp_noise(fw * 0.9);',
    '    vec2 q = fw * 1.9; q += 0.32 * vec2(sin(q.y * 2.2 + t * 0.6), sin(q.x * 2.0 - t * 0.5));',
    '    ribbon += blend.x * mp_caustic(q, t);',
    '    pool += blend.x * mp_noise(p * 1.4 - vec2(t * 0.16, t * 0.08));',
    '  }',
    '  if (blend.y > 0.01) {',
    '    vec2 p = p3.xz; vec2 fw = mp_flow(p, t);',
    '    depth += blend.y * mp_noise(fw * 0.9);',
    '    vec2 q = fw * 1.9; q += 0.32 * vec2(sin(q.y * 2.2 + t * 0.6), sin(q.x * 2.0 - t * 0.5));',
    '    ribbon += blend.y * mp_caustic(q, t);',
    '    pool += blend.y * mp_noise(p * 1.4 - vec2(t * 0.16, t * 0.08));',
    '  }',
    '  if (blend.z > 0.01) {',
    '    vec2 p = p3.xy; vec2 fw = mp_flow(p, t);',
    '    depth += blend.z * mp_noise(fw * 0.9);',
    '    vec2 q = fw * 1.9; q += 0.32 * vec2(sin(q.y * 2.2 + t * 0.6), sin(q.x * 2.0 - t * 0.5));',
    '    ribbon += blend.z * mp_caustic(q, t);',
    '    pool += blend.z * mp_noise(p * 1.4 - vec2(t * 0.16, t * 0.08));',
    '  }',
    '',
    '  vec3 color = mix(uDeep, uShallow, smoothstep(0.05, 0.95, depth) * 0.8 + 0.1);',
    '  color = mix(color, uFoam, ribbon * (0.24 + 0.40 * pool));',
    '',
    '  // Analytic wave slopes move the reflected sun even though the surface barely moves.',
    '  // Intentionally a broad, cartoon specular highlight.',
    '  vec2 sp = p3.xz + p3.zy;',
    '  float a = sp.x * 3.2 + sp.y * 2.1 - t * 1.4;',
    '  float b = sp.x * -2.4 + sp.y * 3.0 + t * 0.95;',
    '  vec3 bump = normalize(n + vec3(-0.15 * cos(a) + 0.10 * cos(b), 0.0, -0.10 * cos(a) - 0.13 * cos(b)));',
    '  vec3 view = normalize(cameraPosition - worldPos);',
    '  vec3 sun = normalize(vec3(-0.3, 1.0, -0.65));',
    '  float spec = dot(reflect(-sun, bump), view);',
    '  float sheen = smoothstep(0.93, 0.995, spec) * 0.14;',
    '  float glint = smoothstep(0.996, 0.999, spec) * 0.60;',
    '  color = mix(color, uFoam, (sheen + glint) * uShimmer);',
    '  float fresnel = pow(1.0 - max(dot(bump, view), 0.0), 3.0);',
    '  return mix(color, uShallow, fresnel * 0.45);',
    '}'
  ].join('\n');

  function installWaterShader(material) {
    var theme = currentTheme || MI.world.themes.get('meadow');
    material.userData.waterUniforms = {
      uTime: { value: 0 },
      uWaterScale: { value: WATER_PATTERN_SCALE },
      uShimmer: { value: 0.65 },
      uDeep: { value: new THREE.Color(theme.deep).convertSRGBToLinear() },
      uShallow: { value: new THREE.Color(theme.shallow).convertSRGBToLinear() },
      uFoam: { value: new THREE.Color(theme.foam).convertSRGBToLinear() }
    };

    material.onBeforeCompile = function (shader) {
      Object.keys(material.userData.waterUniforms).forEach(function (key) {
        shader.uniforms[key] = material.userData.waterUniforms[key];
      });

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', [
          '#include <common>',
          'attribute float aLand;',
          'varying vec3 vWorldPos;',
          'varying float vLandMix;',
          'varying vec3 vSurfaceNormal;'
        ].join('\n'))
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vLandMix = aLand;',
          // beginnormal_vertex runs earlier in this shader, so objectNormal is available.
          // Carrying the real normal (rather than assuming worldPos points outward) is what
          // lets the same water work on the sphere AND on the flat layout.
          'vSurfaceNormal = normalize(mat3(modelMatrix) * objectNormal);'
        ].join('\n'));

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WATER_GLSL)
        // map_fragment has already applied the atlas + vertex color, which is what land
        // wants; water throws that away and uses the procedural colour instead.
        .replace('#include <map_fragment>', [
          '#include <map_fragment>',
          'if (vLandMix < 0.5) {',
          '  diffuseColor.rgb = mp_water(vWorldPos, normalize(vSurfaceNormal), uTime);',
          '}'
        ].join('\n'));

      material.userData.shader = shader;
    };
  }

  function normalize(v) {
    var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function hash(n) {
    return ((n * 2654435761) >>> 0) / 4294967296;
  }
  // Overshoots past 1 then settles — the springy part of the "pop".
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeOutBackSoft(t) {
    var c1 = 1.12, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  var state = null;      // everything built in init(), shared with the public API below
  var animations = [];   // each entry: fn(nowMs) -> true when finished
  var pickListeners = [];
  var shipPickListeners = [];
  // cb(slot | null) -> truthy when that tile is worth a pointer cursor. The UI decides what
  // counts, and does its own highlighting inside the callback.
  var hoverListener = null;

  function animate(durationMs, step) {
    var start = performance.now();
    animations.push(function (now) {
      var t = Math.min(1, (now - start) / durationMs);
      if (step(t) === true) return true;
      return t >= 1;
    });
  }

  // --- Public API ---------------------------------------------------------------------

  // Which building a category gets. Called once by MI.app and then persisted on the Memory,
  // so the same memory always renders the same building (CLAUDE.md: no Math.random() at spawn).
  function pickAssetFor(category, seed) {
    var signature = CATEGORY_BUILDINGS[category] || CATEGORY_BUILDINGS.other;
    var options = hash(seed * 7 + 3) < SIGNATURE_CHANCE ? signature : ALL_BUILDINGS;
    var index = Math.floor(hash(seed || 0) * options.length) % options.length;
    return assetFor(options[index]);
  }

  // A building file as it is stored on a Memory. Saved rather than looked up each time, so a
  // model can move packs later without rewriting what is already on the planet.
  function assetFor(key) {
    return { pack: buildingSpec(key).pack, key: key };
  }

  // Which terrain a seeded tile gets. `index` is its position in that memory's little
  // cluster, so the first tile of an important memory becomes the hill or mountain.
  function pickTerrainFor(category, importance, seed, index) {
    var table = CATEGORY_TERRAIN[category] || CATEGORY_TERRAIN.other;
    var bucket;
    if (index === 0 && importance >= 4) bucket = table.grand;
    else bucket = hash(seed * 31 + index) < FEATURE_CHANCE ? table.feature : table.plain;
    return bucket[Math.floor(hash(seed * 17 + index * 7) * bucket.length) % bucket.length];
  }

  // How many landscape tiles a memory drags along with it. Bigger memories spread further.
  function landscapeCountFor(importance, seed) {
    return 1 + Math.floor(hash(seed * 13) * 2) + (importance >= 4 ? 1 : 0);
  }

  // The main house stands on the home tile in both views. Drawn larger than a memory's
  // building so it reads as the middle of your world rather than one more thing on it.
  var HOUSE_SCALE = 1.45;

  function spawnHouse(house, options) {
    if (!state || !house || typeof house.slot !== 'number') return Promise.resolve();
    var opts = options || {};
    setTileLand(house.slot);
    if (opts.animate !== false) popTile(house.slot);
    return placeProp(HEX_PACK + house.asset, { slot: house.slot, scale: HOUSE_SCALE }, {
      animate: opts.animate !== false,
      rotY: 0,
      tag: { type: 'house', slot: house.slot }
    });
  }

  // Placeholder gathering hall for the friend hub. Village-kit piece, distinct from the
  // main house, so it reads as a place people meet rather than a second home.
  var HUB_SCALE = 1.32;
  var HUB_TILE_TOP = new THREE.Color(0x8d4de2);  // violet pad, so the hall isn't just another house
  var HUB_TILE_SIDE = new THREE.Color(0x5a3480);
  var HUB_GLOW = new THREE.Color(0xc489ff);
  var HUB_HALO_COLOR = 0xd4a6ff;
  var HUB_PULSE_MS = 1600;

  function spawnHub(hub, options) {
    if (!state || !hub || typeof hub.slot !== 'number') return Promise.resolve();
    var opts = options || {};
    setTileLand(hub.slot, landTopColor(hub.slot));
    // Already land (a reload, a remap): setTileLand no-ops, so paint the pad ourselves.
    if (!state.waterTileIds.has(hub.slot)) {
      writeTileColors(hub.slot, landTopColor(hub.slot), landSideColor(hub.slot));
    }
    if (opts.animate !== false) popTile(hub.slot);
    return placeProp(HEX_PACK + hub.asset, { slot: hub.slot, scale: HUB_SCALE }, {
      animate: opts.animate !== false,
      rotY: Math.PI / 3,
      tag: { type: 'hub', slot: hub.slot }
    }).then(function (obj) {
      if (state.flatMode || state.transition) {
        return refreshFlatView(hub.slot).then(function () { return obj; });
      }
      return obj;
    });
  }

  function spawnLandscape(entry, options) {
    if (!state || typeof entry.slot !== 'number') return;
    // Remembered so a theme change can repaint this tile in place.
    if (state.waterTileIds.has(entry.slot)) state.landAsset[entry.slot] = entry.asset;
    setTileLand(entry.slot, landTopColor(entry.slot));
    if (!options || options.animate !== false) popTile(entry.slot);
  }

  function landTopColor(slot) {
    if (isHubBuildingSlot(slot)) return HUB_TILE_TOP;
    var asset = state.landAsset[slot];
    var hex = asset ? currentTheme.tint[asset] : undefined;
    return hex === undefined ? LAND_COLOR : new THREE.Color(hex);
  }

  function landSideColor(slot) {
    return isHubBuildingSlot(slot) ? HUB_TILE_SIDE : LAND_SIDE_COLOR;
  }

  function spawnMemory(memory, options) {
    if (!state) return Promise.resolve();
    var opts = options || {};
    var slot = memory.placement && memory.placement.slot;
    if (typeof slot !== 'number') return Promise.resolve();

    setTileLand(slot);
    if (opts.animate !== false) popTile(slot);

    var asset = memory.asset && memory.asset.key ? memory.asset : pickAssetFor(memory.category, slot);
    // A building is persisted on its memory, so a model retired from the catalogue would leave
    // a saved world asking for a file that is no longer served: the url 404s and the tile comes
    // up empty, with nothing to say why. Re-pick and keep it instead. (Three fantasy-town
    // "buildings" were retired this way once they turned out to be rotor parts.)
    if (ALL_BUILDINGS.indexOf(asset.key) === -1) {
      asset = pickAssetFor(memory.category, slot);
      memory.asset = asset;
    }
    var spec = buildingSpec(asset.key);
    return placeProp(packPath(asset.pack) + asset.key, memory.placement, {
      animate: opts.animate !== false,
      rotY: (memory.placement && memory.placement.rotY) || 0,
      modelScale: spec.scale,
      tag: { type: 'memory', id: memory.id, slot: slot }
    }).then(function (obj) {
      rebuildRoads(); // the new tile may extend or reroute the network
      // The flat view is a rebuilt snapshot, not a live scene — without this, a memory
      // written while in flat mode wouldn't appear until you toggled out and back.
      if (state.flatMode || state.transition) {
        return refreshFlatView(slot).then(function () { return obj; });
      }
      return obj;
    });
  }

  // A tiny local character keeps every person visible even with no external asset pack.
  function makePersonModel(colorHex) {
    var person = new THREE.Group();
    var shirt = new THREE.MeshStandardMaterial({ color: colorHex || PERSON_COLORS[0], flatShading: true });
    var skin = new THREE.MeshStandardMaterial({ color: 0xf2c49b, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x4b6470, flatShading: true });
    function part(geometry, material, x, y, z) {
      var mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      person.add(mesh);
    }
    part(new THREE.CylinderGeometry(0.17, 0.21, 0.36, 6), shirt, 0, 0.34, 0);
    part(new THREE.SphereGeometry(0.16, 8, 6), skin, 0, 0.66, 0);
    part(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 5), dark, -0.09, 0.08, 0);
    part(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 5), dark, 0.09, 0.08, 0);
    // Tagged so setSkin() can find and re-dress every figure in place, in either view.
    person.userData.isPerson = true;
    person.userData.color = colorHex || PERSON_COLORS[0];
    MI.world.cosmetics.dressPerson(person, state ? state.skin : 'classic', person.userData.color);
    return person;
  }

  // A friend's name, floating just above the head. Sprites face the camera on their own, so
  // the same plaque works on the planet (where up is the tile normal) and on the island.
  // Size is kept in WORLD units by counter-scaling after the walker group is scaled, or a
  // tag on a small planet would shrink to a speck and one on the island would cover a house.
  var NAMETAG_WORLD_W = 0.9;
  var NAMETAG_WORLD_H = 0.24;
  var NAMETAG_HEAD_Y = 0.92; // Mini Characters rest at y=0 and stand ~0.7 tall

  function makeNameTag(text) {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    var label = String(text || '').trim().slice(0, 18);
    if (!label) return null;
    ctx.font = '700 22px Quicksand, Nunito, sans-serif';
    var w = Math.min(240, Math.max(64, ctx.measureText(label).width + 28));
    var x = (256 - w) / 2, y = 16, h = 34, r = 12;
    ctx.fillStyle = 'rgba(255, 247, 236, 0.94)';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 201, 160, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#c45c26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, y + h / 2 + 1);
    var tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false
    });
    var sprite = new THREE.Sprite(mat);
    sprite.position.y = NAMETAG_HEAD_Y;
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 3;
    sprite.userData.isNameTag = true;
    sprite.userData.nameTagWorldW = NAMETAG_WORLD_W;
    sprite.userData.nameTagWorldH = NAMETAG_WORLD_H;
    return sprite;
  }

  function disposeNameTag(group) {
    if (!group) return;
    var drop = [];
    group.children.forEach(function (ch) {
      if (ch.userData && ch.userData.isNameTag) drop.push(ch);
    });
    drop.forEach(function (ch) {
      group.remove(ch);
      if (ch.material) {
        if (ch.material.map) ch.material.map.dispose();
        ch.material.dispose();
      }
    });
  }

  function sizeNameTag(group) {
    if (!group) return;
    var s = group.scale.x || 1;
    group.children.forEach(function (ch) {
      if (!ch.userData || !ch.userData.isNameTag) return;
      ch.scale.set(ch.userData.nameTagWorldW / s, ch.userData.nameTagWorldH / s, 1);
    });
  }

  function setNameTag(group, name) {
    disposeNameTag(group);
    var sprite = makeNameTag(name);
    if (!sprite) return;
    group.add(sprite);
    sizeNameTag(group);
  }

  function spawnPerson(person, options) {
    if (!state || !person || !person.placement) return Promise.resolve();
    var currentState = state;
    var modelId = MI.world.walkers.residentModelFor(person);
    person.appearance = person.appearance || {};
    if (person.appearance.model !== modelId) {
      person.appearance.model = modelId;
      MI.store.save();
    }
    return MI.world.walkers.makeWalkerPair(modelId, function () {
      return makePersonModel(person.appearance && person.appearance.color);
    }).then(function (pair) {
      if (!pair || state !== currentState) return;
      var previous = state.residentWalkers[person.id];
      if (previous) {
        state.residentGroup.remove(previous.sphere.group);
        state.flatGroup.remove(previous.flat.group);
        disposeWalkerPair(previous);
      }
      pair.person = person;
      pair.sphere.tileId = pair.sphere.targetId = person.placement.slot;
      pair.flat.tileId = pair.flat.targetId = person.placement.slot;
      pair.sphere.group.userData.tag = { type: 'person', id: person.id, slot: person.placement.slot };
      pair.flat.group.userData.tag = pair.sphere.group.userData.tag;
      setNameTag(pair.sphere.group, person.name);
      setNameTag(pair.flat.group, person.name);
      state.residentWalkers[person.id] = pair;
      state.residentGroup.add(pair.sphere.group);
      if (state.flatMode && state.island) state.flatGroup.add(pair.flat.group);
      if (!options || options.animate !== false) popIn(pair.sphere.group);
      return pair;
    });
  }

  // Take a resident off the world. Editing a memory can untag the only mention a person ever
  // had, and someone nobody has written about should not still be wandering around.
  function despawnPerson(personId) {
    if (!state || !personId) return;
    var pair = state.residentWalkers[personId];
    if (!pair) return;
    state.residentGroup.remove(pair.sphere.group);
    state.flatGroup.remove(pair.flat.group);
    disposeWalkerPair(pair);
    delete state.residentWalkers[personId];
  }

  // Rotate the planet under the camera so `slot` faces the viewer. Meaningless in flat mode,
  // where the layout is centred on the origin and a tile's sphere direction says nothing
  // about where it ended up.
  function focus(slot, options) {
    if (!state || state.flatMode || state.transition) return;
    var tile = MI.world.sphere.tile(slot);
    if (!tile) return;
    var dir = tile.dir;
    // Camera orbit angles that look straight down at this direction.
    var targetPhi = Math.acos(Math.max(-1, Math.min(1, dir[1])));
    var targetTheta = Math.atan2(dir[0], dir[2]);
    targetPhi = clampPhi(targetPhi);

    if (options && options.instant) {
      state.camPhi = targetPhi;
      state.camTheta = targetTheta;
      state.updateCamera();
      return;
    }

    var fromTheta = state.camTheta, fromPhi = state.camPhi;
    // Take the short way around rather than spinning the long way.
    var delta = ((targetTheta - fromTheta + Math.PI) % (Math.PI * 2)) - Math.PI;
    animate(850, function (t) {
      if (state.transition) return true;
      var e = easeInOut(t);
      state.camTheta = fromTheta + delta * e;
      state.camPhi = fromPhi + (targetPhi - fromPhi) * e;
      state.updateCamera();
    });
  }

  function onPick(cb) {
    pickListeners.push(cb);
  }

  function onShipPick(cb) {
    shipPickListeners.push(cb);
  }

  function onHover(cb) {
    hoverListener = cb;
  }

  // What the detail card offers when you want to swap a building by hand: every building
  // there is, this category's own first, since those are the likeliest picks.
  function buildingsFor(category) {
    var signature = CATEGORY_BUILDINGS[category] || CATEGORY_BUILDINGS.other;
    return signature.concat(ALL_BUILDINGS.filter(function (key) {
      return signature.indexOf(key) === -1;
    }));
  }

  // Swap the building on an already-placed memory (the detail card's override).
  function respawnMemory(memory) {
    if (!state) return Promise.resolve();
    state.props.children
      .filter(function (obj) {
        return obj.userData.tag && obj.userData.tag.type === 'memory'
          && obj.userData.tag.id === memory.id;
      })
      .forEach(function (obj) { state.props.remove(obj); });
    state.spinners = state.spinners.filter(function (obj) { return obj.parent; });
    // spawnMemory refreshes the flat view itself when it's showing, so a swap made from
    // either view lands in both.
    return spawnMemory(memory, { animate: true });
  }

  // --- Flat view -----------------------------------------------------------------------
  // A side-on view of a sphere never looks right: the ground curves away and the kit's rigid
  // hexagons can only ever approximate a curved cell. So instead of tilting the camera, lay
  // the claimed tiles out on a REGULAR flat hex grid, where the kit's regular hexagons fit
  // exactly — no warping, no curvature, no seams. A local patch flattens cleanly; only the
  // whole sphere can't (which is what the 12 pentagons exist to resolve).

  // Built at the same scale as the tools/water-tile.html sandbox, so its tuned values
  // (rim depth, base offset, water pattern size, palette) transfer over directly.
  var FLAT_TILE_RADIUS = 1.1;                             // hexagon circumradius
  var FLAT_SPACING = FLAT_TILE_RADIUS * Math.sqrt(3);     // centre-to-centre = flat-to-flat
  var FLAT_MODEL_SCALE = FLAT_TILE_RADIUS * Math.sqrt(3); // kit corners sit at radius 1/sqrt(3)
  var FLAT_BASE_Y = -0.22;      // kit tiles sink this far, so their bases breach the surface
  // Kit tile tops sit at 0.20 in model space; the road overlay rides just above that.
  // How high a tile's slab is in model units — where your feet go. Measured off the kit's
  // hexagon corner columns: every tile is 0.2 except the dirt family and water, which are
  // half-height, which is why a character standing on dirt used to float above it. Anything
  // sitting ON the slab (a hill's mound, trees, a building) is not walkable surface.
  var TILE_TOP = { 'dirt.glb': 0.1, 'dirt-lumber.glb': 0.1, 'water.glb': 0.1 };
  var TILE_TOP_DEFAULT = 0.2;
  var ROAD_THICKNESS = 0.026; // the path piece is 0.025 deep and is laid 0.001 clear of the slab
  function tileTopOf(asset) {
    var top = TILE_TOP[asset];
    return top === undefined ? TILE_TOP_DEFAULT : top;
  }
  // A path lies ON its tile, so it has to follow that tile's own height, not a fixed one, or
  // it floats over the low tiles.
  function roadLiftFor(asset) {
    return (tileTopOf(asset) + 0.001) * FLAT_MODEL_SCALE;
  }
  var FLAT_BG = new THREE.Color(0xf2f3ed);
  var PLANET_BG = new THREE.Color(0xdff1f7);
  // The island view stops short of straight-on, but far enough round to look up at the rock
  // hanging under the island. On the globe, orbiting all the way round is fine.
  var FLAT_PHI_LIMIT = 1.7;
  // Where the flat view settles: a three-quarter view rather than straight down, so the
  // tiles keep their thickness and the buildings stand up out of the map.
  var FLAT_VIEW_PHI = 0.85;

  function clampPhi(phi) {
    if (state && state.flatMode) return Math.max(0.05, Math.min(FLAT_PHI_LIMIT, phi));
    return Math.max(0.15, Math.min(Math.PI - 0.15, phi));
  }

  // Flat direction k sits at -k*60 degrees (MI.island.DIRS); the kit numbers its edges the
  // other way round (edge e at +e*60 degrees), so this converts for the road connectors.
  function kitEdge(k) {
    return (6 - k) % 6;
  }

  // --- Roads on the sphere ------------------------------------------------------------
  // The kit's path tiles can't be used here: the planet's cells are irregular and no rigid
  // hexagon aligns with them. But the planet's land is our own mesh, so a road can simply
  // be a ribbon laid along the route from one tile's centre to the next.

  // THE road network, computed once on the real sphere grid and shared by both views.
  // Returns slot -> Set of neighbour INDICES (positions in that tile's own neighbors list),
  // which both the planet and the flat layout can translate into their own geometry. Doing
  // this separately per view is what made the two disagree.
  function computeRoadEdges(allTiles) {
    var tiles = allTiles || state.tiles;
    var world = MI.store.get();
    var landSlots = new Set();
    world.landscape.forEach(function (l) { landSlots.add(l.slot); });
    world.memories.forEach(function (m) { if (m.placement) landSlots.add(m.placement.slot); });

    var edges = {};
    function record(slot, neighborSlot) {
      var index = tiles[slot].neighbors.indexOf(neighborSlot);
      if (index < 0) return;
      (edges[slot] = edges[slot] || new Set()).add(index);
    }

    roadConnections(world).forEach(function (pair) {
      var chain = routeOnSphere(pair[0], pair[1], landSlots, tiles);
      if (!chain) return;
      for (var i = 1; i < chain.length; i++) {
        record(chain[i - 1], chain[i]);
        record(chain[i], chain[i - 1]);
      }
    });
    return edges;
  }

  // Which memories should be joined: the chronological spine, then a branch wherever the
  // same person recurs.
  function roadConnections(world) {
    var pairs = [];
    var slotOf = {};
    world.memories.forEach(function (m) { if (m.placement) slotOf[m.id] = m.placement.slot; });

    var chronological = world.memories.slice().sort(function (a, b) {
      var byDate = String(a.occurredOn || '').localeCompare(String(b.occurredOn || ''));
      return byDate !== 0 ? byDate : String(a.createdAt).localeCompare(String(b.createdAt));
    }).map(function (m) { return m.placement && m.placement.slot; })
      .filter(function (s) { return s !== undefined; });
    for (var i = 1; i < chronological.length; i++) {
      pairs.push([chronological[i - 1], chronological[i]]);
    }

    world.people.forEach(function (person) {
      var stops = (person.memoryIds || []).map(function (id) { return slotOf[id]; })
        .filter(function (s) { return s !== undefined; });
      for (var j = 1; j < stops.length; j++) pairs.push([stops[j - 1], stops[j]]);
    });
    return pairs;
  }

  function residentStops(person, world) {
    var slots = {};
    world.memories.forEach(function (m) {
      if (m.placement) slots[m.id] = m.placement.slot;
    });
    return (person.memoryIds || []).map(function (id) { return slots[id]; })
      .filter(function (slot, index, all) { return slot !== undefined && all.indexOf(slot) === index; });
  }

  function residentRoute(stops, neighborsOf) {
    var route = new Set(stops);
    for (var i = 1; i < stops.length; i++) {
      var from = stops[i - 1], to = stops[i];
      var seen = new Set([from]), previous = {}, queue = [from];
      for (var at = 0; at < queue.length && !seen.has(to); at++) {
        neighborsOf(queue[at]).forEach(function (next) {
          if (seen.has(next)) return;
          seen.add(next);
          previous[next] = queue[at];
          queue.push(next);
        });
      }
      if (!seen.has(to)) continue;
      for (var slot = to; slot !== from; slot = previous[slot]) route.add(slot);
      route.add(from);
    }
    return route;
  }

  // A resident's route is a shortest path on the roads already visible in the town.
  function residentSphereRoutes(world) {
    var edges = state.roadEdgesCache || computeRoadEdges();
    state.roadEdgesCache = edges;
    var routes = {};
    state.residentStopsCache = {};
    world.people.forEach(function (person) {
      var stops = residentStops(person, world);
      state.residentStopsCache[person.id] = stops;
      var route = residentRoute(stops, function (slot) {
        var tile = state.tiles[slot];
        return tile && edges[slot] ? Array.from(edges[slot]).map(function (k) {
          return tile.neighbors[k];
        }) : [];
      });
      if (person.placement) route.add(person.placement.slot);
      routes[person.id] = route;
    });
    return routes;
  }

  // Walk the real hex grid between two tiles, staying on claimed land.
  function routeOnSphere(from, to, landSlots, allTiles) {
    var tiles = allTiles || state.tiles;
    if (from === to) return null;
    var cameFrom = {}, seen = {};
    seen[from] = true;
    var queue = [from];
    while (queue.length) {
      var id = queue.shift();
      if (id === to) break;
      var tile = tiles[id];
      for (var k = 0; k < tile.sides; k++) {
        var next = tile.neighbors[k];
        if (seen[next]) continue;
        if (!landSlots.has(next) && next !== to) continue; // roads keep to dry land
        seen[next] = true;
        cameFrom[next] = id;
        queue.push(next);
      }
    }
    if (!seen[to]) return null;
    var chain = [to];
    for (var at = to; cameFrom[at] !== undefined; at = cameFrom[at]) chain.unshift(cameFrom[at]);
    return chain;
  }

  // Lay one of the kit's road strips along a segment: stretched to span the gap between two
  // tile centres, lying flat against the sphere. Because the strip is a thin overlay rather
  // than a rigid hexagon, it follows the planet's irregular cells without any of the fitting
  // problems a whole tile would have.
  function placeRoadStrip(parts, dirA, dirB, width) {
    var height = RADIUS + LAND_LIFT + 0.008 * state.unit;
    var p0 = dirA.clone().multiplyScalar(height);
    var p1 = dirB.clone().multiplyScalar(height);
    var up = p0.clone().add(p1).normalize();

    var xAxis = p1.clone().sub(p0);
    var length = xAxis.length();
    xAxis.normalize();
    // Flatten the run against the surface, or the strip tilts into the planet.
    xAxis.sub(up.clone().multiplyScalar(xAxis.dot(up))).normalize();
    var zAxis = new THREE.Vector3().crossVectors(xAxis, up); // x cross y = z keeps it right-handed

    var obj = buildFromParts(parts);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, up, zAxis));
    obj.position.copy(up).multiplyScalar(height);
    obj.scale.set(length, width, width); // model spans 1.0 along X, so X scale is the span
    obj.traverse(function (node) { if (node.isMesh) node.receiveShadow = true; });
    return obj;
  }

  function rebuildRoads() {
    if (!state) return;
    // The network changed; residents rebuild their personal routes on the next frame.
    state.residentRoutesCache = null;
    state.residentStopsCache = null;
    state.roadEdgesCache = null;
    if (state.roadGroup) {
      state.planet.remove(state.roadGroup);
      state.roadGroup = null;
    }

    var world = MI.store.get();
    var buildingSlots = new Set();
    world.memories.forEach(function (m) { if (m.placement) buildingSlots.add(m.placement.slot); });

    var edges = computeRoadEdges();
    state.roadEdgesCache = edges;
    // Each tile paves only its OWN half of every shared edge, out to the midpoint. Two
    // landscape tiles meeting there make a continuous road; a tile facing a building paves
    // up to the boundary and stops — which is exactly what the flat view does.
    var halves = [];
    Object.keys(edges).forEach(function (slot) {
      var id = Number(slot);
      if (buildingSlots.has(id)) return;
      edges[slot].forEach(function (index) {
        halves.push([id, state.tiles[id].neighbors[index]]);
      });
    });
    if (!halves.length) return;

    var group = new THREE.Group();
    state.roadGroup = group;
    state.planet.add(group);

    loadParts(HEX_PACK + 'path-straight.glb').then(function (parts) {
      if (!parts || state.roadGroup !== group) return; // superseded by a newer rebuild
      halves.forEach(function (pair) {
        var tile = state.tiles[pair[0]];
        var dirA = new THREE.Vector3().fromArray(tile.dir);
        var dirB = new THREE.Vector3().fromArray(state.tiles[pair[1]].dir);
        var midway = dirA.clone().add(dirB).normalize(); // the shared edge
        group.add(placeRoadStrip(parts, dirA, midway, tileScale(tile)));
      });
    });
  }

  var PLAYER_RADIUS = 0.1;    // world units
  var PLAYER_HEAD = 0.19;     // the character's height, in a tile model's own units
  var MAX_FOOTPRINT = 1.1;    // world units: a building may fill its tile but not spill far

  // The shape a building actually presents to someone walking into it: the box around every
  // part that is NOT the hex base plate and NOT clear above head height. Tracing the whole
  // model instead follows the ROOF, which overhangs the walls and holds you a step short of
  // the building; a circle is wrong in both directions at once, keeping you off the flat
  // walls while letting you into the corners. Model units, as a centre and half-extents,
  // since a building is not always centred on its tile.
  function footprintBox(parts, headY) {
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, found = false;
    parts.forEach(function (part) {
      if (part.base) return;
      var g = part.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      var box = g.boundingBox, at = part.home;
      if (at.y + box.min.y > headY) return; // starts above your head: walk under it
      found = true;
      minX = Math.min(minX, at.x + box.min.x); maxX = Math.max(maxX, at.x + box.max.x);
      minZ = Math.min(minZ, at.z + box.min.z); maxZ = Math.max(maxZ, at.z + box.max.z);
    });
    if (!found) return null;
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2 };
  }

  // That box in island space: turned by the tile's own rotation and scaled up. The kit's
  // houses are A-frames whose roof comes down to ankle height and reaches past the tile's flat
  // edge, so the box really can be as big as the tile — buildings are never placed adjacent,
  // so a tile you have to walk around is fine. The cap only stops an absurd one.
  function islandBlocker(x, z, rotY, box) {
    var cos = Math.cos(rotY), sin = Math.sin(rotY);
    var room = MAX_FOOTPRINT;
    return {
      x: x + (box.cx * cos + box.cz * sin) * FLAT_MODEL_SCALE,
      z: z + (-box.cx * sin + box.cz * cos) * FLAT_MODEL_SCALE,
      hx: Math.min(box.hx * FLAT_MODEL_SCALE, room),
      hz: Math.min(box.hz * FLAT_MODEL_SCALE, room),
      cos: cos, sin: sin
    };
  }

  // The island view: the planet's land coiled into a compact chunk (MI.island.layout),
  // floating on a rocky underside, with its roads re-routed across the island.
  function buildFlatView() {
    detachHubHalo();
    while (state.flatGroup.children.length) {
      state.flatGroup.remove(state.flatGroup.children[0]);
    }
    // Drop spinners belonging to the tiles we just detached, or every rebuild would leave
    // orphaned rotors turning forever.
    state.spinners = state.spinners.filter(function (obj) { return obj.parent; });

    var world = MI.store.get();
    var landSlots = new Set();
    var buildingSlots = new Set();
    var assetBySlot = {};
    // Terrain first, so a memory's building always wins if they ever overlap.
    world.landscape.forEach(function (entry) {
      landSlots.add(entry.slot);
      assetBySlot[entry.slot] = entry.asset || 'grass.glb';
    });
    world.memories.forEach(function (m) {
      if (!m.placement) return;
      landSlots.add(m.placement.slot);
      buildingSlots.add(m.placement.slot);
      assetBySlot[m.placement.slot] = (m.asset && m.asset.key) || 'grass.glb';
    });
    // The main house last, so it wins its tile even if a memory ever lands on top of it.
    if (world.house && typeof world.house.slot === 'number') {
      landSlots.add(world.house.slot);
      buildingSlots.add(world.house.slot);
      assetBySlot[world.house.slot] = world.house.asset;
    }
    if (world.hub && typeof world.hub.slot === 'number') {
      landSlots.add(world.hub.slot);
      buildingSlots.add(world.hub.slot);
      assetBySlot[world.hub.slot] = world.hub.asset;
    }
    if (!landSlots.size) {
      state.flatRadius = 3;
      state.island = null;
      return Promise.resolve();
    }

    var coiled = MI.island.layout(landSlots, world.home, state.tiles, buildingSlots);
    var cells = coiled.cells;
    var roadEdges = MI.island.roads(cells, roadConnections(world), buildingSlots);
    var roads = {};
    Object.keys(roadEdges).forEach(function (slot) {
      // A building keeps its building; the road tile beside it already points at the door.
      if (buildingSlots.has(Number(slot))) return;
      var piece = MI.connectors.connectorFor(roadEdges[slot].map(kitEdge), 'path');
      if (piece) roads[slot] = piece;
    });

    var ids = Object.keys(cells);
    var cx = 0, cz = 0;
    var raw = {};
    ids.forEach(function (id) {
      raw[id] = MI.island.toXZ(cells[id], FLAT_SPACING);
      cx += raw[id].x;
      cz += raw[id].z;
    });
    cx /= ids.length;
    cz /= ids.length;
    var centres = {}; // slot -> tile centre in island space, with the island centred
    ids.forEach(function (id) { centres[id] = { x: raw[id].x - cx, z: raw[id].z - cz }; });

    console.info('[island view] %d tiles (%d buildings) · radius %s · %d road tiles',
      ids.length, buildingSlots.size, coiled.radius.toFixed(1), Object.keys(roads).length);

    // Turn the island's longest axis across the screen.
    var xx = 0, xz = 0, zz = 0;
    ids.forEach(function (id) {
      var x = centres[id].x, z = centres[id].z;
      xx += x * x; xz += x * z; zz += z * z;
    });
    var angle = 0.5 * Math.atan2(2 * xz, xx - zz);
    state.flatGroup.position.set(0, 0, 0);
    state.flatGroup.scale.setScalar(1);
    state.flatGroup.rotation.set(0, angle, 0);
    // Kept for the planet <-> island animation (makeFoldRig).
    // roadSlots includes building cells that paths run through, even though those cells
    // draw the building rather than a road mesh.
    // blockers: a solid footprint per building, filled in as its model loads — what the
    // character cannot walk through (see footprintBox).
    var blockers = [];
    // groundY: the world height of each tile's walking surface — its slab, plus the path laid
    // on it. What the character and the residents stand on, instead of one height for all.
    var groundY = {};
    ids.forEach(function (id) {
      var top = tileTopOf(assetBySlot[id]) + (roads[id] ? ROAD_THICKNESS : 0);
      groundY[id] = FLAT_BASE_Y + top * FLAT_MODEL_SCALE;
    });
    var cellAt = {}, walkerAdjacency = {}, roadAdjacency = {};
    ids.forEach(function (id) { cellAt[cells[id].i + ',' + cells[id].j] = Number(id); });
    ids.forEach(function (id) {
      walkerAdjacency[id] = MI.island.DIRS.map(function (dir) {
        var cell = cells[id];
        return cellAt[(cell.i + dir[0]) + ',' + (cell.j + dir[1])];
      }).filter(function (slot) { return slot !== undefined; });
    });
    Object.keys(roadEdges).forEach(function (id) {
      roadAdjacency[id] = roadEdges[id].map(function (k) {
        var dir = MI.island.DIRS[k], cell = cells[id];
        return cellAt[(cell.i + dir[0]) + ',' + (cell.j + dir[1])];
      }).filter(function (slot) { return slot !== undefined; });
    });
    var residentRoutes = {};
    world.people.forEach(function (person) {
      var stops = residentStops(person, world);
      var route = residentRoute(stops, function (slot) { return roadAdjacency[slot] || []; });
      if (person.placement && centres[person.placement.slot]) route.add(person.placement.slot);
      residentRoutes[person.id] = route;
    });
    state.island = { cells: cells, centres: centres, roadEdges: roadEdges,
      roadSlots: Object.keys(roadEdges).map(Number),
      walkerAdjacency: walkerAdjacency, roadAdjacency: roadAdjacency,
      residentRoutes: residentRoutes,
      blockers: blockers, groundY: groundY };

    // How far the island reaches from its middle, and how deep its rock hangs.
    var spread = 0;
    ids.forEach(function (id) { spread = Math.max(spread, cellDistance(centres[id])); });
    var hang = 0;
    ids.forEach(function (id) {
      hang = Math.max(hang, rockDepthAt(cellDistance(centres[id]), spread, Number(id)));
    });
    // Aim a little below the land so the rock hanging underneath is framed too.
    state.islandFocus = new THREE.Vector3(0, -hang * 0.3, 0);
    var maxScreenX = 0, maxScreenZ = 0;
    ids.forEach(function (id) {
      var x = centres[id].x, z = centres[id].z;
      maxScreenX = Math.max(maxScreenX, Math.abs(Math.cos(angle) * x + Math.sin(angle) * z));
      maxScreenZ = Math.max(maxScreenZ, Math.abs(-Math.sin(angle) * x + Math.cos(angle) * z));
    });
    var halfFov = state.camera.fov * Math.PI / 360;
    var padding = FLAT_SPACING * 1.5;
    // Seen at a tilt the island's depth foreshortens, but its near edge comes at you, so
    // only part of the cosine is given back — and the rock underneath adds height.
    var depth = maxScreenZ * (0.45 + 0.55 * Math.cos(FLAT_VIEW_PHI)) + hang * Math.sin(FLAT_VIEW_PHI) * 0.5;
    state.flatFitDistance = Math.max(8,
      (maxScreenX + padding) / (Math.tan(halfFov) * state.camera.aspect * 0.88),
      (depth + padding) / (Math.tan(halfFov) * 0.78));

    // A building from another pack, standing on the grass tile that was just laid for it. It
    // carries no hexagon base of its own, so it is built without one (`false`) and lifted to
    // that tile's top, the same way a path is.
    function placeForeignOnIsland(foreign, key, id, x, z, groundKey, blockers) {
      return loadParts(packPath(foreign.pack) + key).then(function (parts) {
        if (!parts) return;
        var obj = buildFromParts(parts, false);
        obj.scale.setScalar(FLAT_MODEL_SCALE * foreign.scale);
        obj.rotation.y = Math.PI / 3;
        var lift = tileTopOf(groundKey) * FLAT_MODEL_SCALE;
        obj.position.set(x, FLAT_BASE_Y + lift, z);
        obj.userData.restY = FLAT_BASE_Y + lift;
        obj.userData.tag = { type: 'flat', slot: Number(id), land: true };
        state.flatGroup.add(obj);
        if (parts.some(function (part) { return part.spin; })) state.spinners.push(obj);
        // This model starts at the tile's top rather than its bottom, and is drawn at its own
        // scale, so head height converts into its units; footprintBox reads the parts' own
        // positions, which buildFromParts has since settled onto y=0 by baseDrop. islandBlocker
        // then scales the box by FLAT_MODEL_SCALE, so fold this model's own scale in first.
        var box = footprintBox(parts, PLAYER_HEAD / foreign.scale + obj.userData.baseDrop);
        if (box) {
          ['cx', 'cz', 'hx', 'hz'].forEach(function (k) { box[k] *= foreign.scale; });
          blockers.push(islandBlocker(x, z, obj.rotation.y, box));
        }
      });
    }

    var extent = 0;
    var jobs = [];
    ids.forEach(function (id) {
      var x = centres[id].x, z = centres[id].z;
      extent = Math.max(extent, Math.sqrt(x * x + z * z));
      var road = roads[id];
      // A hexagon-kit building is modelled WITH the hexagon of ground it stands on, so one
      // model is the whole tile. A building from another pack is only the building, so its
      // tile is plain grass and the model is set on top — otherwise it stands over a hole.
      var foreign = FOREIGN_BUILDINGS[assetBySlot[id]];
      var groundKey = foreign ? 'grass.glb' : assetBySlot[id];
      jobs.push(loadParts(HEX_PACK + groundKey).then(function (parts) {
        if (!parts) return;
        var obj = buildFromParts(parts);
        obj.scale.setScalar(FLAT_MODEL_SCALE);
        obj.rotation.y = Math.PI / 3;
        obj.position.set(x, FLAT_BASE_Y, z);
        if (buildingSlots.has(Number(id)) && !foreign) {
          var box = footprintBox(parts, tileTopOf(groundKey) + PLAYER_HEAD);
          if (box) blockers.push(islandBlocker(x, z, obj.rotation.y, box));
        }
        obj.userData.restY = FLAT_BASE_Y;
        obj.userData.tag = { type: 'flat', slot: Number(id), land: true };
        state.flatGroup.add(obj);
        if (parts.some(function (part) { return part.spin; })) state.spinners.push(obj);

        var after = [];
        if (foreign) after.push(placeForeignOnIsland(foreign, assetBySlot[id], id, x, z, groundKey, blockers));

        // The kit's path pieces are thin road overlays, not tiles — they lay ON the terrain.
        if (!road) return after.length ? Promise.all(after) : undefined;
        after.push(loadParts(HEX_PACK + road.file).then(function (roadParts) {
          if (!roadParts) return;
          var strip = buildFromParts(roadParts);
          strip.scale.setScalar(FLAT_MODEL_SCALE);
          strip.rotation.y = road.rotation; // exact: the connector lookup chose this angle
          var lift = roadLiftFor(groundKey);
          strip.position.set(x, FLAT_BASE_Y + lift, z);
          strip.userData.restY = FLAT_BASE_Y + lift;
          strip.userData.tag = { type: 'flat', slot: Number(id), land: true };
          state.flatGroup.add(strip);
        }));
        return Promise.all(after);
      }));
    });

    // Walkers (src/world/walkers.js) aren't stored data, so nothing above re-adds them —
    // this group got wiped at the top of this function like everything else.
    if (state.petWalkers) state.flatGroup.add(state.petWalkers.flat.group);
    Object.keys(state.residentWalkers).forEach(function (id) {
      state.flatGroup.add(state.residentWalkers[id].flat.group);
    });
    if (state.players && state.players.flat.group) {
      state.flatGroup.add(state.players.flat.group);
      // The island was just rebuilt from scratch, so wherever the character was standing
      // may no longer exist. updatePlayer re-places it on the next frame.
      state.players.flat.placed = false;
    }

    state.flatGroup.add(buildIslandUnderside(ids, centres, spread));

    return Promise.all(jobs).then(function () {
      state.flatRadius = extent + FLAT_SPACING;
      state.flatGroup.add(buildIslandShadow(state.flatRadius * 2.6, ROCK_TOP_Y - hang - 2.5));
      dressHubIsland();
    });
  }

  // Rebuild the layout in place. Passing the slot that just appeared animates only that
  // tile, so writing an entry from flat mode doesn't replay the whole island rising.
  function refreshFlatView(newSlot) {
    if (!state) return Promise.resolve();
    // Rebuilding mid-fold would pull the pieces out from under the animation; catch up after.
    if (state.transition) {
      return state.transition.then(function () { return refreshFlatView(newSlot); });
    }
    if (!state.flatMode) return Promise.resolve();
    return buildFlatView().then(function () {
      applyHighlight(); // the group was rebuilt, so the halo went with it
      if (newSlot === undefined || newSlot === null) { animateFlatEntry(); return; }
      state.flatGroup.children.forEach(function (obj) {
        if (!obj.userData.tag || obj.userData.tag.slot !== newSlot) return;
        riseTile(obj);
        // Same piece-by-piece build as the planet, so writing an entry feels identical
        // in either view.
        if (obj.userData.tag.land) assembleBuilding(obj);
      });
    });
  }

  function riseTile(obj) {
    var rest = obj.userData.restY || 0;
    animate(650, function (t) {
      if (state.transition) return true;
      obj.position.y = rest - 1.8 * (1 - easeOutBack(t));
    });
  }

  // The floating island's underside: a hexagonal column under every tile, deepest in the
  // middle and shallow at the rim, so the island tapers to a blunt point. A thin band of
  // earth under the grass, and below it the sea, carrying the planet's own water shader.
  var ROCK_TOP_Y = FLAT_BASE_Y + 0.02; // tucked just under the kit tiles' base plates
  var ROCK_DIRT = 0.38;                // thickness of the earth band under the grass

  // Depth of the rock under a tile, by how far that tile is from the middle of the island
  // (in tile widths). A rounded falloff: thin lip at the rim, thick through the middle, so
  // the underside reads as one tapering chunk rather than a slab with a peg under it.
  function rockDepthAt(distance, radius, seed) {
    var edge = radius + 0.8;
    var t = Math.max(0, 1 - (distance / edge) * (distance / edge));
    return 0.5 + (1 + radius * 1.6) * Math.pow(t, 1.1) + 0.25 * hash(seed + 7);
  }

  // Distance from the middle of the island, in tile widths.
  function cellDistance(centre) {
    return Math.sqrt(centre.x * centre.x + centre.z * centre.z) / FLAT_SPACING;
  }

  function buildIslandUnderside(ids, centres, radius) {
    var dirt = new THREE.Color(currentTheme.landSide);
    var water = WATER_COLOR, deep = WATER_SIDE_COLOR;
    var positions = [], colors = [], uvs = [], land = [];
    // aLand 1 keeps the vertex colour (the earth band); 0 hands the face to the procedural
    // ocean shader, the same one the planet's sea uses.
    function vert(p, c, isLand) {
      positions.push(p[0], p[1], p[2]);
      colors.push(c.r, c.g, c.b);
      uvs.push(isLand ? 0.75 : 0.25, 0.5);
      land.push(isLand);
    }
    // a, b along the top edge; c under b, d under a. Wound to face outward.
    function wall(a, b, c, d, top, bottom, isLand) {
      vert(a, top, isLand); vert(b, top, isLand); vert(c, bottom, isLand);
      vert(a, top, isLand); vert(c, bottom, isLand); vert(d, bottom, isLand);
    }

    ids.forEach(function (id) {
      var x = centres[id].x, z = centres[id].z;
      var depth = rockDepthAt(cellDistance(centres[id]), radius, Number(id));
      var dirtHere = dirt.clone().multiplyScalar(0.96 + 0.08 * hash(Number(id) * 17 + 5));
      var yDirt = ROCK_TOP_Y - Math.min(ROCK_DIRT, depth * 0.5);
      var yBottom = ROCK_TOP_Y - depth;
      var rim = [];
      for (var k = 0; k < 6; k++) {
        // Corners at 90 + k*60 degrees, matching the kit's hexagon.
        var a = Math.PI / 2 + k * Math.PI / 3;
        rim.push([x + Math.cos(a) * FLAT_TILE_RADIUS, z + Math.sin(a) * FLAT_TILE_RADIUS]);
      }
      for (k = 0; k < 6; k++) {
        var p = rim[k], q = rim[(k + 1) % 6];
        wall([p[0], ROCK_TOP_Y, p[1]], [q[0], ROCK_TOP_Y, q[1]],
          [q[0], yDirt, q[1]], [p[0], yDirt, p[1]], dirtHere, dirtHere, 1);
        wall([p[0], yDirt, p[1]], [q[0], yDirt, q[1]],
          [q[0], yBottom, q[1]], [p[0], yBottom, p[1]], water, deep, 0);
        // Underside, facing down.
        vert([x, yBottom, z], deep, 0);
        vert([p[0], yBottom, p[1]], deep, 0);
        vert([q[0], yBottom, q[1]], deep, 0);
      }
    });

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aLand', new THREE.Float32BufferAttribute(land, 1));
    geometry.computeVertexNormals();

    var material = new THREE.MeshStandardMaterial({
      map: makeSurfaceTexture(), vertexColors: true, flatShading: true, roughness: 0.85,
      // Neighbouring columns share walls, which only ever meet inside the block; DoubleSide
      // keeps any face the eye does reach lit from the right side.
      side: THREE.DoubleSide
    });
    installWaterShader(material);
    // These tiles are the sandbox's size, where its own pattern scale of 1.0 is right.
    material.userData.waterUniforms.uWaterScale.value = 1.0;
    state.islandWaterMaterial = material;

    var mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.isBackdrop = true; // not a tile: the entry animation leaves it be
    mesh.userData.isUnderside = true;
    return mesh;
  }

  // --- Sky ------------------------------------------------------------------------------
  // The island hangs in open sky, so the island view gets a real one: a big painted dome,
  // wider than the starfield so starlight keeps its stars in front of it.
  var SKY_RADIUS = 300;

  function makeSkyTexture(theme) {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createLinearGradient(0, 0, 0, 256); // canvas top = dome top
    gradient.addColorStop(0, '#' + theme.skyTop.toString(16).padStart(6, '0'));
    gradient.addColorStop(1, '#' + theme.skyBottom.toString(16).padStart(6, '0'));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 256);

    if (theme.clouds) {
      var seed = 11;
      function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
      // Soft puffs, each a few overlapping blobs, low in the sky where they read as distant.
      for (var c = 0; c < 30; c++) {
        var cx = random() * 512;
        var cy = 84 + random() * 150;
        var scale = 18 + random() * 34;
        var alpha = 0.3 + random() * 0.45;
        for (var b = 0; b < 5; b++) {
          var bx = cx + (random() - 0.5) * scale * 2.2;
          var by = cy + (random() - 0.5) * scale * 0.5;
          var r = scale * (0.45 + random() * 0.55);
          var puff = ctx.createRadialGradient(bx, by, 0, bx, by, r);
          puff.addColorStop(0, 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')');
          puff.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = puff;
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    var texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeSky() {
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 24, 16),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, transparent: true, opacity: 0 })
    );
    mesh.visible = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  function refreshSky() {
    if (!state.sky) return;
    if (!state.skyCache[state.themeId]) state.skyCache[state.themeId] = makeSkyTexture(currentTheme);
    state.sky.material.map = state.skyCache[state.themeId];
    state.sky.material.needsUpdate = true;
  }

  // Tiles rise into place from the middle outward, so entering the island view reads as
  // the island assembling itself rather than a hard cut.
  function animateFlatEntry() {
    var risers = state.flatGroup.children.filter(function (obj) {
      return !obj.userData.isBackdrop;
    });
    if (!risers.length) return;

    var RISE = 0.5, DROP = 1.8;
    var longest = 0;
    risers.forEach(function (obj) {
      var d = Math.sqrt(obj.position.x * obj.position.x + obj.position.z * obj.position.z);
      obj.userData.riseDelay = (d / FLAT_SPACING) * 0.13; // stagger by rings, not raw units
      longest = Math.max(longest, obj.userData.riseDelay);
      obj.visible = false;
    });

    var totalMs = (longest + RISE) * 1000;
    animate(totalMs, function (t) {
      if (state.transition) return true;
      var elapsed = t * (totalMs / 1000);
      risers.forEach(function (obj) {
        var p = (elapsed - obj.userData.riseDelay) / RISE;
        if (p < 0) return;
        obj.visible = true;
        var rest = obj.userData.restY || 0;
        obj.position.y = rest - DROP * (1 - easeOutBack(Math.min(p, 1)));
      });
    });
  }

  // A soft blob of shade far below the floating island, so it reads as hanging in the air.
  function buildIslandShadow(size, y) {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(30, 65, 68, 0.20)');
    gradient.addColorStop(1, 'rgba(30, 65, 68, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.userData.isBackdrop = true; // not part of the rise-in animation
    mesh.userData.isShadow = true;
    return mesh;
  }

  // --- Tile highlight -------------------------------------------------------------------
  // Marks one tile as the one you are pointing at or reading about. Two views, two
  // mechanisms: on the planet a tile is part of the merged mesh, so it is lit by writing its
  // own vertex colours; on the island a tile is its own object, but its material is shared
  // with every other tile built from the same GLB, so it gets a halo child instead.

  var HIGHLIGHT_COLOR = new THREE.Color(0xfff3c4); // warm, so it reads as lit rather than washed out
  var HIGHLIGHT_PULSE_MS = 1100;
  var HIGHLIGHT_LIFT = 0.16;        // how far the strength swings while pulsing
  var HIGHLIGHT_TILE_LIFT = 0.22;   // island only: how far the marked tile stands proud
  var highlight = { slot: null, strength: 0.45, halo: null, lifted: null, running: false };

  // Whiten the tile's own colour rather than using a fixed tint, so the highlight reads the
  // same on grass, sand and stone, and under any theme.
  function paintHighlight(mix) {
    if (highlight.slot === null || !state || !state.tileVertexRange[highlight.slot]) return;
    // clone: landTopColor can hand back the shared LAND_COLOR constant.
    var hi = isHubBuildingSlot(highlight.slot) ? HUB_GLOW : HIGHLIGHT_COLOR;
    var top = landTopColor(highlight.slot).clone().lerp(hi, mix);
    var side = landSideColor(highlight.slot).clone().lerp(hi, mix * 0.5);
    writeTileColors(highlight.slot, top, side);
  }

  function repaintHighlightedTile() {
    if (highlight.slot === null || !state || !state.tileVertexRange[highlight.slot]) return;
    if (state.waterTileIds.has(highlight.slot)) {
      writeTileColors(highlight.slot, WATER_COLOR, WATER_SIDE_COLOR);
    } else {
      writeTileColors(highlight.slot, landTopColor(highlight.slot), landSideColor(highlight.slot));
    }
  }

  // A ring around the tile's rim, added to the tile's own group so it inherits every move
  // the fold makes. A glow laid on the ground would be hidden under trees and buildings;
  // the rim is always in the open.
  var HALO_INNER = 0.40;   // the kit hexagon's circumradius is 1/sqrt(3) ~ 0.577
  var HALO_OUTER = 0.62;
  var HALO_Y = 0.206;      // kit tile tops sit at 0.2 in model space

  // A band around the tile's rim. A line would be a hairline at any distance — GPUs ignore
  // LineBasicMaterial's width — so this is real geometry: six quads between two hexagons.
  function makeHalo(options) {
    var opts = options || {};
    var inner = opts.inner != null ? opts.inner : HALO_INNER;
    var outer = opts.outer != null ? opts.outer : HALO_OUTER;
    var y = opts.y != null ? opts.y : HALO_Y;
    var color = opts.color != null ? opts.color : 0xffe9a3;
    var positions = [];
    for (var k = 0; k < 6; k++) {
      var a0 = KIT_VERTEX_ANGLE + k * Math.PI / 3;
      var a1 = KIT_VERTEX_ANGLE + (k + 1) * Math.PI / 3;
      var corners = [
        [Math.cos(a0) * inner, Math.sin(a0) * inner],
        [Math.cos(a1) * inner, Math.sin(a1) * inner],
        [Math.cos(a1) * outer, Math.sin(a1) * outer],
        [Math.cos(a0) * outer, Math.sin(a0) * outer]
      ];
      [0, 2, 1, 0, 3, 2].forEach(function (i) {
        positions.push(corners[i][0], y, corners[i][1]);
      });
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: color, transparent: true, depthWrite: false, side: THREE.DoubleSide
    }));
    mesh.renderOrder = 2;
    mesh.userData.isHighlight = !opts.hub;
    mesh.userData.isHubHalo = !!opts.hub;
    return mesh;
  }

  function setHaloOpacity(value) {
    if (highlight.halo) highlight.halo.material.opacity = Math.min(1, value);
  }

  function islandTileFor(slot) {
    var found = null;
    state.flatGroup.children.forEach(function (obj) {
      var tag = obj.userData.tag;
      if (!found && tag && tag.slot === slot && tag.land) found = obj;
    });
    return found;
  }

  function detachHalo() {
    if (highlight.lifted) {
      if (highlight.lifted.parent) {
        highlight.lifted.position.y = highlight.lifted.userData.restY || 0;
      }
      highlight.lifted = null;
    }
    if (!highlight.halo) return;
    if (highlight.halo.parent) highlight.halo.parent.remove(highlight.halo);
    highlight.halo.geometry.dispose();
    highlight.halo.material.dispose();
    highlight.halo = null;
  }

  // Put the mark where it belongs for the view we are in. Called on every highlight and
  // again after anything that rebuilds a view out from under it.
  function applyHighlight() {
    if (!state) return;
    detachHalo();
    if (highlight.slot === null) return;
    if (!state.flatMode) { paintHighlight(highlight.strength); return; }

    var tile = islandTileFor(highlight.slot);
    if (!tile) return;
    highlight.halo = makeHalo();
    setHaloOpacity(highlight.strength + 0.35);
    tile.add(highlight.halo);
    // Stand the tile proud of its neighbours. A rim alone is easy to miss among the trees;
    // the step of shadow along its edge is not.
    highlight.lifted = tile;
    tile.position.y = (tile.userData.restY || 0) + HIGHLIGHT_TILE_LIFT;
  }

  function hubPulse(now) {
    return 0.5 - 0.5 * Math.cos(((now % HUB_PULSE_MS) / HUB_PULSE_MS) * Math.PI * 2);
  }

  // The village hall shares its kit model with ordinary social buildings, so the TILE has to
  // be the thing that says "this one is the hub": a violet pad on the planet cell, and a
  // cloned (not shared) stain plus rim on the island hex plate.
  function detachHubHalo() {
    if (state) state.hubPad = [];
    if (!state || !state.hubHalo) return;
    if (state.hubHalo.parent) state.hubHalo.parent.remove(state.hubHalo);
    state.hubHalo.geometry.dispose();
    state.hubHalo.material.dispose();
    state.hubHalo = null;
  }

  function stainHubFoundation(root) {
    var tint = HUB_TILE_TOP.clone().convertSRGBToLinear();
    var glow = new THREE.Color(0x8a3dff);
    root.traverse(function (mesh) {
      if (!mesh.isMesh || !mesh.userData || !mesh.userData.base) return;
      if (!mesh.userData.hubStain) {
        var verts = mesh.geometry.userData && mesh.geometry.userData.grassVerts;
        mesh.geometry = mesh.geometry.clone();
        if (verts) {
          mesh.geometry.userData.grassVerts = verts;
          mesh.geometry.userData.grassRole = 'ground';
        }
        mesh.material = mesh.material.clone();
        mesh.material.emissive = glow;
        mesh.material.emissiveIntensity = 0.35;
        mesh.userData.hubStain = true;
      }
      var geo = mesh.geometry;
      if (geo.attributes.color && geo.userData.grassVerts) {
        geo.userData.grassVerts.forEach(function (v) {
          geo.attributes.color.setXYZ(v, tint.r, tint.g, tint.b);
        });
        geo.attributes.color.needsUpdate = true;
      }
      state.hubPad.push(mesh);
    });
  }

  function dressHubIsland() {
    detachHubHalo();
    if (!state || !state.flatGroup) return;
    var slot = hubSlot();
    if (slot === null) return;
    var tile = islandTileFor(slot);
    if (!tile) return;
    stainHubFoundation(tile);
    state.hubHalo = makeHalo({
      hub: true, color: HUB_HALO_COLOR,
      inner: 0.34, outer: 0.70, y: 0.203
    });
    state.hubHalo.material.opacity = 0.7;
    tile.add(state.hubHalo);
  }

  function updateHubMarker(now) {
    if (!state || (state.hub && state.hub.on)) return;
    var slot = hubSlot();
    if (slot === null) return;
    var pulse = hubPulse(now);
    if (state.planet && state.planet.visible && !state.flatMode
        && highlight.slot !== slot && !state.waterTileIds.has(slot)) {
      var top = HUB_TILE_TOP.clone().lerp(HUB_GLOW, 0.08 + 0.28 * pulse);
      var side = HUB_TILE_SIDE.clone().lerp(HUB_GLOW, 0.18 * pulse);
      writeTileColors(slot, top, side);
    }
    if (state.hubHalo && state.hubHalo.material) {
      state.hubHalo.material.opacity = 0.42 + 0.5 * pulse;
    }
    if (state.hubPad) {
      state.hubPad.forEach(function (mesh) {
        if (mesh.material) mesh.material.emissiveIntensity = 0.22 + 0.42 * pulse;
      });
    }
  }

  function startHighlightPulse() {
    if (highlight.running) return;
    highlight.running = true;
    animate(HIGHLIGHT_PULSE_MS, function () {
      if (highlight.slot === null) { highlight.running = false; return true; }
      // animate() only passes its own 0..1 progress, and this pulse outlives one run of it.
      var phase = (performance.now() % HIGHLIGHT_PULSE_MS) / HIGHLIGHT_PULSE_MS;
      var swing = highlight.strength + HIGHLIGHT_LIFT * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
      if (state.flatMode) setHaloOpacity(0.5 + swing * 0.7);
      else paintHighlight(swing);
      return false; // runs until the highlight is cleared
    });
  }

  // slot: the tile to mark, or null to clear. `soft` is the lighter hover mark; the full
  // strength is for the entry you are actually reading.
  function highlightSlot(slot, options) {
    if (!state) return;
    var next = slot === undefined ? null : slot;
    var strength = options && options.soft ? 0.42 : 0.72;
    if (highlight.slot === next && highlight.strength === strength) return;
    if (highlight.slot !== null && highlight.slot !== next) repaintHighlightedTile();
    highlight.slot = next;
    highlight.strength = strength;
    applyHighlight();
    if (next !== null) startHighlightPulse();
  }

  function clearHighlight() {
    if (!state || highlight.slot === null) return;
    repaintHighlightedTile();
    detachHalo();
    highlight.slot = null;
  }

  function highlightedSlot() {
    return highlight.slot;
  }

  // Planet <-> flat. Animated by default: the island's tiles lift off the sphere and settle
  // into the flat layout (or the reverse). `{ instant: true }` cuts straight there.
  var viewListeners = [];
  function onViewChange(cb) { viewListeners.push(cb); }
  function notifyView() { viewListeners.forEach(function (cb) { cb(); }); }

  function setFlatView(on, options) {
    if (!state) return Promise.resolve();
    if (state.hub && state.hub.on) {
      return leaveHub({ instant: true }).then(function () { return setFlatView(on, options); });
    }
    if (state.transition) return state.transition;
    var goingFlat = !!on;
    var animated = !(options && options.instant) && goingFlat !== !!state.flatMode;
    if (!animated) return Promise.resolve(setFlatViewInstant(goingFlat)).then(function (r) { notifyView(); return r; });

    var run = goingFlat ? unfoldToFlat() : foldToPlanet();
    state.transition = run.then(function () {
      state.transition = null;
      notifyView();
    }, function (err) {
      state.transition = null;
      notifyView();
      throw err;
    });
    notifyView(); // a fold has started: anything that only belongs to a settled view hides now
    return state.transition;
  }

  function isTransitioning() {
    return !!state && !!state.transition;
  }

  var TURN_MS = 700;
  var UNFOLD_MS = 1800;
  var FOLD_MS = 1800;
  var UP = new THREE.Vector3(0, 1, 0);

  // The flat view's warm off-white backdrop and softer key light (the blue planet lighting
  // makes the kit tiles read as murky). mix: 0 = planet, 1 = flat.
  // Both ends come from the active theme (refreshViewLight, called by setTheme); meadow's
  // values are the originals. A theme with its own dark sky (starlight) keeps its own
  // lights in the flat view too, just with a softer sun.
  var VIEW_LIGHT = null;
  function refreshViewLight() {
    var t = currentTheme;
    PLANET_BG.set(t.sky);
    FLAT_BG.set(t.flatSky);
    var planet = { bg: PLANET_BG, sky: new THREE.Color(t.hemi[0]), ground: new THREE.Color(t.hemi[1]),
      hemi: t.hemi[2], sun: new THREE.Color(t.sun[0]), sunI: t.sun[1], sunPos: new THREE.Vector3(8, 12, 6) };
    var flat = t.stars
      ? { bg: FLAT_BG, sky: planet.sky, ground: planet.ground, hemi: planet.hemi,
        sun: planet.sun, sunI: planet.sunI * 0.6, sunPos: new THREE.Vector3(-3, 8, 5) }
      : { bg: FLAT_BG, sky: new THREE.Color(0xffffff), ground: new THREE.Color(0xb3c0b6),
        hemi: 1.0, sun: new THREE.Color(0xfff3d9), sunI: 0.7, sunPos: new THREE.Vector3(-3, 8, 5) };
    VIEW_LIGHT = { planet: planet, flat: flat };
  }

  function applyViewLighting(mix) {
    var a = VIEW_LIGHT.planet, b = VIEW_LIGHT.flat;
    state.scene.background.copy(a.bg).lerp(b.bg, mix);
    state.hemiLight.color.copy(a.sky).lerp(b.sky, mix);
    state.hemiLight.groundColor.copy(a.ground).lerp(b.ground, mix);
    state.hemiLight.intensity = a.hemi + (b.hemi - a.hemi) * mix;
    state.sunLight.color.copy(a.sun).lerp(b.sun, mix);
    state.sunLight.intensity = a.sunI + (b.sunI - a.sunI) * mix;
    state.sunLight.position.copy(a.sunPos).lerp(b.sunPos, mix);
    if (state.sky) {
      state.sky.material.opacity = mix;
      state.sky.visible = mix > 0.01;
    }
    state.viewMix = mix;
  }

  function animateP(durationMs, step) {
    return new Promise(function (resolve) {
      animate(durationMs, function (t) {
        step(t);
        if (t >= 1) resolve();
      });
    });
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  // Zero velocity and acceleration at both ends, including the handoff to either view.
  function foldEase(t) {
    t = clamp01(t);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function planetScaleAt(u) {
    return Math.max(0.0001, 1 - foldEase(u / 0.65));
  }

  function shortAngle(from, to) {
    var d = to - from;
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  // Re-express the current camera as an orbit around a new target, without moving it.
  function orbitAround(target) {
    var offset = state.camera.position.clone().sub(target);
    var dist = offset.length();
    state.camTarget.copy(target);
    state.camDistance = dist;
    state.camPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / dist)));
    state.camTheta = Math.atan2(offset.x, offset.z);
  }

  function cameraShot() {
    return { target: state.camTarget.clone(), dist: state.camDistance,
      phi: state.camPhi, theta: state.camTheta };
  }

  function blendCamera(from, to, e) {
    state.camTarget.copy(from.target).lerp(to.target, e);
    state.camDistance = from.dist + (to.dist - from.dist) * e;
    state.camPhi = from.phi + (to.phi - from.phi) * e;
    state.camTheta = from.theta + shortAngle(from.theta, to.theta) * e;
    state.updateCamera();
  }

  // Orbit angles that look straight down at a direction from outside the planet.
  function shotFacing(dir, target, dist) {
    return {
      target: target, dist: dist,
      phi: Math.max(0.15, Math.min(Math.PI - 0.15, Math.acos(Math.max(-1, Math.min(1, dir.y))))),
      theta: Math.atan2(dir.x, dir.z)
    };
  }

  // Everything the planet <-> island animation needs: for every island piece, where it sits
  // on its own tile on the planet and where it rests on the island, both in island space.
  // u = 0: every piece on the planet, shrunk to the planet's tile size; u = 1: the island.
  // The planet's scale is read every frame, so a piece still waiting its turn rides the
  // surface of a planet that is shrinking (or growing back) underneath it.
  function makeFoldRig() {
    if (!state.island) return null;
    var world = MI.store.get();
    var cells = state.island.cells, centres = state.island.centres;
    var homeSlot = typeof world.home === 'number' && cells[world.home] ? world.home : Number(Object.keys(cells)[0]);
    var planetQuat = state.planet.quaternion.clone();
    var home = new THREE.Vector3().fromArray(state.tiles[homeSlot].dir).normalize().applyQuaternion(planetQuat);

    state.flatGroup.updateMatrixWorld(true);
    var toIsland = state.flatGroup.matrixWorld.clone().invert();
    var islandQuatInv = state.flatGroup.quaternion.clone().invert();
    var pieces = [], rocks = [], shades = [];
    var maxRing = 0;

    state.flatGroup.children.forEach(function (obj) {
      if (obj.userData.isUnderside) { rocks.push(obj); return; }
      if (obj.userData.isShadow) { shades.push(obj); return; }
      var tag = obj.userData.tag;
      if (!tag || !cells[tag.slot] || !state.tiles[tag.slot]) return;
      var tile = state.tiles[tag.slot];
      var ring = cells[tag.slot].ring;
      maxRing = Math.max(maxRing, ring);
      var restY = obj.userData.restY !== undefined ? obj.userData.restY : obj.position.y;
      var flatPos = obj.position.clone();
      flatPos.y = restY; // a tile still rising from a just-written entry is caught at rest
      obj.visible = true;
      var dir = new THREE.Vector3().fromArray(tile.dir).normalize().applyQuaternion(planetQuat);
      var tilt = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().applyQuaternion(islandQuatInv));
      pieces.push({
        obj: obj, ring: ring, dir: dir, tilt: tilt,
        // The piece's offset from its tile's centre, carried onto the tilted planet tile.
        offset: new THREE.Vector3(flatPos.x - centres[tag.slot].x, restY, flatPos.z - centres[tag.slot].z),
        // Planet tile width per island tile width, before the planet's own scale.
        shrink: (tileApothem(tile) * 2) / FLAT_SPACING,
        flatPos: flatPos, flatQuat: obj.quaternion.clone(), flatScale: obj.scale.clone(),
        capQuat: tilt.clone().multiply(obj.quaternion)
      });
    });

    // Home lifts first and the rim last, so the island gathers outward from the middle.
    function progressFor(ring, u) {
      var delay = 0.3 * (maxRing ? ring / maxRing : 0);
      return foldEase((u - delay) / 0.7);
    }

    var ARC = FLAT_SPACING * 1.1; // how high a tile loops on its way between the two
    var cap = new THREE.Vector3(), lift = new THREE.Vector3();

    function pose(u) {
      var planetScale = state.planet.scale.x;
      pieces.forEach(function (p) {
        var k = progressFor(p.ring, u);
        var s = p.shrink * planetScale;
        cap.copy(p.dir).multiplyScalar((RADIUS + LAND_LIFT) * planetScale).applyMatrix4(toIsland);
        lift.copy(p.offset).multiplyScalar(s).applyQuaternion(p.tilt);
        p.obj.position.copy(cap).add(lift).lerp(p.flatPos, k);
        p.obj.position.y += Math.sin(Math.PI * k) * ARC;
        p.obj.quaternion.copy(p.capQuat).slerp(p.flatQuat, k);
        p.obj.scale.copy(p.flatScale).multiplyScalar(s + (1 - s) * k);
      });
      // The rock grows down out of the island once its tiles have mostly landed.
      var grow = foldEase((u - 0.55) / 0.45);
      rocks.forEach(function (obj) {
        obj.visible = grow > 0.001;
        obj.scale.set(1, Math.max(0.001, grow), 1);
      });
      shades.forEach(function (obj) {
        obj.visible = grow > 0.001;
        obj.material.opacity = grow;
      });
    }

    function reset() {
      pose(1);
      rocks.forEach(function (obj) { obj.visible = true; obj.scale.set(1, 1, 1); });
      shades.forEach(function (obj) { obj.visible = true; obj.material.opacity = 1; });
    }

    return { pose: pose, reset: reset, home: home };
  }

  function setPlanetDressing(visible) {
    state.props.visible = visible;
    if (state.roadGroup) state.roadGroup.visible = visible;
  }

  // --- Figures through a fold --------------------------------------------------------------
  // Everything that stands on the world and is driven frame by frame: the pet, the residents
  // and your character, in both of their per-view instances.
  function eachFigure(fn) {
    if (!state) return;
    if (state.petWalkers) {
      fn(state.petWalkers.sphere.group, 'pet', 'sphere');
      fn(state.petWalkers.flat.group, 'pet', 'flat');
    }
    Object.keys(state.residentWalkers).forEach(function (id) {
      fn(state.residentWalkers[id].sphere.group, 'resident', 'sphere');
      fn(state.residentWalkers[id].flat.group, 'resident', 'flat');
    });
    if (state.players) {
      fn(state.players.sphere.group, 'player', 'sphere');
      fn(state.players.flat.group, 'player', 'flat');
    }
  }

  // updateWalkers/updatePlayer are skipped for the length of a fold (see startLoop), so every
  // figure holds whatever pose the view it is leaving left it in while the tiles fly past
  // underneath it -- which reads as a pet and a character hanging in mid-air. It is worse the
  // very first time the island is opened: a flat instance that has never been through
  // updateFlat is still at the model's own scale and sitting at the group's origin, so the pet
  // comes up the size of the island. Nothing here can be posed mid-fold either, since the
  // island it would stand on does not exist yet. So hide every figure for the fold and show it
  // again only once an update tick has put it back on the ground.
  //
  // Only the fold itself, not the camera turn that precedes it (turnToward): during the turn
  // the planet is still whole and its figures are standing in the right places, so hiding them
  // there would be a pet blinking out of a scene that is otherwise holding still.
  function hideFigures() {
    state.figuresHidden = true;
    eachFigure(function (group) { if (group) group.visible = false; });
  }

  function showFigures() {
    if (!state.figuresHidden) return;
    state.figuresHidden = false;
    eachFigure(function (group) { if (group) group.visible = true; });
  }

  // The flat kit and the sphere have different ground, roads and water geometry.
  // Blend their coverage before exchanging visibility, rather than replacing a whole
  // island in the last frame. Complementary pixel masks retain depth testing and avoid
  // transparent meshes showing their backs through one another. Shadows fade as well.
  function makeViewHandoff() {
    var coverage = { value: 1 };
    var records = [], materials = [], caches = [new Map(), new Map()];

    function fadeMaterial(original, inverse) {
      var cache = caches[inverse];
      if (cache.has(original)) return cache.get(original);
      var material = original.clone();
      var compile = original.onBeforeCompile;
      material.onBeforeCompile = function (shader, renderer) {
        // Preserve the procedural ocean shader and its live time uniforms.
        compile.call(original, shader, renderer);
        shader.uniforms.uFoldCoverage = coverage;
        shader.fragmentShader = 'uniform float uFoldCoverage;\n'
          + shader.fragmentShader.replace('#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\n'
            + 'float foldNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));\n'
            + 'if (foldNoise ' + (inverse ? '<' : '>=') + ' uFoldCoverage) discard;');
      };
      var key = original.customProgramCacheKey();
      material.customProgramCacheKey = function () { return key + ':fold-coverage:' + inverse; };
      cache.set(original, material);
      materials.push(material);
      return material;
    }

    function visit(root, inverse) {
      root.traverse(function (obj) {
        if (!obj.material || obj.userData.isShadow) return; // transparent: fades on its own
        var original = obj.material;
        records.push({ obj: obj, material: original, depth: obj.customDepthMaterial });
        obj.material = Array.isArray(original)
          ? original.map(function (m) { return fadeMaterial(m, inverse); })
          : fadeMaterial(original, inverse);
        if (obj.castShadow) {
          var depth = obj.customDepthMaterial;
          if (!depth) {
            var surface = Array.isArray(original) ? original[0] : original;
            depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking,
              map: surface.map, alphaMap: surface.alphaMap, alphaTest: surface.alphaTest });
            materials.push(depth);
          }
          obj.customDepthMaterial = fadeMaterial(depth, inverse);
        }
      });
    }

    visit(state.flatGroup, 0);
    visit(state.props, 1);
    if (state.roadGroup) visit(state.roadGroup, 1);
    setPlanetDressing(true);

    return {
      pose: function (u) { coverage.value = foldEase((u - 0.03) / 0.29); },
      restore: function () {
        records.forEach(function (r) {
          r.obj.material = r.material;
          r.obj.customDepthMaterial = r.depth;
        });
        materials.forEach(function (m) { m.dispose(); });
      }
    };
  }

  function turnToward(dir) {
    var from = cameraShot();
    var to = shotFacing(dir, from.target, from.dist);
    var turn = Math.abs(shortAngle(from.theta, to.theta)) + Math.abs(to.phi - from.phi);
    if (turn < 0.02) return Promise.resolve();
    return animateP(TURN_MS, function (t) { blendCamera(from, to, easeInOut(t)); });
  }

  // Planet -> flat: face the island, then peel it off the sphere and press it flat while
  // the rest of the planet shrinks away beneath it.
  function unfoldToFlat() {
    return buildFlatView().then(function () {
      var rig = makeFoldRig();
      if (!rig) return setFlatViewInstant(true);
      rig.reset(); // pieces start from their flat pose so the rig captured it cleanly

      return turnToward(rig.home).then(function () {
        var handoff = makeViewHandoff();
        handoff.pose(0);
        rig.pose(0);
        // Hidden before flatGroup is shown, not merely on the next frame: state.folding is
        // read by the loop, and this block runs from a promise callback that can land between
        // the loop's frame and the next one -- which would put an unplaced flat figure at the
        // model's own scale on screen for exactly one frame.
        state.folding = true; // the figures go away here, not back at turnToward
        hideFigures();
        state.flatGroup.visible = true;
        var from = cameraShot();
        var to = {
          target: state.islandFocus.clone(), dist: state.flatFitDistance || 8,
          phi: FLAT_VIEW_PHI, theta: 0
        };

        return animateP(UNFOLD_MS, function (t) {
          // Planet first: the rig reads its scale to keep waiting tiles on its surface.
          state.planet.scale.setScalar(planetScaleAt(t) * state.worldScale);
          rig.pose(t);
          handoff.pose(t);
          var e = foldEase(t);
          blendCamera(from, to, e);
          applyViewLighting(e);
        }).finally(function () { handoff.restore(); state.folding = false; });
      }).then(function () {
        state.planet.visible = false;
        state.planet.scale.setScalar(state.worldScale);
        setPlanetDressing(true);
        rig.reset();
        state.flatMode = true;
        applyHighlight(); // the mark changes mechanism between the two views
        applyViewLighting(1);
        orbitAround(state.islandFocus.clone());
        state.updateCamera();
      });
    });
  }

  // Flat -> planet: the same motion run backwards. The sea drains, the island curls back
  // into a cap and settles onto a planet that grows up underneath it.
  function foldToPlanet() {
    var rig = makeFoldRig();
    if (!rig) return setFlatViewInstant(false);
    rig.reset();

    var handoff = makeViewHandoff();
    handoff.pose(1);
    state.planet.scale.setScalar(0.0001);
    state.planet.visible = true;
    orbitAround(new THREE.Vector3());
    var from = cameraShot();
    var to = shotFacing(rig.home, new THREE.Vector3(), cameraRange().rest);
    state.folding = true;
    hideFigures();

    return animateP(FOLD_MS, function (t) {
      state.planet.scale.setScalar(planetScaleAt(1 - t) * state.worldScale);
      rig.pose(1 - t);
      handoff.pose(1 - t);
      var e = foldEase(t);
      blendCamera(from, to, e);
      applyViewLighting(1 - e);
    }).then(function () {
      state.flatGroup.visible = false;
      rig.reset();
      state.planet.scale.setScalar(state.worldScale);
      setPlanetDressing(true);
      state.flatMode = false;
      applyHighlight();
      applyViewLighting(0);
      orbitAround(new THREE.Vector3());
      state.updateCamera();
    }).finally(function () { handoff.restore(); state.folding = false; });
  }

  function setFlatViewInstant(on) {
    if (!state) return Promise.resolve();
    state.flatMode = !!on;
    applyHighlight();
    var done = on ? buildFlatView() : Promise.resolve();
    return done.then(function () {
      state.planet.visible = !on;
      state.flatGroup.visible = !!on;

      applyViewLighting(on ? 1 : 0);
      state.camTarget.copy(on ? state.islandFocus : new THREE.Vector3());

      if (on) {
        state.camDistance = state.flatFitDistance || 8;
        state.camPhi = FLAT_VIEW_PHI;
        state.camTheta = 0;
        animateFlatEntry();
      } else {
        state.camDistance = cameraRange().rest;
      }
      state.updateCamera();
    });
  }

  // Re-light for the current theme and view — the theme feeds VIEW_LIGHT, and the same
  // blend the fold animates through snaps to whichever view is showing.
  function applyLighting() {
    refreshViewLight();
    if (state.galaxy && state.galaxy.on) {
      applyGalaxyLighting(state.galaxy.mix);
      return;
    }
    applyViewLighting(state.flatMode ? 1 : 0);
    if (state.stars) state.stars.visible = !!currentTheme.stars;
  }

  function isFlatView() {
    return !!state && !!state.flatMode;
  }

  function clear() {
    if (!state) return;
    clearHighlight();
    clearProps();
    state.tiles.forEach(function (tile) {
      if (!state.waterTileIds.has(tile.id) && tile.sides === 6) setTileWater(tile.id);
    });
  }

  // --- Tile state ---------------------------------------------------------------------

  function setTileLand(tileId, topColor) {
    var tile = state.tiles[tileId];
    if (!tile || tile.sides === 5 || !state.waterTileIds.has(tileId)) return;
    var range = state.tileVertexRange[tileId];
    var colorAttr = state.geometry.attributes.color;
    var uvAttr = state.geometry.attributes.uv;
    var posAttr = state.geometry.attributes.position;
    var landAttr = state.geometry.attributes.aLand;
    for (var i = 0; i < range[1]; i++) {
      var vi = (range[0] + i) * 3;
      // Terrain colour on top, dirt down the sides — a Minecraft block.
      var tint = i < range[2] ? (topColor || landTopColor(tileId)) : landSideColor(tileId);
      colorAttr.array[vi] = tint.r;
      colorAttr.array[vi + 1] = tint.g;
      colorAttr.array[vi + 2] = tint.b;
      if (i < range[2]) {
        uvAttr.array[(range[0] + i) * 2] += 0.5; // switch atlas half in place
      }
      landAttr.array[range[0] + i] = 1;          // stop the procedural water shader here

      // Raise the surface out of the sea, leaving the wall's bottom ring where it is so
      // the exposed dirt band grows rather than the whole block sliding outward.
      var bx = state.basePositions[vi];
      var by = state.basePositions[vi + 1];
      var bz = state.basePositions[vi + 2];
      var len = Math.sqrt(bx * bx + by * by + bz * bz);
      var grow = len > RADIUS - TILE_DEPTH * 0.5 ? (len + LAND_LIFT) / len : 1;
      state.restPositions[vi] = bx * grow;
      state.restPositions[vi + 1] = by * grow;
      state.restPositions[vi + 2] = bz * grow;
      // Settle there now, in case this tile was mid-wave when it was claimed.
      posAttr.array[vi] = state.restPositions[vi];
      posAttr.array[vi + 1] = state.restPositions[vi + 1];
      posAttr.array[vi + 2] = state.restPositions[vi + 2];
    }
    colorAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    posAttr.needsUpdate = true;
    landAttr.needsUpdate = true;
    state.waterTileIds.delete(tileId);
  }

  function setTileWater(tileId) {
    var range = state.tileVertexRange[tileId];
    if (!range || state.waterTileIds.has(tileId)) return;
    delete state.landAsset[tileId];
    var colorAttr = state.geometry.attributes.color;
    var uvAttr = state.geometry.attributes.uv;
    var landAttr = state.geometry.attributes.aLand;
    for (var i = 0; i < range[1]; i++) {
      var vi = (range[0] + i) * 3;
      var isTop = i < range[2];
      var tint = isTop ? WATER_COLOR : WATER_SIDE_COLOR;
      colorAttr.array[vi] = tint.r;
      colorAttr.array[vi + 1] = tint.g;
      colorAttr.array[vi + 2] = tint.b;
      if (isTop) uvAttr.array[(range[0] + i) * 2] -= 0.5;
      landAttr.array[range[0] + i] = isTop ? 0 : 1; // sides never run the water shader
      // Sink back down to sea level.
      state.restPositions[vi] = state.basePositions[vi];
      state.restPositions[vi + 1] = state.basePositions[vi + 1];
      state.restPositions[vi + 2] = state.basePositions[vi + 2];
    }
    colorAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    landAttr.needsUpdate = true;
    state.waterTileIds.add(tileId);
  }

  // Land rises out of the sea: starts sunk below the surface, springs up past flat, settles.
  function popTile(tileId) {
    var tile = state.tiles[tileId];
    var range = state.tileVertexRange[tileId];
    if (!tile || !range) return;
    var sink = state.spacing * 0.9;
    var posAttr = state.geometry.attributes.position;
    animate(520, function (t) {
      var offset = -sink * (1 - easeOutBack(t));
      for (var i = 0; i < range[1]; i++) {
        var vi = (range[0] + i) * 3;
        posAttr.array[vi] = state.restPositions[vi] + tile.dir[0] * offset;
        posAttr.array[vi + 1] = state.restPositions[vi + 1] + tile.dir[1] * offset;
        posAttr.array[vi + 2] = state.restPositions[vi + 2] + tile.dir[2] * offset;
      }
      posAttr.needsUpdate = true;
    });
  }

  function popIn(obj) {
    var target = obj.scale.x;
    animate(480, function (t) {
      if (state.transition) t = 1;
      obj.scale.setScalar(target * easeOutBack(t));
      return t >= 1;
    });
  }

  // --- Props (buildings, characters) ---------------------------------------------------

  // One GLTFLoader per pack, per CLAUDE.md: every Kenney pack ships its own `colormap.png`,
  // so a single manager rewriting that name to the hexagon kit's atlas would paint a pirate
  // tower in hexagon-kit colours. A pack's directory is simply the url up to the file name —
  // each one keeps its `Textures/` folder beside its GLBs, which is what makes this work.
  function loaderFor(dir) {
    if (!state.loaders[dir]) {
      var manager = new THREE.LoadingManager();
      manager.setURLModifier(function (url) {
        return url.indexOf('colormap.png') !== -1 ? dir + 'Textures/variation-a.png' : url;
      });
      state.loaders[dir] = new THREE.GLTFLoader(manager);
    }
    return state.loaders[dir];
  }

  function loadGLB(url) {
    if (!state.glbCache[url]) {
      var dir = url.slice(0, url.lastIndexOf('/') + 1);
      state.glbCache[url] = new Promise(function (resolve) {
        loaderFor(dir).load(url, resolve, undefined, function () { resolve(null); });
      });
    }
    return state.glbCache[url];
  }

  // The kit packs each building into a single mesh. Recover connected, same-palette pieces
  // once at load time (union-find over shared vertices) so they can be assembled piece by
  // piece instead of popping in whole. Ported from tools/water-tile.js.
  // Foundation first; roof, walls, props and rotor follow.
  function splitIntoParts(gltf) {
    var parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(function (node) {
      if (!node.isMesh) return;
      var source = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      source.applyMatrix4(node.matrixWorld);
      var pos = source.attributes.position, uv = source.attributes.uv, normal = source.attributes.normal;
      if (!pos || !uv || !normal) { source.dispose(); return; }

      var triangleCount = pos.count / 3, parents = [], vertices = new Map(), groups = new Map();
      for (var t = 0; t < triangleCount; t++) parents[t] = t;
      function root(n) { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; }
      for (var v = 0; v < pos.count; v++) {
        var key = [pos.getX(v), pos.getY(v), pos.getZ(v), uv.getX(v), uv.getY(v)]
          .map(function (n) { return Math.round(n * 100000); }).join('/');
        var tri = Math.floor(v / 3);
        if (vertices.has(key)) parents[root(tri)] = root(vertices.get(key));
        else vertices.set(key, tri);
      }
      var spin = node.name === 'rotate-x'; // windmill rotors etc.
      for (var j = 0; j < triangleCount; j++) {
        var isBase = Math.max(pos.getY(j * 3), pos.getY(j * 3 + 1), pos.getY(j * 3 + 2)) <= 0.201;
        var groupKey = spin ? 'rotor' : isBase ? 'foundation' : root(j);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(j);
      }

      var kitMaterial = node.material.clone();
      kitMaterial.vertexColors = true;
      kitMaterial.roughness = 0.9;
      // Keep the shipped atlas so every theme recolours from the original, not from the
      // previous theme's output.
      kitMaterial.userData.baseMap = kitMaterial.map;
      if (kitMaterial.map) kitMaterial.map = themedAtlas(kitMaterial.map);
      state.kitMaterials.push(kitMaterial);
      // The kit's ground grass and its tree leaves share one atlas column; the ground sits on
      // the tile's base plate (the 'foundation' part), leaves are separate parts above it —
      // so a theme can have pink trees on green grass.
      var foliageColor = new THREE.Color(currentTheme.foliage).convertSRGBToLinear();
      var groundColor = new THREE.Color(currentTheme.ground).convertSRGBToLinear();

      groups.forEach(function (triangles, key) {
        var p = [], n = [], u = [], colors = [], grassVerts = [];
        var grassRole = key === 'foundation' ? 'ground' : 'foliage';
        var grass = grassRole === 'ground' ? groundColor : foliageColor;
        var partMinY = Infinity; // lowest point in the model's own space, before re-centring
        triangles.forEach(function (tri) {
          for (var k = tri * 3; k < tri * 3 + 3; k++) {
            partMinY = Math.min(partMinY, pos.getY(k));
            p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
            n.push(normal.getX(k), normal.getY(k), normal.getZ(k));
            u.push(uv.getX(k), uv.getY(k));
            // variation-a makes this vegetation column white. Tint its grass and foliage
            // shades back (in the theme's foliage colour), leaving the building's own
            // colours alone.
            var isGrass = Math.abs(uv.getX(k) - 0.34375) < 0.002;
            if (isGrass) grassVerts.push(colors.length / 3);
            colors.push(isGrass ? grass.r : 1, isGrass ? grass.g : 1, isGrass ? grass.b : 1);
          }
        });
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        if (grassVerts.length) {
          g.userData.grassVerts = grassVerts;
          g.userData.grassRole = grassRole;
          state.foliageGeometries.push(g);
        }
        g.computeBoundingBox();
        var home = spin ? node.getWorldPosition(new THREE.Vector3())
          : g.boundingBox.getCenter(new THREE.Vector3());
        g.translate(-home.x, -home.y, -home.z);
        parts.push({
          geometry: g, material: kitMaterial, home: home,
          base: key === 'foundation', spin: spin, minY: partMinY
        });
      });
      source.dispose();
    });
    parts.sort(function (a, b) {
      return (a.base ? -10 : a.spin ? 10 : a.home.y) - (b.base ? -10 : b.spin ? 10 : b.home.y);
    });
    return parts;
  }

  // includeBase: the flat view lays kit tiles on a regular grid where their hex bases fit
  // exactly, so it keeps them. The sphere drops them — the grid cell underneath is already
  // textured land, and a rigid hex base can't match a curved, slightly irregular cell.
  function buildFromParts(parts, includeBase) {
    var group = new THREE.Group();
    var kept = parts.filter(function (part) {
      return includeBase !== false || !part.base;
    });

    // Dropping the hex base leaves the building starting at the base plate's top face, so
    // it would hover by exactly that plate's thickness. Settle whatever remains onto y=0.
    var drop = 0;
    if (includeBase === false) {
      var lowest = Infinity;
      kept.forEach(function (part) { lowest = Math.min(lowest, part.minY); });
      if (isFinite(lowest)) drop = lowest;
    }
    group.userData.baseDrop = drop;

    kept.forEach(function (part, i) {
      var mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Baked into home as well as position, so the assembly animation settles here too.
      var home = part.home.clone();
      home.y -= drop;
      mesh.position.copy(home);
      mesh.userData = {
        home: home,
        base: part.base,
        spin: part.spin,
        delay: part.base ? 0 : 0.42 + (i / kept.length) * 1.25
      };
      group.add(mesh);
    });
    return group;
  }

  // Pieces fall in and settle, foundation first. Mirrors the sandbox's timing.
  function assembleBuilding(group) {
    // Only the pieces buildFromParts prepared have a `home` to settle into. A tile group can
    // be carrying other children too — on the island the open memory's highlight halo is
    // parented to its tile — and those must be left alone, not hidden and not animated.
    var pieces = group.children.filter(function (piece) {
      return piece.userData && piece.userData.home !== undefined;
    });
    pieces.forEach(function (piece) { piece.visible = false; });
    var elapsed = 0;
    // Must outlast the last piece: max delay (0.42 + 1.25) + its 0.65s fall = 2.32s.
    var DURATION = 2400;
    animate(DURATION, function (t) {
      if (state.transition) t = 1;
      elapsed = t * (DURATION / 1000);
      pieces.forEach(function (piece, i) {
        var data = piece.userData;
        var progress = (elapsed - data.delay) / 0.65;
        if (progress < 0) return;
        piece.visible = true;
        var p = Math.min(progress, 1);
        piece.position.copy(data.home);
        if (data.base) {
          piece.position.y -= Math.pow(1 - p, 3) * 0.5; // ease the foundation up out of the sea
        } else {
          var fall = Math.min(p / 0.72, 1), bounce = Math.max(0, (p - 0.72) / 0.28);
          piece.position.y += (1 - fall * fall) * 1.35 + Math.sin(bounce * Math.PI) * 0.045;
          piece.position.x += Math.cos(i * 2.4) * 0.13 * (1 - fall);
          piece.position.z += Math.sin(i * 2.4) * 0.13 * (1 - fall);
          piece.rotation.z = (1 - fall) * 0.12 * Math.sin(i * 1.7);
        }
      });
      return t >= 1;
    });
  }

  function spinRotors(group, dt) {
    group.children.forEach(function (piece) {
      if (piece.userData && piece.userData.spin) piece.rotation.x += dt * 0.75;
    });
  }

  // Mean centre-to-edge distance of a cell, in world units. Cells vary by ~1.5x across the
  // planet, so props are scaled per tile rather than by one global figure.
  function tileApothem(tile) {
    var total = 0;
    for (var k = 0; k < tile.sides; k++) {
      var a = tile.corners[k], b = tile.corners[(k + 1) % tile.sides];
      var mx = (a[0] + b[0]) / 2 - tile.dir[0];
      var my = (a[1] + b[1]) / 2 - tile.dir[1];
      var mz = (a[2] + b[2]) / 2 - tile.dir[2];
      total += Math.sqrt(mx * mx + my * my + mz * mz) * RADIUS;
    }
    return total / tile.sides;
  }

  // Scale that makes the kit's 1.0-unit-wide tile match this cell's actual width.
  function tileScale(tile) {
    return (tileApothem(tile) * 2) / KIT_TILE_WIDTH;
  }

  // The kit's hexagon has a vertex pointing along its local +Z (its Z extent equals the
  // circumradius 1/sqrt(3), its X extent the apothem 0.5), so vertices sit at 90 + k*60 deg.
  var KIT_VERTEX_ANGLE = Math.PI / 2;

  // Spin the prop about its own surface normal so it sits square with the cell it's on
  // rather than at an arbitrary angle.
  function alignToCell(obj, tile) {
    obj.updateMatrixWorld(true);
    var corner = new THREE.Vector3(tile.corners[0][0], tile.corners[0][1], tile.corners[0][2])
      .multiplyScalar(RADIUS);
    var local = obj.worldToLocal(corner);
    var theta = Math.atan2(local.z, local.x);
    obj.rotateY(KIT_VERTEX_ANGLE - theta);
    obj.updateMatrixWorld(true);
  }

  // A tile's top is drawn as a FLAT polygon whose corners all sit on the sphere, so it falls
  // away from the tangent plane at the tile's centre — by surfaceRadius * (1 - cos a) at the
  // rim, where a is the angle from the centre out to a corner. A prop stood on that tangent
  // plane therefore only touches the tile at one point and hovers everywhere else. It is
  // worst on the small planets, where one tile spans 20 degrees of the globe (a third of a
  // tile's own height) and invisible on the big ones, where it spans four.
  // Sinking the prop by that much seats its base in the plane of the tile's corner ring:
  // flush with the ground it is standing on, instead of floating over it.
  var SEAT_FRACTION = 1; // 1 = flush with the corner ring, 0 = the old tangent plane
  function seatDepth(tile, surfaceRadius) {
    if (!tile || !tile.corners || !tile.corners.length) return 0;
    var n = new THREE.Vector3().fromArray(tile.dir).normalize();
    var lowest = 1;
    for (var i = 0; i < tile.corners.length; i++) {
      var c = tile.corners[i];
      var cos = new THREE.Vector3(c[0], c[1], c[2]).normalize().dot(n);
      if (cos < lowest) lowest = cos;
    }
    return surfaceRadius * (1 - lowest) * SEAT_FRACTION;
  }

  function prepareProp(obj, placement, scale, rotY) {
    obj.traverse(function (node) {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    obj.scale.setScalar(scale);
    obj.userData.restScale = obj.scale.clone();
    var dir = MI.world.sphere.slotToDir(placement.slot);
    // Props stand on claimed tiles, which are raised out of the sea by LAND_LIFT.
    var surface = RADIUS + LAND_LIFT;
    var seat = seatDepth(MI.world.sphere.tile(placement.slot), surface);
    MI.world.sphere.orientToSurface(obj, dir, rotY || 0, surface - seat);
  }

  // Splitting a GLB into parts is the expensive bit, so it's cached per file and every
  // instance just re-wraps the shared geometries.
  function loadParts(url) {
    if (!state.partsCache[url]) {
      state.partsCache[url] = loadGLB(url).then(function (gltf) {
        return gltf ? splitIntoParts(gltf) : null;
      });
    }
    return state.partsCache[url];
  }

  function placeProp(url, placement, options) {
    return loadParts(url).then(function (parts) {
      if (!parts || !parts.length) return null;
      var obj = buildFromParts(parts, false); // no hex base — the cell itself is the ground
      var tile = MI.world.sphere.tile(placement.slot);
      // modelScale corrects a pack whose models aren't authored to the hexagon kit's tile.
      var scale = (tile ? tileScale(tile) : state.spacing) * (placement.scale || 1)
        * (options.modelScale || 1);
      prepareProp(obj, placement, scale, 0);
      if (tile) {
        alignToCell(obj, tile);
        // rotY is a multiple of 60 degrees, so this varies which way a building faces
        // without losing the corner alignment the hexagon's symmetry just gave us.
        if (options.rotY) obj.rotateY(options.rotY);
      }
      obj.userData.tag = options.tag;
      state.props.add(obj);
      if (parts.some(function (p) { return p.spin; })) state.spinners.push(obj);
      if (options.animate) assembleBuilding(obj);
      return obj;
    });
  }

  function personColor(index) {
    return PERSON_COLORS[index % PERSON_COLORS.length];
  }

  // --- Planet size (the growth ladder lives in src/world/growth.js) -------------------

  function loadGrid(frequency) {
    if (!state.gridCache[frequency]) {
      state.gridCache[frequency] = fetch(MI.growth.gridUrl(frequency)).then(function (res) {
        if (!res.ok) throw new Error('hex grid f=' + frequency + ': HTTP ' + res.status);
        return res.json();
      });
    }
    return state.gridCache[frequency];
  }

  // World-space camera distances for the current planet. The planet's share of the view grows
  // with its size — radius/distance goes from 0.13 on the 42-tile planet to 0.33 on the
  // 1002-tile one, which still fits the frame — so a small planet looks small next to a big
  // one instead of every size being zoomed to fill the screen.
  function cameraRange() {
    var r = RADIUS * state.worldScale;
    var rest = r / (0.13 + 0.05 * (r - 1));
    return { rest: rest, min: Math.max(r * 1.4, r + 0.9), max: Math.max(r * 6, rest * 2) };
  }

  // Everything standing on the planet or laid out flat — but not the tiles themselves.
  function clearProps() {
    detachHubHalo();
    while (state.props.children.length) state.props.remove(state.props.children[0]);
    while (state.flatGroup.children.length) state.flatGroup.remove(state.flatGroup.children[0]);
    if (state.roadGroup) {
      state.planet.remove(state.roadGroup);
      state.roadGroup = null;
    }
    state.spinners.length = 0;
    while (state.residentGroup.children.length) state.residentGroup.remove(state.residentGroup.children[0]);
    Object.keys(state.residentWalkers).forEach(function (id) { disposeWalkerPair(state.residentWalkers[id]); });
    state.residentWalkers = {};
    state.residentRoutesCache = null;
    state.residentStopsCache = null;
    state.roadEdgesCache = null;
    clearShips();
  }

  // Swap to the grid for `frequency`: a fresh all-water mesh, scaled so tiles keep their
  // world size (bigger planet = bigger ball). Clears everything standing on the old grid;
  // the caller replays the world, remapped onto the new slots (MI.app does both).
  // options.animate: the planet swells from its old size while the camera eases out.
  function setPlanet(frequency, options) {
    var opts = options || {};
    return loadGrid(frequency).then(function (grid) {
      var fromScale = state.worldScale;
      var fromDistance = state.camDistance;
      clearProps();
      state.frequency = frequency;
      state.worldScale = frequency / REFERENCE_FREQUENCY;
      state.unit = 1 / state.worldScale;
      TILE_DEPTH = BASE_TILE_DEPTH * state.unit;
      LAND_LIFT = BASE_LAND_LIFT * state.unit;
      // Calmer than full tile scale: on a 42-tile planet, per-tile-scale swells lift whole
      // plates far enough to break the silhouette into steps.
      WAVE_AMPLITUDE = BASE_WAVE_AMPLITUDE * Math.sqrt(state.unit);
      buildPlanetMesh(grid);

      var target = state.worldScale;
      var rest = cameraRange().rest;
      if (opts.animate && fromScale !== target && !state.flatMode) {
        animate(1700, function (t) {
          state.planet.scale.setScalar(fromScale + (target - fromScale) * easeOutBack(t));
          state.camDistance = fromDistance + (rest - fromDistance) * easeInOut(t);
          state.updateCamera();
        });
      } else {
        state.planet.scale.setScalar(target);
        if (!state.flatMode && !opts.keepCamera) {
          state.camDistance = rest;
          state.updateCamera();
        }
      }
    });
  }

  function planetInfo() {
    if (!state || !state.tiles) return null;
    return {
      frequency: state.frequency,
      tiles: state.tiles.length,
      hexagons: state.tiles.filter(function (t) { return t.sides === 6; }).length
    };
  }

  function currentTiles() {
    return state && state.tiles;
  }

  // --- Themes -------------------------------------------------------------------------

  // Restyles what's already on screen in place — tiles, water, sky, lights, and every kit
  // building and tree — so nothing needs respawning.
  function setTheme(id) {
    state.themeId = MI.world.themes.ids.indexOf(id) !== -1 ? id : 'meadow';
    currentTheme = MI.world.themes.get(state.themeId);
    WATER_COLOR.set(currentTheme.water);
    LAND_COLOR.set(currentTheme.land);
    LAND_SIDE_COLOR.set(currentTheme.landSide);
    WATER_SIDE_COLOR.set(currentTheme.waterSide);
    applyLighting();
    [state.material, state.islandWaterMaterial].forEach(function (material) {
      if (!material) return;
      var u = material.userData.waterUniforms;
      u.uDeep.value.set(currentTheme.deep).convertSRGBToLinear();
      u.uShallow.value.set(currentTheme.shallow).convertSRGBToLinear();
      u.uFoam.value.set(currentTheme.foam).convertSRGBToLinear();
    });
    refreshSky();
    restyleKit();
    if (state.tiles) repaintTiles();
    if (state.flatMode) refreshFlatView(); // the island rock is coloured at build time
    else applyHighlight();                 // repaintTiles just painted over the mark
  }

  // All kit models share one atlas layout (every colormap is redirected to variation-a),
  // so one recoloured copy per theme serves them all.
  function themedAtlas(baseMap) {
    if (!currentTheme.atlas || !baseMap || !baseMap.image) return baseMap;
    if (!state.atlasCache[state.themeId]) {
      var texture = new THREE.CanvasTexture(
        MI.world.themes.recolorAtlas(baseMap.image, currentTheme.atlas));
      ['flipY', 'encoding', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy']
        .forEach(function (key) { texture[key] = baseMap[key]; });
      state.atlasCache[state.themeId] = texture;
    }
    return state.atlasCache[state.themeId];
  }

  function restyleKit() {
    state.kitMaterials.forEach(function (material) {
      if (!material.userData.baseMap) return;
      material.map = themedAtlas(material.userData.baseMap);
      material.needsUpdate = true;
    });
    var tints = {
      foliage: new THREE.Color(currentTheme.foliage).convertSRGBToLinear(),
      ground: new THREE.Color(currentTheme.ground).convertSRGBToLinear()
    };
    state.foliageGeometries.forEach(function (geometry) {
      var colors = geometry.attributes.color;
      var tint = tints[geometry.userData.grassRole];
      geometry.userData.grassVerts.forEach(function (v) {
        colors.setXYZ(v, tint.r, tint.g, tint.b);
      });
      colors.needsUpdate = true;
    });
  }

  function writeTileColors(tileId, top, side) {
    var range = state.tileVertexRange[tileId];
    if (!range) return;
    var colors = state.geometry.attributes.color.array;
    for (var i = 0; i < range[1]; i++) {
      var c = i < range[2] ? top : side;
      var vi = (range[0] + i) * 3;
      colors[vi] = c.r;
      colors[vi + 1] = c.g;
      colors[vi + 2] = c.b;
    }
    state.geometry.attributes.color.needsUpdate = true;
  }

  function repaintTiles() {
    state.tiles.forEach(function (tile) {
      if (state.waterTileIds.has(tile.id)) writeTileColors(tile.id, WATER_COLOR, WATER_SIDE_COLOR);
      else writeTileColors(tile.id, landTopColor(tile.id), landSideColor(tile.id));
    });
  }

  // A far shell of stars, shown only by themes that ask for it (starlight).
  function makeStars() {
    var count = 700, positions = new Float32Array(count * 3), seed = 7;
    function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    for (var i = 0; i < count; i++) {
      var y = random() * 2 - 1, a = random() * Math.PI * 2, r = 70 + random() * 40;
      var ring = Math.sqrt(1 - y * y);
      positions[i * 3] = r * ring * Math.cos(a);
      positions[i * 3 + 1] = r * y;
      positions[i * 3 + 2] = r * ring * Math.sin(a);
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var stars = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xdfe6ff, size: 0.4, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false
    }));
    stars.visible = false;
    return stars;
  }

  // --- Satellites, pets and skins ------------------------------------------------------
  // Satellites orbit in the sky and are built from primitives (src/world/cosmetics.js).
  // Pets walk the tiles and are GLB models (src/world/walkers.js). They sit in separate
  // equip slots, so a world can have one of each out at the same time.

  // How high the satellite flies, in tile widths above the surface it is circling, and how wide
  // its loop is. It lives in the scene rather than on the planet, so it keeps flying when
  // the planet folds away into the island.
  var SATELLITE_HEIGHT = 3.4;
  // ...but never more than this much of the planet's own radius: tiles are huge next to a
  // 42-tile planet, and a height in tile widths alone flies the satellite out of frame there.
  var SATELLITE_HEIGHT_CAP = 0.55;
  var SATELLITE_ISLAND_HEIGHT = 1.7;
  var SATELLITE_SPEED = 0.32;

  function setSatellite(id) {
    if (state.satellite) {
      state.satelliteGroup.remove(state.satellite);
      state.satellite = null;
    }
    state.satelliteId = id || null;

    var model = id ? MI.world.cosmetics.makeSatellite(id) : null;
    if (!model) return;
    // The holder is steered each frame; the model inside it keeps its own little motions
    // (wagging, spinning) without fighting that orientation.
    var holder = new THREE.Group();
    holder.add(model);
    holder.userData.tick = model.userData.tick;
    state.satellite = holder;
    state.satelliteGroup.add(holder);
    state.satellitePop = 0;
    animate(520, function (t) { state.satellitePop = easeOutBack(t); });
    animateSatellite(performance.now() / 1000);
  }

  // Pets roam any land. Independent of setSatellite above — equipping one never puts the
  // other away. isPet() also screens out a stale saved id (a pet that no longer ships, or a
  // satellite id arriving here) before we fetch a .glb for it.
  function setPet(id) {
    clearWalker('petGroup', 'petWalkers');
    state.petId = id || null;
    if (id && MI.world.walkers.isPet(id)) {
      spawnWalker(id, 'petGroup', 'petWalkers', function () { return state.petId === id; });
    }
  }

  var FOOD_DIR = 'assets/standalone/food/';
  var FOOD_LIFE_MS = 1600;

  function attachTreat(parent, gltf) {
    if (!parent || !gltf) return;
    var obj = gltf.scene.clone(true);
    obj.position.set(0.55, 1.15, 0.35);
    obj.scale.setScalar(0.001);
    obj.traverse(function (node) {
      if (!node.isMesh || !node.material) return;
      node.castShadow = true;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      var next = mats.map(function (m) {
        var c = m.clone();
        c.transparent = true;
        c.opacity = 1;
        return c;
      });
      node.material = next.length === 1 ? next[0] : next;
    });
    parent.add(obj);
    animate(FOOD_LIFE_MS, function (t) {
      if (!obj.parent) return true;
      var pop = t < 0.18 ? t / 0.18 : 1;
      var fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      obj.scale.setScalar(0.42 * pop);
      obj.position.y = 1.15 + Math.sin(t * Math.PI) * 0.4;
      obj.rotation.y = t * 3.8;
      obj.traverse(function (node) {
        if (!node.isMesh || !node.material) return;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(function (m) { m.opacity = fade; });
      });
      if (t >= 1) {
        parent.remove(obj);
        return true;
      }
    });
  }

  // A treat floats next to the pet that is out, then vanishes. The pantry has already
  // spent it; this is only the nibble on the planet.
  function feedPet(foodId) {
    if (!state || !state.petWalkers) return false;
    var item = MI.economy && MI.economy.find('food', foodId);
    if (!item || !item.file) return false;
    loadGLB(FOOD_DIR + item.file).then(function (gltf) {
      if (!gltf || !state.petWalkers) return;
      attachTreat(state.petWalkers.sphere.group, gltf);
      attachTreat(state.petWalkers.flat.group, gltf);
    });
    return true;
  }

  function clearWalker(groupKey, walkersKey) {
    var group = state[groupKey];
    while (group.children.length) group.remove(group.children[0]);
    // Also drop the flat instance if it's currently sitting in flatGroup (safe no-op
    // otherwise — Object3D.remove() ignores an object that isn't actually a child).
    if (state[walkersKey]) {
      state.flatGroup.remove(state[walkersKey].flat.group);
      disposeWalkerPair(state[walkersKey]);
    }
    state[walkersKey] = null;
  }

  // Let a replaced walker's mixers go, or they keep a cached binding to a model nothing draws.
  function disposeWalkerPair(pair) {
    if (!pair) return;
    ['sphere', 'flat'].forEach(function (view) {
      if (!pair[view]) return;
      if (pair[view].animator) pair[view].animator.dispose();
      disposeNameTag(pair[view].group);
    });
  }

  // `stillWanted` guards the async gap: the player may have equipped something else again
  // before the model finished loading.
  function spawnWalker(id, groupKey, walkersKey, stillWanted) {
    MI.world.walkers.makeWalkerPair(id).then(function (pair) {
      if (!pair || !stillWanted()) return;
      state[walkersKey] = pair;
      state[groupKey].add(pair.sphere.group);
      // If we're already looking at the island, place it there now; otherwise buildFlatView
      // will add it the next time that view is (re)built.
      if (state.flatMode && state.island && state.island.centres) state.flatGroup.add(pair.flat.group);
      popIn(pair.sphere.group);
      popIn(pair.flat.group);
    });
  }

  // Every real hexagon neighbour of a tile on the PLANET grid — sphere-view only. The flat
  // view's island is a coiled layout (MI.island), where a planet neighbour isn't necessarily
  // an adjacent cell any more — using this for both views,
  // as an earlier version did, is what let the pet occasionally "hop" across an unrelated cell.
  function walkerNeighbors(tileId) {
    var tile = MI.world.sphere.tile(tileId);
    if (!tile) return [];
    return tile.neighbors.filter(function (id) {
      var n = MI.world.sphere.tile(id);
      return n && n.sides === 6;
    });
  }

  // Walkers tick here instead of animateSatellite's sky loop, since their movement is a
  // tile-to-tile walk rather than a closed-form orbit. Builds the small "where may I stand /
  // where is tile X" context walkers.js needs, once per frame, for each view.
  //
  // Pets and residents run the identical FSM and differ only in what is passed in: a pet
  // gets every land tile, while a resident prefers roads when they exist.
  function updateWalkers(dt) {
    if (!state.tiles) return;
    if (state.petWalkers) {
      driveWalkers(state.petWalkers, dt, {
        canStand: function (id) { return !state.waterTileIds.has(id); },
        islandCanStand: function (centres) { return function (id) { return !!centres[id]; }; },
        sphereScale: PET_SPHERE_SCALE,
        flatScale: PET_FLAT_SCALE
      });
    }
    var residentIds = Object.keys(state.residentWalkers);
    if (!residentIds.length) return;
    if (!state.residentRoutesCache) state.residentRoutesCache = residentSphereRoutes(MI.store.get());
    residentIds.forEach(function (personId) {
      var pair = state.residentWalkers[personId];
      var route = state.residentRoutesCache[personId] || new Set();
      var islandRoute = state.island && state.island.residentRoutes
        ? state.island.residentRoutes[personId] : null;
      var stops = state.residentStopsCache[personId] || [];
      var dwellSlots = stops.length ? stops : [pair.person.placement.slot];
      // A friend loiters on the tiles of their own memories and walks the road between them.
      driveWalkers(pair, dt, {
        anchor: pair.person.placement.slot,
        sphereNeighbors: function (id) {
          var tile = state.tiles[id], edges = state.roadEdgesCache[id];
          return tile && edges ? Array.from(edges).map(function (k) { return tile.neighbors[k]; }) : [];
        },
        flatNeighbors: function (id) {
          return state.island && state.island.roadAdjacency[id] || [];
        },
        chooseNext: function (walker, neighborsOf, canStand) {
          return residentNextTile(walker, stops, neighborsOf, canStand);
        },
        canStand: function (id) { return !state.waterTileIds.has(id) && route.has(id); },
        islandCanStand: function (centres) { return function (id) {
          return !!centres[id] && !!islandRoute && islandRoute.has(id);
        }; },
        sphereScale: RESIDENT_SPHERE_SCALE,
        flatScale: RESIDENT_FLAT_SCALE,
        loiter: {
          dwellsAt: function (id) { return dwellSlots.indexOf(id) !== -1; },
          sphereRest: RESIDENT_REST_SPHERE, flatRest: RESIDENT_REST_FLAT,
          sphereBlocked: function (_id, x, z) { return Math.hypot(x, z) < RESIDENT_CORE; },
          flatBlocked: function (id, x, z) {
            var island = state.island, at = island && island.centres[id];
            if (!at) return false;
            var spot = { x: at.x + x * FLAT_SPACING, z: at.z + z * FLAT_SPACING };
            for (var i = 0; i < island.blockers.length; i++) {
              if (MI.world.player.boxDepth(island.blockers[i], spot, RESIDENT_CLEARANCE) > 0) return true;
            }
            return false;
          }
        }
      });
      sizeNameTag(pair.sphere.group);
      sizeNameTag(pair.flat.group);
    });
  }

  // --- The pirate fleet (src/world/ships.js owns who they are) ----------------------------
  // A ship is a walker whose walkable set is WATER. That one substitution is the whole
  // feature: the wander FSM, the easing, the turn-to-face — all of it already worked, because
  // world.js was already the thing that decides where a walker may go.
  //
  // Ships are planet-only. The island is land coiled into a chunk with no sea around it to
  // sail on (buildIslandUnderside builds water UNDER the tiles), so there is nowhere to put
  // one; they are hidden with the rest of the planet when the view folds.

  // Hulls are 8.8-13.1 long in their own units against a hexagon-kit tile's 1.0. At 0.07 a
  // ship is a bit under a tile — smaller than the houses, still readable from orbit.
  var SHIP_SCALE = 0.07;
  // How deep a hull sits IN the water, in the model's own units. Measured off the mesh: the
  // keel is at 0 and the hull reaches its full beam at about 1.75, which is the deck — so the
  // waterline is the tapering part below that. Sitting the model on y=0 like a building left
  // every ship hovering with its keel in view.
  var SHIP_DRAFT = 1.3;

  // The sea is not flat. animateWater pushes each water tile out along its own normal by
  // WAVE_AMPLITUDE * sin(t * WAVE_SPEED + phase), so a ship held at a fixed radius rides over
  // the troughs and gets swallowed by the crests. This is that same wave, so a ship lifts and
  // drops with the actual water underneath it.
  function waveOffsetAt(tileId, timeSeconds) {
    var tile = (tileId === null || tileId === undefined) ? null : state.tiles[tileId];
    if (!tile) return 0;
    var phase = (tile.dir[0] + tile.dir[2]) * 2.5;
    return WAVE_AMPLITUDE * Math.sin(timeSeconds * WAVE_SPEED + phase);
  }

  // Blended across the two tiles a ship is between, so crossing from one swell to the next is
  // a roll rather than a step.
  function shipHeight(walker, timeSeconds, scale) {
    var from = waveOffsetAt(walker.tileId, timeSeconds);
    var to = waveOffsetAt(walker.targetId, timeSeconds);
    var t = Math.max(0, Math.min(1, walker.t));
    return RADIUS + (from + (to - from) * t) - SHIP_DRAFT * scale;
  }

  function isWater(id) {
    return state.waterTileIds.has(id) && !!MI.world.sphere.tile(id);
  }

  // Open sea: water with no land in sight. An unclaimed ship keeps to it, which is what
  // "hostile" means here — it will not come near your island, and you feel that as distance
  // rather than as damage. Claiming lifts the restriction, and the ship sails in to the coast.
  function isOpenSea(id) {
    if (!isWater(id)) return false;
    var tile = MI.world.sphere.tile(id);
    for (var i = 0; i < tile.neighbors.length; i++) {
      if (!state.waterTileIds.has(tile.neighbors[i])) return false;
    }
    return true;
  }

  function shipTileOf(live) {
    if (!live) return null;
    if (live.walker && live.walker.tileId !== null && live.walker.tileId !== undefined) {
      return live.walker.tileId;
    }
    if (live.tile !== null && live.tile !== undefined) return live.tile;
    return null;
  }

  function disposeShip(live) {
    if (!live) return;
    if (live.walker && live.walker.animator) live.walker.animator.dispose();
    if (live.walker && live.walker.group && state.shipGroup) {
      state.shipGroup.remove(live.walker.group);
    }
  }

  function clearShips() {
    if (!state || !state.shipWalkers) return;
    Object.keys(state.shipWalkers).forEach(function (id) {
      disposeShip(state.shipWalkers[id]);
    });
    state.shipWalkers = {};
    if (state.shipGroup) {
      while (state.shipGroup.children.length) state.shipGroup.remove(state.shipGroup.children[0]);
    }
  }

  function spawnShip(ship, tile) {
    var model = MI.ships.modelFor(ship);
    var id = ship.id;
    // Reserved before the GLB returns so a second sync cannot start another load for the same hull.
    state.shipWalkers[id] = { model: model, walker: null, ship: ship, tile: tile };
    MI.world.walkers.makeWalkerSolo(model).then(function (walker) {
      var slot = state.shipWalkers[id];
      if (!walker || !slot || slot.model !== model) return;
      slot.walker = walker;
      if (tile !== null && tile !== undefined) {
        walker.tileId = walker.targetId = tile;
        walker.fromTileId = null;
        walker.t = 1;
      }
      walker.group.userData.tag = { type: 'ship', id: id };
      state.shipGroup.add(walker.group);
    });
  }

  // Brings what is on screen in line with world.ships: adds ships that have appeared, drops
  // ships that are gone, and swaps the hull of one that has just been claimed. Cheap to call
  // — it only touches what actually differs.
  //
  // Journal ids are always ship-0..ship-3, so a kept walker from the previous journal would
  // show the wrong claimed flag. clearProps drops the fleet; this then rebuilds it. A hull
  // swap (claim) keeps the tile so the ship does not jump across the ocean.
  function syncShips() {
    if (!state || !state.tiles) return;
    var world = MI.store.get();
    var wanted = {};
    (world.ships || []).forEach(function (ship) { wanted[ship.id] = ship; });

    Object.keys(state.shipWalkers).forEach(function (id) {
      var live = state.shipWalkers[id];
      var ship = wanted[id];
      if (!ship) {
        disposeShip(live);
        delete state.shipWalkers[id];
        return;
      }
      live.ship = ship;
      if (live.model === MI.ships.modelFor(ship)) return;
      var tile = shipTileOf(live);
      disposeShip(live);
      delete state.shipWalkers[id];
      spawnShip(ship, tile);
    });

    Object.keys(wanted).forEach(function (id) {
      if (state.shipWalkers[id]) return;
      spawnShip(wanted[id], null);
    });
  }

  function updateShips(dt) {
    if (!state.tiles || !state.shipWalkers) return;
    var ids = Object.keys(state.shipWalkers);
    if (!ids.length) return;
    // Nothing to sail on yet (a brand-new planet is all water, so this is only ever true
    // before the grid has loaded) — and nothing to do while the island is up.
    var sailing = !state.flatMode && !state.transition;
    var now = performance.now() / 1000; // the clock animateWater runs the swell on
    ids.forEach(function (id) {
      var live = state.shipWalkers[id];
      if (!live.walker) return;
      live.walker.group.visible = sailing;
      if (!sailing) return;
      var canSail = live.ship.claimed ? isWater : isOpenSea;
      var scale = state.spacing * SHIP_SCALE;
      MI.world.walkers.updateSphere(live.walker, dt, {
        isLand: canSail,
        neighborsOf: walkerNeighbors,
        findAnchor: function () { return findSeaAnchor(id, canSail); },
        dirOf: function (tileId) {
          var t = MI.world.sphere.tile(tileId);
          return t ? new THREE.Vector3().fromArray(t.dir) : null;
        },
        height: shipHeight(live.walker, now, scale),
        scale: scale,
        offset: 0,
        hop: 0 // a ship rides the swell; it does not bounce from tile to tile
      });
      live.tile = live.walker.tileId;
    });
  }

  // Where a ship starts, and where it re-appears if the sea it was on became land. Chosen from
  // the ship's own id rather than at random, so the same world puts the same ship in the same
  // stretch of ocean on every reload (CLAUDE.md: nothing re-rolled at spawn time). Ships are
  // spread around the planet by starting each search at a different point in the tile list.
  function findSeaAnchor(shipId, canSail) {
    var tiles = state.tiles;
    var offset = Math.floor(hash(hashString(shipId)) * tiles.length);
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[(offset + i) % tiles.length];
      if (tile.sides === 6 && canSail(tile.id)) return tile.id;
    }
    // Every open-sea tile is gone (a very built-up small planet): any water will do.
    for (var j = 0; j < tiles.length; j++) {
      if (tiles[j].sides === 6 && isWater(tiles[j].id)) return tiles[j].id;
    }
    return null;
  }

  function hashString(text) {
    var out = 0;
    for (var i = 0; i < String(text).length; i++) out = ((out * 31) + String(text).charCodeAt(i)) >>> 0;
    return out;
  }

  // How many pauses (2-3s each) a friend spends loitering at a memory's tile before setting
  // off along the road to the next one: about 6-15 seconds.
  var DWELL_ROUNDS = [3, 5];

  function residentNextTile(walker, stops, neighborsOf, canStand) {
    // One memory: that tile is their patch, and they loiter on it for good. (Two memories with
    // no road between them fall through to the same thing below.)
    if (stops.length < 2) return walker.tileId;
    if (stops.indexOf(walker.tileId) !== -1) {
      if (walker.dwellLeft === undefined) {
        walker.dwellLeft = DWELL_ROUNDS[0] + Math.floor(Math.random() * (DWELL_ROUNDS[1] - DWELL_ROUNDS[0] + 1));
      }
      if (walker.dwellLeft > 0) { walker.dwellLeft--; return walker.tileId; }
      walker.dwellLeft = undefined;
    }
    if (walker.stopIndex === undefined) walker.stopIndex = 1;
    if (walker.tileId === stops[walker.stopIndex]) {
      walker.stopIndex = (walker.stopIndex + 1) % stops.length;
    }
    var goal = stops[walker.stopIndex];
    var seen = new Set([walker.tileId]), previous = {}, queue = [walker.tileId];
    for (var i = 0; i < queue.length && !seen.has(goal); i++) {
      neighborsOf(queue[i]).forEach(function (next) {
        if (!canStand(next) || seen.has(next)) return;
        seen.add(next);
        previous[next] = queue[i];
        queue.push(next);
      });
    }
    if (!seen.has(goal)) return walker.tileId; // no road to it: keep loitering where they are
    var step = goal;
    while (previous[step] !== walker.tileId) step = previous[step];
    return step;
  }

  function driveWalkers(walkers, dt, spec) {
    var canStand = spec.canStand;
    var findAnchor = function () {
      var world = MI.store.get();
      if (typeof spec.anchor === 'number' && canStand(spec.anchor)) return spec.anchor;
      if (typeof world.home === 'number' && canStand(world.home)) return world.home;
      for (var i = 0; i < state.tiles.length; i++) {
        if (canStand(state.tiles[i].id)) return state.tiles[i].id;
      }
      return null;
    };
    MI.world.walkers.updateSphere(walkers.sphere, dt, {
      isLand: canStand, neighborsOf: spec.sphereNeighbors || walkerNeighbors, findAnchor: findAnchor,
      chooseNext: spec.chooseNext,
      loiter: spec.loiter && {
        tileWidth: state.spacing, rest: { x: spec.loiter.sphereRest, z: 0 },
        dwellsAt: spec.loiter.dwellsAt, blocked: spec.loiter.sphereBlocked
      },
      dirOf: function (id) { var t = MI.world.sphere.tile(id); return t ? new THREE.Vector3().fromArray(t.dir) : null; },
      height: RADIUS + LAND_LIFT, scale: state.spacing * spec.sphereScale,
      offset: spec.offset ? state.spacing * 0.3 : 0 // matches spawnPerson's "beside the building"
    });

    if (state.island && state.island.centres) {
      var centres = state.island.centres;
      var islandCanStand = spec.islandCanStand(centres);
      var flatFindAnchor = function () {
        var world = MI.store.get();
        if (islandCanStand(spec.anchor)) return spec.anchor;
        if (islandCanStand(world.home)) return world.home;
        var found = null;
        Object.keys(centres).forEach(function (id) {
          if (found === null && islandCanStand(Number(id))) found = Number(id);
        });
        return found;
      };
      MI.world.walkers.updateFlat(walkers.flat, dt, {
        isLand: islandCanStand, neighborsOf: function (id) {
          return spec.flatNeighbors
            ? spec.flatNeighbors(id) : state.island.walkerAdjacency[id] || [];
        },
        chooseNext: spec.chooseNext,
        loiter: spec.loiter && {
          tileWidth: FLAT_SPACING, rest: { x: spec.loiter.flatRest, z: 0 },
          dwellsAt: spec.loiter.dwellsAt, blocked: spec.loiter.flatBlocked
        },
        findAnchor: flatFindAnchor, centres: centres,
        baseY: FLAT_DEFAULT_Y,
        baseYOf: function (id) {
          var y = state.island && state.island.groundY && state.island.groundY[id];
          return y === undefined ? FLAT_DEFAULT_Y : y;
        },
        scale: FLAT_MODEL_SCALE * spec.flatScale,
        offset: spec.offset ? FLAT_SPACING * 0.26 : 0 // the island-view half of the same shift
      });
    }
  }

  // --- Your character, and ground view ----------------------------------------------------
  // The character is a permanent inhabitant, not a mode: it stands on the world in every
  // view and WASD walks it whether you are looking down from orbit or standing behind it.
  // Ground view is only a camera that rides along; orbit's own controls are suspended while
  // it is on and restored on the way out.

  // A person is about a third of a house's height (the house is ~1.14 world units tall on the
  // island; the planet's is oversized by HOUSE_SCALE), and residents are the same size.
  var PLAYER_SPHERE_SCALE = 0.36;
  var PLAYER_FLAT_SCALE = 0.27;
  var GROUND_EYE = 0.55;          // the camera looks this far above the character's feet, in
                                  // character-heights, so it frames the head not the shoes
  // Follow camera: third person, over the right shoulder, at a fixed distance. Distance is in
  // tiles, the shoulder offset in character-scales, so both hold at any planet size.
  var FOLLOW_DIST = 1.6, FOLLOW_SHOULDER = 0.35, FOLLOW_PITCH = 0.62;
  var GROUND_PITCH_MIN = 0.02, GROUND_PITCH_MAX = 0.95;
  var GROUND_LOOK_SPEED = 0.006;  // middle-drag fallback, radians per pixel
  var MOUSE_LOOK_SPEED = 0.0025;  // pointer lock, radians per pixel of movement
  var CAM_TWEEN_MS = 850;
  var SPAWN_CLEARANCE = 0.34;     // of a tile, so the house is in front of you, not on you

  // The instance for whichever view is on screen. Each view keeps its own position, the way
  // the pets do — the sphere's is a direction, the island's is an XZ point, and there is no
  // meaningful way to carry one across to the other.
  function activePlayer() {
    if (!state || !state.players) return null;
    return state.flatMode ? state.players.flat : state.players.sphere;
  }

  // The group the active character lives in. Its transform is what converts between that
  // character's own coordinates and world space.
  function playerGroupFor() {
    return state.flatMode ? state.flatGroup : state.planet;
  }

  // The character's up, in its own group's coordinates: on the planet it is wherever you
  // are standing, on the island it is plain +Y.
  function playerUp(p) {
    return state.flatMode ? new THREE.Vector3(0, 1, 0) : p.dir.clone();
  }

  // Any tangent at `up`. Only ever a last resort, for the moment when the camera looks
  // exactly along the up axis and gives no usable direction of its own.
  function anyTangent(up) {
    var axis = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3().crossVectors(axis, up).normalize();
  }

  // What one tile measures in WORLD units in the view on screen. state.spacing is in the
  // planet group's own units and that group is scaled by frequency/10, so a tile's world
  // size is smaller than `spacing` says — the camera lives in world space and has to use
  // this, not the raw figure. The island hangs in the scene unscaled, so FLAT_SPACING is
  // already a world measurement.
  function groundTileSize() {
    return state.flatMode ? FLAT_SPACING : state.spacing * state.planet.scale.x;
  }

  // Which way is "away from the camera", as a tangent at the character's feet. Taken from
  // the real camera every frame so W means the same thing in orbit and on the ground, and
  // converted into the character's own group's space because that is where it walks.
  function cameraAxes(p, up) {
    var group = playerGroupFor();
    // In follow view the eye moves to avoid roofs. Steering from that temporary eye angle
    // makes W veer sideways whenever the camera is pulled in.
    var dir = state.camMode === 'ground' ? state.groundForward.clone()
      : state.camera.getWorldDirection(new THREE.Vector3())
        .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()).invert());
    var forward = MI.world.player.tangent(dir, up);
    // Looking straight down at the character gives no usable heading; fall back to the
    // direction the ground camera is holding rather than snapping to an arbitrary axis.
    if (!forward) forward = MI.world.player.tangent(state.groundForward, up) || anyTangent(up);
    var right = new THREE.Vector3().crossVectors(forward, up).normalize();
    return { forward: forward, right: right };
  }

  // The ground camera's own heading, in world space.
  function groundForwardWorld(up) {
    var group = playerGroupFor();
    var f = state.groundForward.clone()
      .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    return MI.world.player.tangent(f, up) || anyTangent(up);
  }

  // Only keep the eye out of solid buildings. Trees can pass across the view without
  // changing the camera's distance or angle.
  var BUILDING_TOP = 1.5;
  function eyeBlocked(eye) {
    if (!state.flatMode || !state.island) return false;
    var local = state.flatGroup.worldToLocal(eye.clone());
    if (local.y > BUILDING_TOP) return false;
    var boxes = state.island.blockers;
    for (var i = 0; boxes && i < boxes.length; i++) {
      if (MI.world.player.boxDepth(boxes[i], local, 0.12) > 0) return true;
    }
    return false;
  }

  // Where the follow camera wants to be: eye, look-at and up, without touching the camera —
  // the zoom-in tween and the per-frame follow both read it.
  function groundPose(dt) {
    var p = activePlayer();
    if (!p || !p.group || !p.placed) return null;
    var target = p.group.getWorldPosition(new THREE.Vector3());
    var centre = playerGroupFor().getWorldPosition(new THREE.Vector3());
    var up = state.flatMode
      ? new THREE.Vector3(0, 1, 0)
      : target.clone().sub(centre).normalize();
    // Frame the head rather than the feet. Read the group's WORLD scale: the sphere avatar
    // sits inside the scaled planet group and the island one does not, so its own .scale.x
    // means different things in the two views.
    target.addScaledVector(up, GROUND_EYE * p.group.getWorldScale(new THREE.Vector3()).x);

    var forward = groundForwardWorld(up);
    // Over the shoulder: both the eye and the look-at slide right, so the character sits a
    // little left of centre and the crosshair side of the screen is clear.
    var shoulder = new THREE.Vector3().crossVectors(forward, up).normalize()
      .multiplyScalar(FOLLOW_SHOULDER * p.group.getWorldScale(new THREE.Vector3()).x);
    target.add(shoulder);
    // Check the camera half of the line. Nearby scenery can sit beside the character
    // without pulling the camera down to their shoulder.
    var desired = target.clone()
      .addScaledVector(forward, -state.groundDistance * Math.cos(state.groundPitch))
      .addScaledVector(up, state.groundDistance * Math.sin(state.groundPitch));
    var clear = 1;
    for (var fraction = 0.7; fraction <= 1.001; fraction += 0.05) {
      if (eyeBlocked(target.clone().lerp(desired, Math.min(1, fraction)))) {
        clear = Math.max(0.65, fraction - 0.06);
        break;
      }
    }
    if (state.followClearance === undefined) state.followClearance = clear;
    else if (dt) {
      var rate = clear < state.followClearance ? 22 : 5;
      state.followClearance += (clear - state.followClearance) * (1 - Math.exp(-rate * dt));
    }
    var eye = target.clone().lerp(desired, state.followClearance);
    return { eye: eye, target: target, up: up };
  }

  function updateGroundCamera(dt) {
    var pose = groundPose(dt);
    if (!pose) return;
    state.camera.up.copy(pose.up);
    state.camera.position.copy(pose.eye);
    state.camera.lookAt(pose.target);
    state.lookTarget.copy(pose.target);
  }

  // The orbit camera's own pose for a stored { phi, theta, dist, target }.
  function orbitPose(r) {
    var eye = new THREE.Vector3(
      r.dist * Math.sin(r.phi) * Math.sin(r.theta),
      r.dist * Math.cos(r.phi),
      r.dist * Math.sin(r.phi) * Math.cos(r.theta)
    ).add(r.target);
    return { eye: eye, target: r.target.clone(), up: new THREE.Vector3(0, 1, 0) };
  }

  // Glide the camera from wherever it is to a pose (re-read each frame, so it can follow a
  // moving target). camMode is 'tween' meanwhile, which every input handler treats as locked.
  function tweenCamera(getPose, ms, fromTarget, onDone) {
    var fromEye = state.camera.position.clone();
    var fromUp = state.camera.up.clone();
    animate(ms, function (t) {
      var pose = getPose();
      if (!pose) { onDone(); return true; }
      var k = easeInOut(t);
      state.lookTarget.copy(fromTarget).lerp(pose.target, k);
      state.camera.up.copy(fromUp).lerp(pose.up, k).normalize();
      state.camera.position.copy(fromEye).lerp(pose.eye, k);
      state.camera.lookAt(state.lookTarget);
      if (t >= 1) { onDone(); return true; }
    });
  }

  // Is the ground under this point land? The sphere grid's tiles are the Voronoi cells of
  // their own centres, so nearestSlot is the tile you are actually standing on, not a guess.
  function sphereIsLand(dir) {
    var slot = MI.world.sphere.nearestSlot(dir);
    return slot >= 0 && !state.waterTileIds.has(slot);
  }

  // The island is a loose set of hex cells, so "on the island" is "inside the nearest cell".
  // Comparing against the hexagon's circumradius rounds the corners very slightly, which is
  // invisible and stops you catching on them.
  var ISLAND_REACH = 0.58; // circumradius / centre spacing, near enough

  // The walking height under an island point: the nearest tile's own surface. Falls back to
  // the standard slab so a character is never left hanging while the island rebuilds.
  var FLAT_DEFAULT_Y = FLAT_BASE_Y + TILE_TOP_DEFAULT * FLAT_MODEL_SCALE;
  function flatGroundY(p) {
    var island = state.island;
    if (!island || !island.centres) return FLAT_DEFAULT_Y;
    var slot = nearestIslandSlot(p);
    if (slot === null) return FLAT_DEFAULT_Y;
    var y = island.groundY && island.groundY[slot];
    return y === undefined ? FLAT_DEFAULT_Y : y;
  }

  function nearestIslandSlot(p) {
    var centres = state.island && state.island.centres;
    if (!centres) return null;
    var best = null, bestDist = Infinity;
    var ids = Object.keys(centres);
    for (var i = 0; i < ids.length; i++) {
      var c = centres[ids[i]];
      var dx = p.x - c.x, dz = p.z - c.z, d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = ids[i]; }
    }
    return best;
  }

  // Steps are taken, not teleported: the feet ease onto a new height over a few frames, so a
  // half-height dirt tile reads as a step down and the kerb of a path as a step up.
  var STEP_EASE = 14; // per second
  function easeGroundY(p, target, dt) {
    if (p.groundY === null || p.groundY === undefined) { p.groundY = target; return target; }
    p.groundY += (target - p.groundY) * Math.min(1, dt * STEP_EASE);
    return p.groundY;
  }

  function flatIsLand(p) {
    var centres = state.island && state.island.centres;
    if (!centres) return false;
    var reach = FLAT_SPACING * ISLAND_REACH;
    var limit = reach * reach;
    var ids = Object.keys(centres);
    for (var i = 0; i < ids.length; i++) {
      var c = centres[ids[i]];
      var dx = p.x - c.x, dz = p.z - c.z;
      if (dx * dx + dz * dz < limit) return true;
    }
    return false;
  }

  function firstLandSlot() {
    if (!state.tiles) return null;
    for (var i = 0; i < state.tiles.length; i++) {
      if (!state.waterTileIds.has(state.tiles[i].id)) return state.tiles[i].id;
    }
    return null;
  }

  // Stand the character on its view's home tile, a step clear of the house. Also used to
  // rescue it if the ground under it stops being land, which the planet growing can do.
  function placePlayer(p, view) {
    var world = MI.store.get();
    if (view === 'sphere') {
      var slot = typeof world.home === 'number' && !state.waterTileIds.has(world.home)
        ? world.home : firstLandSlot();
      if (slot === null) return false;
      p.dir.fromArray(MI.world.sphere.tile(slot).dir).normalize();
      p.facing.copy(anyTangent(p.dir));
      // Step clear of the house, BACKWARDS along the facing, so that a ground camera placed
      // behind the character has the house in front of it rather than in the way.
      p.dir.copy(MI.world.player.stepSphere(
        p.dir, p.facing, -state.spacing * SPAWN_CLEARANCE, RADIUS));
      var settled = MI.world.player.tangent(p.facing, p.dir);
      if (settled) p.facing.copy(settled);
    } else {
      var centres = state.island && state.island.centres;
      if (!centres) return false;
      var c = centres[world.home] || centres[Object.keys(centres)[0]];
      if (!c) return false;
      // Stand beside the house, on the side of its nearest land neighbour so there is ground to
      // walk on, facing it (heading 0 faces +Z). The house is nearly as wide as its
      // tile, so the character has to start out by the rim, not at 'a third of a tile back'.
      var away = { x: 0, z: -1 }, nearest = Infinity;
      Object.keys(centres).forEach(function (id) {
        var o = centres[id];
        var dx = o.x - c.x, dz = o.z - c.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.01 && d < FLAT_SPACING * 1.2 && d < nearest) {
          nearest = d; away = { x: dx / d, z: dz / d };
        }
      });
      var out = nearest < Infinity ? FLAT_SPACING * 0.6 : FLAT_SPACING * 0.45;
      p.x = c.x + away.x * out;
      p.z = c.z + away.z * out;
      p.heading = Math.atan2(-away.x, -away.z); // facing the house: the follow camera then sits outside it
    }
    p.groundY = null; // start standing on the new tile rather than easing down from the old one
    p.placed = true;
    return true;
  }

  // Walks the character, in EVERY view — this runs whether or not the ground camera is on,
  // which is what lets you watch yourself wander from orbit.
  function updatePlayer(dt) {
    var p = activePlayer();
    if (!p || !p.group) return;
    var view = state.flatMode ? 'flat' : 'sphere';
    if (!p.placed && !placePlayer(p, view)) return;

    var isLandAt = state.flatMode ? flatIsLand : sphereIsLand;
    var standingOn = state.flatMode ? { x: p.x, z: p.z } : p.dir;
    // The planet growing remaps every tile, so the ground under the character can stop
    // being land between one frame and the next. Put it back on the home tile if so.
    if (!isLandAt(standingOn) && !placePlayer(p, view)) return;

    // Where you can walk: in follow mode, on the island from above, and in the friend hub's
    // plaza. On the planet from orbit you only watch the character stand and wander.
    // WASD and the arrows both steer, in either place — one character, one set of controls,
    // whichever keys your hand falls on. They stay tracked as two sets only so that a keyup
    // for one never clears a key the other is still holding down.
    var canWalk = state.camMode === 'ground' || (state.camMode === 'orbit' && state.flatMode);
    var input = { forward: 0, strafe: 0 };
    if (canWalk) {
      var wasd = state.keys.wasd, arrows = state.keys.arrows;
      if (wasd.w || arrows.w) input.forward += 1;
      if (wasd.s || arrows.s) input.forward -= 1;
      if (wasd.d || arrows.d) input.strafe += 1;
      if (wasd.a || arrows.a) input.strafe -= 1;
    }

    var up = playerUp(p);
    var axes = cameraAxes(p, up);

    if (state.flatMode) {
      // A building's roof can reach out over where the character spawned, and a new one can
      // go up on top of it: step it back out before it walks, so it is never left inside a wall.
      var blockers = state.island && state.island.blockers;
      var clear = MI.world.player.pushOut({ x: p.x, z: p.z }, blockers, PLAYER_RADIUS);
      if (clear && flatIsLand(clear)) { p.x = clear.x; p.z = clear.z; }
      MI.world.player.updateFlat(p, dt, {
        forward: axes.forward, right: axes.right, input: input, isLandAt: flatIsLand,
        // Buildings are solid: a step into a footprint is refused and you glide round it.
        blockers: blockers, blockerRadius: PLAYER_RADIUS,
        speed: MI.world.player.TILES_PER_SECOND * FLAT_SPACING,
        baseY: easeGroundY(p, flatGroundY({ x: p.x, z: p.z }), dt),
        scale: FLAT_MODEL_SCALE * PLAYER_FLAT_SCALE
      });
    } else {
      MI.world.player.updateSphere(p, dt, {
        forward: axes.forward, right: axes.right, input: input, isLandAt: sphereIsLand,
        // state.spacing is a tile's width on THIS planet, so a step covers the same share
        // of a hexagon whatever size the planet has grown to.
        speed: MI.world.player.TILES_PER_SECOND * state.spacing,
        height: RADIUS + LAND_LIFT, radius: RADIUS, scale: state.spacing * PLAYER_SPHERE_SCALE
      });
      // Carry the ground camera along by the very rotation that moved the character. This
      // is what stops the camera swinging around you as you walk, and it is why the camera
      // is held as a vector rather than an angle off some reference direction.
      if (p.lastAngle) state.groundForward.applyAxisAngle(p.lastAxis, p.lastAngle);
    }

    if (state.camMode === 'ground') updateGroundCamera(dt);
  }

  // One avatar per view, since each view keeps its own position. The shared loader falls
  // back to a procedural figure if a model cannot load.
  function setCharacter(id) {
    if (!state) return Promise.resolve();
    var wanted = MI.world.player.isCharacter(id) ? id : MI.world.player.defaultId();
    state.characterId = wanted;
    clearAvatars();
    return Promise.all(['sphere', 'flat'].map(function (view) {
      return MI.world.player.makeAvatar(wanted, makePersonModel).then(function (model) {
        // They may have picked somebody else while this was loading.
        if (!state || state.characterId !== wanted || !model) return;
        var holder = new THREE.Group();
        holder.add(model);
        state.players[view].group = holder;
        // Bound to the model, not the holder: the holder is what this file moves around, and
        // the clips animate the bones inside. Null for the procedural fallback figure.
        state.players[view].animator = MI.world.walkers.makeAnimator(model);
        (view === 'sphere' ? state.playerGroup : state.flatGroup).add(holder);
        // Always on screen: the character lives on the planet like the pets do, not only
        // while the ground camera is looking at it.
        holder.visible = true;
        popIn(holder);
      });
    }));
  }

  function clearAvatars() {
    ['sphere', 'flat'].forEach(function (view) {
      var p = state.players[view];
      if (!p.group) return;
      if (p.group.parent) p.group.parent.remove(p.group);
      if (p.animator) p.animator.dispose();
      p.animator = null;
      p.group = null;
      p.placed = false;
    });
  }

  function isGroundView() {
    return !!state && state.camMode === 'ground';
  }

  // Follow-mode thought bubbles: the memory building in front of you, close enough to read
  // as "looking at it". Sticky once chosen so a glance off-centre does not flicker the card.
  var lookMemoryListener = null;
  var LOOK_NEAR = 2.8;
  var LOOK_KEEP = 3.4;
  var LOOK_DOT = 0.32;
  var LOOK_KEEP_DOT = 0.05;

  function pickLookedMemory() {
    var p = activePlayer();
    if (!p || !p.placed || !state.island || !state.island.centres) return null;
    var world = MI.store.get();
    var centres = state.island.centres;
    var fx = state.groundForward.x, fz = state.groundForward.z;
    var fl = Math.sqrt(fx * fx + fz * fz);
    if (fl < 1e-6) return null;
    fx /= fl; fz /= fl;
    var reach = FLAT_SPACING;
    var current = state.lookedMemoryId || null;
    var best = null, bestScore = Infinity;

    function consider(m, near, minDot) {
      if (!m || !m.placement) return;
      var c = centres[m.placement.slot];
      if (!c) return;
      var dx = c.x - p.x, dz = c.z - p.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > reach * near) return;
      var facing = 1;
      if (dist > 0.12) facing = (dx * fx + dz * fz) / dist;
      if (facing < minDot) return;
      var score = dist / reach - facing;
      if (score < bestScore) { bestScore = score; best = m; }
    }

    if (current) {
      var keep = null;
      (world.memories || []).forEach(function (m) { if (m.id === current) keep = m; });
      consider(keep, LOOK_KEEP, LOOK_KEEP_DOT);
      if (best) return best;
    }

    best = null; bestScore = Infinity;
    (world.memories || []).forEach(function (m) { consider(m, LOOK_NEAR, LOOK_DOT); });
    return best;
  }

  function memoryScreenPos(memory) {
    if (!memory || !memory.placement || !state.island || !state.camera) return null;
    var slot = memory.placement.slot;
    var c = state.island.centres[slot];
    if (!c) return null;
    var y = (state.island.groundY && state.island.groundY[slot] || 0) + 0.48;
    var v = new THREE.Vector3(c.x, y, c.z);
    if (state.flatGroup) v.applyMatrix4(state.flatGroup.matrixWorld);
    v.project(state.camera);
    if (v.z > 1 || v.x < -1.35 || v.x > 1.35 || v.y < -1.4 || v.y > 1.4) return null;
    var canvas = state.renderer.domElement;
    var rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
    };
  }

  function notifyLookMemory() {
    if (!lookMemoryListener) return;
    var live = state.camMode === 'ground' && state.flatMode && !state.transition
      && !(state.hub && state.hub.on);
    if (!live) {
      state.lookedMemoryId = null;
      lookMemoryListener(null, null);
      return;
    }
    var mem = pickLookedMemory();
    state.lookedMemoryId = mem ? mem.id : null;
    lookMemoryListener(mem, mem ? memoryScreenPos(mem) : null);
  }

  // Follow mode is the island's third-person camera. Entering glides the camera in from
  // wherever the orbit view is and stashes it, so leaving glides back to exactly that.
  // It is island-only: on the planet you just watch the character.
  var groundListeners = [];
  function onGroundView(cb) { groundListeners.push(cb); }
  function notifyGround() { groundListeners.forEach(function (cb) { cb(); }); }

  function clearKeys() {
    state.keys = {
      wasd: { w: false, a: false, s: false, d: false },
      arrows: { w: false, a: false, s: false, d: false }
    };
  }

  function releasePointer() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* not locked */ }
  }

  function setGroundView(on) {
    if (!state || state.transition || state.camMode === 'tween') return Promise.resolve(isGroundView());
    if (state.hub && state.hub.on) return Promise.resolve(false);
    var want = !!on;
    if (want === isGroundView()) return Promise.resolve(want);

    if (!want) {
      var restore = state.orbitRestore;
      state.camMode = 'tween';
      state.groundHadLock = false; // before releasing, so the lock change does not call us again
      releasePointer();
      clearKeys();
      return new Promise(function (resolve) {
        tweenCamera(function () { return restore ? orbitPose(restore) : null; },
          CAM_TWEEN_MS * 0.85, state.lookTarget.clone(), function () {
            if (restore) {
              state.camPhi = restore.phi;
              state.camTheta = restore.theta;
              state.camDistance = restore.dist;
              state.camTarget.copy(restore.target);
            }
            state.camera.up.set(0, 1, 0);
            state.camMode = 'orbit';
            state.updateCamera();
            notifyGround();
            resolve(false);
          });
      });
    }

    if (!state.flatMode) return Promise.resolve(false); // island only
    state.camMode = 'tween';
    var ready = state.characterId ? Promise.resolve() : setCharacter(MI.world.player.defaultId());
    return ready.then(function () {
      var p = state.players.flat;
      if (!p.group || (!p.placed && !placePlayer(p, 'flat'))) {
        state.camMode = 'orbit';
        return false;
      }
      state.orbitRestore = {
        phi: state.camPhi, theta: state.camTheta,
        dist: state.camDistance, target: state.camTarget.clone()
      };
      // Start behind the character, looking the way it faces.
      state.groundForward = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
      state.groundPitch = FOLLOW_PITCH;
      state.groundDistance = FOLLOW_DIST * groundTileSize();
      state.followClearance = undefined;
      clearKeys();
      // Grabbing the mouse needs a user gesture, which the button click that got us here is.
      // If the browser refuses, middle-drag still turns the camera.
      try {
        var asked = state.renderer.domElement.requestPointerLock();
        if (asked && asked.catch) asked.catch(function () {});
      } catch (e) { /* no pointer lock here */ }
      return new Promise(function (resolve) {
        tweenCamera(groundPose, CAM_TWEEN_MS, state.camTarget.clone(), function () {
          state.camMode = 'ground';
          state.groundHadLock = document.pointerLockElement === state.renderer.domElement;
          updateGroundCamera();
          notifyGround();
          resolve(true);
        });
      });
    });
  }

  var SIDEWAYS = new THREE.Vector3(1, 0, 0);
  var satPlanetPos = new THREE.Vector3(), satIslandPos = new THREE.Vector3();
  var satPlanetQuat = new THREE.Quaternion(), satIslandQuat = new THREE.Quaternion();
  var satBasis = new THREE.Matrix4();

  function aimAlong(quat, up, forward) {
    forward.sub(up.clone().multiplyScalar(forward.dot(up))).normalize();
    var right = new THREE.Vector3().crossVectors(up, forward).normalize();
    quat.setFromRotationMatrix(satBasis.makeBasis(right, up, forward));
  }

  // A slow, high loop: around home on the planet, around the island in island view, eased
  // between the two as the views change (state.viewMix), so the satellite never pops away.
  function animateSatellite(t) {
    var satellite = state.satellite;
    if (!satellite || !state.tiles) return;
    var a = t * SATELLITE_SPEED;
    var bob = 0.08 * Math.sin(t * 2.1);
    var mix = state.viewMix;

    // --- around the planet, in world space (the planet sits at the origin) ---
    var planetScale = state.planet.scale.x;
    var world = MI.store && MI.store.get();
    var homeTile = world && typeof world.home === 'number' ? state.tiles[world.home] : null;
    var h = homeTile ? new THREE.Vector3().fromArray(homeTile.dir)
      : new THREE.Vector3(0.6, 0.45, 0.66).normalize(); // roughly where the camera starts
    h.applyQuaternion(state.planet.quaternion);
    var t1 = new THREE.Vector3().crossVectors(Math.abs(h.y) > 0.95 ? SIDEWAYS : UP, h).normalize();
    var t2 = new THREE.Vector3().crossVectors(h, t1);
    var beta = Math.min(1.0, 2.1 * state.spacing / RADIUS); // loop radius, as an angle
    var ring = t1.clone().multiplyScalar(Math.cos(a)).add(t2.clone().multiplyScalar(Math.sin(a)));
    var radial = h.clone().multiplyScalar(Math.cos(beta))
      .add(ring.multiplyScalar(Math.sin(beta))).normalize();
    var altitude = RADIUS + LAND_LIFT
      + Math.min(state.spacing * SATELLITE_HEIGHT, RADIUS * SATELLITE_HEIGHT_CAP) * (1 + bob * 0.3);
    satPlanetPos.copy(radial).multiplyScalar(altitude * planetScale);
    aimAlong(satPlanetQuat, radial,
      t1.clone().multiplyScalar(-Math.sin(a)).add(t2.clone().multiplyScalar(Math.cos(a))));
    var planetSize = state.spacing * 0.85 * planetScale;

    // --- around the island, level, above the rooftops ---
    var loop = Math.max(2.5, (state.flatRadius || 4) * 0.62);
    satIslandPos.set(Math.cos(a) * loop,
      FLAT_BASE_Y + FLAT_SPACING * (SATELLITE_ISLAND_HEIGHT + bob), Math.sin(a) * loop);
    aimAlong(satIslandQuat, UP, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
    var islandSize = FLAT_MODEL_SCALE * 0.6;

    satellite.position.copy(satPlanetPos).lerp(satIslandPos, mix);
    satellite.quaternion.copy(satPlanetQuat).slerp(satIslandQuat, mix);
    satellite.scale.setScalar((planetSize + (islandSize - planetSize) * mix) * state.satellitePop);
    if (satellite.userData.tick) satellite.userData.tick(t);
  }

  // Re-dress every figure on screen, in both views, without respawning anything.
  function setSkin(id) {
    state.skin = id || 'classic';
    var people = [];
    [state.props, state.flatGroup].forEach(function (group) {
      group.traverse(function (node) { if (node.userData && node.userData.isPerson) people.push(node); });
    });
    people.forEach(function (person) {
      MI.world.cosmetics.dressPerson(person, state.skin, person.userData.color);
    });
  }

  // --- Init ---------------------------------------------------------------------------

  // options (all optional, from the saved world): { frequency, theme, satellite, pet,
  // character, skin }. Residents come from saved memory people during restore.
  function init(canvasEl, options) {
    var opts = options || {};
    var renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var scene = new THREE.Scene();
    // Its own colour: applyViewLighting blends into it in place, so it must not be
    // PLANET_BG or FLAT_BG themselves.
    scene.background = PLANET_BG.clone();

    var camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
    var hemi = new THREE.HemisphereLight(0xcfe9f5, 0x6f9c5e, 1.1);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff1d6, 1.3);
    sun.position.set(8, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    scene.add(sun);

    window.addEventListener('resize', function () {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });

    var planet = new THREE.Group();
    scene.add(planet);
    var props = new THREE.Group();
    planet.add(props);
    // The flat view lives in the same scene, centred on the origin, and simply swaps
    // visibility with the planet — so the orbit camera below works for both unchanged.
    var flatGroup = new THREE.Group();
    flatGroup.visible = false;
    scene.add(flatGroup);
    // In the scene, not on the planet: the satellite keeps flying when the planet folds away.
    var satelliteGroup = new THREE.Group();
    scene.add(satelliteGroup);
    // Pets (src/world/walkers.js) need one instance per view, since they
    // wander independently in each. Unlike satelliteGroup above, the sphere instance lives inside
    // `planet` — it stands on the tiles, so it has to hide and scale with them. The flat
    // instance lives inside `flatGroup` itself (added back in by buildFlatView, since that
    // group is fully cleared and rebuilt on every flat-view refresh) so it automatically
    // inherits the island's fold rotation.
    var petWalkerGroup = new THREE.Group();
    planet.add(petWalkerGroup);
    var residentGroup = new THREE.Group();
    planet.add(residentGroup);
    // Ships hang off the planet like everything else, so they turn with it and are hidden
    // with it when the view folds to the island.
    var shipGroup = new THREE.Group();
    planet.add(shipGroup);
    // Your character, one instance per view, parented for the same reasons.
    var playerGroup = new THREE.Group();
    planet.add(playerGroup);

    state = {
      renderer: renderer, scene: scene, camera: camera,
      planet: planet, props: props, flatGroup: flatGroup,
      hemiLight: hemi, sunLight: sun,
      loaders: {}, glbCache: {}, partsCache: {}, spinners: [],
      camTheta: 0.7, camPhi: 1.1, camDistance: 13, camTarget: new THREE.Vector3(),
      flatMode: false, flatRadius: 3, transition: null,
      // folding: the tiles are actually in flight (not the camera turn before it), so every
      // figure is hidden. figuresHidden: they are, and are waiting on an update tick to place
      // them before they come back. See hideFigures/showFigures.
      folding: false, figuresHidden: false,
      // Planet size (setPlanet): frequency, world scale = frequency / 10, unit = its inverse.
      frequency: null, worldScale: 1, unit: 1, gridCache: {},
      island: null, islandFocus: new THREE.Vector3(), sky: null, skyCache: {},
      viewMix: 0, satellitePop: 1, // 0 = planet view, 1 = island view; satellitePop scales a satellite in
      landAsset: {},            // slot -> terrain asset, for repainting on a theme change
      hubHalo: null, hubPad: [],
      // Cosmetics: every kit material / foliage geometry ever split, so a theme can restyle
      // what's already on screen; one recoloured atlas per theme.
      kitMaterials: [], foliageGeometries: [], atlasCache: {},
      themeId: null, skin: opts.skin || 'classic',
      satelliteId: null, satellite: null, satelliteGroup: satelliteGroup,
      // Walkers: pets roam any land; residents patrol their own memory routes.
      petId: null, petGroup: petWalkerGroup, petWalkers: null,
      residentGroup: residentGroup, residentWalkers: {},
      residentRoutesCache: null, residentStopsCache: null,
      roadEdgesCache: null,
      // The pirate fleet, keyed by ship id: { model, walker, ship, tile }. Planet-only.
      shipGroup: shipGroup, shipWalkers: {},
      // camMode is 'orbit' or 'ground'; orbitRestore is the orbit camera stashed on the
      // way into ground view, so leaving puts the view back exactly as it was. groundForward
      // is a TANGENT VECTOR in the character's own group's space, carried along by the same
      // rotation that moves the character rather than recomputed from a reference direction.
      camMode: 'orbit', characterId: null, playerGroup: playerGroup,
      players: { sphere: MI.world.player.newPlayer(), flat: MI.world.player.newPlayer() },
      keys: { wasd: { w: false, a: false, s: false, d: false },
              arrows: { w: false, a: false, s: false, d: false } },
      groundForward: new THREE.Vector3(1, 0, 0),
      groundPitch: FOLLOW_PITCH, groundDistance: FOLLOW_DIST * FLAT_SPACING,
      orbitRestore: null, lookTarget: new THREE.Vector3(), groundHadLock: false,
      galaxy: {
        on: false, mix: 0, group: null, planets: [], hoverId: null,
        liveId: null, liveHover: 0, liveBounce: 0, saved: null, busy: false,
        focusId: null, hop: null
      },
      hub: {
        on: false, busy: false, group: null, figures: [], player: null,
        hoverId: null, prompt: false, autoArmed: true, saved: null,
        camOffset: null, blockers: [], groundY: 0, centres: [], radius: 0
      }
    };
    state.stars = makeStars();
    scene.add(state.stars);
    state.sky = makeSky();
    scene.add(state.sky);
    state.galaxy.group = new THREE.Group();
    state.galaxy.group.visible = false;
    scene.add(state.galaxy.group);
    state.hub.group = new THREE.Group();
    state.hub.group.visible = false;
    scene.add(state.hub.group);
    setTheme(opts.theme || 'meadow');

    // Orbit camera, shared by both views: eye on a sphere around the origin, looking in.
    // Dragging phi toward PI/2 puts the eye level with the ground, which is exactly the
    // side-on view the flat layout is for.
    state.updateCamera = function () {
      camera.position.set(
        state.camDistance * Math.sin(state.camPhi) * Math.sin(state.camTheta),
        state.camDistance * Math.cos(state.camPhi),
        state.camDistance * Math.sin(state.camPhi) * Math.cos(state.camTheta)
      ).add(state.camTarget);
      camera.lookAt(state.camTarget);
    };
    state.updateCamera();

    var dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    var looking = false; // ground view: middle button held, turning the camera
    canvasEl.addEventListener('mousedown', function (e) {
      lastX = e.clientX; lastY = e.clientY;
      if (state.camMode === 'tween') return;
      if (state.hub && state.hub.on) {
        if (e.button !== 0) return;
        dragging = true; dragMoved = false;
        canvasEl.style.cursor = 'grabbing';
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      }
      if (state.camMode === 'ground') {
        // Middle button only. Left is left alone so it stays free for clicking on things.
        if (e.button !== 1) return;
        e.preventDefault(); // or the browser opens its autoscroll widget
        looking = true;
        canvasEl.style.cursor = 'move';
        return;
      }
      if (e.button !== 0) return;
      dragging = true; dragMoved = false;
      canvasEl.style.cursor = 'grabbing';
    });
    // Chrome fires auxclick after a middle release; without this it can still autoscroll.
    canvasEl.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
      looking = false;
      canvasEl.style.cursor = (state.hub && state.hub.on)
        ? 'grab'
        : (state.camMode === 'ground' ? 'default' : hoverCursor);
    });

    // Hover: a pointer over anything you can actually open, plus a light mark on the tile.
    // One raycast per frame at most — picking on the planet walks the whole merged mesh.
    var hoverCursor = 'grab';
    var hoverPending = null;
    canvasEl.addEventListener('mousemove', function (e) {
      if (dragging || state.transition) return;
      hoverPending = e;
    });
    canvasEl.addEventListener('mouseleave', function () {
      hoverPending = null;
      hoverCursor = 'grab';
      canvasEl.style.cursor = 'grab';
      if (state.galaxy && state.galaxy.on) {
        setGalaxyHover(null);
        if (galaxyHoverListener) galaxyHoverListener(null);
        return;
      }
      if (hoverListener) hoverListener(null);
    });
    state.pollHover = function () {
      if (!hoverPending || dragging || state.transition) return;
      if (state.hub && state.hub.on) {
        var event = hoverPending;
        hoverPending = null;
        var hid = pickHubLook(event, canvasEl, true);
        setHubHover(hid);
        hoverCursor = hid ? 'pointer' : 'grab';
        canvasEl.style.cursor = hoverCursor;
        return;
      }
      if (state.camMode === 'ground') {
        var groundEvent = hoverPending;
        hoverPending = null;
        var groundSlot = pickSlot(groundEvent, canvasEl);
        var overHub = isHubBuildingSlot(groundSlot);
        if (hoverListener) hoverListener(overHub ? groundSlot : null);
        hoverCursor = overHub ? 'pointer' : 'default';
        canvasEl.style.cursor = hoverCursor;
        return;
      }
      if (state.camMode !== 'orbit') { hoverPending = null; return; }
      var event = hoverPending;
      hoverPending = null;
      if (state.galaxy && state.galaxy.on) {
        if (state.galaxy.busy) return;
        var gid = pickGalaxy(event, canvasEl);
        if (setGalaxyHover(gid) && galaxyHoverListener) galaxyHoverListener(gid);
        hoverCursor = gid ? 'pointer' : 'grab';
        canvasEl.style.cursor = hoverCursor;
        return;
      }
      var shipId = pickShip(event, canvasEl);
      if (shipId) {
        if (hoverListener) hoverListener(null);
        hoverCursor = 'pointer';
        canvasEl.style.cursor = hoverCursor;
        return;
      }
      var slot = pickSlot(event, canvasEl);
      var over = hoverListener ? hoverListener(slot == null ? null : slot) : false;
      hoverCursor = over ? 'pointer' : 'grab';
      canvasEl.style.cursor = hoverCursor;
    };
    // Turn the held forward vector about the character's own up, rather than nudging an
    // angle that something else also derives — the vector IS the camera's heading.
    function steerCamera(dx, dy, speed) {
      var who = activePlayer();
      if (!who) return;
      state.groundForward.applyAxisAngle(playerUp(who), -dx * speed);
      state.groundPitch = Math.max(GROUND_PITCH_MIN,
        Math.min(GROUND_PITCH_MAX, state.groundPitch + dy * speed));
      updateGroundCamera();
    }
    state.steerCamera = steerCamera;
    window.addEventListener('mousemove', function (e) {
      if (state.transition || state.camMode === 'tween') return;
      // Follow mode with the mouse captured: moving the mouse turns you, no button needed.
      if (state.camMode === 'ground' && document.pointerLockElement === canvasEl) {
        steerCamera(e.movementX || 0, e.movementY || 0, MOUSE_LOOK_SPEED);
        return;
      }
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (looking) {
        steerCamera(dx, dy, GROUND_LOOK_SPEED);
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      if (!dragging) return;
      if (state.hub && state.hub.on) {
        if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
        if (state.hub.camOffset) {
          state.hub.camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.008);
          state.hub.camOffset.y = Math.max(2.2, Math.min(9, state.hub.camOffset.y - dy * 0.02));
          updateHubCamera();
        }
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      if (state.galaxy && state.galaxy.busy) return;
      if (state.galaxy && state.galaxy.hop) return;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      state.camTheta -= dx * 0.006;
      state.camPhi = clampPhi(state.camPhi - dy * 0.006);
      lastX = e.clientX; lastY = e.clientY;
      state.updateCamera();
    });
    // The browser takes the mouse back on Esc and fires this instead of a keydown: that is
    // the way out of follow mode when the mouse is captured.
    document.addEventListener('pointerlockchange', function () {
      if (document.pointerLockElement === canvasEl) return;
      if (state.groundHadLock && state.camMode === 'ground') {
        state.groundHadLock = false;
        setGroundView(false);
      }
    });

    canvasEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (state.transition) return;
      if (state.hub && state.hub.on) {
        var off = state.hub.camOffset;
        if (!off) return;
        var len = off.length();
        var next = Math.max(5, Math.min(14, len * (1 + e.deltaY * 0.001)));
        if (len > 0.001) off.multiplyScalar(next / len);
        updateHubCamera();
        return;
      }
      if (state.camMode !== 'orbit') return; // the follow camera keeps a fixed distance
      if (state.galaxy && state.galaxy.on) {
        if (state.galaxy.busy) return;
        var far = galaxyCameraDistance();
        state.camDistance = Math.max(far * 0.55, Math.min(far * 1.85,
          state.camDistance * (1 + e.deltaY * 0.001)));
        state.updateCamera();
        return;
      }
      // The flat layout is much smaller than the planet, so it needs its own zoom range.
      var range = cameraRange();
      var min = state.flatMode ? 2.5 : range.min;
      var max = state.flatMode ? Math.max(8, state.flatRadius * 6) : range.max;
      state.camDistance = Math.max(min, Math.min(max, state.camDistance * (1 + e.deltaY * 0.001)));
      state.updateCamera();
    }, { passive: false });
    canvasEl.style.cursor = 'grab';

    // WASD and the arrows are equivalent; updatePlayer reads both. They are kept as two
    // separate sets so that releasing one never clears a key the other is still holding.
    var MOVE_KEYS = {
      KeyW: ['wasd', 'w'], KeyA: ['wasd', 'a'], KeyS: ['wasd', 's'], KeyD: ['wasd', 'd'],
      ArrowUp: ['arrows', 'w'], ArrowLeft: ['arrows', 'a'],
      ArrowDown: ['arrows', 's'], ArrowRight: ['arrows', 'd']
    };

    function typingSomewhere() {
      var el = document.activeElement;
      if (!el) return false;
      var tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    window.addEventListener('keydown', function (e) {
      if (typingSomewhere() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (state.galaxy && state.galaxy.on) {
        if (GALAXY_MOVE[e.code] || e.code === 'Enter' || e.code === 'NumpadEnter') {
          dragging = false;
          dragMoved = false;
        }
        if (handleGalaxyKey(e)) return;
      }
      var key = MOVE_KEYS[e.code];
      if (!key) return;
      // Arrows would scroll the page; in the hub both sets are walking, so neither should.
      if (key[0] === 'arrows' || (state.hub && state.hub.on)) e.preventDefault();
      state.keys[key[0]][key[1]] = true;
    });
    window.addEventListener('keyup', function (e) {
      var key = MOVE_KEYS[e.code];
      if (key) state.keys[key[0]][key[1]] = false;
    });
    // A lost focus (alt-tab mid-stride) would otherwise leave a key stuck down forever.
    window.addEventListener('blur', clearKeys);

    canvasEl.addEventListener('click', function (e) {
      if (dragMoved || state.transition) return; // a camera drag or mid-unfold, not a pick
      if (state.hub && state.hub.on) {
        var lookId = pickHubLook(e, canvasEl, false);
        if (hubPickListener) hubPickListener(lookId);
        return;
      }
      if (state.galaxy && state.galaxy.on) {
        if (state.galaxy.busy) return;
        var gid = pickGalaxy(e, canvasEl);
        if (galaxyPickListener) galaxyPickListener(gid);
        return;
      }
      if (state.camMode === 'ground') {
        var groundSlot = pickSlot(e, canvasEl);
        if (isHubBuildingSlot(groundSlot)) enterHub();
        return;
      }
      if (state.camMode !== 'orbit') return;     // following or mid-tween: nothing to pick yet
      // Ships first: one stands proud of the sea it is on, so answering with the water tile
      // underneath it (and opening nothing) would read as a dead click.
      var shipId = pickShip(e, canvasEl);
      if (shipId) {
        shipPickListeners.forEach(function (cb) { cb(shipId); });
        return;
      }
      var slot = pickSlot(e, canvasEl);
      pickListeners.forEach(function (cb) { cb(slot); });
    });

    return setPlanet(opts.frequency || REFERENCE_FREQUENCY, { animate: false }).then(function () {
      setSatellite(opts.satellite || null);
      setPet(opts.pet || null);
      // Your character is always on the planet, so it is built at boot like the scenery
      // rather than when some mode is switched on.
      setCharacter(opts.character || MI.world.player.defaultId());
      startLoop();
    });
  }

  // Builds the merged planet mesh for `hexgrid`, replacing any previous one. Every tile starts
  // as water; the caller replays the saved world on top (MI.app.restore).
  function buildPlanetMesh(hexgrid) {
    if (state.planetMesh) {
      state.planet.remove(state.planetMesh);
      state.planetMesh.geometry.dispose();
      state.planetMesh = null;
    }
    MI.world.sphere.setGrid(hexgrid);
    var tiles = hexgrid.tiles;
    state.tiles = tiles;
    state.landAsset = {};

    // Typical cell size, measured across hexagons only — tile 0 is always a pentagon
    // (icosahedron vertices are), and pentagons are noticeably tighter than the rest.
    var sample = tiles.filter(function (t) { return t.sides === 6; }).slice(0, 64);
    state.spacing = sample.reduce(function (sum, t) {
      return sum + tileApothem(t) * 2;
    }, 0) / sample.length;

    // Per tile: one fan triangle per edge for the top, plus two for that edge's wall.
    var totalTriangles = tiles.reduce(function (sum, t) { return sum + t.sides * 3; }, 0);
    var positions = new Float32Array(totalTriangles * 3 * 3);
    var colors = new Float32Array(totalTriangles * 3 * 3);
    var uvs = new Float32Array(totalTriangles * 3 * 2);
    var land = new Float32Array(totalTriangles * 3); // 0 = water (procedural), 1 = land
    var faceToTileId = new Int32Array(totalTriangles);
    var tileVertexRange = {};
    var vCursor = 0, triCursor = 0;

    tiles.forEach(function (tile) {
      var center = tile.dir.map(function (c) { return c * RADIUS; });
      var normal = new THREE.Vector3().fromArray(tile.dir);
      var tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.y) > 0.9) tangent.set(1, 0, 0);
      tangent.cross(normal).normalize();
      var bitangent = new THREE.Vector3().crossVectors(normal, tangent);
      // Rotate each tile's sampling deterministically so the atlas doesn't
      // look stamped. UVs are fixed at rest, so the pattern moves with water.
      var angle = tile.id * 2.399963229728653;
      tangent.applyAxisAngle(normal, angle);
      bitangent.crossVectors(normal, tangent);
      var uvScale = 0;
      tile.corners.forEach(function (corner) {
        var delta = new THREE.Vector3().fromArray(corner).sub(normal);
        uvScale = Math.max(uvScale, Math.abs(delta.dot(tangent)), Math.abs(delta.dot(bitangent)));
      });
      var startVert = vCursor;
      for (var k = 0; k < tile.sides; k++) {
        var c0 = normalize(lerp3(tile.corners[k], tile.dir, GAP_AMOUNT));
        var c1 = normalize(lerp3(tile.corners[(k + 1) % tile.sides], tile.dir, GAP_AMOUNT));
        var tri = [center, c0.map(function (c) { return c * RADIUS; }), c1.map(function (c) { return c * RADIUS; })];
        for (var v = 0; v < 3; v++) {
          positions[vCursor * 3] = tri[v][0];
          positions[vCursor * 3 + 1] = tri[v][1];
          positions[vCursor * 3 + 2] = tri[v][2];
          colors[vCursor * 3] = WATER_COLOR.r;
          colors[vCursor * 3 + 1] = WATER_COLOR.g;
          colors[vCursor * 3 + 2] = WATER_COLOR.b;
          var point = new THREE.Vector3().fromArray(tri[v]).multiplyScalar(1 / RADIUS).sub(normal);
          // Inset samples from atlas borders to prevent filtering bleed.
          uvs[vCursor * 2] = 0.25 + 0.20 * point.dot(tangent) / uvScale;
          uvs[vCursor * 2 + 1] = 0.5 + 0.4 * point.dot(bitangent) / uvScale;
          vCursor++;
        }
        faceToTileId[triCursor++] = tile.id;
      }
      var topVerts = vCursor - startVert;

      // Walls dropping inward from every edge. Without them, a bobbing water tile
      // separates from its neighbours and you see straight through the crack to the
      // background. They also give land its Minecraft-style dirt side.
      for (k = 0; k < tile.sides; k++) {
        var e0 = normalize(lerp3(tile.corners[k], tile.dir, GAP_AMOUNT));
        var e1 = normalize(lerp3(tile.corners[(k + 1) % tile.sides], tile.dir, GAP_AMOUNT));
        var top0 = e0.map(function (c) { return c * RADIUS; });
        var top1 = e1.map(function (c) { return c * RADIUS; });
        var low0 = e0.map(function (c) { return c * (RADIUS - TILE_DEPTH); });
        var low1 = e1.map(function (c) { return c * (RADIUS - TILE_DEPTH); });
        // (t0, b1, t1) is the winding that faces outward here — verified against the grid.
        var wall = [top0, low1, top1, top0, low0, low1];
        for (var w = 0; w < wall.length; w++) {
          positions[vCursor * 3] = wall[w][0];
          positions[vCursor * 3 + 1] = wall[w][1];
          positions[vCursor * 3 + 2] = wall[w][2];
          colors[vCursor * 3] = WATER_SIDE_COLOR.r;
          colors[vCursor * 3 + 1] = WATER_SIDE_COLOR.g;
          colors[vCursor * 3 + 2] = WATER_SIDE_COLOR.b;
          // Sides always take the plain vertex-colour path: the procedural water reads
          // badly on a vertical face, and these should be solid rock/deep-water anyway.
          land[vCursor] = 1;
          uvs[vCursor * 2] = 0.25;
          uvs[vCursor * 2 + 1] = 0.5;
          vCursor++;
        }
        faceToTileId[triCursor++] = tile.id;
        faceToTileId[triCursor++] = tile.id;
      }
      tileVertexRange[tile.id] = [startVert, vCursor - startVert, topVerts];
    });

    state.basePositions = positions.slice(); // pristine sea-level geometry
    // Where each vertex currently belongs at rest — identical to basePositions except
    // for tiles that have been raised into land. Animations offset from this.
    state.restPositions = positions.slice();
    state.waterTileIds = new Set(tiles.map(function (t) { return t.id; }));
    state.tileVertexRange = tileVertexRange;
    state.faceToTileId = faceToTileId;

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
    geometry.computeVertexNormals();
    state.geometry = geometry;

    // One material for the life of the page — a rebuild only swaps geometry.
    if (!state.material) {
      state.material = new THREE.MeshStandardMaterial({
        map: makeSurfaceTexture(), vertexColors: true, flatShading: true, roughness: 0.85
      });
      installWaterShader(state.material);
    }
    var planetMesh = new THREE.Mesh(geometry, state.material);
    planetMesh.castShadow = true;
    planetMesh.receiveShadow = true;
    state.planet.add(planetMesh);
    state.planetMesh = planetMesh;
  }

  // --- Journal galaxy -----------------------------------------------------------------
  // Switch-journal (and first boot) pull the camera back into space and float a toy planet
  // for every saved world. The live planet stays at the origin when you came from it;
  // everything else is a low-poly stand-in so we never rebuild five hex-spheres at once.
  var SPACE_BG = new THREE.Color(0x070a1c);
  var SPACE_HEMI_SKY = new THREE.Color(0x9aa8ff);
  var SPACE_HEMI_GROUND = new THREE.Color(0x16102c);
  var SPACE_SUN = new THREE.Color(0xe4ecff);
  var galaxyHoverListener = null;
  var galaxyPickListener = null;
  var galaxyFrameListener = null;
  var galaxyScreenTmp = new THREE.Vector3();
  var galaxyEdgeTmp = new THREE.Vector3();
  var galaxyPosTmp = new THREE.Vector3();
  var galaxyRightTmp = new THREE.Vector3();
  var galaxyUpTmp = new THREE.Vector3();

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function applyGalaxyLighting(mix) {
    refreshViewLight();
    var a = VIEW_LIGHT.planet;
    var m = clamp01(mix);
    state.scene.background.copy(a.bg).lerp(SPACE_BG, m);
    state.hemiLight.color.copy(a.sky).lerp(SPACE_HEMI_SKY, m);
    state.hemiLight.groundColor.copy(a.ground).lerp(SPACE_HEMI_GROUND, m);
    state.hemiLight.intensity = a.hemi + (0.5 - a.hemi) * m;
    state.sunLight.color.copy(a.sun).lerp(SPACE_SUN, m);
    state.sunLight.intensity = a.sunI + (0.95 - a.sunI) * m;
    state.sunLight.position.set(6 + 2 * m, 12 - 6 * m, 6 + 4 * m);
    if (state.sky) {
      var skyOp = (state.flatMode ? 1 : 0) * (1 - m);
      state.sky.material.opacity = skyOp;
      state.sky.visible = skyOp > 0.01;
    }
    if (state.stars) {
      state.stars.visible = m > 0.02 || !!(currentTheme && currentTheme.stars);
      state.stars.material.opacity = (currentTheme && currentTheme.stars) ? 0.85 : (0.18 + 0.72 * m);
      state.stars.material.size = 0.4 + 0.35 * m;
    }
    state.viewMix = state.flatMode ? (1 - m) : 0;
  }

  function idSeed(id) {
    var s = 2166136261;
    String(id || '').split('').forEach(function (ch) {
      s ^= ch.charCodeAt(0);
      s = Math.imul(s, 16777619) >>> 0;
    });
    return s;
  }

  // --- Mini planets -------------------------------------------------------------------
  // Every world on the shelf is drawn for real: its own saved land tiles, on its own grid,
  // with its own buildings standing on them. It is a COMPRESSED copy, though, because a
  // whole shelf of them shares the screen — tile tops and a short skirt instead of the full
  // planet mesh, flat vertex colours instead of the water shader and the atlas, no shadows,
  // no assembly animation, and only the newest MINI_BUILDING_CAP buildings. The GLB parts
  // come from the same cache the live planet fills, so a building's mesh is parsed once for
  // the whole app however many worlds are showing it.
  var MINI_RADIUS = 1;            // every mini planet is built at radius 1 and then scaled
  var MINI_LAND_LIFT = 0.035;     // how far a claimed tile stands out of its sea
  var MINI_TILE_DEPTH = 0.07;     // the skirt under a tile, so land has a dirt side
  var MINI_BUILDING_CAP = 12;     // newest first; the rest of the world is still land
  var miniCache = {};             // signature -> built group, so re-entering the galaxy is free

  // Rebuild only when something you could actually see has changed.
  function miniSignature(journal, world) {
    return [journal.id, journal.theme || 'meadow',
      (world.planet && world.planet.frequency) || journal.frequency,
      (world.memories || []).length, (world.landscape || []).length,
      world.house && world.house.slot,
      (world.memories || []).map(function (m) { return m.asset && m.asset.key; }).join(',')
    ].join('|');
  }

  function buildMiniTiles(hexgrid, landSlots, theme) {
    var topLand = new THREE.Color(theme.land), topWater = new THREE.Color(theme.water);
    var sideLand = new THREE.Color(theme.landSide), sideWater = new THREE.Color(theme.waterSide);
    var positions = [];
    var colors = [];
    function vertex(p, c) {
      positions.push(p[0], p[1], p[2]);
      colors.push(c.r, c.g, c.b);
    }
    hexgrid.tiles.forEach(function (tile) {
      var isLand = landSlots.has(tile.id);
      var surface = MINI_RADIUS + (isLand ? MINI_LAND_LIFT : 0);
      var floor = MINI_RADIUS - MINI_TILE_DEPTH;
      var faceTop = isLand ? topLand : topWater;
      var faceSide = isLand ? sideLand : sideWater;
      var centre = tile.dir.map(function (c) { return c * surface; });
      for (var k = 0; k < tile.sides; k++) {
        var a = tile.corners[k];
        var b = tile.corners[(k + 1) % tile.sides];
        var t0 = a.map(function (c) { return c * surface; });
        var t1 = b.map(function (c) { return c * surface; });
        // Top: one fan triangle per edge, exactly as the real planet builds it.
        vertex(centre, faceTop); vertex(t0, faceTop); vertex(t1, faceTop);
        // Skirt: the same winding the real planet verified against the grid.
        var l0 = a.map(function (c) { return c * floor; });
        var l1 = b.map(function (c) { return c * floor; });
        vertex(t0, faceSide); vertex(l1, faceSide); vertex(t1, faceSide);
        vertex(t0, faceSide); vertex(l0, faceSide); vertex(l1, faceSide);
      }
    });
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true
    }));
  }

  // Everything a mini planet needs to know about a world, read off the save.
  function miniPlan(world) {
    var landSlots = new Set();
    var buildings = [];
    (world.landscape || []).forEach(function (entry) {
      if (typeof entry.slot === 'number') landSlots.add(entry.slot);
    });
    (world.memories || []).forEach(function (memory) {
      var slot = memory.placement && memory.placement.slot;
      if (typeof slot !== 'number') return;
      landSlots.add(slot);
      var key = memory.asset && memory.asset.key;
      buildings.push({
        slot: slot,
        file: key || null,
        // Saved worlds predate the pack field, and a model can move packs, so resolve the
        // folder from the catalogue rather than trusting what was written down.
        pack: key ? buildingSpec(key).pack : null,
        rotY: (memory.placement && memory.placement.rotY) || 0
      });
    });
    if (world.house && typeof world.house.slot === 'number') {
      landSlots.add(world.house.slot);
      buildings.push({
        slot: world.house.slot, file: world.house.asset, rotY: 0, house: true,
        pack: world.house.asset ? buildingSpec(world.house.asset).pack : null
      });
    }
    // Newest first, then capped: a busy world still reads as busy from its land.
    buildings.reverse();
    return { landSlots: landSlots, buildings: buildings.slice(0, MINI_BUILDING_CAP) };
  }

  // alignToCell reads its angle off a corner taken on the real globe, at RADIUS. A mini
  // planet is built at radius 1, so the corner has to be taken at ITS surface or the angle
  // comes out of a point far outside the tile and the building lands askew.
  function alignMiniToCell(obj, tile, surface) {
    obj.updateMatrixWorld(true);
    var corner = new THREE.Vector3().fromArray(tile.corners[0]).normalize().multiplyScalar(surface);
    var local = obj.worldToLocal(corner);
    obj.rotateY(KIT_VERTEX_ANGLE - Math.atan2(local.z, local.x));
    obj.updateMatrixWorld(true);
  }

  function buildMiniWorld(journal) {
    var world = MI.store.journalWorld(journal.id);
    if (!world) return Promise.resolve(null);
    var signature = miniSignature(journal, world);
    if (miniCache[signature]) return Promise.resolve(miniCache[signature].clone());

    var theme = MI.world.themes.get(journal.theme || 'meadow');
    var frequency = (world.planet && world.planet.frequency) || journal.frequency || 2;
    return loadGrid(frequency).then(function (hexgrid) {
      if (!hexgrid || !hexgrid.tiles) return null;
      var plan = miniPlan(world);
      var group = new THREE.Group();
      group.add(buildMiniTiles(hexgrid, plan.landSlots, theme));

      var byId = {};
      hexgrid.tiles.forEach(function (tile) { byId[tile.id] = tile; });
      var surface = MINI_RADIUS + MINI_LAND_LIFT;
      var jobs = plan.buildings.map(function (item) {
        var tile = byId[item.slot];
        if (!tile || !item.file) return Promise.resolve();
        return loadParts(packPath(item.pack) + item.file).then(function (parts) {
          if (!parts || !parts.length) return;
          var prop = buildFromParts(parts, false); // no hex base: the tile itself is the ground
          // tileApothem measures on the real globe, so bring it back to this unit sphere.
          // A building from another pack is modelled at its own size and carries a measured
          // correction, which the full-size planet applies too.
          var scale = (tileApothem(tile) / RADIUS) * 2 / KIT_TILE_WIDTH;
          scale *= buildingSpec(item.file).scale;
          prop.scale.setScalar(scale * (item.house ? HOUSE_SCALE : 1));
          MI.world.sphere.orientToSurface(prop, tile.dir, 0, surface - seatDepth(tile, surface));
          alignMiniToCell(prop, tile, surface);
          if (item.rotY) prop.rotateY(item.rotY);
          // Shadows are the expensive part of a prop and nothing here casts onto anything
          // you can see, so a mini planet turns them off.
          prop.traverse(function (node) {
            if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; }
          });
          group.add(prop);
        });
      });
      return Promise.all(jobs).then(function () {
        miniCache[signature] = group;
        return group.clone();
      });
    }).catch(function () { return null; });
  }

  // A cheap themed marble that shows the instant the galaxy opens; the real world replaces
  // it as soon as its grid and models are in, so entering space never waits on a load.
  function makeMiniPlaceholder(theme) {
    return new THREE.Mesh(
      new THREE.IcosahedronGeometry(MINI_RADIUS, 1),
      new THREE.MeshLambertMaterial({ color: theme.water, flatShading: true })
    );
  }

  function makeMiniPlanet(journal) {
    var theme = MI.world.themes.get(journal.theme || 'meadow');
    var group = new THREE.Group();
    // `spinner` is what tickGalaxy turns, so swapping the world in underneath it keeps the
    // planet rotating without a hitch.
    var spinner = new THREE.Group();
    var placeholder = makeMiniPlaceholder(theme);
    spinner.add(placeholder);
    group.add(spinner);
    group.add(new THREE.Mesh(
      new THREE.IcosahedronGeometry(MINI_RADIUS * 1.14, 2),
      new THREE.MeshBasicMaterial({
        color: theme.water, transparent: true, opacity: 0.2,
        side: THREE.BackSide, depthWrite: false
      })
    ));
    group.userData.journalId = journal.id;
    group.userData.journal = journal;

    buildMiniWorld(journal).then(function (world) {
      if (!world || !spinner.parent) return; // the galaxy closed while this was loading
      spinner.remove(placeholder);
      placeholder.geometry.dispose();
      placeholder.material.dispose();
      spinner.add(world);
    });
    return { group: group, ball: spinner };
  }

  function livePlanetRadius() {
    return RADIUS * (state.worldScale || 1);
  }

  function galaxyRingRadius(miniCount) {
    var live = state.galaxy.liveId ? livePlanetRadius() : 0;
    var n = Math.max(1, miniCount != null ? miniCount : state.galaxy.planets.length);
    return Math.max(live * 3.3, 9 + n * 0.9);
  }

  function galaxyCameraDistance() {
    var live = state.galaxy.liveId ? livePlanetRadius() : 1.2;
    var ring = galaxyRingRadius();
    return Math.max(24, ring * 2.05 + live * 1.4);
  }

  function clearGalaxyPlanets() {
    if (!state.galaxy || !state.galaxy.group) return;
    while (state.galaxy.group.children.length) {
      var child = state.galaxy.group.children[0];
      state.galaxy.group.remove(child);
      child.traverse(function (node) {
        if (node.geometry) node.geometry.dispose();
        if (node.material && node.material.dispose) node.material.dispose();
      });
    }
    state.galaxy.planets = [];
    state.galaxy.hoverId = null;
  }

  function setLivePlanetVisible(on) {
    if (state.planet) state.planet.visible = on;
    if (state.playerGroup) state.playerGroup.visible = on;
    if (state.satellite) state.satellite.visible = on && !(state.galaxy && state.galaxy.on);
    if (state.flatGroup) state.flatGroup.visible = on && !!state.flatMode;
  }

  function buildGalaxyPlanets(journals, liveId) {
    clearGalaxyPlanets();
    state.galaxy.liveId = liveId || null;
    state.galaxy.liveJournal = null;
    (journals || []).forEach(function (j) {
      if (j.id === liveId) state.galaxy.liveJournal = j;
    });
    var minis = (journals || []).filter(function (j) { return j.id !== liveId; });
    var ring = galaxyRingRadius(minis.length);
    var facing = state.camTheta || 0;
    minis.forEach(function (journal, i) {
      var made = makeMiniPlanet(journal);
      var count = Math.max(1, minis.length);
      // Spread the worlds across an arc on the far side of the live planet, never all the
      // way round it. Dividing a full circle put one world exactly at the camera's own angle
      // whenever there were two of them — behind you, unhoverable and unclickable, which is
      // the common case since most shelves hold two or three.
      var span = liveId
        ? Math.min(Math.PI * 1.5, 0.9 + count * 0.45)
        : Math.min(Math.PI * 1.15, 0.7 + count * 0.4);
      // Run the arc so the shelf reads LEFT TO RIGHT on screen. Sweeping the other way put
      // the first world on the right, which made the reorder arrows point the wrong way:
      // "move left" walked the world up the shelf and visibly to the right.
      var t = count <= 1 ? 0.5 : i / (count - 1);
      var angle = facing + Math.PI + span / 2 - span * t;
      var restY = Math.sin(i * 1.7 + 0.4) * 1.15;
      made.group.position.set(ring * Math.sin(angle), restY, ring * Math.cos(angle));
      var freq = journal.frequency || 2;
      var baseScale = 1.05 + Math.min(1.5, (freq - 2) * 0.14);
      made.group.scale.setScalar(0.0001);
      state.galaxy.group.add(made.group);
      state.galaxy.planets.push({
        id: journal.id,
        journal: journal,
        group: made.group,
        ball: made.ball,
        restY: restY,
        baseScale: baseScale,
        hover: 0,
        pop: 0,
        bounce: 0,
        spin: hash(idSeed(journal.id)) * Math.PI * 2,
        spinSpeed: 0.12 + hash(idSeed(journal.id) + 3) * 0.18
      });
    });
    state.galaxy.group.visible = true;
  }

  function setGalaxyHover(id) {
    if (!state.galaxy) return false;
    id = id || null;
    if (state.galaxy.hoverId === id) return false;
    state.galaxy.hoverId = id;
    return true;
  }

  function pickGalaxy(e, canvasEl) {
    if (!state || !state.galaxy || !state.galaxy.on) return null;
    var rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);
    if (state.galaxy.group && state.galaxy.group.visible) {
      var hits = raycaster.intersectObject(state.galaxy.group, true);
      for (var i = 0; i < hits.length; i++) {
        for (var node = hits[i].object; node; node = node.parent) {
          if (node.userData && node.userData.journalId) return node.userData.journalId;
        }
      }
    }
    if (state.galaxy.liveId && state.planet && state.planet.visible && state.planetMesh) {
      var liveHits = raycaster.intersectObject(state.planetMesh);
      if (liveHits.length) return state.galaxy.liveId;
    }
    return null;
  }

  function projectPoint(pos) {
    galaxyScreenTmp.copy(pos).project(state.camera);
    var el = state.renderer.domElement;
    return {
      x: (galaxyScreenTmp.x * 0.5 + 0.5) * el.clientWidth,
      y: (-galaxyScreenTmp.y * 0.5 + 0.5) * el.clientHeight,
      behind: galaxyScreenTmp.z > 1
    };
  }

  function pixelRadius(worldPos, worldR) {
    galaxyUpTmp.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
    galaxyEdgeTmp.copy(worldPos).addScaledVector(galaxyUpTmp, worldR);
    var c = projectPoint(worldPos);
    var e = projectPoint(galaxyEdgeTmp);
    return Math.max(16, Math.hypot(e.x - c.x, e.y - c.y));
  }

  function galaxyWorldPos(id, out) {
    out = out || galaxyPosTmp;
    var entry = galaxyEntry(id);
    if (entry) return entry.group.getWorldPosition(out);
    if (state.galaxy.liveId === id && state.planet) return state.planet.getWorldPosition(out);
    return null;
  }

  function galaxyWorldList() {
    var list = state.galaxy.planets.map(function (p) {
      return { id: p.id, pos: p.group.getWorldPosition(new THREE.Vector3()) };
    });
    if (state.galaxy.liveId && state.planet && state.planet.visible) {
      list.unshift({
        id: state.galaxy.liveId,
        pos: state.planet.getWorldPosition(new THREE.Vector3())
      });
    }
    return list;
  }

  function galaxyFocusDistance(id) {
    var r = 1.2;
    var entry = galaxyEntry(id);
    if (entry) r = entry.baseScale;
    else if (id === state.galaxy.liveId) r = livePlanetRadius();
    var ring = galaxyRingRadius();
    return Math.max(8.4, Math.min(ring * 1.4, r * 6.4 + 5.2));
  }

  function hopGalaxyFocus(id, options) {
    if (!state || !state.galaxy || !state.galaxy.on || !id) return;
    var opts = options || {};
    var dest = new THREE.Vector3();
    var entry = galaxyEntry(id);
    if (entry) {
      if (state.galaxy.group) state.galaxy.group.updateMatrixWorld(true);
      dest.set(entry.group.position.x, entry.restY, entry.group.position.z);
      if (state.galaxy.group) state.galaxy.group.localToWorld(dest);
    } else if (!galaxyWorldPos(id, dest)) {
      return;
    }
    state.galaxy.focusId = id;
    var toDist = galaxyFocusDistance(id);
    if (opts.instant || reduceMotion()) {
      state.camTarget.copy(dest);
      state.camDistance = toDist;
      state.galaxy.hop = null;
      state.updateCamera();
      return;
    }
    state.galaxy.hop = {
      from: state.camTarget.clone(),
      to: dest.clone(),
      fromDist: state.camDistance,
      toDist: toDist,
      start: performance.now(),
      dur: 620
    };
    if (entry) entry.bounce = 1;
    else if (id === state.galaxy.liveId) state.galaxy.liveBounce = 1;
  }

  function hopGalaxyInDirection(sx, sy) {
    var screens = galaxyScreens();
    var byId = {};
    screens.forEach(function (s) { byId[s.id] = s; });
    var worlds = galaxyWorldList().map(function (w) {
      var s = byId[w.id];
      return s ? { id: w.id, x: s.x, y: s.y, behind: s.behind, pos: w.pos } : w;
    });
    if (!worlds.length) return;
    var focusId = state.galaxy.focusId;
    var current = null;
    worlds.forEach(function (w) { if (w.id === focusId) current = w; });
    if (!current) current = worlds[0];
    if (worlds.length === 1) {
      hopGalaxyFocus(current.id);
      return;
    }
    var best = null, bestScore = -Infinity, wrap = null, wrapScore = Infinity;
    worlds.forEach(function (w) {
      if (w.id === current.id) return;
      var along, dist, fromScreen = w.x != null && current.x != null && !w.behind && !current.behind;
      if (fromScreen) {
        var dx = w.x - current.x;
        var dy = current.y - w.y;
        dist = Math.hypot(dx, dy) || 0.001;
        along = dx * sx + dy * sy;
      } else {
        state.camera.updateMatrixWorld();
        galaxyRightTmp.setFromMatrixColumn(state.camera.matrixWorld, 0).normalize();
        galaxyUpTmp.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
        var wx = w.pos.x - current.pos.x;
        var wy = w.pos.y - current.pos.y;
        var wz = w.pos.z - current.pos.z;
        along = wx * galaxyRightTmp.x * sx + wy * galaxyRightTmp.y * sx + wz * galaxyRightTmp.z * sx
          + wx * galaxyUpTmp.x * sy + wy * galaxyUpTmp.y * sy + wz * galaxyUpTmp.z * sy;
        dist = Math.sqrt(wx * wx + wy * wy + wz * wz) || 0.001;
      }
      if (along > dist * 0.08) {
        var score = along / dist - dist * (fromScreen ? 0.00025 : 0.015);
        if (score > bestScore) { bestScore = score; best = w; }
      }
      if (along < wrapScore) { wrapScore = along; wrap = w; }
    });
    hopGalaxyFocus((best || wrap || current).id);
  }

  function settleGalaxyFocus(journals, liveId, instant) {
    var keep = state.galaxy.focusId;
    var still = false;
    (journals || []).forEach(function (j) { if (j.id === keep) still = true; });
    var id = (still && keep) || liveId || (journals && journals[0] && journals[0].id) || null;
    if (id) hopGalaxyFocus(id, { instant: instant });
  }

  var GALAXY_MOVE = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0]
  };

  function handleGalaxyKey(e) {
    if (state.galaxy.busy) return true;
    var dir = GALAXY_MOVE[e.code];
    if (dir) {
      e.preventDefault();
      if (e.repeat) return true;
      hopGalaxyInDirection(dir[0], dir[1]);
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (e.repeat) return true;
      var id = state.galaxy.hoverId || state.galaxy.focusId;
      if (id && galaxyPickListener) galaxyPickListener(id);
      return true;
    }
    return false;
  }

  function galaxyScreens() {
    if (!state.galaxy || !state.galaxy.on) return [];
    var focusId = state.galaxy.focusId;
    var out = state.galaxy.planets.map(function (p) {
      var pos = p.group.getWorldPosition(galaxyScreenTmp.clone());
      var s = projectPoint(pos);
      s.id = p.id;
      s.journal = p.journal;
      s.hover = p.id === state.galaxy.hoverId;
      s.focus = p.id === focusId;
      s.r = pixelRadius(pos, p.baseScale * Math.max(0.0001, p.pop) * (1 + 0.28 * p.hover) * 1.14);
      return s;
    });
    if (state.galaxy.liveId && state.planet && state.planet.visible) {
      var livePos = state.planet.getWorldPosition(galaxyScreenTmp.clone());
      var live = projectPoint(livePos);
      live.id = state.galaxy.liveId;
      live.journal = state.galaxy.liveJournal;
      live.live = true;
      live.hover = state.galaxy.hoverId === state.galaxy.liveId;
      live.focus = state.galaxy.liveId === focusId;
      live.r = pixelRadius(livePos, livePlanetRadius() * (1 + 0.14 * (state.galaxy.liveHover || 0)));
      out.unshift(live);
    }
    return out;
  }

  function tickGalaxy(dt) {
    if (!state || !state.galaxy || !state.galaxy.on) return;
    if (state.galaxy.hop && state.galaxy.hop.start != null) {
      var hop = state.galaxy.hop;
      var u = Math.min(1, (performance.now() - hop.start) / hop.dur);
      var e = easeOutBackSoft(Math.max(0, u));
      state.camTarget.lerpVectors(hop.from, hop.to, e);
      state.camDistance = hop.fromDist + (hop.toDist - hop.fromDist) * easeInOut(Math.max(0, u));
      state.updateCamera();
      if (u >= 1) {
        state.camTarget.copy(hop.to);
        state.camDistance = hop.toDist;
        state.galaxy.hop = null;
        state.updateCamera();
      }
    }
    if (state.galaxy.busy) {
      if (galaxyFrameListener) galaxyFrameListener(galaxyScreens());
      return;
    }
    var hoverEase = Math.min(1, dt * 8);
    state.galaxy.planets.forEach(function (p) {
      p.spin += dt * p.spinSpeed;
      p.ball.rotation.y = p.spin;
      var want = (p.id === state.galaxy.hoverId || p.id === state.galaxy.focusId) ? 1 : 0;
      p.hover += (want - p.hover) * hoverEase;
      if (p.bounce > 0) p.bounce = Math.max(0, p.bounce - dt * 2.4);
      var bounce = Math.sin((p.bounce || 0) * Math.PI) * p.baseScale * 0.32;
      var s = p.baseScale * Math.max(0.0001, p.pop) * (1 + 0.22 * p.hover);
      p.group.scale.setScalar(s);
      p.group.position.y = p.restY + 0.28 * p.baseScale * p.hover + bounce;
    });
    var liveHot = state.galaxy.liveId &&
      (state.galaxy.hoverId === state.galaxy.liveId || state.galaxy.focusId === state.galaxy.liveId);
    var liveWant = liveHot ? 1 : 0;
    state.galaxy.liveHover += (liveWant - (state.galaxy.liveHover || 0)) * hoverEase;
    if (state.galaxy.liveBounce > 0) {
      state.galaxy.liveBounce = Math.max(0, state.galaxy.liveBounce - dt * 2.4);
    }
    if (state.planet && state.galaxy.liveId && state.planet.visible) {
      var liveBounce = Math.sin((state.galaxy.liveBounce || 0) * Math.PI) * livePlanetRadius() * 0.28;
      state.planet.scale.setScalar(state.worldScale * (1 + 0.1 * state.galaxy.liveHover));
      state.planet.position.y = 0.18 * (state.galaxy.liveHover || 0) + liveBounce;
    }
    if (galaxyFrameListener) galaxyFrameListener(galaxyScreens());
  }

  function enterGalaxy(journals, options) {
    if (!state) return Promise.resolve();
    if (state.hub && state.hub.on) {
      return leaveHub({ instant: true }).then(function () { return enterGalaxy(journals, options); });
    }
    var opts = options || {};
    var liveId = opts.currentId || null;
    state.galaxy.busy = false;
    if (state.flatMode) {
      return setFlatView(false, { instant: true }).then(function () {
        return enterGalaxy(journals, opts);
      });
    }
    if (state.galaxy.on && state.galaxy.mix > 0.95) {
      buildGalaxyPlanets(journals, liveId);
      setLivePlanetVisible(!!liveId);
      if (state.satellite) state.satellite.visible = false;
      if (opts.instant || reduceMotion()) {
        state.galaxy.planets.forEach(function (p) { p.pop = 1; });
        settleGalaxyFocus(journals, liveId, true);
        return Promise.resolve();
      }
      return animateP(520, function (t) {
        state.galaxy.planets.forEach(function (p, i) {
          var popT = (t - i * 0.06) / 0.55;
          p.pop = popT <= 0 ? 0 : (popT >= 1 ? 1 : easeOutBack(popT));
        });
      }).then(function () {
        settleGalaxyFocus(journals, liveId);
      });
    }
    state.galaxy.on = true;
    buildGalaxyPlanets(journals, liveId);
    setLivePlanetVisible(!!liveId);
    if (state.satellite) state.satellite.visible = false;
    var fromDist = state.camDistance;
    var toDist = galaxyCameraDistance();
    var fromMix = state.galaxy.mix || 0;
    state.galaxy.saved = {
      dist: opts.savedDist || fromDist,
      theta: state.camTheta,
      phi: state.camPhi
    };
    state.camTarget.set(0, 0, 0);
    function finish(t) {
      var e = t;
      state.galaxy.mix = fromMix + (1 - fromMix) * e;
      state.camDistance = fromDist + (toDist - fromDist) * e;
      applyGalaxyLighting(state.galaxy.mix);
      state.galaxy.planets.forEach(function (p, i) {
        var popT = (e - 0.28 - i * 0.07) / 0.4;
        p.pop = popT <= 0 ? 0 : (popT >= 1 ? 1 : easeOutBack(popT));
      });
      state.updateCamera();
    }
    if (opts.instant || reduceMotion()) {
      finish(1);
      settleGalaxyFocus(journals, liveId, true);
      return Promise.resolve();
    }
    return animateP(1400, function (t) { finish(easeInOut(t)); }).then(function () {
      settleGalaxyFocus(journals, liveId);
    });
  }

  function leaveGalaxy(options) {
    if (!state || !state.galaxy || !state.galaxy.on) return Promise.resolve();
    var opts = options || {};
    var saved = state.galaxy.saved || {};
    var fromDist = state.camDistance;
    var toDist = opts.dist || (opts.fit ? cameraRange().rest : null) || saved.dist || cameraRange().rest;
    var fromMix = state.galaxy.mix || 0;
    var fromTarget = state.camTarget.clone();
    state.galaxy.hoverId = null;
    state.galaxy.busy = true;
    setLivePlanetVisible(true);
    if (state.satellite) state.satellite.visible = false;
    function finish(t) {
      var e = t;
      state.galaxy.mix = fromMix * (1 - e);
      state.camDistance = fromDist + (toDist - fromDist) * e;
      state.camTarget.copy(fromTarget).lerp(new THREE.Vector3(), e);
      applyGalaxyLighting(state.galaxy.mix);
      state.galaxy.planets.forEach(function (p) {
        p.pop = Math.max(0, p.pop * (1 - e));
      });
      if (state.satellite) state.satellite.visible = e > 0.55;
      state.updateCamera();
    }
    function teardown() {
      finish(1);
      clearGalaxyPlanets();
      state.galaxy.group.visible = false;
      state.galaxy.on = false;
      state.galaxy.mix = 0;
      state.galaxy.liveId = null;
      state.galaxy.liveHover = 0;
      state.galaxy.liveBounce = 0;
      state.galaxy.saved = null;
      state.galaxy.busy = false;
      state.galaxy.focusId = null;
      state.galaxy.hop = null;
      if (state.planet) {
        state.planet.scale.setScalar(state.worldScale);
        state.planet.position.y = 0;
      }
      setLivePlanetVisible(true);
      applyLighting();
      state.camTarget.set(0, 0, 0);
      state.camDistance = toDist;
      state.updateCamera();
    }
    if (opts.instant || reduceMotion()) {
      teardown();
      return Promise.resolve();
    }
    return animateP(1100, function (t) { finish(easeInOut(t)); }).then(teardown);
  }

  function galaxyEntry(id) {
    var found = null;
    if (!state || !state.galaxy) return null;
    state.galaxy.planets.forEach(function (p) {
      if (p.id === id) found = p;
    });
    return found;
  }

  function focusGalaxyPlanet(id) {
    if (!state || !state.galaxy || !state.galaxy.on || !id) return Promise.resolve();
    var target = new THREE.Vector3();
    var entry = galaxyEntry(id);
    if (entry) entry.group.getWorldPosition(target);
    else target.set(0, 0, 0);
    setGalaxyHover(id);
    var fromTarget = state.camTarget.clone();
    var fromDist = state.camDistance;
    var toDist = Math.max(5.5, fromDist * 0.38);
    return animateP(reduceMotion() ? 1 : 720, function (t) {
      var e = easeInOut(t);
      state.camTarget.copy(fromTarget).lerp(target, e);
      state.camDistance = fromDist + (toDist - fromDist) * e;
      if (entry) entry.hover = e;
      state.updateCamera();
    });
  }

  // Fly up to a chosen journal, send the others away, and if it is a miniature pull it
  // into the middle so leaveGalaxy can dive from space into the real planet.
  function selectGalaxyPlanet(id) {
    if (!state || !state.galaxy || !state.galaxy.on || !id) return Promise.resolve();
    var entry = galaxyEntry(id);
    var isLive = state.galaxy.liveId === id;
    state.galaxy.busy = true;
    setGalaxyHover(id);
    var dest = new THREE.Vector3();
    if (entry) entry.group.getWorldPosition(dest);
    else dest.set(0, 0, 0);
    var fromTarget = state.camTarget.clone();
    var fromDist = state.camDistance;
    var closeDist = isLive
      ? Math.max(livePlanetRadius() * 4.4, 6.2)
      : Math.max(4.6, entry ? entry.baseScale * 3.4 : 5.5);
    var flyMs = reduceMotion() ? 1 : 860;
    return animateP(flyMs, function (t) {
      var e = easeInOut(t);
      state.camTarget.copy(fromTarget).lerp(dest, e);
      state.camDistance = fromDist + (closeDist - fromDist) * e;
      if (entry) {
        entry.hover = e;
        entry.pop = 1;
      }
      state.galaxy.planets.forEach(function (p) {
        if (p.id === id) return;
        p.pop = Math.max(0, 1 - e * 1.35);
      });
      if (isLive && state.planet) {
        state.galaxy.liveHover = e;
        state.planet.scale.setScalar(state.worldScale * (1 + 0.1 * e));
      }
      state.updateCamera();
    }).then(function () {
      if (isLive || !entry || reduceMotion()) return Promise.resolve();
      var fromPos = entry.group.position.clone();
      var fromT = state.camTarget.clone();
      var fromD = state.camDistance;
      var midD = Math.max(5.4, fromD * 0.82);
      return animateP(560, function (t) {
        var e = easeInOut(t);
        entry.group.position.copy(fromPos).multiplyScalar(1 - e);
        state.camTarget.copy(fromT).lerp(new THREE.Vector3(), e);
        state.camDistance = fromD + (midD - fromD) * e;
        entry.hover = 1;
        state.updateCamera();
      });
    });
  }

  function isGalaxy() {
    return !!state && !!state.galaxy && state.galaxy.on;
  }

  function startLoop() {
    var lastFrame = 0;
    (function loop(timestampMs) {
      requestAnimationFrame(loop);
      var now = timestampMs || 0;
      var dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      state.material.userData.waterUniforms.uTime.value = now / 1000;
      if (state.islandWaterMaterial) {
        state.islandWaterMaterial.userData.waterUniforms.uTime.value = now / 1000;
      }
      animateWater(now / 1000);
      animateSatellite(now / 1000);
      // A figure can only be driven when it has ground to stand on: not mid-fold, and not
      // while the hub has taken the planet off screen.
      var figuresLive = !state.transition && !(state.hub && state.hub.on);
      if (figuresLive) updateWalkers(dt);
      updateHubMarker(now);
      updateShips(dt); // hides itself mid-fold rather than freezing, so a ship never lands ashore
      if (figuresLive) updatePlayer(dt);
      if (!state.transition && state.hub && state.hub.on) updateHub(dt);
      // Hidden for as long as the tiles are in flight, and shown again only below an update
      // tick that has already put them back on the ground -- never in the same frame they
      // were still frozen in. Re-applied every frame, so a resident who spawns mid-fold is
      // caught too.
      if (state.folding) hideFigures();
      else if (figuresLive) showFigures();
      notifyLookMemory();
      pollHubApproach();
      if (state.pollHover) state.pollHover();
      tickGalaxy(dt);
      state.spinners.forEach(function (group) { spinRotors(group, dt); });
      // An animation that throws must not take the renderer down with it. Before this, one
      // bad step aborted the whole frame BEFORE render() and left itself in the queue, so it
      // threw again on every frame after — the picture froze for good. Drop it and carry on.
      for (var i = animations.length - 1; i >= 0; i--) {
        var finished;
        try {
          finished = animations[i](now);
        } catch (err) {
          console.error('animation step failed; dropping it', err);
          finished = true;
        }
        if (finished) animations.splice(i, 1);
      }
      state.renderer.render(state.scene, state.camera);
    })();
  }

  // Rigid per-tile bob along its own outward normal — a traveling-looking swell rather
  // than uniform breathing, from a phase based on each tile's position on the sphere.
  // flatShading derives face normals from screen-space derivatives, not the stored
  // normal attribute, so this doesn't need computeVertexNormals() every frame.
  function animateWater(timeSeconds) {
    var posAttr = state.geometry.attributes.position;
    state.waterTileIds.forEach(function (id) {
      var tile = state.tiles[id];
      var range = state.tileVertexRange[id];
      var phase = (tile.dir[0] + tile.dir[2]) * 2.5;
      var offset = WAVE_AMPLITUDE * Math.sin(timeSeconds * WAVE_SPEED + phase);
      for (var i = 0; i < range[1]; i++) {
        var vi = (range[0] + i) * 3;
        posAttr.array[vi] = state.restPositions[vi] + tile.dir[0] * offset;
        posAttr.array[vi + 1] = state.restPositions[vi + 1] + tile.dir[1] * offset;
        posAttr.array[vi + 2] = state.restPositions[vi + 2] + tile.dir[2] * offset;
      }
    });
    posAttr.needsUpdate = true;
  }

  // --- Friend hub ---------------------------------------------------------------------
  // A walkable plaza of every character look, entered from the village hall on the world
  // (click in orbit, walk up in follow) or from settings. Models are the real Mini
  // Characters; swapping writes player.character and, when a friend already wears that
  // look, trades appearance.model with them.
  var hubPickListener = null;
  var hubChangeListener = null;
  var HUB_CAM_OFFSET = new THREE.Vector3(4.1, 5.4, 4.7);
  var HUB_CLICK_REACH = 2.8;

  function isHub() {
    return !!state && !!state.hub && state.hub.on;
  }

  function hubSlot() {
    if (!MI.store) return null;
    var world = MI.store.get();
    return world.hub && typeof world.hub.slot === 'number' ? world.hub.slot : null;
  }

  function isHubBuildingSlot(slot) {
    if (slot === null || slot === undefined) return false;
    return hubSlot() === slot;
  }

  function notifyHub() {
    if (hubChangeListener) hubChangeListener(isHub());
  }

  function hubIsLand(p) {
    // One disk, not a circle per hex: inscribed circles leave gaps at the hex corners,
    // which is what made walking seize up in some directions.
    var r = state.hub && state.hub.radius;
    if (!r) return false;
    return p.x * p.x + p.z * p.z <= r * r;
  }

  function clearHubScene() {
    if (!state || !state.hub) return;
    if (state.hub.player && state.hub.player.animator) state.hub.player.animator.dispose();
    state.hub.player = null;
    (state.hub.figures || []).forEach(function (fig) {
      if (fig.animator) fig.animator.dispose();
      disposeNameTag(fig.group);
    });
    state.hub.figures = [];
    state.hub.blockers = [];
    state.hub.centres = [];
    state.hub.hoverId = null;
    if (!state.hub.group) return;
    while (state.hub.group.children.length) {
      state.hub.group.remove(state.hub.group.children[0]);
    }
  }

  function placeHubFigures() {
    var list = MI.world.hub.looks();
    var spots = MI.world.hub.figureSpots(list.length, FLAT_SPACING);
    var scale = FLAT_MODEL_SCALE * PLAYER_FLAT_SCALE;
    return Promise.all(list.map(function (look, i) {
      var spot = spots[i];
      if (!spot) return null;
      return MI.world.walkers.makeModel(look.model).then(function (model) {
        if (!state || !state.hub.on) return;
        var mesh = model || makePersonModel(look.color);
        var holder = new THREE.Group();
        holder.add(mesh);
        holder.position.set(spot.x, state.hub.groundY, spot.z);
        holder.scale.setScalar(scale);
        holder.rotation.y = spot.yaw;
        holder.userData.tag = { type: 'hub-look', id: look.id };
        state.hub.group.add(holder);
        state.hub.figures.push({
          id: look.id,
          group: holder,
          animator: MI.world.walkers.makeAnimator(mesh),
          spot: spot
        });
      });
    })).then(function () {
      retagHubFigures();
    });
  }

  function retagHubFigures() {
    if (!state || !state.hub) return;
    var world = MI.store.get();
    (state.hub.figures || []).forEach(function (fig) {
      var info = MI.world.hub.inspect(world, fig.id);
      setNameTag(fig.group, info && info.person ? info.person.name : '');
    });
  }

  function placeHubPlayer() {
    var start = MI.world.hub.playerStart(FLAT_SPACING);
    var id = state.characterId || MI.world.player.defaultId();
    var p = MI.world.player.newPlayer();
    return MI.world.player.makeAvatar(id, makePersonModel).then(function (model) {
      if (!state || !state.hub.on || !model) return;
      if (state.hub.player && state.hub.player.group && state.hub.player.group.parent) {
        if (state.hub.player.animator) state.hub.player.animator.dispose();
        state.hub.group.remove(state.hub.player.group);
      }
      var holder = new THREE.Group();
      holder.add(model);
      p.group = holder;
      p.animator = MI.world.walkers.makeAnimator(model);
      p.x = start.x;
      p.z = start.z;
      p.heading = start.heading;
      p.groundY = state.hub.groundY;
      p.placed = true;
      state.hub.group.add(holder);
      state.hub.player = p;
      state.hub.groundForward = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    });
  }

  function buildHubScene() {
    clearHubScene();
    var cells = MI.world.hub.plazaCells();
    var centres = cells.map(function (cell) { return MI.island.toXZ(cell, FLAT_SPACING); });
    state.hub.centres = centres;
    var spread = 0;
    centres.forEach(function (c) {
      spread = Math.max(spread, Math.sqrt(c.x * c.x + c.z * c.z));
    });
    // Cover the outer hexes' corners, but stop short of stepping off the grass rim.
    state.hub.radius = spread + FLAT_TILE_RADIUS * 0.9;
    state.hub.groundY = FLAT_BASE_Y + TILE_TOP_DEFAULT * FLAT_MODEL_SCALE;
    var grassUrl = HEX_PACK + 'grass.glb';
    var houseUrl = HEX_PACK + 'building-house.glb';
    return Promise.all([loadParts(grassUrl), loadParts(houseUrl)]).then(function (pack) {
      if (!state || !state.hub.on) return;
      var grassParts = pack[0], houseParts = pack[1];
      cells.forEach(function (cell, idx) {
        var c = centres[idx];
        var isHouse = cell.i === 0 && cell.j === 0;
        var parts = isHouse && houseParts ? houseParts : grassParts;
        if (!parts) return;
        var obj = buildFromParts(parts, true);
        obj.scale.setScalar(FLAT_MODEL_SCALE * (isHouse ? 1.18 : 1));
        obj.rotation.y = Math.PI / 3;
        obj.position.set(c.x, FLAT_BASE_Y, c.z);
        obj.userData.tag = { type: 'hub-tile', house: isHouse };
        state.hub.group.add(obj);
        if (isHouse) {
          // Kit house GLBs include the garden (trees, fence, logs). Tracing that whole
          // footprint walled off the path around the house. A modest pad on the cottage
          // itself is enough to walk around it.
          state.hub.blockers.push({
            x: c.x, z: c.z, hx: 0.55, hz: 0.55, cos: 1, sin: 0
          });
        }
      });
      return placeHubFigures();
    }).then(function () {
      if (!state || !state.hub.on) return;
      return placeHubPlayer();
    });
  }

  function hubCameraAxes() {
    var up = new THREE.Vector3(0, 1, 0);
    var dir = state.camera.getWorldDirection(new THREE.Vector3());
    var forward = MI.world.player.tangent(dir, up);
    if (!forward) {
      forward = (state.hub.groundForward && state.hub.groundForward.clone())
        || new THREE.Vector3(0, 0, 1);
    }
    var right = new THREE.Vector3().crossVectors(forward, up).normalize();
    return { forward: forward, right: right };
  }

  function updateHubCamera() {
    var p = state.hub && state.hub.player;
    if (!p || !state.hub.camOffset) return;
    var target = new THREE.Vector3(p.x, state.hub.groundY + 0.55, p.z);
    state.camera.up.set(0, 1, 0);
    state.camera.position.copy(target).add(state.hub.camOffset);
    state.camera.lookAt(target);
    state.camTarget.copy(target);
  }

  function setHubHover(id) {
    if (!state || !state.hub) return;
    if (state.hub.hoverId === id) return;
    state.hub.hoverId = id;
    var base = FLAT_MODEL_SCALE * PLAYER_FLAT_SCALE;
    state.hub.figures.forEach(function (fig) {
      fig.group.scale.setScalar(fig.id === id ? base * 1.12 : base);
    });
  }

  function pickHubLook(e, canvasEl, anyDistance) {
    if (!state || !state.hub || !state.hub.on || !state.hub.group) return null;
    var rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);
    var hits = raycaster.intersectObject(state.hub.group, true);
    var found = null;
    for (var i = 0; i < hits.length; i++) {
      for (var node = hits[i].object; node; node = node.parent) {
        if (node.userData && node.userData.tag && node.userData.tag.type === 'hub-look') {
          found = node.userData.tag.id;
          break;
        }
      }
      if (found) break;
    }
    if (!found || anyDistance) return found;
    var fig = null;
    for (var f = 0; f < state.hub.figures.length; f++) {
      if (state.hub.figures[f].id === found) fig = state.hub.figures[f];
    }
    var p = state.hub.player;
    if (!fig || !p) return null;
    var dx = p.x - fig.spot.x, dz = p.z - fig.spot.z;
    if (dx * dx + dz * dz > HUB_CLICK_REACH * HUB_CLICK_REACH) return null;
    return found;
  }

  function updateHub(dt) {
    var p = state.hub && state.hub.player;
    if (!p || !p.group) return;
    var input = { forward: 0, strafe: 0 };
    function down(k) { return state.keys.wasd[k] || state.keys.arrows[k]; }
    if (down('w')) input.forward += 1;
    if (down('s')) input.forward -= 1;
    if (down('d')) input.strafe += 1;
    if (down('a')) input.strafe -= 1;
    var axes = hubCameraAxes();
    var clear = MI.world.player.pushOut({ x: p.x, z: p.z }, state.hub.blockers, PLAYER_RADIUS);
    if (clear) { p.x = clear.x; p.z = clear.z; }
    var rad = state.hub.radius;
    if (rad) {
      var dist = Math.sqrt(p.x * p.x + p.z * p.z);
      if (dist > rad && dist > 1e-6) {
        p.x *= rad / dist;
        p.z *= rad / dist;
      }
    }
    MI.world.player.updateFlat(p, dt, {
      forward: axes.forward, right: axes.right, input: input,
      isLandAt: hubIsLand,
      blockers: state.hub.blockers, blockerRadius: PLAYER_RADIUS,
      speed: MI.world.player.TILES_PER_SECOND * FLAT_SPACING,
      baseY: state.hub.groundY,
      scale: FLAT_MODEL_SCALE * PLAYER_FLAT_SCALE
    });
    state.hub.figures.forEach(function (fig) {
      if (fig.animator) fig.animator.update(dt, 0);
    });
    updateHubCamera();
  }

  function hubApproach() {
    if (!state || !state.flatMode || state.camMode !== 'ground') return false;
    if (!MI.store) return false;
    var world = MI.store.get();
    if (!world.hub || !state.island || !state.island.centres) return false;
    var c = state.island.centres[world.hub.slot];
    var p = state.players && state.players.flat;
    if (!c || !p || !p.placed) return false;
    var dx = p.x - c.x, dz = p.z - c.z;
    // Near the hall's wall, but reachable outside its solid footprint.
    var reach = FLAT_SPACING * 0.72;
    return dx * dx + dz * dz < reach * reach;
  }

  function pollHubApproach() {
    if (!state || !state.hub || state.hub.on || state.hub.busy || state.transition) return;
    var near = hubApproach();
    if (near && state.hub.autoArmed) {
      state.hub.autoArmed = false;
      enterHub();
      return;
    }
    if (!near) state.hub.autoArmed = true;
  }

  function enterHub() {
    if (!state || state.hub.on || state.hub.busy) return Promise.resolve(false);
    if (state.galaxy && state.galaxy.on) return Promise.resolve(false);
    if (state.transition || state.camMode === 'tween') return Promise.resolve(false);
    state.hub.busy = true;
    var cover = MI.ui && MI.ui.beginTravel ? MI.ui.beginTravel('Entering the friend hub…')
      : Promise.resolve();
    return cover.then(function () {
      return isGroundView() ? setGroundView(false) : Promise.resolve();
    }).then(function () {
      if (!state) return false;
      state.hub.saved = {
        flatMode: state.flatMode,
        dist: state.camDistance,
        theta: state.camTheta,
        phi: state.camPhi,
        target: state.camTarget.clone(),
        planetVisible: state.planet.visible,
        flatVisible: state.flatGroup.visible,
        starsVisible: !!(state.stars && state.stars.visible)
      };
      state.planet.visible = false;
      state.flatGroup.visible = false;
      if (state.satellite) state.satellite.visible = false;
      if (state.stars) state.stars.visible = false;
      applyViewLighting(1);
      state.hub.on = true;
      state.hub.group.visible = true;
      state.camMode = 'hub';
      state.hub.camOffset = HUB_CAM_OFFSET.clone();
      clearKeys();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      notifyHub();
      return buildHubScene();
    }).then(function () {
      if (!state) return false;
      updateHubCamera();
      state.hub.busy = false;
      if (MI.ui && MI.ui.endTravel) MI.ui.endTravel();
      return true;
    }).catch(function (err) {
      console.error('[hub] failed to enter', err);
      if (MI.ui && MI.ui.endTravel) MI.ui.endTravel();
      if (state) {
        state.hub.busy = false;
        state.hub.on = false;
        state.camMode = 'orbit';
        if (state.hub.group) state.hub.group.visible = false;
        notifyHub();
      }
      return false;
    });
  }

  function leaveHub(options) {
    if (!state || !state.hub || !state.hub.on) return Promise.resolve();
    var opts = options || {};
    if (!opts.instant && MI.ui && MI.ui.beginTravel) {
      return MI.ui.beginTravel('Returning to your planet…').then(function () {
        return leaveHub({ instant: true });
      }).then(function () {
        MI.ui.endTravel();
      });
    }
    var saved = state.hub.saved || {};
    state.hub.on = false;
    state.hub.busy = false;
    state.hub.autoArmed = false;
    state.hub.group.visible = false;
    clearHubScene();
    state.planet.visible = saved.planetVisible !== undefined ? saved.planetVisible : !saved.flatMode;
    state.flatGroup.visible = saved.flatVisible !== undefined ? saved.flatVisible : !!saved.flatMode;
    if (state.stars) state.stars.visible = saved.starsVisible !== false && !saved.flatMode;
    if (state.satellite) state.satellite.visible = true;
    applyViewLighting(saved.flatMode ? 1 : 0);
    state.camMode = 'orbit';
    if (typeof saved.dist === 'number') state.camDistance = saved.dist;
    if (typeof saved.theta === 'number') state.camTheta = saved.theta;
    if (typeof saved.phi === 'number') state.camPhi = saved.phi;
    if (saved.target) state.camTarget.copy(saved.target);
    state.camera.up.set(0, 1, 0);
    state.updateCamera();
    clearKeys();
    notifyHub();
    if (opts.instant || reduceMotion()) return Promise.resolve();
    return Promise.resolve();
  }

  function applyHubSwap(lookId) {
    if (!state) return Promise.resolve({ ok: false });
    var world = MI.store.get();
    var result = MI.world.hub.swap(world, lookId);
    if (!result.ok) return Promise.resolve(result);
    MI.store.save();
    var jobs = [setCharacter(world.player.character)];
    if (result.person) jobs.push(spawnPerson(result.person, { animate: true }));
    return Promise.all(jobs).then(function () {
      if (state.hub && state.hub.on) {
        retagHubFigures();
        var keep = state.hub.player
          ? { x: state.hub.player.x, z: state.hub.player.z, heading: state.hub.player.heading }
          : null;
        return placeHubPlayer().then(function () {
          if (keep && state.hub.player) {
            state.hub.player.x = keep.x;
            state.hub.player.z = keep.z;
            state.hub.player.heading = keep.heading;
          }
          return result;
        });
      }
      return result;
    });
  }

  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  function pickSlot(e, canvasEl) {
    if (!state) return null;
    var rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);

    if (state.flatMode) {
      // Flat tiles are whole models, so the hit lands on some mesh deep inside a tile
      // group — walk back up to whichever ancestor carries the slot tag.
      var flatHits = raycaster.intersectObject(state.flatGroup, true);
      for (var i = 0; i < flatHits.length; i++) {
        for (var node = flatHits[i].object; node; node = node.parent) {
          if (node.userData && node.userData.tag) return node.userData.tag.slot;
        }
      }
      return null;
    }

    if (!state.planetMesh) return null;
    var hits = raycaster.intersectObject(state.planetMesh);
    if (!hits.length) return null;
    return state.faceToTileId[hits[0].faceIndex];
  }

  // A ship under the pointer, if there is one. Asked BEFORE pickSlot by whoever handles the
  // click: a ship stands proud of the sea it is on, so hitting the water tile underneath it
  // and opening nothing would feel broken.
  function pickShip(e, canvasEl) {
    if (!state || state.flatMode || !state.shipGroup) return null;
    var rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);
    var hits = raycaster.intersectObject(state.shipGroup, true);
    for (var i = 0; i < hits.length; i++) {
      for (var node = hits[i].object; node; node = node.parent) {
        if (node.userData && node.userData.tag && node.userData.tag.type === 'ship') {
          return node.userData.tag.id;
        }
      }
    }
    return null;
  }

  // Turns the camera to whichever stretch of ocean a ship is currently on, so "your ship is
  // ready" can actually show you the ship.
  function focusShip(shipId) {
    var live = state.shipWalkers && state.shipWalkers[shipId];
    var tile = shipTileOf(live);
    if (tile === null || tile === undefined) return false;
    focus(tile);
    return true;
  }

  MI.world.init = init;
  MI.world.spawnMemory = spawnMemory;
  MI.world.spawnPerson = spawnPerson;
  MI.world.despawnPerson = despawnPerson;
  MI.world.focus = focus;
  MI.world.onPick = onPick;
  MI.world.onShipPick = onShipPick;
  MI.world.onHover = onHover;
  MI.world.highlightSlot = highlightSlot;
  MI.world.clearHighlight = clearHighlight;
  MI.world.highlightedSlot = highlightedSlot;
  MI.world.setFlatView = setFlatView;
  MI.world.isFlatView = isFlatView;
  MI.world.isTransitioning = isTransitioning;
  // Exposed because they're pure and worth testing without a GPU.
  MI.world.computeRoadEdges = computeRoadEdges;
  MI.world.rebuildRoads = rebuildRoads;
  MI.world.refreshRoads = function () {
    rebuildRoads();
    return state && state.flatMode ? refreshFlatView() : Promise.resolve();
  };
  MI.world.roadConnections = roadConnections;
  MI.world.clear = clear;
  MI.world.pickAssetFor = pickAssetFor;
  MI.world.buildingsFor = buildingsFor;
  MI.world.assetFor = assetFor;
  MI.world.respawnMemory = respawnMemory;
  MI.world.pickTerrainFor = pickTerrainFor;
  MI.world.landscapeCountFor = landscapeCountFor;
  MI.world.spawnLandscape = spawnLandscape;
  MI.world.spawnHouse = spawnHouse;
  MI.world.spawnHub = spawnHub;
  MI.world.personColor = personColor;
  MI.world.syncShips = syncShips;
  MI.world.focusShip = focusShip;
  // Test hooks (scripts/ and the browser console): the island layout, the planet scale
  // and a way to swing the camera without a mouse.
  MI.world.__island = function () { return state && state.island; };
  MI.world.__scene = function () { return state && state.scene; };
  MI.world.__cam = function () { return state && state.camera; };
  MI.world.__satellite = function () {
    if (!state || !state.satellite) return null;
    var p = state.satellite.getWorldPosition(new THREE.Vector3());
    return { x: p.x, y: p.y, z: p.z, scale: state.satellite.scale.x, visible: state.satellite.visible, mix: state.viewMix };
  };
  // The walking pet, per view: the sphere instance and (once the island exists) the flat
  // one, in world space. Two entries, not one, because a pet wanders each view separately.
  MI.world.__pet = function () {
    if (!state || !state.petWalkers) return null;
    var out = {};
    ['sphere', 'flat'].forEach(function (view) {
      var group = state.petWalkers[view].group;
      var p = group.getWorldPosition(new THREE.Vector3());
      out[view] = {
        x: p.x, y: p.y, z: p.z, scale: group.scale.x,
        visible: group.visible && !!group.parent, tile: state.petWalkers[view].tileId,
        // Its own flag says nothing on its own: the flat instance sits inside flatGroup,
        // which is hidden for the whole of the planet view. `shown` is whether it is
        // actually being drawn -- the only form of the question a fold check can use.
        shown: MI.world.walkers.isShown(group)
      };
    });
    return out;
  };
  // World point -> canvas pixels, for cropping a screenshot in on something small. The
  // browser checks in docs/HANDOFF.md are the only caller: a state assertion will happily
  // pass on something that is off screen or a pixel wide, so they zoom in and look.
  MI.world.__screen = function (p) {
    if (!state) return null;
    var v = new THREE.Vector3(p.x, p.y, p.z).project(state.camera);
    var c = state.renderer.domElement;
    return { x: (v.x * 0.5 + 0.5) * c.clientWidth, y: (-v.y * 0.5 + 0.5) * c.clientHeight, depth: v.z };
  };
  // Your character: where it is in world space and what it is standing on. Available in
  // every view, since the character is always there.
  MI.world.__player = function () {
    if (!state) return null;
    var p = activePlayer();
    if (!p || !p.group || !p.placed) return null;
    var w = p.group.getWorldPosition(new THREE.Vector3());
    return {
      x: w.x, y: w.y, z: w.z, moving: p.moving,
      heading: state.flatMode ? p.heading : p.facing.toArray(),
      view: state.flatMode ? 'flat' : 'sphere',
      slot: state.flatMode ? null : MI.world.sphere.nearestSlot(p.dir),
      onLand: state.flatMode ? flatIsLand({ x: p.x, z: p.z }) : sphereIsLand(p.dir),
      character: state.characterId, mode: state.camMode, visible: p.group.visible,
      shown: MI.world.walkers.isShown(p.group),
      ground: p.groundY, island: state.flatMode ? { x: p.x, z: p.z } : null,
      cam: { pitch: state.groundPitch, dist: state.groundDistance,
        forward: state.groundForward.toArray() }
    };
  };
  // Every figure on the world at once, off the same list hideFigures/showFigures work from,
  // so a check cannot go stale against them. `shown` is whether it is really being drawn
  // (ancestors included) -- a figure left standing through a fold shows up here as shown at
  // the model's own scale, which is the bug this exists to catch.
  MI.world.__figures = function () {
    if (!state) return null;
    var out = [];
    eachFigure(function (group, kind, view) {
      if (!group) return;
      out.push({ kind: kind, view: view, scale: +group.scale.x.toFixed(4),
        own: group.visible, shown: MI.world.walkers.isShown(group) });
    });
    return { folding: !!state.folding, transition: !!state.transition,
      flatMode: !!state.flatMode, hidden: !!state.figuresHidden, figures: out };
  };
  MI.world.__scale = function () { return state && state.planet.scale.x; };
  // Which tile each resident is standing on, per view — for checking that a friend actually
  // walks rather than freezing on their own tile.
  MI.world.__residents = function () {
    if (!state) return {};
    var out = {};
    Object.keys(state.residentWalkers).forEach(function (id) {
      var pair = state.residentWalkers[id];
      var walker = state.flatMode ? pair.flat : pair.sphere;
      out[(pair.person && pair.person.name) || id] = walker.tileId;
    });
    return out;
  };
  // Where each resident is loitering, per view, as a fraction of a tile-width from their tile's
  // centre — for checking that a friend stays within half a tile of it. Island also reports the
  // footprint boxes and centres, in island units, so a spot can be checked against a wall.
  MI.world.__loiter = function () {
    if (!state) return {};
    var out = { residents: {}, spacing: FLAT_SPACING,
      blockers: state.island ? state.island.blockers : [],
      centres: state.island ? state.island.centres : {} };
    Object.keys(state.residentWalkers).forEach(function (id) {
      var pair = state.residentWalkers[id];
      function view(walker) {
        return { tile: walker.t >= 1 ? walker.targetId : null, spot: walker.spot && { x: walker.spot.x, z: walker.spot.z },
          pos: walker.group.position.toArray() };
      }
      out.residents[(pair.person && pair.person.name) || id] = { sphere: view(pair.sphere), flat: view(pair.flat),
        stops: (state.residentStopsCache && state.residentStopsCache[id]) || [] };
    });
    return out;
  };
  MI.world.__steer = function (dx, dy) { state.steerCamera(dx, dy, MOUSE_LOOK_SPEED); };
  MI.world.__camera = function (phi) { state.camPhi = clampPhi(phi); state.updateCamera(); };
  MI.world.setPlanet = setPlanet;
  MI.world.loadGrid = loadGrid;
  MI.world.planetInfo = planetInfo;
  MI.world.currentTiles = currentTiles;
  MI.world.setTheme = setTheme;
  MI.world.setSatellite = setSatellite;
  MI.world.setPet = setPet;
  MI.world.feedPet = feedPet;
  MI.world.setGroundView = setGroundView;
  MI.world.isGroundView = isGroundView;
  MI.world.onGroundView = onGroundView;
  MI.world.onLookMemory = function (cb) { lookMemoryListener = cb; };
  MI.world.onViewChange = onViewChange;
  MI.world.setCharacter = setCharacter;
  MI.world.characters = function () { return MI.world.player.list(); };
  MI.world.currentCharacter = function () { return state && state.characterId; };
  MI.world.setSkin = setSkin;
  MI.world.enterGalaxy = enterGalaxy;
  MI.world.leaveGalaxy = leaveGalaxy;
  MI.world.focusGalaxyPlanet = focusGalaxyPlanet;
  MI.world.hopGalaxyFocus = hopGalaxyFocus;
  // Raise a planet as though the pointer were on it, without flying the camera to it.
  // Reordering needs this: the ring is rebuilt underneath you and the world you are
  // holding should stay lifted, but the view must not lurch on every nudge.
  MI.world.hoverGalaxyPlanet = function (id) { if (state && state.galaxy) setGalaxyHover(id || null); };
  MI.world.selectGalaxyPlanet = selectGalaxyPlanet;
  MI.world.isGalaxy = isGalaxy;
  MI.world.onGalaxyHover = function (cb) { galaxyHoverListener = cb; };
  MI.world.onGalaxyPick = function (cb) { galaxyPickListener = cb; };
  MI.world.onGalaxyFrame = function (cb) { galaxyFrameListener = cb; };
  MI.world.enterHub = enterHub;
  MI.world.leaveHub = leaveHub;
  MI.world.isHub = isHub;
  MI.world.isHubSlot = isHubBuildingSlot;
  MI.world.applyHubSwap = applyHubSwap;
  MI.world.inspectHubLook = function (id) {
    return MI.world.hub.inspect(MI.store.get(), id);
  };
  MI.world.onHubPick = function (cb) { hubPickListener = cb; };
  MI.world.onHubChange = function (cb) { hubChangeListener = cb; };
})();
