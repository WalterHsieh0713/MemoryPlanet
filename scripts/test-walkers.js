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
  // A friend with nowhere to go strolls instead of standing still: wanderStep picks a
  // standable neighbour, never a forbidden one, and prefers not to double straight back.
  var lone = { tileId: 5, fromTileId: null };
  var ring = { 5: [4, 6, 7], 4: [5], 6: [5], 7: [5] };
  var only = function (ok) { return function (id) { return ok.indexOf(id) !== -1; }; };
  var seen = {};
  for (var i = 0; i < 200; i++) seen[walkers.wanderStep(lone, function (id) { return ring[id]; }, only([4, 5, 6]))] = true;
  assert(seen[4] && seen[6], 'a stroll uses every standable neighbour');
  assert(!seen[7] && !seen[5], 'and never a tile it may not stand on, nor stays put while it has somewhere to go');
  var back = { tileId: 5, fromTileId: 4 };
  var forward = {};
  for (var j = 0; j < 200; j++) forward[walkers.wanderStep(back, function (id) { return ring[id]; }, only([4, 5, 6, 7]))] = true;
  assert(!forward[4] && forward[6] && forward[7], 'it does not double straight back while it has another way');
  var boxed = { tileId: 5, fromTileId: null };
  assert.strictEqual(walkers.wanderStep(boxed, function () { return [7]; }, only([5])), 5,
    'boxed in, it stays where it is');
  var cornered = { tileId: 5, fromTileId: 4 };
  assert.strictEqual(walkers.wanderStep(cornered, function () { return [4]; }, only([4, 5])), 4,
    'and doubles back only when that is the sole way out');
  console.log('--- walker checks passed ---');
}).catch(function (err) { console.error(err); process.exitCode = 1; });
