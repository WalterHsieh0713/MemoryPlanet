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

  var HEX_PACK = 'assets/kenney-hexagon-kit/';
  // The kit's tiles are 1.0 unit flat-to-flat; props are scaled to whatever the grid's real
  // tile spacing turns out to be, so changing the hexgrid frequency doesn't break the fit.
  var KIT_TILE_WIDTH = 1.0;

  // Terrain seeded around a memory, so a biome grows out of what you wrote. `grand` is
  // reserved for important entries — that's what finally makes `importance` visible.
  var CATEGORY_TERRAIN = {
    achievement: { plain: ['stone.glb'], feature: ['stone-rocks.glb'], grand: ['stone-mountain.glb', 'stone-hill.glb'] },
    travel: { plain: ['sand.glb'], feature: ['sand-rocks.glb', 'sand-desert.glb'], grand: ['sand-desert.glb'] },
    home: { plain: ['grass.glb'], feature: ['grass-forest.glb'], grand: ['grass-hill.glb'] },
    everyday: { plain: ['grass.glb'], feature: ['grass-forest.glb'], grand: ['grass-hill.glb'] },
    social: { plain: ['grass.glb'], feature: ['grass-forest.glb'], grand: ['grass-hill.glb'] },
    other: { plain: ['dirt.glb'], feature: ['dirt-lumber.glb'], grand: ['stone-hill.glb'] }
  };

  // The sphere can't place whole kit tiles on its irregular cells, so terrain shows up
  // there as the cell's own colour instead — each theme's `tint` table (themes.js).

  // Every building in the kit, spread across the categories, so repeat entries of the same
  // kind don't look stamped out.
  var CATEGORY_BUILDINGS = {
    achievement: ['building-castle.glb', 'building-tower.glb', 'building-wizard-tower.glb', 'building-walls.glb'],
    everyday: ['building-house.glb', 'building-cabin.glb', 'building-mill.glb'],
    travel: ['building-dock.glb', 'building-port.glb'],
    home: ['building-farm.glb', 'building-sheep.glb', 'building-watermill.glb'],
    social: ['building-village.glb', 'building-market.glb', 'building-archery.glb'],
    other: ['building-mine.glb', 'building-smelter.glb', 'building-wall.glb']
  };

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
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  var state = null;      // everything built in init(), shared with the public API below
  var animations = [];   // each entry: fn(nowMs) -> true when finished
  var pickListeners = [];

  function animate(durationMs, step) {
    var start = performance.now();
    animations.push(function (now) {
      var t = Math.min(1, (now - start) / durationMs);
      step(t);
      return t >= 1;
    });
  }

  // --- Public API ---------------------------------------------------------------------

  // Which building a category gets. Called once by MI.app and then persisted on the Memory,
  // so the same memory always renders the same building (CLAUDE.md: no Math.random() at spawn).
  function pickAssetFor(category, seed) {
    var options = CATEGORY_BUILDINGS[category] || CATEGORY_BUILDINGS.other;
    var index = Math.floor(hash(seed || 0) * options.length) % options.length;
    return { pack: 'kenney-hexagon-kit', key: options[index] };
  }

  // Which terrain a seeded tile gets. `index` is its position in that memory's little
  // cluster, so the first tile of an important memory becomes the hill or mountain.
  function pickTerrainFor(category, importance, seed, index) {
    var table = CATEGORY_TERRAIN[category] || CATEGORY_TERRAIN.other;
    var bucket;
    if (index === 0 && importance >= 4) bucket = table.grand;
    else bucket = hash(seed * 31 + index) < 0.45 ? table.feature : table.plain;
    return bucket[Math.floor(hash(seed * 17 + index * 7) * bucket.length) % bucket.length];
  }

  // How many landscape tiles a memory drags along with it. Bigger memories spread further.
  function landscapeCountFor(importance, seed) {
    return 1 + Math.floor(hash(seed * 13) * 2) + (importance >= 4 ? 1 : 0);
  }

  function spawnLandscape(entry, options) {
    if (!state || typeof entry.slot !== 'number') return;
    // Remembered so a theme change can repaint this tile in place.
    if (state.waterTileIds.has(entry.slot)) state.landAsset[entry.slot] = entry.asset;
    setTileLand(entry.slot, landTopColor(entry.slot));
    if (!options || options.animate !== false) popTile(entry.slot);
  }

  function landTopColor(slot) {
    var asset = state.landAsset[slot];
    var hex = asset ? currentTheme.tint[asset] : undefined;
    return hex === undefined ? LAND_COLOR : new THREE.Color(hex);
  }

  function spawnMemory(memory, options) {
    if (!state) return Promise.resolve();
    var opts = options || {};
    var slot = memory.placement && memory.placement.slot;
    if (typeof slot !== 'number') return Promise.resolve();

    setTileLand(slot);
    if (opts.animate !== false) popTile(slot);

    var file = (memory.asset && memory.asset.key) || pickAssetFor(memory.category, slot).key;
    return placeProp(HEX_PACK + file, memory.placement, {
      animate: opts.animate !== false,
      rotY: (memory.placement && memory.placement.rotY) || 0,
      tag: { type: 'memory', id: memory.id, slot: slot }
    }).then(function (obj) {
      rebuildRoads(); // the new tile may extend or reroute the network
      // The flat view is a rebuilt snapshot, not a live scene — without this, a memory
      // written while in flat mode wouldn't appear until you toggled out and back.
      if (state.flatMode) return refreshFlatView(slot).then(function () { return obj; });
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

  function spawnPerson(person, options) {
    if (!state || !person || !person.placement) return Promise.resolve();
    var opts = options || {};
    var obj = makePersonModel(person.appearance && person.appearance.color);
    var tile = MI.world.sphere.tile(person.placement.slot);
    var scale = (tile ? tileScale(tile) : state.spacing) * 0.55;
    prepareProp(obj, person.placement, scale, person.placement.rotY || 0);
    obj.translateX(state.spacing * 0.3); // stand beside the building, not inside it
    obj.userData.tag = { type: 'person', id: person.id, slot: person.placement.slot };
    state.props.add(obj);
    if (opts.animate !== false) popIn(obj);
    return Promise.resolve(obj);
  }

  // Rotate the planet under the camera so `slot` faces the viewer. Meaningless in flat mode,
  // where the layout is centred on the origin and a tile's sphere direction says nothing
  // about where it ended up.
  function focus(slot, options) {
    if (!state || state.flatMode) return;
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
      var e = easeInOut(t);
      state.camTheta = fromTheta + delta * e;
      state.camPhi = fromPhi + (targetPhi - fromPhi) * e;
      state.updateCamera();
    });
  }

  function onPick(cb) {
    pickListeners.push(cb);
  }

  function buildingsFor(category) {
    return (CATEGORY_BUILDINGS[category] || CATEGORY_BUILDINGS.other).slice();
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
  var FLAT_WATER_Y = 0;         // the sandbox puts the water surface at the origin plane
  // Kit tile tops sit at 0.20 in model space; the road overlay rides just above that.
  var FLAT_ROAD_LIFT = 0.201 * FLAT_MODEL_SCALE;
  var FLAT_WATER_DEPTH = 0.30;
  var FLAT_BG = new THREE.Color(0xf2f3ed);
  var PLANET_BG = new THREE.Color(0xdff1f7);
  // Flat mode stops short of the horizon (the sandbox's limit) so you can never swing under
  // the tiles and see them from beneath. On the globe, orbiting all the way round is fine.
  var FLAT_PHI_LIMIT = 1.25;

  function clampPhi(phi) {
    if (state && state.flatMode) return Math.max(0.05, Math.min(FLAT_PHI_LIMIT, phi));
    return Math.max(0.15, Math.min(Math.PI - 0.15, phi));
  }

  function hexDirection(k) {
    var a = k * Math.PI / 3;
    return { x: Math.cos(a), z: Math.sin(a) };
  }

  // `allTiles` defaults to the loaded grid; taking it as an argument keeps this a pure
  // function of its inputs, which is what makes the layout and road logic testable.
  function computeFlatLayout(landSlots, homeSlot, allTiles) {
    var tiles = allTiles || state.tiles;
    var placed = {};
    var start = landSlots.has(homeSlot) ? homeSlot : landSlots.values().next().value;
    if (start === undefined) return placed;

    // rot tracks how each tile's cyclic neighbour list is turned relative to the flat grid,
    // so that walking A -> B and then B -> A lands back where it started.
    placed[start] = { x: 0, z: 0, rot: 0, land: true };
    var queue = [start];
    while (queue.length) {
      var id = queue.shift();
      var here = placed[id];
      var tile = tiles[id];
      if (tile.sides !== 6) continue; // a pentagon has no consistent place on a hex grid
      tile.neighbors.forEach(function (nid, i) {
        if (placed[nid]) return;
        var d = (i + here.rot) % 6;
        var dir = hexDirection(d);
        var neighbor = tiles[nid];
        var back = neighbor.neighbors.indexOf(id);
        var rot = (neighbor.sides === 6 && back >= 0) ? (((d + 3 - back) % 6) + 6) % 6 : 0;
        var isLand = landSlots.has(nid);
        placed[nid] = {
          x: here.x + dir.x * FLAT_SPACING,
          z: here.z + dir.z * FLAT_SPACING,
          rot: rot,
          land: isLand
        };
        // Only grow through land — water neighbours stay as the buffer ring.
        if (isLand) queue.push(nid);
      });
    }
    return placed;
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
    if (state.roadGroup) {
      state.planet.remove(state.roadGroup);
      state.roadGroup = null;
    }

    var world = MI.store.get();
    var buildingSlots = new Set();
    world.memories.forEach(function (m) { if (m.placement) buildingSlots.add(m.placement.slot); });

    var edges = computeRoadEdges();
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

  // Translates the shared road network into the flat grid's own geometry.
  // Returns slot -> { file, rotation } for the tiles a road runs through.
  function computeRoads(layout, buildingSlots, allTiles) {
    // Same network the planet draws. A tile's neighbour index i sits in flat direction
    // (i + rot) % 6 — `rot` is the bookkeeping computeFlatLayout already keeps to line each
    // tile's cyclic neighbour list up with the flat grid.
    var sphereEdges = computeRoadEdges(allTiles);
    var edgesBySlot = {};
    Object.keys(sphereEdges).forEach(function (slot) {
      var placed = layout[slot];
      if (!placed) return; // outside the part of the island the flat view laid out
      var set = new Set();
      sphereEdges[slot].forEach(function (index) {
        set.add((index + placed.rot) % 6);
      });
      edgesBySlot[slot] = set;
    });

    var roads = {};
    Object.keys(edgesBySlot).forEach(function (slot) {
      // A building keeps its building; the neighbouring road tile already points at it,
      // which is what makes the road appear to arrive at the door.
      if (buildingSlots.has(Number(slot))) return;
      var edges = Array.from(edgesBySlot[slot]);

      if (!layout[slot].land) {
        // Over water the only thing we can draw is a bridge, and the kit's bridge is a
        // straight span between opposite edges — anything else would be a road to nowhere.
        if (edges.length !== 2 || (Math.abs(edges[0] - edges[1]) % 6) !== 3) return;
        roads[slot] = { file: 'bridge.glb', rotation: ((edges[0] % 3) * Math.PI / 3), bridge: true };
        return;
      }
      var piece = MI.connectors.connectorFor(edges, 'path');
      if (piece) roads[slot] = piece;
    });
    return roads;
  }

  function buildFlatView() {
    while (state.flatGroup.children.length) {
      state.flatGroup.remove(state.flatGroup.children[0]);
    }
    // Drop spinners belonging to the tiles we just detached, or every rebuild would leave
    // orphaned rotors turning forever.
    state.spinners = state.spinners.filter(function (obj) { return obj.parent; });

    var world = MI.store.get();
    var landSlots = new Set();
    var assetBySlot = {};
    // Terrain first, so a memory's building always wins if they ever overlap.
    world.landscape.forEach(function (entry) {
      landSlots.add(entry.slot);
      assetBySlot[entry.slot] = entry.asset || 'grass.glb';
    });
    world.memories.forEach(function (m) {
      if (!m.placement) return;
      landSlots.add(m.placement.slot);
      assetBySlot[m.placement.slot] = (m.asset && m.asset.key) || 'grass.glb';
    });
    if (!landSlots.size) { state.flatRadius = 3; return Promise.resolve(); }

    var layout = computeFlatLayout(landSlots, world.home);
    var buildingSlots = new Set();
    world.memories.forEach(function (m) { if (m.placement) buildingSlots.add(m.placement.slot); });
    var roads = computeRoads(layout, buildingSlots);
    var ids = Object.keys(layout);

    // Roads can only be drawn on landscape tiles, so an island saved before landscape
    // existed renders none. Say so rather than silently showing nothing.
    var shared = world.people.filter(function (p) { return (p.memoryIds || []).length > 1; });
    console.info('[flat view] %d tiles (%d buildings, %d landscape) · %d people, %d recurring '
      + '· %d road tiles',
      ids.length, buildingSlots.size, world.landscape.length,
      world.people.length, shared.length, Object.keys(roads).length);
    if (world.memories.length > 1 && !world.landscape.length) {
      console.info('[flat view] no roads: this island has no landscape tiles to carry them — '
        + 'it was saved before landscape existed. "Start over" to rebuild it.');
    }
    var cx = 0, cz = 0;
    ids.forEach(function (id) { cx += layout[id].x; cz += layout[id].z; });
    cx /= ids.length; cz /= ids.length;

    // Turn the island's longest axis across the screen. This only changes the flat
    // presentation; persisted sphere slots and the road graph stay untouched.
    var xx = 0, xz = 0, zz = 0;
    ids.forEach(function (id) {
      var x = layout[id].x - cx, z = layout[id].z - cz;
      xx += x * x; xz += x * z; zz += z * z;
    });
    var angle = 0.5 * Math.atan2(2 * xz, xx - zz);
    state.flatGroup.rotation.y = angle;
    var maxScreenX = 0, maxScreenZ = 0;
    ids.forEach(function (id) {
      var x = layout[id].x - cx, z = layout[id].z - cz;
      maxScreenX = Math.max(maxScreenX, Math.abs(Math.cos(angle) * x + Math.sin(angle) * z));
      maxScreenZ = Math.max(maxScreenZ, Math.abs(-Math.sin(angle) * x + Math.cos(angle) * z));
    });
    var halfFov = state.camera.fov * Math.PI / 360;
    var padding = FLAT_SPACING * 1.5;
    state.flatFitDistance = Math.max(8,
      (maxScreenX + padding) / (Math.tan(halfFov) * state.camera.aspect * 0.88),
      (maxScreenZ + padding) / (Math.tan(halfFov) * 0.78));

    var extent = 0;
    var waterCentres = [];
    var jobs = [];

    ids.forEach(function (id) {
      var p = layout[id];
      var x = p.x - cx, z = p.z - cz;
      extent = Math.max(extent, Math.sqrt(x * x + z * z));

      if (!p.land && !roads[id]) {
        // Water gets real rippling geometry rather than the kit's static water tile —
        // except where a bridge spans it, which needs a real tile to stand on.
        waterCentres.push({ x: x, z: z });
        return;
      }
      var road = roads[id];
      jobs.push(loadParts(HEX_PACK + assetBySlot[id]).then(function (parts) {
        if (!parts) return;
        var obj = buildFromParts(parts);
        obj.scale.setScalar(FLAT_MODEL_SCALE);
        obj.rotation.y = Math.PI / 3;
        obj.position.set(x, FLAT_BASE_Y, z);
        obj.userData.restY = FLAT_BASE_Y;
        obj.userData.tag = { type: 'flat', slot: Number(id), land: true };
        state.flatGroup.add(obj);
        if (parts.some(function (part) { return part.spin; })) state.spinners.push(obj);

        // The kit's path pieces are thin road overlays, not tiles — they have no ground of
        // their own. They lay ON the terrain; swapping one in for the terrain leaves a road
        // floating over open water. Bridges and rivers ARE full tiles, so those replace.
        if (!road || road.bridge) return;
        return loadParts(HEX_PACK + road.file).then(function (roadParts) {
          if (!roadParts) return;
          var strip = buildFromParts(roadParts);
          strip.scale.setScalar(FLAT_MODEL_SCALE);
          strip.rotation.y = road.rotation; // exact: the connector lookup chose this angle
          strip.position.set(x, FLAT_BASE_Y + FLAT_ROAD_LIFT, z);
          strip.userData.restY = FLAT_BASE_Y + FLAT_ROAD_LIFT;
          strip.userData.tag = { type: 'flat', slot: Number(id), land: true };
          state.flatGroup.add(strip);
        });
      }));
    });

    world.people.forEach(function (person) {
      var slot = person.placement && person.placement.slot;
      var p = layout[slot];
      if (!p) return;
      var obj = makePersonModel(person.appearance && person.appearance.color);
      obj.scale.setScalar(FLAT_MODEL_SCALE * 0.55);
      obj.position.set(p.x - cx + FLAT_SPACING * 0.26,
        FLAT_BASE_Y + 0.2 * FLAT_MODEL_SCALE, p.z - cz);
      obj.userData.tag = { type: 'person', id: person.id, slot: slot };
      state.flatGroup.add(obj);
    });

    if (waterCentres.length) state.flatGroup.add(buildFlatWater(waterCentres));

    return Promise.all(jobs).then(function () {
      state.flatRadius = extent + FLAT_SPACING;
      state.flatGroup.add(buildIslandShadow(state.flatRadius * 3.2));
    });
  }

  // Rebuild the layout in place. Passing the slot that just appeared animates only that
  // tile, so writing an entry from flat mode doesn't replay the whole island rising.
  function refreshFlatView(newSlot) {
    if (!state || !state.flatMode) return Promise.resolve();
    return buildFlatView().then(function () {
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
      obj.position.y = rest - 1.8 * (1 - easeOutBack(t));
    });
  }

  // One merged mesh of flat hexagons carrying the same procedural water material as the
  // planet, so the buffer ring ripples here too. aLand stays 0 so the shader takes the
  // water branch, and the normals are all straight up, which is what makes the triplanar
  // projection fall back to a plain XZ pattern.
  function buildFlatWater(centres) {
    var circum = FLAT_TILE_RADIUS;
    var perTile = 6 * 3;
    var positions = new Float32Array(centres.length * perTile * 3);
    var normals = new Float32Array(centres.length * perTile * 3);
    var colors = new Float32Array(centres.length * perTile * 3);
    var uvs = new Float32Array(centres.length * perTile * 2);
    var land = new Float32Array(centres.length * perTile);

    var v = 0;
    centres.forEach(function (c) {
      for (var k = 0; k < 6; k++) {
        // Vertices at 90 + k*60 degrees, matching the kit's hexagon orientation.
        // Wound centre -> a1 -> a0 (descending): with increasing angle these faces point
        // DOWN in three.js's right-handed frame and get culled when viewed from above.
        var a0 = Math.PI / 2 + k * Math.PI / 3;
        var a1 = Math.PI / 2 + (k + 1) * Math.PI / 3;
        var tri = [
          [c.x, c.z],
          [c.x + Math.cos(a1) * circum, c.z + Math.sin(a1) * circum],
          [c.x + Math.cos(a0) * circum, c.z + Math.sin(a0) * circum]
        ];
        for (var i = 0; i < 3; i++) {
          positions[v * 3] = tri[i][0];
          positions[v * 3 + 1] = FLAT_WATER_Y;
          positions[v * 3 + 2] = tri[i][1];
          normals[v * 3 + 1] = 1;
          colors[v * 3] = WATER_COLOR.r;
          colors[v * 3 + 1] = WATER_COLOR.g;
          colors[v * 3 + 2] = WATER_COLOR.b;
          uvs[v * 2] = 0.25;
          uvs[v * 2 + 1] = 0.5;
          land[v] = 0;
          v++;
        }
      }
    });

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 1));

    var material = new THREE.MeshStandardMaterial({
      map: makeSurfaceTexture(), vertexColors: true, flatShading: true, roughness: 0.85
    });
    installWaterShader(material);
    // At the sandbox's tile size its own pattern scale of 1.0 is the right density.
    material.userData.waterUniforms.uWaterScale.value = 1.0;
    state.flatWaterMaterial = material;

    var surface = new THREE.Mesh(geometry, material);
    surface.receiveShadow = true;

    var group = new THREE.Group();
    group.add(surface, buildFlatWaterSkirt(centres, circum), buildFlatWaterOutlines(centres, circum));
    group.userData.isFlatWater = true; // the entry animation leaves the sea where it is
    return group;
  }

  // A pale rim around each tile's waterline — the sandbox's touch, and it's what keeps the
  // individual hexagons legible once the caustics are moving across them.
  function buildFlatWaterOutlines(centres, circum) {
    var group = new THREE.Group();
    var points = [];
    for (var k = 0; k < 6; k++) {
      var a = Math.PI / 2 + k * Math.PI / 3;
      points.push(new THREE.Vector3(Math.cos(a) * circum, 0, Math.sin(a) * circum));
    }
    var geometry = new THREE.BufferGeometry().setFromPoints(points);
    var material = new THREE.LineBasicMaterial({ color: 0xdafff5, transparent: true, opacity: 0.20 });
    centres.forEach(function (c) {
      var loop = new THREE.LineLoop(geometry, material);
      loop.position.set(c.x, FLAT_WATER_Y + 0.012, c.z);
      group.add(loop);
    });
    return group;
  }

  // Walls dropping from the water surface, so the sea reads as a solid block like the kit's
  // tiles rather than a sheet of paper. Only edges that don't border another water tile get
  // a wall — interior edges would be hidden anyway and would z-fight against each other.
  function buildFlatWaterSkirt(centres, circum) {
    var key = function (x, z) { return Math.round(x * 1000) + ',' + Math.round(z * 1000); };
    var occupied = {};
    centres.forEach(function (c) { occupied[key(c.x, c.z)] = true; });

    var top = new THREE.Color(currentTheme.skirt[0]).convertSRGBToLinear();
    var bottom = new THREE.Color(currentTheme.skirt[1]).convertSRGBToLinear();
    var positions = [], colors = [];

    centres.forEach(function (c) {
      for (var k = 0; k < 6; k++) {
        // Edge k spans vertices k and k+1; its neighbour lies through the edge midpoint.
        var toNeighbour = Math.PI / 2 + k * Math.PI / 3 + Math.PI / 6;
        var nx = c.x + Math.cos(toNeighbour) * FLAT_SPACING;
        var nz = c.z + Math.sin(toNeighbour) * FLAT_SPACING;
        if (occupied[key(nx, nz)]) continue;

        var a0 = Math.PI / 2 + k * Math.PI / 3;
        var a1 = Math.PI / 2 + (k + 1) * Math.PI / 3;
        var inner = circum * 0.97; // slight taper, so the block catches light on its sides
        var t0 = [c.x + Math.cos(a0) * circum, FLAT_WATER_Y, c.z + Math.sin(a0) * circum];
        var t1 = [c.x + Math.cos(a1) * circum, FLAT_WATER_Y, c.z + Math.sin(a1) * circum];
        var b0 = [c.x + Math.cos(a0) * inner, FLAT_WATER_Y - FLAT_WATER_DEPTH, c.z + Math.sin(a0) * inner];
        var b1 = [c.x + Math.cos(a1) * inner, FLAT_WATER_Y - FLAT_WATER_DEPTH, c.z + Math.sin(a1) * inner];

        [[t0, top], [t1, top], [b1, bottom], [t0, top], [b1, bottom], [b0, bottom]]
          .forEach(function (pair) {
            positions.push(pair[0][0], pair[0][1], pair[0][2]);
            colors.push(pair[1].r, pair[1].g, pair[1].b);
          });
      }
    });

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    // DoubleSide because these are open walls, not a sealed solid — the inside of the far
    // wall is legitimately visible from a low angle.
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.75, side: THREE.DoubleSide
    }));
  }

  // Tiles rise out of the water from the middle outward, so entering the flat view reads as
  // the island assembling itself rather than a hard cut.
  function animateFlatEntry() {
    var risers = state.flatGroup.children.filter(function (obj) {
      return !obj.userData.isFlatWater;
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

  // A soft blob of shade under the island so it sits on the page instead of floating.
  function buildIslandShadow(size) {
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
    mesh.position.y = FLAT_WATER_Y - FLAT_WATER_DEPTH - 0.10;
    mesh.userData.isFlatWater = true; // not part of the rise-in animation
    return mesh;
  }

  function setFlatView(on) {
    if (!state) return Promise.resolve();
    state.flatMode = !!on;
    var done = on ? buildFlatView() : Promise.resolve();
    return done.then(function () {
      state.planet.visible = !on;
      state.flatGroup.visible = !!on;

      // The sandbox's warm off-white backdrop and softer key light — the blue planet
      // lighting makes these tiles read as murky.
      applyLighting();

      if (on) {
        state.camDistance = state.flatFitDistance || 8;
        state.camPhi = 0.18; // near-overhead, so the island fills the view without a horizon
        state.camTheta = 0;
        animateFlatEntry();
      } else {
        state.camDistance = cameraRange().rest;
      }
      state.updateCamera();
    });
  }

  // Sky and lights for the current view + theme. The flat view keeps the sandbox's warm,
  // softer key light (the planet's blue lighting makes kit tiles read as murky); its sky
  // colour comes from the theme.
  function applyLighting() {
    var flat = state.flatMode;
    var t = currentTheme;
    PLANET_BG.set(t.sky);
    FLAT_BG.set(t.flatSky);
    state.scene.background = flat ? FLAT_BG : PLANET_BG;
    if (flat && !t.stars) {
      state.hemiLight.color.set(0xffffff);
      state.hemiLight.groundColor.set(0xb3c0b6);
      state.hemiLight.intensity = 1.0;
      state.sunLight.color.set(0xfff3d9);
      state.sunLight.intensity = 0.7;
    } else {
      state.hemiLight.color.set(t.hemi[0]);
      state.hemiLight.groundColor.set(t.hemi[1]);
      state.hemiLight.intensity = t.hemi[2];
      state.sunLight.color.set(t.sun[0]);
      state.sunLight.intensity = flat ? t.sun[1] * 0.6 : t.sun[1];
    }
    state.sunLight.position.set(flat ? -3 : 8, flat ? 8 : 12, flat ? 5 : 6);
    if (state.stars) state.stars.visible = !!t.stars;
  }

  function isFlatView() {
    return !!state && !!state.flatMode;
  }

  function clear() {
    if (!state) return;
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
      var tint = i < range[2] ? (topColor || LAND_COLOR) : LAND_SIDE_COLOR;
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
      obj.scale.setScalar(target * easeOutBack(t));
    });
  }

  // --- Props (buildings, characters) ---------------------------------------------------

  function loadGLB(url) {
    if (!state.glbCache[url]) {
      state.glbCache[url] = new Promise(function (resolve) {
        state.loader.load(url, resolve, undefined, function () { resolve(null); });
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
    group.children.forEach(function (piece) { piece.visible = false; });
    var elapsed = 0;
    // Must outlast the last piece: max delay (0.42 + 1.25) + its 0.65s fall = 2.32s.
    var DURATION = 2400;
    animate(DURATION, function (t) {
      elapsed = t * (DURATION / 1000);
      group.children.forEach(function (piece, i) {
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

  function prepareProp(obj, placement, scale, rotY) {
    obj.traverse(function (node) {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    obj.scale.setScalar(scale);
    var dir = MI.world.sphere.slotToDir(placement.slot);
    // Props stand on claimed tiles, which are raised out of the sea by LAND_LIFT.
    MI.world.sphere.orientToSurface(obj, dir, rotY || 0, RADIUS + LAND_LIFT);
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
      var scale = (tile ? tileScale(tile) : state.spacing) * (placement.scale || 1);
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
    while (state.props.children.length) state.props.remove(state.props.children[0]);
    while (state.flatGroup.children.length) state.flatGroup.remove(state.flatGroup.children[0]);
    if (state.roadGroup) {
      state.planet.remove(state.roadGroup);
      state.roadGroup = null;
    }
    state.spinners.length = 0;
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
      if (state.pet) sizePet();

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
        if (!state.flatMode) {
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
    [state.material, state.flatWaterMaterial].forEach(function (material) {
      if (!material) return;
      var u = material.userData.waterUniforms;
      u.uDeep.value.set(currentTheme.deep).convertSRGBToLinear();
      u.uShallow.value.set(currentTheme.shallow).convertSRGBToLinear();
      u.uFoam.value.set(currentTheme.foam).convertSRGBToLinear();
    });
    restyleKit();
    if (state.tiles) repaintTiles();
    if (state.flatMode) refreshFlatView(); // its sea skirt is baked, so rebuild it
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
      else writeTileColors(tile.id, landTopColor(tile.id), LAND_SIDE_COLOR);
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

  // --- Pets and skins (models in src/world/cosmetics.js) ------------------------------

  function setPet(id) {
    if (state.pet) {
      state.petGroup.remove(state.pet);
      state.pet = null;
    }
    state.petId = id || null;
    var model = id ? MI.world.cosmetics.makePet(id) : null;
    if (!model) return;
    // The holder is steered around the island each frame; the model inside it keeps its own
    // little motions (wagging, spinning) without fighting that orientation.
    var holder = new THREE.Group();
    holder.add(model);
    holder.userData.tick = model.userData.tick;
    state.pet = holder;
    state.petGroup.add(holder);
    sizePet();
    if (state.tiles) animatePet(performance.now() / 1000);
    popIn(holder);
  }

  function sizePet() {
    if (state.pet) state.pet.scale.setScalar(state.spacing * 0.85);
  }

  var UP = new THREE.Vector3(0, 1, 0);
  var SIDEWAYS = new THREE.Vector3(1, 0, 0);

  // A slow loop just above the rooftops, circling home so it stays by your island.
  function animatePet(t) {
    var pet = state.pet;
    if (!pet || !state.tiles) return;
    var world = MI.store && MI.store.get();
    var home = world && typeof world.home === 'number' ? state.tiles[world.home] : null;
    var h = home ? new THREE.Vector3().fromArray(home.dir)
      : new THREE.Vector3(0.6, 0.45, 0.66).normalize(); // roughly where the camera starts

    var t1 = new THREE.Vector3().crossVectors(Math.abs(h.y) > 0.95 ? SIDEWAYS : UP, h).normalize();
    var t2 = new THREE.Vector3().crossVectors(h, t1);
    var beta = Math.min(0.9, 1.7 * state.spacing / RADIUS); // loop radius, as an angle
    var a = t * 0.32;
    var ring = t1.clone().multiplyScalar(Math.cos(a)).add(t2.clone().multiplyScalar(Math.sin(a)));
    var radial = h.clone().multiplyScalar(Math.cos(beta))
      .add(ring.multiplyScalar(Math.sin(beta))).normalize();
    var altitude = RADIUS + LAND_LIFT + state.spacing * (1.15 + 0.08 * Math.sin(t * 2.1));
    pet.position.copy(radial).multiplyScalar(altitude);

    var forward = t1.clone().multiplyScalar(-Math.sin(a)).add(t2.clone().multiplyScalar(Math.cos(a)));
    forward.sub(radial.clone().multiplyScalar(forward.dot(radial))).normalize();
    var right = new THREE.Vector3().crossVectors(radial, forward).normalize();
    pet.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, radial, forward));
    if (pet.userData.tick) pet.userData.tick(t);
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

  // options (all optional, from the saved world): { frequency, theme, pet, skin }.
  function init(canvasEl, options) {
    var opts = options || {};
    var renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var scene = new THREE.Scene();
    scene.background = PLANET_BG;

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
    // Inside the planet group, so the pet is hidden with it in flat mode and scales with it.
    var petGroup = new THREE.Group();
    planet.add(petGroup);

    var manager = new THREE.LoadingManager();
    manager.setURLModifier(function (url) {
      if (url.indexOf('colormap.png') !== -1) {
        return HEX_PACK + 'Textures/variation-a.png';
      }
      return url;
    });

    state = {
      renderer: renderer, scene: scene, camera: camera,
      planet: planet, props: props, flatGroup: flatGroup,
      hemiLight: hemi, sunLight: sun,
      loader: new THREE.GLTFLoader(manager), glbCache: {}, partsCache: {}, spinners: [],
      camTheta: 0.7, camPhi: 1.1, camDistance: 13,
      flatMode: false, flatRadius: 3,
      // Planet size (setPlanet): frequency, world scale = frequency / 10, unit = its inverse.
      frequency: null, worldScale: 1, unit: 1, gridCache: {},
      landAsset: {},            // slot -> terrain asset, for repainting on a theme change
      // Cosmetics: every kit material / foliage geometry ever split, so a theme can restyle
      // what's already on screen; one recoloured atlas per theme.
      kitMaterials: [], foliageGeometries: [], atlasCache: {},
      themeId: null, skin: opts.skin || 'classic', petId: null, pet: null, petGroup: petGroup
    };
    state.stars = makeStars();
    scene.add(state.stars);
    setTheme(opts.theme || 'meadow');

    // Orbit camera, shared by both views: eye on a sphere around the origin, looking in.
    // Dragging phi toward PI/2 puts the eye level with the ground, which is exactly the
    // side-on view the flat layout is for.
    state.updateCamera = function () {
      camera.position.set(
        state.camDistance * Math.sin(state.camPhi) * Math.sin(state.camTheta),
        state.camDistance * Math.cos(state.camPhi),
        state.camDistance * Math.sin(state.camPhi) * Math.cos(state.camTheta)
      );
      camera.lookAt(0, 0, 0);
    };
    state.updateCamera();

    var dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    canvasEl.addEventListener('mousedown', function (e) {
      dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
      canvasEl.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', function () { dragging = false; canvasEl.style.cursor = 'grab'; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      state.camTheta -= dx * 0.006;
      state.camPhi = clampPhi(state.camPhi - dy * 0.006);
      lastX = e.clientX; lastY = e.clientY;
      state.updateCamera();
    });
    canvasEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      // The flat layout is much smaller than the planet, so it needs its own zoom range.
      var range = cameraRange();
      var min = state.flatMode ? 2.5 : range.min;
      var max = state.flatMode ? Math.max(8, state.flatRadius * 6) : range.max;
      state.camDistance = Math.max(min, Math.min(max, state.camDistance * (1 + e.deltaY * 0.001)));
      state.updateCamera();
    }, { passive: false });
    canvasEl.style.cursor = 'grab';

    canvasEl.addEventListener('click', function (e) {
      if (dragMoved) return; // that was a camera drag, not a tile click
      var slot = pickSlot(e, canvasEl);
      pickListeners.forEach(function (cb) { cb(slot); });
    });

    return setPlanet(opts.frequency || REFERENCE_FREQUENCY, { animate: false }).then(function () {
      setPet(opts.pet || null);
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

  function startLoop() {
    var lastFrame = 0;
    (function loop(timestampMs) {
      requestAnimationFrame(loop);
      var now = timestampMs || 0;
      var dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      state.material.userData.waterUniforms.uTime.value = now / 1000;
      if (state.flatWaterMaterial) {
        state.flatWaterMaterial.userData.waterUniforms.uTime.value = now / 1000;
      }
      animateWater(now / 1000);
      animatePet(now / 1000);
      state.spinners.forEach(function (group) { spinRotors(group, dt); });
      for (var i = animations.length - 1; i >= 0; i--) {
        if (animations[i](now)) animations.splice(i, 1);
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

  MI.world.init = init;
  MI.world.spawnMemory = spawnMemory;
  MI.world.spawnPerson = spawnPerson;
  MI.world.focus = focus;
  MI.world.onPick = onPick;
  MI.world.setFlatView = setFlatView;
  MI.world.isFlatView = isFlatView;
  // Exposed because they're pure and worth testing without a GPU.
  MI.world.computeFlatLayout = computeFlatLayout;
  MI.world.computeRoads = computeRoads;
  MI.world.computeRoadEdges = computeRoadEdges;
  MI.world.rebuildRoads = rebuildRoads;
  MI.world.roadConnections = roadConnections;
  MI.world.clear = clear;
  MI.world.pickAssetFor = pickAssetFor;
  MI.world.buildingsFor = buildingsFor;
  MI.world.respawnMemory = respawnMemory;
  MI.world.pickTerrainFor = pickTerrainFor;
  MI.world.landscapeCountFor = landscapeCountFor;
  MI.world.spawnLandscape = spawnLandscape;
  MI.world.personColor = personColor;
  MI.world.setPlanet = setPlanet;
  MI.world.loadGrid = loadGrid;
  MI.world.planetInfo = planetInfo;
  MI.world.currentTiles = currentTiles;
  MI.world.setTheme = setTheme;
  MI.world.setPet = setPet;
  MI.world.setSkin = setSkin;
})();
