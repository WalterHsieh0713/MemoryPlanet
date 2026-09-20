// MI.placement — where the next memory's building goes. Pure data + math (no THREE, no DOM),
// so it runs under Node too: node scripts/test-placement.js.
//
// The land grows as a compact blob around home, the way the island view shows it. A new
// building takes the free hexagon nearest home that is joined to the existing land and is not
// touching another building (the house counts), so buildings always have terrain or road
// between them. Deterministic: the same world always picks the same tile.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.MI = root.MI || {};

  // Steps from `start` through the tile graph, one entry per reachable tile.
  function rings(tiles, start) {
    var ring = {};
    ring[start] = 0;
    var order = [start];
    for (var at = 0; at < order.length; at++) {
      var id = order[at];
      tiles[id].neighbors.forEach(function (n) {
        if (ring[n] === undefined) { ring[n] = ring[id] + 1; order.push(n); }
      });
    }
    return { ring: ring, order: order };
  }

  // Deterministic 0..1 from a tile and how many memories exist, so ties don't always resolve
  // toward the same side of the planet.
  function jitter(slot, count) {
    var h = Math.imul(slot + 1, 2654435761) ^ Math.imul(count + 7, 40503);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  }

  function touches(tile, set) {
    for (var k = 0; k < tile.neighbors.length; k++) if (set.has(tile.neighbors[k])) return true;
    return false;
  }

  // opts: { home, buildings: Set (memories + the house), land: Set (every land tile),
  //         taken: Set (anything already on a tile), count: memories so far }
  // Returns { slot, via, tier } or null when the planet has no free hexagon left.
  //   via  — a tile to turn into land so the building is joined by land (tier 2), else null
  //   tier — 1 joined directly, 2 joined by one bridge tile, 3 free but disconnected,
  //          4 free and touching a building (only when nothing else is left)
  function choose(tiles, opts) {
    var home = opts.home;
    var start = (home === null || home === undefined) ? firstHexagon(tiles) : home;
    var reach = rings(tiles, start);
    var buildings = opts.buildings || new Set();
    var land = opts.land || new Set();
    var taken = opts.taken || new Set();
    var count = opts.count || 0;

    function free(id) { return tiles[id].sides === 6 && !taken.has(id); }

    var best = { 1: null, 2: null, 3: null, 4: null };
    function offer(tier, slot, via, ring, joined) {
      var score = ring * 10 - joined + jitter(slot, count) * 0.5;
      var cur = best[tier];
      if (!cur || score < cur.score) best[tier] = { slot: slot, via: via, tier: tier, score: score };
    }

    reach.order.forEach(function (id) {
      if (!free(id)) return;
      var tile = tiles[id];
      var ring = reach.ring[id];
      if (touches(tile, buildings)) { offer(4, id, null, ring, 0); return; }

      var joined = tile.neighbors.filter(function (n) { return land.has(n) && !buildings.has(n); }).length;
      if (joined) { offer(1, id, null, ring, joined); return; }

      // Not next to land it can join: is there a free tile beside it that touches land?
      var via = null, viaScore = Infinity;
      tile.neighbors.forEach(function (n) {
        if (!free(n) || !touches(tiles[n], land)) return;
        var score = reach.ring[n] * 10 + jitter(n, count);
        if (score < viaScore) { viaScore = score; via = n; }
      });
      if (via !== null) offer(2, id, via, ring, 0);
      else offer(3, id, null, ring, 0);
    });

    for (var tier = 1; tier <= 4; tier++) if (best[tier]) return best[tier];
    return null;
  }

  function firstHexagon(tiles) {
    for (var i = 0; i < tiles.length; i++) if (tiles[i].sides === 6) return tiles[i].id;
    return 0;
  }

  root.MI.placement = { choose: choose, rings: rings };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MI.placement;
})();
