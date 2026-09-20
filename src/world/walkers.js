// MI.world.walkers — GLB-based walkers that move tile to tile in both views. Pets use
// Kenney Cube Pets; memory residents use Kenney Mini Characters. Each wanders
// by stepping tile to tile — pick a random walkable neighbour, walk to it, pause, repeat.
//
// This module knows nothing about world.js's internal state or MI.store/MI.island. world.js
// hands it a "can I stand here" test and a tile-id -> position lookup each call, one set for
// the sphere view and one for the flat view (the flat one keyed by world.js's own coiled
// island layout, since a hex grid neighbour isn't necessarily an adjacent cell once coiled).
// That injection is the whole reason the two kinds can differ so much: a pet is given every
// land tile, a resident usually follows roads, and neither case needs new movement code.
// Because a target is only ever chosen from tiles the caller already vouched for, a walker
// cannot step into water or off the island by construction — there is no separate fall check.
//
// Pet additions also need a catalog entry in src/game/economy.js. Residents come from memories.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  var HOP_HEIGHT = 0.05; // stands in for a walk cycle on models that have none (the pets)
  var WORLD_UP = new THREE.Vector3(0, 1, 0);
  var WORLD_SIDE = new THREE.Vector3(1, 0, 0);

  // Two kinds of walker share this module. They differ only in which pack they load from and
  // how long they idle — the wander FSM below is identical, and *where* each may walk is not
  // decided here at all: world.js injects the "can I stand here" test (any land tile for pets,
  // roads where available for residents), so the same movement handles both.
  //
  // Sizes are deliberately NOT normalised per model. Within a pack they are already uniform
  // (pets 1.43-2.01 tall, characters 0.66-0.79), so one scale per kind in world.js is enough
  // and the spread that is left reads as character. Note the two packs are modelled at very
  // different raw sizes though — a character is ~0.42x a pet in raw units — so the two scale
  // constants in world.js are not comparable numbers; see the note there.
  var KINDS = {
    animal: {
      pack: 'assets/standalone/animals/cube-pets/',
      step: [1.5, 2.5],   // seconds per tile-to-tile walk, varied for less robotic pacing
      pause: [0.7, 1.8],  // seconds standing on a tile before moving on
      models: {
        bunny: 'animal-bunny.glb',
        pig: 'animal-pig.glb',
        dog: 'animal-dog.glb',
        fox: 'animal-fox.glb',
        cow: 'animal-cow.glb',
        deer: 'animal-deer.glb',
        lion: 'animal-lion.glb',
        elephant: 'animal-elephant.glb'
      }
    },
    // People stroll rather than scurry, but they must keep visibly moving: a character is
    // confined to the road route, and over half of that route is building tiles it stands
    // *on*, so a long idle there reads as "it isn't working" rather than as calm. Step plus
    // pause is kept to 3-5s so it hops to the next tile at roughly that rhythm.
    character: {
      pack: 'assets/standalone/characters/mini-characters/',
      step: [1.2, 1.8],
      pause: [2.0, 3.0],
      models: {
        'male-a': 'character-male-a.glb',
        'male-b': 'character-male-b.glb',
        'male-c': 'character-male-c.glb',
        'male-d': 'character-male-d.glb',
        'male-e': 'character-male-e.glb',
        'male-f': 'character-male-f.glb',
        'female-a': 'character-female-a.glb',
        'female-b': 'character-female-b.glb',
        'female-c': 'character-female-c.glb',
        'female-d': 'character-female-d.glb',
        'female-e': 'character-female-e.glb',
        'female-f': 'character-female-f.glb'
      }
    }
  };

  // Ids are unique across both registries, so an id alone says which pack and pacing to use.
  function kindOf(id) {
    if (!id) return null;
    var found = null;
    Object.keys(KINDS).forEach(function (kind) {
      if (Object.prototype.hasOwnProperty.call(KINDS[kind].models, id)) found = kind;
    });
    return found;
  }

  function isPet(id) { return kindOf(id) === 'animal'; }
  function isResident(id) { return kindOf(id) === 'character'; }
  var RESIDENT_MODELS = Object.keys(KINDS.character.models);
  function residentModelFor(person) {
    if (person && person.appearance && isResident(person.appearance.model)) return person.appearance.model;
    var key = String(person && person.id || '');
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
    return RESIDENT_MODELS[hash % RESIDENT_MODELS.length];
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // --- Loading --------------------------------------------------------------------------
  // One LoadingManager per pack, both separate from the hexagon-kit's: each pack ships its own
  // colormap, and CLAUDE.md's rule is one LoadingManager per pack.

  var loaders = {};
  var templateCache = {};
  // Clips belong to the model but CANNOT live on its userData: Object3D.clone() deep-copies
  // userData through JSON, which would turn every AnimationClip into a plain object. Keyed off
  // the object instead, and carried to each clone by cloneModel.
  var clipsOf = new WeakMap();

  function getLoader(kind) {
    if (!loaders[kind]) {
      var pack = KINDS[kind].pack;
      var manager = new THREE.LoadingManager();
      manager.setURLModifier(function (url) {
        if (url.indexOf('colormap.png') !== -1) return pack + 'Textures/variation-a.png';
        return url;
      });
      loaders[kind] = new THREE.GLTFLoader(manager);
    }
    return loaders[kind];
  }

  // Loads and normalises one model once (centred on X/Z, resting at y=0, shadows on), cached
  // so every instance clones the same geometry/materials rather than reloading.
  function loadTemplate(id) {
    var kind = kindOf(id);
    if (!kind) return Promise.resolve(null);
    var spec = KINDS[kind];
    var file = spec.models[id];
    if (!templateCache[id]) {
      templateCache[id] = new Promise(function (resolve) {
        getLoader(kind).load(spec.pack + file, function (gltf) {
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
          // The Mini Characters ship a full clip set (idle, walk, sprint, emotes...); the Cube
          // Pets ship none and fall back to the hop.
          clipsOf.set(group, gltf.animations || []);
          resolve(group);
        }, undefined, function () { resolve(null); });
      });
    }
    return templateCache[id];
  }

  // Object3D.clone() on a skinned model leaves every copy driving the ORIGINAL's bones, so
  // the character is drawn where the template was loaded (near the world origin, at full
  // size) instead of where you put the copy. Rebuild each copy's skeleton from its own bones
  // — the same job as SkeletonUtils.clone, which the r128 build we vendor does not include.
  function cloneModel(source) {
    var clone = source.clone(true);
    var sourceOf = new Map(), cloneOf = new Map();
    (function pair(a, b) {
      sourceOf.set(b, a);
      cloneOf.set(a, b);
      for (var i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
    })(source, clone);
    clone.traverse(function (node) {
      if (!node.isSkinnedMesh) return;
      var original = sourceOf.get(node);
      node.skeleton = original.skeleton.clone();
      node.skeleton.bones = original.skeleton.bones.map(function (bone) { return cloneOf.get(bone); });
      node.bindMatrix.copy(original.bindMatrix);
      node.bind(node.skeleton, node.bindMatrix);
    });
    var clips = clipsOf.get(source);
    if (clips) clipsOf.set(clone, clips);
    return clone;
  }

  // --- Animation ---------------------------------------------------------------------------
  // The clips are in the GLB already; all this does is blend between standing and walking and
  // keep the walk in step with how fast the figure is actually travelling, so its feet don't
  // skate. An AnimationClip binds by NODE NAME and clone() keeps names, so one loaded clip
  // drives every copy -- each through its own mixer, on its own skeleton.

  var BLEND_SECONDS = 0.18;   // standing <-> walking crossfade
  // Model units one walk cycle covers, near enough: the clips animate in place, so this is the
  // rate that looks right rather than a measurement. Raise it to turn the legs over slower.
  var WALK_STRIDE = 1.9;
  var MIN_RATE = 0.55, MAX_RATE = 2.2;

  // `phase` (0..1) offsets where in the cycle this instance starts, so a crowd of residents
  // doesn't march in lockstep. Returns null when the model has nothing to play.
  function makeAnimator(model, phase) {
    var clips = clipsOf.get(model);
    if (!clips || !clips.length) return null;
    var walkClip = THREE.AnimationClip.findByName(clips, 'walk');
    var idleClip = THREE.AnimationClip.findByName(clips, 'idle');
    if (!walkClip && !idleClip) return null;

    var mixer = new THREE.AnimationMixer(model);
    // Both actions run the whole time and are cross-weighted, so nothing has to be started,
    // stopped or scheduled as the walker sets off and stops again.
    var walk = walkClip && mixer.clipAction(walkClip);
    var idle = idleClip && mixer.clipAction(idleClip);
    if (walk) { walk.play(); walk.setEffectiveWeight(0); walk.time = (phase || 0) * walkClip.duration; }
    if (idle) { idle.play(); idle.setEffectiveWeight(1); idle.time = (phase || 0) * idleClip.duration; }
    var blend = 0; // 0 standing, 1 walking

    return {
      // `speed` is the distance covered this frame in the MODEL's own units (world distance
      // divided by the scale it is drawn at), so one setting works at every planet size.
      update: function (dt, speed) {
        var target = speed > 1e-4 ? 1 : 0;
        var step = dt / BLEND_SECONDS;
        blend += Math.max(-step, Math.min(step, target - blend));
        if (walk) {
          walk.setEffectiveWeight(blend);
          if (target) {
            walk.setEffectiveTimeScale(
              Math.max(MIN_RATE, Math.min(MAX_RATE, speed / WALK_STRIDE)));
          }
        }
        if (idle) idle.setEffectiveWeight(1 - blend);
        mixer.update(dt);
      },
      dispose: function () {
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
      }
    };
  }

  // Skip a mixer whose model isn't on screen: both view instances keep walking, but only one
  // of them is ever inside a visible group.
  function isShown(obj) {
    for (var node = obj; node; node = node.parent) {
      if (!node.visible) return false;
      if (!node.parent) return node.type === 'Scene'; // detached: nothing is drawing it
    }
    return false;
  }

  // Pacing rides on the walker rather than on module constants, so the two kinds can idle at
  // completely different rhythms through the same FSM.
  function newWalker(spec) {
    return {
      group: null, animator: null, tileId: null, targetId: null, fromTileId: null,
      t: 1, duration: 1.6, pause: 0,
      stepRange: spec.step, pauseRange: spec.pause
    };
  }

  // Two live instances sharing one loaded model — one positioned for the sphere view, one for
  // the flat view — so both can keep wandering independently while only one is ever shown.
  function makeWalkerPair(id, fallback) {
    var kind = kindOf(id);
    if (!kind) return Promise.resolve(null);
    return loadTemplate(id).then(function (template) {
      if (!template && !fallback) return null;
      if (!template) template = fallback();
      var spec = KINDS[kind];
      var phase = Math.random();
      var sphere = newWalker(spec); sphere.group = cloneModel(template);
      var flat = newWalker(spec); flat.group = cloneModel(template);
      sphere.animator = makeAnimator(sphere.group, phase);
      flat.animator = makeAnimator(flat.group, phase);
      return { kind: kind, sphere: sphere, flat: flat };
    });
  }

  // --- Wander FSM, shared by both views -------------------------------------------------

  function inRange(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  function randomStepDuration(walker) {
    return inRange(walker.stepRange);
  }

  function randomPauseDuration(walker) {
    return inRange(walker.pauseRange);
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
      walker.pause = randomPauseDuration(walker);
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
      walker.duration = randomStepDuration(walker);
    }

    walker.t = Math.min(1, walker.t + dt / walker.duration);
    if (walker.t >= 1) walker.pause = randomPauseDuration(walker);
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
    var hop = walker.animator ? 0 : Math.sin(Math.PI * walker.t) * HOP_HEIGHT;
    var was = walker.group.position.clone();
    walker.group.position.copy(dir).multiplyScalar(ctx.height + hop);
    // Stand beside the middle of the tile rather than on it, the same trick spawnPerson uses:
    // a walker that keeps to the roads spends much of its time on tiles that already carry a
    // building, and dead centre puts it inside one. Taken against a fixed world axis (not the
    // direction of travel) so it varies smoothly with `dir` and never pops at a step boundary.
    if (ctx.offset) {
      var axis = Math.abs(dir.y) > 0.95 ? WORLD_SIDE : WORLD_UP;
      var side = new THREE.Vector3().crossVectors(dir, axis);
      if (side.lengthSq() > 1e-8) walker.group.position.addScaledVector(side.normalize(), ctx.offset);
    }
    walker.group.scale.setScalar(ctx.scale);
    animateWalker(walker, dt, was, ctx.scale);

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

  // How far it actually travelled this frame, in the model's own units -- the walk cycle is
  // paced off that, so the same walker looks right on a 42-tile planet and on a 1002-tile one.
  // A walker standing still (paused, or a step it could not take) gets 0 and settles to idle.
  function animateWalker(walker, dt, wasAt, scale) {
    if (!walker.animator || dt <= 0) return;
    if (!isShown(walker.group)) return;
    var moved = walker.t < 1 ? walker.group.position.distanceTo(wasAt) : 0;
    walker.animator.update(dt, moved / dt / (scale || 1));
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
    var hop = walker.animator ? 0 : Math.sin(Math.PI * walker.t) * HOP_HEIGHT;
    var was = walker.group.position.clone();
    walker.group.position.set(x + (ctx.offset || 0), ctx.baseY + hop, z); // beside the tile centre — see updateSphere
    walker.group.scale.setScalar(ctx.scale);
    animateWalker(walker, dt, was, ctx.scale);
    if (Math.abs(to.x - from.x) > 1e-6 || Math.abs(to.z - from.z) > 1e-6) {
      walker.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    }
  }

  MI.world.walkers = {
    isPet: isPet,
    isResident: isResident,
    residentModelFor: residentModelFor,
    makeModel: function (id) { return loadTemplate(id).then(function (model) { return model && cloneModel(model); }); },
    makeAnimator: makeAnimator,
    isShown: isShown,
    makeWalkerPair: makeWalkerPair,
    updateSphere: updateSphere,
    updateFlat: updateFlat
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MI.world.walkers;
})();
