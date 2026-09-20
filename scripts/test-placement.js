// Offline check for src/world/placement.js — NOT loaded by the app. Run:  node scripts/test-placement.js
// Grows worlds on the real grids the way MI.app does (choose a tile, dress a few neighbours),
// and fails loudly if two buildings ever touch (the house included), land splits, the layout
// drifts into a strip instead of a blob, a pentagon or taken tile is returned, or a run
// isn't repeatable.
var path = require('path');
var fs = require('fs');

globalThis.window = globalThis;
var growth = require(path.join(__dirname, '..', 'src', 'world', 'growth.js'));
var placement = require(path.join(__dirname, '..', 'src', 'world', 'placement.js'));

function loadTiles(f) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', growth.gridUrl(f)), 'utf8')).tiles;
}

// MI.app.seedLandscape's shape: an optional bridge tile, then neighbours in stored order
// starting at slot % sides, up to `wanted` tiles (1..3) in all.
function dress(tiles, world, slot, via, wanted, taken) {
  var made = 0;
  if (via !== null && !taken.has(via) && tiles[via].sides === 6) {
    world.landscape.push({ slot: via }); taken.add(via); made++;
  }
  var t = tiles[slot], start = slot % t.sides;
  for (var s = 0; s < t.sides && made < wanted; s++) {
    var n = t.neighbors[(start + s) % t.sides];
    if (tiles[n].sides === 5 || taken.has(n)) continue;
    world.landscape.push({ slot: n }); taken.add(n); made++;
  }
}

function grow(tiles, memories, options) {
  var opts = options || {};
  var home = tiles.filter(function (t) { return t.sides === 6; })[0].id;
  var world = { home: home, house: { slot: home }, memories: [], landscape: [{ slot: home }] };
  var taken = new Set([home]);
  var picks = [];
  for (var n = 0; n < memories; n++) {
    var buildings = new Set(world.memories.map(function (m) { return m.placement.slot; }));
    buildings.add(world.house.slot);
    var found = placement.choose(tiles, {
      home: world.home, buildings: buildings, land: growth.landSlots(world), taken: taken, count: n
    });
    if (found === null) break;
    picks.push(found);
    world.memories.push({ placement: { slot: found.slot } });
    taken.add(found.slot);
    dress(tiles, world, found.slot, found.via, 1 + (n % 3), taken);
  }
  world.picks = picks;
  return world;
}

function adjacent(tiles, a, b) { return tiles[a].neighbors.indexOf(b) !== -1; }

function connected(tiles, land) {
  var start = land.values().next().value, seen = new Set([start]), queue = [start];
  while (queue.length) {
    tiles[queue.shift()].neighbors.forEach(function (n) {
      if (land.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    });
  }
  return seen.size === land.size;
}

var failures = [];
function check(cond, message) { if (!cond) failures.push(message); }

[[3, 8], [4, 12], [6, 24], [8, 40], [10, 60]].forEach(function (run) {
  var f = run[0], memories = run[1];
  var tiles = loadTiles(f);
  var world = grow(tiles, memories);
  var again = grow(tiles, memories);
  var label = 'f=' + f + ' (' + world.memories.length + ' memories): ';

  check(world.memories.length === memories, label + 'only placed ' + world.memories.length);
  check(JSON.stringify(world.picks) === JSON.stringify(again.picks), label + 'not deterministic');

  var buildings = world.memories.map(function (m) { return m.placement.slot; });
  buildings.push(world.house.slot);
  var touching = 0;
  for (var a = 0; a < buildings.length; a++) {
    for (var b = a + 1; b < buildings.length; b++) if (adjacent(tiles, buildings[a], buildings[b])) touching++;
  }
  check(touching === 0, label + touching + ' pair(s) of buildings touch');
  check(new Set(buildings).size === buildings.length, label + 'two buildings share a tile');
  buildings.forEach(function (s) { check(tiles[s].sides === 6, label + 'building on a pentagon'); });

  var land = growth.landSlots(world);
  check(connected(tiles, land), label + 'land is split');
  var direct = world.picks.filter(function (p) { return p.tier > 2; }).length;
  check(direct === 0, label + direct + ' placements were disconnected or touching');

  // Compact blob: how far land reaches from home, in tile steps, vs a hexagonal disc's radius.
  var reach = placement.rings(tiles, world.home).ring;
  var far = 0;
  land.forEach(function (s) { far = Math.max(far, reach[s]); });
  var ideal = Math.sqrt(land.size / 3);
  check(far <= ideal * 1.6 + 2, label + 'not compact: reach ' + far + ' vs ideal ' + ideal.toFixed(1));

  console.log(label + land.size + ' land tiles, reach ' + far + ' steps (ideal ' + ideal.toFixed(1) + '), tiers ' +
    [1, 2, 3, 4].map(function (t) { return world.picks.filter(function (p) { return p.tier === t; }).length; }).join('/'));
});

// The chain the old rule made was one-way; the new one should use every side of home.
(function () {
  var tiles = loadTiles(8);
  var world = grow(tiles, 30);
  var home = tiles[world.home].dir;
  var sides = { pos: 0, neg: 0 };
  world.memories.forEach(function (m) {
    var d = tiles[m.placement.slot].dir;
    var dx = d[0] - home[0];
    if (dx >= 0) sides.pos++; else sides.neg++;
  });
  check(sides.pos > 5 && sides.neg > 5, 'placements all lean one way: ' + JSON.stringify(sides));
})();

// A full planet: keeps returning something until every hexagon is used, then null.
(function () {
  var tiles = loadTiles(2);
  var home = tiles.filter(function (t) { return t.sides === 6; })[0].id;
  var taken = new Set([home]);
  var buildings = new Set([home]);
  var land = new Set([home]);
  var placed = 0;
  for (var n = 0; n < 100; n++) {
    var found = placement.choose(tiles, { home: home, buildings: buildings, land: land, taken: taken, count: n });
    if (found === null) break;
    check(tiles[found.slot].sides === 6 && !taken.has(found.slot), 'returned a pentagon or taken tile');
    taken.add(found.slot); buildings.add(found.slot); land.add(found.slot);
    placed++;
  }
  var hexes = tiles.filter(function (t) { return t.sides === 6; }).length;
  check(placed === hexes - 1, 'filled ' + placed + ' of ' + (hexes - 1) + ' free hexagons before null');
})();

if (failures.length) {
  console.error('--- FAILED ---');
  failures.forEach(function (m) { console.error('  - ' + m); });
  process.exit(1);
}
console.log('--- all placement checks passed ---');
