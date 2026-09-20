// Offline check for src/world/ships.js — NOT loaded by the app. Run:  node scripts/test-ships.js
// The fleet is the one progression system a player can neither buy nor rush, so the things
// that must hold are: a ship is the same ship on every reload, the fleet only ever grows,
// claiming is impossible until the goal is actually met, and every goal can in fact be
// finished by writing (a goal nothing can satisfy would be a ship nobody ever gets).
var path = require('path');

globalThis.window = globalThis;
var ships = require(path.join(__dirname, '..', 'src', 'world', 'ships.js'));

var failures = 0;
function check(label, ok, detail) {
  if (ok) return;
  failures++;
  console.error('FAIL: ' + label + (detail === undefined ? '' : ' — ' + detail));
}

function world(extra) {
  var w = {
    seed: 1234567,
    memories: [], people: [], ships: [],
    wallet: { shards: 0, lifetime: 0, streak: 0, lastDay: null }
  };
  Object.keys(extra || {}).forEach(function (key) { w[key] = extra[key]; });
  return w;
}

// --- The same ship every time ------------------------------------------------------------
// Nothing about a ship is stored beyond its id and claimed flag, so the seed has to reproduce
// the hull, name and goal exactly or a reload would hand the player a different bargain.
(function sameShipEveryTime() {
  var a = ships.makeShip(987654, 2);
  var b = ships.makeShip(987654, 2);
  check('a ship rebuilds identically from the seed', JSON.stringify(a) === JSON.stringify(b),
    JSON.stringify(a) + ' vs ' + JSON.stringify(b));

  var other = ships.makeShip(987655, 2);
  var differs = other.hull !== a.hull || other.name !== a.name || other.goal !== a.goal;
  check('a different world gets a different fleet', differs, 'both worlds produced ' + a.name);

  var sibling = ships.makeShip(987654, 3);
  check('two ships in one world are not clones',
    sibling.id !== a.id && (sibling.name !== a.name || sibling.goal !== a.goal));
})();

// --- The fleet grows with the planet, and never shrinks -----------------------------------
(function fleetGrows() {
  for (var size = 0; size < 6; size++) {
    var n = ships.fleetSize(size);
    check('size ' + size + ' has at least one ship', n >= 1, String(n));
    check('size ' + size + ' is within the cap', n <= ships.MAX_SHIPS, String(n));
    if (size > 0) {
      check('the fleet never shrinks as the planet grows',
        n >= ships.fleetSize(size - 1), size + ': ' + n + ' < ' + ships.fleetSize(size - 1));
    }
  }

  var w = world();
  ships.ensureFleet(w, 0);
  var first = w.ships[0];
  first.claimed = true;
  ships.ensureFleet(w, 3);            // the planet grew twice over
  check('growing adds ships', w.ships.length === ships.fleetSize(3), String(w.ships.length));
  check('growing keeps the ship you already claimed',
    w.ships[0].id === first.id && w.ships[0].claimed === true);

  var before = w.ships.length;
  ships.ensureFleet(w, 3);
  check('ensureFleet is idempotent', w.ships.length === before);

  // A world does not lose ships if it somehow reports a smaller planet than it had.
  ships.ensureFleet(w, 0);
  check('a smaller planet never takes ships away', w.ships.length === before);
})();

// --- Every goal is reachable, and only by doing the thing ---------------------------------
// One goal that nothing can satisfy is a ship the player is invited to chase forever, so each
// one is driven from empty to done here.
(function everyGoalIsWinnable() {
  var satisfy = {
    voyages: function (w) {
      for (var i = 0; i < 3; i++) w.memories.push({ category: 'travel', people: [] });
    },
    company: function (w) { w.memories.push({ category: 'other', people: ['p1', 'p2'] }); },
    streak: function (w) { w.wallet.streak = 3; },
    chronicle: function (w) {
      for (var i = 0; i < 6; i++) w.memories.push({ category: 'other', people: [] });
    },
    crowd: function (w) { w.people = ['a', 'b', 'c', 'd']; }
  };

  ships.GOALS.forEach(function (goal) {
    check('goal ' + goal.id + ' has a way to satisfy it in this test', !!satisfy[goal.id]);
    if (!satisfy[goal.id]) return;

    var w = world();
    var ship = { id: 's', hull: 'small', name: 'Test', goal: goal.id, claimed: false };
    w.ships = [ship];

    var empty = ships.progressFor(w, ship);
    check(goal.id + ' starts unfinished on an empty world', !empty.complete && empty.done === 0,
      JSON.stringify(empty));
    check(goal.id + ' cannot be claimed before it is met', ships.claim(w, 's') === false);
    check(goal.id + ' is not listed as claimable early', ships.claimable(w).length === 0);

    satisfy[goal.id](w);

    var done = ships.progressFor(w, ship);
    check(goal.id + ' completes once the world earns it', done.complete,
      JSON.stringify(done));
    check(goal.id + ' reports full progress', done.done === done.target,
      done.done + '/' + done.target);
    check(goal.id + ' is listed as claimable', ships.claimable(w).length === 1);
    check(goal.id + ' claims', ships.claim(w, 's') === true);
    check(goal.id + ' is claimed', w.ships[0].claimed === true);
    check(goal.id + ' cannot be claimed twice', ships.claim(w, 's') === false);
    check(goal.id + ' drops off the claimable list once taken', ships.claimable(w).length === 0);

    check(goal.id + ' has a readable ask', typeof done.ask === 'string' && done.ask.length > 3);
  });
})();

// --- "company" is one day's company, not a running total ----------------------------------
// The distinction matters: counting every person across every memory would hand the ship over
// for two separate solo days, which is not what "a day with 2 people in it" says.
(function companyIsOneDay() {
  var w = world();
  var ship = { id: 's', hull: 'small', name: 'Test', goal: 'company', claimed: false };
  w.ships = [ship];
  w.memories.push({ category: 'other', people: ['p1'] });
  w.memories.push({ category: 'other', people: ['p2'] });
  check('two solo days do not add up to company', !ships.progressFor(w, ship).complete);
  w.memories.push({ category: 'other', people: ['p1', 'p3'] });
  check('one day with two people does it', ships.progressFor(w, ship).complete);
})();

// --- Claiming swaps the hull, and only the hull -------------------------------------------
(function claimingSwapsTheHull() {
  ['small', 'medium', 'large'].forEach(function (hull) {
    var ship = { id: 's', hull: hull, name: 'Test', goal: 'chronicle', claimed: false };
    check(hull + ' flies a pirate hull unclaimed',
      ships.modelFor(ship) === 'ship-pirate-' + hull + '.glb', ships.modelFor(ship));
    ship.claimed = true;
    check(hull + ' swaps to the matching civilian hull',
      ships.modelFor(ship) === 'ship-' + hull + '.glb', ships.modelFor(ship));
  });
})();

// --- Progress never runs past the target --------------------------------------------------
(function progressIsClamped() {
  var w = world();
  var ship = { id: 's', hull: 'small', name: 'Test', goal: 'chronicle', claimed: false };
  w.ships = [ship];
  for (var i = 0; i < 40; i++) w.memories.push({ category: 'other', people: [] });
  var p = ships.progressFor(w, ship);
  check('progress stops at the target', p.done === p.target, p.done + '/' + p.target);
})();

// --- An unknown ship is not a crash -------------------------------------------------------
(function unknownShip() {
  var w = world();
  check('find returns null for an unknown id', ships.find(w, 'nope') === null);
  check('claiming an unknown id is false, not a throw', ships.claim(w, 'nope') === false);
  check('a ship with a nonsense goal still reads',
    ships.progressFor(w, { goal: 'not-a-goal' }).target > 0);
})();

if (failures) {
  console.error('\n' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('ships: all checks passed');
