// Offline check for src/world/player.js — NOT loaded by the app. Run:  node scripts/test-player.js
// Walk mode's movement is continuous, so nothing about it is guaranteed by construction the
// way the pets' tile-to-tile stepping was: a bug here walks you into the sea, off the island,
// or slowly off the unit sphere. This exercises the maths against a real grid, headless.
var path = require('path');
var fs = require('fs');

globalThis.window = globalThis;
globalThis.THREE = require(path.join(__dirname, '..', 'three-r128.min.js'));
require(path.join(__dirname, '..', 'src', 'world', 'sphere.js'));
var growth = require(path.join(__dirname, '..', 'src', 'world', 'growth.js'));
var player = require(path.join(__dirname, '..', 'src', 'world', 'player.js'));
var sphere = globalThis.MI.world.sphere;

var failures = 0;
function check(label, ok, detail) {
  if (ok) return;
  failures++;
  console.error('FAIL: ' + label + (detail ? ' — ' + detail : ''));
}

function loadTiles(f) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', growth.gridUrl(f)), 'utf8')).tiles;
}

var RADIUS = sphere.RADIUS;
var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };

// --- A patch of land to walk on -----------------------------------------------------------
// Frequency 4 (162 tiles). Home plus its neighbours are land, everything else is sea, which
// gives a small island with a coastline in every direction.
var tiles = loadTiles(4);
sphere.setGrid({ tiles: tiles });
var home = sphere.firstHexagon();
var land = new Set([home]);
sphere.tile(home).neighbors.forEach(function (id) {
  if (sphere.tile(id).sides === 6) land.add(id);
});
var isLandAt = function (dir) { return land.has(sphere.nearestSlot(dir)); };

var homeDir = V.apply(null, sphere.slotToDir(home));

// Tangent axes at a point, standing in for the camera's.
function axesAt(pos, spin) {
  var up = pos.clone().normalize();
  var ref = Math.abs(up.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  var forward = new THREE.Vector3().crossVectors(ref, up).normalize();
  if (spin) forward.applyAxisAngle(up, spin).normalize();
  var right = new THREE.Vector3().crossVectors(up, forward).normalize();
  return { forward: forward, right: right };
}

// --- stepSphere stays on the sphere, and moves the distance asked ---------------------------
var pos = homeDir.clone();
var ax = axesAt(pos);
var stepped = player.stepSphere(pos, ax.forward, 0.25, RADIUS);
check('stepSphere returns a unit vector', Math.abs(stepped.length() - 1) < 1e-9,
  'length ' + stepped.length());
var arc = Math.acos(Math.max(-1, Math.min(1, stepped.dot(pos)))) * RADIUS;
check('stepSphere covers the distance asked', Math.abs(arc - 0.25) < 1e-6, 'arc ' + arc.toFixed(6));
check('stepSphere leaves its input alone', pos.distanceTo(homeDir) < 1e-12);

// Ten thousand steps must not accumulate drift off the unit sphere.
var drift = homeDir.clone();
for (var i = 0; i < 10000; i++) {
  drift = player.stepSphere(drift, axesAt(drift).forward, 0.01, RADIUS);
}
check('no drift off the unit sphere over 10k steps', Math.abs(drift.length() - 1) < 1e-9,
  'length ' + drift.length());

// --- Walking over the pole is not a special case --------------------------------------------
// Straight on in one direction crosses both poles; every position must stay unit length and
// every step must actually move.
var polar = V(0, 1, 0);
var stuck = 0;
for (var p = 0; p < 400; p++) {
  var next = player.stepSphere(polar, axesAt(polar).forward, 0.1, RADIUS);
  if (next.distanceTo(polar) < 1e-9) stuck++;
  polar = next;
}
check('great-circle walk never stalls, including over the poles', stuck === 0, stuck + ' stalled steps');
check('polar walk stays on the unit sphere', Math.abs(polar.length() - 1) < 1e-9);

// --- The sea blocks you ---------------------------------------------------------------------
// From home, walk one direction until the coast. You must stop, and stop ON land.
var walker = homeDir.clone();
var blocked = false;
for (var w = 0; w < 500; w++) {
  var moved = player.moveSphere(walker, axesAt(walker).forward, axesAt(walker).right,
    { forward: 1, strafe: 0 }, 0.05, RADIUS, isLandAt);
  if (!moved) { blocked = true; break; }
  walker = moved;
}
check('walking into the sea is blocked', blocked, 'never hit a coast in 500 steps');
check('you stop standing on land', isLandAt(walker), 'ended on slot ' + sphere.nearestSlot(walker));

// --- ...and you never end up in the sea, from any direction ---------------------------------
// Walk hard in 24 directions for a long time. Every single position must be land.
var escaped = 0, sampled = 0;
for (var a = 0; a < 24; a++) {
  var pm = homeDir.clone();
  var angle = (a / 24) * Math.PI * 2;
  for (var s = 0; s < 200; s++) {
    var axes = axesAt(pm);
    var input = { forward: Math.cos(angle), strafe: Math.sin(angle) };
    var m = player.moveSphere(pm, axes.forward, axes.right, input, 0.06, RADIUS, isLandAt);
    if (!m) break;
    pm = m;
    sampled++;
    if (!isLandAt(pm)) escaped++;
  }
}
check('no walk in any direction ever ends up in the sea', escaped === 0,
  escaped + ' of ' + sampled + ' positions were water');

// --- Sliding: a diagonal into the coast keeps the half that is still land -------------------
// Walk straight ahead (forward only) until the coast blocks it. At that point the forward
// axis is known to be blocked, so pushing diagonally can only move you via the strafe axis —
// which is exactly what sliding along a shoreline is. Twenty-four rotated frames give
// twenty-four different stretches of coast to try it against.
var slid = 0, cornered = 0;
for (var t = 0; t < 24; t++) {
  var spin = (t / 24) * Math.PI * 2;
  var sp = homeDir.clone();
  var frame = axesAt(sp, spin);
  for (var k = 0; k < 400; k++) {
    var step = player.moveSphere(sp, frame.forward, frame.right,
      { forward: 1, strafe: 0 }, 0.05, RADIUS, isLandAt);
    if (!step) break;
    sp = step;
    frame = axesAt(sp, spin);
  }
  check('walking straight ahead stops on land', isLandAt(sp));

  var diag = player.moveSphere(sp, frame.forward, frame.right,
    { forward: 1, strafe: 1 }, 0.05, RADIUS, isLandAt);
  if (diag) {
    slid++;
    check('a slide stays on land', isLandAt(diag));
    // It slid, so it must have gone sideways, not forward into the sea.
    var went = new THREE.Vector3().subVectors(diag, sp).normalize();
    check('a slide moves along the shore, not into it', went.dot(frame.forward) < 0.9,
      'forward component ' + went.dot(frame.forward).toFixed(3));
  } else {
    cornered++;
  }
}
check('a diagonal into the coast slides rather than sticking', slid > 0,
  'all 24 headings were fully cornered');

// --- The island (flat) view ------------------------------------------------------------------
// A 3x3 metre square of land around the origin; anything outside is off the island.
var flatLand = function (p) { return Math.abs(p.x) <= 1.5 && Math.abs(p.z) <= 1.5; };
var fwd = V(0, 0, 1), rgt = V(1, 0, 0);

var fp = { x: 0, z: 0 };
for (var f = 0; f < 200; f++) {
  var fm = player.moveFlat(fp, fwd, rgt, { forward: 1, strafe: 0 }, 0.05, flatLand);
  if (!fm) break;
  fp = fm;
}
check('island: walking off the edge is blocked', fp.z <= 1.5 + 1e-9, 'z ' + fp.z);
check('island: you stop on the island', flatLand(fp));

// A diagonal at the north edge must slide along it in x rather than stopping dead.
var edge = { x: 0, z: 1.49 };
var slidFlat = player.moveFlat(edge, fwd, rgt, { forward: 1, strafe: 1 }, 0.2, flatLand);
check('island: a diagonal into the edge slides along it', !!slidFlat && slidFlat.x > edge.x,
  slidFlat ? 'x ' + slidFlat.x : 'fully blocked');
check('island: the slide stays on the island', !slidFlat || flatLand(slidFlat));

// Fully cornered means no movement at all, not a jitter.
var corner = { x: 1.5, z: 1.5 };
check('island: a corner blocks completely',
  player.moveFlat(corner, fwd, rgt, { forward: 1, strafe: 1 }, 0.2, flatLand) === null);

// --- No input, no movement ---------------------------------------------------------------
check('no keys held means no step (sphere)',
  player.moveSphere(homeDir.clone(), ax.forward, ax.right, { forward: 0, strafe: 0 }, 0.05, RADIUS, isLandAt) === null);
check('no keys held means no step (island)',
  player.moveFlat({ x: 0, z: 0 }, fwd, rgt, { forward: 0, strafe: 0 }, 0.05, flatLand) === null);

// --- nearestSlot really is the containing tile ---------------------------------------------
// A tile's own centre must resolve to itself, for every tile on the grid.
var wrong = 0;
tiles.forEach(function (t) {
  if (sphere.nearestSlot(V(t.dir[0], t.dir[1], t.dir[2])) !== t.id) wrong++;
});
check('every tile centre resolves to its own tile', wrong === 0, wrong + ' tiles misresolved');

if (failures) {
  console.error('\n' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('island: stopped at z=' + fp.z.toFixed(3) + ', slid to x=' + (slidFlat ? slidFlat.x.toFixed(3) : '-'));
console.log('sphere: ' + sampled + ' sampled positions across 24 headings, all on land');
console.log('slides: ' + slid + ' of 24 coastal headings slid, ' + cornered + ' fully cornered');
console.log('--- all player checks passed ---');
