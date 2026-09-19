// Offline check for src/world/growth.js — NOT loaded by the app. Run:  node scripts/test-growth.js
// Grows a simulated island up the whole size ladder (42 -> 1002 tiles), remapping at every
// step, and fails loudly if a remap loses a memory, stacks two buildings, puts land on a
// pentagon, or splits the island into more pieces than it had.
var path = require('path');
var fs = require('fs');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'src', 'world', 'sphere.js'));
var growth = require(path.join(__dirname, '..', 'src', 'world', 'growth.js'));
var sphere = globalThis.MI.world.sphere;

function loadGrid(f) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', growth.gridUrl(f)), 'utf8')).tiles;
}

function components(tiles, land) {
  var seen = new Set(), count = 0;
  land.forEach(function (start) {
    if (seen.has(start)) return;
    count++;
    var queue = [start];
    seen.add(start);
    while (queue.length) {
      tiles[queue.shift()].neighbors.forEach(function (n) {
        if (land.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
      });
    }
  });
  return count;
}

function maxAngleFromHome(world, tiles) {
  var h = tiles[world.home].dir, max = 0;
  growth.landSlots(world).forEach(function (s) {
    var d = tiles[s].dir;
    max = Math.max(max, Math.acos(Math.min(1, h[0] * d[0] + h[1] * d[1] + h[2] * d[2])));
  });
  return max;
}

// Roughly what MI.app does: a building on the nearest free tile not touching another
// building, plus up to two terrain tiles beside it.
function addMemory(world, tiles, n) {
  var occupied = growth.landSlots(world);
  var buildings = new Set(world.memories.map(function (m) { return m.placement.slot; }));
  var slot = sphere.nextFreeSlot(occupied, world.home, buildings);
  if (slot === null) return false;
  if (world.home === null) world.home = slot;
  var id = 'memory-' + n;
  world.memories.push({ id: id, placement: { slot: slot, dir: tiles[slot].dir.slice() } });
  occupied.add(slot);
  var added = 0;
  tiles[slot].neighbors.forEach(function (nb) {
    if (added >= 2 || tiles[nb].sides !== 6 || occupied.has(nb)) return;
    world.landscape.push({ slot: nb, asset: 'grass.glb', fromMemoryId: id });
    occupied.add(nb);
    added++;
  });
  if (n % 3 === 0) {
    world.people.push({ id: 'person-' + n, placement: { slot: slot, dir: tiles[slot].dir.slice() } });
  }
  return true;
}

var failures = [];
function check(cond, message) { if (!cond) failures.push(message); }

var world = { home: null, memories: [], landscape: [], people: [] };
var frequency = growth.LADDER[0];
var tiles = loadGrid(frequency);
sphere.setGrid({ tiles: tiles });
var written = 0;

while (true) {
  while (!growth.shouldGrow(world, tiles, frequency)) {
    if (!addMemory(world, tiles, ++written)) break;
  }
  var next = growth.nextFrequency(frequency);
  if (next === null) break;

  var before = {
    memories: world.memories.length,
    land: growth.landSlots(world).size,
    pieces: components(tiles, growth.landSlots(world)),
    spread: maxAngleFromHome(world, tiles) * frequency
  };
  var newTiles = loadGrid(next);
  var result = growth.remap(world, tiles, newTiles, frequency, next);
  var land = growth.landSlots(world);
  var buildingSlots = world.memories.map(function (m) { return m.placement.slot; });
  var after = {
    pieces: components(newTiles, land),
    spread: maxAngleFromHome(world, newTiles) * next
  };
  var label = frequency + ' -> ' + next + ': ';

  check(world.memories.length === before.memories, label + 'memory count changed');
  check(new Set(buildingSlots).size === buildingSlots.length, label + 'two buildings share a tile');
  land.forEach(function (s) { check(newTiles[s].sides === 6, label + 'land on pentagon ' + s); });
  world.memories.forEach(function (m) {
    var d = newTiles[m.placement.slot].dir;
    check(d[0] === m.placement.dir[0] && d[1] === m.placement.dir[1] && d[2] === m.placement.dir[2],
      label + 'stale placement.dir on ' + m.id);
  });
  world.people.forEach(function (p) {
    check(buildingSlots.indexOf(p.placement.slot) !== -1, label + p.id + ' no longer stands on a building tile');
  });
  check(buildingSlots.indexOf(world.home) !== -1, label + 'home is not a building tile');
  check(after.pieces <= before.pieces, label + 'island split: ' + before.pieces + ' -> ' + after.pieces + ' pieces');

  console.log(label + before.memories + ' memories, land ' + before.land + ' -> ' + land.size +
    ' (' + result.added.length + ' bridge tiles), pieces ' + before.pieces + ' -> ' + after.pieces +
    ', island spread (angle x f) ' + before.spread.toFixed(2) + ' -> ' + after.spread.toFixed(2) +
    ', now ' + Math.round(100 * land.size / growth.hexCount(newTiles)) + '% full');

  tiles = newTiles;
  frequency = next;
  sphere.setGrid({ tiles: tiles });
}

console.log('final: f=' + frequency + ', ' + world.memories.length + ' memories, ' +
  growth.landSlots(world).size + ' land tiles');
if (failures.length) {
  console.error('--- FAILED ---');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('--- all growth checks passed ---');
