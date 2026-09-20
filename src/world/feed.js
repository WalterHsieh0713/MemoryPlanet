// MI.world.feedStage — a tiny Three scene just for feeding a treat: one pet on a hex
// tile, a hop when they eat, hearts popping off them. The overlay DOM and the drag
// live in ui.js; this only draws. One WebGLRenderer, reused, so opening the pantry
// twice does not burn extra contexts.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  var TILE_WIDTH = 2.35;
  var PET_HEIGHT = 1.08;

  var canvas = null;
  var renderer = null;
  var scene = null;
  var camera = null;
  var lights = null;
  var stage = null;
  var tile = null;
  var pet = null;
  var petBaseY = 0;
  var hearts = [];
  var heartTex = null;
  var raf = 0;
  var lastT = 0;
  var idleT = 0;
  var celebT = -1;
  var reduced = false;

  function heartTexture() {
    if (heartTex) return heartTex;
    var c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#f07178';
    g.beginPath();
    var x = 32, y = 18, s = 18;
    g.moveTo(x, y + s * 0.3);
    g.bezierCurveTo(x, y - s * 0.2, x - s, y - s * 0.2, x - s, y + s * 0.35);
    g.bezierCurveTo(x - s, y + s * 0.75, x, y + s * 1.05, x, y + s * 1.2);
    g.bezierCurveTo(x, y + s * 1.05, x + s, y + s * 0.75, x + s, y + s * 0.35);
    g.bezierCurveTo(x + s, y - s * 0.2, x, y - s * 0.2, x, y + s * 0.3);
    g.fill();
    heartTex = new THREE.CanvasTexture(c);
    return heartTex;
  }

  function fitWidth(obj, width) {
    var box = new THREE.Box3().setFromObject(obj);
    var size = box.getSize(new THREE.Vector3());
    var span = Math.max(size.x, size.z, 0.001);
    obj.scale.multiplyScalar(width / span);
    box.setFromObject(obj);
    obj.position.x -= (box.min.x + box.max.x) / 2;
    obj.position.z -= (box.min.z + box.max.z) / 2;
    obj.position.y -= box.min.y;
  }

  function fitHeight(obj, height, y0) {
    var box = new THREE.Box3().setFromObject(obj);
    var size = box.getSize(new THREE.Vector3());
    obj.scale.multiplyScalar(height / Math.max(size.y, 0.001));
    box.setFromObject(obj);
    obj.position.x -= (box.min.x + box.max.x) / 2;
    obj.position.z -= (box.min.z + box.max.z) / 2;
    obj.position.y += y0 - box.min.y;
  }

  function fallbackPet() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.55, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xf2c49b })
    );
    body.position.y = 0.35;
    body.castShadow = true;
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xf7d7b8 })
    );
    head.position.set(0, 0.78, 0.12);
    head.castShadow = true;
    g.add(body);
    g.add(head);
    return g;
  }

  function themeOf() {
    var id = MI.economy && MI.economy.equipped ? MI.economy.equipped('themes') : 'meadow';
    return (MI.world.themes && MI.world.themes.get(id)) || {
      land: 0x8fc75a, landSide: 0x8a6239
    };
  }

  // A hex podium, not a kit GLB: the atlas grass tile came out white here (its UVs
  // need the world's recolour pass), and a polygon plate is what the overlay asked for.
  function makeHexTile() {
    var theme = themeOf();
    var grass = new THREE.Color(theme.land).multiplyScalar(0.72);
    var mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.12, 1.12, 0.22, 6),
      new THREE.MeshLambertMaterial({ color: grass })
    );
    mesh.rotation.y = Math.PI / 6;
    mesh.position.y = 0.11;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    var g = new THREE.Group();
    g.add(mesh);
    return g;
  }

  function clearHearts() {
    hearts.forEach(function (h) {
      if (h.parent) h.parent.remove(h);
      if (h.material) h.material.dispose();
    });
    hearts = [];
  }

  function spawnHearts() {
    clearHearts();
    if (!pet || !scene) return;
    var box = new THREE.Box3().setFromObject(pet);
    var origin = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y + 0.08,
      (box.min.z + box.max.z) / 2
    );
    var n = reduced ? 5 : 12;
    var tex = heartTexture();
    for (var i = 0; i < n; i++) {
      var mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, alphaTest: 0.35, color: 0xffffff
      });
      var spr = new THREE.Sprite(mat);
      spr.position.copy(origin);
      var ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      var speed = 0.55 + Math.random() * 0.55;
      spr.userData.vel = new THREE.Vector3(
        Math.cos(ang) * speed * 0.55,
        1.1 + Math.random() * 0.7,
        Math.sin(ang) * speed * 0.55
      );
      spr.userData.age = 0;
      spr.userData.life = 1.05 + Math.random() * 0.35;
      var s = 0.46 + Math.random() * 0.22;
      spr.scale.set(s, s, s);
      scene.add(spr);
      hearts.push(spr);
    }
  }

  function hopY(t) {
    // Three joyful hops that settle. t is seconds into the celebration.
    var hops = [
      { at: 0.00, dur: 0.28, h: 0.42 },
      { at: 0.30, dur: 0.26, h: 0.30 },
      { at: 0.58, dur: 0.24, h: 0.18 }
    ];
    for (var i = 0; i < hops.length; i++) {
      var h = hops[i];
      if (t >= h.at && t < h.at + h.dur) {
        var u = (t - h.at) / h.dur;
        return Math.sin(u * Math.PI) * h.h;
      }
    }
    return 0;
  }

  function ensureLights() {
    if (lights) return;
    lights = new THREE.Group();
    var hemi = new THREE.HemisphereLight(0xcfe9f5, 0x6f9c5e, 1.05);
    var sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
    sun.position.set(2.4, 5.2, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 14;
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    lights.add(hemi);
    lights.add(sun);
    var fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-2, 2, -1);
    lights.add(fill);
  }

  function ensureScene() {
    if (scene) return;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(2.35, 2.55, 3.15);
    camera.lookAt(0, 0.7, 0);
    ensureLights();
    scene.add(lights);
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 36),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.002;
    ground.receiveShadow = true;
    scene.add(ground);
    stage = new THREE.Group();
    scene.add(stage);
  }

  function attachRenderer(el) {
    canvas = el;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x000000, 0);
    }
  }

  function resize() {
    if (!renderer || !canvas || !camera) return;
    var w = canvas.clientWidth || 1;
    var h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;
    idleT += dt;
    if (pet) {
      var y = petBaseY;
      if (celebT >= 0) {
        celebT += dt;
        y += reduced ? hopY(Math.min(celebT, 0.28)) * 0.35 : hopY(celebT);
        if (celebT > 1.45) celebT = -1;
      } else {
        y += Math.abs(Math.sin(idleT * 2.6)) * 0.035;
      }
      pet.position.y = y;
      pet.rotation.y = Math.sin(idleT * 0.7) * 0.12;
    }
    for (var i = hearts.length - 1; i >= 0; i--) {
      var spr = hearts[i];
      spr.userData.age += dt;
      var u = spr.userData.age / spr.userData.life;
      spr.position.addScaledVector(spr.userData.vel, dt);
      spr.userData.vel.y += dt * 0.35;
      spr.userData.vel.multiplyScalar(0.985);
      spr.material.opacity = Math.max(0, 1 - u);
      var s = spr.scale.x * (1 + dt * 0.4);
      spr.scale.set(s, s, s);
      if (u >= 1) {
        scene.remove(spr);
        spr.material.dispose();
        hearts.splice(i, 1);
      }
    }
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function startLoop() {
    if (raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function clearStage() {
    clearHearts();
    if (stage) {
      while (stage.children.length) stage.remove(stage.children[0]);
    }
    tile = null;
    pet = null;
    celebT = -1;
  }

  function show(petId) {
    ensureScene();
    clearStage();
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    idleT = 0;
    var petP = (MI.world.walkers && MI.world.walkers.makeModel)
      ? MI.world.walkers.makeModel(petId)
      : Promise.resolve(null);
    return petP.then(function (petSrc) {
      tile = makeHexTile();
      fitWidth(tile, TILE_WIDTH);
      stage.add(tile);
      var tileBox = new THREE.Box3().setFromObject(tile);
      var top = tileBox.max.y;
      pet = petSrc || fallbackPet();
      pet.traverse(function (node) {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
      });
      fitHeight(pet, PET_HEIGHT, top);
      petBaseY = pet.position.y;
      pet.rotation.y = 0.35;
      stage.add(pet);
      resize();
      startLoop();
    });
  }

  function hit(clientX, clientY) {
    if (!camera || !canvas || !pet) return false;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    var ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    var ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    var box = new THREE.Box3().setFromObject(pet);
    var sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    sphere.radius *= 1.35;
    if (ray.ray.intersectsSphere(sphere)) return true;
    if (tile && ray.intersectObject(tile, true).length) {
      // A drop on the hex still counts — the pet fills most of it.
      return true;
    }
    return false;
  }

  function celebrate() {
    if (!pet) return;
    celebT = 0;
    spawnHearts();
  }

  function attach(el) {
    if (!el) return;
    attachRenderer(el);
    ensureScene();
    resize();
  }

  function close() {
    stopLoop();
    clearStage();
  }

  MI.world.feedStage = {
    attach: attach,
    show: show,
    hit: hit,
    celebrate: celebrate,
    close: close,
    resize: resize
  };
})();
