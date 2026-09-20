// MI.world.walkers — GLB-based walkers in both views. Pets use Kenney Cube Pets; memory
// residents use Kenney Mini Characters. A pet wanders by stepping tile to tile — pick a random
// walkable neighbour, walk to it, pause, repeat. A resident does the same along the road between
// their memories, but on a tile of their own they loiter: they meander freely within half a tile
// of its centre (see Loitering below).
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
      rest: 1,            // stops at every tile: a pet potters, it is not going anywhere
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
    // A friend walking from one memory to another is GOING somewhere, so they do not stop on
    // the way: rest is 0, and the tiles between two memories are walked straight through at
    // one pace. Where they stop is decided by the caller instead (ctx.stopsAt -- world.js
    // passes the memories on their own route), and once there they loiter rather than stand.
    // `pause` is what they spend on a tile of their own, a dwell at a time; `step` is a tile's
    // worth of walking, which at ~0.7 tiles a second is the pace you walk at yourself.
    character: {
      pack: 'assets/standalone/characters/mini-characters/',
      step: [1.2, 1.8],
      pause: [2.0, 3.0],
      rest: 0,
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
    },
    // Ships sail the ocean instead of walking the land, which took no new movement code at
    // all: world.js hands the same FSM the water tiles rather than the land ones. They are
    // slow and never really stop — a ship becalmed mid-ocean for four seconds looks broken,
    // where a resident standing on a path looks like a resident standing on a path.
    ship: {
      pack: 'assets/standalone/ships/pirate-kit/',
      step: [7, 11],
      pause: [0, 0.6],   // only ever used at a dead end, since rest is 0
      rest: 0,           // "never really stop", as above: a ship holds its way between tiles
      models: {
        'ship-pirate-small.glb': 'ship-pirate-small.glb',
        'ship-pirate-medium.glb': 'ship-pirate-medium.glb',
        'ship-pirate-large.glb': 'ship-pirate-large.glb',
        'ship-small.glb': 'ship-small.glb',
        'ship-medium.glb': 'ship-medium.glb',
        'ship-large.glb': 'ship-large.glb'
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
      // speed is in tiles a second and is carried ACROSS tiles -- that is the whole of what
      // makes a walk one walk. pace is the journey's seconds-per-tile, 0 between journeys.
      speed: 0, pace: 0, stopAtEnd: true, facing: null,
      rest: spec.rest, stepRange: spec.step, pauseRange: spec.pause
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

  // One instance rather than a pair, for something that only ever appears in one view: the
  // ships sail the planet's ocean and the island has no sea around it to sail on, so a flat
  // copy would be a model loaded, cloned and animated for nothing.
  function makeWalkerSolo(id) {
    var kind = kindOf(id);
    if (!kind) return Promise.resolve(null);
    return loadTemplate(id).then(function (template) {
      if (!template) return null;
      var walker = newWalker(KINDS[kind]);
      walker.group = cloneModel(template);
      walker.animator = makeAnimator(walker.group, Math.random());
      return walker;
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

  // --- Getting there ----------------------------------------------------------------------
  // A walker crossing four tiles to reach a memory should read as ONE walk. It used to read as
  // four: every completed step set a fresh pause (for a friend, 2-3s of standing per 1.2-1.8s
  // of walking), every step re-rolled its own duration, and every step eased in and out of a
  // standstill at the tile boundary. Three separate reasons to stop dead in the middle of
  // going somewhere.
  //
  // So speed is carried on the walker instead of being a curve fitted to each tile. It ramps
  // up when the walker sets off, holds while there is another tile to cross -- straight
  // through the boundary, since nothing there ends the journey -- and ramps down into the
  // tile the walker actually means to stop at. `t` is still 0..1 across the current tile;
  // it is simply integrated from the speed now rather than eased.
  var ACCEL_SECONDS = 0.45; // standing to full pace, and full pace back to standing
  var CRAWL = 0.06;         // of full pace: the slowest it will still close the last sliver of
                            // a tile at, so arriving is never an asymptote

  // Does a walker that reaches `tileId` stop there? The caller answers where it has an
  // opinion -- world.js says a friend stops at the memories on their own route and nowhere
  // else -- and otherwise it is the kind's own `rest` chance, which is what a pet's pottering
  // from tile to tile is made of.
  function stopsHere(walker, tileId, stopsAt) {
    if (stopsAt) return !!stopsAt(tileId);
    return Math.random() < (walker.rest === undefined ? 1 : walker.rest);
  }

  // Leave the tile just reached for the next one on the route. False when there is nowhere to
  // go, in which case the walker is now pausing where it stands.
  function setOff(walker, ctx) {
    var previous = walker.tileId;
    if (walker.targetId !== null && walker.targetId !== walker.tileId) walker.tileId = walker.targetId;
    walker.fromTileId = previous;
    walker.targetId = ctx.chooseNext
      ? ctx.chooseNext(walker, ctx.neighborsOf, ctx.isLand)
      : pickNextTile(walker, ctx.neighborsOf, ctx.isLand);
    if (walker.targetId === walker.tileId) {
      halt(walker);
      return false;
    }
    // One pace for a whole journey. Re-rolling it per tile changed the walker's speed at
    // every boundary, which on its own was enough to make a walk read as separate hops.
    if (!walker.pace) walker.pace = randomStepDuration(walker);
    walker.duration = walker.pace;
    walker.stopAtEnd = stopsHere(walker, walker.targetId, ctx.stopsAt);
    walker.t = 0;
    return true;
  }

  function halt(walker) {
    walker.pause = randomPauseDuration(walker);
    walker.speed = 0;
    walker.pace = 0; // the next journey picks its own pace
  }

  // Keeps walker.tileId/targetId/t/pause/speed valid and advancing. Self-heals if the current
  // tile stops being land (e.g. the planet just grew onto a new grid, so old tile ids no longer
  // apply, or the view just switched to one whose layout doesn't include this tile yet) by
  // re-anchoring via ctx.findAnchor(). Returns false when there's nowhere land to stand yet.
  function advance(walker, dt, ctx) {
    if (walker.tileId === null || !ctx.isLand(walker.tileId)) {
      walker.tileId = (walker.tileId !== null && ctx.isLand(walker.tileId))
        ? walker.tileId : ctx.findAnchor();
      walker.targetId = walker.tileId;
      walker.fromTileId = null;
      walker.t = 1;
      walker.facing = null; // put down somewhere new: face the new way at once, don't turn to it
      halt(walker);
    }
    if (walker.tileId === null) return false;

    // dt is spent down rather than applied once, so a walker that reaches a tile part-way
    // through a frame carries the rest of that frame onto the next tile instead of standing
    // on the boundary until the next one. The guard is only there so a zero duration cannot
    // spin here forever.
    var left = dt;
    for (var guard = 0; guard < 8 && left > 0; guard++) {
      if (walker.t >= 1) {
        if (walker.pause > 0) { walker.pause -= left; walker.speed = 0; return true; }
        if (!setOff(walker, ctx)) return true;
      }
      var cruise = 1 / walker.duration;
      var acc = cruise / ACCEL_SECONDS;
      var wanted = cruise;
      if (walker.stopAtEnd) {
        // Start braking exactly one stopping-distance out, at the same rate it sets off at,
        // so slowing down mirrors speeding up. Ramping the speed down with the distance
        // LEFT instead looks the same but takes logarithmically long to cover the last
        // sliver -- it doubled the time a pet took to cross a tile.
        var togo = Math.max(0, 1 - walker.t);
        if (togo <= (walker.speed * walker.speed) / (2 * acc)) wanted = 0;
      }
      walker.speed = wanted < walker.speed
        ? Math.max(wanted, walker.speed - acc * left)
        : Math.min(wanted, walker.speed + acc * left);
      if (walker.t < 1) walker.speed = Math.max(walker.speed, cruise * CRAWL);
      walker.t += walker.speed * left;
      if (walker.t < 1) return true;
      left = walker.speed > 0 ? (walker.t - 1) / walker.speed : 0;
      walker.t = 1;
      if (walker.stopAtEnd) { halt(walker); return true; }
    }
    return true;
  }

  // --- Loitering ------------------------------------------------------------------------------
  // A friend does not hop about the tiles around their building: on their own tile they meander
  // freely, picking a nearby spot, walking to it, standing a moment, and picking another. A spot
  // is measured from the tile's centre in TILE-WIDTHS, so one number holds on every planet size
  // and in both views, and the half-tile radius is the hexagon's inscribed circle: they stay
  // inside their own tile. `blocked(x, z)` says where they may not stand (a building, in the
  // view's own terms); the tile-to-tile FSM above is left to carry them between memories.
  var LOITER_RADIUS = 0.5;
  // A house on the island can fill its whole tile, leaving no yard at all. Rather than stand
  // frozen against it, reach a little past the tile's edge (its corners are at 0.577).
  var LOITER_WIDEN = 0.62;
  var LOITER_SPEED = 0.22;        // tile-widths per second: a stroll, not a march
  var LOITER_WAIT = [0.8, 2.6];   // seconds spent standing between spots
  var LOITER_MIN_HOP = 0.1;       // a spot closer than this is not worth setting off for

  function segmentClear(a, b, blocked) {
    var n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.04)); // finer than any wall
    for (var i = 1; i <= n; i++) {
      var f = i / n;
      if (blocked(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f)) return false;
    }
    return true;
  }

  // A spot in the disc that can be reached in a straight line from `from`, or null. A walker
  // that starts INSIDE a blocked area (it arrived by the path beside a building, or a house
  // went up under it) is not asked for a clear line: it only has to get out, so it takes the
  // nearest open spot rather than a random one on the far side of the building.
  function pickLoiterSpot(from, blocked, rand) {
    rand = rand || Math.random;
    var stuck = blocked(from.x, from.z);
    var reaches = [LOITER_RADIUS, LOITER_WIDEN];
    for (var r = 0; r < reaches.length; r++) {
      var nearest = null, nearestDist = Infinity;
      for (var tries = 0; tries < (stuck ? 300 : 40); tries++) {
        var angle = rand() * Math.PI * 2, dist = Math.sqrt(rand()) * reaches[r];
        var spot = { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
        var hop = Math.hypot(spot.x - from.x, spot.z - from.z);
        if (hop < LOITER_MIN_HOP) continue;
        if (blocked(spot.x, spot.z)) continue;
        if (!stuck) {
          if (segmentClear(from, spot, blocked)) return spot;
        } else if (hop < nearestDist) {
          nearest = spot; nearestDist = hop;
        }
      }
      if (nearest) return nearest;
    }
    return null;
  }

  // Moves walker.spot by one frame. `dwell` says the walker is standing on a tile of its own
  // and free to wander; otherwise it is on the road, and eases to `rest`, the fixed place beside
  // the tile's middle that it walks along (most road tiles carry a building it must not walk
  // through). Returns the unit direction it moved in, or null if it did not move.
  function stepSpot(walker, dt, opts) {
    var s = walker.spot;
    if (!s) s = walker.spot = { x: opts.rest.x, z: opts.rest.z, to: null, wait: inRange(LOITER_WAIT) };
    var goal;
    if (!opts.dwell) {
      s.to = null;
      s.settled = false;
      goal = opts.rest;
    } else {
      // Just arrived on a tile of its own. The road's rest place can lie inside a building's
      // footprint; if so, do not stand there for a spell before getting out.
      if (!s.settled) { s.settled = true; if (opts.blocked(s.x, s.z)) s.wait = 0; }
      if (!s.to) {
        s.wait -= dt;
        if (s.wait <= 0) {
          s.to = pickLoiterSpot(s, opts.blocked);
          if (!s.to) s.wait = inRange(LOITER_WAIT);
        }
      }
      goal = s.to;
    }
    if (!goal) return null;
    var dx = goal.x - s.x, dz = goal.z - s.z, dist = Math.hypot(dx, dz);
    if (dist < 1e-6) { s.to = null; s.wait = inRange(LOITER_WAIT); return null; }
    var step = LOITER_SPEED * dt * (opts.dwell ? 1 : 2);
    var heading = { x: dx / dist, z: dz / dist };
    if (dist <= step) {
      s.x = goal.x; s.z = goal.z;
      if (opts.dwell) { s.to = null; s.wait = inRange(LOITER_WAIT); }
      return heading;
    }
    var nx = s.x + heading.x * step, nz = s.z + heading.z * step;
    // Something new in the way (a building that appeared mid-walk): give the spot up.
    if (opts.dwell && opts.blocked(nx, nz) && !opts.blocked(s.x, s.z)) {
      s.to = null; s.wait = inRange(LOITER_WAIT);
      return null;
    }
    s.x = nx; s.z = nz;
    return heading;
  }

  // Whether this walker should be loitering right now, and where it stands if so. A walker
  // between tiles has t < 1 and is on its way; once t is 1 it is AT walker.targetId (tileId only
  // catches up when it next sets off).
  function loiterState(walker, loiter, dt) {
    var dwell = walker.t >= 1 && loiter.dwellsAt(walker.targetId);
    var at = walker.targetId;
    var heading = stepSpot(walker, dt, {
      dwell: dwell, rest: loiter.rest,
      blocked: function (x, z) { return loiter.blocked(at, x, z); }
    });
    return { dwell: dwell, heading: heading };
  }

  // --- Facing -------------------------------------------------------------------------------
  // A road bends by up to 60 degrees at a tile boundary, and snapping to the new heading there
  // spun the walker on the spot in the middle of a stride. Turn toward it at a limited rate
  // instead, so a bend is taken rather than stepped through. Fast enough (7 rad/s takes a
  // 60-degree bend in about 0.15s) that it never lags behind where the walker is actually
  // going; the first frame snaps, or a walker would spin up from whatever way it was left.
  var TURN_RATE = 7;

  function turnFlat(walker, wanted, dt) {
    if (!walker.facing) { walker.group.rotation.y = wanted; walker.facing = true; return; }
    var from = walker.group.rotation.y;
    var delta = Math.atan2(Math.sin(wanted - from), Math.cos(wanted - from));
    var most = TURN_RATE * dt;
    walker.group.rotation.y = from + Math.max(-most, Math.min(most, delta));
  }

  var turnQ = new THREE.Quaternion();
  function turnSphere(walker, right, up, forward, dt) {
    turnQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
    if (!walker.facing) { walker.group.quaternion.copy(turnQ); walker.facing = true; return; }
    // The shortest turn between the two, so the rate limit is in real radians.
    var dot = Math.min(1, Math.abs(walker.group.quaternion.dot(turnQ)));
    var angle = 2 * Math.acos(dot);
    walker.group.quaternion.slerp(turnQ, angle > 1e-6 ? Math.min(1, TURN_RATE * dt / angle) : 1);
  }

  // --- Sphere view ------------------------------------------------------------------------
  // ctx: { isLand(id), neighborsOf(id) -> [ids], findAnchor() -> id|null, height, scale, hop }.
  // ctx.loiter (residents): { tileWidth, rest: {x,z}, dwellsAt(id), blocked(id, x, z) } — see
  // Loitering above; it replaces ctx.offset, which is the same "beside the building" idea fixed.
  // height/scale mirror how world.js sizes/places its other sphere props (state.spacing-
  // derived, RADIUS + LAND_LIFT) — these groups live inside the `planet` Group, which already
  // applies worldScale, so positions here stay in that same pre-scale unit-sphere space.
  //
  // `hop` overrides HOP_HEIGHT, the little bob that stands in for a walk cycle on a model with
  // no clips. A ship has no clips either, but a ship that bobs between tiles is a ship
  // skipping over the sea, so it passes 0 and rides the swell instead.

  function updateSphere(walker, dt, ctx) {
    if (!walker.group) return;
    if (!advance(walker, dt, ctx)) return;

    var fromDir = ctx.dirOf(walker.tileId);
    var toDir = ctx.dirOf(walker.targetId);
    if (!fromDir || !toDir) return;
    // Straight across the tile: the accelerating and slowing is in walker.speed now, and
    // easing here as well would put it back at every boundary. See advance().
    var dir = fromDir.clone().lerp(toDir, walker.t).normalize();
    var bob = ctx.hop === undefined ? HOP_HEIGHT : ctx.hop;
    var hop = walker.animator ? 0 : Math.sin(Math.PI * walker.t) * bob;
    var was = walker.group.position.clone();
    walker.group.position.copy(dir).multiplyScalar(ctx.height + hop);
    // Stand beside the middle of the tile rather than on it, the same trick spawnPerson uses:
    // a walker that keeps to the roads spends much of its time on tiles that already carry a
    // building, and dead centre puts it inside one. Taken against a fixed world axis (not the
    // direction of travel) so it varies smoothly with `dir` and never pops at a step boundary.
    // A resident's spot on the tile (its loitering, or the rest place beside the building) is
    // laid out in the same frame: `side` is x, `across` is z, both tangent to the sphere.
    var axis = Math.abs(dir.y) > 0.95 ? WORLD_SIDE : WORLD_UP;
    var side = new THREE.Vector3().crossVectors(dir, axis);
    var across = null;
    if (side.lengthSq() > 1e-8) {
      side.normalize();
      across = new THREE.Vector3().crossVectors(dir, side).normalize();
    } else {
      side = null;
    }
    var loiter = ctx.loiter ? loiterState(walker, ctx.loiter, dt) : null;
    if (loiter && side) {
      var spot = walker.spot, width = ctx.loiter.tileWidth;
      walker.group.position.addScaledVector(side, spot.x * width).addScaledVector(across, spot.z * width);
      // A tangent step leaves the surface; put it back at the height it was meant to stand at.
      walker.group.position.setLength(ctx.height + hop);
    } else if (ctx.offset && side) {
      walker.group.position.addScaledVector(side, ctx.offset);
    }
    walker.group.scale.setScalar(ctx.scale);
    animateWalker(walker, dt, was, ctx.scale, loiter && loiter.heading);

    var up = dir.clone(), forward = null;
    if (loiter && loiter.dwell) {
      // Standing on its own tile it faces where it last walked, not back along the road it came in by.
      if (loiter.heading && side) forward = side.clone().multiplyScalar(loiter.heading.x)
        .addScaledVector(across, loiter.heading.z);
    } else if (fromDir.distanceToSquared(toDir) > 1e-8) {
      forward = toDir.clone().sub(fromDir);
    }
    if (forward) {
      forward.sub(up.clone().multiplyScalar(forward.dot(up)));
      if (forward.lengthSq() > 1e-8) {
        forward.normalize();
        var right = new THREE.Vector3().crossVectors(up, forward).normalize();
        forward.crossVectors(right, up).normalize();
        turnSphere(walker, right, up, forward, dt);
      }
    }
  }

  // How far it actually travelled this frame, in the model's own units -- the walk cycle is
  // paced off that, so the same walker looks right on a 42-tile planet and on a 1002-tile one.
  // A walker standing still (paused, or a step it could not take) gets 0 and settles to idle.
  function animateWalker(walker, dt, wasAt, scale, strolled) {
    if (!walker.animator || dt <= 0) return;
    if (!isShown(walker.group)) return;
    // `strolled`: it moved this frame under its own loitering, with no tile step going on.
    var moved = walker.t < 1 || strolled ? walker.group.position.distanceTo(wasAt) : 0;
    walker.animator.update(dt, moved / dt / (scale || 1));
  }

  // --- Flat view ----------------------------------------------------------------------------
  // ctx: { isLand(id), neighborsOf(id), findAnchor(), centres: {id: {x,z}}, baseY, scale }.
  // ctx.baseYOf(tileId) is optional: the walking height of that tile, so a walker steps down
  // onto a low tile and up onto a path instead of gliding at one height over everything.
  // `centres` is world.js's own coiled-island layout (MI.island), already centred — the same
  // positions buildings/people use there, so this always lands in the right visual spot.

  function updateFlat(walker, dt, ctx) {
    if (!walker.group) return;
    if (!advance(walker, dt, ctx)) return;

    var from = ctx.centres[walker.tileId], to = ctx.centres[walker.targetId];
    if (!from || !to) return;
    var ease = walker.t; // straight across the tile -- see updateSphere
    var x = from.x + (to.x - from.x) * ease;
    var z = from.z + (to.z - from.z) * ease;
    var hop = walker.animator ? 0 : Math.sin(Math.PI * walker.t) * HOP_HEIGHT;
    var was = walker.group.position.clone();
    var baseY = ctx.baseYOf
      ? ctx.baseYOf(walker.tileId) + (ctx.baseYOf(walker.targetId) - ctx.baseYOf(walker.tileId)) * ease
      : ctx.baseY;
    var loiter = ctx.loiter ? loiterState(walker, ctx.loiter, dt) : null;
    var dx = 0, dz = 0;
    if (loiter) { dx = walker.spot.x * ctx.loiter.tileWidth; dz = walker.spot.z * ctx.loiter.tileWidth; }
    else dx = ctx.offset || 0; // beside the tile centre — see updateSphere
    walker.group.position.set(x + dx, baseY + hop, z + dz);
    walker.group.scale.setScalar(ctx.scale);
    animateWalker(walker, dt, was, ctx.scale, loiter && loiter.heading);
    if (loiter && loiter.dwell) {
      if (loiter.heading) turnFlat(walker, Math.atan2(loiter.heading.x, loiter.heading.z), dt);
    } else if (Math.abs(to.x - from.x) > 1e-6 || Math.abs(to.z - from.z) > 1e-6) {
      turnFlat(walker, Math.atan2(to.x - from.x, to.z - from.z), dt);
    }
  }

  // One off-screen renderer for picker portraits. Copying pixels out (the asset-sheet
  // trick) means each card is a plain image and we never burn a WebGL context per look.
  var portraitGpu = null;
  var portraitUrls = {};

  function getPortraitGpu() {
    if (!portraitGpu) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      portraitGpu = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      portraitGpu.setClearColor(0x000000, 0);
      portraitGpu.outputEncoding = THREE.sRGBEncoding;
      portraitGpu.setPixelRatio(1);
      portraitGpu.setSize(192, 192, false);
    }
    return portraitGpu;
  }

  function portraitUrl(id) {
    if (portraitUrls[id]) return Promise.resolve(portraitUrls[id]);
    return loadTemplate(id).then(function (template) {
      if (!template) return null;
      if (portraitUrls[id]) return portraitUrls[id];
      var model = cloneModel(template);
      var animator = makeAnimator(model, 0.12);
      if (animator) {
        animator.update(0.08, 0);
        animator.dispose();
      }
      var gpu = getPortraitGpu();
      var scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff4e8, 0x8aa0b0, 1.15));
      var sun = new THREE.DirectionalLight(0xffffff, 0.85);
      sun.position.set(3.2, 6.5, 4.2);
      scene.add(sun);

      var box = new THREE.Box3().setFromObject(model);
      var size = box.getSize(new THREE.Vector3());
      var centre = box.getCenter(new THREE.Vector3());
      var span = Math.max(size.x, size.y, size.z, 0.001);
      model.position.set(-centre.x, -box.min.y, -centre.z);
      var holder = new THREE.Group();
      holder.add(model);
      holder.scale.setScalar(1 / span);
      holder.rotation.y = Math.PI * 0.16;
      scene.add(holder);

      var fov = 26;
      var camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 20);
      var distance = 0.82 / Math.tan(Math.PI * fov / 360);
      camera.position.set(distance * 0.1, distance * 0.22, distance * 0.7);
      camera.lookAt(0, 0.42, 0);
      gpu.render(scene, camera);

      var copy = document.createElement('canvas');
      copy.width = copy.height = 192;
      copy.getContext('2d').drawImage(gpu.domElement, 0, 0);
      portraitUrls[id] = copy.toDataURL('image/png');
      return portraitUrls[id];
    });
  }

  MI.world.walkers = {
    isPet: isPet,
    isResident: isResident,
    residentModelFor: residentModelFor,
    makeModel: function (id) { return loadTemplate(id).then(function (model) { return model && cloneModel(model); }); },
    makeAnimator: makeAnimator,
    portraitUrl: portraitUrl,
    isShown: isShown,
    pickLoiterSpot: pickLoiterSpot,
    stepSpot: stepSpot,
    makeWalkerPair: makeWalkerPair,
    makeWalkerSolo: makeWalkerSolo,
    updateSphere: updateSphere,
    updateFlat: updateFlat
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MI.world.walkers;
})();
