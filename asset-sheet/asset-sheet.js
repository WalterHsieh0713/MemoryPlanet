// Memory Planet — /asset-sheet. A contact sheet for a folder of GLBs: every model drawn at a
// common size with its name and its real height under it.
//
// It exists because three "buildings" were catalogued and planted on the island before anyone
// rendered them, and they turned out to be rotor parts — a windmill's sails with no mill, a
// watermill's wheel with no mill house. `assets/standalone/` is sorted by folder name, not by
// inspection. Point this at a folder before adding anything from it.
//
// The folder listing comes from /api/assets in server.js, which is local-only, so this page is
// a dev tool and is kept out of the deploy (.vercelignore).
(function () {
  var CELL = 260;          // render resolution per cell; the CSS box is smaller, so it reads sharp
  var FRAME = 1.45;        // how much of the cell one model fills, as a multiple of its own size

  var el = {
    dir: document.getElementById('dir'),
    go: document.getElementById('go'),
    grid: document.getElementById('grid'),
    status: document.getElementById('status'),
    shortcuts: document.getElementById('shortcuts')
  };

  // Worth one click each: the packs this project actually draws from, plus the staging folders
  // most likely to be mined next.
  var SHORTCUTS = [
    'assets/kenney-hexagon-kit',
    'assets/standalone/buildings/pirate-kit',
    'assets/standalone/buildings/fantasy-town-kit',
    'assets/standalone/ships/pirate-kit',
    'assets/standalone/animals/cube-pets',
    'assets/standalone/characters/mini-characters',
    'assets/standalone/nature',
    'assets/standalone/decor'
  ];

  // Root-relative, always: this page is served from /asset-sheet/, so a bare "assets/..." would
  // resolve against that folder and 404 on every model.
  function urlFor(dir, file) {
    return '/' + dir + '/' + file;
  }

  // A pack's atlas sits beside its GLBs, but the name differs by where the pack came from: the
  // sorted folders renamed it to variation-a.png, the raw Kenney downloads kept colormap.png.
  // Try the sorted name and let the raw one stand as the fallback, so both work untouched.
  function loadWith(dir, file, atlas) {
    return new Promise(function (resolve, reject) {
      var manager = new THREE.LoadingManager();
      manager.setURLModifier(function (url) {
        return url.indexOf('colormap.png') !== -1 ? urlFor(dir, 'Textures/' + atlas) : url;
      });
      new THREE.GLTFLoader(manager)
        .load(urlFor(dir, file), resolve, undefined, reject);
    });
  }

  function load(dir, file) {
    return loadWith(dir, file, 'variation-a.png')
      .catch(function () { return loadWith(dir, file, 'colormap.png'); })
      .catch(function () { return null; });
  }

  function cell(name) {
    var box = document.createElement('div');
    box.className = 'cell';
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL;
    var label = document.createElement('div');
    label.className = 'name';
    label.textContent = name;
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'loading…';
    box.appendChild(canvas);
    box.appendChild(label);
    box.appendChild(meta);
    el.grid.appendChild(box);
    return { box: box, canvas: canvas, meta: meta };
  }

  // ONE WebGL renderer for the whole sheet, its output copied into each cell's 2D canvas. A
  // renderer per cell hits the browser's context limit on a pack of 160 models — and the cell
  // would have to keep its context alive to stay on screen, which is exactly what there isn't
  // room for. Copying the pixels out instead leaves each cell a plain, permanent image.
  var gl = null;
  function renderer() {
    if (!gl) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = CELL;
      gl = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      gl.setClearColor(0xeef7f2, 1);
    }
    return gl;
  }

  // One model, framed to fill its cell whatever size it was modelled at, lit like the app and
  // turned a little so depth reads. Its REAL height goes in the caption — that is the number
  // that catches a part masquerading as a whole object.
  function draw(canvas, gltf) {
    var gpu = renderer();
    var scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.15));
    var sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(4, 7, 5);
    scene.add(sun);

    var model = gltf.scene;
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var centre = box.getCenter(new THREE.Vector3());
    var span = Math.max(size.x, size.y, size.z) || 1;

    // Centred on X/Z and resting on y=0, the same normalisation walkers.js uses, so a model
    // whose origin is its axle (the watermill wheel) doesn't float or sink here either.
    model.position.set(-centre.x, -box.min.y, -centre.z);
    var holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(1 / span);
    holder.rotation.y = -Math.PI / 5;
    scene.add(holder);

    var camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    var distance = FRAME / Math.tan(Math.PI * 30 / 360);
    camera.position.set(distance * 0.55, distance * 0.45, distance * 0.8);
    camera.lookAt(0, 0.42, 0);
    gpu.render(scene, camera);
    // Copied in the same turn as the render: the drawing buffer is not preserved across
    // frames, so waiting would give an empty cell.
    canvas.getContext('2d').drawImage(gpu.domElement, 0, 0);
    return size;
  }

  function render(dir) {
    dir = dir.replace(/^\/+|\/+$/g, '');
    el.grid.innerHTML = '';
    el.status.textContent = 'reading ' + dir + '…';
    history.replaceState(null, '', '?dir=' + encodeURIComponent(dir));

    fetch('/api/assets?dir=' + encodeURIComponent(dir)).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.files || !data.files.length) {
        el.status.textContent = data.error
          ? 'no such folder: ' + dir
          : 'no .glb files in ' + dir + ' (try a subfolder)';
        return;
      }
      el.status.textContent = data.files.length + ' models in ' + dir;
      var failed = 0;
      // One at a time: a pack can hold 160 models, and loading them all at once stalls the tab.
      data.files.reduce(function (chain, file) {
        return chain.then(function () {
          var view = cell(file);
          return load(dir, file).then(function (gltf) {
            if (!gltf) {
              failed++;
              view.box.classList.add('failed');
              view.meta.textContent = 'failed to load';
              return;
            }
            var size = draw(view.canvas, gltf);
            view.meta.textContent = 'h ' + size.y.toFixed(2)
              + ' · w ' + size.x.toFixed(2) + ' · d ' + size.z.toFixed(2);
          });
        });
      }, Promise.resolve()).then(function () {
        el.status.textContent = data.files.length + ' models in ' + dir
          + (failed ? ' · ' + failed + ' failed to load' : '');
      });
    }).catch(function (err) {
      el.status.textContent = 'could not list ' + dir + ' — is server.js running? (' + err + ')';
    });
  }

  SHORTCUTS.forEach(function (dir) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = dir.replace('assets/', '').replace('standalone/', '');
    button.addEventListener('click', function () {
      el.dir.value = dir;
      render(dir);
    });
    el.shortcuts.appendChild(button);
  });

  el.go.addEventListener('click', function () { render(el.dir.value); });
  el.dir.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') render(el.dir.value);
  });

  var wanted = new URLSearchParams(location.search).get('dir');
  if (wanted) el.dir.value = wanted;
  render(el.dir.value);
})();
