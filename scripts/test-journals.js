// Offline check for the journal shelf in src/store/store.js.
// Run: node scripts/test-journals.js
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

function resetStorage() {
  mem = {};
}

resetStorage();
store.boot();
assert(store.listJournals().length === 0, 'fresh boot has an empty shelf');
assert(store.currentId() === null, 'fresh boot has not entered a journal');
assert(store.get().id === null, 'backdrop world is unsaved');
store.save();
assert(localStorage.getItem('memory-planet.world.v4') === null, 'save() refuses the unsaved ocean');

var willow = store.createJournal({ name: '  Willow\'s planet  ', character: 'rose' });
assert(willow.name === 'Willow\'s planet', 'create trims the world name');
assert(willow.player.character === 'rose', 'create stores the chosen avatar');
assert(store.currentId() === willow.id, 'create enters the new journal');
assert(store.listJournals().length === 1, 'new journal appears on the shelf');

willow.memories.push({ id: 'memory-1', title: 'sunrise', placement: { slot: 3 } });
store.save();

var grove = store.createJournal({ name: 'The grove', character: 'scout' });
assert(store.listJournals().length === 2, 'a second journal sits beside the first');
assert(store.get().name === 'The grove', 'get() is the journal just created');
assert(store.get().memories.length === 0, 'a new journal starts empty');

var opened = store.openJournal(willow.id);
assert(opened && opened.name === 'Willow\'s planet', 'openJournal loads the named world');
assert(store.get().memories.length === 1, 'opening restores that journal\'s memories');
assert(store.get().player.character === 'rose', 'opening restores that journal\'s avatar');

store.reset();
assert(store.get().name === 'Willow\'s planet', 'reset keeps the journal title');
assert(store.get().player.character === 'rose', 'reset keeps the avatar');
assert(store.get().memories.length === 0, 'reset clears this journal\'s memories');
assert(store.listJournals().length === 2, 'reset does not delete the other journal');

var gone = store.deleteJournal(willow.id);
assert(gone.ok && gone.wasCurrent, 'delete removes the open journal');
assert(store.listJournals().length === 1, 'deleted journal leaves the shelf');
assert(store.listJournals()[0].name === 'The grove', 'the other journal remains');
assert(store.currentId() === null, 'deleting the open journal leaves you on the shelf');

resetStorage();
localStorage.setItem('memory-planet.world.v4', JSON.stringify({
  version: 4,
  memories: [{ id: 'm1', placement: { slot: 1 } }],
  people: [{ id: 'p1', name: 'Ana' }],
  planet: { frequency: 2 },
  player: { character: 'sky' }
}));
store.boot();
var migrated = store.listJournals();
assert(migrated.length === 1, 'a lone v4 save becomes one shelf entry');
assert(migrated[0].name === 'My journal', 'an unnamed save is filed as My journal');
assert(migrated[0].memories === 1 && migrated[0].people === 1, 'migration keeps counts on the shelf');
assert(store.currentId() === null, 'boot still waits on the gate after migrating');
assert(store.openJournal(migrated[0].id).player.character === 'sky', 'migrated journal opens with its avatar');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok — journal shelf: create, switch, reset, migrate');
