// Offline check for src/game/economy.js. Run: node scripts/test-economy.js
var path = require('path');

globalThis.window = globalThis;
globalThis.MI = {
  store: {
    _world: {
      wallet: { shards: 40, lifetime: 40, streak: 0, lastDay: null },
      unlocks: { themes: ['meadow'], pets: [], satellites: [], skins: ['classic'] },
      equipped: { theme: 'meadow', pets: {}, satellite: null, skin: 'classic' },
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

// Who is out, and whose they are.
MI.store.get().unlocks.pets = ['fox', 'bunny', 'dog'];
economy.equip('pets', 'dog', 'player');
economy.equip('pets', 'fox', 'person-sam');
var out = economy.petsOut();
check(out.length === 2, 'two pets are out, got ' + out.length);
check(economy.petFor('player') === 'dog', 'the player walks the dog');
check(out.filter(function (r) { return r.owner === 'person-sam'; })[0].id === 'fox',
  'and Sam has the fox');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok — food pantry, coins, pet owners');
