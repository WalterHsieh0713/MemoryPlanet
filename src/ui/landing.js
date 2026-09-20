// Decorative cover only: no reads or writes to journals, memories, or MI.world.
(function () {
  var root, stage, canvas, motion, status, options;
  var background = [];
  var renderer, scene, camera, island, resizeObserver;
  var frame = 0, lastTime = 0, elapsed = 0;
  var closed = false, busy = false, paused = false;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var geometries = new Set(), materials = new Set(), textures = new Set();

  function track(model) {
    model.traverse(function (node) {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      var list = Array.isArray(node.material) ? node.material : [node.material];
      list.forEach(function (material) {
        materials.add(material);
        if (material.map) textures.add(material.map);
      });
    });
    return model;
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function draw(time) {
    frame = 0;
    if (closed || document.hidden || !renderer) return;
    if (!paused && !reduced.matches) {
      if (lastTime) elapsed += Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      island.rotation.y = -0.3 + elapsed * 0.13;
      island.position.y = Math.sin(elapsed * 0.7) * 0.035;
    }
    renderer.render(scene, camera);
    if (!paused && !reduced.matches) frame = requestAnimationFrame(draw);
  }

  function syncMotion() {
    stop();
    motion.hidden = !renderer || reduced.matches;
    motion.textContent = paused ? 'Resume island' : 'Pause island';
    if (!closed && !document.hidden && renderer) frame = requestAnimationFrame(draw);
  }

  function resize() {
    if (!renderer || closed) return;
    var width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    var aspect = width / height;
    var halfHeight = Math.max(2.65, 2.85 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    syncMotion();
  }

  function disposeResources() {
    geometries.forEach(function (g) { g.dispose(); });
    materials.forEach(function (m) { m.dispose(); });
    textures.forEach(function (t) { t.dispose(); });
    geometries.clear(); materials.clear(); textures.clear();
  }

  function disposePreview() {
    stop();
    if (resizeObserver) resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', syncMotion);
    reduced.removeEventListener('change', syncMotion);
    disposeResources();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
    }
    motion.hidden = true;
  }

  function fallback() {
    stage.classList.remove('ready');
    disposePreview();
  }

  function preview() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 40);
      camera.position.set(6, 5.3, 8);
      camera.lookAt(0, -0.15, 0);
      scene.add(new THREE.HemisphereLight(0xfffbed, 0x718e90, 0.85));
      var sun = new THREE.DirectionalLight(0xffefd7, 1.1);
      sun.position.set(-3, 6, 4);
      scene.add(sun);
      island = new THREE.Group();
      island.rotation.y = -0.3;
      scene.add(island);

      var waterTop = new THREE.MeshStandardMaterial({ color: 0x4eafc9, roughness: 0.85, flatShading: true });
      var waterSide = new THREE.MeshStandardMaterial({ color: 0x4396b8, roughness: 0.8, flatShading: true });
      var rock = new THREE.MeshStandardMaterial({ color: 0xb9a78c, roughness: 1, flatShading: true });
      var grass = new THREE.MeshStandardMaterial({ color: 0x95bd73, roughness: 1, flatShading: true });
      [waterTop, waterSide, rock, grass].forEach(function (material) { material.color.convertSRGBToLinear(); });
      var placeholders = [];
      // A fixed miniature, measured in the hexagon kit's one-unit tile spacing.
      for (var q = -2; q <= 2; q++) {
        for (var r = -2; r <= 2; r++) {
          var ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
          if (ring > 2) continue;
          var x = q + r * 0.5, z = r * Math.sqrt(3) / 2;
          var depth = 0.38 + (2 - ring) * 0.17;
          var sea = track(new THREE.Mesh(new THREE.CylinderGeometry(0.575, 0.575, depth, 6), [waterSide, waterTop, waterSide]));
          sea.position.set(x, -depth / 2 - 0.03, z);
          island.add(sea);
          var base = track(new THREE.Mesh(new THREE.CylinderGeometry(0.575, 0.36, 0.28, 6), rock));
          base.position.set(x, -depth - 0.17, z);
          island.add(base);
          if (ring < 2) {
            var tile = track(new THREE.Mesh(new THREE.CylinderGeometry(0.575, 0.575, 0.2, 6), grass));
            tile.position.set(x, 0.1, z);
            island.add(tile);
            placeholders.push({ tile: tile, q: q, r: r });
          }
        }
      }
      var dir = 'assets/kenney-hexagon-kit/';
      var manager = new THREE.LoadingManager();
      manager.setURLModifier(function (url) {
        return url.indexOf('colormap.png') !== -1 ? dir + 'Textures/variation-a.png' : url;
      });
      var loader = new THREE.GLTFLoader(manager);
      var names = ['grass', 'unit-tree', 'building-house', 'path-straight'];
      Promise.all(names.map(function (name) {
        return new Promise(function (resolve, reject) {
          loader.load(dir + name + '.glb', function (gltf) {
            var model = track(gltf.scene);
            // The meadow vegetation occupies this column in the kit's atlas.
            var tint = new THREE.Color(0x8fbb68).convertSRGBToLinear();
            model.traverse(function (node) {
              if (!node.isMesh) return;
              var uv = node.geometry.attributes.uv;
              var colors = [];
              for (var i = 0; i < uv.count; i++) {
                var green = Math.abs(uv.getX(i) - 0.34375) < 0.002;
                colors.push(green ? tint.r : 1, green ? tint.g : 1, green ? tint.b : 1);
              }
              node.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
              node.material.vertexColors = true;
              node.material.needsUpdate = true;
            });
            if (closed || !renderer) disposeResources();
            resolve(model);
          }, undefined, reject);
        });
      })).then(function (models) {
        if (closed || !renderer) return;
        placeholders.forEach(function (cell) {
          var index = cell.q === 0 && cell.r === 0 ? 2 : 0;
          var model = models[index].clone(true);
          model.position.copy(cell.tile.position);
          model.position.y = 0;
          island.remove(cell.tile);
          island.add(model);
        });
        [[-1, 0, 1.4], [0, -1, 1.7], [-1, 1, 1.2], [1, -1, 1.3]].forEach(function (tree) {
          var model = models[1].clone(true);
          model.scale.setScalar(tree[2]);
          model.position.set(tree[0] + tree[1] * 0.5, 0.2, tree[1] * Math.sqrt(3) / 2);
          island.add(model);
        });
        var path = models[3].clone(true);
        path.position.set(1, 0.201, 0);
        island.add(path);
        stage.classList.add('ready');
        resize();
      }).catch(fallback);
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
      document.addEventListener('visibilitychange', syncMotion);
      reduced.addEventListener('change', syncMotion);
      canvas.addEventListener('webglcontextlost', function () {
        if (!closed && renderer) fallback();
      });
      resize();
    } catch (err) {
      fallback(); // The inline island illustration remains visible without WebGL.
    }
  }

  function enter() {
    if (busy || closed) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    root.querySelectorAll('.landing-action, .landing-local').forEach(function (button) { button.disabled = true; });
    status.textContent = 'Opening your journals…';
    // Release the preview before starting the game renderer, including its GPU resources.
    stage.classList.remove('ready');
    disposePreview();
    Promise.resolve().then(options.openJournals).then(function () {
      closed = true;
      root.hidden = true;
      document.body.classList.remove('landing-visible');
      background.forEach(function (entry) { entry.node.inert = entry.inert; });
      var target = document.getElementById('gate').classList.contains('open')
        ? document.getElementById('gate-name') : document.getElementById('galaxy-new');
      if (target) target.focus();
    }).catch(function (err) {
      console.error('[landing] could not open journals', err);
      root.removeAttribute('aria-busy');
      status.textContent = 'Your journals could not open. Please refresh and try again in a browser with WebGL enabled.';
    });
  }

  var api = {
    enter: enter,
    onLogin: function () { MI.auth.login(); },
    onSignup: function () { MI.auth.signup(); },
    onContinueLocally: function () { MI.auth.continueLocally(); },
    init: function (config) {
      options = config;
      root = document.getElementById('landing');
      stage = document.getElementById('landing-stage');
      canvas = document.getElementById('landing-canvas');
      motion = document.getElementById('landing-motion');
      status = document.getElementById('landing-status');
      Array.prototype.forEach.call(document.body.children, function (node) {
        if (node === root || node.tagName === 'SCRIPT' || node.id === 'auth-dialog' || node.id === 'account-bar') return;
        background.push({ node: node, inert: node.inert });
        node.inert = true;
      });
      document.getElementById('loading').classList.add('hide');
      document.getElementById('landing-login').addEventListener('click', function () { api.onLogin(); });
      document.getElementById('landing-signup').addEventListener('click', function () { api.onSignup(); });
      document.getElementById('landing-local').addEventListener('click', function () { api.onContinueLocally(); });
      motion.addEventListener('click', function () { paused = !paused; syncMotion(); });
      preview();
    }
  };
  MI.landing = api;
})();
