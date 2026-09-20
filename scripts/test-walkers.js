// Offline regression check for shared pet/resident models and tile walking.
var path = require('path');
globalThis.window = globalThis;
globalThis.THREE = require(path.join(__dirname, '..', 'three-r128.min.js'));
THREE.GLTFLoader = function () {
  this.load = function (_url, _success, _progress, fail) { fail(); };
};
var walkers = require(path.join(__dirname, '..', 'src', 'world', 'walkers.js'));
var assert = require('assert');

var person = { id: 'person-stable', appearance: {} };
var model = walkers.residentModelFor(person);
assert(walkers.isResident(model));
assert.strictEqual(walkers.residentModelFor(person), model);
person.appearance.model = 'female-f';
assert.strictEqual(walkers.residentModelFor(person), 'female-f');
assert(walkers.isPet('dog'));
assert(!walkers.isPet(model));

walkers.makeWalkerPair(model, function () { return new THREE.Group(); }).then(function (pair) {
  assert(pair && pair.sphere.group && pair.flat.group);
  pair.sphere.tileId = pair.sphere.targetId = 0;
  pair.sphere.pauseRange = [0, 0];
  pair.sphere.stepRange = [0.1, 0.1];
  pair.flat.tileId = pair.flat.targetId = 0;
  pair.flat.pauseRange = [0, 0];
  pair.flat.stepRange = [0.1, 0.1];
  var links = { 0: [1], 1: [0] };
  var neighborsOf = function (id) { return links[id]; };
  var isLand = function (id) { return id === 0 || id === 1; };
  walkers.updateSphere(pair.sphere, 0.1, {
    isLand: isLand, neighborsOf: neighborsOf, findAnchor: function () { return 0; },
    dirOf: function (id) { return id ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); },
    height: 5, scale: 1
  });
  assert.strictEqual(pair.sphere.targetId, 1);
  assert(Math.abs(pair.sphere.group.position.z - 5) < 1e-6);
  walkers.updateFlat(pair.flat, 0.1, {
    isLand: isLand, neighborsOf: neighborsOf, findAnchor: function () { return 0; },
    centres: { 0: { x: 0, z: 0 }, 1: { x: 1, z: 0 } }, baseY: 2, scale: 1
  });
  assert.strictEqual(pair.flat.targetId, 1);
  assert(Math.abs(pair.flat.group.position.x - 1) < 1e-6);
  pair.flat.tileId = pair.flat.targetId = 0;
  pair.flat.pause = 0;
  pair.flat.t = 1;
  walkers.updateFlat(pair.flat, 0.1, {
    isLand: function (id) { return id >= 0 && id <= 2; },
    neighborsOf: function () { return [1, 2]; },
    chooseNext: function () { return 2; },
    findAnchor: function () { return 0; },
    centres: { 0: { x: 0, z: 0 }, 1: { x: 1, z: 0 }, 2: { x: 0, z: 1 } },
    baseY: 2, scale: 1
  });
  assert.strictEqual(pair.flat.targetId, 2, 'resident route chooses a stop over a random branch');
  // A friend loiters: a spot is somewhere within half a tile-width of the tile's centre, never
  // in a blocked place, and never reached through one.
  var core = function (x, z) { return Math.hypot(x, z) < 0.25; }; // a building in the middle
  var from = { x: 0.3, z: 0 };
  var reach = 0;
  for (var i = 0; i < 300; i++) {
    var spot = walkers.pickLoiterSpot(from, core);
    assert(spot, 'there is room to wander around a building');
    assert(!core(spot.x, spot.z), 'a spot is never inside the building');
    reach = Math.max(reach, Math.hypot(spot.x, spot.z));
  }
  assert(reach <= 0.5 + 1e-9 && reach > 0.4, 'and stays within half a tile of the centre, using the whole disc');
  // The way to a spot is clear too: from one side of the building it never picks the far side
  // when the straight line runs through it.
  var wall = function (x, z) { return Math.abs(x) < 0.05 && z > -0.4 && z < 0.4; };
  for (var k = 0; k < 300; k++) {
    var across = walkers.pickLoiterSpot({ x: -0.3, z: 0 }, wall);
    assert(across && across.x < 0.05, 'it does not pick a spot on the far side of a wall');
  }
  assert.strictEqual(walkers.pickLoiterSpot({ x: 0.3, z: 0 }, function () { return true; }), null,
    'with nowhere to stand it picks nothing rather than a blocked place');
  // A walker inside a blocked area is only asked to get out.
  var inside = walkers.pickLoiterSpot({ x: 0.1, z: 0 }, core);
  assert(inside && !core(inside.x, inside.z), 'a walker standing in the building can leave it');

  // Frame by frame it walks to its spot at a stroll, then stands, then picks another.
  var walker = { spot: { x: 0.3, z: 0, to: { x: 0.3, z: 0.4 }, wait: 0 } };
  var travelled = 0, moves = 0, waited = 0;
  for (var f = 0; f < 6000; f++) {
    var before = { x: walker.spot.x, z: walker.spot.z };
    var heading = walkers.stepSpot(walker, 1 / 60, { dwell: true, rest: { x: 0.3, z: 0 }, blocked: core });
    var did = Math.hypot(walker.spot.x - before.x, walker.spot.z - before.z);
    assert(did <= 0.22 / 60 + 1e-9, 'a stroll never exceeds its pace');
    assert(!core(walker.spot.x, walker.spot.z), 'and never carries it into the building');
    assert(Math.hypot(walker.spot.x, walker.spot.z) <= 0.62 + 1e-9, 'or off its tile');
    if (heading) { moves++; travelled += did; } else waited++;
  }
  assert(moves > 600 && waited > 600, 'over 100s it both walks and stands, ' + moves + '/' + waited);
  // Leaving to travel: it eases back to the rest place beside the building.
  for (var g = 0; g < 600; g++) walkers.stepSpot(walker, 1 / 60, { dwell: false, rest: { x: 0.3, z: 0 }, blocked: core });
  assert(Math.abs(walker.spot.x - 0.3) < 1e-6 && Math.abs(walker.spot.z) < 1e-6, 'on the road it walks beside the building');
  console.log('--- walker checks passed ---');
}).catch(function (err) { console.error(err); process.exitCode = 1; });
