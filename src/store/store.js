// MI.store — world data + persistence (owner C, per docs/CONTRACT.md).
// Placement and asset choices are persisted, never recomputed at spawn time, so a reload
// reproduces the exact same planet (CLAUDE.md: no Math.random() at spawn time).
(function () {
  window.MI = window.MI || {};

  var STORAGE_KEY = 'memory-planet.world.v2';
  var world = null;

  function emptyWorld() {
    return {
      version: 2, nextSlot: null, home: null, seed: Date.now(),
      // The direction the island is currently growing in, as a tangent vector. Persisted so
      // the chain keeps heading the same way across reloads.
      heading: null,
      memories: [], people: [],
      // Plain terrain seeded around memories so the island reads as a landscape with
      // buildings in it, rather than a solid block of buildings.
      landscape: []
    };
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
  }
  var idCounter = 0;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      world = raw ? JSON.parse(raw) : emptyWorld();
    } catch (e) {
      world = emptyWorld(); // private mode / blocked storage / corrupt JSON — start fresh
    }
    if (!world.memories) world.memories = [];
    if (!world.people) world.people = [];
    if (!world.landscape) world.landscape = []; // worlds saved before landscape existed
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
    world = JSON.parse(str);
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
