// MI.world.sphere — pure lookup/placement math, no THREE scene state (owner A, per docs/CONTRACT.md).
// The hex/pentagon tiling itself is precomputed once by scripts/generate-hexgrid.js into
// data/hexgrid.json; this module never computes tiling, it just looks values up.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  var RADIUS = 5;
  var grid = null; // { frequency, tiles: [{ id, dir:[x,y,z], neighbors:[ids], sides }] }

  function setGrid(hexgridData) {
    grid = hexgridData;
  }

  function slotToDir(slot) {
    if (!grid) throw new Error('MI.world.sphere: setGrid() must be called before slotToDir()');
    var tile = grid.tiles[slot];
    if (!tile) throw new Error('MI.world.sphere: unknown slot ' + slot);
    return tile.dir.slice();
  }

  function terrainHeight(dir) {
    return RADIUS; // flat sphere for now — hex tiles define the surface, no elevation yet
  }

  // Which tile contains this direction. The grid's tiles are the Voronoi cells of their
  // own centres, so "nearest centre" is not an approximation here — it is exactly the tile
  // you are standing on. Used by walk mode (src/world/player.js) to ask whether the ground
  // under the character is land, once or twice a frame.
  function nearestSlot(dir) {
    if (!grid) throw new Error('MI.world.sphere: setGrid() must be called first');
    var best = -1, bestDot = -Infinity;
    for (var i = 0; i < grid.tiles.length; i++) {
      var d = grid.tiles[i].dir;
      var dot = dir.x * d[0] + dir.y * d[1] + dir.z * d[2];
      if (dot > bestDot) { bestDot = dot; best = grid.tiles[i].id; }
    }
    return best;
  }

  function tile(slot) {
    if (!grid) throw new Error('MI.world.sphere: setGrid() must be called first');
    return grid.tiles[slot] || null;
  }

  function firstHexagon() {
    for (var i = 0; i < grid.tiles.length; i++) {
      if (grid.tiles[i].sides === 6) return grid.tiles[i].id;
    }
    return 0;
  }

  // Next unclaimed tile, breadth-first outward from home, so the land grows as one
  // connected blob instead of scattering. Pentagons are never returned — they stay water.
  //
  // `keepClearOf` (optional) is a set of slots the result should not touch — pass the
  // existing buildings and you get landmarks spread through landscape rather than a solid
  // block of rooftops. It's only a preference: if nothing qualifies we fall back to the
  // nearest free tile, so the island never refuses to grow.
  function nextFreeSlot(takenSlots, homeSlot, keepClearOf) {
    if (!grid) throw new Error('MI.world.sphere: setGrid() must be called first');
    var taken = takenSlots instanceof Set ? takenSlots : new Set(takenSlots || []);
    var avoid = keepClearOf instanceof Set ? keepClearOf : new Set(keepClearOf || []);
    var start = (homeSlot === undefined || homeSlot === null) ? firstHexagon() : homeSlot;

    var seen = new Set([start]);
    var queue = [start];
    var fallback = null;
    while (queue.length) {
      var id = queue.shift();
      var t = grid.tiles[id];
      if (t.sides === 6 && !taken.has(id)) {
        var touchesAvoided = t.neighbors.some(function (n) { return avoid.has(n); });
        if (!touchesAvoided) return id;
        if (fallback === null) fallback = id;
      }
      t.neighbors.forEach(function (n) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      });
    }
    return fallback; // null only when the planet really is full
  }

  // Places object3d on the sphere surface at direction `dir`, oriented so its local +Y
  // (the GLB's "up") points radially outward, then spun by rotY around that same radial axis.
  function orientToSurface(object3d, dir, rotY, height) {
    var h = height === undefined ? RADIUS : height;
    var dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    object3d.position.copy(dirVec).multiplyScalar(h);
    object3d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
    if (rotY) object3d.rotateOnWorldAxis(dirVec, rotY);
  }

  function vec(dir) {
    return new THREE.Vector3(dir[0], dir[1], dir[2]);
  }

  // Flatten a direction against the sphere at `atDir` — a heading only means anything as a
  // tangent, and carrying it from tile to tile is what keeps the chain going one way.
  function tangentAt(atDir, heading) {
    var normal = vec(atDir).normalize();
    var flat = heading.clone().sub(normal.clone().multiplyScalar(heading.dot(normal)));
    if (flat.lengthSq() < 1e-8) {
      // Degenerate (heading points straight out) — pick any tangent to recover.
      flat = new THREE.Vector3(0, 1, 0).cross(normal);
      if (flat.lengthSq() < 1e-8) flat = new THREE.Vector3(1, 0, 0).cross(normal);
    }
    return flat.normalize();
  }

  // The neighbour lying most nearly in `heading`, optionally only considering free ones.
  function neighborAlong(slot, heading, mustBeFree, occupied) {
    var tile = grid.tiles[slot];
    var from = vec(tile.dir);
    var best = null, bestScore = -Infinity;
    tile.neighbors.forEach(function (id) {
      var candidate = grid.tiles[id];
      if (candidate.sides === 5) return;                       // pentagons stay water
      if (mustBeFree && occupied && occupied.has(id)) return;
      var toward = vec(candidate.dir).sub(from).normalize();
      var score = toward.dot(heading);
      if (score > bestScore) { bestScore = score; best = id; }
    });
    return best;
  }

  // Walk two tiles along the heading — far enough to leave a gap between memories for the
  // road and landscape to occupy. The heading wobbles a little each step and is carried to
  // the new tile, so the chain drifts rather than running dead straight or doubling back.
  function walkFrom(startSlot, heading, occupied, wobble) {
    if (!grid || !grid.tiles[startSlot]) return null;
    var start = grid.tiles[startSlot];
    var dir = tangentAt(start.dir, heading ? vec(heading) : new THREE.Vector3(0, 1, 0));
    dir.applyAxisAngle(vec(start.dir).normalize(), wobble);

    var midway = neighborAlong(startSlot, dir, false, occupied);
    if (midway === null) return null;
    var midDir = tangentAt(grid.tiles[midway].dir, dir);
    var landing = neighborAlong(midway, midDir, true, occupied);
    if (landing === null) return null;

    return {
      slot: landing,
      // The tile stepped over. The caller must turn this into land, or the chain is a
      // string of islands: the flat layout can't walk across water and roads can't route.
      via: midway,
      heading: tangentAt(grid.tiles[landing].dir, midDir).toArray()
    };
  }

  MI.world.sphere = {
    setGrid: setGrid,
    walkFrom: walkFrom,
    slotToDir: slotToDir,
    terrainHeight: terrainHeight,
    orientToSurface: orientToSurface,
    tile: tile,
    nearestSlot: nearestSlot,
    firstHexagon: firstHexagon,
    nextFreeSlot: nextFreeSlot,
    RADIUS: RADIUS
  };
})();
