// Offline checks for pet ownership: who a pet belongs to, and how an older save is carried
// onto the owner map. Run: node scripts/test-pets.js
var path = require('path');

var mem = {};
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
  clear: function () { mem = {}; }
};

require(path.join(__dirname, '..', 'src', 'world', 'growth.js'));
require(path.join(__dirname, '..', 'src', 'store', 'store.js'));

var store = globalThis.MI.store;
var failed = 0;

function assert(cond, msg) {
  if (cond) return;
  failed += 1;
  console.error('FAIL ' + msg);
}

// --- v4 -> v5: one equipped pet becomes the player's pet --------------------------------
// Before v5 a world had a single `equipped.pet`, with no notion of whose it was. Everything
// that walked belonged to the player in effect, so that is where an old save's pet lands.
mem = {};
localStorage.setItem('memory-planet.world.v4', JSON.stringify({
  version: 4,
  memories: [], people: [],
  unlocks: { themes: ['meadow'], pets: ['dog'], satellites: [], skins: ['classic'] },
  equipped: { theme: 'meadow', pet: 'dog', satellite: null, skin: 'classic' }
}));
store.boot();
var w = store.openJournal(store.listJournals()[0].id);
assert(w.equipped.pets && w.equipped.pets.player === 'dog',
  'a v4 save\'s equipped pet becomes the player\'s pet, got ' + JSON.stringify(w.equipped.pets));
assert(w.equipped.pet === undefined,
  'and the single-pet slot is gone, got ' + JSON.stringify(w.equipped.pet));

// --- a pet belongs to one owner ---------------------------------------------------------
require(path.join(__dirname, '..', 'src', 'game', 'economy.js'));
var economy = globalThis.MI.economy;

w.unlocks.pets = ['dog', 'fox'];
w.equipped.pets = {};

economy.equip('pets', 'dog', 'person-sam');
assert(economy.petFor('person-sam') === 'dog', 'a pet can be assigned to a friend');
assert(economy.petFor('player') === null, 'and that leaves the player without one');

// Moved, not copied: a pet is one animal, so giving it to somebody else takes it away from
// whoever had it.
economy.equip('pets', 'dog', 'player');
assert(economy.petFor('player') === 'dog', 'reassigning gives the pet to its new owner');
assert(economy.petFor('person-sam') === null, 'and takes it off the old one');

// Putting one away clears only that owner's slot.
economy.equip('pets', 'fox', 'person-sam');
economy.equip('pets', null, 'player');
assert(economy.petFor('player') === null, 'a pet can be put away');
assert(economy.petFor('person-sam') === 'fox', 'which leaves everyone else alone');

// --- only a pet that is OUT can be fed ---------------------------------------------------
// Treats still go to the pantry, and there are two ways to hand one over (the treats tray,
// and pressing F at a pet in follow mode). Both feed an animal standing in the world, so
// the list of who can be fed is the pets that are out, not every pet you own.
w.unlocks.pets = ['dog', 'fox', 'bunny'];
w.equipped.pets = {};
economy.equip('pets', 'dog', 'player');
economy.equip('pets', 'fox', 'person-sam');
var feedable = economy.petsForFeed();
assert(feedable.length === 2, 'the two pets that are out can be fed, got ' + feedable.length);
assert(feedable.every(function (r) { return r.id !== 'bunny'; }),
  'a pet still in the shop is not standing anywhere to be fed');
assert(feedable.filter(function (r) { return r.owner === 'person-sam'; })[0].id === 'fox',
  'and each one says whose it is');

// Treats are consumable, and stack.
w.wallet.shards = 100;
economy.buy('food', 'carrot');
economy.buy('food', 'carrot');
assert(economy.stock('carrot') === 2, 'two carrots in the pantry, got ' + economy.stock('carrot'));
assert(w.wallet.shards === 80, 'each one costs its price, wallet at ' + w.wallet.shards);
assert(economy.takeFood('carrot') === true, 'feeding takes one out');
assert(economy.stock('carrot') === 1, 'leaving the other');
assert(economy.takeFood('cookie') === false, 'you cannot feed a treat you do not have');

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exitCode = 1;
} else {
  console.log('ok — pet ownership');
}
