// MI.store — world data + persistence (owner C, per docs/CONTRACT.md).
// Placement and asset choices are persisted, never recomputed at spawn time, so a reload
// reproduces the exact same planet (CLAUDE.md: no Math.random() at spawn time).
(function () {
  window.MI = window.MI || {};

  var STORAGE_KEY = 'memory-planet.world.v3';
  // v2 worlds are migrated on first load; the v2 copy is left alone for older builds.
  var LEGACY_KEY = 'memory-planet.world.v2';
  var world = null;

  function firstFrequency() {
    return MI.growth ? MI.growth.LADDER[0] : 2;
  }

  function emptyWorld() {
    return {
      version: 3, nextSlot: null, home: null, seed: Date.now(),
      // The direction the island is currently growing in, as a tangent vector. Persisted so
      // the chain keeps heading the same way across reloads.
      heading: null,
      memories: [], people: [],
      // Plain terrain seeded around memories so the island reads as a landscape with
      // buildings in it, rather than a solid block of buildings.
      landscape: [],
      // Planet size: a frequency on MI.growth.LADDER. Every slot above indexes into the grid
      // for this frequency, so it must change together with them (MI.app.growPlanet).
      planet: { frequency: firstFrequency() },
      // Progression — see src/game/economy.js.
      wallet: { shards: 0, lifetime: 0, streak: 0, lastDay: null },
      unlocks: { themes: ['meadow'], pets: [], skins: ['classic'] },
      equipped: { theme: 'meadow', pet: null, skin: 'classic' }
    };
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null; // private mode / blocked storage / corrupt JSON
    }
  }

  // Fill anything an older save is missing, so the rest of the app can rely on the v3 shape.
  function normalize(w) {
    var fresh = emptyWorld();
    if (!w.memories) w.memories = [];
    if (!w.people) w.people = [];
    if (!w.landscape) w.landscape = []; // worlds saved before landscape existed
    if (!w.planet) {
      // Every v2 world was built on the original 1002-tile grid (frequency 10).
      w.planet = { frequency: w.version === 3 ? fresh.planet.frequency : 10 };
    }
    ['wallet', 'unlocks', 'equipped'].forEach(function (key) {
      if (!w[key]) w[key] = fresh[key];
      Object.keys(fresh[key]).forEach(function (field) {
        if (w[key][field] === undefined) w[key][field] = fresh[key][field];
      });
    });
    w.version = 3;
    return w;
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
  }
  var idCounter = 0;

  function load() {
    var saved = read(STORAGE_KEY);
    var legacy = saved ? null : read(LEGACY_KEY);
    world = normalize(saved || legacy || emptyWorld());
    if (legacy) save(); // write the migrated copy once
    return world;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
    } catch (e) {
      // Storage full or blocked — the in-memory world still works for this session.
    }
  }

  function get() {
    return world || load();
  }

  function takenSlots() {
    var taken = new Set();
    get().memories.forEach(function (m) {
      if (m.placement && typeof m.placement.slot === 'number') taken.add(m.placement.slot);
    });
    return taken;
  }

  function addMemory(memory) {
    get().memories.push(memory);
    save();
    return memory;
  }

  function addLandscape(entry) {
    get().landscape.push(entry);
    save();
    return entry;
  }

  // Every slot the island occupies — buildings and terrain alike. Used when picking where
  // the next memory goes, so a building never lands on ground that's already dressed.
  function occupiedSlots() {
    var used = takenSlots();
    get().landscape.forEach(function (l) { used.add(l.slot); });
    return used;
  }

  function addPerson(person) {
    get().people.push(person);
    save();
    return person;
  }

  function findPerson(name) {
    if (!name) return null;
    var needle = String(name).trim().toLowerCase();
    var found = get().people.filter(function (p) {
      return p.name && p.name.trim().toLowerCase() === needle;
    });
    return found.length ? found[0] : null;
  }

  function findMemoryBySlot(slot) {
    var found = get().memories.filter(function (m) {
      return m.placement && m.placement.slot === slot;
    });
    return found.length ? found[0] : null;
  }

  function reset() {
    world = emptyWorld();
    save();
    return world;
  }

  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }

  function importJSON(str) {
    world = normalize(JSON.parse(str));
    save();
    return world;
  }

  MI.store = {
    load: load,
    save: save,
    get: get,
    newId: newId,
    takenSlots: takenSlots,
    occupiedSlots: occupiedSlots,
    addMemory: addMemory,
    addLandscape: addLandscape,
    addPerson: addPerson,
    findPerson: findPerson,
    findMemoryBySlot: findMemoryBySlot,
    reset: reset,
    exportJSON: exportJSON,
    importJSON: importJSON
  };
})();
