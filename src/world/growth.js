// MI.growth — the planet size ladder, and the remap that carries a saved world onto the next,
// bigger grid. Pure data + math (no THREE, no DOM), so it runs under Node for tests too.
//
// Growing keeps TILE SIZE constant: a bigger planet has a bigger radius, and your island keeps
// its shape and size while new ocean appears around it (the world scale per size lives in
// world.js, as frequency / 10). On the new grid the island covers a smaller *angle* of the
// sphere, so each saved slot is slid toward home by oldF / newF along the great circle before
// being snapped to the nearest free tile.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.MI = root.MI || {};

  // Frequencies from scripts/generate-hexgrid.js; each size has 10*f*f + 2 tiles.
  // 42 -> 92 -> 162 -> 362 -> 642 -> 1002.
  var LADDER = [2, 3, 4, 6, 8, 10];
  // Share of the buildable (hexagon) tiles that must be land before the planet grows.
  var GROW_AT = 0.5;

  function gridUrl(frequency) {
    // f=10 is the original grid, kept at its old path so saved v2 worlds line up with it.
    return frequency === 10 ? 'data/hexgrid.json' : 'data/grids/hexgrid-f' + frequency + '.json';
  }

  function tierIndex(frequency) {
    return LADDER.indexOf(frequency);
  }

  function nextFrequency(frequency) {
    var i = LADDER.indexOf(frequency);
    return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : null;
  }

  function hexCount(tiles) {
    return tiles.filter(function (t) { return t.sides === 6; }).length;
  }

  function landSlots(world) {
    var used = new Set();
    world.memories.forEach(function (m) {
      if (m.placement && typeof m.placement.slot === 'number') used.add(m.placement.slot);
    });
    world.landscape.forEach(function (l) { used.add(l.slot); });
    return used;
  }

  function growThreshold(tiles) {
    return Math.ceil(hexCount(tiles) * GROW_AT);
  }

  // { land, threshold, frequency, next } — what the UI needs for the "planet grows at" bar.
  function progress(world, tiles, frequency) {
    return {
      land: landSlots(world).size,
      threshold: growThreshold(tiles),
      frequency: frequency,
      next: nextFrequency(frequency)
    };
  }

  function shouldGrow(world, tiles, frequency) {
    return nextFrequency(frequency) !== null && landSlots(world).size >= growThreshold(tiles);
  }

  // --- vector helpers (plain arrays, so this file needs no THREE) ------------------------
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normalize(v) {
    var len = Math.sqrt(dot(v, v)) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  // The point `t` of the way from unit vector a to unit vector b along the great circle.
  function slerp(a, b, t) {
    var theta = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    if (theta < 1e-9) return a.slice();
    var s = Math.sin(theta);
    var wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
    return normalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
  }

  // Nearest hexagon on `tiles` to `dir` that isn't in `claimed`. Pentagons stay water.
  // `keepClearOf` (optional): tiles the result should not touch — used for buildings, so the
  // snap onto the bigger grid doesn't leave two of them side by side. A preference only.
  function nearestFree(tiles, dir, claimed, keepClearOf) {
    var best = null, bestDot = -Infinity, fallback = null, fallbackDot = -Infinity;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.sides !== 6 || claimed.has(t.id)) continue;
      var d = dot(t.dir, dir);
      if (d > fallbackDot) { fallbackDot = d; fallback = t.id; }
      if (keepClearOf && t.neighbors.some(function (n) { return keepClearOf.has(n); })) continue;
      if (d > bestDot) { bestDot = d; best = t.id; }
    }
    return best !== null ? best : fallback;
  }

  // Shortest land-safe path between two tiles on `tiles`: never through a pentagon or through
  // another building. Returns the tiles strictly between from and to, or null if none is short.
  function bridge(tiles, from, to, buildings, maxDepth) {
    var cameFrom = {}, depth = {};
    depth[from] = 0;
    var queue = [from];
    while (queue.length) {
      var id = queue.shift();
      if (id === to) break;
      if (depth[id] >= maxDepth) continue;
      var neighbors = tiles[id].neighbors;
      for (var k = 0; k < neighbors.length; k++) {
        var n = neighbors[k];
        if (depth[n] !== undefined) continue;
        if (n !== to && (tiles[n].sides !== 6 || buildings.has(n))) continue;
        depth[n] = depth[id] + 1;
        cameFrom[n] = id;
        queue.push(n);
      }
    }
    if (depth[to] === undefined) return null;
    var between = [];
    for (var at = cameFrom[to]; at !== undefined && at !== from; at = cameFrom[at]) between.unshift(at);
    return between;
  }

  // Moves every saved slot in `world` from oldTiles onto newTiles, in place. Buildings claim
  // first (home, then memories in the order they were written), then terrain. Neighbouring
  // land on the old grid is kept joined on the new one, bridging any gap the snap opened, so
  // the island never splits into disconnected pieces.
  // Returns { mapping: {oldSlot: newSlot}, added: [landscape entries created as bridges] }.
  function remap(world, oldTiles, newTiles, oldFrequency, newFrequency) {
    var mapping = {};
    var added = [];
    if (world.home === null || world.home === undefined || !oldTiles[world.home]) {
      return { mapping: mapping, added: added }; // empty ocean — nothing to carry over
    }

    var homeDir = oldTiles[world.home].dir;
    var ratio = oldFrequency / newFrequency;
    var claimed = new Set();
    var claimedBuildings = new Set();

    function place(oldSlot, isBuilding) {
      if (mapping[oldSlot] !== undefined || !oldTiles[oldSlot]) return;
      var target = slerp(homeDir, oldTiles[oldSlot].dir, ratio);
      var slot = nearestFree(newTiles, target, claimed, isBuilding ? claimedBuildings : null);
      if (slot === null) return; // can't happen while the new grid is bigger than the old
      mapping[oldSlot] = slot;
      claimed.add(slot);
      if (isBuilding) claimedBuildings.add(slot);
    }

    place(world.home, true);
    if (world.hub && typeof world.hub.slot === 'number') place(world.hub.slot, true);
    world.memories.forEach(function (m) { if (m.placement) place(m.placement.slot, true); });
    world.landscape.forEach(function (l) { place(l.slot); });
    world.people.forEach(function (p) { if (p.placement) place(p.placement.slot); });

    // Keep old neighbours joined.
    var oldLand = landSlots(world);
    var assetBySlot = {};
    world.landscape.forEach(function (l) { assetBySlot[l.slot] = l.asset; });
    var newBuildings = new Set();
    world.memories.forEach(function (m) {
      if (m.placement && mapping[m.placement.slot] !== undefined) newBuildings.add(mapping[m.placement.slot]);
    });
    if (world.hub && mapping[world.hub.slot] !== undefined) newBuildings.add(mapping[world.hub.slot]);
    var newLand = new Set();
    oldLand.forEach(function (s) { if (mapping[s] !== undefined) newLand.add(mapping[s]); });

    oldLand.forEach(function (s) {
      oldTiles[s].neighbors.forEach(function (n) {
        if (n < s || !oldLand.has(n)) return; // each old pair once
        var a = mapping[s], b = mapping[n];
        if (a === undefined || b === undefined || a === b) return;
        if (newTiles[a].neighbors.indexOf(b) !== -1) return; // still touching
        var path = bridge(newTiles, a, b, newBuildings, 6);
        if (!path) return;
        path.forEach(function (slot) {
          if (newLand.has(slot)) return;
          newLand.add(slot);
          var entry = {
            slot: slot,
            asset: assetBySlot[s] || assetBySlot[n] || 'grass.glb',
            fromMemoryId: null,
            source: 'growth'
          };
          added.push(entry);
        });
      });
    });

    // Rewrite the records.
    function moved(slot) { return mapping[slot] !== undefined ? mapping[slot] : slot; }
    world.memories.forEach(function (m) {
      if (!m.placement) return;
      m.placement.slot = moved(m.placement.slot);
      m.placement.dir = newTiles[m.placement.slot].dir.slice();
    });
    world.landscape.forEach(function (l) { l.slot = moved(l.slot); });
    world.people.forEach(function (p) {
      if (!p.placement) return;
      p.placement.slot = moved(p.placement.slot);
      p.placement.dir = newTiles[p.placement.slot].dir.slice();
    });
    world.home = moved(world.home);
    if (world.house && typeof world.house.slot === 'number') world.house.slot = moved(world.house.slot);
    if (world.hub && typeof world.hub.slot === 'number') world.hub.slot = moved(world.hub.slot);
    added.forEach(function (entry) { world.landscape.push(entry); });

    return { mapping: mapping, added: added };
  }

  root.MI.growth = {
    LADDER: LADDER,
    GROW_AT: GROW_AT,
    gridUrl: gridUrl,
    tierIndex: tierIndex,
    nextFrequency: nextFrequency,
    hexCount: hexCount,
    landSlots: landSlots,
    growThreshold: growThreshold,
    progress: progress,
    shouldGrow: shouldGrow,
    remap: remap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MI.growth;
})();
