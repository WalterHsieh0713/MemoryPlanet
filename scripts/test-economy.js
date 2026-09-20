// Offline check for src/game/economy.js. Run: node scripts/test-economy.js
var path = require('path');

globalThis.window = globalThis;
globalThis.MI = {
  store: {
    _world: {
      wallet: { shards: 40, lifetime: 40, streak: 0, lastDay: null },
      unlocks: { themes: ['meadow'], pets: [], satellites: [], skins: ['classic'] },
      equipped: { theme: 'meadow', pet: null, satellite: null, skin: 'classic' },
      pantry: {},
      memories: []
    },
    get: function () { return this._world; },
    save: function () {}
  }
};
require(path.join(__dirname, '..', 'src/game/economy.js'));
var economy = MI.economy;

var failed = 0;
function check(ok, msg) {
  if (ok) return;
  failed += 1;
  console.error('FAIL ' + msg);
}

check(economy.find('food', 'apple') && economy.find('food', 'apple').price === 8,
  'apple is a treat that costs 8');
check(economy.CATALOG.food.length === 8, 'eight treats in the shop');
check(economy.stock('apple') === 0, 'an empty pantry has no apples');

var short = economy.buyFood('apple');
check(short.ok && short.count === 1, 'buying an apple with enough coins succeeds');
check(MI.store.get().wallet.shards === 32, 'buying an apple spends 8 coins, got ' + MI.store.get().wallet.shards);
check(economy.stock('apple') === 1, 'the pantry holds the apple');

var again = economy.buyFood('apple');
check(again.ok && again.count === 2, 'buying another apple stacks, does not unlock');
check(!MI.store.get().unlocks.food, 'food is not an unlock list');

check(economy.takeFood('apple') === true, 'feeding takes one apple');
check(economy.stock('apple') === 1, 'one apple remains after a feed');
check(economy.takeFood('carrot') === false, 'feeding a treat you do not have fails');

MI.store.get().wallet.shards = 5;
var broke = economy.buyFood('fish');
check(!broke.ok && broke.reason === 'short', 'a fish is too expensive on 5 coins');
check(economy.stock('fish') === 0, 'a failed buy does not add fish');

var viaBuy = economy.buy('food', 'cookie');
check(!viaBuy.ok && viaBuy.reason === 'short', 'buy("food") is the same as buyFood');
MI.store.get().wallet.shards = 20;
viaBuy = economy.buy('food', 'cookie');
check(viaBuy.ok && economy.stock('cookie') === 1, 'buy("food") still fills the pantry');

MI.store.get().unlocks.pets = ['fox', 'bunny', 'dog'];
MI.store.get().equipped.pet = 'dog';
var order = economy.petsForFeed().map(function (p) { return p.id; });
check(order[0] === 'dog', 'the pet that is out is first in the feed list');
check(order.join(',') === 'dog,bunny,fox', 'owned pets keep catalog order after the one that is out');
MI.store.get().equipped.pet = null;
order = economy.petsForFeed().map(function (p) { return p.id; });
check(order[0] === 'bunny', 'with nobody out, catalog order stands');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok — food pantry, coins, stacking treats');
