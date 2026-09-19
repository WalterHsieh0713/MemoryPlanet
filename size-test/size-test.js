// Memory Planet — /size-test. A standalone visual-density test bed: how many tiles feel
// right on the hex/pentagon planet before the real game commits to one frequency.
//
// Deliberately self-contained (no src/world/*.js, no MI namespace) so this can never touch
// the owned modules in docs/CONTRACT.md or regress the main page. Everything below that
// matters visually — colors, lighting, camera, the procedural surface texture, the merged
// per-tile polygon mesh — is ported from src/world/world.js so the two pages read as one
// product. The only intentional differences: every tile starts pre-settled as "land" (there's
// no journal here to grow it from ocean) and the 12 pentagons get a distinct tint so they're
// easy to eyeball and count.
(function () {
  // The main planet's sphere size (world.js RADIUS). The 162-tile preset — the closest to
  // what the real game would ship — renders at this full size; smaller presets scale down
  // from it so switching between them actually reads as a smaller vs. bigger planet, not
  // just a denser tiling of an identically-sized sphere.
  var FULL_RADIUS = 5;
  var MAX_FREQUENCY = 4; // the 162-tile preset's frequency (10*4*4+2 = 162)
  function radiusForFrequency(freq) {
    return FULL_RADIUS * (freq / MAX_FREQUENCY);
  }
  var TILE_DEPTH = 0.16;
  var LAND_LIFT = 0.07;

  var PLANET_BG = new THREE.Color(0xdff1f7);
  var LAND_COLOR = new THREE.Color(0x8fc75a);
  var LAND_SIDE_COLOR = new THREE.Color(0x8a6239);
  var PENTAGON_COLOR = new THREE.Color(0xff9f68);      // --accent, so the 12 pentagons pop
  var PENTAGON_SIDE_COLOR = new THREE.Color(0xf4804a); // --accent-deep

  var PRESETS = {
    42: { url: 'data/hexgrid-42.json', frequency: 2 },
    92: { url: 'data/hexgrid-92.json', frequency: 3 },
    162: { url: 'data/hexgrid-162.json', frequency: 4 }
  };
  var gridCache = {};

  // --- Same generated surface texture as src/world/world.js (makeSurfaceTexture) ----------
  function makeSurfaceTexture() {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    var ctx = canvas.getContext('2d');
    var seed = 17;
    function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
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

  // --- Scene / camera / lighting, matching world.js's planet-mode setup exactly -----------
  var canvasEl = document.getElementById('scene-canvas');
  var renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
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

  var planetMesh = null;
  var faceToTileId = null;
  var currentTiles = null;

  // Same orbit-camera math and defaults as world.js.
  var camTheta = 0.7, camPhi = 1.1, camDistance = 13;
  var MIN_DIST = 7, MAX_DIST = 30;
  function clampPhi(phi) { return Math.max(0.15, Math.min(Math.PI - 0.15, phi)); }
  function updateCamera() {
    camera.position.set(
      camDistance * Math.sin(camPhi) * Math.sin(camTheta),
      camDistance * Math.cos(camPhi),
      camDistance * Math.sin(camPhi) * Math.cos(camTheta)
    );
    camera.lookAt(0, 0, 0);
  }
  updateCamera();

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
    camTheta -= dx * 0.006;
    camPhi = clampPhi(camPhi - dy * 0.006);
    lastX = e.clientX; lastY = e.clientY;
    updateCamera();
  });
  canvasEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    camDistance = Math.max(MIN_DIST, Math.min(MAX_DIST, camDistance * (1 + e.deltaY * 0.001)));
    updateCamera();
  }, { passive: false });
  canvasEl.style.cursor = 'grab';

  // --- Geometry: one merged mesh, fan-triangulated per tile from dir + corners ------------
  // Ported from the sphere-mode branch of world.js's init(), with every tile pre-settled as
  // land (lifted by LAND_LIFT, grass-half UVs) rather than starting as water — there's no
  // journal here to grow land from an ocean, and a plain ocean sphere would hide the very
  // tiling density this page exists to show.
  function buildPlanetGeometry(grid, radius) {
    var tiles = grid.tiles;
    var totalTriangles = tiles.reduce(function (sum, t) { return sum + t.sides * 3; }, 0);
    var positions = new Float32Array(totalTriangles * 3 * 3);
    var colors = new Float32Array(totalTriangles * 3 * 3);
    var uvs = new Float32Array(totalTriangles * 3 * 2);
    var faceIds = new Int32Array(totalTriangles);
    var vCursor = 0, triCursor = 0;
    var topRadius = radius + LAND_LIFT;
    var bottomRadius = radius - TILE_DEPTH;
    // Each tile's top face is a fan of triangles from its center to its corners. On a curved
    // sphere that fan isn't perfectly planar, so the true per-triangle normals differ slightly
    // between wedges — under flat shading that shows up as visible triangle seams inside every
    // hex/pentagon instead of one clean flat face. We track each tile's top-vertex range here
    // so a pass after computeVertexNormals() can flatten it to a single outward normal per tile.
    var topRanges = []; // [{ start, count, dir }]

    tiles.forEach(function (tile) {
      var isPentagon = tile.sides === 5;
      var topColor = isPentagon ? PENTAGON_COLOR : LAND_COLOR;
      var sideColor = isPentagon ? PENTAGON_SIDE_COLOR : LAND_SIDE_COLOR;
      var topStart = vCursor;

      var center = tile.dir.map(function (c) { return c * topRadius; });
      var normal = new THREE.Vector3().fromArray(tile.dir);
      var tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.y) > 0.9) tangent.set(1, 0, 0);
      tangent.cross(normal).normalize();
      var bitangent = new THREE.Vector3().crossVectors(normal, tangent);
      // Same per-tile rotation as world.js so the atlas sampling doesn't look stamped.
      var angle = tile.id * 2.399963229728653;
      tangent.applyAxisAngle(normal, angle);
      bitangent.crossVectors(normal, tangent);
      var uvScale = 0;
      tile.corners.forEach(function (corner) {
        var delta = new THREE.Vector3().fromArray(corner).sub(normal);
        uvScale = Math.max(uvScale, Math.abs(delta.dot(tangent)), Math.abs(delta.dot(bitangent)));
      });
      uvScale = uvScale || 1;

      // Top face: fan-triangulate dir -> corners[k] -> corners[k+1].
      for (var k = 0; k < tile.sides; k++) {
        var c0 = tile.corners[k].map(function (c) { return c * topRadius; });
        var c1 = tile.corners[(k + 1) % tile.sides].map(function (c) { return c * topRadius; });
        var tri = [center, c0, c1];
        for (var v = 0; v < 3; v++) {
          positions[vCursor * 3] = tri[v][0];
          positions[vCursor * 3 + 1] = tri[v][1];
          positions[vCursor * 3 + 2] = tri[v][2];
          colors[vCursor * 3] = topColor.r;
          colors[vCursor * 3 + 1] = topColor.g;
          colors[vCursor * 3 + 2] = topColor.b;
          var point = new THREE.Vector3().fromArray(tri[v]).multiplyScalar(1 / topRadius).sub(normal);
          // Grass half of the atlas (right side) — see makeSurfaceTexture / setTileLand.
          uvs[vCursor * 2] = 0.75 + 0.20 * point.dot(tangent) / uvScale;
          uvs[vCursor * 2 + 1] = 0.5 + 0.4 * point.dot(bitangent) / uvScale;
          vCursor++;
        }
        faceIds[triCursor++] = tile.id;
      }
      topRanges.push({ start: topStart, count: vCursor - topStart, dir: tile.dir });

      // Walls dropping from the top ring to bottomRadius — same "Minecraft block" dirt side
      // as world.js, so neighbouring tiles never show a crack through to the background.
      for (k = 0; k < tile.sides; k++) {
        var e0 = tile.corners[k], e1 = tile.corners[(k + 1) % tile.sides];
        var top0 = e0.map(function (c) { return c * topRadius; });
        var top1 = e1.map(function (c) { return c * topRadius; });
        var low0 = e0.map(function (c) { return c * bottomRadius; });
        var low1 = e1.map(function (c) { return c * bottomRadius; });
        var wall = [top0, low1, top1, top0, low0, low1];
        for (var w = 0; w < wall.length; w++) {
          positions[vCursor * 3] = wall[w][0];
          positions[vCursor * 3 + 1] = wall[w][1];
          positions[vCursor * 3 + 2] = wall[w][2];
          colors[vCursor * 3] = sideColor.r;
          colors[vCursor * 3 + 1] = sideColor.g;
          colors[vCursor * 3 + 2] = sideColor.b;
          uvs[vCursor * 2] = 0.25;
          uvs[vCursor * 2 + 1] = 0.5;
          vCursor++;
        }
        faceIds[triCursor++] = tile.id;
        faceIds[triCursor++] = tile.id;
      }
    });

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeVertexNormals(); // correct for the (planar) wall quads; overwritten below for tops

    // Flatten every tile's top face to one shared outward normal, so each hex/pentagon reads
    // as a single flat facet — a real Goldberg-polyhedron look — instead of a pinwheel of
    // triangles with their own slightly different normals.
    var normalAttr = geometry.attributes.normal;
    topRanges.forEach(function (range) {
      var nx = range.dir[0], ny = range.dir[1], nz = range.dir[2];
      for (var i = 0; i < range.count; i++) {
        var vi = (range.start + i) * 3;
        normalAttr.array[vi] = nx;
        normalAttr.array[vi + 1] = ny;
        normalAttr.array[vi + 2] = nz;
      }
    });
    normalAttr.needsUpdate = true;

    return { geometry: geometry, faceToTileId: faceIds };
  }

  // flatShading:true would look right in world.js (tiles are tiny relative to the sphere),
  // but it ignores the normal attribute entirely — it derives a normal per rendered triangle
  // straight from screen-space position derivatives, so every fan-triangle would still get
  // its own facet no matter what we write into the normal buffer. With flatShading off, the
  // material actually uses our per-tile-uniform normals (set in buildPlanetGeometry), so a
  // whole hex/pentagon lights as one face — the low-poly faceted look still comes through
  // because normals genuinely change at tile boundaries, just not inside a tile anymore.
  var sharedMaterial = new THREE.MeshStandardMaterial({
    map: makeSurfaceTexture(), vertexColors: true, flatShading: false, roughness: 0.85
  });

  function loadGrid(size) {
    if (gridCache[size]) return Promise.resolve(gridCache[size]);
    return fetch(PRESETS[size].url)
      .then(function (res) { return res.json(); })
      .then(function (grid) { gridCache[size] = grid; return grid; });
  }

  function showPlanet(size, grid) {
    if (planetMesh) {
      scene.remove(planetMesh);
      planetMesh.geometry.dispose();
      planetMesh = null;
    }
    var built = buildPlanetGeometry(grid, radiusForFrequency(grid.frequency));
    faceToTileId = built.faceToTileId;
    currentTiles = grid.tiles;
    planetMesh = new THREE.Mesh(built.geometry, sharedMaterial);
    planetMesh.castShadow = true;
    planetMesh.receiveShadow = true;
    scene.add(planetMesh);

    var pentagons = grid.tiles.filter(function (t) { return t.sides === 5; }).length;
    var hexagons = grid.tiles.length - pentagons;
    document.getElementById('info-total').textContent = grid.tiles.length;
    document.getElementById('info-pentagons').textContent = pentagons;
    document.getElementById('info-hexagons').textContent = hexagons;
    document.getElementById('info-freq').textContent = 'f = ' + grid.frequency;

    document.querySelectorAll('#size-picker button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.size === String(size));
    });
  }

  function selectSize(size) {
    var loading = document.getElementById('loading');
    loading.classList.remove('hide');
    loadGrid(size).then(function (grid) {
      showPlanet(size, grid);
      loading.classList.add('hide');
    }).catch(function (err) {
      console.error('[size-test] failed to load preset', size, err);
      loading.textContent = 'failed to load the ' + size + '-tile preset — see console';
    });
  }

  document.querySelectorAll('#size-picker button').forEach(function (btn) {
    btn.addEventListener('click', function () { selectSize(btn.dataset.size); });
  });

  // --- Hover info: tile id, pentagon/hexagon, neighbor count -------------------------------
  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  var chip = document.getElementById('tile-chip');
  var chipText = document.getElementById('tile-chip-text');

  canvasEl.addEventListener('mousemove', function (e) {
    if (dragging || !planetMesh) return;
    var rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObject(planetMesh);
    if (!hits.length) {
      chip.classList.remove('pentagon');
      chipText.textContent = 'Hover a tile for details';
      chipText.classList.add('muted');
      return;
    }
    var tileId = faceToTileId[hits[0].faceIndex];
    var tile = currentTiles[tileId];
    var isPentagon = tile.sides === 5;
    chip.classList.toggle('pentagon', isPentagon);
    chipText.classList.remove('muted');
    chipText.innerHTML = 'Tile <b>#' + tile.id + '</b> · <b>' + (isPentagon ? 'Pentagon' : 'Hexagon') +
      '</b> · <b>' + tile.neighbors.length + '</b> neighbors';
  });
  canvasEl.addEventListener('mouseleave', function () {
    chip.classList.remove('pentagon');
    chipText.textContent = 'Hover a tile for details';
    chipText.classList.add('muted');
  });

  (function loop() {
    requestAnimationFrame(loop);
    renderer.render(scene, camera);
  })();

  selectSize(42);
})();
