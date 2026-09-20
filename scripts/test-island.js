// Offline check for src/world/island.js — NOT loaded by the app. Run:  node scripts/test-island.js
// Grows land two ways: a winding strip like the old MI.app placement (two tiles per memory
// along a drifting heading, still what older saves hold) and the compact blob MI.placement
// makes now. It coils each into an island, and fails loudly if a tile goes missing or doubles
// up, the island splits, it comes out a strip instead of a chunk, a tile loses every planet
// neighbour, a road fails to join two memories, or (new worlds) two buildings end up side
// by side on the island.
var path = require('path');
var fs = require('fs');

globalThis.window = globalThis;
globalThis.THREE = require(path.join(__dirname, '..', 'three-r128.min.js'));
require(path.join(__dirname, '..', 'src', 'world', 'sphere.js'));
var growth = require(path.join(__dirname, '..', 'src', 'world', 'growth.js'));
var island = require(path.join(__dirname, '..', 'src', 'world', 'island.js'));
var placement = require(path.join(__dirname, '..', 'src', 'world', 'placement.js'));
var sphere = globalThis.MI.world.sphere;

function loadTiles(f) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', growth.gridUrl(f)), 'utf8')).tiles;
}

function wobbleFor(step) {
  var h = ((step * 2654435761) >>> 0) / 4294967296;
  return (h - 0.5) * 1.15;
}

// MI.app's placement: the chain steps two tiles along a heading; its stepped-over tile and a
// couple of neighbours become terrain.
function growStrip(tiles, memories) {
  sphere.setGrid({ tiles: tiles });
  var world = { home: null, heading: null, memories: [], landscape: [], people: [] };
  for (var n = 0; n < memories; n++) {
    var occupied = growth.landSlots(world);
    var last = world.memories[world.memories.length - 1];
    var slot = null, via = null;
    if (last) {
      var step = sphere.walkFrom(last.placement.slot, world.heading, occupied, wobbleFor(world.memories.length));
      if (step) { slot = step.slot; via = step.via; world.heading = step.heading; }
    }
    if (slot === null) {
      slot = sphere.nextFreeSlot(occupied, world.home,
        new Set(world.memories.map(function (m) { return m.placement.slot; })));
    }
    if (slot === null) break;
    if (world.home === null) world.home = slot;
    world.memories.push({ id: 'm' + n, placement: { slot: slot } });
    occupied.add(slot);
    if (via !== null && !occupied.has(via) && tiles[via].sides === 6) {
      world.landscape.push({ slot: via });
      occupied.add(via);
    }
    var added = 0;
    tiles[slot].neighbors.forEach(function (nb) {
      if (added >= 1 + (n % 2) || tiles[nb].sides !== 6 || occupied.has(nb)) return;
      world.landscape.push({ slot: nb });
      occupied.add(nb);
      added++;
    });
  }
  return world;
}

// MI.app's placement now: MI.placement.choose, then a bridge (if asked for) and 1-3 neighbours.
function growBlob(tiles, memories) {
  sphere.setGrid({ tiles: tiles });
  var home = tiles.filter(function (t) { return t.sides === 6; })[0].id;
  var world = { home: home, house: { slot: home }, memories: [], landscape: [{ slot: home }], people: [] };
  var taken = new Set([home]);
  for (var n = 0; n < memories; n++) {
    var buildings = new Set(world.memories.map(function (m) { return m.placement.slot; }));
    buildings.add(home);
    var found = placement.choose(tiles, {
      home: home, buildings: buildings, land: growth.landSlots(world), taken: taken, count: n
    });
    if (found === null) break;
    var slot = found.slot;
    world.memories.push({ id: 'm' + n, placement: { slot: slot } });
    taken.add(slot);
    var made = 0, wanted = 1 + (n % 3);
    if (found.via !== null && !taken.has(found.via)) {
      world.landscape.push({ slot: found.via }); taken.add(found.via); made++;
    }
    var start = slot % tiles[slot].sides;
    for (var s = 0; s < tiles[slot].sides && made < wanted; s++) {
      var nb = tiles[slot].neighbors[(start + s) % tiles[slot].sides];
      if (tiles[nb].sides !== 6 || taken.has(nb)) continue;
      world.landscape.push({ slot: nb }); taken.add(nb); made++;
    }
  }
  return world;
}

function pieces(cells) {
  var slots = Object.keys(cells);
  var seen = {}, count = 0;
  slots.forEach(function (start) {
    if (seen[start]) return;
    count++;
    var queue = [start];
    seen[start] = true;
    while (queue.length) {
      var a = cells[queue.shift()];
      slots.forEach(function (s) {
        if (!seen[s] && island.adjacent(a, cells[s])) { seen[s] = true; queue.push(s); }
      });
    }
  });
  return count;
}

var failures = [];
function check(cond, message) { if (!cond) failures.push(message); }

var RUNS = [[2, 5], [3, 12], [4, 20], [6, 45], [8, 80], [10, 140]];
var CASES = [];
RUNS.forEach(function (run) { CASES.push({ kind: 'strip', f: run[0], n: run[1] }); });
RUNS.forEach(function (run) { CASES.push({ kind: 'blob', f: run[0], n: Math.min(run[1], 40) }); });

CASES.forEach(function (run) {
  var f = run.f, tiles = loadTiles(f);
  var world = run.kind === 'blob' ? growBlob(tiles, run.n) : growStrip(tiles, run.n);
  var land = growth.landSlots(world);
  var buildings = new Set(world.memories.map(function (m) { return m.placement.slot; }));
  if (run.kind === 'blob') buildings.add(world.home);
  var result = island.layout(land, world.home, tiles, buildings);
  var cells = result.cells;
  var label = run.kind + ' f=' + f + ' (' + land.size + ' land tiles): ';

  if (run.kind === 'blob') {
    var list = Array.from(buildings), beside = 0;
    for (var p = 0; p < list.length; p++) {
      for (var q = p + 1; q < list.length; q++) {
        if (island.adjacent(cells[list[p]], cells[list[q]])) beside++;
      }
    }
    check(beside === 0, label + beside + ' building pair(s) side by side on the island');
  }

  var placed = Object.keys(cells);
  check(placed.length === land.size, label + 'placed ' + placed.length + ' of ' + land.size);
  var keys = new Set(placed.map(function (s) { return cells[s].i + ',' + cells[s].j; }));
  check(keys.size === placed.length, label + 'two tiles share a cell');
  check(pieces(cells) === 1, label + 'island is in ' + pieces(cells) + ' pieces');
  check(cells[world.home].i === 0 && cells[world.home].j === 0, label + 'home is not at the centre');

  // A hexagonal blob of n cells has radius about sqrt(n / 3); a strip is far longer. Keeping buildings apart costs a little compactness, so there is some slack.
  var ideal = Math.sqrt(land.size / 3);
  check(result.radius <= ideal * 1.4 + 2, label + 'not compact: radius ' + result.radius.toFixed(1) +
    ' vs ideal ' + ideal.toFixed(1));

  // How spread out the land was on the planet, in the same units (hex steps from home).
  var planetSpread = 0;
  var homeDir = tiles[world.home].dir;
  var spacing = Math.acos(Math.min(1, tiles[tiles[world.home].neighbors[0]].dir.reduce(function (s, v, k) {
    return s + v * homeDir[k];
  }, 0)));
  land.forEach(function (s) {
    var d = tiles[s].dir;
    planetSpread = Math.max(planetSpread, Math.acos(Math.min(1, d[0] * homeDir[0] + d[1] * homeDir[1] + d[2] * homeDir[2])) / spacing);
  });

  var lonely = 0;
  placed.forEach(function (s) {
    var planetNeighbours = tiles[s].neighbors.filter(function (n) { return land.has(n); });
    if (!planetNeighbours.length) return;
    if (!planetNeighbours.some(function (n) { return island.adjacent(cells[s], cells[n]); })) lonely++;
  });
  check(lonely / placed.length <= 0.15, label + lonely + ' tiles lost every planet neighbour');

  // Roads join consecutive memories.
  var pairs = [];
  for (var i = 1; i < world.memories.length; i++) {
    pairs.push([world.memories[i - 1].placement.slot, world.memories[i].placement.slot]);
  }
  var edges = island.roads(cells, pairs, buildings);
  var broken = 0;
  pairs.forEach(function (pair) {
    // Walk the road graph from one memory and see if it reaches the other.
    var seen = {}, queue = [pair[0]];
    seen[pair[0]] = true;
    while (queue.length) {
      var at = queue.shift();
      (edges[at] || []).forEach(function (k) {
        var c = cells[at], d = island.DIRS[k];
        var next = placed.filter(function (s) { return cells[s].i === c.i + d[0] && cells[s].j === c.j + d[1]; })[0];
        if (next !== undefined && !seen[next]) { seen[next] = true; queue.push(Number(next)); }
      });
    }
    if (!seen[pair[1]]) broken++;
  });
  check(broken === 0, label + broken + ' of ' + pairs.length + ' memory pairs have no road');
  // Routes should share one network, not each pave their own track across the island: no
  // more road than the planet itself lays for the same memories (world.js routeOnSphere:
  // shortest path through land), give or take.
  var planetRoad = new Set();
  pairs.forEach(function (pair) {
    var cameFrom = {}, seen = {};
    seen[pair[0]] = true;
    var queue = [pair[0]];
    while (queue.length) {
      var id = queue.shift();
      if (id === pair[1]) break;
      tiles[id].neighbors.forEach(function (n) {
        if (seen[n] || (!land.has(n) && n !== pair[1])) return;
        seen[n] = true; cameFrom[n] = id; queue.push(n);
      });
    }
    for (var at = pair[1]; at !== undefined; at = cameFrom[at]) planetRoad.add(at);
  });
  var paved = Object.keys(edges).length;
  check(paved <= planetRoad.size * 1.25 + 2,
    label + 'roads pave ' + paved + ' cells vs ' + planetRoad.size + ' on the planet');

  console.log(label + 'planet spread ' + planetSpread.toFixed(1) + ' steps -> island radius ' +
    result.radius.toFixed(1) + ' (ideal ' + ideal.toFixed(1) + '), ' + lonely + ' lonely, ' +
    Object.keys(edges).length + ' road cells');
});

if (failures.length) {
  console.error('--- FAILED ---');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('--- all island checks passed ---');
