// Offline check for src/world/hub.js. Run: node scripts/test-hub.js
var path = require('path');

globalThis.window = globalThis;
globalThis.THREE = require(path.join(__dirname, '..', 'three-r128.min.js'));
require(path.join(__dirname, '..', 'src', 'world', 'island.js'));
require(path.join(__dirname, '..', 'src', 'world', 'player.js'));
require(path.join(__dirname, '..', 'src', 'world', 'walkers.js'));
require(path.join(__dirname, '..', 'src', 'world', 'hub.js'));

var hub = globalThis.MI.world.hub;
var failed = 0;
function check(ok, msg) {
  if (ok) return;
  failed += 1;
  console.error('FAIL ' + msg);
}

var looks = hub.looks();
check(looks.length === 12, 'hub lists all 12 Mini Character looks, got ' + looks.length);
check(hub.getLook('scout') && hub.getLook('scout').model === 'male-a', 'scout is male-a');
check(hub.getLook('ash') && hub.getLook('ash').model === 'male-d', 'extra look ash is male-d');

var cells = hub.plazaCells();
check(cells.length === 19, 'plaza is 1+6+12 hexes, got ' + cells.length);
check(cells.filter(function (c) { return c.ring === 2; }).length === 12, 'outer ring has 12 cells');

var spots = hub.figureSpots(12, 1);
check(spots.length === 12, 'one spot per look');
var seen = {};
spots.forEach(function (s) {
  var k = s.i + ',' + s.j;
  check(!seen[k], 'duplicate figure cell ' + k);
  seen[k] = true;
  check(Math.sin(s.yaw) * s.x + Math.cos(s.yaw) * s.z < -0.01, 'look should face the house');
});

var start = hub.playerStart(1);
check(start.z > 0 || start.x !== 0, 'player starts off the house tile');

var world = {
  player: { character: 'scout' },
  people: [],
  memories: []
};
var free = hub.inspect(world, 'rose');
check(free && free.canSwap && !free.person && !free.you, 'unused look is free to take');
var self = hub.inspect(world, 'scout');
check(self && self.you && !self.canSwap, 'current look is you, no swap');

var took = hub.swap(world, 'rose');
check(took.ok && world.player.character === 'rose' && !took.person, 'free swap writes the player');

world.people = [{
  id: 'p-maya', name: 'Maya', relationship: 'friend',
  appearance: { model: 'male-b' }, memoryIds: ['m1']
}];
world.memories = [{ id: 'm1', title: 'Lisbon with Maya', people: ['p-maya'] }];
world.player.character = 'rose';
var taken = hub.inspect(world, 'sky');
check(taken && taken.person && taken.person.name === 'Maya' && taken.canSwap, 'sky is Maya');
check(taken.titles[0] === 'Lisbon with Maya', 'friend card lists their memories');

var traded = hub.swap(world, 'sky');
check(traded.ok && world.player.character === 'sky', 'taken swap moves the player onto sky');
check(world.people[0].appearance.model === 'female-a', 'Maya received Rose\'s model, got ' +
  world.people[0].appearance.model);

var same = hub.swap(world, 'sky');
check(!same.ok && same.reason === 'same', 'swapping into yourself is refused');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok — hub occupancy, swap and plaza');
