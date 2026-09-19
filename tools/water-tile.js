// Isolated seven-tile island sandbox, three.js r128. Uses the local Kenney kit.
// Water motion stays in the shader, with shared world coordinates across edges.
(function () {
  'use strict';
  var error = document.getElementById('error');
  function showError(message) { error.hidden = false; error.textContent = message; }
  if (!window.THREE) { showError('Could not load three.js. Check your connection and reload.'); return; }
  var canvas = document.getElementById('water-canvas');
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true }); }
  catch (e) { showError('This preview needs WebGL: ' + e.message); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f3ed);
  var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  var theta = 0.25, phi = 0.78, distance = 16;
  var target = new THREE.Vector3(0, 0.1, 0);
  function updateCamera() {
    camera.position.set(distance * Math.sin(phi) * Math.sin(theta), distance * Math.cos(phi), distance * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
  }
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.zoom = camera.aspect < 0.8 ? 0.62 : 1;
    // Keep the front tiles above the build tray, including when settings expand.
    var lift = Math.max(0, (document.querySelector('.controls').offsetHeight - 120) * 0.5);
    camera.setViewOffset(window.innerWidth, window.innerHeight, 0, lift, window.innerWidth, window.innerHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(document.querySelector('.controls'));
  resize(); updateCamera();

  var uniforms = {
    uTime: { value: 0 },
    uScale: { value: 1 },
    uShimmer: { value: 0.65 },
    uDeep: { value: new THREE.Color('#167faa').convertSRGBToLinear() },
    uShallow: { value: new THREE.Color('#45c6cf').convertSRGBToLinear() },
    uFoam: { value: new THREE.Color('#d6fff0').convertSRGBToLinear() }
  };
  var material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    extensions: { derivatives: true },
    vertexShader: `
      varying vec2 vSurface;
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vSurface = vWorld.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime, uScale, uShimmer;
      uniform vec3 uDeep, uShallow, uFoam;
      varying vec2 vSurface;
      varying vec3 vWorld;

      vec2 hash2(vec2 p) {
        return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 s = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i).x, hash2(i + vec2(1, 0)).x, s.x),
                   mix(hash2(i + vec2(0, 1)).x, hash2(i + vec2(1, 1)).x, s.x), s.y);
      }
      // Moving Voronoi cells, warped into curved, interlocking caustic ribbons.
      // The second-nearest distance gives an edge without a sampled texture.
      float caustic(vec2 p, float t) {
        vec2 cell = floor(p), f = fract(p);
        float first = 8.0, second = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 seed = hash2(cell + offset);
            vec2 point = 0.5 + 0.40 * sin(t * 0.65 + 6.283185 * seed);
            float d = length(offset + point - f);
            second = max(first, min(second, d));
            first = min(first, d);
          }
        }
        float edge = second - first;
        float aa = max(fwidth(edge), 0.006);
        return 1.0 - smoothstep(0.035 - aa, 0.075 + aa, edge);
      }
      void main() {
        float t = uTime;
        vec2 p = vSurface / uScale;
        vec2 flow = p + vec2(t * 0.12, -t * 0.075);
        vec2 warp = vec2(sin(p.y * 2.3 + t * 0.7), cos(p.x * 2.0 - t * 0.55)) * 0.19;
        float depth = noise(flow * 0.9 + warp);
        float swell = sin(p.x * 2.4 + p.y * 1.7 - t * 1.1);
        vec3 color = mix(uDeep, uShallow, smoothstep(0.05, 0.95, depth) * 0.8 + 0.1);
        color *= 0.96 + 0.04 * smoothstep(-0.25, 0.25, swell);

        vec2 q = (flow + warp) * 1.9;
        q += 0.32 * vec2(sin(q.y * 2.2 + t * 0.6), sin(q.x * 2.0 - t * 0.5));
        float ribbon = caustic(q, t);
        float lightPool = noise(p * 1.4 - vec2(t * 0.16, t * 0.08));
        color = mix(color, uFoam, ribbon * (0.24 + 0.40 * lightPool));

        // Analytic wave slopes move the reflected sun even while geometry is
        // stationary. This is intentionally a broad, cartoon specular highlight.
        float a = p.x * 3.2 + p.y * 2.1 - t * 1.4;
        float b = p.x * -2.4 + p.y * 3.0 + t * 0.95;
        vec3 normal = normalize(vec3(-0.15 * cos(a) + 0.10 * cos(b), 1.0, -0.10 * cos(a) - 0.13 * cos(b)));
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 sun = normalize(vec3(-0.3, 1.0, -0.65));
        float spec = dot(reflect(-sun, normal), view);
        float sheen = smoothstep(0.93, 0.995, spec) * 0.14;
        float glint = smoothstep(0.996, 0.999, spec) * 0.60;
        color = mix(color, uFoam, (sheen + glint) * uShimmer);
        float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
        color = mix(color, uShallow, fresnel * 0.45);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }
    `
  });

  var RADIUS = 1.1;
  var MODEL_SCALE = RADIUS / (1 / Math.sqrt(3)); // Kit corners are at radius 1/sqrt(3).
  var BASE_Y = -0.22;
  var positions = [], outlinePoints = [];
  for (var side = 0; side < 6; side++) {
    var a = side * Math.PI / 3, b = (side + 1) * Math.PI / 3;
    positions.push(0, 0, 0, Math.sin(a) * RADIUS, 0, Math.cos(a) * RADIUS, Math.sin(b) * RADIUS, 0, Math.cos(b) * RADIUS);
    outlinePoints.push(new THREE.Vector3(Math.sin(a) * RADIUS, 0.012, Math.cos(a) * RADIUS));
  }
  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  var outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
  var outlineMaterial = new THREE.LineBasicMaterial({ color: 0xdafff5, transparent: true, opacity: 0.20 });
  var sides = new THREE.CylinderGeometry(RADIUS, RADIUS * 0.97, 0.30, 6, 1, true);
  var sideColors = [];
  var topColor = new THREE.Color('#298fa8').convertSRGBToLinear();
  var bottomColor = new THREE.Color('#196c8d').convertSRGBToLinear();
  for (var i = 0; i < sides.attributes.position.count; i++) {
    var c = sides.attributes.position.getY(i) > 0 ? topColor : bottomColor;
    sideColors.push(c.r, c.g, c.b);
  }
  sides.setAttribute('color', new THREE.Float32BufferAttribute(sideColors, 3));
  var rimMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  var tiles = [];
  for (var id = 0; id < 7; id++) {
    var angle = Math.PI / 6 + (id - 1) * Math.PI / 3;
    var center = new THREE.Vector3(id ? Math.sin(angle) * Math.sqrt(3) * RADIUS : 0, 0, id ? Math.cos(angle) * Math.sqrt(3) * RADIUS : 0);
    var water = new THREE.Group(); water.position.copy(center);
    var surface = new THREE.Mesh(geometry, material);
    var rim = new THREE.Mesh(sides, rimMaterial); rim.position.y = -0.15;
    water.add(surface, rim, new THREE.LineLoop(outlineGeometry, outlineMaterial));
    scene.add(water);
    var tile = { id: id, center: center, water: water, surface: surface, state: 'water', building: null };
    surface.userData.tile = tile; tiles.push(tile);
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb3c0b6, 1.0));
  var light = new THREE.DirectionalLight(0xfff3d9, 0.7);
  light.position.set(-3, 8, 5); scene.add(light);
  var shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  var ctx = shadowCanvas.getContext('2d');
  var gradient = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(30, 65, 68, 0.20)');
  gradient.addColorStop(1, 'rgba(30, 65, 68, 0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  var shadow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.40; scene.add(shadow);

  var templates = {}, ghosts = {}, selected = 'house', hovered = null, history = [], effects = [];
  var names = { house: 'Cottage', mill: 'Windmill' };
  var status = document.getElementById('status');
  var ready = false;
  var ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xc4f7ca, transparent: true, opacity: 0.24, depthWrite: false });
  var highlight = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: 0xfff4bf }));
  highlight.position.y = 0.035; highlight.visible = false; scene.add(highlight);

  // The kit packs each building into a mesh. Recover connected, same-palette
  // pieces once at load time, retaining its geometry/UVs instead of substituting
  // generic blocks. Foundation first; roof, walls, props and rotor follow.
  function prepareModel(gltf) {
    var parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(function (node) {
      if (!node.isMesh) return;
      var source = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      source.applyMatrix4(node.matrixWorld);
      var pos = source.attributes.position, uv = source.attributes.uv, normal = source.attributes.normal;
      var triangleCount = pos.count / 3, parents = [], vertices = new Map(), groups = new Map();
      for (var t = 0; t < triangleCount; t++) parents[t] = t;
      function root(n) { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; }
      for (var v = 0; v < pos.count; v++) {
        var key = [pos.getX(v), pos.getY(v), pos.getZ(v), uv.getX(v), uv.getY(v)].map(function (n) { return Math.round(n * 100000); }).join('/');
        var tri = Math.floor(v / 3);
        if (vertices.has(key)) parents[root(tri)] = root(vertices.get(key));
        else vertices.set(key, tri);
      }
      var spin = node.name === 'rotate-x';
      for (var j = 0; j < triangleCount; j++) {
        var base = Math.max(pos.getY(j * 3), pos.getY(j * 3 + 1), pos.getY(j * 3 + 2)) <= 0.201;
        var groupKey = spin ? 'rotor' : base ? 'foundation' : root(j);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(j);
      }
      var kitMaterial = node.material.clone(); kitMaterial.vertexColors = true; kitMaterial.roughness = 0.9;
      var grass = new THREE.Color('#92bf65').convertSRGBToLinear();
      groups.forEach(function (triangles, key) {
        var p = [], n = [], u = [], colors = [];
        triangles.forEach(function (tri) {
          for (var k = tri * 3; k < tri * 3 + 3; k++) {
            p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
            n.push(normal.getX(k), normal.getY(k), normal.getZ(k));
            u.push(uv.getX(k), uv.getY(k));
            // The alternate palette makes this vegetation column white. Tint
            // its grass and foliage shades, preserving the building's colors.
            var isGrass = Math.abs(uv.getX(k) - 0.34375) < 0.002;
            colors.push(isGrass ? grass.r : 1, isGrass ? grass.g : 1, isGrass ? grass.b : 1);
          }
        });
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        g.computeBoundingBox();
        var home = spin ? node.getWorldPosition(new THREE.Vector3()) : g.boundingBox.getCenter(new THREE.Vector3());
        g.translate(-home.x, -home.y, -home.z);
        parts.push({ geometry: g, material: kitMaterial, home: home, base: key === 'foundation', spin: spin });
      });
      source.dispose();
    });
    parts.sort(function (a, b) { return (a.base ? -10 : a.spin ? 10 : a.home.y) - (b.base ? -10 : b.spin ? 10 : b.home.y); });
    return parts;
  }

  function instance(kind, ghost) {
    var group = new THREE.Group();
    group.scale.setScalar(MODEL_SCALE); group.rotation.y = Math.PI / 3;
    group.position.y = BASE_Y;
    var parts = templates[kind];
    parts.forEach(function (part, i) {
      var mesh = new THREE.Mesh(part.geometry, ghost ? ghostMaterial : part.material);
      mesh.position.copy(part.home);
      mesh.userData = { home: part.home, base: part.base, spin: part.spin, delay: part.base ? 0 : 0.42 + i / parts.length * 1.25, landed: false };
      group.add(mesh);
    });
    return group;
  }

  function thumbnail(kind, previewRenderer) {
    var preview = new THREE.Scene(), object = instance(kind, false);
    preview.add(object, new THREE.HemisphereLight(0xffffff, 0xa6b99e, 1.25));
    var sun = new THREE.DirectionalLight(0xfff1d8, 0.8); sun.position.set(-3, 6, 4); preview.add(sun);
    var box = new THREE.Box3().setFromObject(object), center = box.getCenter(new THREE.Vector3());
    var camera = new THREE.PerspectiveCamera(32, 1.4, 0.1, 30);
    camera.position.copy(center).add(new THREE.Vector3(1.4, 1.9, 2.6)); camera.lookAt(center);
    previewRenderer.render(preview, camera);
    document.getElementById('thumb-' + kind).src = previewRenderer.domElement.toDataURL();
  }

  var manager = new THREE.LoadingManager();
  manager.setURLModifier(function (url) { return url.indexOf('colormap.png') !== -1 ? '../assets/kenney-hexagon-kit/Textures/variation-a.png' : url; });
  var loader = new THREE.GLTFLoader(manager);
  Promise.all(['house', 'mill'].map(function (kind) {
    return new Promise(function (resolve, reject) {
      loader.load('../assets/kenney-hexagon-kit/building-' + kind + '.glb', function (gltf) {
        templates[kind] = prepareModel(gltf); resolve();
      }, undefined, reject);
    });
  })).then(function () {
    var previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    previewRenderer.setSize(196, 140); previewRenderer.outputEncoding = THREE.sRGBEncoding;
    ['house', 'mill'].forEach(function (kind) {
      ghosts[kind] = instance(kind, true); ghosts[kind].visible = false; scene.add(ghosts[kind]);
      thumbnail(kind, previewRenderer);
      document.getElementById('choose-' + kind).disabled = false;
    });
    previewRenderer.dispose(); ready = true; updateStatus();
  }).catch(function (e) { status.textContent = 'The building kit could not load.'; showError('Could not load the local building assets: ' + (e.message || 'check that the preview is served over HTTP.')); });

  function updateStatus() {
    document.getElementById('count').textContent = history.length + ' / 7 built';
    document.getElementById('undo').disabled = document.getElementById('reset').disabled = history.length === 0;
    if (!ready) return;
    var building = tiles.some(function (tile) { return tile.state === 'building'; });
    status.textContent = building ? 'Piece by piece… your island is taking shape.' : history.length === 7 ? 'An island of your own. Undo or reset to try again.' : names[selected] + ' selected · click a water tile to build.';
  }
  function select(kind) {
    if (!ready) return;
    selected = kind;
    ['house', 'mill'].forEach(function (key) { document.getElementById('choose-' + key).setAttribute('aria-pressed', String(key === selected)); });
    updateHover(hovered); updateStatus();
  }
  document.querySelectorAll('[data-kind]').forEach(function (button) { button.addEventListener('click', function () { select(button.dataset.kind); }); });

  function updateHover(tile) {
    hovered = tile && tile.state === 'water' ? tile : null;
    Object.keys(ghosts).forEach(function (kind) {
      ghosts[kind].visible = ready && !!hovered && kind === selected;
      if (hovered) { ghosts[kind].position.x = hovered.center.x; ghosts[kind].position.z = hovered.center.z; }
    });
    highlight.visible = ready && !!hovered;
    if (hovered) { highlight.position.x = hovered.center.x; highlight.position.z = hovered.center.z; }
    canvas.style.cursor = hovered && ready ? 'pointer' : 'grab';
  }

  // Small shared geometries, with short-lived materials disposed after each burst.
  var puffGeometry = new THREE.IcosahedronGeometry(0.07, 0);
  var rippleGeometry = new THREE.RingGeometry(0.92, 1, 64);
  function burst(tile, point, ripple) {
    var mat = new THREE.MeshBasicMaterial({ color: ripple ? 0xc9fff5 : 0xf6e9bd, transparent: true, opacity: 0.7, depthWrite: false });
    var group = new THREE.Group(); group.position.copy(point);
    if (ripple) {
      var ring = new THREE.Mesh(rippleGeometry, mat); ring.rotation.x = -Math.PI / 2; group.add(ring);
    } else {
      for (var i = 0; i < 7; i++) {
        var puff = new THREE.Mesh(puffGeometry, mat);
        var a = i * Math.PI * 2 / 7;
        puff.userData.velocity = new THREE.Vector3(Math.cos(a) * 0.5, 0.6 + (i % 3) * 0.15, Math.sin(a) * 0.5);
        group.add(puff);
      }
    }
    scene.add(group); effects.push({ group: group, material: mat, age: 0, ripple: ripple, tileId: tile.id });
  }
  function removeEffect(effect) { scene.remove(effect.group); effect.material.dispose(); }
  function build(tile) {
    if (!ready || !tile || tile.state !== 'water') return;
    tile.state = 'building'; tile.kind = selected; tile.elapsed = 0;
    tile.building = instance(selected, false);
    tile.building.position.x = tile.center.x; tile.building.position.z = tile.center.z;
    tile.building.children.forEach(function (piece) { piece.visible = false; });
    scene.add(tile.building); history.push(tile.id); updateHover(null); updateStatus();
  }
  function restore(tile) {
    scene.remove(tile.building); tile.building = null; tile.state = 'water'; tile.water.visible = true;
    effects = effects.filter(function (effect) { if (effect.tileId !== tile.id) return true; removeEffect(effect); return false; });
  }
  document.getElementById('undo').addEventListener('click', function () { if (history.length) restore(tiles[history.pop()]); updateHover(null); updateStatus(); });
  document.getElementById('reset').addEventListener('click', function () { history.forEach(function (id) { restore(tiles[id]); }); history = []; updateHover(null); updateStatus(); });

  function animateBuilds(dt) {
    tiles.forEach(function (tile) {
      if (tile.state === 'land') {
        tile.building.children.forEach(function (piece) { if (piece.userData.spin) piece.rotation.x += dt * 0.75; });
        return;
      }
      if (tile.state !== 'building') return;
      tile.elapsed += dt;
      var complete = true;
      tile.building.children.forEach(function (piece, i) {
        var data = piece.userData, progress = (tile.elapsed - data.delay) / 0.65;
        if (progress < 1) complete = false;
        if (progress < 0) return;
        piece.visible = true;
        var t = Math.min(progress, 1);
        piece.position.copy(data.home);
        if (data.base) {
          // Ease the foundation out of the water before any building parts land.
          piece.position.y -= Math.pow(1 - t, 3) * 0.5;
          if (t > 0.45) tile.water.visible = false;
        } else {
          var fall = Math.min(t / 0.72, 1), bounce = Math.max(0, (t - 0.72) / 0.28);
          piece.position.y += (1 - fall * fall) * 1.35 + Math.sin(bounce * Math.PI) * 0.045;
          piece.position.x += Math.cos(i * 2.4) * 0.13 * (1 - fall);
          piece.position.z += Math.sin(i * 2.4) * 0.13 * (1 - fall);
          piece.rotation.z = (1 - fall) * 0.12 * Math.sin(i * 1.7);
        }
        if (t >= 0.72 && !data.landed) {
          data.landed = true;
          tile.building.updateMatrixWorld(true);
          if (data.base) burst(tile, tile.center.clone().setY(0.025), true);
          else burst(tile, piece.getWorldPosition(new THREE.Vector3()), false);
        }
      });
      if (complete) { tile.state = 'land'; updateStatus(); }
    });
    effects = effects.filter(function (effect) {
      effect.age += dt;
      var t = effect.age / (effect.ripple ? 0.95 : 0.6);
      if (t >= 1) { removeEffect(effect); return false; }
      effect.material.opacity = (1 - t) * 0.6;
      if (effect.ripple) effect.group.scale.setScalar(0.6 + t * 1.8);
      else effect.group.children.forEach(function (puff) {
        puff.position.copy(puff.userData.velocity).multiplyScalar(effect.age);
        puff.position.y -= effect.age * effect.age * 0.5;
        puff.scale.setScalar(1 - t * 0.8); puff.rotation.x += dt; puff.rotation.z += dt;
      });
      return true;
    });
  }

  var paused = false, speed = 1;
  ['speed', 'scale', 'shimmer'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function (event) {
      var value = Number(event.target.value);
      if (id === 'speed') speed = value;
      else uniforms[id === 'scale' ? 'uScale' : 'uShimmer'].value = value;
      document.getElementById(id + '-value').textContent = id === 'shimmer' ? Math.round(value * 100) + '%' : value.toFixed(1) + '×';
    });
  });
  var pauseButton = document.getElementById('pause');
  pauseButton.addEventListener('click', function () {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume water' : 'Pause water';
    pauseButton.setAttribute('aria-pressed', String(paused));
  });
  var viewButton = document.getElementById('view');
  viewButton.addEventListener('click', function () {
    var top = viewButton.getAttribute('aria-pressed') !== 'true';
    phi = top ? 0.001 : 0.78; theta = 0.25;
    viewButton.setAttribute('aria-pressed', String(top));
    viewButton.textContent = top ? 'Perspective' : 'Top view';
    updateCamera();
  });
  var raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
  function pick(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(tiles.map(function (tile) { return tile.surface; }), false);
    return hits.length ? hits[0].object.userData.tile : null;
  }
  var pointer = null, keyboardTile = 0;
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointer) { updateHover(pick(e)); return; }
    if (Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 5) pointer.moved = true;
    if (!pointer.moved) return;
    updateHover(null);
    theta -= (e.clientX - pointer.x) * 0.006;
    phi = Math.max(0.05, Math.min(1.25, phi + (e.clientY - pointer.y) * 0.006));
    pointer.x = e.clientX; pointer.y = e.clientY;
    viewButton.setAttribute('aria-pressed', 'false'); viewButton.textContent = 'Top view';
    updateCamera();
  });
  canvas.addEventListener('pointerup', function (e) { if (pointer && !pointer.moved) build(pick(e)); pointer = null; });
  canvas.addEventListener('pointercancel', function () { pointer = null; });
  canvas.addEventListener('pointerleave', function () { if (!pointer) updateHover(null); });
  canvas.addEventListener('keydown', function (e) {
    if (e.key.indexOf('Arrow') === 0) {
      e.preventDefault(); keyboardTile = (keyboardTile + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 6 : 1)) % 7; updateHover(tiles[keyboardTile]);
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); build(tiles[keyboardTile]); }
  });
  window.addEventListener('keydown', function (e) { if (e.target.tagName !== 'INPUT' && (e.key === '1' || e.key === '2')) select(e.key === '1' ? 'house' : 'mill'); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault(); distance = Math.max(10, Math.min(23, distance * Math.exp(e.deltaY * 0.001))); updateCamera();
  }, { passive: false });
  var clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (!paused) uniforms.uTime.value += dt * speed;
    animateBuilds(dt);
    renderer.render(scene, camera);
  }
  frame();
})();
