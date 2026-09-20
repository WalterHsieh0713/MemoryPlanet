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
  console.log('--- walker checks passed ---');
}).catch(function (err) { console.error(err); process.exitCode = 1; });
