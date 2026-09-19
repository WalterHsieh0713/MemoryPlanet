// MI.world.landAnimals — GLB-based pets that walk on land only, in both views. Unlike the
// procedural sky pets in cosmetics.js (which orbit above the island), these load a real model
// from Kenney's Cube Pets pack (assets/standalone/animals/cube-pets/) and wander by stepping
// tile to tile: pick a random LAND neighbour of the current tile, walk to it, repeat. Because a
// target is only ever chosen from tiles already known to be land, it can't step into water or
// off the island by construction — there's no separate boundary/fall check.
//
// This module knows nothing about world.js's internal state or MI.store/MI.island — world.js
// hands it an `isLand(id)` check and a tile-id -> {x,y,z} position lookup each call, one set
// for the sphere view and one for the flat view (the flat one keyed by world.js's own coiled
// island layout, since a hex grid neighbour isn't necessarily an adjacent cell once coiled).
//
// Adding another animal later is one line in ANIMALS below, once its .glb is sorted into that
// same folder (deer/cow/tiger are already there from an earlier asset pass).
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  var PACK = 'assets/standalone/animals/cube-pets/';
  var STEP_MIN = 1.5, STEP_MAX = 2.5; // seconds per tile-to-tile walk, varied for less robotic pacing
  var PAUSE_MIN = 0.7, PAUSE_MAX = 1.8; // seconds spent standing on each tile before the next step
  var HOP_HEIGHT = 0.05; // these models have no walk animation, so a small bob stands in for one

  var ANIMALS = {
    dog: 'animal-dog.glb'
  };

  function isLandAnimal(id) {
    return !!id && Object.prototype.hasOwnProperty.call(ANIMALS, id);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // --- Loading --------------------------------------------------------------------------
  // Own LoadingManager, separate from the hexagon-kit's — this is a different pack with its
  // own colormap, and CLAUDE.md's rule is one LoadingManager per pack.

  var loader = null;
  var templateCache = {};

  function getLoader() {
    if (!loader) {
      var manager = new THREE.LoadingManager();
      manager.setURLModifier(function (url) {
        if (url.indexOf('colormap.png') !== -1) return PACK + 'Textures/variation-a.png';
        return url;
      });
      loader = new THREE.GLTFLoader(manager);
    }
    return loader;
  }

  // Loads and normalises one animal's model once (centred on X/Z, resting at y=0, shadows on),
  // cached so every instance clones the same geometry/materials rather than reloading.
  function loadTemplate(id) {
    var file = ANIMALS[id];
    if (!file) return Promise.resolve(null);
    if (!templateCache[id]) {
      templateCache[id] = new Promise(function (resolve) {
        getLoader().load(PACK + file, function (gltf) {
          var group = new THREE.Group();
          group.add(gltf.scene);
          var box = new THREE.Box3().setFromObject(gltf.scene);
          var center = box.getCenter(new THREE.Vector3());
          gltf.scene.position.x -= center.x;
          gltf.scene.position.z -= center.z;
          gltf.scene.position.y -= box.min.y;
          group.traverse(function (node) {
            if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
          });
          resolve(group);
        }, undefined, function () { resolve(null); });
      });
    }
    return templateCache[id];
  }

  function newWalker() {
    return { group: null, tileId: null, targetId: null, fromTileId: null, t: 1, duration: 1.6, pause: 0 };
  }

  // Two live instances sharing one loaded model — one positioned for the sphere view, one for
  // the flat view — so both can keep wandering independently while only one is ever shown.
  function makeWalkerPair(id) {
    return loadTemplate(id).then(function (template) {
      if (!template) return null;
      var sphere = newWalker(); sphere.group = template.clone(true);
      var flat = newWalker(); flat.group = template.clone(true);
      return { sphere: sphere, flat: flat };
    });
  }

  // --- Wander FSM, shared by both views -------------------------------------------------

  function randomStepDuration() {
    return STEP_MIN + Math.random() * (STEP_MAX - STEP_MIN);
  }

  function randomPauseDuration() {
    return PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
  }

  // Only ever chooses among tiles `neighborsOf` reports as directly, visually adjacent to the
  // current one — the one thing that guarantees a single step can never cross more than one
  // tile, regardless of what neighborsOf considers "adjacent" in a given view.
  function pickNextTile(walker, neighborsOf, isLand) {
    var options = neighborsOf(walker.tileId).filter(isLand);
    if (walker.fromTileId !== null) {
      // Prefer not to immediately double back, unless that's the only way to go.
      var forward = options.filter(function (id) { return id !== walker.fromTileId; });
      if (forward.length) options = forward;
    }
    if (!options.length) return walker.tileId; // dead end: stay put until the island changes
    return options[Math.floor(Math.random() * options.length)];
  }

  // Keeps walker.tileId/targetId/t/pause valid and advancing: stand still at tileId for
  // `pause` seconds, then walk to a freshly-chosen neighbour over `duration` seconds, repeat.
  // Self-heals if the current tile stops being land (e.g. the planet just grew onto a new
  // grid, so old tile ids no longer apply, or the view just switched to one whose layout
  // doesn't include this tile yet) by re-anchoring via `findAnchor()`. Returns false when
  // there's nowhere land to stand at all yet.
  function advance(walker, dt, isLand, neighborsOf, findAnchor) {
    if (walker.tileId === null || !isLand(walker.tileId)) {
      walker.tileId = (walker.tileId !== null && isLand(walker.tileId)) ? walker.tileId : findAnchor();
      walker.targetId = walker.tileId;
      walker.fromTileId = null;
      walker.t = 1;
      walker.pause = randomPauseDuration();
    }
    if (walker.tileId === null) return false;

    if (walker.t >= 1) {
      if (walker.pause > 0) {
        walker.pause -= dt;
        return true; // standing still at walker.tileId (t=1 already renders exactly there)
      }
      var previous = walker.tileId;
      if (walker.targetId !== null && walker.targetId !== walker.tileId) walker.tileId = walker.targetId;
      walker.fromTileId = previous;
      walker.targetId = pickNextTile(walker, neighborsOf, isLand);
      walker.t = 0;
      walker.duration = randomStepDuration();
    }

    walker.t = Math.min(1, walker.t + dt / walker.duration);
    if (walker.t >= 1) walker.pause = randomPauseDuration();
    return true;
  }

  // --- Sphere view ------------------------------------------------------------------------
  // ctx: { isLand(id), neighborsOf(id) -> [ids], findAnchor() -> id|null, height, scale }.
  // height/scale mirror how world.js sizes/places its other sphere props (state.spacing-
  // derived, RADIUS + LAND_LIFT) — these groups live inside the `planet` Group, which already
  // applies worldScale, so positions here stay in that same pre-scale unit-sphere space.

  function updateSphere(walker, dt, ctx) {
    if (!walker.group) return;
    if (!advance(walker, dt, ctx.isLand, ctx.neighborsOf, ctx.findAnchor)) return;

    var fromDir = ctx.dirOf(walker.tileId);
    var toDir = ctx.dirOf(walker.targetId);
    if (!fromDir || !toDir) return;
    var ease = easeInOut(walker.t);
    var dir = fromDir.clone().lerp(toDir, ease).normalize();
    var hop = Math.sin(Math.PI * walker.t) * HOP_HEIGHT;
    walker.group.position.copy(dir).multiplyScalar(ctx.height + hop);
    walker.group.scale.setScalar(ctx.scale);

    if (fromDir.distanceToSquared(toDir) > 1e-8) {
      var up = dir.clone();
      var forward = toDir.clone().sub(fromDir);
      forward.sub(up.clone().multiplyScalar(forward.dot(up)));
      if (forward.lengthSq() > 1e-8) {
        forward.normalize();
        var right = new THREE.Vector3().crossVectors(up, forward).normalize();
        forward.crossVectors(right, up).normalize();
        walker.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
      }
    }
  }

  // --- Flat view ----------------------------------------------------------------------------
  // ctx: { isLand(id), neighborsOf(id), findAnchor(), centres: {id: {x,z}}, baseY, scale }.
  // `centres` is world.js's own coiled-island layout (MI.island), already centred — the same
  // positions buildings/people use there, so this always lands in the right visual spot.

  function updateFlat(walker, dt, ctx) {
    if (!walker.group) return;
    if (!advance(walker, dt, ctx.isLand, ctx.neighborsOf, ctx.findAnchor)) return;

    var from = ctx.centres[walker.tileId], to = ctx.centres[walker.targetId];
    if (!from || !to) return;
    var ease = easeInOut(walker.t);
    var x = from.x + (to.x - from.x) * ease;
    var z = from.z + (to.z - from.z) * ease;
    var hop = Math.sin(Math.PI * walker.t) * HOP_HEIGHT;
    walker.group.position.set(x, ctx.baseY + hop, z);
    walker.group.scale.setScalar(ctx.scale);
    if (Math.abs(to.x - from.x) > 1e-6 || Math.abs(to.z - from.z) > 1e-6) {
      walker.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    }
  }

  MI.world.landAnimals = {
    isLandAnimal: isLandAnimal,
    makeWalkerPair: makeWalkerPair,
    updateSphere: updateSphere,
    updateFlat: updateFlat
  };
})();
