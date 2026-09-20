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
  // It sets off toward the neighbour rather than arriving on it: a walker accelerates away
  // from a standstill now instead of covering the tile on a fixed curve.
  assert.strictEqual(pair.sphere.targetId, 1);
  assert(pair.sphere.group.position.z > 0 && pair.sphere.group.position.z < 5,
    'it is on its way to the neighbour, at z=' + pair.sphere.group.position.z);
  walkers.updateFlat(pair.flat, 0.1, {
    isLand: isLand, neighborsOf: neighborsOf, findAnchor: function () { return 0; },
    centres: { 0: { x: 0, z: 0 }, 1: { x: 1, z: 0 } }, baseY: 2, scale: 1
  });
  assert.strictEqual(pair.flat.targetId, 1);
  assert(pair.flat.group.position.x > 0 && pair.flat.group.position.x < 1,
    'and likewise in the flat view, at x=' + pair.flat.group.position.x);
  pair.flat.tileId = pair.flat.targetId = 0;
  pair.flat.pause = 0;
  pair.flat.t = 1;
  pair.flat.speed = 0;
  pair.flat.pace = 0;
  walkers.updateFlat(pair.flat, 0.1, {
    isLand: function (id) { return id >= 0 && id <= 2; },
    neighborsOf: function () { return [1, 2]; },
    chooseNext: function () { return 2; },
    findAnchor: function () { return 0; },
    centres: { 0: { x: 0, z: 0 }, 1: { x: 1, z: 0 }, 2: { x: 0, z: 1 } },
    baseY: 2, scale: 1
  });
  assert.strictEqual(pair.flat.targetId, 2, 'resident route chooses a stop over a random branch');
  // Going somewhere is ONE walk, not a hop per tile. Five tiles in a line and a friend walking
  // 0 -> 4 with only tile 4 a stop: it has to cross 1, 2 and 3 without ever standing still on
  // them, and hold one pace while it does. (It used to pause 2-3s on every tile it touched,
  // and re-roll its speed for each, which is what made travel read as tile-at-a-time.)
  var line = {}, chain = {};
  for (var c = 0; c <= 4; c++) {
    line[c] = { x: c, z: 0 };
    chain[c] = [c - 1, c + 1].filter(function (n) { return n >= 0 && n <= 4; });
  }
  var road = {
    isLand: function (id) { return line[id] !== undefined; },
    neighborsOf: function (id) { return chain[id]; },
    findAnchor: function () { return 0; },
    chooseNext: function (w) { return w.tileId < 4 ? w.tileId + 1 : w.tileId; },
    stopsAt: function (id) { return id === 4; },
    centres: line, baseY: 0, scale: 1
  };
  var him = pair.flat;
  him.tileId = him.targetId = 0; him.fromTileId = null;
  him.t = 1; him.pause = 0; him.speed = 0; him.pace = 0;
  him.stepRange = [1.5, 1.5]; him.pauseRange = [2, 2];
  var stalled = 0, arrived = -1, was = 0, cruised = [];
  for (var n = 0; n < 60 * 20 && arrived < 0; n++) {
    walkers.updateFlat(him, 1 / 60, road);
    var x = him.group.position.x;
    if (x > 3.999) arrived = n;
    else {
      if (x > 0.05 && x - was < 1e-9) stalled++;
      if (x > 0.6 && x < 3.4) cruised.push(x - was); // clear of setting off and slowing down
    }
    was = x;
  }
  assert(arrived > 0, 'the friend reaches the memory at the far end');
  assert.strictEqual(stalled, 0, 'and never stands still on the way, ' + stalled + ' frames stalled');
  var quickest = Math.max.apply(null, cruised), slowest = Math.min.apply(null, cruised);
  assert((quickest - slowest) / quickest < 0.02,
    'holding one pace across every boundary, ' + slowest.toFixed(5) + '..' + quickest.toFixed(5));
  // It does stop once it gets there, though -- that is what makes it a destination.
  for (var q = 0; q < 60; q++) walkers.updateFlat(him, 1 / 60, road);
  // t of 1 means it is standing ON targetId; tileId only catches up when it next sets off.
  assert.strictEqual(him.targetId, 4, 'it is at the far tile');
  assert.strictEqual(him.t, 1);
  assert(him.pause > 0, 'and standing there rather than walking on');

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
  // --- Following an owner -----------------------------------------------------------------
  // A pet keeps station near whoever it belongs to: close enough and it stands, further and
  // it walks, a long way behind and it runs to catch up. Gaps are in tile-widths so one set
  // of numbers holds on every planet size and in both views.
  assert.strictEqual(walkers.followGait(0.2, false), 'hold', 'right beside its owner it stands');
  assert.strictEqual(walkers.followGait(1.5, false), 'walk', 'a little way back it walks');
  assert.strictEqual(walkers.followGait(6, false), 'run', 'a long way back it runs');

  // Hysteresis: without it a pet jitters on the spot, starting and stopping every time its
  // owner drifts a hair across the line. Once moving it closes right up before it stops.
  var justOutside = walkers.FOLLOW_HEEL + 0.01;
  assert.strictEqual(walkers.followGait(justOutside, false), 'walk',
    'standing still, a gap past the heel sets it off');
  assert.strictEqual(walkers.followGait(justOutside, true), 'walk',
    'and already moving it keeps going');
  assert.strictEqual(walkers.followGait(walkers.FOLLOW_HEEL * 0.4, true), 'hold',
    'it only stops once it has properly caught up');

  // Which way is my owner? On the island that is a straight line, but on the planet a pet
  // walks the surface, so the direction has to be TANGENT where the pet is standing -- the
  // straight line to its owner points through the ground.
  var here = new THREE.Vector3(0, 1, 0);
  var there = new THREE.Vector3(1, 1, 0).normalize();
  var aim = walkers.followTangent(here, there);
  assert(aim, 'there is a way to walk toward an owner further round the planet');
  assert(Math.abs(aim.length() - 1) < 1e-9, 'the heading is a unit vector');
  assert(Math.abs(aim.dot(here)) < 1e-9, 'and lies flat on the surface, not through it');
  // Following it must actually close the gap.
  var before = here.angleTo(there);
  var after = here.clone().addScaledVector(aim, 0.01).normalize().angleTo(there);
  assert(after < before, 'and walking along it gets the pet closer, ' + after + ' < ' + before);
  assert(walkers.followTangent(here, here.clone()) === null,
    'standing on your owner there is no way to walk toward them');

  // Eating stops everything else: a pet handed a carrot stays where it is and chews, however
  // far its owner wanders off, and picks the follow back up when it has finished.
  var fed = {};
  walkers.feed(fed, 5);
  assert.strictEqual(walkers.petGait(fed, 99, 0), 'eat', 'a fed pet eats, even far from its owner');
  for (var e = 0; e < 60 * 4; e++) walkers.petGait(fed, 99, 1 / 60);
  assert.strictEqual(walkers.petGait(fed, 99, 0), 'eat', 'still eating after four of its five seconds');
  for (var e2 = 0; e2 < 60 * 2; e2++) walkers.petGait(fed, 99, 1 / 60);
  assert.strictEqual(walkers.petGait(fed, 99, 0), 'run', 'and then hurries back to its owner');
  // An unfed pet is just following.
  assert.strictEqual(walkers.petGait({}, 0.1, 1 / 60), 'hold', 'a pet nobody fed just keeps station');

  console.log('--- walker checks passed ---');
}).catch(function (err) { console.error(err); process.exitCode = 1; });
