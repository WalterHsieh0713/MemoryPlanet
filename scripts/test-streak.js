// Run with node scripts/test-streak.js
var assert = require('assert');
globalThis.window = globalThis;
globalThis.MI = { store: { get: function () { return world; }, save: function () {} } };
require('../src/game/economy.js');

var world = { memories: [{ id: 'first' }, { id: 'second' }],
  wallet: { shards: 0, lifetime: 0, streak: 0, lastDay: null } };
var reward;
for (var day = 1; day <= 10; day++) {
  reward = MI.economy.rewardMemory({ importance: 1 }, {}, new Date(2026, 0, day));
  assert.strictEqual(world.wallet.streak, day);
  assert.strictEqual(reward.lines.some(function (line) {
    return line.label === '10-day milestone';
  }), day === 10);
}
var balance = world.wallet.shards;
reward = MI.economy.rewardMemory({ importance: 1 }, {}, new Date(2026, 0, 10, 20));
assert.strictEqual(reward.total, 10, 'a second entry today gets only the entry reward');
assert.strictEqual(world.wallet.shards, balance + 10);
MI.economy.rewardMemory({ importance: 1 }, {}, new Date(2026, 0, 12));
assert.strictEqual(world.wallet.streak, 1, 'a missed day resets the streak');
console.log('streak rewards: all checks passed');
