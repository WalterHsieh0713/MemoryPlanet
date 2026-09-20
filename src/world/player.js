// MI.world.player — your character: the one figure on the planet that you drive. It is a
// permanent inhabitant, not a mode. It stands on the world in every view, walks when you
// press WASD whether you are looking from orbit or from the ground, and ground view is
// simply a camera that rides along behind it.
//
// This module owns the avatar model and the movement maths and knows nothing about
// world.js's state or MI.store: world.js hands it an `isLandAt` test and the camera's
// tangent axes each frame, exactly as it does for src/world/walkers.js.
//
// Movement is continuous, not snapped to tiles. On the sphere a step ROTATES the position
// vector about (pos x move): great-circle movement, so it never drifts off the unit sphere,
// has no pole singularity and needs no trigonometric special cases. On the island it is a
// plain XZ translation. A blocked step is retried with each input axis alone, so walking
// into the sea slides you along the coast instead of sticking.
//
// FACING IS A VECTOR, NOT AN ANGLE. An earlier version stored it as an angle measured from
// a "reference tangent" recomputed at each position. That tangent rotates as you move and
// flips outright near the poles, so the character's facing and the ground camera's azimuth
// both drifted on their own — most visibly when strafing. Instead the facing is a tangent
// vector carried along by the same rotation that moves the character (parallel transport),
// which is stable everywhere. `lastAxis`/`lastAngle` expose that rotation so world.js can
// carry the ground camera along by it too, which is what keeps the two in step.
//
// Avatar choices map to the shared Mini Characters models in src/world/walkers.js.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  // Tiles crossed per second. The caller turns this into world units by multiplying by
  // whatever a tile measures in ITS view (ctx.speed), because a tile's world size changes
  // with the planet's frequency and is different again on the island.
  var TILES_PER_SECOND = 0.7;
  var TURN_RATE = 12;     // radians/sec the model swings to face where it is going
  var BOB_RATE = 9;       // steps per second of the stand-in bob, for a model with no clips
  var BOB_HEIGHT = 0.035;

  // id, the name under the card in the picker, and the fallback minifigure's colour.
  // `file` is the .glb in PACK once one exists; null means "use the fallback".
  var CHARACTERS = [
    { id: 'scout', name: 'Scout', color: 0xff9f68, model: 'male-a' },
    { id: 'sky', name: 'Sky', color: 0x7ec8e3, model: 'male-b' },
    { id: 'rose', name: 'Rose', color: 0xf7b7d2, model: 'female-a' },
    { id: 'fern', name: 'Fern', color: 0xa5d86e, model: 'female-b' },
    { id: 'iris', name: 'Iris', color: 0xc3a5f0, model: 'female-c' },
    { id: 'sunny', name: 'Sunny', color: 0xffd97d, model: 'male-c' }
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

  // `fallback` is world.js's makePersonModel, passed in rather than reached for, so this
  // module never depends on world.js internals. It is used both when a character has no
  // .glb yet and when one fails to load — the demo runs offline, so a missing model must
  // never leave you with no character at all (CLAUDE.md).
  function makeAvatar(id, fallback) {
    var character = get(id) || get(defaultId());
    return MI.world.walkers.makeModel(character.model).then(function (model) {
      return model || fallback(character.color);
    });
  }

  // --- Movement -------------------------------------------------------------------------

  function newPlayer() {
    return {
      group: null,
      // Sphere view: a unit direction, plus a unit tangent at it for the facing.
      dir: new THREE.Vector3(0, 1, 0),
      facing: new THREE.Vector3(1, 0, 0),
      // The rotation the last step applied, so world.js can carry the ground camera along
      // with it. lastAngle 0 means the character did not move this frame.
      lastAxis: new THREE.Vector3(0, 1, 0),
      lastAngle: 0,
      // Island view: metres in the XZ plane, facing as a plain rotation about +Y. No
      // curvature there, so an angle is fine and there is nothing to transport.
      x: 0, z: 0, heading: 0,
      // Island view: the height the feet are currently at, eased toward the tile underneath by
      // world.js so a change of level reads as a step rather than a jump. null until placed.
      groundY: null,
      // The GLB's own walk/idle clips, blended by MI.world.walkers (null for the procedural
      // fallback figure, which keeps the bob instead). world.js builds it with the avatar.
      animator: null,
      bob: 0,           // stand-in walk phase, advanced only while actually moving
      moving: false,
      placed: false     // false until world.js has put it on its starting tile
    };
  }

  // Make `v` a unit tangent at `up`: drop whatever points along up. Returns null when
  // nothing is left, which happens when v and up are parallel.
  function tangent(v, up) {
    var out = v.clone().addScaledVector(up, -v.dot(up));
    return out.lengthSq() < 1e-12 ? null : out.normalize();
  }

  // WASD as a direction in the plane the camera looks across. `input` is
  // { forward: -1..1, strafe: -1..1 }; forward/right are unit tangent vectors.
  function inputDirection(forward, right, input, out) {
    out.set(0, 0, 0);
    if (input.forward) out.addScaledVector(forward, input.forward);
    if (input.strafe) out.addScaledVector(right, input.strafe);
    if (out.lengthSq() < 1e-10) return null;
    return out.normalize();
  }

  // The directions to try, in order: the whole input first, then each axis on its own, so a
  // diagonal into a coast keeps whichever half is still land. inputDirection returns null
  // for a component too small to normalise — a near-axis input like cos(PI/2), which is
  // 6e-17 rather than 0 — and those are dropped here, so a null can never reach a step.
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

  // The rotation a step IS: an axis and an angle. Kept separate from applying it because
  // the same rotation also has to be applied to the facing and to the ground camera, and
  // that is exactly what keeps all three in step as you cross the sphere.
  function sphereRotation(pos, move, distance, radius) {
    var axis = new THREE.Vector3().crossVectors(pos, move);
    if (axis.lengthSq() < 1e-12) return null;
    return { axis: axis.normalize(), angle: distance / radius };
  }

  // One great-circle step. `pos` is a unit vector, `move` a unit tangent vector at pos.
  // Returns a NEW unit vector; `pos` is untouched.
  function stepSphere(pos, move, distance, radius) {
    var turn = sphereRotation(pos, move, distance, radius);
    return turn ? pos.clone().applyAxisAngle(turn.axis, turn.angle).normalize() : pos.clone();
  }

  // Take the first candidate that lands on land. Returns it, or null if nothing moved.
  function slide(candidates, isLandAt, positionOf) {
    for (var i = 0; i < candidates.length; i++) {
      var pos = positionOf ? positionOf(candidates[i]) : candidates[i];
      if (pos && isLandAt(pos)) return candidates[i];
    }
    return null;
  }

  // Sphere step with sliding, as { pos, axis, angle } so the caller can reuse the rotation.
  function stepSphereSliding(pos, forward, right, input, distance, radius, isLandAt) {
    var dirs = moveDirections(forward, right, input);
    var candidates = [];
    for (var i = 0; i < dirs.length; i++) {
      var turn = sphereRotation(pos, dirs[i], distance, radius);
      if (!turn) continue;
      candidates.push({
        pos: pos.clone().applyAxisAngle(turn.axis, turn.angle).normalize(),
        axis: turn.axis, angle: turn.angle
      });
    }
    return slide(candidates, isLandAt, function (c) { return c.pos; });
  }

  // Position only. Exposed for scripts/test-player.js.
  function moveSphere(pos, forward, right, input, distance, radius, isLandAt) {
    var moved = stepSphereSliding(pos, forward, right, input, distance, radius, isLandAt);
    return moved ? moved.pos : null;
  }

  // Island step with sliding, in the XZ plane. `pos` and the result are { x, z }.
  // `blockers` (optional) are solid circles { x, z, r }, `radius` the character's own.
  function moveFlat(pos, forward, right, input, distance, isLandAt, blockers, radius) {
    var dirs = moveDirections(forward, right, input);
    if (!dirs.length) return null;
    var candidates = dirs.map(function (d) {
      return { x: pos.x + d.x * distance, z: pos.z + d.z * distance };
    });
    // Running at a building: keep the part of the move that runs ALONG its wall, so you
    // glide round the corner instead of stopping dead against it. The wall's own directions,
    // not the world's, which is what makes it work for a building at any angle.
    if (blockers && blockers.length) {
      var d0 = dirs[0];
      blockers.forEach(function (b) {
        var dx = pos.x - b.x, dz = pos.z - b.z;
        var near = b.hx + b.hz + (radius || 0) + distance * 4;
        if (dx * dx + dz * dz > near * near) return;
        boxAxes(b).forEach(function (axis) {
          var along = d0.x * axis.x + d0.z * axis.z;
          if (Math.abs(along) < 1e-6) return;
          var sign = along > 0 ? 1 : -1;
          candidates.push({
            x: pos.x + axis.x * sign * distance,
            z: pos.z + axis.z * sign * distance
          });
        });
      });
    }
    return slide(candidates, function (p) {
      return isLandAt(p) && !blockedStep(pos, p, blockers, radius);
    });
  }

  // Solid props on the island are BOXES, not circles: { x, z, hx, hz, cos, sin } — a box half
  // hx by hz, centred at x,z and turned by the tile's own rotation. A building is boxy, and a
  // circle around one is wrong in both directions at once: it holds you off the flat walls
  // while letting you into the corners. With a box you can walk right up to the wall.
  //
  // `depth` is how far inside the box a point is, as a fraction of the way to its middle: 1 at
  // the surface, larger further in. Everything else is expressed in terms of it.
  function boxDepth(box, p, radius) {
    var dx = p.x - box.x, dz = p.z - box.z;
    var lx = dx * box.cos - dz * box.sin;
    var lz = dx * box.sin + dz * box.cos;
    var overX = (box.hx + radius) - Math.abs(lx);
    var overZ = (box.hz + radius) - Math.abs(lz);
    if (overX <= 0 || overZ <= 0) return 0;       // outside
    return Math.min(overX, overZ);
  }

  // A step INTO a box is refused, so the slide logic above walks you around it. A character
  // already inside one (a building appeared under it, or it spawned close) is never trapped:
  // it may move as long as it is heading out. `radius` is the character's own.
  function blockedStep(from, to, blockers, radius) {
    if (!blockers) return false;
    var r = radius || 0;
    for (var i = 0; i < blockers.length; i++) {
      var depthTo = boxDepth(blockers[i], to, r);
      if (depthTo <= 0) continue;
      if (boxDepth(blockers[i], from, r) > depthTo) continue; // inside already, but leaving
      return true;
    }
    return false;
  }

  // The two directions a box's walls run in, in world terms.
  function boxAxes(box) {
    return [{ x: box.cos, z: -box.sin }, { x: box.sin, z: box.cos }];
  }

  // Standing inside something solid has to be recoverable: the character spawns beside a
  // house whose roof reaches out over the spawn, or a building goes up on top of it. Shoves
  // the position out through the nearest wall. Returns a new { x, z }, or null if it is
  // already clear.
  function pushOut(pos, blockers, radius) {
    if (!blockers) return null;
    var r = radius || 0;
    var worst = null, worstDepth = 0;
    for (var i = 0; i < blockers.length; i++) {
      var depth = boxDepth(blockers[i], pos, r);
      if (depth > worstDepth) { worstDepth = depth; worst = blockers[i]; }
    }
    if (!worst) return null;

    var dx = pos.x - worst.x, dz = pos.z - worst.z;
    var lx = dx * worst.cos - dz * worst.sin;
    var lz = dx * worst.sin + dz * worst.cos;
    var outX = (worst.hx + r) - Math.abs(lx);
    var outZ = (worst.hz + r) - Math.abs(lz);
    // Leave by whichever wall is closest, so the character steps out rather than across.
    if (outX < outZ) lx += (lx < 0 ? -1 : 1) * outX;
    else lz += (lz < 0 ? -1 : 1) * outZ;
    return {
      x: worst.x + lx * worst.cos + lz * worst.sin,
      z: worst.z - lx * worst.sin + lz * worst.cos
    };
  }

  // Ease the facing toward where the character is actually travelling, so a change of
  // direction reads as a turn rather than a snap. Both are unit tangents at `up`.
  function turnFacing(facing, target, up, dt) {
    var next = tangent(facing.clone().lerp(target, Math.min(1, TURN_RATE * dt)), up);
    if (next) facing.copy(next);
  }

  // Angles wrap, hence the shortest-way normalisation. Island view only.
  function turnToward(current, target, dt) {
    var delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * Math.min(1, TURN_RATE * dt);
  }

  // --- Per-frame update, one per view ----------------------------------------------------
  // ctx (sphere): { forward, right, input, isLandAt, speed, height, scale, radius }
  // ctx (flat):   { forward, right, input, isLandAt, speed, baseY, scale }
  // `forward`/`right` are the camera's tangent axes, so W is "away from the camera" in
  // every view, looking down from orbit as well as standing on the ground.

  function updateSphere(player, dt, ctx) {
    if (!player.group || !player.placed) return;

    var moved = stepSphereSliding(player.dir, ctx.forward, ctx.right, ctx.input,
      ctx.speed * dt, ctx.radius, ctx.isLandAt);
    player.moving = !!moved;
    player.lastAngle = 0;

    if (moved) {
      // Carry the facing along by the same rotation, then ease it toward the way we
      // actually went — after a slide that is not always the way we asked to go.
      player.facing.applyAxisAngle(moved.axis, moved.angle);
      var travel = new THREE.Vector3().subVectors(moved.pos, player.dir);
      player.dir.copy(moved.pos);
      player.lastAxis.copy(moved.axis);
      player.lastAngle = moved.angle;

      var target = tangent(travel, player.dir);
      if (target) turnFacing(player.facing, target, player.dir, dt);
    }
    // Numerical drift would otherwise slowly tilt the facing off the tangent plane.
    var straight = tangent(player.facing, player.dir);
    if (straight) player.facing.copy(straight);

    advanceBob(player, dt);
    player.group.position.copy(player.dir).multiplyScalar(ctx.height + bobOffset(player));
    player.group.scale.setScalar(ctx.scale);
    orientOnSphere(player);
    // The step is an angle, so the ground distance is angle * radius.
    animatePlayer(player, dt, player.lastAngle * ctx.radius, ctx.scale);
  }

  function updateFlat(player, dt, ctx) {
    if (!player.group || !player.placed) return;

    var moved = moveFlat({ x: player.x, z: player.z }, ctx.forward, ctx.right, ctx.input,
      ctx.speed * dt, ctx.isLandAt, ctx.blockers, ctx.blockerRadius);
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
    animatePlayer(player, dt, moved ? Math.sqrt(dx * dx + dz * dz) : 0, ctx.scale);
  }

  // Stand upright on the surface, facing along `facing`. No reference tangent and no angle
  // anywhere in here: the basis comes straight from the two vectors already carried.
  function orientOnSphere(player) {
    var up = player.dir;
    var forward = tangent(player.facing, up);
    if (!forward) return;
    var right = new THREE.Vector3().crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();
    player.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward));
  }

  // Feed the walk/idle blend the distance covered this frame, converted to the MODEL's own
  // units so the pace holds at any planet size (walkers.js does the same for residents).
  function animatePlayer(player, dt, distance, scale) {
    if (!player.animator || dt <= 0) return;
    player.animator.update(dt, distance / dt / (scale || 1));
  }

  function advanceBob(player, dt) {
    if (player.animator) { player.bob = 0; return; } // the clip has its own bounce
    if (player.moving) player.bob += dt * BOB_RATE;
    else player.bob = 0;
  }

  function bobOffset(player) {
    return player.moving && !player.animator ? Math.abs(Math.sin(player.bob)) * BOB_HEIGHT : 0;
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
    tangent: tangent,
    // Exposed for scripts/test-player.js.
    stepSphere: stepSphere,
    stepSphereSliding: stepSphereSliding,
    moveSphere: moveSphere,
    moveFlat: moveFlat,
    blockedStep: blockedStep,
    boxDepth: boxDepth,
    pushOut: pushOut,
    inputDirection: inputDirection,
    TILES_PER_SECOND: TILES_PER_SECOND
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MI.world.player;
})();
