// MI.world.player — the character you embody in walk mode. Owns the avatar model and the
// movement maths; knows nothing about world.js's state or MI.store. world.js hands it an
// `isLandAt` test and the framing it needs each frame, one set for the sphere view and one
// for the island view, exactly as it does for src/world/pets.js.
//
// Movement is continuous, not snapped to tiles. On the sphere a step ROTATES the position
// vector about (pos x move): that is great-circle movement, so it never drifts off the unit
// sphere, has no pole singularity, and needs no trigonometric special cases. On the island
// the same step is a plain XZ translation.
//
// Walking into the sea does not stick you to the shore. A blocked step is retried with each
// input axis alone, so you slide along the coastline — see slide() below.
//
// Adding a character later is one line in CHARACTERS, once its .glb is in PACK. No model
// ships yet, so every entry currently falls back to the procedural minifigure world.js
// builds for people; a .glb named here takes over with nothing else to change.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  var PACK = 'assets/standalone/characters/';
  // Tiles crossed per second. The caller turns this into world units by multiplying by
  // whatever a tile measures in ITS view (ctx.speed), because a tile's world size changes
  // with the planet's frequency and is different again on the island.
  var TILES_PER_SECOND = 1.7;
  var TURN_RATE = 12;     // radians/sec the model swings to face where it is going
  var BOB_RATE = 9;       // steps per second of the walk bob, since no model is animated
  var BOB_HEIGHT = 0.035;

  // id, the name under the card in the picker, and the fallback minifigure's colour.
  // `file` is the .glb in PACK once one exists; null means "use the fallback".
  var CHARACTERS = [
    { id: 'scout', name: 'Scout', color: 0xff9f68, file: null },
    { id: 'sky', name: 'Sky', color: 0x7ec8e3, file: null },
    { id: 'rose', name: 'Rose', color: 0xf7b7d2, file: null },
    { id: 'fern', name: 'Fern', color: 0xa5d86e, file: null },
    { id: 'iris', name: 'Iris', color: 0xc3a5f0, file: null },
    { id: 'sunny', name: 'Sunny', color: 0xffd97d, file: null }
  ];

  function list() {
    return CHARACTERS.slice();
  }

  function get(id) {
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (CHARACTERS[i].id === id) return CHARACTERS[i];
    }
    return null;
  }

  function isCharacter(id) {
    return !!get(id);
  }

  function defaultId() {
    return CHARACTERS[0].id;
  }

  // --- Loading --------------------------------------------------------------------------
  // Own LoadingManager, separate from the hexagon kit's — a different pack with its own
  // colormap, per CLAUDE.md's one-manager-per-pack rule.

  var loader = null;
  var templateCache = {};

  function getLoader() {
    if (!loader) loader = new THREE.GLTFLoader(new THREE.LoadingManager());
    return loader;
  }

  // `fallback` is world.js's makePersonModel, passed in rather than reached for, so this
  // module never depends on world.js internals. It is used both when a character has no
  // .glb yet and when one fails to load — the demo runs offline, so a missing model must
  // never leave you with no avatar at all (CLAUDE.md).
  function makeAvatar(id, fallback) {
    var character = get(id) || get(defaultId());
    if (!character.file) return Promise.resolve(fallback(character.color));

    if (!templateCache[character.id]) {
      templateCache[character.id] = new Promise(function (resolve) {
        getLoader().load(PACK + character.file, function (gltf) {
          var group = gltf.scene;
          group.traverse(function (node) {
            if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
          });
          resolve(group);
        }, undefined, function () { resolve(null); });
      });
    }
    return templateCache[character.id].then(function (template) {
      return template ? template.clone(true) : fallback(character.color);
    });
  }

  // --- Movement -------------------------------------------------------------------------

  function newPlayer() {
    return {
      group: null,
      // Sphere view: a unit direction. Island view: metres in the XZ plane.
      dir: new THREE.Vector3(0, 1, 0),
      x: 0, z: 0,
      heading: 0,       // facing, as a rotation about the local up
      bob: 0,           // walk-cycle phase, advanced only while actually moving
      moving: false,
      placed: false     // false until world.js has put it on its starting tile
    };
  }

  // WASD as a direction in the plane the camera is looking across. `input` is
  // { forward: -1..1, strafe: -1..1 }; forward/right are unit tangent vectors.
  function inputDirection(forward, right, input, out) {
    out.set(0, 0, 0);
    if (input.forward) out.addScaledVector(forward, input.forward);
    if (input.strafe) out.addScaledVector(right, input.strafe);
    if (out.lengthSq() < 1e-10) return null;
    return out.normalize();
  }

  // One great-circle step. `pos` is a unit vector, `move` a unit tangent vector at pos.
  // Returns a NEW unit vector; `pos` is untouched.
  function stepSphere(pos, move, distance, radius) {
    var axis = new THREE.Vector3().crossVectors(pos, move);
    if (axis.lengthSq() < 1e-12) return pos.clone();
    axis.normalize();
    return pos.clone().applyAxisAngle(axis, distance / radius).normalize();
  }

  // Take the step if it lands on land. If it doesn't, try each input axis on its own and
  // take the first that does — that is what turns "blocked by the sea" into "slide along
  // the shore". Returns the position actually taken, or null if nothing moved.
  function slide(candidates, isLandAt) {
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && isLandAt(candidates[i])) return candidates[i];
    }
    return null;
  }

  // The directions to try, in order: the whole input first, then each axis on its own.
  // inputDirection returns null for a component too small to normalise — a near-axis
  // input like cos(PI/2), which is 6e-17 rather than 0 — and those are dropped here, so a
  // null direction can never reach stepSphere.
  function moveDirections(forward, right, input) {
    var variants = [input,
      { forward: input.forward, strafe: 0 },
      { forward: 0, strafe: input.strafe }];
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var d = inputDirection(forward, right, variants[i], new THREE.Vector3());
      if (d) out.push(d);
    }
    return out;
  }

  // Sphere step with sliding. Exposed for scripts/test-player.js.
  function moveSphere(pos, forward, right, input, distance, radius, isLandAt) {
    var dirs = moveDirections(forward, right, input);
    if (!dirs.length) return null;
    var candidates = dirs.map(function (d) { return stepSphere(pos, d, distance, radius); });
    return slide(candidates, isLandAt);
  }

  // Island step with sliding, in the XZ plane. `pos` and the result are { x, z }.
  function moveFlat(pos, forward, right, input, distance, isLandAt) {
    var dirs = moveDirections(forward, right, input);
    if (!dirs.length) return null;
    var candidates = dirs.map(function (d) {
      return { x: pos.x + d.x * distance, z: pos.z + d.z * distance };
    });
    return slide(candidates, isLandAt);
  }

  // Ease the model's facing toward where it is actually travelling, so a direction change
  // reads as a turn rather than a snap. Angles wrap, hence the shortest-way normalisation.
  function turnToward(current, target, dt) {
    var delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * Math.min(1, TURN_RATE * dt);
  }

  // --- Per-frame update, one per view ----------------------------------------------------
  // ctx (sphere): { forward, right, input, isLandAt, height, scale, radius }
  // ctx (flat):   { forward, right, input, isLandAt, baseY, scale }
  // `forward`/`right` are the camera's tangent axes, so W is always "away from the camera".

  function updateSphere(player, dt, ctx) {
    if (!player.group || !player.placed) return;

    var moved = moveSphere(player.dir, ctx.forward, ctx.right, ctx.input,
      ctx.speed * dt, ctx.radius, ctx.isLandAt);
    player.moving = !!moved;
    if (moved) {
      // Face the way we actually went, which after a slide is not always the way we asked.
      var travel = new THREE.Vector3().subVectors(moved, player.dir);
      player.dir.copy(moved);
      setHeadingFromTravel(player, travel, player.dir, dt);
    }
    advanceBob(player, dt);

    var up = player.dir;
    player.group.position.copy(up).multiplyScalar(ctx.height + bobOffset(player));
    player.group.scale.setScalar(ctx.scale);
    orientOnSphere(player, up);
  }

  function updateFlat(player, dt, ctx) {
    if (!player.group || !player.placed) return;

    var moved = moveFlat({ x: player.x, z: player.z }, ctx.forward, ctx.right, ctx.input,
      ctx.speed * dt, ctx.isLandAt);
    player.moving = !!moved;
    if (moved) {
      var dx = moved.x - player.x, dz = moved.z - player.z;
      player.x = moved.x; player.z = moved.z;
      if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) {
        player.heading = turnToward(player.heading, Math.atan2(dx, dz), dt);
      }
    }
    advanceBob(player, dt);

    player.group.position.set(player.x, ctx.baseY + bobOffset(player), player.z);
    player.group.scale.setScalar(ctx.scale);
    player.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.heading);
  }

  // Heading on the sphere is an angle about the local up, measured from a stable reference
  // tangent, so it survives the player walking over the pole.
  function setHeadingFromTravel(player, travel, up, dt) {
    var flat = travel.clone().sub(up.clone().multiplyScalar(travel.dot(up)));
    if (flat.lengthSq() < 1e-12) return;
    flat.normalize();
    var ref = referenceTangent(up);
    var side = new THREE.Vector3().crossVectors(up, ref);
    var target = Math.atan2(flat.dot(side), flat.dot(ref));
    player.heading = turnToward(player.heading, target, dt);
  }

  // A tangent at `up` that varies smoothly and never degenerates: cross with whichever
  // world axis `up` is least aligned to.
  function referenceTangent(up) {
    var axis = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3().crossVectors(axis, up).normalize();
  }

  function orientOnSphere(player, up) {
    var ref = referenceTangent(up);
    var side = new THREE.Vector3().crossVectors(up, ref);
    var forward = ref.clone().multiplyScalar(Math.cos(player.heading))
      .addScaledVector(side, Math.sin(player.heading)).normalize();
    var right = new THREE.Vector3().crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();
    player.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward));
  }

  function advanceBob(player, dt) {
    if (player.moving) player.bob += dt * BOB_RATE;
    else player.bob = 0;
  }

  function bobOffset(player) {
    return player.moving ? Math.abs(Math.sin(player.bob)) * BOB_HEIGHT : 0;
  }

  MI.world.player = {
    list: list,
    get: get,
    isCharacter: isCharacter,
    defaultId: defaultId,
    makeAvatar: makeAvatar,
    newPlayer: newPlayer,
    updateSphere: updateSphere,
    updateFlat: updateFlat,
    // Exposed for scripts/test-player.js.
    stepSphere: stepSphere,
    moveSphere: moveSphere,
    moveFlat: moveFlat,
    inputDirection: inputDirection,
    TILES_PER_SECOND: TILES_PER_SECOND
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MI.world.player;
})();
