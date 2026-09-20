// MI.island — how the planet's land becomes a floating island: which flat hex cell every
// land tile gets, and where the roads run across it. Pure data + math (no THREE, no DOM), so
// it runs under Node too: node scripts/test-island.js.
//
// The planet's land is not laid out to match a flat grid tile-for-tile (a saved world can be
// a winding chain, and even a compact planet has no flat equivalent), so the island coils it
// into a compact chunk: tiles are placed in order outward from home, each beside a neighbour
// it touched on the planet, on whichever free cell sits closest to the centre.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.MI = root.MI || {};

  // Axial offsets for flat direction k, which sits at -k*60 degrees (the same convention as
  // world.js's hexDirection, so kitEdge() converts these to the kit's edge indices).
  var DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

  function key(i, j) { return i + ',' + j; }

  // Squared distance from the origin in cell spacings: |i*D0 + j*D1|^2 with a 60 deg basis.
  function dist2(i, j) { return i * i + i * j + j * j; }

  function adjacent(a, b) {
    for (var k = 0; k < 6; k++) {
      if (a.i + DIRS[k][0] === b.i && a.j + DIRS[k][1] === b.j) return true;
    }
    return false;
  }

  // landSlots: Set of planet slots that are land. Returns { cells: {slot: {i, j, ring}},
  // radius } — ring is the distance from home in cell spacings, radius the largest ring.
  // buildings (optional): Set of slots that hold a building. The coil is not a mirror of the
  // planet's adjacency, so a building is kept off any cell beside another building where it
  // can — two houses never end up side by side on the island either.
  function layout(landSlots, homeSlot, tiles, buildings) {
    var cells = {};
    var taken = {};
    var land = Array.from(landSlots).sort(function (a, b) { return a - b; });
    if (!land.length) return { cells: cells, radius: 0 };

    // Planet order: breadth-first from home through land, so each tile has a parent that is
    // already placed. A second pass picks up any land not joined to home (old saves).
    var order = [], parent = {}, seen = new Set();
    function walk(from) {
      seen.add(from);
      parent[from] = null;
      var queue = [from];
      while (queue.length) {
        var id = queue.shift();
        order.push(id);
        tiles[id].neighbors.forEach(function (n) {
          if (!landSlots.has(n) || seen.has(n)) return;
          seen.add(n);
          parent[n] = id;
          queue.push(n);
        });
      }
    }
    walk(landSlots.has(homeSlot) ? homeSlot : land[0]);
    land.forEach(function (slot) { if (!seen.has(slot)) walk(slot); });

    function place(slot, i, j) {
      cells[slot] = { i: i, j: j, ring: Math.sqrt(dist2(i, j)) };
      taken[key(i, j)] = true;
    }

    function besideBuilding(c) {
      return Object.keys(cells).some(function (s) {
        return buildings.has(Number(s)) && adjacent(cells[s], c);
      });
    }

    function freeAround(cell) {
      var out = [];
      DIRS.forEach(function (d) {
        var i = cell.i + d[0], j = cell.j + d[1];
        if (!taken[key(i, j)]) out.push({ i: i, j: j });
      });
      return out;
    }

    function frontier() {
      var out = [], listed = {};
      Object.keys(cells).forEach(function (slot) {
        freeAround(cells[slot]).forEach(function (c) {
          var k = key(c.i, c.j);
          if (!listed[k]) { listed[k] = true; out.push(c); }
        });
      });
      return out;
    }

    order.forEach(function (slot, index) {
      if (index === 0) { place(slot, 0, 0); return; }
      var candidates = parent[slot] !== null ? freeAround(cells[parent[slot]]) : [];
      if (!candidates.length) candidates = frontier(); // boxed in: nearest free edge cell
      var isBuilding = !!(buildings && buildings.has(slot));
      var best = null, bestScore = Infinity;
      function consider(list) {
        list.forEach(function (c) {
          // Closest to the centre keeps it a chunk; each planet neighbour it would sit
          // beside is worth a little, so a memory's terrain stays gathered round it.
          var touching = tiles[slot].neighbors.filter(function (n) {
            return cells[n] && adjacent(cells[n], c);
          }).length;
          var score = dist2(c.i, c.j) - 1.5 * touching;
          if (isBuilding && besideBuilding(c)) score += 1000;
          if (score < bestScore - 1e-9) { bestScore = score; best = c; }
        });
      }
      consider(candidates);
      // Every cell round its parent is beside another building: look further out.
      if (isBuilding && bestScore >= 500) consider(frontier());
      place(slot, best.i, best.j);
    });

    var radius = 0;
    Object.keys(cells).forEach(function (slot) { radius = Math.max(radius, cells[slot].ring); });
    return { cells: cells, radius: radius };
  }

  // Stepping onto a cell that already has road costs this much of a fresh one, so later
  // routes join the existing network instead of each paving its own track.
  var PAVED_COST = 0.25;

  // Roads across the island. `pairs`: [slotA, slotB] memory pairs to join (world.js's
  // roadConnections). Routes stay off other buildings where they can. Returns
  // slot -> [flat direction indices the road leaves that cell by].
  function roads(cells, pairs, buildingSlots) {
    var slotAt = {};
    Object.keys(cells).forEach(function (slot) {
      slotAt[key(cells[slot].i, cells[slot].j)] = Number(slot);
    });
    var edges = {};
    function add(slot, k) { (edges[slot] = edges[slot] || new Set()).add(k); }

    // Cheapest path (Dijkstra; a sorted frontier is plenty at island sizes).
    function route(from, to, avoidBuildings) {
      var cost = {}, cameFrom = {}, done = {};
      cost[from] = 0;
      var open = [from];
      while (open.length) {
        var best = 0;
        for (var n = 1; n < open.length; n++) if (cost[open[n]] < cost[open[best]]) best = n;
        var id = open.splice(best, 1)[0];
        if (done[id]) continue;
        done[id] = true;
        if (id === to) break;
        var c = cells[id];
        for (var k = 0; k < 6; k++) {
          var next = slotAt[key(c.i + DIRS[k][0], c.j + DIRS[k][1])];
          if (next === undefined || done[next]) continue;
          if (avoidBuildings && next !== to && buildingSlots.has(next)) continue;
          var step = cost[id] + (edges[next] ? PAVED_COST : 1);
          if (cost[next] === undefined || step < cost[next]) {
            cost[next] = step;
            cameFrom[next] = id;
            open.push(next);
          }
        }
      }
      if (!done[to]) return null;
      var path = [to];
      for (var at = to; cameFrom[at] !== undefined; at = cameFrom[at]) path.unshift(cameFrom[at]);
      return path;
    }

    pairs.forEach(function (pair) {
      var from = pair[0], to = pair[1];
      if (from === to || !cells[from] || !cells[to]) return;
      var path = route(from, to, true) || route(from, to, false);
      if (!path) return;
      for (var n = 1; n < path.length; n++) {
        var a = cells[path[n - 1]], b = cells[path[n]];
        for (var k = 0; k < 6; k++) {
          if (a.i + DIRS[k][0] === b.i && a.j + DIRS[k][1] === b.j) {
            add(path[n - 1], k);
            add(path[n], (k + 3) % 6);
          }
        }
      }
    });

    var out = {};
    Object.keys(edges).forEach(function (slot) { out[slot] = Array.from(edges[slot]); });
    return out;
  }

  // Flat position of a cell, `spacing` units between neighbouring centres.
  function toXZ(cell, spacing) {
    return { x: (cell.i + 0.5 * cell.j) * spacing, z: -0.8660254037844386 * cell.j * spacing };
  }

  root.MI.island = { DIRS: DIRS, layout: layout, roads: roads, toXZ: toXZ, adjacent: adjacent };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MI.island;
})();
